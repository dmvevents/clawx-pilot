// @vitest-environment jsdom
/**
 * CLWX-61 missing-diff #1: DOM-fixture pin for read_email attachment metadata.
 *
 * Eval row W3.2 asserts that read_email({id}) returns an `attachments` array
 * whose entries carry a filename, a parsed size and a mime type where the
 * message has attachments. Until this file, the only coverage of that
 * extraction was a live eval run against a real mailbox, so a regression in
 * the extractor would only surface when someone re-ran the live lane and the
 * test account happened to hold attachment-bearing mail.
 *
 * The extractor is not a standalone function: it is the page-side script
 * that OutlookActions.readEmail passes to page.evaluate as a STRING
 * (electron/services/outlook-browser-v2/outlook-actions.ts, the
 * `Attachments:` block with its inline parseSize/guessMime helpers), and
 * listAttachments is a thin wrapper over readEmail. So the fake Playwright
 * page here does what Playwright does with a string argument — evaluates it
 * as an expression in the page — against a jsdom document seeded with an
 * Outlook-shaped reading pane. Nothing from the extractor is re-implemented
 * in this file; if the production script changes, these rows run the new
 * script.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OutlookActions } from '@electron/services/outlook-browser-v2/outlook-actions';
import { matchesSearchArgsForTests } from '@electron/services/outlook-browser-v2/search-helpers';
import type { EmailAttachmentInfo, InboxMessage } from '@electron/services/outlook-browser-v2/types';

type TestActions = OutlookActions & {
  looksLikeSignin: () => Promise<boolean>;
  openMessageById: (page: unknown, id: string) => Promise<'opened' | 'not_in_list' | 'stale_read_guard'>;
};

type FakeReadingPanePage = {
  url: () => string;
  waitForSelector: ReturnType<typeof vi.fn>;
  evaluate: ReturnType<typeof vi.fn>;
};

/**
 * Seeds the jsdom document with the fixture and returns a page whose
 * `evaluate` runs a string argument as page-side code (Playwright semantics
 * for `page.evaluate(string)`) and a function argument directly. Every
 * evaluated string is recorded so a row can prove the production script — not
 * a stand-in — produced the result it is asserting on.
 */
function createReadingPanePage(html: string): { page: FakeReadingPanePage; evaluatedScripts: string[] } {
  document.body.innerHTML = html;
  const evaluatedScripts: string[] = [];
  const page: FakeReadingPanePage = {
    url: () => 'https://outlook.office.com/mail/inbox',
    waitForSelector: vi.fn(async () => null),
    evaluate: vi.fn(async (fnOrScript: unknown, arg?: unknown) => {
      if (typeof fnOrScript === 'string') {
        evaluatedScripts.push(fnOrScript);
        return new Function(`return (${fnOrScript});`)();
      }
      return (fnOrScript as (a: unknown) => unknown)(arg);
    }),
  };
  return { page, evaluatedScripts };
}

function createActions(html: string) {
  const { page, evaluatedScripts } = createReadingPanePage(html);
  const driver = {
    ensureOutlookTab: vi.fn(async () => page),
    screenshotViewport: vi.fn(async () => ({ png: Buffer.alloc(0), width: 1, height: 1 })),
    clickAt: vi.fn(),
    pressKey: vi.fn(),
    sleep: vi.fn(),
    typeText: vi.fn(),
  };
  const grounder = { ground: vi.fn() };
  const actions = new OutlookActions(driver as never, grounder as never) as unknown as TestActions;
  // Sign-in detection and row location are pinned by outlook-actions-safety;
  // this file is about what happens once the reading pane is open.
  actions.looksLikeSignin = vi.fn(async () => false);
  actions.openMessageById = vi.fn(async () => 'opened' as const);
  return { actions, driver, page, evaluatedScripts };
}

