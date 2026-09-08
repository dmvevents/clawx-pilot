/**
 * Outlook Host API adapter backed by Microsoft Graph.
 *
 * This lets installed builds use the signed-in Microsoft 365 account without
 * requiring Chrome/CDP setup. Browser automation remains the fallback for
 * visible compose review, attachments, and any action not mapped here yet.
 */
import { logger } from '../../utils/logger';
import {
  getStatus,
  graphCalls,
  type DraftReplyArgs,
  type ListMessagesArgs,
  type SendMailArgs as GraphSendMailArgs,
} from './manager';
import type {
  DraftEmailArgs,
  DraftEmailResult,
  EmailAttachmentInfo,
  InboxMessage,
  ReadEmailArgs,
  ReadEmailResult,
  ReadInboxResult,
  SearchInboxArgs,
  SearchInboxResult,
  SendEmailArgs,
  SendEmailResult,
} from '../outlook-browser/types';

interface GraphEmailAddress {
  name?: string;
  address?: string;
}

interface GraphRecipient {
  emailAddress?: GraphEmailAddress;
}

interface GraphMessage {
  id?: string;
  subject?: string;
  bodyPreview?: string;
  receivedDateTime?: string;
  isRead?: boolean;
  hasAttachments?: boolean;
  from?: { emailAddress?: GraphEmailAddress };
  sender?: { emailAddress?: GraphEmailAddress };
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  bccRecipients?: GraphRecipient[];
  body?: { content?: string; contentType?: string };
}

interface GraphAttachment {
  name?: string;
  size?: number;
  contentType?: string;
}

/**
 * Cross-transport message-id marker.
 *
 * The browser lane identifies messages by a DOM fingerprint —
 * sender|subject|renderedDate, built in outlook-browser-v2/outlook-actions.ts.
 * The renderedDate component is Outlook Web's locale/relative display string
 * ("Tue", "Mon 5/22", "9:42 AM"), which cannot be cleanly computed from
 * Graph's ISO receivedDateTime, so Graph reads cannot emit browser-compatible
 * ids. Instead every Graph-emitted id carries this prefix; browser-lane
 * operations (reply/forward/mark-read/attachments) must detect the prefix and
 * refuse with structured guidance rather than scroll the inbox hunting for a
 * fingerprint that can never match. The raw Graph REST id is preserved in a
 * separate `graphId` field for Graph-side follow-up calls.
 */
export const GRAPH_MESSAGE_ID_PREFIX = 'graph:';

export function isGraphMessageId(id: string): boolean {
  return id.startsWith(GRAPH_MESSAGE_ID_PREFIX);
}

function toPrefixedGraphId(restId: string): string {
  return `${GRAPH_MESSAGE_ID_PREFIX}${restId}`;
}

function toGraphRestId(id: string): string {
  return isGraphMessageId(id) ? id.slice(GRAPH_MESSAGE_ID_PREFIX.length) : id;
}

/** InboxMessage plus the Graph-only fields the adapter carries alongside. */
export type GraphInboxMessage = InboxMessage & {
  /** Raw Microsoft Graph REST id, for Graph-side follow-up calls. */
  graphId: string;
  /** From Graph's hasAttachments; feeds the search hasAttachment filter. */
  hasAttachments: boolean;
};

/** Structured refusal shared with SendEmailResult's refused variant; used
 *  where the browser-lane result type has no refused member (draft). */
export interface GraphOutlookRefusal {
  status: 'refused';
  reason: string;
}

const GRAPH_DRAFT_REFUSAL_REASON =
  'Microsoft 365 denied draft creation (403 ErrorAccessDenied). Ask the tenant '
  + 'administrator to grant Mail.ReadWrite for this app, or use the Outlook '
  + 'browser lane instead.';

const GRAPH_SEND_REFUSAL_REASON =
  'Microsoft 365 denied sending (403 ErrorAccessDenied). Ask the tenant '
  + 'administrator to grant Mail.Send for this app, or use the Outlook browser '
  + 'lane instead.';

