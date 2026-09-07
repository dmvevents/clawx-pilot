/**
 * Type contracts for the outlook-browser service.
 *
 * "Browser-session" Outlook integration: ClawX attaches to the principal's
 * existing Chrome session via the bundled browser plugin (profile=user) and
 * drives Outlook Web (https://outlook.office.com/mail/) through the DOM.
 *
 * This is the Phase-1 path. Phase-2 will use Microsoft Graph OAuth via
 * extensions/microsoft-graph/, which is parked until IT returns a client_id.
 *
 * Hard rules baked into the type contract:
 *  - profile is always 'user' — managed Chromium is blocked by Conditional Access.
 *  - send_email never auto-fires; it must be paired with a confirm flag.
 *  - No password/token is captured here. If sign-in is needed, we surface
 *    `needs_signin` and ask the user to complete it interactively in Chrome.
 */

export type OutlookOpenStatus = 'opened' | 'needs_signin';

export interface OutlookOpenResult {
  status: OutlookOpenStatus;
  /** URL the tab is currently parked at (mail folder or sign-in page). */
  url: string;
  /** Browser-plugin target id, threaded through subsequent calls. */
  targetId?: string;
  /** Surfaced to the agent when status === 'needs_signin'. */
  message?: string;
}

export interface InboxMessage {
  /** Stable-ish DOM-derived id; not a Graph id. */
  id: string;
  subject: string;
  sender: string;
  /** Short preview/snippet, ~120 chars. */
  snippet: string;
  /** Display string from Outlook ("9:42 AM", "Tue", "Mon 5/22"). */
  receivedAt: string;
  unread: boolean;
}

export interface ReadInboxResult {
  status: 'ok' | 'needs_signin';
  messages: InboxMessage[];
  /**
   * Browser/CDP reads are a recent visible Inbox window, not a server-side
   * exhaustive mailbox export. Agents must surface this when users ask for
   * "all" mail or month-wide audits.
   */
  scan?: {
    scope: 'recent_inbox_window' | 'graph_inbox';
    requestedTop: number;
    scannedCount: number;
    returnedCount: number;
    /** Number of list-scroll passes used to gather the bounded browser window. */
    scrollPasses?: number;
    /** Rows skipped because they were list artifacts, not message candidates. */
    artifactSkippedCount?: number;
    exhaustive: boolean;
    note?: string;
  };
  message?: string;
}

export interface DraftEmailArgs {
  to: string | string[];
  subject: string;
  body: string;
  cc?: string | string[];
  bcc?: string | string[];
}

export interface DraftEmailResult {
  status: 'drafted' | 'failed' | 'needs_signin';
  /** True when the New-mail compose pane was filled and left open. */
  draftLeftOpen: boolean;
  /** Echo of what we filled, for the agent's "show before you send" hand-off. */
  preview: {
    to: string[];
    cc: string[];
    bcc: string[];
    subject: string;
    body: string;
  };
  message?: string;
}

export interface SendEmailArgs {
  /**
   * Optional verification fields. After a principal has reviewed an already
   * open Outlook draft, the model should normally send only { confirm: true }.
   * When supplied, recipient fields are treated as safety assertions.
   */
  to?: string | string[];
  subject?: string;
  body?: string;
  cc?: string | string[];
  bcc?: string | string[];
  /**
   * Hard gate. send() refuses unless the caller explicitly sets confirm=true.
   * The agent must show the user the draft and get a "yes, send" before
   * passing this flag.
   */
  confirm: boolean;
}

export interface SendEmailResult {
  status: 'sent' | 'refused' | 'needs_signin';
  /** Set when status === 'refused' — explains why (typically: confirm not set). */
  reason?: string;
  message?: string;
}

// ── Phase 3 actions ──────────────────────────────────────────────────────

/** Filter args for searchInbox. All optional — at least one should be set. */
export interface SearchInboxArgs {
  /** Partial sender match, case-insensitive. */
  from?: string;
  /** Partial subject match, case-insensitive. */
  subjectContains?: string;
  /** ISO 8601 date string; only return mail received on/after this date. */
  dateGte?: string;
  /** ISO 8601 date string; only return mail received before this date. */
  dateLt?: string;
  /** Filter by unread state. */
  unread?: boolean;
  /** Only messages that have at least one attachment. */
  hasAttachment?: boolean;
  /** Cap on results returned. Default 25. */
  top?: number;
}

export interface SearchInboxResult {
  status: 'ok' | 'needs_signin';
  messages: InboxMessage[];
  /** True when the result is the cap, not necessarily exhaustive. */
  capped?: boolean;
  scan?: {
    scope: 'recent_inbox_window' | 'graph_inbox';
    requestedTop: number;
    fetchedTop: number;
    scannedCount: number;
    matchedCount: number;
    returnedCount: number;
    exhaustive: boolean;
    note?: string;
  };
  message?: string;
}

/** Args for read_email. id is the InboxMessage.id from read_inbox/search_inbox. */
export interface ReadEmailArgs {
  id: string;
}

