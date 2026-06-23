/**
 * Outlook Host API adapter backed by Microsoft Graph.
 *
 * This lets installed builds use the signed-in Microsoft 365 account without
 * requiring Chrome/CDP setup. Browser automation remains the fallback for
 * visible compose review, attachments, and any action not mapped here yet.
 */
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
  from?: { emailAddress?: GraphEmailAddress };
  sender?: { emailAddress?: GraphEmailAddress };
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  bccRecipients?: GraphRecipient[];
  body?: { content?: string; contentType?: string };
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

function toInboxMessage(message: GraphMessage): InboxMessage {
  const sender = message.from?.emailAddress ?? message.sender?.emailAddress;
  return {
    id: message.id ?? '',
    subject: message.subject ?? '',
    sender: addressLabel(sender),
    snippet: message.bodyPreview ?? '',
    receivedAt: message.receivedDateTime ?? '',
    unread: message.isRead === false,
  };
}

function matchesSearch(message: InboxMessage, args: SearchInboxArgs): boolean {
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

export async function readEmailWithGraph(args: ReadEmailArgs): Promise<ReadEmailResult> {
  const message = await graphCalls.getMessage(args.id) as GraphMessage;
  if (!message?.id) {
    return { status: 'not_found', id: args.id, message: 'Message not found' };
  }
  const body = message.body?.content
    ? stripHtml(message.body.content)
    : message.bodyPreview;
  return {
    status: 'ok',
    id: message.id,
    subject: message.subject ?? '',
    sender: addressLabel(message.from?.emailAddress ?? message.sender?.emailAddress),
    receivedAt: message.receivedDateTime ?? '',
    body,
    recipients: {
      to: recipientAddresses(message.toRecipients),
      cc: recipientAddresses(message.ccRecipients),
      bcc: recipientAddresses(message.bccRecipients),
    },
    attachments: [],
  };
}

export async function draftEmailWithGraph(args: DraftEmailArgs): Promise<DraftEmailResult> {
  await graphCalls.createDraft(normalizeGraphDraftArgs(args));
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
  await graphCalls.sendMail(normalizeGraphSendArgs({
    to: args.to,
    subject: args.subject,
    body: args.body,
    cc: args.cc,
    bcc: args.bcc,
  }));
  return { status: 'sent', message: 'Sent through Microsoft Graph' };
}
