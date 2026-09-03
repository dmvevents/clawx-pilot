/**
 * Outlook (browser-session) manager.
 *
 * Drives Outlook Web (https://outlook.office.com/mail/) in the principal's
 * existing Chrome session via the bundled browser plugin. Provides four
 * agent-facing capabilities:
 *
 *   - open()        → opens the inbox; surfaces 'needs_signin' if Outlook
 *                     bounces to login.microsoftonline.com.
 *   - readInbox()   → snapshots the message list and returns the top N
 *                     messages (subject, sender, snippet, received-at, unread).
 *   - draftEmail()  → clicks New mail, fills To/Subject/Body (and CC/BCC if
 *                     given), leaves the compose pane open for human review.
 *                     Default behaviour: NEVER auto-send.
 *   - sendEmail()   → only fires when the caller passes `confirm: true`.
 *                     Without that flag the call is refused. The agent must
 *                     show the draft to the user and get a "yes, send" first.
 *
 * Hard rules (do not relax these):
 *  - profile is always 'user'. Managed Chromium is blocked by Conditional
 *    Access on the school tenant.
 *  - We never accept, store, or log the password. If sign-in is needed we
 *    surface 'needs_signin' and ask the user to complete it interactively.
 *  - We never replay tokens or steal cookies. We only drive the DOM the user
 *    is already authenticated against.
 *  - sendEmail without `confirm: true` is a hard refuse, not a warning.
 */
import { logger } from '../../utils/logger';
import { browserClient, type BrowserStatus, type OutlookBrowserClient } from './browser-client';
import type {
  DraftEmailArgs,
  DraftEmailResult,
  InboxMessage,
  OutlookOpenResult,
  ReadInboxResult,
  SendEmailArgs,
  SendEmailResult,
} from './types';

const OUTLOOK_INBOX_URL = 'https://outlook.office.com/mail/';
const SIGNIN_HOST_RE = /login\.microsoftonline\.com|login\.microsoft\.com|login\.live\.com/;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function asArray(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v.filter(Boolean) : [v].filter(Boolean);
}

interface SnapshotShape {
  url?: string;
  tree?: unknown;
}

export class OutlookBrowserManager {
  private targetId: string | undefined;

  constructor(private readonly browser: OutlookBrowserClient = browserClient) {}

  /**
   * Test/inspection hook. Returns the active tab id, if any. Not part of the
   * agent-facing surface.
   */
  getTargetId(): string | undefined {
    return this.targetId;
  }

  /** Opens Outlook Web in the user's Chrome and detects sign-in interstitials. */
  async open(): Promise<OutlookOpenResult> {
    const status = await this.ensureBrowser();
    if (!status.running) {
      return {
        status: 'needs_signin',
        url: OUTLOOK_INBOX_URL,
        message:
          'Ministry of Education could not attach to Chrome for Outlook. The assistant should run browser.diagnose and browser.repair_chrome_cdp, then retry outlook.open. If repair reports profile_locked_close_chrome, close all Chrome windows and retry from Ministry of Education. Do not ask the principal to configure Chrome manually.',
      };
    }

    const opened = await this.browser.open(OUTLOOK_INBOX_URL, 'user');
    this.targetId = opened.targetId;

    // Outlook's first paint is slow; give the redirect a moment.
    await sleep(1500);
    const snap = (await this.browser.snapshot(this.targetId, {
      format: 'aria',
      compact: true,
      depth: 4,
    })) as SnapshotShape;

    const url = typeof snap?.url === 'string' ? snap.url : OUTLOOK_INBOX_URL;
    if (SIGNIN_HOST_RE.test(url) || treeLooksLikeSignin(snap?.tree)) {
      return {
        status: 'needs_signin',
        url,
        targetId: this.targetId,
        message:
          'Please sign in to Outlook in the Chrome window that just opened. When you reach the inbox, ask me to retry.',
      };
    }

    return {
      status: 'opened',
      url,
      targetId: this.targetId,
    };
  }

  /** Returns the top N messages from the inbox via DOM snapshot. */
  async readInbox(top = 10): Promise<ReadInboxResult> {
    const targetId = await this.ensureOutlookTab();
    if (typeof targetId !== 'string') {
      // ensureOutlookTab returned a needs_signin marker
      return targetId;
    }

    const snap = (await this.browser.snapshot(targetId, {
      format: 'aria',
      refs: 'aria',
      interactive: false,
      labels: true,
      // Outlook's mail list lives inside role=main → role=region → role=listbox
      depth: 12,
    })) as SnapshotShape;

    if (SIGNIN_HOST_RE.test(snap?.url ?? '') || treeLooksLikeSignin(snap?.tree)) {
      return {
        status: 'needs_signin',
        messages: [],
        message: 'Outlook Web is asking you to sign in. Complete sign-in in the Chrome window, then retry.',
      };
    }

    const requestedTop = Math.max(1, top);
    const messages = extractInboxMessages(snap?.tree).slice(0, requestedTop);
    return {
      status: 'ok',
      messages,
      scan: {
        scope: 'recent_inbox_window',
        requestedTop,
        scannedCount: messages.length,
        returnedCount: messages.length,
        exhaustive: false,
        note:
          'Browser Outlook scan covers the recent visible Inbox window only; do not describe it as all mailbox mail.',
      },
    };
  }

