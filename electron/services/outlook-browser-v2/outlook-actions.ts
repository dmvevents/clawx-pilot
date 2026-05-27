/**
 * High-level Outlook actions. Sits between the public manager (matches v1
 * surface) and the Playwright driver + VLM grounder.
 *
 * Each action follows the same pattern:
 *
 *   1. Try a fast-path semantic locator (page.getByRole, getByLabel, etc).
 *      Robust to most Outlook updates and zero VLM cost.
 *   2. On miss, screenshot + ask the VLM "where is X?" + click the bbox
 *      centre.
 *   3. Verify post-action state (e.g. did the compose pane appear?) before
 *      reporting success.
 *
 * Send protection: sendEmail with confirm=true does NOT re-draft. It uses
 * the already-open compose pane the user just confirmed. If the pane is
 * gone (closed by user, navigated away), it returns
 * { status: 'refused', reason: 'no draft' } instead of opening a new one
 * and clicking Send blindly. This closes the wrong-email-sent risk
 * identified in /tmp/outlook-deep-audit.md (C1, C2).
 */
import type { Page } from 'playwright-core';
import { logger } from '../../utils/logger';
import { PlaywrightDriver } from './playwright-driver';
import { VlmGrounder, bboxCentre } from './vlm-grounder';
import { matchesSearchArgsForTests } from './search-helpers';
import { readOutlookDomState } from './dom-heuristics';
import type {
  OutlookOpenResult,
  ReadInboxResult,
  InboxMessage,
  DraftEmailArgs,
  DraftEmailResult,
  SendEmailArgs,
  SendEmailResult,
  SearchInboxArgs,
  SearchInboxResult,
  ReadEmailArgs,
  ReadEmailResult,
  EmailAttachmentInfo,
  ReplyArgs,
  ReplyResult,
  ForwardArgs,
  ForwardResult,
  MarkReadArgs,
  MarkReadResult,
  ListAttachmentsArgs,
  ListAttachmentsResult,
  DownloadAttachmentArgs,
  DownloadAttachmentResult,
} from './types';

function asArray(v: string | string[] | undefined): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return [v];
}

// Predicate moved to ./search-helpers.ts for unit testing without Playwright.
const matchesSearchArgs = matchesSearchArgsForTests;

export class OutlookActions {
  constructor(
    private readonly driver: PlaywrightDriver,
    private readonly grounder: VlmGrounder,
  ) {}

  /** Ensure the Outlook tab exists and is signed in. */
  async open(): Promise<OutlookOpenResult> {
    const page = await this.driver.ensureOutlookTab();
    const url = page.url();

    if (await this.looksLikeSignin(page)) {
      return {
        status: 'needs_signin',
        url,
        message:
          'Outlook is showing the Microsoft sign-in page. Complete sign-in in the Chrome window, then retry.',
      };
    }

    return { status: 'opened', url };
  }

