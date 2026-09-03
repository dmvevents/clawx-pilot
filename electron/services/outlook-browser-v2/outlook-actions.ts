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
 * the already-open compose pane the user just confirmed, verifies the
 * recipients/subject/body in that pane, then clicks Send inside the matching
 * pane. If the pane is gone or drifted, it refuses instead of clicking Send
 * blindly. This closes the wrong-email-sent risk identified in
 * /tmp/outlook-deep-audit.md (C1, C2).
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

type OpenDraftSnapshot = {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  searchableText: string;
};

type ExpectedDraftForSend = {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
};

type CurrentReviewedDraftForSend = {
  mode: 'current-reviewed';
  to?: string[];
  cc?: string[];
  bcc?: string[];
};

type DraftSendProbeInput = ExpectedDraftForSend | CurrentReviewedDraftForSend | null;

type OpenDraftDomProbe = {
  snapshot: OpenDraftSnapshot | null;
  clickedSend: boolean;
  draftCount: number;
  sendableDraftCount: number;
  error?: string;
};

type SendFinalStateProbe = {
  ok: boolean;
  reason?: string;
};

type VisibleInboxRow = {
  id: string;
  sender: string;
  subject: string;
  snippet: string;
  received: string;
  unread: boolean;
};

// Predicate moved to ./search-helpers.ts for unit testing without Playwright.
const matchesSearchArgs = matchesSearchArgsForTests;

function normalizeComparableText(value: string | undefined): string {
  return (value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSearchText(value: string | undefined): string {
  return normalizeComparableText(value).toLowerCase();
}

function isOutlookMailHost(hostname: string): boolean {
  return /^(?:outlook\.office\.com|outlook\.cloud\.microsoft|outlook\.office365\.com|outlook\.live\.com)$/i.test(
    hostname,
  );
}

function isOutlookInboxUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (!isOutlookMailHost(url.hostname)) return false;
    const segments = url.pathname
      .toLowerCase()
      .split('/')
      .filter(Boolean);
    return segments[0] === 'mail' && segments.includes('inbox');
  } catch {
    return false;
  }
}

function expectedRecipientNeedles(values: string[]): string[] {
  return values
    .map((value) => {
      const email = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
      return normalizeSearchText(email ?? value);
    })
    .filter(Boolean);
}

function recipientEmails(values: string[]): string[] {
  return values
    .flatMap((value) => value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [])
    .map((value) => normalizeSearchText(value))
    .filter(Boolean);
}

function canonicalRecipientEmails(values: string[]): string[] {
  return Array.from(new Set(recipientEmails(values)));
}

function recipientInputError(field: 'To' | 'Cc' | 'Bcc', values: string[]): string | null {
  const nonEmptyValues = values.map(normalizeComparableText).filter(Boolean);
  if (nonEmptyValues.length === 0) {
    return `${field} recipient is empty.`;
  }
  const invalid = nonEmptyValues.filter((value) => canonicalRecipientEmails([value]).length === 0);
  if (invalid.length > 0) {
    return `${field} recipient must include an email address. Ask for or use a known email address before drafting.`;
  }
  const prose = nonEmptyValues.filter((value) => {
    const emails = canonicalRecipientEmails([value]);
    if (emails.length !== 1) return true;
    const withoutEmail = normalizeComparableText(value.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, ''));
    return withoutEmail.length > 0;
  });
  if (prose.length > 0) {
    return `${field} recipient must be only an email address, not message text.`;
  }
  return null;
}

function recipientInputBucketError(args: {
  to?: string[];
  cc?: string[];
  bcc?: string[];
}, options: { requireTo?: boolean } = {}): string | null {
  if (options.requireTo || args.to !== undefined) {
    const error = recipientInputError('To', args.to ?? []);
    if (error) return error;
  }
  if (args.cc !== undefined && args.cc.length > 0) {
    const error = recipientInputError('Cc', args.cc);
    if (error) return error;
  }
  if (args.bcc !== undefined && args.bcc.length > 0) {
    const error = recipientInputError('Bcc', args.bcc);
    if (error) return error;
  }
  return null;
}

function missingRecipientNeedles(values: string[], actualBucket: string[]): string[] {
  const searchable = normalizeSearchText(actualBucket.join(' '));
  return expectedRecipientNeedles(values).filter((needle) => !searchable.includes(needle));
}

function hasUnexpectedRecipient(values: string[], actualBucket: string[]): boolean {
  const expectedEmails = new Set(recipientEmails(values));
  if (expectedEmails.size === 0) {
    return actualBucket.some((value) => normalizeSearchText(value).length > 0);
  }
  return recipientEmails(actualBucket).some((email) => !expectedEmails.has(email));
}

function hasProvidedValue(value: string | string[] | undefined): boolean {
  return value !== undefined;
}

function hasExplicitRecipientAssertions(args: SendEmailArgs): boolean {
  return hasProvidedValue(args.to) || hasProvidedValue(args.cc) || hasProvidedValue(args.bcc);
}

function hasCompleteExactDraftAssertions(args: SendEmailArgs): args is SendEmailArgs & Required<Pick<SendEmailArgs, 'to' | 'subject' | 'body'>> {
  return asArray(args.to).map(normalizeComparableText).filter(Boolean).length > 0
    && Boolean(normalizeComparableText(args.subject))
    && Boolean(normalizeComparableText(args.body));
}

function validateConfirmedSendArgs(args: SendEmailArgs): string | null {
  if (hasProvidedValue(args.to)
    && asArray(args.to).map(normalizeComparableText).filter(Boolean).length === 0) {
    return 'Send blocked: supplied To recipient assertion is empty.';
  }
  const recipientError = recipientInputBucketError({
    to: hasProvidedValue(args.to) ? asArray(args.to) : undefined,
    cc: hasProvidedValue(args.cc) ? asArray(args.cc) : undefined,
    bcc: hasProvidedValue(args.bcc) ? asArray(args.bcc) : undefined,
  });
  if (recipientError) {
    return `Send blocked: supplied ${recipientError.charAt(0).toLowerCase()}${recipientError.slice(1)}`;
  }
  if (hasProvidedValue(args.subject) && !normalizeComparableText(args.subject)) {
    return 'Send blocked: supplied subject assertion is empty.';
  }
  if (hasProvidedValue(args.body) && !normalizeComparableText(args.body)) {
    return 'Send blocked: supplied body assertion is empty.';
  }
  return null;
}

function isInboxMessageCandidateRow(row: VisibleInboxRow): boolean {
  const sender = normalizeComparableText(row.sender);
  const subject = normalizeComparableText(row.subject);
  const id = normalizeComparableText(row.id);
  if (!sender || !subject) return false;
  return !(
    /^\[?draft\]?$/i.test(sender)
    || /^\[?draft\]?(?:\||$)/i.test(id)
    || /^\[draft\]/i.test(subject)
  );
}

export class OutlookActions {
  constructor(
    private readonly driver: PlaywrightDriver,
    private readonly grounder: VlmGrounder,
  ) {}

  private async prepareFunctionEvaluate(page: Page): Promise<void> {
    const evaluate = (page as unknown as { evaluate?: (script: string) => Promise<unknown> }).evaluate;
    if (typeof evaluate !== 'function') return;
    await evaluate.call(page, `
      (() => {
        if (typeof window.__name !== 'function') {
          Object.defineProperty(window, '__name', {
            configurable: true,
            writable: true,
            value: function(fn) { return fn; }
          });
        }
      })()
    `).catch(() => undefined);
  }

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
    if (!(await this.ensureInboxFolderOrSignin(page))) {
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
    const rowById = new Map<string, VisibleInboxRow>();
    let scrollPasses = 0;
    let lastCount = -1;
    let stalePasses = 0;
    let artifactSkippedCount = 0;
    const maxPasses = Math.min(Math.max(Math.ceil(top / 8) + 4, 1), 40);
    const extractionLimit = Math.max(top, Math.min(top + 12, 240));

    await this.resetInboxListScroll(page);
    for (let pass = 0; pass < maxPasses && rowById.size < top; pass += 1) {
      const rows = await this.extractVisibleInboxRows(page, extractionLimit);
      for (const row of rows) {
        if (!isInboxMessageCandidateRow(row)) {
          artifactSkippedCount += 1;
          continue;
        }
        if (!row.id || rowById.has(row.id)) continue;
        rowById.set(row.id, row);
        if (rowById.size >= top) break;
      }
      if (rowById.size >= top) break;

      stalePasses = rowById.size === lastCount ? stalePasses + 1 : 0;
      lastCount = rowById.size;
      if (stalePasses >= 2) break;

      const moved = await this.scrollInboxList(page);
      if (!moved) break;
      scrollPasses += 1;
      await this.driver.sleep(250);
    }

    const rows = Array.from(rowById.values()).slice(0, top);

    const messages: InboxMessage[] = rows.map((r) => ({
      id: r.id,
      subject: r.subject,
      sender: r.sender,
      snippet: r.snippet.slice(0, 120),
      receivedAt: r.received,
      unread: r.unread,
    }));

    return {
      status: 'ok',
      messages,
      scan: {
        scope: 'recent_inbox_window',
        requestedTop: top,
        scannedCount: messages.length,
        returnedCount: messages.length,
        scrollPasses,
        artifactSkippedCount,
        exhaustive: false,
        note:
          'Browser Outlook scan covers a bounded, scrolled recent Inbox window only; do not describe it as all mailbox mail.',
      },
    };
  }

  /**
   * Open a New Mail compose pane and fill in to/cc/bcc/subject/body.
   * Leaves the draft open in Outlook for user review.
   */
  async draftEmail(args: DraftEmailArgs): Promise<DraftEmailResult> {
    const rawTo = asArray(args.to);
    const rawCc = asArray(args.cc);
    const rawBcc = asArray(args.bcc);
    const subject = args.subject ?? '';
    const body = args.body ?? '';
    const recipientError = recipientInputBucketError({ to: rawTo, cc: rawCc, bcc: rawBcc }, { requireTo: true });
    const to = canonicalRecipientEmails(rawTo);
    const cc = canonicalRecipientEmails(rawCc);
    const bcc = canonicalRecipientEmails(rawBcc);
    if (recipientError) {
      return {
        status: 'failed',
        draftLeftOpen: false,
        preview: { to: rawTo, cc: rawCc, bcc: rawBcc, subject, body },
        message: `Draft was not created because ${recipientError}`,
      };
    }

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

    if (await this.hasAnyVisibleOpenDraft(page)) {
      return {
        status: 'failed',
        draftLeftOpen: true,
        preview: { to, cc, bcc, subject, body },
        message:
          'Outlook already has an open draft. Review, send, or close that draft before starting another email so ClawX does not create duplicate saved drafts.',
      };
    }

    // 1. Click New mail.
    await this.clickNewMail(page);

    // 2. Wait for a compose pane to appear before filling.
    await this.waitForComposePane(page);

    // 3. Fill recipient/subject/body. Outlook's compose pane uses standard
    // contenteditable + inputs; semantic locators are stable here.
    await this.fillField(page, 'To', to.join('; '));
    await this.commitRecipientField(page, 'To', to);
    if (cc.length > 0) {
      // Reveal Cc if it's hidden.
      await this.revealCcBcc(page, 'Cc');
      await this.fillField(page, 'Cc', cc.join('; '));
      await this.commitRecipientField(page, 'Cc', cc);
    }
    if (bcc.length > 0) {
      await this.revealCcBcc(page, 'Bcc');
      await this.fillField(page, 'Bcc', bcc.join('; '));
      await this.commitRecipientField(page, 'Bcc', bcc);
    }
    await this.fillField(page, 'Subject', subject);
    await this.fillBody(page, body);

    const draftProbe = await this.readOpenDraftProbe(page);
    const mismatch = draftProbe.snapshot
      ? this.describeDraftMismatch(draftProbe.snapshot, { to, cc, bcc, subject, body, confirm: true })
      : 'the new draft is not visible for review';
    if (draftProbe.draftCount !== 1 || draftProbe.sendableDraftCount !== 1 || mismatch) {
      return {
        status: 'failed',
        draftLeftOpen: draftProbe.draftCount > 0,
        preview: { to, cc, bcc, subject, body },
        message: mismatch
          ? `Draft was not marked ready because ${mismatch}. Review or close any saved Outlook draft before retrying.`
          : 'Draft was not marked ready because ClawX could not identify exactly one visible reviewed draft. Review or close any saved Outlook draft before retrying.',
      };
    }

    return {
      status: 'drafted',
      draftLeftOpen: true,
      preview: { to, cc, bcc, subject, body },
      message: 'Draft prepared and left open in Outlook for your review.',
    };
  }

  /**
   * Send the email. Hard refuses unless confirm=true. Crucially, does NOT
   * re-draft. It sends the single user-reviewed compose pane. If the caller
   * supplies recipients, subject, or body, those fields are treated as safety
   * assertions; recipient mismatches always refuse, while subject/body edits
   * are allowed after the user has reviewed the visible draft.
   */
  async sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
    if (args.confirm !== true) {
      return {
        status: 'refused',
        reason:
          'Send blocked: confirm flag not set. Show the draft to the principal and re-call with confirm=true after they say yes.',
      };
    }
    const invalidArgsReason = validateConfirmedSendArgs(args);
    if (invalidArgsReason) {
      return { status: 'refused', reason: invalidArgsReason };
    }

    const page = await this.driver.ensureOutlookTab();
    if (await this.looksLikeSignin(page)) {
      return {
        status: 'needs_signin',
        message: 'Outlook is on the sign-in page. Sign in in Chrome and retry.',
      };
    }