  /**
   * Opens New mail, fills the compose pane, leaves it open for review.
   * Never sends.
   */
  async draftEmail(args: DraftEmailArgs): Promise<DraftEmailResult> {
    const to = asArray(args.to);
    const cc = asArray(args.cc);
    const bcc = asArray(args.bcc);
    const subject = String(args.subject ?? '').trim();
    const body = String(args.body ?? '');

    if (to.length === 0) throw new Error('draftEmail: at least one recipient required.');
    if (!subject) throw new Error('draftEmail: subject is required.');

    const targetId = await this.ensureOutlookTab();
    if (typeof targetId !== 'string') {
      return {
        status: 'needs_signin',
        draftLeftOpen: false,
        preview: { to, cc, bcc, subject, body },
        message: targetId.message,
      };
    }

    // 1. Click New mail. Outlook Web exposes it as "New mail" / "New message".
    await this.clickByLabel(targetId, ['New mail', 'New message', 'New Mail']);

    // 2. Wait for compose pane.
    await sleep(800);

    // 3. Fill the compose pane fields.
    await this.fillComposeField(targetId, ['To'], to.join('; '));
    if (cc.length > 0) {
      // Cc/Bcc may need to be revealed first.
      await this.clickByLabel(targetId, ['Cc', 'Show Cc']).catch(() => undefined);
      await this.fillComposeField(targetId, ['Cc'], cc.join('; '));
    }
    if (bcc.length > 0) {
      await this.clickByLabel(targetId, ['Bcc', 'Show Bcc']).catch(() => undefined);
      await this.fillComposeField(targetId, ['Bcc'], bcc.join('; '));
    }
    await this.fillComposeField(targetId, ['Subject', 'Add a subject'], subject);
    await this.fillComposeField(
      targetId,
      ['Message body', 'Body', 'Type your message here'],
      body,
    );

    return {
      status: 'drafted',
      draftLeftOpen: true,
      preview: { to, cc, bcc, subject, body },
      message: 'Draft prepared and left open in Outlook for your review.',
    };
  }

  /**
   * Sends the email. Hard refuses unless `confirm: true` is set. The agent
   * is expected to show the draft to the user and obtain explicit
   * confirmation before flipping that bit.
   */
  async sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
    if (args.confirm !== true) {
      return {
        status: 'refused',
        reason:
          'Send blocked: confirm flag not set. Show the draft to the principal and re-call with confirm=true after they say yes.',
      };
    }

    const subject = args.subject;
    if (!args.to || typeof subject !== 'string' || !subject.trim() || typeof args.body !== 'string') {
      return {
        status: 'refused',
        reason:
          'Send blocked: the legacy Outlook driver requires explicit to, subject, and body fields. Open the reviewed draft in the v2 Outlook path or re-draft before sending.',
      };
    }

    // Ensure the draft exists (idempotent — fills again if needed).
    const drafted = await this.draftEmail({
      to: args.to,
      subject,
      body: args.body,
      cc: args.cc,
      bcc: args.bcc,
    });
    if (drafted.status === 'needs_signin') {
      return { status: 'needs_signin', message: drafted.message };
    }

    const targetId = this.targetId;
    if (!targetId) {
      return {
        status: 'refused',
        reason: 'Outlook tab not available; call open() first.',
      };
    }

