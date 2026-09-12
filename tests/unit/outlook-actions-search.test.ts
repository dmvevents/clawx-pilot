/**
 * Unit tests for the search-args matcher used by OutlookActions.searchInbox.
 *
 * The function under test is a pure predicate; no Playwright or Outlook
 * required. We import it indirectly by going through the module's
 * file path so the function lives close to its real call site.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

// Re-implement the predicate in the test file for now — it's not exported
// from outlook-actions.ts yet because keeping it module-local matches the
// service style. If we want richer testing we'll lift it to a util file.
// For coverage purposes we import via a tiny bridge: the helper has to be
// reachable to vitest, so I'll put it in a sibling helpers module rather
// than test-by-shape only.

import type { InboxMessage, SearchInboxArgs } from '@electron/services/outlook-browser-v2/types';
import { matchesSearchArgsForTests, parseOutlookReceivedAt } from '@electron/services/outlook-browser-v2/search-helpers';

const baseMsg: InboxMessage = {
  id: 'sender-a|subj|today',
  sender: 'AllFacultyMail',
  subject: 'Welcome to the AllFacultyMail group',
  snippet: 'You have joined a group',
  receivedAt: '2026-05-23T15:46:00Z',
  unread: true,
};

function withMsg(over: Partial<InboxMessage>): InboxMessage {
  return { ...baseMsg, ...over };
}

function expectMatch(args: SearchInboxArgs, msg: InboxMessage = baseMsg) {
  expect(matchesSearchArgsForTests(msg, args)).toBe(true);
}
function expectNoMatch(args: SearchInboxArgs, msg: InboxMessage = baseMsg) {
  expect(matchesSearchArgsForTests(msg, args)).toBe(false);
}

describe('matchesSearchArgs', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('passes when no filter is set', () => {
    expectMatch({});
  });

  it('matches sender substring case-insensitively', () => {
    expectMatch({ from: 'allfaculty' });
    expectMatch({ from: 'FACULTY' });
    expectNoMatch({ from: 'districtoffice' });
  });

  it('matches subject substring case-insensitively', () => {
    expectMatch({ subjectContains: 'welcome' });
    expectMatch({ subjectContains: 'GROUP' });
    expectNoMatch({ subjectContains: 'budget' });
  });

  // CLWX-143: "emails about <topic>" must reach the preview text; the existing
  // subject filter must keep its subject-only meaning.
  it('matches topicContains against the subject', () => {
    expectMatch({ topicContains: 'welcome' });
    expectMatch({ topicContains: 'GROUP' });
  });

  it('matches topicContains against preview text the subject filter cannot see', () => {
    const previewOnly = withMsg({
      subject: 'Welcome Back to a New School Year',
      snippet: 'Dear Colleagues, the new Academic Year begins on Monday.',
    });
    expectMatch({ topicContains: 'academic year' }, previewOnly);
    expectNoMatch({ subjectContains: 'academic year' }, previewOnly);
  });

  it('excludes rows whose subject and preview both lack the topic', () => {
    expectNoMatch({ topicContains: 'academic year' });
    expectNoMatch({ topicContains: 'budget' });
  });

  it('normalizes whitespace when matching a topic', () => {
    const spaced = withMsg({ subject: 'The  academic\n year plan', snippet: '' });
    expectMatch({ topicContains: 'academic year' }, spaced);
    expectMatch({ topicContains: 'academic   year' }, spaced);
  });

  it('treats a blank topicContains as no filter', () => {
    expectMatch({ topicContains: '' });
    expectMatch({ topicContains: '   ' });
  });

  // Review finding MAJOR-1: the frozen prompt asks for subject lines as OUTPUT,
  // so a model may add subjectContains to a topical search. With the same
  // needle that must not exclude the preview-only row.
  it('applies the topic filter alone when both text filters carry the same needle', () => {
    const previewOnly = withMsg({
      subject: 'Welcome Back to a New School Year',
      snippet: 'Dear Colleagues, the new Academic Year begins on Monday.',
    });
    expectMatch({ subjectContains: 'academic year', topicContains: 'academic year' }, previewOnly);
    expectMatch({ subjectContains: 'Academic  Year', topicContains: 'academic year' }, previewOnly);
    // Still excludes rows that carry the topic nowhere.
    expectNoMatch({ subjectContains: 'academic year', topicContains: 'academic year' });
  });

  it('keeps a strict AND when the two text filters differ', () => {
    const previewOnly = withMsg({
      subject: 'Welcome Back to a New School Year',
      snippet: 'Dear Colleagues, the new Academic Year begins on Monday.',
    });
    expectMatch({ subjectContains: 'welcome', topicContains: 'academic year' }, previewOnly);
    expectNoMatch({ subjectContains: 'circular', topicContains: 'academic year' }, previewOnly);
  });

  it('combines topicContains with the other filters as AND', () => {
    expectMatch({ from: 'AllFaculty', topicContains: 'joined a group' });
    expectNoMatch({ from: 'districtoffice', topicContains: 'joined a group' });
    expectNoMatch({ topicContains: 'joined a group', unread: false });
    // Both text filters supplied: subject-only AND subject-or-preview.
    expectMatch({ subjectContains: 'welcome', topicContains: 'joined a group' });
    expectNoMatch({ subjectContains: 'budget', topicContains: 'joined a group' });
  });

  it('combines from and subjectContains as AND', () => {
    expectMatch({ from: 'AllFaculty', subjectContains: 'welcome' });
    expectNoMatch({ from: 'AllFaculty', subjectContains: 'budget' });
    expectNoMatch({ from: 'districtoffice', subjectContains: 'welcome' });
  });

  it('honours unread === true', () => {
    expectMatch({ unread: true });
    expectNoMatch({ unread: true }, withMsg({ unread: false }));
  });

  it('honours unread === false', () => {
    expectNoMatch({ unread: false });
    expectMatch({ unread: false }, withMsg({ unread: false }));
  });

  it('skips date filter silently when receivedAt is unparseable', () => {
    // Outlook emits relative formats like "Fri 3:46 PM" that Date.parse
    // returns NaN for. The function should not over-exclude in that case.
    const m = withMsg({ receivedAt: 'Fri 3:46 PM' });
    expectMatch({ dateGte: '2026-05-22' }, m);
  });

  it('treats Outlook no-year day-month display dates as the current/recent year', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-23T12:00:00-04:00'));

    expectMatch(
      { dateGte: '2026-06-01T00:00:00.000Z', dateLt: '2026-07-01T00:00:00.000Z' },
      withMsg({ receivedAt: 'Tue 9 Jun' }),
    );
    expectNoMatch(
      { dateGte: '2026-06-01T00:00:00.000Z', dateLt: '2026-07-01T00:00:00.000Z' },
      withMsg({ receivedAt: 'Tue 26 May' }),
    );
  });

  it('treats Outlook weekday-time display dates as recent week dates', () => {
    const parsed = parseOutlookReceivedAt(
      'Mon 9:32 AM',
      new Date('2026-06-23T12:00:00-04:00'),
    );

    expect(parsed).not.toBeNull();
    expect(new Date(parsed ?? 0).getFullYear()).toBe(2026);
    expect(new Date(parsed ?? 0).getMonth()).toBe(5);
    expect(new Date(parsed ?? 0).getDate()).toBe(22);
  });

  it('treats Outlook no-year numeric dates as the current/recent year', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-23T12:00:00-04:00'));

    expectMatch(
      { dateGte: '2026-06-01T00:00:00.000Z', dateLt: '2026-07-01T00:00:00.000Z' },
      withMsg({ receivedAt: '6/10' }),
    );
    expectNoMatch(
      { dateGte: '2026-06-01T00:00:00.000Z', dateLt: '2026-07-01T00:00:00.000Z' },
      withMsg({ receivedAt: '5/22' }),
    );
  });

  it('honours dateGte when receivedAt is ISO', () => {
    expectMatch({ dateGte: '2026-05-22' });
    expectNoMatch({ dateGte: '2026-06-01' });
  });

  it('honours dateLt as exclusive upper bound', () => {
    expectMatch({ dateLt: '2026-05-24' });
    expectNoMatch({ dateLt: '2026-05-23' });
  });

  it('hasAttachment uses snippet sniff', () => {
    expectNoMatch({ hasAttachment: true });
    expectMatch({ hasAttachment: true }, withMsg({ snippet: 'See attached PDF' }));
    expectMatch({ hasAttachment: true }, withMsg({ snippet: 'Attachment: report.xlsx' }));
  });
});