  /** Read the top N inbox rows. Stable across UI changes via VLM fallback. */
  async readInbox(top: number = 10): Promise<ReadInboxResult> {
    const page = await this.driver.ensureOutlookTab();
    if (await this.looksLikeSignin(page)) {
      return {
        status: 'needs_signin',
        messages: [],
        message: 'Outlook is on the sign-in page. Sign in in Chrome and retry.',
      };
    }

    // Wait for the inbox grid to render. We don't trust a single hard-coded
    // selector; ARIA "rowgroup" or any row-with-subject heuristic works
    // across themes.
    try {
      await page.waitForSelector('div[role="listbox"], div[role="rowgroup"], [aria-label*="Inbox" i]', {
        timeout: 15_000,
      });
    } catch {
      // Fall through — extraction may still find rows even if the wait
      // selector missed. Worst case we return an empty list.
    }

    // Pull message rows by walking the descendant text nodes of each row
    // element. Outlook's aria-label concatenates everything into one string
    // (sender + subject + preview + date + adjacent UI banner text), so the
    // old comma-split heuristic produced "Unread AllFacultyMail You've..."
    // single-string blobs. Walking text nodes gets us cleanly separated
    // visible text in DOM order, which matches what assistive tech reads:
    //   ["A" (avatar initial), "AllFacultyMail" (sender), "subject text",
    //    "Fri 3:46 PM" (received), "preview/snippet text"]
    // We classify each text node by content (date-like, single-letter
    // avatar, etc.) and assign positions.
    const rawAriaLabel = (s: string) => s.replace(/^Unread\s+/i, '').trim();
    const rows = await page.evaluate(`
      (() => {
        const out = [];
        const seen = new Set();
        const nodes = document.querySelectorAll('[role="option"][aria-label], [role="row"][aria-label]');
        const limit = ${JSON.stringify(top)};
        // Date-line heuristic: short string starting with weekday/month/AM-PM
        // marker or HH:MM. Stable across en-* locales; for non-English we
        // accept any string under 25 chars with a digit and a colon or slash.
        const isDateLike = function(s) {
          if (!s) return false;
          if (s.length > 30) return false;
          if (/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun|Yesterday|Today|Tomorrow)\\b/i.test(s)) return true;
          if (/^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\\b/i.test(s)) return true;
          if (/^\\d{1,2}[:\\/]\\d/.test(s)) return true;
          return false;
        };
        for (const el of Array.from(nodes)) {
          const label = el.getAttribute('aria-label') || '';
          if (!label) continue;
          // De-dup by label so collapsed thread groups don't multiply rows.
          const key = label.slice(0, 200);
          if (seen.has(key)) continue;
          seen.add(key);
          if (out.length >= limit) break;

          // Collect non-empty text-node values in DOM order.
          const texts = [];
          const walk = function(node) {
            if (node.nodeType === 3) {
              const t = (node.textContent || '').trim();
              if (t) texts.push(t);
            } else if (node.nodeType === 1) {
              for (const c of Array.from(node.childNodes)) walk(c);
            }
          };
          walk(el);

          // Classify the text nodes:
          // 1. Skip 1-2 char fragments — these are avatar initials.
          // 2. First "long" string is sender.
          // 3. Next "long" string before any date-like is subject.
          // 4. First date-like string is receivedAt.
          // 5. Everything after the date is snippet.
          let sender = '';
          let subject = '';
          let receivedAt = '';
          const snippetParts = [];
          let phase = 'sender';
          for (const t of texts) {
            if (t.length < 3 && phase !== 'snippet') continue;
            if (phase === 'sender') {
              sender = t;
              phase = 'subject';
              continue;
            }
            if (phase === 'subject') {
              if (isDateLike(t)) { receivedAt = t; phase = 'snippet'; continue; }
              subject = subject ? subject + ' ' + t : t;
              continue;
            }
            if (phase === 'snippet') {
              snippetParts.push(t);
            }
          }
          // If we never hit a date, fall back: assume the LAST short token
          // before snippet text is the date.
          if (!receivedAt && snippetParts.length) {
            for (let i = snippetParts.length - 1; i >= 0; i--) {
              if (isDateLike(snippetParts[i])) {
                receivedAt = snippetParts.splice(i, 1)[0];
                break;
              }
            }
          }
          const snippet = snippetParts.join(' ').slice(0, 200);
          const unread = /\\bunread\\b/i.test(label);
          // id: stable-ish hash from sender+subject+receivedAt so re-reads match.
          const id = (sender + '|' + subject + '|' + receivedAt).slice(0, 96) || label.slice(0, 96);
          out.push({ id: id, sender: sender, subject: subject, snippet: snippet, received: receivedAt, unread: unread });
        }
        return out;
      })()
    `) as Array<{ id: string; sender: string; subject: string; snippet: string; received: string; unread: boolean }>;
    void rawAriaLabel; // reserved for future fallback path

    const messages: InboxMessage[] = rows.map((r) => ({
      id: r.id,
      subject: r.subject,
      sender: r.sender,
      snippet: r.snippet.slice(0, 120),
      receivedAt: r.received,
      unread: r.unread,
    }));

    return { status: 'ok', messages };
  }

  /**
   * Open a New Mail compose pane and fill in to/cc/bcc/subject/body.
   * Leaves the draft open in Outlook for user review.
   */
  async draftEmail(args: DraftEmailArgs): Promise<DraftEmailResult> {
    const to = asArray(args.to);
    const cc = asArray(args.cc);
    const bcc = asArray(args.bcc);
    const subject = args.subject ?? '';
    const body = args.body ?? '';

    const page = await this.driver.ensureOutlookTab();
    if (await this.looksLikeSignin(page)) {
      return {
        status: 'needs_signin',
        draftLeftOpen: false,
        preview: { to, cc, bcc, subject, body },
        message: 'Outlook is on the sign-in page. Sign in in Chrome and retry.',
      };
    }

    // 0. Dismiss any blocking welcome / promo dialog. Outlook Web shows
    // a "What's new" dialog on first sign-in whose backdrop intercepts
    // pointer events — Playwright's click retry will spin until timeout
    // unless we close it first. Best-effort: try a few common dismiss
    // affordances; ignore failures (no dialog to close is the happy path).
    await this.dismissBlockingDialog(page);

    // 1. Click New mail.
    await this.clickNewMail(page);

    // 2. Wait for a compose pane to appear before filling.
    await this.waitForComposePane(page);

    // 3. Fill recipient/subject/body. Outlook's compose pane uses standard
    // contenteditable + inputs; semantic locators are stable here.
    await this.fillField(page, 'To', to.join('; '));
    if (cc.length > 0) {
      // Reveal Cc if it's hidden.
      await this.revealCcBcc(page, 'Cc');
      await this.fillField(page, 'Cc', cc.join('; '));
    }
    if (bcc.length > 0) {
      await this.revealCcBcc(page, 'Bcc');
      await this.fillField(page, 'Bcc', bcc.join('; '));
    }
    await this.fillField(page, 'Subject', subject);
    await this.fillBody(page, body);

    return {
      status: 'drafted',
      draftLeftOpen: true,
      preview: { to, cc, bcc, subject, body },
      message: 'Draft prepared and left open in Outlook for your review.',
    };
  }

  /**
   * Send the email. Hard refuses unless confirm=true. Crucially, does NOT
   * re-draft — uses the already-open compose pane and verifies its subject
   * matches what the agent intends to send.
   */
  async sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
    if (args.confirm !== true) {
      return {
        status: 'refused',
        reason:
          'Send blocked: confirm flag not set. Show the draft to the principal and re-call with confirm=true after they say yes.',
      };
    }

