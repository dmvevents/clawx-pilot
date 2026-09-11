import { describe, expect, it } from 'vitest';
import {
  INBOX_ROW_PARSER_BROWSER_SOURCE,
  inboxRowId,
  isInboxDateLike,
  parseInboxRowTexts,
  splitInboxRowId,
} from '../../electron/services/outlook-browser-v2/inbox-row-parser';

// Text-node sequences as Outlook Web renders them (captured shapes from the
// installed moe.35 readback, 2026-09-11; content synthetic).
const DRAFT_MARKED_NEWEST = [
  'CC', '[Draft]', 'Corporate Communications',
  'Media Release: Increased Student Attendance on the First Day of New Academic Year 2026/2027',
  'Tue 2:15 PM', 'Dear Team MOE, kindly see the media release',
];
const PLAIN_ROW = ['CC', 'Corporate Communications', 'Media Release: All 777 Schools Open for the Start of the 2026/2027 Academic Year', 'Mon 7 Sep', 'Dear Team MOE'];
const JUNE_ROW = ['CC', 'Corporate Communications', "Greetings: Happy Father's Day", '21 Jun 2026', 'Dear Team MOE, On the occasion of'];
const STATE_TOKENS_ROW = ['Unread', 'Has attachments', 'CC', 'Corporate Communications', 'Notice: Calendar for the Academic Year 2026 - 2027', '16 Jun', 'Good afternoon'];

describe('isInboxDateLike', () => {
  it('accepts weekday, month-first, day-first, numeric and clock forms', () => {
    for (const s of ['Tue 2:15 PM', 'Mon 7 Sep', 'Yesterday', 'Sep 7', 'Jun 21, 2026', '21 Jun 2026', '16 Jun', '7/9/2026', '07/09', '10:23 PM', '9:05']) {
      expect(isInboxDateLike(s), s).toBe(true);
    }
  });
  it('rejects subject-like and long text', () => {
    for (const s of ['Media Release', 'Dear Team MOE', 'Corporate Communications', '', 'x'.repeat(31), 'Monthly report attached']) {
      expect(isInboxDateLike(s), s).toBe(false);
    }
  });
});

describe('parseInboxRowTexts', () => {
  it('keeps a [Draft]-marked conversation as real mail and never uses the marker as the sender', () => {
    const p = parseInboxRowTexts(DRAFT_MARKED_NEWEST, 'Collapsed Has attachments [Draft] Corporate Communications Media Release');
    expect(p.hasDraft).toBe(true);
    expect(p.sender).toBe('Corporate Communications');
    expect(p.subject).toMatch(/^Media Release: Increased Student Attendance/);
    expect(p.receivedAt).toBe('Tue 2:15 PM');
    expect(p.snippet).toMatch(/^Dear Team MOE/);
  });
  it('parses a plain row', () => {
    const p = parseInboxRowTexts(PLAIN_ROW, 'Unread Corporate Communications Media Release');
    expect(p).toMatchObject({ sender: 'Corporate Communications', receivedAt: 'Mon 7 Sep', hasDraft: false, unread: true });
    expect(p.subject).toBe('Media Release: All 777 Schools Open for the Start of the 2026/2027 Academic Year');
  });
  it('recognises day-first dates so the date and preview no longer fold into the subject', () => {
    const p = parseInboxRowTexts(JUNE_ROW, '');
    expect(p.subject).toBe("Greetings: Happy Father's Day");
    expect(p.receivedAt).toBe('21 Jun 2026');
    expect(p.snippet).toMatch(/^Dear Team MOE/);
  });
  it('skips row-state tokens before the sender', () => {
    const p = parseInboxRowTexts(STATE_TOKENS_ROW, 'Unread Has attachments');
    expect(p.sender).toBe('Corporate Communications');
    expect(p.subject).toBe('Notice: Calendar for the Academic Year 2026 - 2027');
    expect(p.receivedAt).toBe('16 Jun');
    expect(p.unread).toBe(true);
  });
  it('detects the draft marker from the aria-label when the text node is absent', () => {
    const p = parseInboxRowTexts(PLAIN_ROW, 'Collapsed [Draft] Corporate Communications');
    expect(p.hasDraft).toBe(true);
    expect(p.sender).toBe('Corporate Communications');
  });
});

describe('inboxRowId', () => {
  it('keeps the received time for long subjects (the 96-char total slice used to drop it)', () => {
    const p = parseInboxRowTexts(PLAIN_ROW, '');
    const id = inboxRowId(p.sender, p.subject, p.receivedAt);
    expect(id.length).toBeGreaterThan(96);
    // the subject part is bounded to 72 chars on its own; the time part survives regardless of subject length
    expect(splitInboxRowId(id)).toEqual({ sender: 'Corporate Communications', subject: p.subject.slice(0, 72), receivedAt: 'Mon 7 Sep' });
  });
  it('is empty when there is neither sender nor subject', () => {
    expect(inboxRowId('', '', 'Mon 7 Sep')).toBe('');
  });
});

describe('INBOX_ROW_PARSER_BROWSER_SOURCE', () => {
  it('is self-contained and computes the same fingerprint as the Node functions', () => {
    // Evaluate the serialized source exactly as page.evaluate would, then call
    // the browser-side entry points on a fake row element.
    const fakeRow = {
      getAttribute: (name: string) => (name === 'aria-label' ? 'Collapsed [Draft] Corporate Communications' : null),
      nodeType: 1,
      childNodes: DRAFT_MARKED_NEWEST.map((t) => ({ nodeType: 3, textContent: t, childNodes: [] })),
    };
    const run = new Function(
      'row',
      `${INBOX_ROW_PARSER_BROWSER_SOURCE}\nreturn { fp: inboxRowFingerprint(row), texts: walkRowTexts(row) };`,
    ) as (row: unknown) => { fp: string; texts: string[] };
    const browser = run(fakeRow);
    const node = parseInboxRowTexts(DRAFT_MARKED_NEWEST, 'Collapsed [Draft] Corporate Communications');
    expect(browser.texts).toEqual(DRAFT_MARKED_NEWEST);
    expect(browser.fp).toBe(inboxRowId(node.sender, node.subject, node.receivedAt));
    expect(browser.fp).toMatch(/^Corporate Communications\|Media Release: Increased Student Attendance/);
    expect(browser.fp.endsWith('|Tue 2:15 PM')).toBe(true);
  });
  it('contains no TypeScript-only syntax or module references', () => {
    expect(INBOX_ROW_PARSER_BROWSER_SOURCE).not.toMatch(/\bexport\b|\bimport\b|: string|: boolean|: number|ParsedInboxRow/);
  });
});