export interface EmailAttachmentInfo {
  filename: string;
  /** Best-effort; Outlook Web doesn't always expose size cleanly. */
  sizeBytes?: number;
  /** e.g. 'application/pdf'. May be unknown. */
  mimeType?: string;
}

/**
 * WHY a status of `not_found` needs a second, typed field (CLWX-120).
 *
 * Two very different situations used to collapse into a bare `not_found`:
 *
 *   `not_in_list`      — the id was not among the rows we could reach. The
 *                        message is genuinely absent from the current view
 *                        (moved, deleted, or the caller's id is stale).
 *   `stale_read_guard` — the row WAS found and clicked, and the CLWX-46
 *                        reading-pane guard then declined to confirm the pane
 *                        had settled on that message. We are refusing to claim
 *                        we read the right email; we are NOT claiming the email
 *                        is missing.
 *
 * A caller cannot tell those apart from the status alone, and the difference
 * matters twice over: the principal should be told "I could not confirm I
 * opened the right message" rather than "that message does not exist", and a
 * grader must not charge a healthy safety refusal to the product as a failure.
 *
 * Deliberately a typed union, NOT a substring of `message`. Keying a verdict off
 * log or message text is fail-open — any row can emit the token, so a caller
 * that greps for it eventually greps a lie. Absent means "no reason recorded",
 * which callers must treat as the unhelpful case, never as a refusal.
 */
export type MessageLocateFailure = 'not_in_list' | 'stale_read_guard';

export interface ReadEmailResult {
  status: 'ok' | 'not_found' | 'needs_signin';
  /** Echo of the id we were asked for. */
  id: string;
  /**
   * Only set when status === 'not_found'. See {@link MessageLocateFailure}:
   * `stale_read_guard` is a safety refusal, not evidence of absence.
   */
  notFoundReason?: MessageLocateFailure;
  subject?: string;
  sender?: string;
  receivedAt?: string;
  /** Plain-text body. HTML stripped — agents reason over text better. */
  body?: string;
  /** Includes To/Cc/Bcc lists when readable. */
  recipients?: { to: string[]; cc: string[]; bcc?: string[] };
  attachments?: EmailAttachmentInfo[];
  message?: string;
}

export interface ReplyArgs {
  id: string;
  body: string;
  /** When true, opens reply-all instead of reply. */
  replyAll?: boolean;
}

export interface ReplyResult {
  status: 'drafted' | 'not_found' | 'needs_signin';
  /** Only set when status === 'not_found'. See {@link MessageLocateFailure}. */
  notFoundReason?: MessageLocateFailure;
  draftLeftOpen: boolean;
  preview?: { to: string[]; subject: string; body: string };
  message?: string;
}

export interface ForwardArgs {
  id: string;
  to: string | string[];
  /** Optional commentary above the forwarded message. */
  body?: string;
}

export interface ForwardResult {
  status: 'drafted' | 'not_found' | 'needs_signin';
  /** Only set when status === 'not_found'. See {@link MessageLocateFailure}. */
  notFoundReason?: MessageLocateFailure;
  draftLeftOpen: boolean;
  preview?: { to: string[]; subject: string; body: string };
  message?: string;
}

export interface MarkReadArgs {
  id: string;
  /** True = mark as read, false = mark as unread. */
  read: boolean;
}

export interface MarkReadResult {
  status: 'ok' | 'not_found' | 'needs_signin';
  /** Only set when status === 'not_found'. See {@link MessageLocateFailure}. */
  notFoundReason?: MessageLocateFailure;
  message?: string;
}

export interface ListAttachmentsArgs {
  id: string;
}

export interface ListAttachmentsResult {
  status: 'ok' | 'not_found' | 'needs_signin';
  /** Only set when status === 'not_found'. Propagated from the readEmail this
   *  delegates to; see {@link MessageLocateFailure}. */
  notFoundReason?: MessageLocateFailure;
  id: string;
  attachments: EmailAttachmentInfo[];
  message?: string;
}

export interface DownloadAttachmentArgs {
  id: string;
  /** Filename of the attachment to download. Must match an entry returned
   *  by list_attachments / read_email. */
  filename: string;
  /** Hard gate. Like send_email, the agent MUST surface a confirmation
   *  to the principal before flipping this. Without confirm:true the
   *  download is refused. */
  confirm: boolean;
}

export interface DownloadAttachmentResult {
  status: 'downloaded' | 'refused' | 'not_found' | 'needs_signin';
  /** Absolute path the file was saved to (Mac/Linux) or Windows path. Only
   *  populated when status === 'downloaded'. */
  savedPath?: string;
  /** Echo of the requested filename for audit. */
  filename: string;
  /** Set when status === 'refused' or status === 'not_found'. Free text for a
   *  human; never parse it — use notFoundReason for a machine decision. */
  reason?: string;
  /**
   * Only set when status === 'not_found'. See {@link MessageLocateFailure}:
   * `stale_read_guard` means we refused to confirm we opened the right message,
   * NOT that the message is gone. No download is attempted either way.
   */
  notFoundReason?: MessageLocateFailure;
  message?: string;
}