function isGraphAccessDenied(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const { status, code } = err as { status?: number; code?: string };
  return status === 403 || code === 'ErrorAccessDenied';
}

function addressLabel(value?: GraphEmailAddress): string {
  if (!value) return '';
  if (value.name && value.address) return `${value.name} <${value.address}>`;
  return value.name || value.address || '';
}

function recipientAddresses(value?: GraphRecipient[]): string[] {
  return (value ?? [])
    .map((recipient) => recipient.emailAddress?.address || recipient.emailAddress?.name || '')
    .filter(Boolean);
}

function stripHtml(value: string): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function toInboxMessage(message: GraphMessage): GraphInboxMessage {
  const sender = message.from?.emailAddress ?? message.sender?.emailAddress;
  const restId = message.id ?? '';
  return {
    id: restId ? toPrefixedGraphId(restId) : '',
    graphId: restId,
    subject: message.subject ?? '',
    sender: addressLabel(sender),
    snippet: message.bodyPreview ?? '',
    receivedAt: message.receivedDateTime ?? '',
    unread: message.isRead === false,
    hasAttachments: message.hasAttachments === true,
  };
}

function matchesSearch(message: GraphInboxMessage, args: SearchInboxArgs): boolean {
  if (args.from && !message.sender.toLowerCase().includes(args.from.toLowerCase())) return false;
  if (
    args.subjectContains
    && !message.subject.toLowerCase().includes(args.subjectContains.toLowerCase())
  ) {
    return false;
  }
  if (typeof args.unread === 'boolean' && message.unread !== args.unread) return false;
  if (args.dateGte && message.receivedAt && new Date(message.receivedAt) < new Date(args.dateGte)) {
    return false;
  }
  if (args.dateLt && message.receivedAt && new Date(message.receivedAt) >= new Date(args.dateLt)) {
    return false;
  }
  if (typeof args.hasAttachment === 'boolean' && message.hasAttachments !== args.hasAttachment) {
    return false;
  }
  return true;
}

function normalizeGraphSendArgs(args: DraftEmailArgs): GraphSendMailArgs {
  return {
    subject: args.subject,
    body: args.body,
    to: args.to,
    cc: args.cc,
    bcc: args.bcc,
  };
}

function normalizeGraphDraftArgs(args: DraftEmailArgs): DraftReplyArgs {
  return {
    subject: args.subject,
    body: args.body,
    to: args.to,
    cc: args.cc,
    bcc: args.bcc,
  };
}

export async function isGraphOutlookAvailable(): Promise<boolean> {
  const status = await getStatus();
  return status.signedIn || status.mockMailbox;
}

export async function readInboxWithGraph(top = 10): Promise<ReadInboxResult> {
  const data = await graphCalls.listMessages({ top } satisfies ListMessagesArgs);
  const messages = ((data as { value?: GraphMessage[] }).value ?? [])
    .map(toInboxMessage)
    .filter((message) => message.id);
  return {
    status: 'ok',
    messages,
    scan: {
      scope: 'graph_inbox',
      requestedTop: top,
      scannedCount: messages.length,
      returnedCount: messages.length,
      exhaustive: messages.length < top,
      note: messages.length < top
        ? 'Graph returned fewer messages than requested for this Inbox page.'
        : 'Graph returned the requested page size; more Inbox messages may exist beyond this page.',
    },
  };
}

export async function searchInboxWithGraph(args: SearchInboxArgs): Promise<SearchInboxResult> {
  const fetchTop = Math.max(args.top ?? 25, 25);
  const data = await graphCalls.listMessages({ top: fetchTop } satisfies ListMessagesArgs);
  const scanned = ((data as { value?: GraphMessage[] }).value ?? [])
    .map(toInboxMessage)
    .filter((message) => message.id);
  const filtered = scanned.filter((message) => matchesSearch(message, args));
  const top = args.top ?? 25;
  const messages = filtered.slice(0, top);
  return {
    status: 'ok',
    messages,
    capped: filtered.length > top || scanned.length >= fetchTop,
    scan: {
      scope: 'graph_inbox',
      requestedTop: top,
      fetchedTop: fetchTop,
      scannedCount: scanned.length,
      matchedCount: filtered.length,
      returnedCount: messages.length,
      exhaustive: scanned.length < fetchTop,
      note: scanned.length < fetchTop
        ? 'Graph returned fewer messages than requested for this Inbox page.'
        : 'Graph returned the requested page size; more Inbox messages may exist beyond this page.',
    },
  };
}

