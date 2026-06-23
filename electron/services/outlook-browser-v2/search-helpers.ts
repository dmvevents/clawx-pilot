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
 * Date matching understands Outlook Web's no-year display strings such as
 * "Tue 9 Jun", "Fri 19 Jun", "Mon 9:32 AM", and "10:23 PM". Date.parse()
 * treats some of those as year 2001, so normalize them before falling back to
 * Date.parse. If parsing still fails, keep the older behavior and skip the
 * date filter rather than incorrectly excluding the message.
 */
const MONTHS: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

const WEEKDAYS: Record<string, number> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
};

function inferRecentYear(month: number, day: number, now: Date): number {
  let year = now.getFullYear();
  const inferred = new Date(year, month, day);
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (inferred.getTime() > tomorrow.getTime()) year -= 1;
  return year;
}

function parseTimeParts(value = ''): { hour: number; minute: number } {
  const match = value.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!match) return { hour: 0, minute: 0 };
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const meridiem = match[3]?.toUpperCase();
  if (meridiem === 'PM' && hour < 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;
  return { hour, minute };
}

function recentWeekdayDate(weekday: number, timeText: string | undefined, now: Date): number {
  const { hour, minute } = parseTimeParts(timeText);
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute);
  let delta = (date.getDay() - weekday + 7) % 7;
  if (delta === 0 && date.getTime() > now.getTime()) delta = 7;
  date.setDate(date.getDate() - delta);
  return date.getTime();
}

export function parseOutlookReceivedAt(value: string, now = new Date()): number | null {
  const text = value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return null;

  const iso = text.match(/^\d{4}-\d{2}-\d{2}(?:[T\s]|$)/);
  if (iso) {
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? parsed : null;
  }

  const monthDay = text.match(
    /^(?:(Sun|Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat)\w*\s+)?(?:(\d{1,2})\s+([A-Za-z]{3,9})|([A-Za-z]{3,9})\s+(\d{1,2}))(?:,?\s+(\d{4}))?(?:\s+(\d{1,2}(?::\d{2})?\s*(?:AM|PM)?))?$/i,
  );
  if (monthDay) {
    const day = Number(monthDay[2] ?? monthDay[5]);
    const monthName = String(monthDay[3] ?? monthDay[4]).toLowerCase();
    const month = MONTHS[monthName];
    if (month !== undefined && Number.isFinite(day)) {
      const year = monthDay[6] ? Number(monthDay[6]) : inferRecentYear(month, day, now);
      const { hour, minute } = parseTimeParts(monthDay[7]);
      return new Date(year, month, day, hour, minute).getTime();
    }
  }

  const numericMonthDay = text.match(
    /^(?:(Sun|Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat)\w*\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?:\s+(\d{1,2}(?::\d{2})?\s*(?:AM|PM)?))?$/i,
  );
  if (numericMonthDay) {
    const month = Number(numericMonthDay[2]) - 1;
    const day = Number(numericMonthDay[3]);
    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      const rawYear = numericMonthDay[4];
      const year = rawYear
        ? Number(rawYear.length === 2 ? `20${rawYear}` : rawYear)
        : inferRecentYear(month, day, now);
      const { hour, minute } = parseTimeParts(numericMonthDay[5]);
      return new Date(year, month, day, hour, minute).getTime();
    }
  }

  const weekdayTime = text.match(/^(Sun|Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat)\w*(?:\s+at)?\s+(\d{1,2}(?::\d{2})?\s*(?:AM|PM)?)$/i);
  if (weekdayTime) {
    const weekday = WEEKDAYS[weekdayTime[1].toLowerCase()];
    if (weekday !== undefined) return recentWeekdayDate(weekday, weekdayTime[2], now);
  }

  const relativeDay = text.match(/^(Today|Yesterday)(?:\s+at)?\s+(\d{1,2}(?::\d{2})?\s*(?:AM|PM)?)$/i);
  if (relativeDay) {
    const { hour, minute } = parseTimeParts(relativeDay[2]);
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute);
    if (/yesterday/i.test(relativeDay[1])) date.setDate(date.getDate() - 1);
    return date.getTime();
  }

  const timeOnly = text.match(/^(\d{1,2}(?::\d{2})\s*(?:AM|PM))$/i);
  if (timeOnly) {
    const { hour, minute } = parseTimeParts(timeOnly[1]);
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute);
    if (date.getTime() > now.getTime()) date.setDate(date.getDate() - 1);
    return date.getTime();
  }

  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

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
    const t = parseOutlookReceivedAt(m.receivedAt);
    if (t !== null) {
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
