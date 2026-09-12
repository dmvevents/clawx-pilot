/**
 * CLWX-143: search predicates shared by every Outlook transport.
 *
 * Both the browser scan (outlook-browser-v2) and Microsoft Graph filter an
 * already-fetched list of rows, so the topic predicate and the coverage
 * descriptor must be one implementation — a topic that matches under one
 * transport and not the other would make the same prompt answer differently
 * depending on how the principal is signed in.
 *
 * Pure functions only: no DOM, no Playwright, no network. This module lives
 * next to the shared type contract that both transports already import.
 */
import type { InboxMessage, SearchInboxArgs } from './types';

/**
 * Case-fold and collapse whitespace so a topic typed as "academic  year"
 * matches a row rendered with a non-breaking space or a line break.
 * Deliberately NOT applied to `subjectContains`, whose exact substring
 * semantics existing callers and frozen acceptance rows depend on.
 */
export function normalizeTopicText(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * "Emails about <topic>" matches the subject OR the row's visible preview
 * text. It never sees the full message body: a list scan only has the preview
 * line Outlook renders (Graph's equivalent is `bodyPreview`). A blank or
 * whitespace-only topic is treated as no filter, matching how the other
 * optional string filters behave.
 */
export function matchesTopicText(
  message: Pick<InboxMessage, 'subject' | 'snippet'>,
  topic: string,
): boolean {
  const needle = normalizeTopicText(topic);
  if (!needle) return true;
  if (normalizeTopicText(message.subject ?? '').includes(needle)) return true;
  return normalizeTopicText(message.snippet ?? '').includes(needle);
}

export type SearchCoverageField = 'sender' | 'subject' | 'preview';

/**
 * Report the row text the supplied filters actually compared, so a tool result
 * cannot be read as a full-text mailbox search. `bodySearched` is a constant
 * false on both transports; a transport that ever searches bodies must say so
 * itself rather than leaving this claim stale.
 *
 * `attachmentSignal` differs by transport: the browser scan infers attachments
 * from the preview text, while Graph reads the `hasAttachments` property.
 */
export function describeSearchCoverage(
  args: SearchInboxArgs,
  options: { attachmentSignal: 'preview' | 'metadata' },
): { matchedFields: SearchCoverageField[]; bodySearched: false } {
  const fields = new Set<SearchCoverageField>();
  if (args.from) fields.add('sender');
  if (args.subjectContains) fields.add('subject');
  if (normalizeTopicText(args.topicContains ?? '')) {
    fields.add('subject');
    fields.add('preview');
  }
  if (args.hasAttachment === true && options.attachmentSignal === 'preview') fields.add('preview');
  const order: SearchCoverageField[] = ['sender', 'subject', 'preview'];
  return { matchedFields: order.filter((field) => fields.has(field)), bodySearched: false };
}

/**
 * Appended to the scan note only when a topic filter ran, so the model states
 * the real coverage of a broad "about <topic>" search.
 */
export const TOPIC_COVERAGE_NOTE = 'Topic matching compared each scanned row\'s subject and its visible preview text only; message bodies and attachments were not searched, so this is not an exhaustive topic search.';

/**
 * Main-side validation for the topic filter. Scoped to the new argument on
 * purpose: type-checking the pre-existing arguments here would turn requests
 * the service currently ignores into 400s and change search behaviour.
 */
export function validateSearchInboxTopicArg(body: unknown): string | null {
  const value = (body as { topicContains?: unknown } | null | undefined)?.topicContains;
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return 'topicContains must be a string';
  return null;
}
