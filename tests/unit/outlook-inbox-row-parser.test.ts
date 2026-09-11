// @vitest-environment node
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import {
  INBOX_ROW_PARSER_BROWSER_SOURCE,
  inboxRowId,
  isInboxDateLike,
  isInboxStateToken,
  parseInboxRowTexts,
  splitInboxRowId,
} from '../../electron/services/outlook-browser-v2/inbox-row-parser';

// Text-node sequences as Outlook Web renders them (shapes captured from the
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
  it('accepts the received-time forms Outlook renders', () => {
    for (const s of [
      'Tue 2:15 PM', 'Mon 7 Sep', 'Tuesday', 'Yesterday', 'Today 09:15', 'Sep 7', 'Jun 21, 2026',
      '21 Jun 2026', '16 Jun', '7/9/2026', '07/09', '10:23 PM', '9:05', 'Mon 5/22', 'Fri 19 Jun',
    ]) {
      expect(isInboxDateLike(s), s).toBe(true);
    }
  });

  // Review lane A (M2): a month-prefix match made short SUBJECTS parse as
  // received times, which emptied the subject and dropped the row — the same
  // silent mail loss CLWX-143 exists to fix.
  it('rejects subjects that merely start with a month or weekday word', () => {
    for (const s of [
      'Decision on staffing', 'Marketing plan open day', 'October fair planning', 'Junior sports day',
      'Maybe reschedule Friday', 'Augment the roster', 'Novel reading week', 'Separate the Std 3 class',
      'Declaration of Assets', 'January intake list', 'Sunday service notice', 'Monitoring visit',
      'Satisfaction survey', 'Wednesday assembly plan',
    ]) {
      expect(isInboxDateLike(s), s).toBe(false);
    }
  });

  it('rejects other subject-like and over-long text', () => {
    for (const s of ['Media Release', 'Dear Team MOE', 'Corporate Communications', '', 'x'.repeat(31)]) {
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

  it('keeps a month-prefixed short subject as the subject (lane A M2 end to end)', () => {
    const p = parseInboxRowTexts(['DO', 'District Office', 'Decision on staffing', 'Mon 7 Sep', 'Please review'], '');
    expect(p.subject).toBe('Decision on staffing');
    expect(p.receivedAt).toBe('Mon 7 Sep');
    expect(inboxRowId(p.sender, p.subject, p.receivedAt)).toBe('District Office|Decision on staffing|Mon 7 Sep');
  });

  it('skips row-state tokens before the sender', () => {
    const p = parseInboxRowTexts(STATE_TOKENS_ROW, 'Unread Has attachments');
    expect(p.sender).toBe('Corporate Communications');
    expect(p.subject).toBe('Notice: Calendar for the Academic Year 2026 - 2027');
    expect(p.receivedAt).toBe('16 Jun');
    expect(p.unread).toBe(true);
  });

  it('detects the draft marker from the aria-label, bracketed or bare', () => {
    for (const label of ['Collapsed [Draft] Corporate Communications', 'Collapsed Draft Corporate Communications']) {
      const p = parseInboxRowTexts(PLAIN_ROW, label);
      expect(p.hasDraft, label).toBe(true);
      expect(p.sender).toBe('Corporate Communications');
    }
  });

  /**
   * Review lane A M1 and its follow-up: consuming the marker shifts every later
   * field, so the row Outlook renders for an OPEN compose can present the
   * conversation title in the from slot and the draft body as the subject. That
   * shape cannot be told apart from a real preview-less conversation without a
   * live DOM capture, so the row stays VISIBLE (hiding it is the mail-loss
   * defect) and is refused as a WRITE target instead. The first attempt keyed
   * this on the token count before the received time; a reviewer proved that
   * condition inert, since it implies an empty from-field or subject.
   */
  it('marks a draft row with no preview as an untrustworthy WRITE target, in every shape a compose row can take', () => {
    for (const texts of [
      ['[Draft]', 'Karunesh Ramdass Meeting', 'Mon 10:08 PM'],
      ['Draft', 'Karunesh Ramdass Meeting', 'Mon 10:08 PM'],
      ['[Draft]', 'Karunesh Ramdass Meeting'],
      // the 4-node variant a reviewer measured: name and body split across two nodes
      ['[Draft]', 'Karunesh Ramdass', 'Sure, how about 3pm', 'Mon 10:08 PM'],
    ]) {
      const p = parseInboxRowTexts(texts, '');
      expect(p.hasDraft, texts.join('|')).toBe(true);
      expect(p.ambiguousDraftRow, texts.join('|')).toBe(true);
    }
  });

  it('does NOT mark a real conversation that merely holds a saved draft and shows a preview', () => {
    const real = parseInboxRowTexts(DRAFT_MARKED_NEWEST, 'Collapsed [Draft] Corporate Communications');
    expect(real).toMatchObject({ hasDraft: true, ambiguousDraftRow: false, sender: 'Corporate Communications' });
    expect(real.snippet).toMatch(/^Dear Team MOE/);
  });

  it('classifies row-state words', () => {
    expect(isInboxStateToken('Unread')).toBe(true);
    expect(isInboxStateToken('Has attachments')).toBe(true);
    expect(isInboxStateToken('Corporate Communications')).toBe(false);
  });
});

describe('inboxRowId', () => {
  it('keeps the received time for long subjects (the 96-char total slice used to drop it)', () => {
    const p = parseInboxRowTexts(PLAIN_ROW, '');
    const id = inboxRowId(p.sender, p.subject, p.receivedAt);
    expect(id.length).toBeGreaterThan(96);
    expect(splitInboxRowId(id)).toEqual({ sender: 'Corporate Communications', subject: p.subject.slice(0, 72), receivedAt: 'Mon 7 Sep' });
  });

  it('is empty when there is neither sender nor subject', () => {
    expect(inboxRowId('', '', 'Mon 7 Sep')).toBe('');
  });
});

/** Evaluate the payload the way page.evaluate does and read back both entry points. */
function runPayload(source: string, row: unknown) {
  const fn = new Function(
    'row',
    `${source}\nreturn { detail: inboxRowFingerprintDetail(row), fp: inboxRowFingerprint(row), texts: walkRowTexts(row) };`,
  ) as (row: unknown) => { detail: { fp: string; hasDraft: boolean; ambiguousDraftRow: boolean }; fp: string; texts: string[] };
  return fn(row);
}

function fakeRow(texts: string[], ariaLabel: string) {
  return {
    getAttribute: (name: string) => (name === 'aria-label' ? ariaLabel : null),
    nodeType: 1,
    childNodes: texts.map((t) => ({ nodeType: 3, textContent: t, childNodes: [] })),
  };
}

describe('INBOX_ROW_PARSER_BROWSER_SOURCE', () => {
  it('is self-contained and computes the same fingerprint as the Node bindings', () => {
    const row = fakeRow(DRAFT_MARKED_NEWEST, 'Collapsed [Draft] Corporate Communications');
    const browser = runPayload(INBOX_ROW_PARSER_BROWSER_SOURCE, row);
    const node = parseInboxRowTexts(DRAFT_MARKED_NEWEST, 'Collapsed [Draft] Corporate Communications');
    expect(browser.texts).toEqual(DRAFT_MARKED_NEWEST);
    expect(browser.fp).toBe(inboxRowId(node.sender, node.subject, node.receivedAt));
    expect(browser.detail).toEqual({ fp: browser.fp, hasDraft: true, ambiguousDraftRow: false });
    expect(browser.fp.endsWith('|Tue 2:15 PM')).toBe(true);
  });

  it('declares every name the evaluate templates call', () => {
    for (const name of [
      'function parseInboxRowTexts', 'function inboxRowId', 'function walkRowTexts',
      'function inboxRowFingerprint', 'function inboxRowFingerprintDetail',
      'function isInboxDateLike', 'function isInboxStateToken', 'function isInboxDraftMarker',
    ]) {
      expect(INBOX_ROW_PARSER_BROWSER_SOURCE, name).toContain(name);
    }
  });

  it('contains no TypeScript-only syntax or module references', () => {
    expect(INBOX_ROW_PARSER_BROWSER_SOURCE).not.toMatch(/\bexport\b|\bimport\b|: string|: boolean|: number|ParsedInboxRow|=>/);
  });

  /**
   * BLOCKING regression (review lanes A and B, 2026-09-11): the first cut built
   * this payload from Function.prototype.toString() of module functions while
   * the evaluate templates called them by their source-level names. The
   * production main process is bundled by vite build WITHOUT a minify override,
   * so esbuild renames those declarations and the injected payload threw
   * ReferenceError in the packaged app — readInbox then reported an empty inbox
   * and reply/forward/markRead/downloadAttachment rejected. Every dev run and
   * every unminified test passed. This test bundles and minifies the real
   * module the way the build does, then evaluates the emitted payload.
   */
  it('survives a minified production-style bundle of its own module', async () => {
    const esbuild = await import('esbuild');
    const entry = path.resolve(__dirname, '../../electron/services/outlook-browser-v2/inbox-row-parser.ts');
    const built = esbuild.buildSync({
      entryPoints: [entry],
      bundle: true,
      write: false,
      format: 'cjs',
      platform: 'node',
      target: 'node20',
      minify: true,
      keepNames: false,
    });
    const code = built.outputFiles[0].text;
    // Identifier renaming really is in effect for this bundle.
    expect(code).not.toContain('parseInboxRowTexts=function');
    // esbuild's CJS output REPLACES module.exports, so read it back from the
    // module object rather than the initial exports reference.
    const mod: { exports: Record<string, unknown> } = { exports: {} };
    new Function('module', 'exports', 'require', code)(mod, mod.exports, (id: string) => {
      throw new Error(`unexpected require(${id}) in the bundled parser`);
    });
    const moduleExports = mod.exports;
    const minifiedSource = moduleExports.INBOX_ROW_PARSER_BROWSER_SOURCE as string;
    expect(typeof minifiedSource).toBe('string');
    // The payload is a string literal, so the names the templates call survive.
    expect(minifiedSource).toContain('function parseInboxRowTexts');
    const row = fakeRow(DRAFT_MARKED_NEWEST, 'Collapsed [Draft] Corporate Communications');
    const fromMinified = runPayload(minifiedSource, row);
    const fromSource = runPayload(INBOX_ROW_PARSER_BROWSER_SOURCE, row);
    expect(fromMinified.fp).toBe(fromSource.fp);
    expect(fromMinified.detail).toEqual(fromSource.detail);
    // And the minified module's own exported functions still work.
    const parse = moduleExports.parseInboxRowTexts as typeof parseInboxRowTexts;
    expect(parse(JUNE_ROW, '').receivedAt).toBe('21 Jun 2026');
  });
});