async function fetchGraphAttachmentInfo(restId: string): Promise<EmailAttachmentInfo[]> {
  try {
    const data = await graphCalls.listAttachments(restId);
    return ((data as { value?: GraphAttachment[] }).value ?? [])
      .filter((attachment) => Boolean(attachment?.name))
      .map((attachment) => ({
        filename: attachment.name as string,
        sizeBytes: typeof attachment.size === 'number' ? attachment.size : undefined,
        mimeType: attachment.contentType || undefined,
      }));
  } catch (err) {
    // Metadata is a nice-to-have on read; never fail the whole read over it.
    logger.warn(
      `[msgraph] attachment metadata fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }
}

export async function readEmailWithGraph(
  args: ReadEmailArgs,
): Promise<ReadEmailResult & { graphId?: string }> {
  const restId = toGraphRestId(args.id);
  const message = await graphCalls.getMessage(restId) as GraphMessage;
  if (!message?.id) {
    return { status: 'not_found', id: args.id, message: 'Message not found' };
  }
  const body = message.body?.content
    ? stripHtml(message.body.content)
    : message.bodyPreview;
  const attachments = message.hasAttachments === true
    ? await fetchGraphAttachmentInfo(message.id)
    : [];
  return {
    status: 'ok',
    id: toPrefixedGraphId(message.id),
    graphId: message.id,
    subject: message.subject ?? '',
    sender: addressLabel(message.from?.emailAddress ?? message.sender?.emailAddress),
    receivedAt: message.receivedDateTime ?? '',
    body,
    recipients: {
      to: recipientAddresses(message.toRecipients),
      cc: recipientAddresses(message.ccRecipients),
      bcc: recipientAddresses(message.bccRecipients),
    },
    attachments,
  };
}

export async function draftEmailWithGraph(
  args: DraftEmailArgs,
): Promise<DraftEmailResult | GraphOutlookRefusal> {
  try {
    await graphCalls.createDraft(normalizeGraphDraftArgs(args));
  } catch (err) {
    if (isGraphAccessDenied(err)) {
      return { status: 'refused', reason: GRAPH_DRAFT_REFUSAL_REASON };
    }
    throw err;
  }
  return {
    status: 'drafted',
    draftLeftOpen: false,
    preview: {
      to: Array.isArray(args.to) ? args.to : [args.to],
      cc: args.cc ? (Array.isArray(args.cc) ? args.cc : [args.cc]) : [],
      bcc: args.bcc ? (Array.isArray(args.bcc) ? args.bcc : [args.bcc]) : [],
      subject: args.subject,
      body: args.body,
    },
    message: 'Draft saved to Outlook through Microsoft Graph. It was not opened in Chrome.',
  };
}

export async function sendEmailWithGraph(args: SendEmailArgs): Promise<SendEmailResult> {
  if (args.confirm !== true) {
    return {
      status: 'refused',
      reason: 'confirm flag required before sending through Microsoft Graph',
    };
  }
  if (!args.to || !args.subject || typeof args.body !== 'string' || args.body.trim().length === 0) {
    return {
      status: 'refused',
      reason:
        'Graph send requires explicit to, subject, and body because it cannot verify a visible reviewed Outlook draft.',
    };
  }
  try {
    await graphCalls.sendMail(normalizeGraphSendArgs({
      to: args.to,
      subject: args.subject,
      body: args.body,
      cc: args.cc,
      bcc: args.bcc,
    }));
  } catch (err) {
    if (isGraphAccessDenied(err)) {
      return { status: 'refused', reason: GRAPH_SEND_REFUSAL_REASON };
    }
    throw err;
  }
  return { status: 'sent', message: 'Sent through Microsoft Graph' };
}