    const page = await this.driver.ensureOutlookTab();
    if (await this.looksLikeSignin(page)) {
      return {
        status: 'needs_signin',
        message: 'Outlook is on the sign-in page. Sign in in Chrome and retry.',
      };
    }

    // Verify the open compose pane's subject matches args.subject. This
    // protects against a drifted state where another draft is open and we
    // would otherwise click Send on the wrong pane.
    const openSubject = await this.readOpenSubject(page);
    if (openSubject == null) {
      return {
        status: 'refused',
        reason:
          'No open draft found. Call draftEmail first and confirm with the user before retrying send.',
      };
    }
    if (openSubject.trim() !== (args.subject ?? '').trim()) {
      logger.warn(
        `[outlook-v2] Send refused: open subject "${openSubject.slice(0, 40)}…" does not match args.subject "${(args.subject ?? '').slice(0, 40)}…"`,
      );
      return {
        status: 'refused',
        reason:
          'Send blocked: the open draft\'s subject does not match the requested subject. The user may have edited a different draft. Re-draft and try again.',
      };
    }

    // Click Send, scoped to the active compose pane via aria-label.
    await this.clickByRoleOrVlm(page, {
      role: 'button',
      nameRegex: /^send$/i,
      // Ground only on the compose-pane region. The VLM hint biases the
      // model toward the toolbar inside the compose pane, not a global
      // "Send" button in some unrelated rail.
      vlmQuestion:
        'The "Send" button inside the open Outlook compose pane (the New Mail dialog the user just reviewed). Avoid any "Send" button outside that pane.',
    });