/** Outlook-shaped reading pane: heading, body, then zero or more attachment chips. */
function readingPane(bodyText: string, chips: string[]): string {
  const chipMarkup = chips
    .map((label) => `<div role="button" tabindex="0" aria-label="${label}"><span>${label}</span></div>`)
    .join('\n        ');
  return `
    <div role="main">
      <span role="heading" aria-level="3">Term 1 report</span>
      <div role="region" aria-label="Reading pane">
        <div role="button" aria-label="From sender@example.invalid">Sender</div>
        <time datetime="2026-09-08T14:05:00Z">Tue 10:05 AM</time>
        <div aria-label="Message body">${bodyText}</div>
        ${chipMarkup}
      </div>
    </div>
  `;
}

function attachmentsOf(result: { attachments?: EmailAttachmentInfo[] }): EmailAttachmentInfo[] {
  expect(Array.isArray(result.attachments)).toBe(true);
  return result.attachments as EmailAttachmentInfo[];
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('read_email attachment metadata extraction (CLWX-61, eval row W3.2)', () => {
  it('returns populated filename, parsed size and mime for every attachment chip, in DOM order', async () => {
    const { actions, evaluatedScripts } = createActions(readingPane('Please find the report attached.', [
      'Attached file: Term1-Report.pdf, 12 KB',
      'Attachment: staff-photo.jpg, 1.4 MB',
    ]));

    const result = await actions.readEmail({ id: 'message-1' });

    expect(result.status).toBe('ok');
    const attachments = attachmentsOf(result);
    expect(attachments).toEqual([
      { filename: 'Term1-Report.pdf', sizeBytes: 12 * 1024, mimeType: 'application/pdf' },
      { filename: 'staff-photo.jpg', sizeBytes: Math.round(1.4 * 1024 * 1024), mimeType: 'image/jpeg' },
    ]);
    // W3.2's literal claim: where attachments exist, every entry's metadata is
    // non-empty. Kept separate from toEqual so a regression to '' / 0 / undefined
    // fails with the field named rather than as a diff blob.
    for (const att of attachments) {
      expect(att.filename.length).toBeGreaterThan(0);
      expect(Number.isInteger(att.sizeBytes) && (att.sizeBytes as number) > 0).toBe(true);
      expect(typeof att.mimeType === 'string' && att.mimeType.length > 0).toBe(true);
    }
    // Proof the production page-side script did the work: exactly one string
    // was evaluated and it is the extractor (a stand-in would not carry the
    // Outlook chip selector). Without this, the fake page could be silently
    // short-circuited and every row above would still be green.
    expect(evaluatedScripts).toHaveLength(1);
    expect(evaluatedScripts[0]).toContain('aria-label^="Attached file"');
    expect(evaluatedScripts[0]).toContain('function parseSize');
    expect(evaluatedScripts[0]).toContain('function guessMime');
  });

  it('accepts the chip prefix case-insensitively (selector and parser both use the i flag)', async () => {
    const { actions } = createActions(readingPane('Body.', [
      'attached file: lower.pdf, 3 KB',
      'ATTACHMENT: upper.png, 4 KB',
    ]));

    const attachments = attachmentsOf(await actions.readEmail({ id: 'message-1' }));

    expect(attachments.map((a) => a.filename)).toEqual(['lower.pdf', 'upper.png']);
  });

  // Every unit branch the extractor's parseSize declares: bare B, KB, MB, GB,
  // decimals, no space before the unit, and lower-case units (parseSize
  // upper-cases before the multiplier lookup). A row here fails if a unit is
  // dropped, the multiplier drifts (1000 vs 1024), or rounding changes.
  it.each([
    ['512 B', 512],
    ['12 KB', 12 * 1024],
    ['2.5 KB', 2560],
    ['1.4 MB', Math.round(1.4 * 1048576)],
    ['0.5 MB', 524288],
    ['2 GB', 2 * 1073741824],
    ['12KB', 12 * 1024],
    ['3 kb', 3 * 1024],
    ['1.5 mb', Math.round(1.5 * 1048576)],
  ])('parses the rendered size "%s" to %i bytes', async (rendered, expectedBytes) => {
    const { actions } = createActions(readingPane('Body.', [`Attached file: sizes.pdf, ${rendered}`]));

    const attachments = attachmentsOf(await actions.readEmail({ id: 'message-1' }));

    expect(attachments).toHaveLength(1);
    expect(attachments[0].filename).toBe('sizes.pdf');
    expect(attachments[0].sizeBytes).toBe(expectedBytes);
  });

  // The full extension table the extractor's guessMime declares, plus the two
  // typed-absence cases: an extension outside the table and no extension at
  // all. A regression that returns a default such as application/octet-stream
  // for unknowns fails the last two rows; dropping or mistyping a table entry
  // fails its row.
  it.each([
    ['handbook.pdf', 'application/pdf'],
    ['letter.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['roll.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['badge.png', 'image/png'],
    ['photo.jpg', 'image/jpeg'],
    ['photo2.jpeg', 'image/jpeg'],
    ['bundle.zip', 'application/zip'],
    ['UPPERCASE.PDF', 'application/pdf'],
    ['notes.xyz', undefined],
    ['README', undefined],
  ])('maps "%s" to mime %s', async (filename, expectedMime) => {
    const { actions } = createActions(readingPane('Body.', [`Attached file: ${filename}, 10 KB`]));

    const attachments = attachmentsOf(await actions.readEmail({ id: 'message-1' }));

    expect(attachments).toHaveLength(1);
    expect(attachments[0].filename).toBe(filename);
    expect(attachments[0].mimeType).toBe(expectedMime);
  });

  it('returns an empty array — not undefined, not a fabricated entry — when the message has no attachments', async () => {
    const { actions } = createActions(readingPane('Just a note, nothing attached to this one.', []));

    const result = await actions.readEmail({ id: 'message-1' });

    expect(result.status).toBe('ok');
    expect(result.attachments).toEqual([]);
    expect(result.attachments).not.toBeUndefined();

    const listed = await actions.listAttachments({ id: 'message-1' });
    expect(listed).toEqual({ status: 'ok', id: 'message-1', attachments: [] });
  });

  it('list_attachments returns exactly the metadata read_email extracted', async () => {
    const { actions } = createActions(readingPane('Two files.', [
      'Attached file: a.pdf, 1 KB',
      'Attached file: b.zip, 2 MB',
    ]));

    const listed = await actions.listAttachments({ id: 'message-1' });

    expect(listed.status).toBe('ok');
    expect(listed.attachments).toEqual([
      { filename: 'a.pdf', sizeBytes: 1024, mimeType: 'application/pdf' },
      { filename: 'b.zip', sizeBytes: 2 * 1048576, mimeType: 'application/zip' },
    ]);
  });

  it('keeps at most 30 chips, the bound the extractor declares', async () => {
    const chips = Array.from({ length: 32 }, (_, i) => `Attached file: file-${String(i).padStart(2, '0')}.pdf, 1 KB`);
    const { actions } = createActions(readingPane('Many.', chips));

    const attachments = attachmentsOf(await actions.readEmail({ id: 'message-1' }));

    expect(attachments).toHaveLength(30);
    expect(attachments[0].filename).toBe('file-00.pdf');
    expect(attachments[29].filename).toBe('file-29.pdf');
  });
});

/**
 * Negative controls. Each row fixes what the extractor must NOT do with a
 * malformed or non-attachment node. Verified by mutation on 2026-09-09 against
 * the production file (then restored): replacing the `if (m)` guard with an
 * unconditional push of `{ filename: label, sizeBytes: 0, mimeType:
 * 'application/octet-stream' }` and making parseSize return 0 on NaN is caught
 * by the header, missing-filename and sizeBytes rows here plus the two
 * unknown-mime rows above, while every well-formed positive row stays green —
 * so these rows, not the positive ones, are what catch a fail-open extractor.
 * Collapsing an empty list to `undefined` at the readEmail boundary is caught
 * by attachmentsOf() in every row that expects `[]`.
 */
describe('read_email attachment metadata negative controls (CLWX-61)', () => {
  it('does not turn an "Attachments" section header or count into an attachment', async () => {
    // Outlook renders a collapsible attachment-well header. Its label starts
    // with the same seven letters as a chip, so the CSS prefix selector picks
    // it up; only the parser's "Attachment" + separator requirement keeps it
    // out. Catches: loosening the separator (e.g. `Attachment\w*`) or any
    // fallback that pushes the raw label when the pattern does not match.
    const { actions } = createActions(readingPane('Body.', [
      'Attachments (2)',
      'Attachments',
    ]));

    const attachments = attachmentsOf(await actions.readEmail({ id: 'message-1' }));

    expect(attachments).toEqual([]);
  });

  it('yields no entry when the chip prefix is present but the filename is missing', async () => {
    // These two labels never satisfy the parser regex (no separator, or a
    // separator with nothing after it), so they never reach the push. This row
    // therefore covers only the fail-open path: a fallback that pushes when the
    // pattern does not match. A placeholder substituted ON the matched path
    // ("untitled", "attachment") is covered by the two whitespace-filename rows
    // below, not here.
    const { actions } = createActions(readingPane('Body.', [
      'Attachment:',
      'Attached file',
    ]));

    const attachments = attachmentsOf(await actions.readEmail({ id: 'message-1' }));

    expect(attachments).toEqual([]);
  });

  // Regression for the CLWX-61 empty-filename defect (report:
  // docs/bugs/CLWX-61-attachment-metadata-empty-filename.md on the documentation
  // branch). The chip parser
  //   /(?:Attached file|Attachment)[:\s]+(.+?)(?:,\s*([\d.]+\s*[KMG]?B))?(?:,|$)/i
  // lets `[:\s]+` give back its trailing whitespace so that `.+?` matches a
  // lone space; before the fix `.trim()` then pushed { filename: '' }, and an
  // empty filename passes downloadAttachment's includes('') existence check.
  // The push is now guarded on a non-empty trimmed filename. A valid chip sits
  // beside the malformed one so this row also fails if the guard over-drops.
  it('yields no entry for a whitespace-only filename label while keeping the valid chip beside it', async () => {
    const { actions } = createActions(readingPane('Body.', [
      'Attached file: ',
      'Attached file: Real.pdf, 3 KB',
    ]));

    const attachments = attachmentsOf(await actions.readEmail({ id: 'message-1' }));

    expect(attachments).toEqual([{ filename: 'Real.pdf', sizeBytes: 3 * 1024, mimeType: 'application/pdf' }]);
    expect(attachments.every((a) => a.filename.trim().length > 0)).toBe(true);
  });

  it('never emits a filename that does not appear verbatim in a chip label (placeholder guard)', async () => {
    // Catches: a placeholder substituted on the matched path, e.g.
    // `.trim() || 'untitled'`, which the row above would also reject but which
    // this row rejects for the stated reason — the name was not in the DOM. Any
    // future default for a nameless chip must fail here, whatever it is called.
    const labels = ['Attached file: ', 'Attachment:', 'Attached file: Roll.xlsx, 9 KB'];
    const { actions } = createActions(readingPane('Body.', labels));

    const attachments = attachmentsOf(await actions.readEmail({ id: 'message-1' }));

    expect(attachments).toHaveLength(1);
    for (const att of attachments) {
      expect(att.filename.length).toBeGreaterThan(0);
      expect(labels.some((label) => label.includes(att.filename))).toBe(true);
    }
  });

  it('leaves sizeBytes undefined when the size is absent or malformed, never 0 or NaN', async () => {
    // Catches: coercing a missing size to 0, letting parseFloat's NaN through,
    // or defaulting to a made-up size. The EmailAttachmentInfo contract is
    // `sizeBytes?: number` "best-effort" — absence must stay absence.
    const { actions } = createActions(readingPane('Body.', [
      'Attached file: Minutes.docx',
      'Attached file: Agenda.pdf, . KB',
    ]));

    const attachments = attachmentsOf(await actions.readEmail({ id: 'message-1' }));

    expect(attachments.map((a) => a.filename)).toEqual(['Minutes.docx', 'Agenda.pdf']);
    for (const att of attachments) {
      expect(att.sizeBytes).toBeUndefined();
      expect(att.sizeBytes).not.toBe(0);
      expect(Number.isNaN(att.sizeBytes)).toBe(false);
    }
  });

  it('ignores controls whose labels merely contain the word attachment', async () => {
    // Catches: widening the prefix selector `^=` to a substring `*=` match, or
    // scanning visible text instead of chip labels. The parser regex itself is
    // unanchored, so the third label — a chip-shaped phrase embedded mid-string
    // — is the one that only the prefix selector keeps out; the first two are
    // rejected by the parser's separator as well. Verified by mutation: with
    // `*=` the third label produces a fabricated Policy.pdf entry.
    const { actions } = createActions(readingPane('I have attached nothing; see the attachment policy.', [
      'Download all attachments',
      'Save all attachments to OneDrive',
      'Open Attachment: Policy.pdf, 12 KB in a new window',
    ]));

    const attachments = attachmentsOf(await actions.readEmail({ id: 'message-1' }));

    expect(attachments).toEqual([]);
  });

  it('does not truncate an entry to the chip text when the aria-label is the source of truth', async () => {
    // The visible chip text is often the bare filename while the aria-label
    // carries filename + size. Pinning that size still comes through when the
    // two differ catches a regression that reads textContent instead of the
    // label (which would silently drop every size).
    const { actions } = createActions(`
      <div role="main">
        <div role="region" aria-label="Reading pane">
          <div aria-label="Message body">Body.</div>
          <div role="button" aria-label="Attached file: Budget.xlsx, 40 KB"><span>Budget.xlsx</span></div>
        </div>
      </div>
    `);

    const attachments = attachmentsOf(await actions.readEmail({ id: 'message-1' }));

    expect(attachments).toEqual([{
      filename: 'Budget.xlsx',
      sizeBytes: 40 * 1024,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }]);
  });
});

/**
 * Eval row W8.1 (search_inbox({hasAttachment:true})) and row W3.2 (read_email
 * metadata) are different signals from different sources. The search hint is
 * a snippet-text sniff over inbox rows (search-helpers.ts, matchesSearchArgs);
 * the metadata is parsed from reading-pane chip labels. Neither is derived
 * from the other, so a message can carry the hint and no metadata, or metadata
 * and no hint. Pinning the distinction stops a future "simplification" that
 * makes read_email fabricate attachments from body prose, or makes the search
 * hint claim more precision than a text sniff has.
 */
describe('attachment hint (W8.1) versus attachment metadata (W3.2) stay distinct', () => {
  const baseMsg: InboxMessage = {
    id: 'sender|subject|received',
    sender: 'Principal Office',
    subject: 'Agenda for Monday',
    snippet: 'Agenda for Monday',
    receivedAt: '2026-09-08T14:05:00Z',
    unread: false,
  };

  it('body prose that mentions an attachment satisfies the search hint but yields no metadata', async () => {
    const prose = 'Please see the attached agenda.';
    expect(matchesSearchArgsForTests({ ...baseMsg, snippet: prose }, { hasAttachment: true })).toBe(true);

    const { actions } = createActions(readingPane(prose, []));
    const attachments = attachmentsOf(await actions.readEmail({ id: 'message-1' }));

    // Catches: read_email sniffing body text to invent an attachment entry.
    expect(attachments).toEqual([]);
  });

  it('a real chip yields metadata even when the snippet carries no hint word', async () => {
    expect(matchesSearchArgsForTests(baseMsg, { hasAttachment: true })).toBe(false);

    const { actions } = createActions(readingPane('Agenda for Monday', ['Attached file: Agenda.pdf, 88 KB']));
    const attachments = attachmentsOf(await actions.readEmail({ id: 'message-1' }));

    // Catches: read_email gating chip extraction on the text hint.
    expect(attachments).toEqual([{ filename: 'Agenda.pdf', sizeBytes: 88 * 1024, mimeType: 'application/pdf' }]);
  });
});
