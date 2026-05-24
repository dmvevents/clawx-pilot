/**
 * Predicate helpers extracted from outlook-actions.ts so unit tests can
 * import them directly without bringing Playwright into the test runner.
 *
 * Keep the contract narrow: pure functions, no side effects, no DOM. If
 * you find yourself adding state here, push it back into OutlookActions.
 */
import type { InboxMessage, SearchInboxArgs } from './types';

/**
 * Client-side filter applied to a row-list returned by readInbox(). Used
 * by OutlookActions.searchInbox.
 *
 * Date matching uses Date.parse on m.receivedAt — Outlook emits things
 * like "Fri 3:46 PM", "10:23 AM", "5/22" — Date.parse handles modern ISO
 * but not Outlook's relative formats. We do a best-effort: if Date.parse
 * fails, we treat the date filter as "skip" rather than incorrectly
 * excluding the message. This is the right trade-off for an inbox where
 * recent messages dominate.
 */
export function matchesSearchArgsForTests(m: InboxMessage, args: SearchInboxArgs): boolean {
  if (args.from) {
    if (!m.sender.toLowerCase().includes(args.from.toLowerCase())) return false;
  }
  if (args.subjectContains) {
    if (!m.subject.toLowerCase().includes(args.subjectContains.toLowerCase())) return false;
  }
  if (typeof args.unread === 'boolean') {
    if (m.unread !== args.unread) return false;
  }
  if (args.dateGte || args.dateLt) {
    const t = Date.parse(m.receivedAt);
    if (Number.isFinite(t)) {
      if (args.dateGte && t < Date.parse(args.dateGte)) return false;
      if (args.dateLt && t >= Date.parse(args.dateLt)) return false;
    }
  }
  if (args.hasAttachment === true) {
    const snip = (m.snippet || '').toLowerCase();
    if (!snip.includes('attachment') && !snip.includes('attached')) return false;
  }
  return true;
}