    await this.clickByLabel(targetId, ['Send']);
    return {
      status: 'sent',
      message: 'Email sent via Outlook Web.',
    };
  }

  // ── internals ────────────────────────────────────────────────────────────

  private async ensureBrowser(): Promise<BrowserStatus> {
    let s = await this.browser.status('user');
    if (!s.running) {
      await this.browser.start('user');
      await sleep(1500);
      s = await this.browser.status('user');
    }
    return s;
  }

  /**
   * Ensures we have an Outlook tab open and not parked on the sign-in page.
   * Returns the targetId on success, or a ReadInboxResult-shaped marker on
   * sign-in. (Slightly awkward return type, but it lets callers re-emit the
   * same `needs_signin` payload they expose to the agent.)
   */
  private async ensureOutlookTab(): Promise<string | ReadInboxResult> {
    if (!this.targetId) {
      const opened = await this.open();
      if (opened.status === 'needs_signin') {
        return {
          status: 'needs_signin',
          messages: [],
          message: opened.message,
        };
      }
      this.targetId = opened.targetId;
    }
    if (!this.targetId) {
      return {
        status: 'needs_signin',
        messages: [],
        message: 'Could not attach to an Outlook tab. Open Outlook in Chrome and retry.',
      };
    }
    return this.targetId;
  }

  private async clickByLabel(targetId: string, labels: string[]): Promise<void> {
    let lastErr: unknown;
    for (const label of labels) {
      try {
        await this.browser.act(targetId, {
          kind: 'click',
          selector: `button:has-text("${label}"), [role="button"]:has-text("${label}")`,
        });
        return;
      } catch (err) {
        lastErr = err;
      }
    }
    logger.warn?.(
      `[outlook-browser] clickByLabel failed for [${labels.join(', ')}]: ${
        lastErr instanceof Error ? lastErr.message : String(lastErr)
      }`,
    );
    throw new Error(`Could not click any of: ${labels.join(', ')}`);
  }

  private async fillComposeField(
    targetId: string,
    labels: string[],
    value: string,
  ): Promise<void> {
    let lastErr: unknown;
    for (const label of labels) {
      try {
        await this.browser.act(targetId, {
          kind: 'fill',
          fields: [
            {
              selector: `[aria-label="${label}"], [placeholder="${label}"]`,
              value,
              type: 'text',
            },
          ],
        });
        return;
      } catch (err) {
        lastErr = err;
      }
    }
    logger.warn?.(
      `[outlook-browser] fillComposeField failed for [${labels.join(', ')}]: ${
        lastErr instanceof Error ? lastErr.message : String(lastErr)
      }`,
    );
    throw new Error(`Could not fill field: ${labels.join(', ')}`);
  }
}

// ── DOM/snapshot helpers ──────────────────────────────────────────────────

/**
 * Heuristic: the snapshot tree looks like a Microsoft sign-in page if it
 * contains the "Pick an account" / "Sign in" heading or an email-input field
 * labeled "Email, phone, or Skype".
 */
function treeLooksLikeSignin(tree: unknown): boolean {
  let hit = false;
  visit(tree, (n) => {
    const name = String(n.name ?? n.label ?? '').toLowerCase();
    if (
      name.includes('sign in') ||
      name.includes('pick an account') ||
      name.includes('email, phone, or skype') ||
      name.includes('enter password')
    ) {
      hit = true;
    }
  });
  return hit;
}

/**
 * Best-effort extraction of inbox rows from an aria snapshot. Outlook Web
 * exposes the message list as role=option items inside a role=listbox,
 * each with an accessible name like
 *   "Sender Name, Subject line, Tue 5/20, Preview text…"
 * We split on commas as a first pass; this is intentionally forgiving and
 * tolerates partial parses.
 */
export function extractInboxMessages(tree: unknown): InboxMessage[] {
  const out: InboxMessage[] = [];
  visit(tree, (n) => {
    const role = String(n.role ?? '').toLowerCase();
    if (role !== 'option' && role !== 'listitem') return;
    const name = String(n.name ?? n.label ?? '').trim();
    if (!name) return;
    const parsed = parseRowName(name);
    if (!parsed) return;
    const id = String(n.ref ?? n.id ?? `msg-${out.length}`);
    const unread = Boolean(
      n.unread === true ||
        (typeof n.description === 'string' && /unread/i.test(n.description)),
    );
    out.push({
      id,
      sender: parsed.sender,
      subject: parsed.subject,
      receivedAt: parsed.receivedAt,
      snippet: parsed.snippet,
      unread,
    });
  });
  return out;
}

function parseRowName(
  name: string,
): { sender: string; subject: string; receivedAt: string; snippet: string } | null {
  // Outlook's accessible name for a row is comma-delimited and roughly:
  //   "<sender>, <subject>, <received>, <preview>"
  // Anything fewer than 3 parts isn't a row.
  const parts = name.split(/,\s+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 3) return null;
  const sender = parts[0];
  const subject = parts[1];
  const receivedAt = parts[2];
  const snippet = parts.slice(3).join(', ').slice(0, 200);
  return { sender, subject, receivedAt, snippet };
}

function visit(node: unknown, fn: (n: Record<string, unknown>) => void): void {
  if (!node || typeof node !== 'object') return;
  const n = node as Record<string, unknown>;
  fn(n);
  const children = (n.children ?? n.nodes) as unknown;
  if (Array.isArray(children)) for (const c of children) visit(c, fn);
}

export const outlookBrowserManager = new OutlookBrowserManager();