    let probe = await this.readOpenDraftProbe(page);
    let snapshot = probe.snapshot;
    if (snapshot == null || probe.draftCount === 0) {
      return {
        status: 'refused',
        reason:
          'No open draft found. Call draftEmail first and confirm with the user before retrying send.',
      };
    }

    let recipientMismatch = this.describeRecipientAssertionMismatch(snapshot, args);
    if (recipientMismatch) {
      // Outlook resolves typed addresses into recipient pills ASYNCHRONOUSLY
      // (visibly slower on a fresh profile with a cold contacts cache). A
      // single-shot DOM read races that resolution and refused a legitimate
      // confirmed send — the RAJ-1 false-positive class, reproduced live
      // 2026-09-02. Re-probe briefly before refusing: a genuine mismatch
      // stays mismatched across the window; a resolution race clears.
      for (let attempt = 0; attempt < 8 && recipientMismatch; attempt += 1) {
        await this.driver.sleep(600);
        probe = await this.readOpenDraftProbe(page);
        if (probe.snapshot == null || probe.draftCount === 0) break;
        snapshot = probe.snapshot;
        recipientMismatch = this.describeRecipientAssertionMismatch(snapshot, args);
      }
      if (!recipientMismatch) {
        logger.info('[outlook-v2] Recipient assertion settled after re-probe (async pill resolution)');
      }
    }
    if (recipientMismatch) {
      logger.warn(`[outlook-v2] Send refused: recipient assertion mismatch (${recipientMismatch})`);
      return {
        status: 'refused',
        reason: `Send blocked: ${recipientMismatch}. Re-draft and confirm the visible draft before retrying.`,
      };
    }

    let clicked: boolean;
    if (hasCompleteExactDraftAssertions(args)) {
      const mismatch = this.describeDraftMismatch(snapshot, args);
      if (!mismatch) {
        clicked = await this.clickSendInVerifiedDraft(page, args);
      } else if (/body/i.test(mismatch) && !/subject/i.test(mismatch)) {
        // BODY drift after review is the legitimate principal-edited-the-
        // draft case. SUBJECT drift is NOT sendable: the CLAUDE.md hard rule
        // makes subject-match the second send gate, and this branch used to
        // accept subject mismatches too — a gate FALSE-NEGATIVE that only
        // surfaced 2026-09-02 once the new-domain fixes made the send
        // pipeline actually complete (previously this path failed later in
        // verification, refusing by accident — the likely source of RAJ-1's
        // "draft subject has been changed" error text).
        logger.info(
          `[outlook-v2] Draft body edited after review (${mismatch}); attempting single visible draft send`,
        );
        clicked = await this.clickSendInCurrentReviewedDraft(page, args);
      } else {
        logger.warn(`[outlook-v2] Send refused: verified draft mismatch (${mismatch})`);
        return {
          status: 'refused',
          reason: `Send blocked: ${mismatch}. Re-draft and confirm the visible draft before retrying.`,
        };
      }
    } else {
      clicked = await this.clickSendInCurrentReviewedDraft(page, args);
    }

    if (!clicked) {
      const reason = probe.draftCount > 1 || probe.sendableDraftCount > 1
        ? 'Send blocked: multiple open drafts were detected. Close extra drafts, review the intended draft, and retry.'
        : 'Send blocked: could not identify exactly one complete reviewed draft with its own Send button. Re-draft and try again.';
      logger.warn(`[outlook-v2] Send refused: ${reason}`);
      return {
        status: 'refused',
        reason,
      };
    }

