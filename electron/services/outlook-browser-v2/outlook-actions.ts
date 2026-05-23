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
import type {
  OutlookOpenResult,
  ReadInboxResult,
  InboxMessage,
  DraftEmailArgs,
  DraftEmailResult,
  SendEmailArgs,
  SendEmailResult,
} from './types';

const OUTLOOK_INBOX_URL = 'https://outlook.office.com/mail/';

function asArray(v: string | string[] | undefined): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return [v];
}

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

    // Pull message rows via Playwright's accessibility API. This sidesteps
    // brittle DOM selectors entirely; ARIA roles are how screen readers see
    // the inbox, so they tend to outlive theme/UI rotations.
    interface RawRow { id: string; subject: string; sender: string; snippet: string; received: string; unread: boolean }
    const rows: RawRow[] = await page.evaluate((max: number) => {
      const out: RawRow[] = [];
      const seen = new Set<string>();
      const candidates = document.querySelectorAll(
        '[role="option"][aria-label], [role="row"][aria-label]',
      );
      for (const el of Array.from(candidates)) {
        const label = el.getAttribute('aria-label') ?? '';
        if (!label || seen.has(label) || out.length >= max) continue;
        seen.add(label);

        // Outlook's aria-label format (subject to drift, which is fine —
        // we just need *some* split):
        // "Sender, Subject, Preview, Received date, …, Unread"
        const parts = label.split(/,\s+/);
        const sender = parts[0] ?? '';
        const subject = parts[1] ?? '';
        const snippet = parts[2] ?? '';
        const received = parts.slice(3).join(', ').replace(/,?\s*Unread\.?\s*$/i, '');
        const unread = /unread\b/i.test(label);
        // id: hash-ish stable from aria-label so re-reads match.
        const id = label.slice(0, 64);
        out.push({ id, sender, subject, snippet, received, unread });
      }
      return out;
    }, top);

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
    await this.clickByRoleOrVlm(page, {
      role: 'button',
      nameRegex: /^new (mail|message)$/i,
      vlmQuestion:
        'The "New mail" or "New message" button that opens a blank compose pane. It is usually near the top-left of the Outlook inbox toolbar.',
    });

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

  // ── internals ───────────────────────────────────────────────────────────

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
    const locator = page.getByRole(opts.role, { name: opts.nameRegex }).first();
    try {
      const count = await locator.count();
      if (count > 0) {
        await locator.click({ timeout: 8_000 });
        return;
      }
    } catch (err) {
      logger.debug?.(
        `[outlook-v2] semantic click missed, falling back to VLM: ${err instanceof Error ? err.message : String(err)}`,
      );
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
      page.locator(`[placeholder="${label}"]`),
      page.locator(`[placeholder="Add a ${label.toLowerCase()}"]`),
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
      page.locator('[role="textbox"][aria-label*="body" i]'),
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