    return { status: 'sent', message: 'Email sent via Outlook Web.' };
  }

  // ── Phase 3 actions: search, read, reply, forward, mark, attachments ────

  /**
   * Search the inbox client-side. Outlook's search bar is heavyweight (it
   * reflows the inbox view, requires waiting for results, and its DOM is
   * unstable). For predicates that fit a "load top N rows then filter"
   * model — which covers all of the OKR's W2.x / W7.x / W8.x rows — we
   * just call readInbox(top) and filter the result set in JS. This is
   * cheap, deterministic, and parallelisable across multiple agent calls.
   *
   * For larger inboxes where the desired message isn't in the top 100
   * rows, we'd need real Outlook search; that's a Phase 7+ enhancement.
   */
  async searchInbox(args: SearchInboxArgs): Promise<SearchInboxResult> {
    const top = typeof args.top === 'number' && args.top > 0 ? args.top : 25;
    // Pull a generous slice of recent rows. The cap below trims to args.top
    // post-filter, but we need to read *more* than top to filter usefully.
    const fetchN = Math.min(Math.max(top * 4, 50), 200);
    const inbox = await this.readInbox(fetchN);
    if (inbox.status === 'needs_signin') {
      return { status: 'needs_signin', messages: [], message: inbox.message };
    }
    const filtered = inbox.messages.filter((m) => matchesSearchArgs(m, args));
    const capped = filtered.length > top;
    return {
      status: 'ok',
      messages: filtered.slice(0, top),
      capped,
    };
  }

  /**
   * Open a specific message and extract its full body + recipients +
   * attachments. id is the InboxMessage.id from read_inbox/search_inbox
   * (sender|subject|received fingerprint).
   */
  async readEmail(args: ReadEmailArgs): Promise<ReadEmailResult> {
    const page = await this.driver.ensureOutlookTab();
    if (await this.looksLikeSignin(page)) {
      return {
        status: 'needs_signin',
        id: args.id,
        message: 'Outlook is on the sign-in page. Sign in in Chrome and retry.',
      };
    }

    const opened = await this.openMessageById(page, args.id);
    if (!opened) {
      return {
        status: 'not_found',
        id: args.id,
        message: `Could not locate message with id "${args.id}". Re-call read_inbox first.`,
      };
    }

    // The message reading pane uses role="region" with an aria-label of
    // "Message body" or "Reading pane". We pull innerText, which gives us
    // a clean text-only view.
    await page
      .waitForSelector(
        '[aria-label="Message body" i], [role="region"][aria-label*="reading pane" i], [aria-label*="message preview" i]',
        { timeout: 10_000 },
      )
      .catch(() => null);

    const detail = await page.evaluate(`
      (() => {
        const out = { subject: '', sender: '', receivedAt: '', body: '', recipients: { to: [], cc: [] }, attachments: [] };
        const subjEl = document.querySelector('[role="heading"][aria-level="2"], [class*="subject"][role="heading"], h2, h1');
        if (subjEl) out.subject = (subjEl.textContent || '').trim().slice(0, 300);
        const senderEl = document.querySelector('[role="button"][aria-label*="@"], [aria-label*="From "]');
        if (senderEl) {
          const al = senderEl.getAttribute('aria-label') || senderEl.textContent || '';
          out.sender = al.replace(/^From\\s*/i, '').trim().slice(0, 200);
        }
        const timeEl = document.querySelector('time, [class*="receivedTime"]');
        if (timeEl) out.receivedAt = (timeEl.getAttribute('datetime') || timeEl.textContent || '').trim().slice(0, 80);
        const body = document.querySelector('[aria-label="Message body" i], [role="region"][aria-label*="reading pane" i]');
        if (body) out.body = (body.innerText || body.textContent || '').trim().slice(0, 12000);
        // Attachments: Outlook renders them as buttons/divs with role="button" and aria-label like "Attached file: Foo.pdf, 12 KB".
        const atts = document.querySelectorAll('[aria-label^="Attached file" i], [aria-label^="Attachment" i]');
        for (const a of Array.from(atts).slice(0, 30)) {
          const label = a.getAttribute('aria-label') || '';
          const m = label.match(/(?:Attached file|Attachment)[:\\s]+(.+?)(?:,\\s*([\\d.]+\\s*[KMG]?B))?(?:,|$)/i);
          if (m) {
            const filename = (m[1] || '').trim();
            const size = m[2] ? parseSize(m[2]) : undefined;
            out.attachments.push({ filename: filename, sizeBytes: size, mimeType: guessMime(filename) });
          }
        }
        function parseSize(s) {
          const n = parseFloat(s);
          if (!isFinite(n)) return undefined;
          const u = (s.match(/[KMG]?B/i) || [''])[0].toUpperCase();
          const mult = u === 'KB' ? 1024 : u === 'MB' ? 1048576 : u === 'GB' ? 1073741824 : 1;
          return Math.round(n * mult);
        }
        function guessMime(fn) {
          const ext = (fn.toLowerCase().match(/\\.[a-z0-9]+$/) || [''])[0];
          const map = { '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.zip': 'application/zip' };
          return map[ext] || undefined;
        }
        return out;
      })()
    `) as {
      subject: string;
      sender: string;
      receivedAt: string;
      body: string;
      recipients: { to: string[]; cc: string[] };
      attachments: EmailAttachmentInfo[];
    };

    return {
      status: 'ok',
      id: args.id,
      subject: detail.subject || undefined,
      sender: detail.sender || undefined,
      receivedAt: detail.receivedAt || undefined,
      body: detail.body || undefined,
      recipients: detail.recipients,
      attachments: detail.attachments,
    };
  }

  /**
   * Reply (or reply-all) to a specific message. Opens the reply pane in the
   * Outlook compose UI, fills the body, leaves the draft open. Outlook
   * pre-fills To/Cc/Subject for us.
   */
  async reply(args: ReplyArgs): Promise<ReplyResult> {
    const page = await this.driver.ensureOutlookTab();
    if (await this.looksLikeSignin(page)) {
      return {
        status: 'needs_signin',
        draftLeftOpen: false,
        message: 'Outlook is on the sign-in page. Sign in in Chrome and retry.',
      };
    }

    const opened = await this.openMessageById(page, args.id);
    if (!opened) {
      return {
        status: 'not_found',
        draftLeftOpen: false,
        message: `Could not locate message with id "${args.id}".`,
      };
    }

    // Click Reply / Reply All on the open message.
    const targetName = args.replyAll ? /^reply all$/i : /^reply$/i;
    await this.dismissBlockingDialog(page);
    await this.clickByRoleOrVlm(page, {
      role: 'button',
      nameRegex: targetName,
      vlmQuestion: args.replyAll
        ? 'The "Reply all" button on the open Outlook message reading pane toolbar.'
        : 'The "Reply" button on the open Outlook message reading pane toolbar.',
    });
    await this.waitForComposePane(page);
    await this.fillBody(page, args.body);

    const previewSubject = (await this.readOpenSubject(page)) || '';
    return {
      status: 'drafted',
      draftLeftOpen: true,
      preview: { to: [], subject: previewSubject, body: args.body },
      message: 'Reply draft prepared and left open in Outlook for your review.',
    };
  }

  async forward(args: ForwardArgs): Promise<ForwardResult> {
    const page = await this.driver.ensureOutlookTab();
    if (await this.looksLikeSignin(page)) {
      return {
        status: 'needs_signin',
        draftLeftOpen: false,
        message: 'Outlook is on the sign-in page. Sign in in Chrome and retry.',
      };
    }
    const opened = await this.openMessageById(page, args.id);
    if (!opened) {
      return { status: 'not_found', draftLeftOpen: false, message: `Could not locate message with id "${args.id}".` };
    }

    await this.dismissBlockingDialog(page);
    await this.clickByRoleOrVlm(page, {
      role: 'button',
      nameRegex: /^forward$/i,
      vlmQuestion: 'The "Forward" button on the open Outlook message reading pane toolbar.',
    });
    await this.waitForComposePane(page);

    const toList = asArray(args.to);
    if (toList.length === 0) {
      return {
        status: 'drafted',
        draftLeftOpen: true,
        preview: { to: [], subject: (await this.readOpenSubject(page)) || '', body: args.body ?? '' },
        message: 'Forward pane opened but no recipient supplied; fill it manually before sending.',
      };
    }
    await this.fillField(page, 'To', toList.join('; '));
    if (args.body) await this.fillBody(page, args.body);

    return {
      status: 'drafted',
      draftLeftOpen: true,
      preview: { to: toList, subject: (await this.readOpenSubject(page)) || '', body: args.body ?? '' },
      message: 'Forward draft prepared and left open in Outlook for your review.',
    };
  }

  /** Toggle a message's unread state. */
  async markRead(args: MarkReadArgs): Promise<MarkReadResult> {
    const page = await this.driver.ensureOutlookTab();
    if (await this.looksLikeSignin(page)) {
      return { status: 'needs_signin', message: 'Outlook is on the sign-in page. Sign in in Chrome and retry.' };
    }
    const opened = await this.openMessageById(page, args.id);
    if (!opened) return { status: 'not_found', message: `Could not locate message with id "${args.id}".` };

    // Right-click on the row would be more reliable but harder to drive
    // cross-theme. Use Outlook's keyboard shortcut: Q = mark read, U = mark unread.
    // (See https://support.microsoft.com/en-us/office/keyboard-shortcuts-for-outlook-on-the-web)
    await this.driver.pressKey(args.read ? 'q' : 'u');
    await this.driver.sleep(400);
    return { status: 'ok', message: args.read ? 'Marked as read.' : 'Marked as unread.' };
  }

  async listAttachments(args: ListAttachmentsArgs): Promise<ListAttachmentsResult> {
    const detail = await this.readEmail({ id: args.id });
    if (detail.status !== 'ok') {
      return {
        status: detail.status,
        id: args.id,
        attachments: [],
        message: detail.message,
      };
    }
    return {
      status: 'ok',
      id: args.id,
      attachments: detail.attachments ?? [],
    };
  }

  /**
   * Download a specific attachment from a message. HARD-GATED: refuses
   * unless `confirm: true` is set. Mirrors the send_email guard — the
   * agent must surface a confirmation to the principal first.
   *
   * Implementation:
   *   1. Open the message via openMessageById.
   *   2. Verify the requested filename exists on the message (defense
   *      against the agent passing a stale/wrong filename — refuse with
   *      reason='not_found' rather than blindly downloading whatever
   *      Outlook hands back).
   *   3. Use Playwright's page.waitForEvent('download') pattern to
   *      intercept the file save. We let Playwright save it to its
   *      default download dir; the saved path is what we return.
   *   4. Trigger the click on the attachment chip. Outlook usually
   *      offers a "Download" submenu; we try the explicit Download
   *      button first, fall back to the chip's main click which most
   *      themes treat as download.
   */
  async downloadAttachment(args: DownloadAttachmentArgs): Promise<DownloadAttachmentResult> {
    if (args.confirm !== true) {
      return {
        status: 'refused',
        filename: args.filename,
        reason: 'Download blocked: confirm flag not set. Show the principal what attachment will be downloaded and re-call with confirm=true after they say yes.',
      };
    }

    const page = await this.driver.ensureOutlookTab();
    if (await this.looksLikeSignin(page)) {
      return {
        status: 'needs_signin',
        filename: args.filename,
        message: 'Outlook is on the sign-in page. Sign in in Chrome and retry.',
      };
    }

    const opened = await this.openMessageById(page, args.id);
    if (!opened) {
      return {
        status: 'not_found',
        filename: args.filename,
        reason: `Could not locate message with id "${args.id}".`,
      };
    }

    // Verify the attachment exists on the open message before triggering
    // any download. Outlook's attachment chip aria-label is the same
    // format readEmail's parser uses, so we can grep visible attachments
    // by filename.
    const attachmentExists = await page.evaluate(`
      (() => {
        const wantedFilename = ${JSON.stringify(args.filename)};
        const atts = document.querySelectorAll('[aria-label^="Attached file" i], [aria-label^="Attachment" i]');
        for (const a of Array.from(atts)) {
          const label = a.getAttribute('aria-label') || '';
          if (label.toLowerCase().includes(wantedFilename.toLowerCase())) return true;
        }
        return false;
      })()
    `);
    if (!attachmentExists) {
      return {
        status: 'not_found',
        filename: args.filename,
        reason: `Attachment "${args.filename}" not found on this message. Call list_attachments first.`,
      };
    }

    // Set up the download listener BEFORE the click so we don't miss it.
    // Playwright's waitForEvent('download') resolves when the browser
    // initiates a download.
    const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });

    // Click the attachment chip. Try Download submenu first, then chip itself.
    const downloadTarget = page.getByRole('menuitem', { name: /^download$/i }).first();
    const chip = page.locator(`[aria-label*="${args.filename.replace(/"/g, '\\"')}" i]`).first();

    // Open chip's context menu via a right-click (Outlook adds a menu),
    // then click "Download".
    try {
      if ((await chip.count()) > 0) {
        await chip.click({ timeout: 5_000, button: 'right' }).catch(() => null);
        await this.driver.sleep(300);
        if ((await downloadTarget.count()) > 0) {
          await downloadTarget.click({ timeout: 5_000 });
        } else {
          // Fall back to a plain click on the chip — many themes treat
          // single-click on the chip as "open preview" but download is
          // accessible via a small download icon adjacent to the chip.
          await chip.click({ timeout: 5_000 });
        }
      }
    } catch (err) {
      logger.warn?.(
        `[outlook-v2] downloadAttachment click chain failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Wait for the download to land.
    let download;
    try {
      download = await downloadPromise;
    } catch {
      return {
        status: 'refused',
        filename: args.filename,
        reason: 'Download did not start within 30s. The attachment chip may not have surfaced a download action; ask the principal to download it manually.',
      };
    }

    // Save to Playwright's default download path (set by the browser
    // context). We don't control where this lives — it's typically
    // under <user data dir>/Downloads or the system Downloads folder.
    const savedPath = await download.path().catch(() => undefined);
    return {
      status: 'downloaded',
      filename: args.filename,
      savedPath: savedPath ?? undefined,
      message: savedPath
        ? `Downloaded to ${savedPath}.`
        : 'Download completed but the path was not retrievable from the driver.',
    };
  }

  // ── internals ───────────────────────────────────────────────────────────

  /**
   * Find and click the inbox row whose readInbox-id matches `id`. Returns
   * true on success; false if no row matches (caller surfaces 'not_found').
   *
   * The id format is sender|subject|received from the parser, so we walk
   * each row's text-node fingerprint and match. Then we click. Outlook
   * loads the message into the reading pane synchronously enough that
   * subsequent waitForSelector for the body works ~immediately.
   */
  private async openMessageById(page: Page, id: string): Promise<boolean> {
    const targetIdx = await page.evaluate(`
      (() => {
        const wantedId = ${JSON.stringify(id)};
        const isDateLike = function(s) {
          if (!s) return false;
          if (s.length > 30) return false;
          if (/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun|Yesterday|Today|Tomorrow)\\b/i.test(s)) return true;
          if (/^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\\b/i.test(s)) return true;
          if (/^\\d{1,2}[:\\/]\\d/.test(s)) return true;
          return false;
        };
        const fingerprint = function(el) {
          const texts = [];
          const walk = function(n) {
            if (n.nodeType === 3) {
              const t = (n.textContent || '').trim();
              if (t) texts.push(t);
            } else if (n.nodeType === 1) {
              for (const c of Array.from(n.childNodes)) walk(c);
            }
          };
          walk(el);
          let sender = '', subject = '', receivedAt = '';
          let phase = 'sender';
          for (const t of texts) {
            if (t.length < 3 && phase !== 'snippet') continue;
            if (phase === 'sender') { sender = t; phase = 'subject'; continue; }
            if (phase === 'subject') {
              if (isDateLike(t)) { receivedAt = t; phase = 'snippet'; continue; }
              subject = subject ? subject + ' ' + t : t;
              continue;
            }
          }
          return (sender + '|' + subject + '|' + receivedAt).slice(0, 96);
        };
        const els = Array.from(document.querySelectorAll('[role="option"][aria-label], [role="row"][aria-label]'));
        for (let i = 0; i < els.length; i++) {
          const fp = fingerprint(els[i]);
          if (fp === wantedId) return i;
        }
        return -1;
      })()
    `) as number;
    if (targetIdx < 0) return false;
    const rowLocator = page.locator('[role="option"][aria-label], [role="row"][aria-label]').nth(targetIdx);
    try {
      await rowLocator.click({ timeout: 8_000 });
    } catch (err) {
      logger.warn?.(
        `[outlook-v2] openMessageById click failed for id "${id}": ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
    return true;
  }

  /**
   * Dismiss any open Outlook welcome/promo dialog whose backdrop blocks
   * pointer events. Best-effort — failures here are normal (no dialog).
   */
  private async dismissBlockingDialog(page: Page): Promise<void> {
    // Quick check: is there a backdrop visible at all? Skip the work if not.
    const backdropCount = await page
      .locator('.fui-DialogSurface__backdrop, [data-tid="dialog-backdrop"]')
      .count()
      .catch(() => 0);
    if (backdropCount === 0) return;

    // Try named close affordances in order. Each gets a short timeout so
    // we don't burn 30s if none exist.
    // Order matters: prefer affordances that close-or-continue the dialog
    // (Continue, Got it, OK) before generic Close, because some Outlook
    // privacy/welcome dialogs don't have a Close X — only a primary action.
    const candidates = [
      page.getByRole('button', { name: /^continue$/i }),
      page.getByRole('button', { name: /^got it$/i }),
      page.getByRole('button', { name: /^ok$/i }),
      page.getByRole('button', { name: /^accept$/i }),
      page.getByRole('button', { name: /^close$/i }),
      page.getByRole('button', { name: /^skip( for now)?$/i }),
      page.getByRole('button', { name: /^maybe later$/i }),
      page.getByRole('button', { name: /^no thanks$/i }),
      page.getByRole('button', { name: /^dismiss$/i }),
      page.locator('button[aria-label="Close"]'),
    ];
    for (const c of candidates) {
      try {
        const first = c.first();
        if ((await first.count()) > 0) {
          await first.click({ timeout: 3_000 });
          // Tiny pause so the backdrop fade-out completes before next click.
          await this.driver.sleep(400);
          return;
        }
      } catch {
        // try next
      }
    }
    // Final fallback: press Escape, which closes most Fluent dialogs.
    try { await this.driver.pressKey('Escape'); await this.driver.sleep(300); } catch { /* ignore */ }
  }

  private async looksLikeSignin(page: Page): Promise<boolean> {
    const url = page.url();
    if (/login\.microsoftonline\.com/.test(url) || /login\.live\.com/.test(url)) {
      return true;
    }
    // Fallback: check for the sign-in heading via accessibility.
    const headings = await page
      .getByRole('heading')
      .allTextContents()
      .catch(() => [] as string[]);
    return headings.some((h) => /sign in|pick an account|enter password/i.test(h));
  }

  /**
   * Try a Playwright semantic locator first; on miss, ground via VLM and
   * click the bbox centre. The VLM fallback is the slow + paid path so we
   * only take it when the cheap path actually misses.
   */
  private async clickByRoleOrVlm(
    page: Page,
    opts: { role: 'button' | 'link' | 'menuitem'; nameRegex: RegExp; vlmQuestion: string },
  ): Promise<void> {
    if (await this.tryClickByRoleOrDom(page, opts)) {
      return;
    }

    // VLM fallback.
    const shot = await this.driver.screenshotViewport();
    const result = await this.grounder.ground({
      screenshotPng: shot.png,
      imageWidth: shot.width,
      imageHeight: shot.height,
      question: opts.vlmQuestion,
    });
    if (!result.found || !result.bbox || result.confidence < 0.5) {
      throw new Error(
        `Could not find target (semantic locator missed and VLM grounding ${
          result.found ? 'low-confidence' : 'failed'
        }): ${opts.vlmQuestion}`,
      );
    }
    const centre = bboxCentre(result.bbox);
    await this.driver.clickAt(centre.x, centre.y);
  }

  private async clickNewMail(page: Page): Promise<void> {
    const opts = {
      role: 'button' as const,
      nameRegex: /\bnew\s+(mail|message)\b/i,
      vlmQuestion:
        'The "New mail" or "New message" button that opens a blank compose pane. It is usually near the top-left of the Outlook inbox toolbar.',
    };
    if (await this.tryClickByRoleOrDom(page, opts)) {
      return;
    }

    // Outlook hides New mail when the reading pane has an existing draft in
    // focus. Switching the ribbon back to Home reveals the same button without
    // discarding or modifying that draft.
    if (await this.clickHomeRibbonTab(page)) {
      await page.waitForTimeout(250);
      if (await this.tryClickByRoleOrDom(page, opts)) {
        return;
      }
    }

    if (await this.resetComposeSurfaceToInbox(page)) {
      if (await this.tryClickByRoleOrDom(page, opts)) {
        return;
      }
    }

    await this.clickByRoleOrVlm(page, opts);
  }

  private async resetComposeSurfaceToInbox(page: Page): Promise<boolean> {
    const state = await page.evaluate(readOutlookDomState).catch(() => ({
      hasNewMailControl: false,
      hasOpenComposeSurface: false,
    }));
    if (state.hasNewMailControl || !state.hasOpenComposeSurface) {
      return false;
    }

    logger.info('[outlook-v2] New mail hidden behind compose surface; resetting Outlook tab to inbox');
    await page.goto('https://outlook.office.com/mail/inbox', {
      timeout: 30_000,
      waitUntil: 'domcontentloaded',
    });
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
    await page.waitForSelector(
      [
        'div[role="listbox"]',
        '[role="region"][aria-label*="Message list" i]',
        '[aria-label*="Inbox" i]',
        'button[aria-label*="New mail" i]',
        '[role="button"][aria-label*="New mail" i]',
        'button[aria-label*="New message" i]',
        '[role="button"][aria-label*="New message" i]',
      ].join(','),
      { timeout: 15_000 },
    ).catch(() => undefined);
    return true;
  }

  private async clickHomeRibbonTab(page: Page): Promise<boolean> {
    const candidates = [
      page.getByRole('tab', { name: /^home$/i }).first(),
      page.locator('button[role="tab"]').filter({ hasText: /^Home$/i }).first(),
      page.locator('[role="tab"]').filter({ hasText: /^Home$/i }).first(),
    ];
    for (const candidate of candidates) {
      try {
        if ((await candidate.count()) > 0) {
          await candidate.click({ timeout: 5_000 });
          return true;
        }
      } catch {
        // Try the next candidate.
      }
    }
    return false;
  }

  private async tryClickByRoleOrDom(
    page: Page,
    opts: { role: 'button' | 'link' | 'menuitem'; nameRegex: RegExp; vlmQuestion: string },
  ): Promise<boolean> {
    const locator = page.getByRole(opts.role, { name: opts.nameRegex }).first();
    try {
      const count = await locator.count();
      if (count > 0) {
        await locator.click({ timeout: 8_000 });
        return true;
      }
    } catch (err) {
      logger.debug?.(
        `[outlook-v2] semantic click missed, falling back to VLM: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (await this.clickByDomAccessibleName(page, opts)) {
      return true;
    }
    return false;
  }

  private async clickByDomAccessibleName(
    page: Page,
    opts: { role: 'button' | 'link' | 'menuitem'; nameRegex: RegExp; vlmQuestion: string },
  ): Promise<boolean> {
    const selector = opts.role === 'button'
      ? [
        'button',
        '[role="button"]',
        '[role="menuitem"]',
        'a[role="button"]',
        '[aria-label]',
        '[title]',
        '[data-automation-id]',
        '[data-automationid]',
      ].join(',')
      : opts.role === 'link'
        ? 'a,[role="link"]'
        : '[role="menuitem"],button,[role="button"]';
    const index = await page.evaluate(
      ({ selector: selectorText, source, ignoreCase }) => {
        const re = new RegExp(source, ignoreCase ? 'i' : '');
        const isVisible = (el: Element) => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return rect.width > 0
            && rect.height > 0
            && style.visibility !== 'hidden'
            && style.display !== 'none';
        };
        const elements = Array.from(document.querySelectorAll(selectorText));
        for (let i = 0; i < elements.length; i += 1) {
          const el = elements[i];
          if (!isVisible(el)) continue;
          const label = [
            el.getAttribute('aria-label'),
            el.getAttribute('title'),
            el.getAttribute('data-automation-id'),
            el.getAttribute('data-automationid'),
            el.textContent,
          ]
            .filter(Boolean)
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
          if (label && re.test(label)) return i;
        }
        return -1;
      },
      { selector, source: opts.nameRegex.source, ignoreCase: opts.nameRegex.ignoreCase },
    ).catch(() => -1);
    if (index < 0) return false;
    try {
      await page.locator(selector).nth(index).click({ timeout: 8_000 });
      return true;
    } catch (err) {
      logger.debug?.(
        `[outlook-v2] DOM accessible-name click missed, falling back to VLM: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return false;
    }
  }

  private async waitForComposePane(page: Page): Promise<void> {
    // The compose pane uses role="dialog" or aria-label="Message body".
    await page.waitForSelector(
      'div[role="dialog"], [aria-label="Message body"], [aria-label*="Compose" i]',
      { timeout: 15_000 },
    );
  }

  private async fillField(page: Page, label: 'To' | 'Cc' | 'Bcc' | 'Subject', value: string): Promise<void> {
    // Compose pane fields are usually inputs or contenteditables labelled by
    // aria-label. This is stable in Outlook.
    const candidates = [
      page.getByLabel(label, { exact: true }),
      page.locator(`[aria-label="${label}"]`),
      page.locator(`[aria-label*="${label}" i]`),
      page.locator(`[placeholder="${label}"]`),
      page.locator(`[placeholder*="${label}" i]`),
      page.locator(`[placeholder="Add a ${label.toLowerCase()}"]`),
      page.locator(`[role="textbox"][aria-label*="${label}" i]`),
      page.locator(`[contenteditable="true"][aria-label*="${label}" i]`),
    ];
    for (const c of candidates) {
      try {
        if ((await c.count()) > 0) {
          await c.first().click({ timeout: 5_000 });
          await c.first().fill(value);
          return;
        }
      } catch {
        // try next
      }
    }
    // VLM fallback for the field itself.
    const shot = await this.driver.screenshotViewport();
    const r = await this.grounder.ground({
      screenshotPng: shot.png,
      imageWidth: shot.width,
      imageHeight: shot.height,
      question: `The "${label}" input field in the open Outlook compose pane.`,
    });
    if (!r.found || !r.bbox || r.confidence < 0.5) {
      throw new Error(`Could not locate field "${label}" via semantic locator or VLM`);
    }
    const c = bboxCentre(r.bbox);
    await this.driver.clickAt(c.x, c.y);
    await this.driver.typeText(value);
  }

  private async fillBody(page: Page, body: string): Promise<void> {
    const candidates = [
      page.getByLabel('Message body', { exact: true }),
      page.locator('[aria-label="Message body"]'),
      page.locator('[aria-label*="Message body" i]'),
      page.locator('[role="textbox"][aria-label*="body" i]'),
      page.locator('[contenteditable="true"][aria-label*="body" i]'),
      page.locator('[contenteditable="true"][role="textbox"]'),
    ];
    for (const c of candidates) {
      try {
        if ((await c.count()) > 0) {
          await c.first().click({ timeout: 5_000 });
          // contenteditable bodies don't always accept .fill — type instead.
          await this.driver.typeText(body);
          return;
        }
      } catch {
        // try next
      }
    }
    // VLM fallback.
    const shot = await this.driver.screenshotViewport();
    const r = await this.grounder.ground({
      screenshotPng: shot.png,
      imageWidth: shot.width,
      imageHeight: shot.height,
      question: 'The large message body editor in the open Outlook compose pane (where the email content goes).',
    });
    if (!r.found || !r.bbox) {
      throw new Error('Could not locate the message body editor');
    }
    const c = bboxCentre(r.bbox);
    await this.driver.clickAt(c.x, c.y);
    await this.driver.typeText(body);
  }

  private async revealCcBcc(page: Page, which: 'Cc' | 'Bcc'): Promise<void> {
    // If the field is already labelled visible, no-op.
    const direct = page.locator(`[aria-label="${which}"]`);
    if ((await direct.count().catch(() => 0)) > 0) return;

    const triggers = [
      page.getByRole('button', { name: new RegExp(`^${which}$`, 'i') }),
      page.getByRole('button', { name: new RegExp(`^show ${which}$`, 'i') }),
    ];
    for (const t of triggers) {
      try {
        if ((await t.count()) > 0) {
          await t.first().click({ timeout: 4_000 });
          return;
        }
      } catch {
        // ignore, try next
      }
    }
    // It's normal for Outlook to show Cc by default in some themes. If we
    // can't find the trigger, the field may already be visible; the
    // subsequent fillField will surface the real problem if not.
  }

  private async readOpenSubject(page: Page): Promise<string | null> {
    const candidates = [
      page.getByLabel('Subject', { exact: true }),
      page.locator('[aria-label="Subject"]'),
      page.locator('[placeholder="Add a subject"]'),
    ];
    for (const c of candidates) {
      try {
        if ((await c.count()) > 0) {
          // Inputs use .inputValue, contenteditable uses .innerText. Try
          // both; whichever returns a non-empty string is what we use.
          const value = await c.first().inputValue().catch(() => '');
          if (value && value.length > 0) return value;
          const text = await c.first().innerText().catch(() => '');
          if (text && text.length > 0) return text;
        }
      } catch {
        // ignore
      }
    }
    return null;
  }
}