    const sendCompleted = await this.waitForSendCompletion(page);
    if (!sendCompleted) {
      const reason =
        'Send blocked: Outlook did not close the reviewed draft after clicking Send. The draft is still open or still in Drafts, so it was not reported as sent.';
      logger.warn(`[outlook-v2] Send completion verification failed: ${reason}`);
      return { status: 'refused', reason };
    }
    const finalState = await this.verifyPostSendState(page, snapshot);
    if (!finalState.ok) {
      const reason = finalState.reason
        ?? 'Send blocked: ClawX could not verify the reviewed draft left Drafts after clicking Send.';
      logger.warn(`[outlook-v2] Send final-state verification failed: ${reason}`);
      return { status: 'refused', reason };
    }

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
    const capped = filtered.length > top || inbox.messages.length >= fetchN;
    return {
      status: 'ok',
      messages: filtered.slice(0, top),
      capped,
      scan: {
        scope: 'recent_inbox_window',
        requestedTop: top,
        fetchedTop: fetchN,
        scannedCount: inbox.messages.length,
        matchedCount: filtered.length,
        returnedCount: Math.min(filtered.length, top),
        exhaustive: false,
        note:
          'Browser Outlook search filters a recent Inbox window; for all mail/month-wide audits, report the scan window and do not claim the mailbox is complete.',
      },
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
    if (!(await this.ensureInboxFolderOrSignin(page))) {
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
    if (!(await this.ensureInboxFolderOrSignin(page))) {
      return {
        status: 'needs_signin',
        draftLeftOpen: false,
        message: 'Outlook is on the sign-in page. Sign in in Chrome and retry.',
      };
    }

    await this.dismissBlockingDialog(page);
    const opened = await this.openMessageById(page, args.id);
    if (!opened) {
      return {
        status: 'not_found',
        draftLeftOpen: false,
        message:
          `Could not locate message with id "${args.id}" in the current Inbox window. No reply was drafted; the message may have moved to Archive, Sent, Drafts, or another folder. Open or search the intended message and retry.`,
      };
    }
    if (await this.hasAnyVisibleOpenDraft(page)) {
      return {
        status: 'not_found',
        draftLeftOpen: true,
        message:
          'Outlook already has an open draft. Review, send, or close it before replying so ClawX does not type the reply into the wrong draft.',
      };
    }

    // Open Reply / Reply All on the open message. Prefer Outlook's
    // keyboard shortcuts first because they are scoped to the selected
    // message and cannot accidentally click adjacent destructive toolbar
    // commands such as Archive/Delete. The safe toolbar/menu detector remains
    // as fallback for tenants where shortcuts are disabled or focus misses.
    const targetName = args.replyAll ? /^reply all$/i : /^reply$/i;
    await this.dismissBlockingDialog(page);
    const openedByShortcut = await this.openMessageComposeViaShortcut(page, args.replyAll ? 'replyAll' : 'reply');
    const clickedReply = openedByShortcut
      ? false
      : await this.clickOpenMessageToolbarButton(page, targetName);
    if (!openedByShortcut && !clickedReply) {
      return {
        status: 'not_found',
        draftLeftOpen: false,
        message: args.replyAll
          ? 'Could not safely identify the Reply all button on the open message.'
          : 'Could not safely identify the Reply button on the open message.',
      };
    }
    if (clickedReply) await this.waitForComposeBodyReady(page);
    await this.fillBody(page, args.body);

    const draftProbe = await this.readOpenDraftProbe(page);
    const draftBodyProblem = this.describeReplyDraftBodyProblem(draftProbe.snapshot, args.body);
    if (draftBodyProblem) {
      return {
        status: 'not_found',
        draftLeftOpen: true,
        message: draftBodyProblem,
      };
    }
    const previewSubject = draftProbe.snapshot?.subject || (await this.readOpenSubject(page)) || '';
    const previewTo = draftProbe.snapshot?.to ?? [];
    return {
      status: 'drafted',
      draftLeftOpen: true,
      preview: { to: previewTo, subject: previewSubject, body: args.body },
      message:
        'Reply draft prepared and left open in Outlook for your review. Outlook pre-filled the reply recipient; after review, send this open draft with outlook.send_email using { confirm: true } only.',
    };
  }

  async forward(args: ForwardArgs): Promise<ForwardResult> {
    const rawToList = asArray(args.to);
    const recipientError = recipientInputBucketError({ to: rawToList }, { requireTo: true });
    const toList = canonicalRecipientEmails(rawToList);
    if (recipientError) {
      return {
        status: 'not_found',
        draftLeftOpen: false,
        message: `Forward was not created because ${recipientError}`,
      };
    }

    const page = await this.driver.ensureOutlookTab();
    if (await this.looksLikeSignin(page)) {
      return {
        status: 'needs_signin',
        draftLeftOpen: false,
        message: 'Outlook is on the sign-in page. Sign in in Chrome and retry.',
      };
    }
    if (!(await this.ensureInboxFolderOrSignin(page))) {
      return {
        status: 'needs_signin',
        draftLeftOpen: false,
        message: 'Outlook is on the sign-in page. Sign in in Chrome and retry.',
      };
    }
    await this.dismissBlockingDialog(page);
    const opened = await this.openMessageById(page, args.id);
    if (!opened) {
      return {
        status: 'not_found',
        draftLeftOpen: false,
        message:
          `Could not locate message with id "${args.id}" in the current Inbox window. No forward was drafted; the message may have moved to Archive, Sent, Drafts, or another folder. Open or search the intended message and retry.`,
      };
    }
    if (await this.hasAnyVisibleOpenDraft(page)) {
      return {
        status: 'not_found',
        draftLeftOpen: true,
        message:
          'Outlook already has an open draft. Review, send, or close it before forwarding so ClawX does not type into the wrong draft.',
      };
    }

    await this.dismissBlockingDialog(page);
    const openedByShortcut = await this.openMessageComposeViaShortcut(page, 'forward');
    const clickedForward = openedByShortcut
      ? false
      : await this.clickOpenMessageToolbarButton(page, /^forward$/i);
    if (!openedByShortcut && !clickedForward) {
      return {
        status: 'not_found',
        draftLeftOpen: false,
        message: 'Could not safely identify the Forward button on the open message.',
      };
    }
    if (clickedForward) await this.waitForComposeBodyReady(page);

    await this.fillField(page, 'To', toList.join('; '));
    await this.commitRecipientField(page, 'To', toList);
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
    if (!(await this.ensureInboxFolderOrSignin(page))) {
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

    if (!(await this.ensureInboxFolderOrSignin(page))) {
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
  /**
   * Mail URL on the SAME origin the tab currently lives on. Microsoft is
   * migrating outlook.office.com → outlook.cloud.microsoft per-tenant;
   * navigating a cloud.microsoft tab to an office.com URL mid-session dies
   * with net::ERR_ABORTED (seen live 2026-09-02, the day the redirect
   * reached our tenant), which broke folder inspection after Send.
   */
  private outlookMailUrl(page: Page, path: string): string {
    try {
      const current = new URL(page.url());
      if (/^outlook\.(office\.com|office365\.com|cloud\.microsoft|live\.com)$/i.test(current.hostname)) {
        return `${current.origin}/mail/${path}`;
      }
    } catch {
      // fall through to the classic origin
    }
    return `https://outlook.office.com/mail/${path}`;
  }

  private async ensureInboxFolder(page: Page): Promise<void> {
    const url = page.url();
    if (!isOutlookInboxUrl(url)) {
      logger.info('[outlook-v2] Navigating Outlook tab to Inbox before inbox-scoped action');
      await page.goto(this.outlookMailUrl(page, 'inbox'), {
        timeout: 30_000,
        waitUntil: 'domcontentloaded',
      }).catch((err) => {
        logger.debug?.(
          `[outlook-v2] Inbox navigation failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
    await page.waitForSelector(
      [
        'div[role="listbox"]',
        'div[role="rowgroup"]',
        '[role="region"][aria-label*="Message list" i]',
        '[aria-label*="Inbox" i]',
      ].join(','),
      { timeout: 15_000 },
    ).catch(() => undefined);

    if (isOutlookInboxUrl(page.url())) return;

    const inboxSelected = await page.evaluate(`
      (() => {
        const candidates = Array.from(document.querySelectorAll([
          '[aria-current="page"]',
          '[aria-selected="true"]',
          '[role="treeitem"][aria-selected="true"]',
          '[role="link"][aria-current="page"]',
          '[role="button"][aria-current="page"]'
        ].join(',')));
        const textFor = function(el) {
          return [
            el.getAttribute('aria-label') || '',
            el.getAttribute('title') || '',
            el.textContent || ''
          ].join(' ').replace(/\\s+/g, ' ').trim();
        };
        return candidates.some(function(el) {
          const text = textFor(el);
          return /\\bInbox\\b/i.test(text) && !/\\bSent\\b|\\bArchive\\b|\\bDrafts\\b|\\bDeleted\\b/i.test(text);
        });
      })()
    `).catch(() => false) as boolean;

    if (!inboxSelected) {
      throw new Error(
        'Outlook Inbox folder could not be confirmed after navigation. Refusing to read the visible message list because it may be Sent Items or another folder.',
      );
    }
  }

  private async ensureMailFolder(page: Page, folder: 'drafts' | 'sentitems'): Promise<boolean> {
    const currentUrl = page.url();
    try {
      const url = new URL(currentUrl);
      const segments = url.pathname.toLowerCase().split('/').filter(Boolean);
      if (isOutlookMailHost(url.hostname) && segments[0] === 'mail' && segments.includes(folder)) {
        return true;
      }
    } catch {
      // Navigate below.
    }

    // SPA-native first: click the folder in the sidebar. On the new domain a
    // hard page.goto is aborted by the SPA whenever a compose dialog is in
    // flight (net::ERR_ABORTED seen live 2026-09-02), which broke the
    // post-Send Drafts inspection. The sidebar click is what a principal
    // does and never triggers a full navigation.
    const folderDisplayName = folder === 'drafts' ? 'Drafts' : 'Sent Items';
    const folderLink = page.locator([
      `[role="treeitem"][aria-label*="${folderDisplayName}" i]`,
      `[title="${folderDisplayName}"]`,
      `a:has-text("${folderDisplayName}")`,
      `div[role="treeitem"]:has-text("${folderDisplayName}")`,
    ].join(','));
    let clicked = false;
    try {
      if ((await folderLink.count()) > 0) {
        await folderLink.first().click({ timeout: 5_000 });
        clicked = true;
        await this.driver.sleep(1_500);
      }
    } catch (err) {
      logger.debug?.(
        `[outlook-v2] ${folder} sidebar click failed, falling back to goto: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!clicked) {
      const targetUrl = this.outlookMailUrl(page, folder);
      await page.goto(targetUrl, {
        timeout: 30_000,
        waitUntil: 'domcontentloaded',
      }).catch((err) => {
        logger.debug?.(
          `[outlook-v2] ${folder} navigation failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
    await page.waitForSelector(
      [
        'div[role="listbox"]',
        'div[role="rowgroup"]',
        '[role="region"][aria-label*="Message list" i]',
        '[role="option"][aria-label]',
        '[role="row"][aria-label]',
      ].join(','),
      { timeout: 10_000 },
    ).catch(() => undefined);

    try {
      const url = new URL(page.url());
      const segments = url.pathname.toLowerCase().split('/').filter(Boolean);
      if (isOutlookMailHost(url.hostname) && segments[0] === 'mail' && segments.includes(folder)) {
        return true;
      }
    } catch {
      // Fall through to selected-folder probe.
    }

    const folderLabel = folder === 'drafts' ? 'Drafts' : 'Sent Items';
    return page.evaluate((expectedLabel) => {
      const normalize = (value: string | undefined | null) => (value ?? '')
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const candidates = Array.from(document.querySelectorAll([
        '[aria-current="page"]',
        '[aria-selected="true"]',
        '[role="treeitem"][aria-selected="true"]',
        '[role="link"][aria-current="page"]',
        '[role="button"][aria-current="page"]',
      ].join(',')));
      return candidates.some((el) => {
        const text = normalize([
          el.getAttribute('aria-label') || '',
          el.getAttribute('title') || '',
          el.textContent || '',
        ].join(' '));
        return text.toLowerCase().includes(expectedLabel.toLowerCase());
      });
    }, folderLabel).catch(() => false);
  }

  private async ensureInboxFolderOrSignin(page: Page): Promise<boolean> {
    try {
      await this.ensureInboxFolder(page);
    } catch (err) {
      if (await this.looksLikeSignin(page)) return false;
      throw err;
    }
    return !(await this.looksLikeSignin(page));
  }

  private async resetInboxListScroll(page: Page): Promise<void> {
    await page.evaluate(`
      (() => {
        const isScrollable = function(el) {
          if (!el) return false;
          const style = window.getComputedStyle(el);
          if (!/(auto|scroll)/i.test(style.overflowY || '')) return false;
          return el.scrollHeight > el.clientHeight + 8;
        };
        const findScrollableAncestor = function(el) {
          let current = el;
          while (current && current !== document.body) {
            if (isScrollable(current)) return current;
            current = current.parentElement;
          }
          return null;
        };
        const firstRow = document.querySelector('[role="option"][aria-label], [role="row"][aria-label]');
        const candidates = [
          firstRow ? findScrollableAncestor(firstRow) : null,
          ...Array.from(document.querySelectorAll([
            'div[role="listbox"]',
            'div[role="rowgroup"]',
            '[role="region"][aria-label*="Message list" i]',
            '[aria-label*="Inbox" i]'
          ].join(','))).map(findScrollableAncestor),
          document.scrollingElement
        ].filter(Boolean);
        const seen = new Set();
        for (const raw of candidates) {
          const el = raw;
          if (seen.has(el)) continue;
          seen.add(el);
          if ('scrollTop' in el) el.scrollTop = 0;
        }
        return true;
      })()
    `).catch((err) => {
      logger.debug?.(
        `[outlook-v2] resetInboxListScroll failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }

  private async extractVisibleInboxRows(
    page: Page,
    limit: number,
  ): Promise<VisibleInboxRow[]> {
    return page.evaluate(`
      (() => {
        const out = [];
        const seen = new Set();
        const nodes = document.querySelectorAll('[role="option"][aria-label], [role="row"][aria-label]');
        const limit = ${JSON.stringify(limit)};
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
          const key = label.slice(0, 200);
          if (seen.has(key)) continue;
          seen.add(key);
          if (out.length >= limit) break;

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
          const id = (sender + '|' + subject + '|' + receivedAt).slice(0, 96) || label.slice(0, 96);
          out.push({ id: id, sender: sender, subject: subject, snippet: snippet, received: receivedAt, unread: unread });
        }
        return out;
      })()
    `).catch((err) => {
      logger.debug?.(
        `[outlook-v2] extractVisibleInboxRows failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }) as Promise<VisibleInboxRow[]>;
  }

  private async scrollInboxList(page: Page): Promise<boolean> {
    const moved = await page.evaluate(`
      (() => {
        const isScrollable = function(el) {
          if (!el) return false;
          const style = window.getComputedStyle(el);
          if (!/(auto|scroll)/i.test(style.overflowY || '')) return false;
          return el.scrollHeight > el.clientHeight + 8;
        };
        const findScrollableAncestor = function(el) {
          let current = el;
          while (current && current !== document.body) {
            if (isScrollable(current)) return current;
            current = current.parentElement;
          }
          return null;
        };
        const firstRow = document.querySelector('[role="option"][aria-label], [role="row"][aria-label]');
        const explicit = Array.from(document.querySelectorAll([
          'div[role="listbox"]',
          'div[role="rowgroup"]',
          '[role="region"][aria-label*="Message list" i]',
          '[aria-label*="Inbox" i]'
        ].join(','))).map(findScrollableAncestor).find(Boolean);
        const target = (firstRow ? findScrollableAncestor(firstRow) : null)
          || explicit
          || document.scrollingElement;
        if (!target || !('scrollTop' in target)) return false;
        const before = target.scrollTop;
        const step = Math.max(Math.floor((target.clientHeight || window.innerHeight || 600) * 0.85), 480);
        target.scrollTop = Math.min(target.scrollTop + step, target.scrollHeight || target.scrollTop + step);
        target.dispatchEvent(new Event('scroll', { bubbles: true }));
        return target.scrollTop > before + 2;
      })()
    `).catch((err) => {
      logger.debug?.(
        `[outlook-v2] scrollInboxList failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    });
    return moved === true;
  }

  private async visibleInboxFingerprint(page: Page): Promise<string> {
    return page.evaluate(`
      (() => Array.from(document.querySelectorAll('[role="option"][aria-label], [role="row"][aria-label]'))
        .slice(0, 20)
        .map((el) => [
          el.getAttribute('aria-label') || '',
          el.textContent || ''
        ].join(' ').replace(/\\s+/g, ' ').trim().slice(0, 200))
        .join('\\n'))()
    `).catch(() => '') as Promise<string>;
  }

  private async openMessageById(page: Page, id: string): Promise<boolean> {
    await this.resetInboxListScroll(page);
    const maxPasses = 40;
    let stalePasses = 0;
    let previousVisibleFingerprint = '';
    for (let pass = 0; pass < maxPasses; pass += 1) {
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
      if (targetIdx >= 0) {
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

      const visibleFingerprint = await this.visibleInboxFingerprint(page);
      stalePasses = visibleFingerprint && visibleFingerprint === previousVisibleFingerprint
        ? stalePasses + 1
        : 0;
      previousVisibleFingerprint = visibleFingerprint;
      if (stalePasses >= 2) return false;

      const moved = await this.scrollInboxList(page);
      if (!moved) return false;
      await this.driver.sleep(250);
    }
    return false;
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
    // Do not click Discard/Discard draft here. Those buttons are destructive
    // and belong only in the ClawX-owned test cleanup harness.
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
    await this.prepareFunctionEvaluate(page);
    const domSignals = await page.evaluate(() => {
      const textFor = (element: Element | null) => [
        element?.getAttribute('aria-label') || '',
        element?.getAttribute('title') || '',
        element?.textContent || '',
      ].join(' ');
      const isVisible = (element: Element | null) => {
        if (!(element instanceof HTMLElement)) return false;
        return element.offsetParent !== null || element.getClientRects().length > 0;
      };
      const inputs = Array.from(document.querySelectorAll([
        'input[type="email"]',
        'input[type="password"]',
        'input[name="loginfmt"]',
        'input[name="passwd"]',
        '#i0116',
        '#i0118',
      ].join(',')));
      if (inputs.some(isVisible)) return true;

      const authRoots = Array.from(document.querySelectorAll([
        'form',
        '[role="dialog"]',
        '[data-testid*="credential" i]',
        '[data-testid*="signin" i]',
        '#lightbox',
      ].join(',')));
      return authRoots.some((root) => {
        if (!isVisible(root)) return false;
        const text = [
          document.title || '',
          textFor(root),
          ...Array.from(root.querySelectorAll('button, input[type="submit"], [role="button"], [role="heading"]'))
            .slice(0, 40)
            .map(textFor),
        ].join(' ').replace(/\s+/g, ' ').trim();
        const hasAuthCopy = /(?:sign in|sign-in|pick an account|enter password|email, phone, or skype|stay signed in|use another account)/i
          .test(text);
        const hasMicrosoftAuthControl = Boolean(root.querySelector([
          '#idSIButton9',
          'input[name="loginfmt"]',
          'input[name="passwd"]',
          'input[type="email"]',
          'input[type="password"]',
        ].join(',')));
        return hasAuthCopy && hasMicrosoftAuthControl;
      });
    }).catch(() => false);
    if (domSignals) return true;

    // Fallback: check accessibility headings only when a Microsoft auth
    // control is also visible; a normal email body may contain "sign in".
    const headings = await page
      .getByRole('heading')
      .allTextContents()
      .catch(() => [] as string[]);
    if (!headings.some((h) => /sign in|pick an account|enter password/i.test(h))) return false;
    return page.locator([
      '#idSIButton9',
      'input[name="loginfmt"]',
      'input[name="passwd"]',
      'input[type="email"]',
      'input[type="password"]',
    ].join(',')).first().isVisible({ timeout: 500 }).catch(() => false);
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
    await this.prepareFunctionEvaluate(page);
    const state = await page.evaluate(readOutlookDomState).catch(() => ({
      hasNewMailControl: false,
      hasOpenComposeSurface: false,
    }));
    if (state.hasNewMailControl || !state.hasOpenComposeSurface) {
      return false;
    }

    logger.info('[outlook-v2] New mail hidden behind compose surface; resetting Outlook tab to inbox');
    await page.goto(this.outlookMailUrl(page, 'inbox'), {
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
    await this.prepareFunctionEvaluate(page);
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

  private async openMessageComposeViaShortcut(
    page: Page,
    action: 'reply' | 'replyAll' | 'forward',
  ): Promise<boolean> {
    const shortcuts = action === 'replyAll'
      ? (process.platform === 'darwin' ? ['Meta+Shift+R', 'Control+Shift+R', 'Shift+R'] : ['Control+Shift+R', 'Shift+R'])
      : action === 'forward'
        ? (process.platform === 'darwin' ? ['Meta+Shift+F', 'Control+Shift+F', 'Shift+F'] : ['Control+Shift+F', 'Shift+F'])
        : (process.platform === 'darwin' ? ['Meta+R', 'Control+R', 'R'] : ['Control+R', 'R']);

    try {
      await this.prepareFunctionEvaluate(page);
      const focusedMessageSurface = await page.evaluate(() => {
        const roots = Array.from(document.querySelectorAll([
          '[role="region"][aria-label*="reading" i]',
          '[aria-label*="reading pane" i]',
          '[aria-label*="message body" i]',
          '[aria-label*="message preview" i]',
          '[data-automation-id*="ReadingPane" i]',
          '[data-automationid*="ReadingPane" i]',
        ].join(','))) as HTMLElement[];
        const isVisible = (el: HTMLElement) => {
          const rect = el.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return false;
          let current: HTMLElement | null = el;
          while (current) {
            const style = window.getComputedStyle(current);
            if (style.visibility === 'hidden' || style.display === 'none') return false;
            current = current.parentElement;
          }
          return true;
        };
        const selectedRows = Array.from(
          document.querySelectorAll<HTMLElement>('[role="option"][aria-selected="true"], [role="row"][aria-selected="true"]'),
        );
        const target = [...roots, ...selectedRows].find(isVisible);
        if (!target) return false;
        if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
        target.focus?.();
        return true;
      });
      if (!focusedMessageSurface) return false;
      for (const shortcut of shortcuts) {
        await this.driver.pressKey(shortcut);
        try {
          await this.waitForComposeBodyReady(page, 5_000);
          logger.info(`[outlook-v2] Opened ${action} compose pane with Outlook keyboard shortcut fallback (${shortcut})`);
          return true;
        } catch {
          // Try the next shortcut. Outlook Web differs across Windows/macOS
          // and tenant keyboard-shortcut modes.
        }
      }
      return false;
    } catch (err) {
      logger.debug?.(
        `[outlook-v2] ${action} keyboard shortcut fallback missed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return false;
    }
  }

  private async clickOpenMessageToolbarButton(page: Page, nameRegex: RegExp): Promise<boolean> {
    await this.prepareFunctionEvaluate(page);
    const clickResult = await page.evaluate(({ source, ignoreCase }) => {
      const re = new RegExp(source, ignoreCase ? 'i' : '');
      const target = /\breply\s+all\b/i.test(source)
        ? 'replyAll'
        : /\bforward\b/i.test(source)
          ? 'forward'
          : 'reply';
      const normalize = (value: string | undefined | null) => (value ?? '')
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const isVisible = (el: Element | null) => {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        let current: Element | null = el;
        while (current) {
          const style = window.getComputedStyle(current);
          if (style.visibility === 'hidden' || style.display === 'none') return false;
          current = current.parentElement;
        }
        return true;
      };
      const clickableFor = (el: Element) => el.closest(
        'button, [role="button"], [role="menuitem"], a[role="button"]',
      ) || el;
      const labelFor = (el: Element) => [
        el.getAttribute('aria-label') || '',
        el.getAttribute('title') || '',
        el.getAttribute('data-automation-id') || '',
        el.getAttribute('data-automationid') || '',
        el.textContent || '',
      ].map(normalize).filter(Boolean);
      const scoreLabel = (label: string) => {
        if (!label) return 0;
        if (/^\s*(archive|delete|move|sweep|junk|report|flag|pin|mark|categorize)\b/i.test(label)) return 0;
        if (target === 'replyAll') {
          if (/^reply\s+all$/i.test(label)) return 100;
          if (/^reply\s+all\b/i.test(label)) return 90;
          return re.test(label) ? 70 : 0;
        }
        if (target === 'forward') {
          if (/^forward$/i.test(label)) return 100;
          if (/^forward\b/i.test(label)) return 90;
          return re.test(label) ? 70 : 0;
        }
        if (/\breply\s+all\b/i.test(label)) return 0;
        if (/^reply$/i.test(label)) return 100;
        if (/^reply\b/i.test(label)) return 90;
        if (/\breply\b/i.test(label)) return 70;
        return re.test(label) ? 60 : 0;
      };
      const scoreElement = (el: Element) => {
        const labels = labelFor(el);
        if (labels.some((label) => /^\s*(archive|delete|move|sweep|junk|report|flag|pin|mark|categorize)\b/i.test(label))) {
          return 0;
        }
        return Math.max(0, ...labels.map(scoreLabel));
      };
      const collectCandidates = (roots: ParentNode[]) => {
        const seen = new Set<Element>();
        const out: Array<{ el: HTMLElement; score: number }> = [];
        for (const root of roots) {
          const elements = Array.from(root.querySelectorAll(
            'button, [role="button"], [role="menuitem"], a[role="button"], [aria-label], [title], [data-automation-id], [data-automationid]',
          ));
          for (const raw of elements) {
            const clickable = clickableFor(raw);
            if (seen.has(clickable) || !isVisible(clickable)) continue;
            seen.add(clickable);
            const score = Math.max(scoreElement(raw), scoreElement(clickable));
            if (score >= 70) out.push({ el: clickable as HTMLElement, score });
          }
        }
        return out;
      };
      const clickUniqueBest = (candidates: Array<{ el: HTMLElement; score: number }>) => {
        const sorted = candidates
          .filter((candidate) => candidate.score >= 70)
          .sort((a, b) => b.score - a.score);
        if (sorted.length === 0) return false;
        const best = sorted[0];
        const ties = sorted.filter((candidate) => candidate.score === best.score);
        if (ties.length !== 1) return false;
        best.el.click();
        return true;
      };

      const readingPaneRoots = Array.from(document.querySelectorAll([
        '[role="region"][aria-label*="reading" i]',
        '[aria-label*="reading pane" i]',
        '[aria-label*="message body" i]',
        '[aria-label*="message preview" i]',
        '[data-automation-id*="ReadingPane" i]',
        '[data-automationid*="ReadingPane" i]',
      ].join(','))).filter(isVisible);

      for (const root of readingPaneRoots) {
        if (clickUniqueBest(collectCandidates([root]))) return true;
      }
      if (readingPaneRoots.length > 0) {
        const rootRects = readingPaneRoots.map((root) => root.getBoundingClientRect());
        const nearReadingPane = collectCandidates([document]).filter(({ el }) => {
          const rect = el.getBoundingClientRect();
          return rootRects.some((rootRect) => rect.left >= rootRect.left - 80
            && rect.right <= rootRect.right + 80
            && rect.top >= rootRect.top - 180
            && rect.top <= rootRect.bottom + 40);
        });
        if (clickUniqueBest(nearReadingPane)) return true;
        return false;
      }

      return clickUniqueBest(collectCandidates([document]));
    }, { source: nameRegex.source, ignoreCase: nameRegex.ignoreCase }).catch((err) => {
      logger.debug?.(
        `[outlook-v2] safe open-message toolbar click missed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    });
    if (clickResult) return true;

    await this.prepareFunctionEvaluate(page);
    const openedMoreMenu = await page.evaluate(() => {
      const normalize = (value: string | undefined | null) => (value ?? '')
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const isVisible = (el: Element | null) => {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        let current: Element | null = el;
        while (current) {
          const style = window.getComputedStyle(current);
          if (style.visibility === 'hidden' || style.display === 'none') return false;
          current = current.parentElement;
        }
        return true;
      };
      const labelFor = (el: Element) => [
        el.getAttribute('aria-label') || '',
        el.getAttribute('title') || '',
        el.getAttribute('data-automation-id') || '',
        el.getAttribute('data-automationid') || '',
        el.textContent || '',
      ].map(normalize).filter(Boolean).join(' ');
      const readingPaneRoots = Array.from(document.querySelectorAll([
        '[role="region"][aria-label*="reading" i]',
        '[aria-label*="reading pane" i]',
        '[aria-label*="message body" i]',
        '[aria-label*="message preview" i]',
        '[data-automation-id*="ReadingPane" i]',
        '[data-automationid*="ReadingPane" i]',
      ].join(','))).filter(isVisible);
      if (readingPaneRoots.length === 0) return false;
      const rootRects = readingPaneRoots.map((root) => root.getBoundingClientRect());
      const candidates = Array.from(document.querySelectorAll('button, [role="button"], a[role="button"]'))
        .map((el) => {
          if (!isVisible(el)) return false;
          const label = labelFor(el);
          if (!/\bmore\s+(actions|options|commands)\b|\bresponse?\s+actions\b|\brespond\b|^more$/i.test(label)) return false;
          const rect = el.getBoundingClientRect();
          const nearRoot = rootRects.some((rootRect) => rect.left >= rootRect.left - 80
            && rect.right <= rootRect.right + 80
            && rect.top >= rootRect.top - 180
            && rect.top <= rootRect.bottom + 40);
          if (!nearRoot) return false;
          const insideRoot = readingPaneRoots.some((root) => root.contains(el));
          let score = insideRoot ? 120 : 100;
          if (/\bmore\s+actions\b/i.test(label)) score += 20;
          else if (/\brespond\b|\bresponse?\s+actions\b/i.test(label)) score += 15;
          else if (/^more$/i.test(label)) score += 5;
          return { el: el as HTMLElement, score };
        })
        .filter(Boolean) as Array<{ el: HTMLElement; score: number }>;
      const sorted = candidates.sort((a, b) => b.score - a.score);
      if (sorted.length === 0) return false;
      const best = sorted[0];
      if (sorted.filter((candidate) => candidate.score === best.score).length !== 1) return false;
      best.el.click();
      return true;
    }).catch(() => false);

    if (!openedMoreMenu) return false;
    const waitForTimeout = (page as unknown as { waitForTimeout?: (timeout: number) => Promise<void> }).waitForTimeout;
    if (waitForTimeout) {
      await waitForTimeout.call(page, 300).catch(() => undefined);
    }

    await this.prepareFunctionEvaluate(page);
    return page.evaluate(({ source, ignoreCase }) => {
      const re = new RegExp(source, ignoreCase ? 'i' : '');
      const target = /\breply\s+all\b/i.test(source)
        ? 'replyAll'
        : /\bforward\b/i.test(source)
          ? 'forward'
          : 'reply';
      const normalize = (value: string | undefined | null) => (value ?? '')
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const isVisible = (el: Element | null) => {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        let current: Element | null = el;
        while (current) {
          const style = window.getComputedStyle(current);
          if (style.visibility === 'hidden' || style.display === 'none') return false;
          current = current.parentElement;
        }
        return true;
      };
      const labelFor = (el: Element) => [
        el.getAttribute('aria-label') || '',
        el.getAttribute('title') || '',
        el.getAttribute('data-automation-id') || '',
        el.getAttribute('data-automationid') || '',
        el.textContent || '',
      ].map(normalize).filter(Boolean);
      const scoreLabel = (label: string) => {
        if (/^\s*(archive|delete|move|sweep|junk|report|flag|pin|mark|categorize)\b/i.test(label)) return 0;
        if (target === 'replyAll') {
          if (/^reply\s+all$/i.test(label)) return 100;
          if (/^reply\s+all\b/i.test(label)) return 90;
          return re.test(label) ? 70 : 0;
        }
        if (target === 'forward') {
          if (/^forward$/i.test(label)) return 100;
          if (/^forward\b/i.test(label)) return 90;
          return re.test(label) ? 70 : 0;
        }
        if (/\breply\s+all\b/i.test(label)) return 0;
        if (/^reply$/i.test(label)) return 100;
        if (/^reply\b/i.test(label)) return 90;
        return re.test(label) ? 70 : 0;
      };
      const candidates = Array.from(document.querySelectorAll('[role="menuitem"], button[role="menuitem"], [role="menu"] button'))
        .filter(isVisible)
        .map((el) => ({ el: el as HTMLElement, score: Math.max(0, ...labelFor(el).map(scoreLabel)) }))
        .filter((candidate) => candidate.score >= 70)
        .sort((a, b) => b.score - a.score);
      if (candidates.length === 0) return false;
      const best = candidates[0];
      if (candidates.filter((candidate) => candidate.score === best.score).length !== 1) return false;
      best.el.click();
      return true;
    }, { source: nameRegex.source, ignoreCase: nameRegex.ignoreCase }).catch((err) => {
      logger.debug?.(
        `[outlook-v2] safe open-message menu click missed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    });
  }

  private async hasAnyVisibleOpenDraft(page: Page): Promise<boolean> {
    const listPages = (this.driver as unknown as { outlookPages?: () => Promise<Page[]> }).outlookPages;
    const pages = typeof listPages === 'function'
      ? await listPages.call(this.driver).catch(() => [page])
      : [page];
    for (const candidate of pages.length > 0 ? pages : [page]) {
      if (await this.hasVisibleOpenDraft(candidate)) return true;
    }
    return false;
  }

  private async hasVisibleOpenDraft(page: Page): Promise<boolean> {
    const evaluate = (page as unknown as {
      evaluate?: <TResult>(fn: () => TResult) => Promise<TResult>;
    }).evaluate;
    if (typeof evaluate !== 'function') return false;
    await this.prepareFunctionEvaluate(page);
    return evaluate.call(page, () => {
      const normalize = (value: string | undefined | null) => (value ?? '')
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const isVisible = (el: Element | null) => {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        let current: Element | null = el;
        while (current) {
          const style = window.getComputedStyle(current);
          if (style.visibility === 'hidden' || style.display === 'none') return false;
          current = current.parentElement;
        }
        return true;
      };
      const labelFor = (el: Element | null) => normalize([
        el?.getAttribute('aria-label') || '',
        el?.getAttribute('title') || '',
        el?.getAttribute('data-testid') || '',
        el?.getAttribute('data-automation-id') || '',
        el?.getAttribute('data-automationid') || '',
        el?.textContent || '',
      ].filter(Boolean).join(' '));
      const hasSendButton = (root: Element) => Array.from(
        root.querySelectorAll('button, [role="button"], [aria-label], [title], [data-testid]'),
      ).some((el) => isVisible(el) && /^send$/i.test(labelFor(el)));
      const hasRecipientOrSubjectField = (root: Element) => Array.from(root.querySelectorAll([
        '[aria-label="To"]',
        '[aria-label="Cc"]',
        '[aria-label="Bcc"]',
        '[aria-label="Subject"]',
        '[aria-label*="recipient" i]',
        '[placeholder="Add a subject"]',
        '[placeholder*="subject" i]',
        '[role="textbox"][aria-label*="To" i]',
        '[role="textbox"][aria-label*="Cc" i]',
        '[role="textbox"][aria-label*="Bcc" i]',
        '[contenteditable="true"][aria-label*="recipient" i]',
      ].join(','))).some(isVisible);
      const hasEditableBody = (root: Element) => Array.from(root.querySelectorAll([
        '[aria-label="Message body"]',
        '[aria-label*="Message body" i]',
        '[role="textbox"][aria-label*="body" i]',
        '[contenteditable="true"][aria-label*="body" i]',
        '[contenteditable="true"][role="textbox"]',
        '[contenteditable="true"][aria-multiline="true"]',
        '[role="textbox"][aria-multiline="true"]',
      ].join(','))).some((el) => {
        if (!isVisible(el)) return false;
        const label = labelFor(el);
        if (/\b(to|cc|bcc|subject|recipient|recipients)\b/i.test(label)) return false;
        if (el.getAttribute('contenteditable') === 'false') return false;
        const role = normalize(el.getAttribute('role')).toLowerCase();
        const tag = el.tagName.toLowerCase();
        return el.getAttribute('contenteditable') === 'true' || role === 'textbox' || tag === 'textarea';
      });
      const roots = Array.from(document.querySelectorAll([
        'div[role="dialog"]',
        '[aria-label*="Compose" i]',
        '[aria-label*="New message" i]',
        '[aria-label*="Draft" i]',
        '[role="region"][aria-label*="reading" i]',
        '[role="main"][aria-label*="Reading Pane" i]',
        '[aria-label*="reading pane" i]',
      ].join(','))).filter(isVisible);
      return roots.some((root) => hasEditableBody(root)
        && (hasSendButton(root) || hasRecipientOrSubjectField(root) || /\b(compose|new message|draft|reply|forward)\b/i.test(labelFor(root))));
    }).catch((err) => {
      logger.debug?.(
        `[outlook-v2] visible draft preflight failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    });
  }

  private async waitForComposePane(page: Page, timeoutMs = 15_000): Promise<void> {
    // Do not unblock on the open-message reading pane. It also exposes
    // "Message body"; a compose surface must have send/compose evidence.
    //
    // Outlook rotated the compose Send control to a Fluent UI SplitButton
    // whose OUTER `<div data-testid="ComposeSendButton">` is not visible —
    // only the inner `<button>` is. A plain comma-joined waitForSelector
    // resolves the wrapper first (DOM order) and waits forever for it to
    // become visible (CLWX-59). Every branch below is guarded with
    // `:visible` so waitForSelector can only latch a visible match, the
    // vendor-stable role+aria selectors are tried first, and the rotated
    // title/data-testid selectors survive only as last-resort fallbacks
    // (the data-testid branch targets the inner button, not the wrapper).
    await page.waitForSelector(
      [
        'button[aria-label="Send"]:visible',
        '[role="button"][aria-label="Send"]:visible',
        'div[role="dialog"] [aria-label="Message body"]:visible',
        '[aria-label*="Compose" i] [aria-label="Message body" i]:visible',
        '[title="Send"]:visible',
        '[data-testid*="Send" i] button:visible',
        '[data-testid*="Send" i]:visible',
      ].join(', '),
      { timeout: timeoutMs, state: 'visible' },
    );
  }

  private async waitForComposeBodyReady(page: Page, timeoutMs = 15_000): Promise<void> {
    const started = Date.now();
    let lastError: unknown;
    while (Date.now() - started < timeoutMs) {
      try {
        if (await this.focusBestComposeBodyEditor(page)) return;
        await this.waitForComposePane(page, Math.min(1_500, Math.max(250, timeoutMs - (Date.now() - started))));
        if (await this.focusBestComposeBodyEditor(page)) return;
      } catch (error) {
        lastError = error;
      }
      await this.driver.sleep(300);
    }
    throw new Error(
      `Could not locate a ready Outlook compose body editor${
        lastError instanceof Error ? `: ${lastError.message}` : ''
      }`,
    );
  }

  private async fillField(page: Page, label: 'To' | 'Cc' | 'Bcc' | 'Subject', value: string): Promise<void> {
    // Compose pane fields are usually inputs or contenteditables labelled by
    // aria-label. This is stable in Outlook.
    for (let attempt = 0; attempt < 8; attempt += 1) {
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
          const count = await c.count();
          for (let index = 0; index < Math.min(count, 8); index += 1) {
            const target = typeof c.nth === 'function' ? c.nth(index) : c.first();
            if (typeof target.isVisible === 'function' && !(await target.isVisible({ timeout: 500 }).catch(() => false))) {
              continue;
            }
            await target.click({ timeout: 2_000 });
            await target.fill(value, { timeout: 2_000 });
            return;
          }
        } catch {
          // try next
        }
      }
      await this.driver.sleep(250);
    }
    if (label === 'Subject' && await this.fillSubjectFieldDom(page, value)) {
      return;
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

  private async fillSubjectFieldDom(page: Page, value: string): Promise<boolean> {
    const evaluate = (page as unknown as {
      evaluate?: <TArg, TResult>(fn: (arg: TArg) => TResult, arg: TArg) => Promise<TResult>;
    }).evaluate;
    if (typeof evaluate !== 'function') return false;
    await this.prepareFunctionEvaluate(page);
    return evaluate.call(page, (subject) => {
      const normalize = (input: string | undefined | null) => (input ?? '')
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const isVisible = (el: Element | null) => {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        let current: Element | null = el;
        while (current) {
          const style = window.getComputedStyle(current);
          if (style.visibility === 'hidden' || style.display === 'none') return false;
          current = current.parentElement;
        }
        return true;
      };
      const metaText = (el: Element | null) => normalize([
        el?.getAttribute('aria-label') || '',
        el?.getAttribute('placeholder') || '',
        el?.getAttribute('title') || '',
        el?.getAttribute('name') || '',
        el?.getAttribute('data-automation-id') || '',
        el?.getAttribute('data-automationid') || '',
        el?.textContent || '',
      ].filter(Boolean).join(' '));
      const hasSendButton = (root: Element) => Array.from(
        root.querySelectorAll('button, [role="button"], [aria-label], [title], [data-testid]'),
      ).some((el) => {
        if (!isVisible(el)) return false;
        const labels = [
          el.getAttribute('aria-label') || '',
          el.getAttribute('title') || '',
          el.getAttribute('data-testid') || '',
          el.textContent || '',
        ].map(normalize).filter(Boolean);
        return labels.some((label) => /^send$/i.test(label));
      });
      const composeRoot = (el: Element) => {
        let current: Element | null = el;
        for (let depth = 0; current && depth < 20; depth += 1) {
          if (current !== document.body && current !== document.documentElement && hasSendButton(current)) {
            return current;
          }
          current = current.parentElement;
        }
        return null;
      };
      const subjectCandidates = Array.from(document.querySelectorAll([
        'input',
        'textarea',
        '[role="textbox"]',
        '[contenteditable="true"]',
        '[aria-label*="subject" i]',
        '[placeholder*="subject" i]',
      ].join(',')))
        .filter((el) => isVisible(el))
        .filter((el) => {
          const text = metaText(el);
          if (/\b(to|cc|bcc|recipient|recipients|message body)\b/i.test(text)) return false;
          return /\bsubject\b/i.test(text) || /^add a subject$/i.test(normalize(el.textContent || ''));
        })
        .map((el) => ({ el, root: composeRoot(el), text: metaText(el) }))
        .filter((item): item is { el: Element; root: Element; text: string } => Boolean(item.root))
        .sort((a, b) => {
          const aExact = /^(subject|add a subject)$/i.test(a.text) ? 1 : 0;
          const bExact = /^(subject|add a subject)$/i.test(b.text) ? 1 : 0;
          return bExact - aExact;
        });
      const target = subjectCandidates[0]?.el as HTMLElement | undefined;
      if (!target) return false;
      target.focus();
      target.click();
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        const proto = target instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        setter?.call(target, subject);
      } else {
        target.textContent = subject;
      }
      const inputEvent = typeof InputEvent === 'function'
        ? new InputEvent('input', { bubbles: true, inputType: 'insertText', data: subject })
        : new Event('input', { bubbles: true });
      target.dispatchEvent(inputEvent);
      target.dispatchEvent(new Event('change', { bubbles: true }));
      target.blur();
      return true;
    }, value).catch((err) => {
      logger.debug?.(
        `[outlook-v2] subject DOM fill failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    });
  }

  private async commitRecipientField(page: Page, label: 'To' | 'Cc' | 'Bcc', values: string[]): Promise<void> {
    const expected = recipientEmails(values);
    if (expected.length === 0) return;
    const evaluate = (page as unknown as {
      evaluate?: <TArg, TResult>(fn: (arg: TArg) => TResult, arg: TArg) => Promise<TResult>;
    }).evaluate;

    const readState = async () => {
      if (typeof evaluate !== 'function') {
        return { hasExpected: false, hasOpenPicker: true };
      }
      await this.prepareFunctionEvaluate(page);
      return evaluate.call(page, ({ fieldLabel, expectedEmails: emails }) => {
        const normalize = (value: string | undefined | null) => (value ?? '')
          .replace(/\u00a0/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .toLowerCase();
        const isVisible = (el: Element | null) => {
          if (!el) return false;
          const rect = el.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return false;
          let current: Element | null = el;
          while (current) {
            const style = window.getComputedStyle(current);
            if (style.visibility === 'hidden' || style.display === 'none') return false;
            current = current.parentElement;
          }
          return true;
        };
        const valueText = (el: Element | null) => {
          if (!el) return '';
          const value = 'value' in el && typeof el.value === 'string' ? el.value : '';
          return normalize([value, el.textContent || ''].filter(Boolean).join(' '));
        };
        const fieldText = (el: Element | null) => normalize([
          el?.getAttribute('aria-label') || '',
          el?.getAttribute('placeholder') || '',
          el?.getAttribute('title') || '',
          el?.getAttribute('name') || '',
          el?.getAttribute('data-automation-id') || '',
          el?.getAttribute('data-automationid') || '',
        ].filter(Boolean).join(' '));
        const fieldSelectors = [
          `[aria-label="${fieldLabel}"]`,
          `[aria-label*="${fieldLabel}" i]`,
          `[role="textbox"][aria-label*="${fieldLabel}" i]`,
          `[contenteditable="true"][aria-label*="${fieldLabel}" i]`,
        ];
        const fieldValues = Array.from(document.querySelectorAll(fieldSelectors.join(',')))
          .filter((el) => isVisible(el) && new RegExp(`\\b${fieldLabel}\\b`, 'i').test(fieldText(el)))
          .map(valueText)
          .join(' ');
        const pageText = normalize(document.body?.innerText || document.body?.textContent || '');
        const hasExpected = emails.every((email) => fieldValues.includes(normalize(email)) || pageText.includes(normalize(email)));
        const hasOpenPicker = Array.from(document.querySelectorAll([
          '[role="listbox"]',
          '[role="option"]',
          '[role="menu"]',
          '[data-testid*="picker" i]',
          '[aria-label*="suggest" i]',
          '[aria-label*="search result" i]',
        ].join(','))).some((el) => isVisible(el) && emails.some((email) => valueText(el).includes(normalize(email))));
        return { hasExpected, hasOpenPicker };
      }, { fieldLabel: label, expectedEmails: expected }).catch(() => ({ hasExpected: false, hasOpenPicker: true }));
    };

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const state = await readState();
      if (state.hasExpected && !state.hasOpenPicker) return;
      await this.driver.pressKey(attempt < 3 ? 'Enter' : 'Tab');
      await this.driver.sleep(300);
    }
  }

  private async fillBody(page: Page, body: string): Promise<void> {
    const candidates = [
      page.getByLabel('Message body', { exact: true }),
      page.locator('[aria-label="Message body"]'),
      page.locator('[aria-label*="Message body" i]'),
      page.locator('[role="textbox"][aria-label*="body" i]'),
      page.locator('[contenteditable="true"][aria-label*="body" i]'),
    ];

    // Outlook's tabbed compose layout can render To/Subject before the body
    // editor is attached. Retry the deterministic body probes before falling
    // back to VLM so a transient DOM miss does not strand a saved draft.
    for (let attempt = 0; attempt < 24; attempt += 1) {
      if (await this.focusBestComposeBodyEditor(page)) {
        await this.assertFocusedComposeTargetIsBody(page);
        await this.driver.typeText(body);
        await this.verifyBodyFill(page, body);
        return;
      }

      for (const c of candidates) {
        let hasCandidate: boolean;
        try {
          hasCandidate = (await c.count()) > 0;
        } catch {
          continue;
        }
        if (!hasCandidate) continue;
        try {
          await c.first().click({ timeout: 2_000 });
          await this.assertFocusedComposeTargetIsBody(page);
          // contenteditable bodies don't always accept .fill — type instead.
          await this.driver.typeText(body);
          await this.verifyBodyFill(page, body);
          return;
        } catch {
          // try next
        }
      }

      await this.driver.sleep(250);
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
    await this.assertFocusedComposeTargetIsBody(page);
    await this.driver.typeText(body);
    await this.verifyBodyFill(page, body);
  }

  private async focusBestComposeBodyEditor(page: Page): Promise<boolean> {
    const evaluate = (page as unknown as {
      evaluate?: <TArg, TResult>(fn: (arg: TArg) => TResult, arg: TArg) => Promise<TResult>;
    }).evaluate;
    if (typeof evaluate !== 'function') return false;
    await this.prepareFunctionEvaluate(page);

    type ComposeBodyProbe = {
      clicked: boolean;
      reason: string;
      candidateCount: number;
      composeCandidateCount: number;
    };

    const probe = await evaluate.call(page, () => {
      const normalize = (value: string | undefined | null) => (value ?? '')
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const isVisible = (el: Element | null) => {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        let current: Element | null = el;
        while (current) {
          const style = window.getComputedStyle(current);
          if (style.visibility === 'hidden' || style.display === 'none') return false;
          current = current.parentElement;
        }
        return true;
      };
      const fieldNameText = (el: Element | null) => {
        if (!el) return '';
        return normalize([
          el.getAttribute('aria-label') || '',
          el.getAttribute('placeholder') || '',
          el.getAttribute('name') || '',
          el.getAttribute('title') || '',
          el.getAttribute('data-automation-id') || '',
          el.getAttribute('data-automationid') || '',
          el.getAttribute('data-testid') || '',
        ].filter(Boolean).join(' '));
      };
      const isRecipientOrSubjectField = (el: Element | null) => {
        const text = fieldNameText(el);
        if (!text) return false;
        return /^(to|cc|bcc|subject)$/i.test(text)
          || /\b(to|cc|bcc|subject|recipient|recipients)\b/i.test(text);
      };
      const isEditableBodyCandidate = (el: Element) => {
        if (isRecipientOrSubjectField(el)) return false;
        if (el.getAttribute('contenteditable') === 'false') return false;
        if (el.getAttribute('aria-readonly') === 'true') return false;
        const label = fieldNameText(el);
        const role = normalize(el.getAttribute('role')).toLowerCase();
        const tag = el.tagName.toLowerCase();
        return el.getAttribute('contenteditable') === 'true'
          || role === 'textbox'
          || tag === 'textarea'
          || (/\bmessage body\b/i.test(label) && el.hasAttribute('contenteditable'));
      };
      const hasSubjectField = (root: Element) => Boolean(root.querySelector(
        '[aria-label="Subject"], [aria-label*="Subject" i], [placeholder="Add a subject"], [placeholder*="subject" i]',
      ));
      const hasRecipientField = (root: Element) => Boolean(root.querySelector([
        '[aria-label="To"]',
        '[aria-label="Cc"]',
        '[aria-label="Bcc"]',
        '[aria-label*="recipient" i]',
        '[role="textbox"][aria-label*="To" i]',
        '[role="textbox"][aria-label*="Cc" i]',
        '[role="textbox"][aria-label*="Bcc" i]',
        '[contenteditable="true"][aria-label*="recipient" i]',
      ].join(',')));
      const hasSendButton = (root: Element) => Array.from(root.querySelectorAll(
        'button, [role="button"], [aria-label], [title], [data-testid]',
      )).some((el) => {
        if (!isVisible(el)) return false;
        const labels = [
          el.getAttribute('aria-label') || '',
          el.getAttribute('title') || '',
          el.getAttribute('data-testid') || '',
          el.textContent || '',
        ].map(normalize).filter(Boolean);
        return labels.some((label) => /^send$/i.test(label) || /\bcompose.*send\b|\bsend.*button\b/i.test(label));
      });
      const labelHasCompose = (el: Element | null) => /\b(compose|new message|draft|reply|forward)\b/i.test(
        fieldNameText(el),
      );
      const readingPaneRoot = (el: Element) => el.closest([
        '[role="region"][aria-label*="reading" i]',
        '[aria-label*="reading pane" i]',
        '[data-automation-id*="ReadingPane" i]',
        '[data-automationid*="ReadingPane" i]',
      ].join(','));
      const composeRootScore = (root: Element) => {
        const hasSend = hasSendButton(root);
        const hasRecipient = hasRecipientField(root);
        const hasSubject = hasSubjectField(root);
        let score = 0;
        if (hasSend) score += 120;
        if (hasRecipient) score += 35;
        if (hasSubject) score += 25;
        if (root.getAttribute('role') === 'dialog') score += 25;
        if (labelHasCompose(root)) score += 20;
        return { score, hasSend };
      };
      const nearestComposeRoot = (body: Element) => {
        let best: { root: Element; score: number } | null = null;
        let current: Element | null = body;
        const readingRoot = readingPaneRoot(body);
        if (readingRoot && isVisible(readingRoot)) {
          const { score } = composeRootScore(readingRoot);
          if (score >= 80) best = { root: readingRoot, score };
        }
        for (let depth = 0; current && depth < 30; depth += 1) {
          if (readingRoot && !readingRoot.contains(current)) break;
          if (!isVisible(current)) {
            current = current.parentElement;
            continue;
          }
          const { score, hasSend } = composeRootScore(current);
          const adjustedScore = score - (readingRoot && !hasSend ? 80 : 0);
          if (adjustedScore >= 80 && (!best || adjustedScore > best.score)) {
            best = { root: current, score: adjustedScore };
          }
          current = current.parentElement;
        }
        return best;
      };
      const candidates = Array.from(document.querySelectorAll([
        '[aria-label="Message body"]',
        '[aria-label*="Message body" i]',
        '[role="textbox"][aria-label*="body" i]',
        '[contenteditable="true"][aria-label*="body" i]',
        '[contenteditable="true"][role="textbox"]',
        '[contenteditable="true"][aria-multiline="true"]',
        '[role="textbox"][aria-multiline="true"]',
      ].join(','))).filter((el) => isVisible(el) && isEditableBodyCandidate(el));
      const scored = candidates
        .map((el) => {
          const composeRoot = nearestComposeRoot(el);
          if (!composeRoot) return null;
          const label = fieldNameText(el);
          let score = composeRoot.score;
          if (el.getAttribute('contenteditable') === 'true') score += 20;
          if (normalize(el.getAttribute('role')).toLowerCase() === 'textbox') score += 10;
          if (/\bmessage body\b/i.test(label)) score += 20;
          const rect = el.getBoundingClientRect();
          score += Math.min(20, Math.round((rect.width * rect.height) / 50_000));
          return { el: el as HTMLElement, score, root: composeRoot.root };
        })
        .filter(Boolean) as Array<{ el: HTMLElement; score: number; root: Element }>;
      const sorted = scored.sort((a, b) => b.score - a.score);
      if (sorted.length === 0) {
        return {
          clicked: false,
          reason: 'no-compose-body',
          candidateCount: candidates.length,
          composeCandidateCount: 0,
        };
      }
      const best = sorted[0];
      const ties = sorted.filter((candidate) => candidate.score === best.score);
      if (ties.length > 1) {
        return {
          clicked: false,
          reason: 'ambiguous-compose-body',
          candidateCount: candidates.length,
          composeCandidateCount: sorted.length,
        };
      }
      best.el.scrollIntoView?.({ block: 'center', inline: 'nearest' });
      best.el.focus?.();
      best.el.click();
      return {
        clicked: document.activeElement === best.el || best.root.contains(document.activeElement),
        reason: 'clicked',
        candidateCount: candidates.length,
        composeCandidateCount: sorted.length,
      };
    }, undefined).catch((err) => {
      logger.debug?.(
        `[outlook-v2] compose body selector probe failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }) as ComposeBodyProbe | null;

    if (!probe?.clicked) {
      logger.debug?.(
        `[outlook-v2] compose body selector missed: ${probe ? `${probe.reason}; candidates=${
          probe.candidateCount
        }; composeCandidates=${probe.composeCandidateCount}` : 'no probe'}`,
      );
      return false;
    }
    return true;
  }

  private async assertFocusedComposeTargetIsBody(page: Page): Promise<void> {
    const evaluate = (page as unknown as {
      evaluate?: <TArg, TResult>(fn: (arg: TArg) => TResult, arg: TArg) => Promise<TResult>;
    }).evaluate;
    if (typeof evaluate !== 'function') return;
    await this.prepareFunctionEvaluate(page);

    type FocusProbe = {
      ok: boolean;
      reason: 'body' | 'recipient' | 'subject' | 'readingPane' | 'unknown';
      label: string;
    };

    let lastProbe: FocusProbe | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const probe = await evaluate.call(page, () => {
        const normalize = (value: string | undefined | null) => (value ?? '')
          .replace(/\u00a0/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .toLowerCase();
        const isVisible = (el: Element | null) => {
          if (!el) return false;
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return rect.width > 0
            && rect.height > 0
            && style.visibility !== 'hidden'
            && style.display !== 'none';
        };
        const labelText = (el: Element | null) => {
          const parts: string[] = [];
          let current: Element | null = el;
          while (current && parts.length < 20) {
            parts.push(
              current.getAttribute('aria-label') || '',
              current.getAttribute('placeholder') || '',
              current.getAttribute('name') || '',
              current.getAttribute('title') || '',
              current.getAttribute('data-automation-id') || '',
              current.getAttribute('data-automationid') || '',
            );
            current = current.parentElement;
          }
          return normalize(parts.filter(Boolean).join(' '));
        };
        const closestVisible = (el: Element | null, selectors: string) => {
          const match = el?.closest(selectors) ?? null;
          return isVisible(match) ? match : null;
        };
        const fieldNameText = (el: Element | null) => {
          if (!el) return '';
          return normalize([
            el.getAttribute('aria-label') || '',
            el.getAttribute('placeholder') || '',
            el.getAttribute('name') || '',
            el.getAttribute('title') || '',
            el.getAttribute('data-automation-id') || '',
            el.getAttribute('data-automationid') || '',
            el.getAttribute('data-testid') || '',
          ].filter(Boolean).join(' '));
        };
        const hasSubjectField = (root: Element) => Boolean(root.querySelector(
          '[aria-label="Subject"], [aria-label*="Subject" i], [placeholder="Add a subject"], [placeholder*="subject" i]',
        ));
        const hasRecipientField = (root: Element) => Boolean(root.querySelector([
          '[aria-label="To"]',
          '[aria-label="Cc"]',
          '[aria-label="Bcc"]',
          '[aria-label*="recipient" i]',
          '[role="textbox"][aria-label*="To" i]',
          '[role="textbox"][aria-label*="Cc" i]',
          '[role="textbox"][aria-label*="Bcc" i]',
          '[contenteditable="true"][aria-label*="recipient" i]',
        ].join(',')));
        const hasSendButton = (root: Element) => Array.from(root.querySelectorAll(
          'button, [role="button"], [aria-label], [title], [data-testid]',
        )).some((el) => {
          if (!isVisible(el)) return false;
          const labels = [
            el.getAttribute('aria-label') || '',
            el.getAttribute('title') || '',
            el.getAttribute('data-testid') || '',
            el.textContent || '',
          ].map(normalize).filter(Boolean);
          return labels.some((label) => /^send$/i.test(label) || /\bcompose.*send\b|\bsend.*button\b/i.test(label));
        });
        const isComposeBody = (el: Element | null) => {
          if (!el) return false;
          const readingRoot = el.closest([
            '[role="region"][aria-label*="reading" i]',
            '[aria-label*="reading pane" i]',
            '[data-automation-id*="ReadingPane" i]',
            '[data-automationid*="ReadingPane" i]',
          ].join(','));
          const isComposeRoot = (root: Element) => {
            const structuredComposeRoot = root.getAttribute('role') === 'dialog'
              && hasRecipientField(root)
              && (hasSubjectField(root) || /\b(compose|draft|reply|forward)\b/i.test(fieldNameText(root)));
            return (hasSendButton(root)
              && (hasRecipientField(root) || hasSubjectField(root) || /\b(compose|draft|reply|forward)\b/i.test(fieldNameText(root))))
              || structuredComposeRoot;
          };
          if (readingRoot && isVisible(readingRoot) && isComposeRoot(readingRoot)) {
            return true;
          }
          let current: Element | null = el;
          for (let depth = 0; current && depth < 30; depth += 1) {
            if (readingRoot && !readingRoot.contains(current)) break;
            if (isComposeRoot(current)) {
              return true;
            }
            current = current.parentElement;
          }
          return false;
        };
        const active = document.activeElement;
        const label = labelText(active);
        const recipient = closestVisible(active, [
          '[aria-label="To"]',
          '[aria-label="Cc"]',
          '[aria-label="Bcc"]',
          '[aria-label*="recipient" i]',
          '[role="textbox"][aria-label*="To" i]',
          '[role="textbox"][aria-label*="Cc" i]',
          '[role="textbox"][aria-label*="Bcc" i]',
          '[contenteditable="true"][aria-label*="recipient" i]',
        ].join(','));
        if (recipient || /\b(to|cc|bcc|recipient|recipients)\b/i.test(label)) {
          return { ok: false, reason: 'recipient' as const, label };
        }
        const subject = closestVisible(active, [
          '[aria-label="Subject"]',
          '[aria-label*="Subject" i]',
          '[placeholder*="Subject" i]',
          '[name*="subject" i]',
        ].join(','));
        if (subject || /\bsubject\b/i.test(label)) {
          return { ok: false, reason: 'subject' as const, label };
        }
        const body = closestVisible(active, [
          '[aria-label="Message body"]',
          '[aria-label*="Message body" i]',
          '[role="textbox"][aria-label*="body" i]',
          '[contenteditable="true"][aria-label*="body" i]',
          '[contenteditable="true"][role="textbox"]',
          '[contenteditable="true"][aria-multiline="true"]',
          '[role="textbox"][aria-multiline="true"]',
        ].join(','));
        if (body) {
          return isComposeBody(body)
            ? { ok: true, reason: 'body' as const, label }
            : { ok: false, reason: 'readingPane' as const, label };
        }
        return { ok: false, reason: 'unknown' as const, label };
      }, undefined).catch((err) => {
        logger.debug?.(
          `[outlook-v2] focused body target probe failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        return null;
      }) as FocusProbe | null;
      if (!probe) return;
      lastProbe = probe;
      if (probe.ok) return;
      await this.driver.sleep(150);
    }

    if (lastProbe?.reason === 'recipient') {
      throw new Error('Outlook compose body targeting failed: focused element is a recipient field.');
    }
    if (lastProbe?.reason === 'subject') {
      throw new Error('Outlook compose body targeting failed: focused element is the subject field.');
    }
    if (lastProbe?.reason === 'readingPane') {
      throw new Error('Outlook compose body targeting failed: focused element is the message reading pane, not the compose body.');
    }
    throw new Error('Outlook compose body targeting failed: focused element is not the compose body.');
  }

  private async verifyBodyFill(page: Page, expectedBody: string): Promise<void> {
    const expected = normalizeSearchText(expectedBody);
    if (!expected) return;
    const evaluate = (page as unknown as {
      evaluate?: <TArg, TResult>(fn: (arg: TArg) => TResult, arg: TArg) => Promise<TResult>;
    }).evaluate;
    if (typeof evaluate !== 'function') return;
    await this.prepareFunctionEvaluate(page);

    type BodyFillProbe = {
      bodyHasExpected: boolean;
      recipientHasExpected: boolean;
      bodyEditorCount: number;
      recipientFieldCount: number;
    };

    let lastProbe: BodyFillProbe | null = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const probe = await evaluate.call(page, (needle: string) => {
        const normalize = (value: string | undefined | null) => (value ?? '')
          .replace(/\u00a0/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .toLowerCase();
        const isVisible = (el: Element | null) => {
          if (!el) return false;
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return rect.width > 0
            && rect.height > 0
            && style.visibility !== 'hidden'
            && style.display !== 'none';
        };
        const valueText = (el: Element | null) => {
          if (!el) return '';
          const value = 'value' in el && typeof el.value === 'string' ? el.value : '';
          const text = el.textContent || '';
          return normalize([value, text].filter(Boolean).join(' '));
        };
        const fieldNameText = (el: Element | null) => {
          if (!el) return '';
          return normalize([
            el.getAttribute('aria-label') || '',
            el.getAttribute('placeholder') || '',
            el.getAttribute('name') || '',
            el.getAttribute('title') || '',
            el.getAttribute('data-automation-id') || '',
            el.getAttribute('data-automationid') || '',
          ].filter(Boolean).join(' '));
        };
        const isRecipientField = (el: Element | null) => {
          const label = fieldNameText(el);
          return /\b(to|cc|bcc|recipient|recipients)\b/i.test(label)
            && !/\bsubject\b/i.test(label);
        };
        const isRecipientOrSubjectField = (el: Element | null) => {
          const label = fieldNameText(el);
          return /\b(to|cc|bcc|subject|recipient|recipients)\b/i.test(label);
        };
        const isEditableBodyElement = (el: Element | null) => {
          if (!el) return false;
          if (el.getAttribute('contenteditable') === 'false') return false;
          const role = normalize(el.getAttribute('role')).toLowerCase();
          const tag = el.tagName.toLowerCase();
          return el.getAttribute('contenteditable') === 'true'
            || role === 'textbox'
            || tag === 'textarea';
        };
        const hasSubjectField = (root: Element) => Boolean(root.querySelector(
          '[aria-label="Subject"], [aria-label*="Subject" i], [placeholder="Add a subject"], [placeholder*="subject" i]',
        ));
        const hasRecipientField = (root: Element) => Boolean(root.querySelector([
          '[aria-label="To"]',
          '[aria-label="Cc"]',
          '[aria-label="Bcc"]',
          '[aria-label*="recipient" i]',
          '[role="textbox"][aria-label*="To" i]',
          '[role="textbox"][aria-label*="Cc" i]',
          '[role="textbox"][aria-label*="Bcc" i]',
          '[contenteditable="true"][aria-label*="recipient" i]',
        ].join(',')));
        const hasSendButton = (root: Element) => Array.from(root.querySelectorAll(
          'button, [role="button"], [aria-label], [title], [data-testid]',
        )).some((el) => {
          if (!isVisible(el)) return false;
          const labels = [
            el.getAttribute('aria-label') || '',
            el.getAttribute('title') || '',
            el.getAttribute('data-testid') || '',
            el.textContent || '',
          ].map(normalize).filter(Boolean);
          return labels.some((label) => /^send$/i.test(label) || /\bcompose.*send\b|\bsend.*button\b/i.test(label));
        });
        const isComposeBody = (body: Element) => {
          const readingRoot = body.closest([
            '[role="region"][aria-label*="reading" i]',
            '[aria-label*="reading pane" i]',
            '[data-automation-id*="ReadingPane" i]',
            '[data-automationid*="ReadingPane" i]',
          ].join(','));
          const isComposeRoot = (root: Element) => {
            const structuredComposeRoot = root.getAttribute('role') === 'dialog'
              && hasRecipientField(root)
              && (hasSubjectField(root) || /\b(compose|draft|reply|forward)\b/i.test(fieldNameText(root)));
            return (hasSendButton(root)
              && (hasRecipientField(root) || hasSubjectField(root) || /\b(compose|draft|reply|forward)\b/i.test(fieldNameText(root))))
              || structuredComposeRoot;
          };
          if (readingRoot && isVisible(readingRoot) && isComposeRoot(readingRoot)) {
            return true;
          }
          let current: Element | null = body;
          for (let depth = 0; current && depth < 30; depth += 1) {
            if (readingRoot && !readingRoot.contains(current)) break;
            if (isComposeRoot(current)) {
              return true;
            }
            current = current.parentElement;
          }
          return false;
        };
        const bodyEditors = Array.from(document.querySelectorAll([
          '[aria-label="Message body"]',
          '[aria-label*="Message body" i]',
          '[role="textbox"][aria-label*="body" i]',
          '[contenteditable="true"][aria-label*="body" i]',
          '[contenteditable="true"][role="textbox"]',
          '[contenteditable="true"][aria-multiline="true"]',
          '[role="textbox"][aria-multiline="true"]',
        ].join(','))).filter((el) => isVisible(el) && isEditableBodyElement(el) && !isRecipientOrSubjectField(el) && isComposeBody(el));
        // Recipient wells must be EDITABLE fields. The earlier loose
        // substring selectors ([aria-label*="To" i] on any element) matched
        // inbox message-list rows whose aria-label carried the word "to"
        // and whose preview text echoed the draft body — producing "message
        // text appears in a recipient field" on a perfectly correct draft
        // (reproduced live 2026-09-02 on outlook.cloud.microsoft; the same
        // mechanism fires when a reply quotes text visible in the list).
        const recipientFields = Array.from(document.querySelectorAll([
          '[contenteditable="true"][aria-label="To"]',
          '[contenteditable="true"][aria-label="Cc"]',
          '[contenteditable="true"][aria-label="Bcc"]',
          'input[aria-label="To"]',
          'input[aria-label="Cc"]',
          'input[aria-label="Bcc"]',
          '[role="textbox"][aria-label="To"]',
          '[role="textbox"][aria-label="Cc"]',
          '[role="textbox"][aria-label="Bcc"]',
          '[role="textbox"][aria-label*="recipient" i]',
          '[contenteditable="true"][aria-label*="recipient" i]',
        ].join(','))).filter((el) => isVisible(el) && isRecipientField(el));
        return {
          bodyHasExpected: bodyEditors.some((el) => valueText(el).includes(needle)),
          recipientHasExpected: recipientFields.some((el) => valueText(el).includes(needle)),
          bodyEditorCount: bodyEditors.length,
          recipientFieldCount: recipientFields.length,
        };
      }, expected).catch((err) => {
        logger.debug?.(
          `[outlook-v2] verifyBodyFill probe failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        return null;
      }) as BodyFillProbe | null;

      if (!probe) return;
      lastProbe = probe;
      if (probe.bodyHasExpected && !probe.recipientHasExpected) return;
      await this.driver.sleep(250);
    }

    if (lastProbe?.recipientHasExpected) {
      throw new Error('Outlook compose body verification failed: message text appears in a recipient field.');
    }
    throw new Error('Outlook compose body verification failed: message text was not found in the compose body.');
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

  private describeRecipientAssertionMismatch(snapshot: OpenDraftSnapshot, args: SendEmailArgs): string | null {
    if (!hasExplicitRecipientAssertions(args)) return null;
    if (missingRecipientNeedles(asArray(args.to), snapshot.to).length > 0
      || hasUnexpectedRecipient(asArray(args.to), snapshot.to)) {
      return 'the open draft does not contain all requested To recipients';
    }
    if (missingRecipientNeedles(asArray(args.cc), snapshot.cc).length > 0
      || hasUnexpectedRecipient(asArray(args.cc), snapshot.cc)) {
      return 'the open draft does not contain all requested Cc recipients';
    }
    if (missingRecipientNeedles(asArray(args.bcc), snapshot.bcc).length > 0
      || hasUnexpectedRecipient(asArray(args.bcc), snapshot.bcc)) {
      return 'the open draft does not contain all requested Bcc recipients';
    }
    return null;
  }

  private describeDraftMismatch(
    snapshot: OpenDraftSnapshot,
    args: SendEmailArgs & Required<Pick<SendEmailArgs, 'to' | 'subject' | 'body'>>,
  ): string | null {
    if (normalizeComparableText(snapshot.subject) !== normalizeComparableText(args.subject)) {
      return 'the open draft subject does not match the requested subject';
    }
    const recipientMismatch = this.describeRecipientAssertionMismatch(snapshot, args);
    if (recipientMismatch) return recipientMismatch;
    const expectedBody = normalizeSearchText(args.body);
    const actualBody = normalizeSearchText(snapshot.body);
    if (actualBody !== expectedBody) {
      return 'the open draft body does not match the requested body';
    }
    return null;
  }

  private describeReplyDraftBodyProblem(snapshot: OpenDraftSnapshot | null, expectedBody: string): string | null {
    const expected = normalizeSearchText(expectedBody);
    if (!expected) return null;
    if (!snapshot) {
      return 'Reply draft opened, but ClawX could not verify the draft body. Review the open draft in Outlook before sending.';
    }
    const actualBody = normalizeSearchText(snapshot.body);
    const recipientText = normalizeSearchText([
      ...snapshot.to,
      ...snapshot.cc,
      ...snapshot.bcc,
    ].join(' '));
    if (recipientText.includes(expected)) {
      return 'Reply draft text appears in a recipient field instead of the message body. Review the open draft in Outlook before sending.';
    }
    if (!actualBody.includes(expected)) {
      return 'Reply draft opened, but ClawX could not verify the message text in the compose body. Review the open draft in Outlook before sending.';
    }
    return null;
  }

  private async readOpenDraftSnapshot(page: Page): Promise<OpenDraftSnapshot | null> {
    const probe = await this.evaluateOpenDraftDom(page, null);
    return probe.snapshot;
  }

  private async readOpenDraftProbe(page: Page): Promise<OpenDraftDomProbe> {
    return this.evaluateOpenDraftDom(page, null);
  }

  private async clickSendInVerifiedDraft(
    page: Page,
    args: SendEmailArgs & Required<Pick<SendEmailArgs, 'to' | 'subject' | 'body'>>,
  ): Promise<boolean> {
    const expected: ExpectedDraftForSend = {
      to: asArray(args.to),
      cc: asArray(args.cc),
      bcc: asArray(args.bcc),
      subject: args.subject,
      body: args.body,
    };
    const probe = await this.evaluateOpenDraftDom(page, expected);
    return probe.clickedSend;
  }

  private async clickSendInCurrentReviewedDraft(page: Page, args: SendEmailArgs): Promise<boolean> {
    const expected: CurrentReviewedDraftForSend = {
      mode: 'current-reviewed',
    };
    if (hasProvidedValue(args.to)) expected.to = asArray(args.to);
    if (hasProvidedValue(args.cc)) expected.cc = asArray(args.cc);
    if (hasProvidedValue(args.bcc)) expected.bcc = asArray(args.bcc);
    const probe = await this.evaluateOpenDraftDom(page, expected);
    return probe.clickedSend;
  }

  private async waitForSendCompletion(page: Page): Promise<boolean> {
    let clearPasses = 0;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await this.driver.sleep(500);
      const probe = await this.readOpenDraftProbe(page);
      if (!probe.error && probe.draftCount === 0) {
        clearPasses += 1;
        if (clearPasses >= 2) return true;
      } else {
        clearPasses = 0;
      }
    }
    return false;
  }

  private async visibleFolderRowsContainDraftSnapshot(
    page: Page,
    folder: 'drafts' | 'sentitems',
    snapshot: OpenDraftSnapshot,
  ): Promise<boolean | null> {
    const opened = await this.ensureMailFolder(page, folder);
    if (!opened) return null;
    const rows = await page.evaluate(() => {
      const normalize = (value: string | undefined | null) => (value ?? '')
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const elements = Array.from(document.querySelectorAll([
        '[role="option"][aria-label]',
        '[role="row"][aria-label]',
      ].join(',')));
      return elements.slice(0, 30).map((el) => normalize([
        el.getAttribute('aria-label') || '',
        el.textContent || '',
      ].join(' '))).filter(Boolean);
    }).catch((err) => {
      logger.debug?.(
        `[outlook-v2] ${folder} row probe failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }) as string[] | null;
    if (!rows) return null;

    const subjectNeedle = normalizeSearchText(snapshot.subject);
    const bodyNeedle = normalizeSearchText(snapshot.body);
    const recipientNeedles = canonicalRecipientEmails([
      ...snapshot.to,
      ...snapshot.cc,
      ...snapshot.bcc,
    ]).map(normalizeSearchText);
    const bodyIsSpecific = bodyNeedle.length >= 8;
    return rows.some((row) => {
      const text = normalizeSearchText(row);
      const subjectMatches = Boolean(subjectNeedle && text.includes(subjectNeedle));
      const bodyMatches = Boolean(bodyIsSpecific && text.includes(bodyNeedle));
      const recipientMatches = recipientNeedles.length === 0
        || recipientNeedles.some((needle) => text.includes(needle));
      if (bodyIsSpecific) {
        return bodyMatches && (subjectMatches || recipientMatches);
      }
      if (subjectNeedle) {
        return subjectMatches && recipientMatches;
      }
      return recipientNeedles.length > 0 && recipientMatches;
    });
  }

  private async verifyPostSendState(page: Page, snapshot: OpenDraftSnapshot): Promise<SendFinalStateProbe> {
    const subjectNeedle = normalizeSearchText(snapshot.subject);
    const bodyNeedle = normalizeSearchText(snapshot.body);
    const recipientNeedles = canonicalRecipientEmails([
      ...snapshot.to,
      ...snapshot.cc,
      ...snapshot.bcc,
    ]).map(normalizeSearchText);
    const hasUsefulNeedle = Boolean(subjectNeedle || bodyNeedle || recipientNeedles.length > 0);
    if (!hasUsefulNeedle) return { ok: true };

    const draftResidue = await this.visibleFolderRowsContainDraftSnapshot(page, 'drafts', snapshot);
    if (draftResidue === true) {
      return {
        ok: false,
        reason:
          'Send blocked: Outlook still shows a matching reviewed draft in Drafts after clicking Send, so it was not reported as sent.',
      };
    }
    if (draftResidue === null) {
      return {
        ok: false,
        reason:
          'Send blocked: ClawX could not inspect Drafts after clicking Send, so it could not verify the reviewed draft left Drafts.',
      };
    }

    const sentEvidence = await this.visibleFolderRowsContainDraftSnapshot(page, 'sentitems', snapshot);
    if (sentEvidence === false && (subjectNeedle || bodyNeedle)) {
      logger.debug?.('[outlook-v2] Sent Items did not expose the reviewed draft marker in the visible window after send');
    }
    return { ok: true };
  }

  private async evaluateOpenDraftDom(
    page: Page,
    expected: DraftSendProbeInput,
  ): Promise<OpenDraftDomProbe> {
    await this.prepareFunctionEvaluate(page);
    return page.evaluate((expectedDraft) => {
      const normalize = (value: string | undefined | null) => (value ?? '')
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const normalizeSearch = (value: string | undefined | null) => normalize(value).toLowerCase();
      const isVisible = (el: Element | null) => {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0
          && rect.height > 0
          && style.visibility !== 'hidden'
          && style.display !== 'none';
      };
      const valueText = (el: Element | null) => {
        if (!el) return '';
        const value = 'value' in el && typeof el.value === 'string' ? el.value : '';
        const text = (el.textContent || '').trim();
        return normalize([value, text].filter(Boolean).join(' '));
      };
      const fieldNameText = (el: Element | null) => {
        if (!el) return '';
        return normalize([
          el.getAttribute('aria-label') || '',
          el.getAttribute('placeholder') || '',
          el.getAttribute('name') || '',
          el.getAttribute('title') || '',
          el.getAttribute('data-automation-id') || '',
          el.getAttribute('data-automationid') || '',
        ].filter(Boolean).join(' '));
      };
      const isRecipientOrSubjectField = (el: Element | null) => {
        const text = fieldNameText(el);
        if (!text) return false;
        return /^(to|cc|bcc|subject)$/i.test(text)
          || /\b(to|cc|bcc|subject|recipient|recipients)\b/i.test(text);
      };
      const isEditableBodyElement = (el: Element | null) => {
        if (!el) return false;
        if (el.getAttribute('contenteditable') === 'false') return false;
        const role = normalizeSearch(el.getAttribute('role'));
        const tag = el.tagName.toLowerCase();
        return el.getAttribute('contenteditable') === 'true'
          || role === 'textbox'
          || tag === 'textarea';
      };
      const searchableText = (root: Element) => {
        const parts = [
          root.textContent || '',
          root.getAttribute('aria-label') || '',
          root.getAttribute('title') || '',
        ];
        for (const el of Array.from(root.querySelectorAll('*'))) {
          const value = 'value' in el && typeof el.value === 'string' ? el.value : '';
          parts.push(
            value,
            el.getAttribute('aria-label') || '',
            el.getAttribute('title') || '',
            el.getAttribute('data-automation-id') || '',
            el.getAttribute('data-automationid') || '',
          );
        }
        return normalize(parts.filter(Boolean).join(' '));
      };
      const fieldText = (root: Element, label: 'Subject') => {
        const selectors = [
          '[aria-label="Subject"]',
          '[aria-label*="Subject" i]',
          '[placeholder="Add a subject"]',
          '[placeholder*="subject" i]',
        ];
        for (const selector of selectors) {
          for (const el of Array.from(root.querySelectorAll(selector))) {
            if (!isVisible(el)) continue;
            const text = valueText(el);
            if (text && text.toLowerCase() !== label.toLowerCase()) return text;
          }
        }
        return '';
      };
      const bodyText = (root: Element) => {
        const selectors = [
          '[aria-label="Message body"]',
          '[aria-label*="Message body" i]',
          '[role="textbox"][aria-label*="body" i]',
          '[contenteditable="true"][aria-label*="body" i]',
          '[contenteditable="true"][role="textbox"]',
          '[contenteditable="true"][aria-multiline="true"]',
          '[role="textbox"][aria-multiline="true"]',
        ];
        for (const selector of selectors) {
          for (const el of Array.from(root.querySelectorAll(selector))) {
            if (!isVisible(el)) continue;
            if (!isEditableBodyElement(el)) continue;
            if (isRecipientOrSubjectField(el)) continue;
            const text = valueText(el);
            if (text) return text;
          }
        }
        return '';
      };
      const expectedNeedles = (values: string[]) => values
        .map((value) => {
          const email = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
          return normalizeSearch(email ?? value);
        })
        .filter(Boolean);
      const emailNeedles = (values: string[]) => values
        .flatMap((value) => value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [])
        .map((value) => normalizeSearch(value))
        .filter(Boolean);
      const recipientBucketMatches = (expectedValues: string[], actualValues: string[]) => {
        const actualText = normalizeSearch(actualValues.join(' '));
        const missing = expectedNeedles(expectedValues).some((needle) => !actualText.includes(needle));
        if (missing) return false;
        const expectedEmails = new Set(emailNeedles(expectedValues));
        const actualEmails = emailNeedles(actualValues);
        if (expectedEmails.size === 0) {
          return actualValues.every((value) => normalizeSearch(value).length === 0);
        }
        return actualEmails.every((email) => expectedEmails.has(email));
      };
      const hasSubjectField = (root: Element) => Boolean(root.querySelector(
        '[aria-label="Subject"], [aria-label*="Subject" i], [placeholder="Add a subject"], [placeholder*="subject" i]',
      ));
      const hasRecipientField = (root: Element) => Boolean(root.querySelector([
        '[aria-label="To"]',
        '[aria-label="Cc"]',
        '[aria-label="Bcc"]',
        '[aria-label*="recipient" i]',
        '[role="textbox"][aria-label*="To" i]',
        '[role="textbox"][aria-label*="Cc" i]',
        '[role="textbox"][aria-label*="Bcc" i]',
        '[contenteditable="true"][aria-label*="recipient" i]',
      ].join(',')));
      const sendButton = (root: Element) => Array.from(
        root.querySelectorAll('button, [role="button"], [aria-label], [title]'),
      ).find((el) => {
        if (!isVisible(el)) return false;
        const labels = [
          el.getAttribute('aria-label') || '',
          el.getAttribute('title') || '',
          el.textContent || '',
        ].map(normalize).filter(Boolean);
        return labels.some((label) => /^send$/i.test(label));
      }) as HTMLElement | undefined;
      const hasSendButton = (root: Element) => Boolean(sendButton(root));
      const hasDiscardButton = (root: Element) => Array.from(
        root.querySelectorAll('button, [role="button"], [aria-label], [title]'),
      ).some((el) => {
        if (!isVisible(el)) return false;
        const labels = [
          el.getAttribute('aria-label') || '',
          el.getAttribute('title') || '',
          el.textContent || '',
        ].map(normalize).filter(Boolean);
        return labels.some((label) => /\bdiscard\b/i.test(label));
      });
      const splitRecipients = (value: string) => normalize(value)
        .split(/[;,\n]+/)
        .map((part) => normalize(part))
        .filter((part) => part && !/^(to|cc|bcc)$/i.test(part));
      const recipientFieldText = (root: Element, label: 'To' | 'Cc' | 'Bcc') => {
        const selectors = [
          `[aria-label="${label}"]`,
          `[aria-label*="${label}" i]`,
          `[placeholder="${label}"]`,
          `[placeholder*="${label}" i]`,
          `[role="textbox"][aria-label*="${label}" i]`,
          `[contenteditable="true"][aria-label*="${label}" i]`,
        ];
        for (const selector of selectors) {
          for (const el of Array.from(root.querySelectorAll(selector))) {
            if (!isVisible(el)) continue;
            const text = valueText(el);
            if (text && text.toLowerCase() !== label.toLowerCase()) return text;
          }
        }
        return '';
      };
      const nearestComposeRootForBody = (body: Element) => {
        let best: { root: Element; score: number; area: number } | null = null;
        let current: Element | null = body;
        const readingRoot = body.closest([
          '[role="region"][aria-label*="reading" i]',
          '[aria-label*="reading pane" i]',
          '[data-automation-id*="ReadingPane" i]',
          '[data-automationid*="ReadingPane" i]',
        ].join(','));
        const composeRootScore = (root: Element) => {
          const hasSend = hasSendButton(root);
          const hasDiscard = hasDiscardButton(root);
          const hasRecipient = hasRecipientField(root);
          const hasSubject = hasSubjectField(root);
          let score = 0;
          if (hasSend) score += 120;
          if (hasDiscard) score += 20;
          if (hasRecipient) score += 35;
          if (hasSubject) score += 25;
          if (root.getAttribute('role') === 'dialog') score += 25;
          if (/\b(compose|new message|draft|reply|forward)\b/i.test(fieldNameText(root))) score += 20;
          return { score, hasSend };
        };
        for (let depth = 0; current && depth < 30; depth += 1) {
          if (readingRoot && !readingRoot.contains(current)) break;
          if (!isVisible(current)) {
            current = current.parentElement;
            continue;
          }
          const { score, hasSend } = composeRootScore(current);
          const adjustedScore = score - (readingRoot && !hasSend ? 80 : 0);
          const rect = current.getBoundingClientRect();
          const area = Math.max(1, rect.width * rect.height);
          if (adjustedScore >= 80 && (!best
            || adjustedScore > best.score
            || (adjustedScore === best.score && area < best.area))) {
            best = { root: current, score: adjustedScore, area };
          }
          current = current.parentElement;
        }
        return best?.root ?? null;
      };
      const bodyNodes = Array.from(document.querySelectorAll(
        [
          '[aria-label="Message body"]',
          '[aria-label*="Message body" i]',
          '[role="textbox"][aria-label*="body" i]',
          '[contenteditable="true"][aria-label*="body" i]',
          '[contenteditable="true"][role="textbox"]',
          '[contenteditable="true"][aria-multiline="true"]',
          '[role="textbox"][aria-multiline="true"]',
        ].join(','),
      )).filter((el) => isVisible(el) && isEditableBodyElement(el) && !isRecipientOrSubjectField(el) && nearestComposeRootForBody(el));
      const roots = Array.from(new Set(bodyNodes
        .map(nearestComposeRootForBody)
        .filter((root): root is Element => Boolean(root)
          && root !== document.body
          && root !== document.documentElement
          && hasSendButton(root))));
      let firstSnapshot: OpenDraftSnapshot | null = null;
      const sendableRoots: Array<{ root: Element; snapshot: OpenDraftSnapshot; button: HTMLElement }> = [];
      const matchingRoots: Array<{ root: Element; snapshot: OpenDraftSnapshot; button: HTMLElement }> = [];
      for (const root of roots) {
        const subject = fieldText(root, 'Subject');
        const body = bodyText(root);
        const text = searchableText(root);
        if (!subject && !body && !text) continue;
        const snapshot = {
          to: splitRecipients(recipientFieldText(root, 'To')),
          cc: splitRecipients(recipientFieldText(root, 'Cc')),
          bcc: splitRecipients(recipientFieldText(root, 'Bcc')),
          subject,
          body,
          searchableText: text,
        };
        firstSnapshot ??= snapshot;
        const button = sendButton(root);
        if (button && snapshot.to.some((value) => normalizeSearch(value).length > 0)
          && body && root.contains(button)) {
          sendableRoots.push({ root, snapshot, button });
        }
        if (!expectedDraft) continue;
        if ('mode' in expectedDraft && expectedDraft.mode === 'current-reviewed') {
          continue;
        }
        if (normalize(subject) !== normalize(expectedDraft.subject)) continue;
        if (!recipientBucketMatches(expectedDraft.to, snapshot.to)) continue;
        if (!recipientBucketMatches(expectedDraft.cc, snapshot.cc)) continue;
        if (!recipientBucketMatches(expectedDraft.bcc, snapshot.bcc)) continue;
        const expectedBody = normalizeSearch(expectedDraft.body);
        if (normalizeSearch(body) !== expectedBody) continue;
        if (!button) continue;
        if (!root.contains(button)) continue;
        matchingRoots.push({ root, snapshot, button });
      }
      if (expectedDraft && 'mode' in expectedDraft && expectedDraft.mode === 'current-reviewed') {
        const candidateRoots = sendableRoots.filter(({ snapshot }) => {
          if (expectedDraft.to && !recipientBucketMatches(expectedDraft.to, snapshot.to)) return false;
          if (expectedDraft.cc && !recipientBucketMatches(expectedDraft.cc, snapshot.cc)) return false;
          if (expectedDraft.bcc && !recipientBucketMatches(expectedDraft.bcc, snapshot.bcc)) return false;
          return true;
        });
        if (candidateRoots.length === 1 && sendableRoots.length === 1) {
          candidateRoots[0].button.click();
          return {
            snapshot: candidateRoots[0].snapshot,
            clickedSend: true,
            draftCount: roots.length,
            sendableDraftCount: sendableRoots.length,
          };
        }
        return {
          snapshot: candidateRoots[0]?.snapshot ?? firstSnapshot,
          clickedSend: false,
          draftCount: roots.length,
          sendableDraftCount: sendableRoots.length,
        };
      }
      if (matchingRoots.length === 1) {
        matchingRoots[0].button.click();
        return {
          snapshot: matchingRoots[0].snapshot,
          clickedSend: true,
          draftCount: roots.length,
          sendableDraftCount: sendableRoots.length,
        };
      }
      if (matchingRoots.length > 1) {
        return {
          snapshot: matchingRoots[0].snapshot,
          clickedSend: false,
          draftCount: roots.length,
          sendableDraftCount: sendableRoots.length,
        };
      }
      return {
        snapshot: firstSnapshot,
        clickedSend: false,
        draftCount: roots.length,
        sendableDraftCount: sendableRoots.length,
      };
    }, expected).catch((err) => {
      logger.debug?.(
        `[outlook-v2] evaluateOpenDraftDom failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return {
        snapshot: null,
        clickedSend: false,
        draftCount: -1,
        sendableDraftCount: -1,
        error: err instanceof Error ? err.message : String(err),
      };
    });
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
