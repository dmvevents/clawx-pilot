// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Document, Packer, Paragraph } from 'docx';
import * as XLSX from 'xlsx';

async function loadDocTools() {
  return import('../../extensions/moe-principal-assistant/doc-tools.mjs');
}

let workDir: string;
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64',
);

function canonicalPath(value: string) {
  const realpath = realpathSync.native ?? realpathSync;
  return realpath(value);
}

type VirtualDirent = {
  name: string;
  isSymbolicLink: () => boolean;
  isDirectory: () => boolean;
  isFile: () => boolean;
};

function virtualFile(name: string): VirtualDirent {
  return {
    name,
    isSymbolicLink: () => false,
    isDirectory: () => false,
    isFile: () => true,
  };
}

function virtualDir(name: string): VirtualDirent {
  return {
    name,
    isSymbolicLink: () => false,
    isDirectory: () => true,
    isFile: () => false,
  };
}

async function loadDocToolsWithVirtualDefaultRoots() {
  const fakeHome = path.join(canonicalPath(workDir), `global-budget-home-${process.pid}`);
  const downloads = path.join(fakeHome, 'Downloads');
  const documents = path.join(fakeHome, 'Documents');
  const target = path.join(downloads, 'A_Unique_Target_Audit.pdf');
  const directories = new Set([fakeHome, downloads, documents]);
  const files = new Set([target]);
  const entriesByDir = new Map<string, VirtualDirent[]>([
    [fakeHome, [virtualDir('Downloads'), virtualDir('Documents')]],
    [
      downloads,
      [
        virtualFile('A_Unique_Target_Audit.pdf'),
        ...Array.from({ length: 2000 }, (_, i) =>
          virtualFile(`downloads-filler-${String(i).padStart(4, '0')}.pdf`),
        ),
      ],
    ],
    [
      documents,
      Array.from({ length: 2000 }, (_, i) =>
        virtualFile(`documents-filler-${String(i).padStart(4, '0')}.pdf`),
      ),
    ],
  ]);
  const normalize = (value: string) => path.resolve(value);
  const isVirtual = (value: string) => {
    const candidate = normalize(value);
    return candidate === fakeHome || candidate.startsWith(fakeHome + path.sep);
  };
  const makeRealpath = (actualRealpath: typeof realpathSync) => {
    const realpath = ((value: string) =>
      (isVirtual(value) ? normalize(value) : actualRealpath(value))) as typeof realpathSync;
    realpath.native = ((value: string) =>
      (isVirtual(value) ? normalize(value) : (actualRealpath.native ?? actualRealpath)(value))) as typeof realpathSync.native;
    return realpath;
  };

  vi.resetModules();
  vi.doMock('node:fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:fs')>();
    return {
      ...actual,
      existsSync(value: Parameters<typeof actual.existsSync>[0]) {
        const candidate = normalize(String(value));
        if (directories.has(candidate) || files.has(candidate)) return true;
        if (isVirtual(candidate)) return false;
        return actual.existsSync(value);
      },
      readdirSync(
        value: Parameters<typeof actual.readdirSync>[0],
        options?: Parameters<typeof actual.readdirSync>[1],
      ) {
        const candidate = normalize(String(value));
        const entries = entriesByDir.get(candidate);
        if (entries) return options ? entries : entries.map((entry) => entry.name);
        return actual.readdirSync(value, options as never);
      },
      realpathSync: makeRealpath(actual.realpathSync),
      statSync(value: Parameters<typeof actual.statSync>[0]) {
        const candidate = normalize(String(value));
        if (directories.has(candidate)) {
          return {
            isDirectory: () => true,
            isFile: () => false,
            size: 0,
            mtime: new Date('2026-09-08T00:00:00.000Z'),
          };
        }
        if (files.has(candidate)) {
          return {
            isDirectory: () => false,
            isFile: () => true,
            size: 5,
            mtime: new Date('2026-09-08T00:00:00.000Z'),
          };
        }
        return actual.statSync(value);
      },
    };
  });

  try {
    const mod = await import('../../extensions/moe-principal-assistant/doc-tools.mjs');
    return { ...mod, fakeHome };
  } finally {
    vi.doUnmock('node:fs');
    vi.resetModules();
  }
}

function pdfWithLines(lines: string[]) {
  const escapePdfText = (value: string) => value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const stream = [
    'BT /F1 12 Tf 14 TL 72 720 Td',
    ...lines.map((line) => `(${escapePdfText(line)}) Tj T*`),
    'ET',
  ].join('\n');
  return [
    '%PDF-1.4',
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
    '2 0 obj<</Type/Pages/Count 1/Kids [3 0 R]>>endobj',
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox [0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj',
    `4 0 obj<</Length ${stream.length}>>stream\n${stream}\nendstream endobj`,
    '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj',
    'trailer<</Size 6/Root 1 0 R>>',
    '%%EOF',
  ].join('\n');
}

beforeAll(async () => {
  workDir = mkdtempSync(path.join(tmpdir(), 'moe-doc-tools-'));
});

afterAll(() => {
  try {
    rmSync(workDir, { recursive: true, force: true });
  } catch {
    // best effort
  }
});

describe('document.* native tools (Lane A — Windows-safe)', () => {
  it('finds a numerically prefixed underscored PDF from an ordinary title in a supplied folder', async () => {
    const { findDocuments } = await loadDocTools();
    const folder = path.join(workDir, `MoE Agent Testing Folder ${process.pid}`);
    const file = path.join(folder, '01_Ministry_Circular_ICT_Equipment_Audit.pdf');
    mkdirSync(folder, { recursive: true });
    writeFileSync(file, '%PDF-1.4\n');

    const result = (await findDocuments({
      query: 'ICT Equipment Audit circular',
      folder,
      extensions: ['pdf'],
    })) as {
      status: string;
      safeUnique: boolean;
      uniquePath: string | null;
      matches: Array<{ path: string; name: string; bytes: number }>;
      incomplete: boolean;
    };

    expect(result.status).toBe('found');
    expect(result.safeUnique).toBe(true);
    expect(result.uniquePath).toBe(canonicalPath(file));
    expect(result.incomplete).toBe(false);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({
      path: canonicalPath(file),
      name: '01_Ministry_Circular_ICT_Equipment_Audit.pdf',
      bytes: expect.any(Number),
    });
    expect(JSON.stringify(result)).not.toContain('%PDF');
  });

  it('finds an underscored image filename by title and extension filter', async () => {
    const { findDocuments } = await loadDocTools();
    const folder = path.join(workDir, `image-folder-${process.pid}`);
    const file = path.join(folder, 'Student_Support_Referral_Form.png');
    mkdirSync(folder, { recursive: true });
    writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const result = await findDocuments({
      query: 'Student Support Referral Form image',
      folder,
      extensions: ['png', 'jpg'],
    });

    expect(result.safeUnique).toBe(true);
    expect(result.uniquePath).toBe(canonicalPath(file));
  });

  it('returns native image content without duplicating base64 into text metadata', async () => {
    const { readImage } = await loadDocTools();
    const file = path.join(workDir, 'Student_Support_Referral_Form.png');
    writeFileSync(file, PNG_1PX);

    const result = await readImage({ path: file }) as {
      content: Array<Record<string, unknown>>;
      details: Record<string, unknown>;
      dataUrl?: unknown;
    };

    const textBlock = result.content.find((block) => block.type === 'text');
    const imageBlock = result.content.find((block) => block.type === 'image');

    expect(textBlock?.text).toContain('"path"');
    expect(textBlock?.text).not.toContain('base64,');
    expect(imageBlock).toMatchObject({
      type: 'image',
      mimeType: 'image/png',
      data: expect.any(String),
    });
    expect(String(imageBlock?.data)).toMatch(/^iVBOR/);
    expect(result.details).toMatchObject({
      path: file,
      bytes: PNG_1PX.length,
      mimeType: 'image/png',
      imageBytes: expect.any(Number),
      resized: expect.any(Boolean),
    });
    expect(JSON.stringify(result.details)).not.toContain('base64,');
    expect(result).not.toHaveProperty('dataUrl');
  });

  it('marks multiple plausible title matches ambiguous instead of selecting one', async () => {
    const { findDocuments } = await loadDocTools();
    const folder = path.join(workDir, `ambiguous-${process.pid}`);
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, 'ICT_Equipment_Audit.pdf'), 'one');
    writeFileSync(path.join(folder, 'ICT Equipment Audit Circular.pdf'), 'two');

    const result = await findDocuments({
      query: 'ICT Equipment Audit',
      folder,
      extensions: ['pdf'],
    });

    expect(result.status).toBe('ambiguous');
    expect(result.safeUnique).toBe(false);
    expect(result.uniquePath).toBeNull();
    expect(result.matches.map((m) => m.name).sort()).toEqual([
      'ICT Equipment Audit Circular.pdf',
      'ICT_Equipment_Audit.pdf',
    ]);
  });

  it('applies the document.find entry budget globally across default roots', async () => {
    const { findDocuments, fakeHome } = await loadDocToolsWithVirtualDefaultRoots();
    const previousHome = process.env.HOME;
    const previousUserProfile = process.env.USERPROFILE;

    process.env.HOME = fakeHome;
    process.env.USERPROFILE = fakeHome;
    try {
      const result = await findDocuments({ query: 'Unique Target Audit', extensions: ['pdf'] });
      expect(result.scanned.entries).toBe(4000);
      expect(result.incomplete).toBe(true);
      expect(result.status).toBe('incomplete');
      expect(result.safeUnique).toBe(false);
      expect(result.uniquePath).toBeNull();
      expect(result.matches.map((m) => m.name)).toContain('A_Unique_Target_Audit.pdf');
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = previousUserProfile;
    }
  });

  it('marks result-limit truncation incomplete instead of claiming a safe unique match', async () => {
    const { findDocuments } = await loadDocTools();
    const folder = path.join(workDir, `truncated-${process.pid}`);
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, 'Audit Alpha.pdf'), 'one');
    writeFileSync(path.join(folder, 'Audit Beta.pdf'), 'two');

    const result = await findDocuments({
      query: 'Audit',
      folder,
      extensions: ['pdf'],
      maxResults: 1,
    });

    expect(result.status).toBe('incomplete');
    expect(result.safeUnique).toBe(false);
    expect(result.uniquePath).toBeNull();
    expect(result.matches).toHaveLength(1);
    expect(result.incomplete).toBe(true);
  });

  it('rejects network folders before scanning', async () => {
    const { findDocuments } = await loadDocTools();
    expect(() => findDocuments({ query: 'audit', folder: '\\\\server\\share' })).toThrow(/network paths are not allowed/);
  });

  it('does not follow symlinked files during discovery', async () => {
    const { findDocuments } = await loadDocTools();
    if (process.platform === 'win32') return;
    const folder = path.join(workDir, `symlink-${process.pid}`);
    mkdirSync(folder, { recursive: true });
    symlinkSync('/etc/hosts', path.join(folder, 'ICT_Equipment_Audit.pdf'));

    const result = await findDocuments({
      query: 'ICT Equipment Audit',
      folder,
      extensions: ['pdf'],
    });

    expect(result.status).toBe('not_found');
    expect(result.safeUnique).toBe(false);
    expect(result.scanned.refused).toBeGreaterThan(0);
  });

  it('reads a .docx file with mammoth without shelling out', async () => {
    const { readDocx } = await loadDocTools();
    const docxPath = path.join(workDir, 'sample.docx');
    const doc = new Document({
      sections: [{ properties: {}, children: [new Paragraph({ text: 'Hello Ministry of Education.' })] }],
    });
    writeFileSync(docxPath, await Packer.toBuffer(doc));

    const result = (await readDocx({ path: docxPath })) as {
      path: string;
      format: string;
      markdown: string;
      bytes: number;
    };
    expect(result.format).toBe('markdown');
    expect(result.markdown).toContain('Hello Ministry of Education');
    expect(result.bytes).toBeGreaterThan(0);
  });

  it('writes then reads back a .xlsx workbook', async () => {
    const { writeXlsx, readXlsx } = await loadDocTools();
    const xlsxPath = path.join(workDir, 'sample.xlsx');
    await writeXlsx({
      path: xlsxPath,
      sheets: [
        { name: 'Suspensions', rows: [['Student', 'Days'], ['T. Test', 3]] },
      ],
    });
    const result = (await readXlsx({ path: xlsxPath })) as {
      sheets: string[];
      sheet: string;
      rows: unknown[][];
      totalRows: number;
    };
    expect(result.sheets).toEqual(['Suspensions']);
    expect(result.sheet).toBe('Suspensions');
    expect(result.rows[0]).toEqual(['Student', 'Days']);
    expect(result.rows[1]).toEqual(['T. Test', '3']);
    expect(result.totalRows).toBe(2);
  });

  it('refuses to read files outside the user home directory', async () => {
    const { readPdf } = await loadDocTools();
    // /etc/hosts exists on macOS and Linux; on Windows tmp dir has no
    // equivalent so this branch only asserts on POSIX.
    if (process.platform === 'win32') return;
    await expect(readPdf({ path: '/etc/hosts' })).rejects.toThrow(/refused to read|not an image|file not found/);
  });

  it('throws a clear error for missing files', async () => {
    const { readDocx } = await loadDocTools();
    await expect(readDocx({ path: 'this-file-does-not-exist-xyz.docx' })).rejects.toThrow(/file not found/);
  });

  it('reads xlsx buffer produced by SheetJS directly (sanity)', async () => {
    // Sanity that xlsx dep is loadable — the packaged Windows failure mode
    // is exactly this returning null / MODULE_NOT_FOUND.
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[1, 2]]), 'S');
    expect(wb.SheetNames).toEqual(['S']);
  });
});

describe('readDocx refuses non-docx containers in principal language (CLWX-101)', () => {
  // The regression this closes: mammoth hands non-zip input to jszip, whose
  // error ("Can't find end of central directory : is this a zip file ? If it
  // is, see https://stuk.github.io/jszip/…") reached the principal verbatim.
  const LIBRARY_INTERNALS = /central directory|jszip|stuk\.github\.io|https?:\/\//i;

  async function readDocxError(name: string, bytes: Buffer | string): Promise<string> {
    const { readDocx } = await loadDocTools();
    const p = path.join(workDir, name);
    writeFileSync(p, bytes);
    try {
      await readDocx({ path: p });
    } catch (e) {
      return String((e as Error).message);
    }
    return '';
  }

  it('names legacy Word (.doc) and the Save-As way out for an OLE2 container', async () => {
    const msg = await readDocxError(
      'legacy.doc',
      Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(512)]),
    );
    expect(msg).toMatch(/legacy Word document \(\.doc\b/);
    expect(msg).toMatch(/Save As/i);
    expect(msg).toMatch(/\.docx/);
    expect(msg).not.toMatch(LIBRARY_INTERNALS);
  });

  it('names Rich Text Format (.rtf) and the way out', async () => {
    const msg = await readDocxError('memo.rtf', '{\\rtf1\\ansi Hello.}');
    expect(msg).toMatch(/Rich Text Format file \(\.rtf\)/);
    expect(msg).toMatch(/Save As/i);
    expect(msg).not.toMatch(LIBRARY_INTERNALS);
  });

  it('refuses a plain-text imposter as not-a-Word-document, without jszip language', async () => {
    const msg = await readDocxError('notes.docx', 'just some plain text pretending to be a docx');
    expect(msg).toMatch(/not a modern Word document/);
    expect(msg).not.toMatch(LIBRARY_INTERNALS);
  });

  it('maps a damaged zip container to the damaged-or-incomplete wording', async () => {
    // Starts with PK so it passes the container sniff, but jszip cannot
    // parse it — this exercises the mapDocxParseError tier, not the sniff.
    const msg = await readDocxError('damaged.docx', Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(8, 0xff)]));
    expect(msg).toMatch(/damaged or incomplete/);
    expect(msg).not.toMatch(LIBRARY_INTERNALS);
  });

  it('maps a zip that is not a docx inside (the .odt class) to the renamed-format wording', async () => {
    // A valid but EMPTY zip: end-of-central-directory record only.
    const msg = await readDocxError('notes.odt', Buffer.concat([Buffer.from('PK\x05\x06', 'latin1'), Buffer.alloc(18)]));
    expect(msg).toMatch(/not a Word document inside/);
    expect(msg).toMatch(/OpenDocument/);
    expect(msg).not.toMatch(/main document part/i);
    expect(msg).not.toMatch(LIBRARY_INTERNALS);
  });

  it('names password protection for an encrypted OOXML container, never "legacy Word" (review 2026-09-05)', async () => {
    // MS-OFFCRYPTO: a password-protected modern .docx is an OLE2/CFB file
    // with an EncryptedPackage stream (UTF-16LE directory entry) — same
    // 8-byte magic as legacy .doc.
    const msg = await readDocxError(
      'confidential-report.docx',
      Buffer.concat([
        Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
        Buffer.alloc(64),
        Buffer.from('EncryptedPackage', 'utf16le'),
        Buffer.alloc(64),
      ]),
    );
    expect(msg).toMatch(/password-protected/);
    expect(msg).not.toMatch(/legacy Word/);
    expect(msg).not.toMatch(LIBRARY_INTERNALS);
  });

  it('names the empty-file cause for a zero-byte docx (failed download/sync), not "different file type"', async () => {
    const msg = await readDocxError('empty.docx', Buffer.alloc(0));
    expect(msg).toMatch(/empty \(0 bytes\)/);
    expect(msg).toMatch(/download or sync/);
    expect(msg).not.toMatch(LIBRARY_INTERNALS);
  });

  it('maps a valid zip with mangled XML inside to the damaged wording, never raw xmldom text (review 2026-09-05)', async () => {
    const { buildStoredZip } = await import('../../scripts/harness-artifact.mjs');
    const msg = await readDocxError(
      'mangled.docx',
      buildStoredZip([['word/document.xml', '<w:document><w:body><w:p><unclosed']]),
    );
    expect(msg).toMatch(/damaged or incomplete/);
    expect(msg).not.toMatch(/xmldom|@#\[line:|element parse error/i);
    expect(msg).not.toMatch(LIBRARY_INTERNALS);
  });

  it('sanitizes control characters out of the quoted filename (no fake stack frames in chat)', async () => {
    // macOS permits newlines in filenames; embedded raw they can fake a
    // stack frame inside an official refusal (review 2026-09-05).
    if (process.platform === 'win32') return;
    const msg = await readDocxError('memo\n    at Object.fake (x.js:1:1).rtf', '{\\rtf1\\ansi Hi.}');
    expect(msg).toMatch(/Rich Text Format/);
    expect(msg).not.toMatch(/\n\s+at\s+\S/);
    expect(msg).not.toContain('\n');
  });

  it('still reads a genuine .docx after the sniff (no false refusal)', async () => {
    const { readDocx } = await loadDocTools();
    const p = path.join(workDir, 'genuine.docx');
    const doc = new Document({
      sections: [{ properties: {}, children: [new Paragraph({ text: 'Sniff must not block real files.' })] }],
    });
    writeFileSync(p, await Packer.toBuffer(doc));
    const result = (await readDocx({ path: p })) as { markdown: string };
    expect(result.markdown).toContain('Sniff must not block real files');
  });
});

describe('readPdf refuses unreadable PDFs in principal language (CLWX-77)', () => {
  // The regression this closes: pdfjs exception messages ("No password
  // given", "Invalid PDF structure.") reached the refusal surface verbatim —
  // parser language with no way out named, passing the generic readable bar
  // only by being URL- and stack-free.
  const PDFJS_INTERNALS = /No password given|Invalid PDF structure|PasswordException|InvalidPDFException/i;

  async function readPdfError(name: string, bytes: Buffer | string): Promise<string> {
    const { readPdf } = await loadDocTools();
    const p = path.join(workDir, name);
    writeFileSync(p, bytes);
    try {
      await readPdf({ path: p });
    } catch (e) {
      return String((e as Error).message);
    }
    return '';
  }

  it('names password protection and the way out for an encrypted PDF, never the raw pdfjs message', async () => {
    // This first real PDF call also loads pdfjs and its worker. Native Windows
    // preflight measured 17.3s cold, then 132ms/31ms for subsequent PDF calls.
    // Bound the integration setup here; keep the refusal assertions intact.
    // An /Encrypt trailer entry triggers PasswordException without any real
    // cryptography in the fixture.
    const key = `<${'68656c6c6f'.repeat(6)}6f6f>`;
    const msg = await readPdfError('protected.pdf', [
      '%PDF-1.4',
      '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
      '2 0 obj<</Type/Pages/Count 1/Kids [3 0 R]>>endobj',
      '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox [0 0 612 792]>>endobj',
      `4 0 obj<</Filter/Standard/V 1/R 2/O ${key} /U ${key} /P -44>>endobj`,
      'trailer<</Size 5/Root 1 0 R/Encrypt 4 0 R>>',
      '%%EOF',
    ].join('\n'));
    expect(msg).toMatch(/password-protected/);
    expect(msg).toMatch(/save an unprotected copy/i);
    expect(msg).not.toMatch(PDFJS_INTERNALS);
  }, 30_000);

  it('maps a corrupt PDF to the damaged-or-not-a-PDF wording, never "Invalid PDF structure."', async () => {
    const msg = await readPdfError('broken.pdf', `%PDF-1.4\n${'garbage '.repeat(64)}`);
    expect(msg).toMatch(/could not be read as a PDF/);
    expect(msg).toMatch(/damaged/);
    expect(msg).not.toMatch(PDFJS_INTERNALS);
  });

  it('names the empty-file cause for a zero-byte pdf (failed download/sync)', async () => {
    const msg = await readPdfError('empty.pdf', Buffer.alloc(0));
    expect(msg).toMatch(/empty \(0 bytes\)/);
    expect(msg).toMatch(/download or sync/);
    expect(msg).not.toMatch(PDFJS_INTERNALS);
  });

  it('still reads a genuine pdf after the mapping (no false refusal)', async () => {
    const { readPdf } = await loadDocTools();
    const p = path.join(workDir, 'genuine.pdf');
    const stream = 'BT /F1 12 Tf 72 720 Td (Mapping must not block real files.) Tj ET';
    writeFileSync(p, [
      '%PDF-1.4',
      '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
      '2 0 obj<</Type/Pages/Count 1/Kids [3 0 R]>>endobj',
      '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox [0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj',
      `4 0 obj<</Length ${stream.length}>>stream\n${stream}\nendstream endobj`,
      '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj',
      'trailer<</Size 6/Root 1 0 R>>',
      '%%EOF',
    ].join('\n'));
    const result = (await readPdf({ path: p })) as { text: string };
    expect(result.text).toContain('Mapping must not block real files');
  });
});

describe('readPdf action/deadline excerpts for ordinary summaries', () => {
  it('extracts explicit action, deadline, submission and exception sections without changing raw text', async () => {
    const { extractPdfActionExcerpts } = await loadDocTools();
    const source = [
      'MINISTRY CIRCULAR',
      'Background',
      'This audit supports planning for the new term.',
      'REQUIRED ACTIONS',
      'Complete ICT 1 with serial number, condition and location for each item.',
      'Damaged or missing items require ICT 2 and a written explanation.',
      'KEY DEADLINES',
      'School inventory: 30 July 2026',
      'District verification visits: 4-15 August 2026',
      'Final consolidated report to Head Office: 29 August 2026',
      'SUBMISSION ROUTE AND FORMS',
      'Send ICT 1 and ICT 2 via the District Office before Head Office consolidation.',
      'EXCEPTIONS',
      'Schools with no damaged or missing equipment are not required to submit ICT 2.',
    ].join('\n');

    const result = extractPdfActionExcerpts(source) as {
      sections: Array<{ heading: string; text: string; truncated: boolean }>;
    };

    const combined = result.sections.map((section) => `${section.heading}\n${section.text}`).join('\n\n');
    expect(combined).toContain('REQUIRED ACTIONS');
    expect(combined).toContain('Complete ICT 1 with serial number, condition and location');
    expect(combined).toContain('KEY DEADLINES');
    expect(combined).toContain('School inventory: 30 July 2026');
    expect(combined).toContain('District verification visits: 4-15 August 2026');
    expect(combined).toContain('Final consolidated report to Head Office: 29 August 2026');
    expect(combined).toContain('SUBMISSION ROUTE AND FORMS');
    expect(combined).toContain('via the District Office');
    expect(combined).toContain('EXCEPTIONS');
    expect(combined).toContain('not required to submit ICT 2');
    expect(source).toContain('Final consolidated report to Head Office: 29 August 2026');
  });

  it('preserves conditions, negations and wrapped source lines', async () => {
    const { extractPdfActionExcerpts } = await loadDocTools();
    const source = [
      'Submission Requirements:',
      'If a school has no damaged equipment, it is not',
      'required to submit Form B.',
      'Required actions:',
      'Principals must attach the signed cover memo',
      'and retain a copy for district review.',
    ].join('\n');

    const result = extractPdfActionExcerpts(source) as {
      sections: Array<{ heading: string; text: string }>;
    };
    const combined = result.sections.map((section) => section.text).join('\n');
    const normalized = combined.replace(/\s+/g, ' ');

    expect(normalized).toContain('it is not required to submit Form B.');
    expect(normalized).toContain('attach the signed cover memo and retain a copy');
  });

  it('keeps wrapped inline-labelled submission conditions with the source row', async () => {
    const { extractPdfActionExcerpts } = await loadDocTools();
    const result = extractPdfActionExcerpts([
      'Submission: Schools must submit Form A only',
      'if they have damaged equipment.',
    ].join('\n')) as {
      sections: Array<{ heading: string; text: string; truncated: boolean }>;
    };

    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]).toMatchObject({
      heading: 'Submission',
      truncated: false,
    });
    expect(result.sections[0].text).toBe([
      'Schools must submit Form A only',
      'if they have damaged equipment.',
    ].join('\n'));
  });

  it('treats sentence-shaped body lines as content and stops at the next structural heading', async () => {
    const { extractPdfActionExcerpts } = await loadDocTools();
    const result = extractPdfActionExcerpts([
      'REQUIRED ACTIONS',
      'Submit Form A.',
      'BACKGROUND',
      'This audit supports planning and is not an action.',
    ].join('\n')) as {
      sections: Array<{ heading: string; text: string }>;
    };

    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].heading).toBe('REQUIRED ACTIONS');
    expect(result.sections[0].text).toBe('Submit Form A.');
    expect(JSON.stringify(result.sections)).not.toContain('This audit supports planning');
    expect(JSON.stringify(result.sections)).not.toContain('heading":"Submit Form A.');
  });

  it('enforces hard total character bounds without appending over-limit markers', async () => {
    const { extractPdfActionExcerpts } = await loadDocTools();
    const result = extractPdfActionExcerpts('ACTION ITEMS\nSchools must submit Form A by 12 May 2026.', {
      maxSections: 1,
      maxChars: 10,
      maxTotalChars: 10,
    }) as {
      sections: Array<{ text: string; truncated: boolean }>;
      truncated: boolean;
    };

    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].text).toBe('Schools mu');
    expect(result.sections[0].text.length).toBeLessThanOrEqual(10);
    expect(result.sections[0].truncated).toBe(true);
    expect(result.truncated).toBe(true);
  });

  it('bounds long sections and does not inject the ICT audit fixture', async () => {
    const { extractPdfActionExcerpts } = await loadDocTools();
    const source = [
      'Action Items',
      ...Array.from({ length: 40 }, (_, i) => `Item ${i + 1}: source obligation ${i + 1} for this unrelated circular.`),
    ].join('\n');

    const result = extractPdfActionExcerpts(source, { maxSections: 2, maxChars: 160, maxTotalChars: 220 }) as {
      sections: Array<{ heading: string; text: string; truncated: boolean }>;
      limits: Record<string, number>;
    };

    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].text.length).toBeLessThanOrEqual(164);
    expect(result.sections[0].truncated).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/Head Office|29 August 2026|ICT 1|ICT 2/);
    expect(result.limits).toMatchObject({ maxSections: 2, maxChars: 160, maxTotalChars: 220 });
  });

  it('places sourceExcerpts before raw text in the read_pdf result contract', async () => {
    const { readPdf } = await loadDocTools();
    const p = path.join(workDir, 'excerpt-order.pdf');
    const stream = 'BT /F1 12 Tf 72 720 Td (KEY DEADLINES Final report: 12 May 2026) Tj ET';
    writeFileSync(p, [
      '%PDF-1.4',
      '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
      '2 0 obj<</Type/Pages/Count 1/Kids [3 0 R]>>endobj',
      '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox [0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj',
      `4 0 obj<</Length ${stream.length}>>stream\n${stream}\nendstream endobj`,
      '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj',
      'trailer<</Size 6/Root 1 0 R>>',
      '%%EOF',
    ].join('\n'));

    const result = await readPdf({ path: p }) as Record<string, unknown>;
    expect(Object.keys(result).indexOf('sourceExcerpts')).toBeLessThan(Object.keys(result).indexOf('text'));
    expect(result.text).toContain('KEY DEADLINES Final report: 12 May 2026');
    expect(result.sourceExcerpts).toMatchObject({
      sections: expect.any(Array),
      limits: {
        maxSections: expect.any(Number),
        maxChars: expect.any(Number),
        maxTotalChars: expect.any(Number),
      },
    });
  });

  it('derives sourceExcerpts from the returned maxChars PDF text boundary', async () => {
    const { readPdf } = await loadDocTools();
    const p = path.join(workDir, 'excerpt-maxchars.pdf');
    const visible = 'KEY DEADLINES Visible deadline: 12 May 2026. ';
    const beyond = 'ACTION ITEMS Hidden action beyond the requested reader slice.';
    const stream = `BT /F1 12 Tf 72 720 Td (${visible}${beyond}) Tj ET`;
    writeFileSync(p, [
      '%PDF-1.4',
      '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
      '2 0 obj<</Type/Pages/Count 1/Kids [3 0 R]>>endobj',
      '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox [0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj',
      `4 0 obj<</Length ${stream.length}>>stream\n${stream}\nendstream endobj`,
      '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj',
      'trailer<</Size 6/Root 1 0 R>>',
      '%%EOF',
    ].join('\n'));

    const result = await readPdf({ path: p, maxChars: visible.length }) as {
      text: string;
      sourceExcerpts: { sections: Array<{ text: string }> };
    };
    const excerpts = JSON.stringify(result.sourceExcerpts);

    expect(result.text).toContain('Visible deadline');
    expect(result.text).not.toContain('Hidden action');
    expect(excerpts).toContain('Visible deadline');
    expect(excerpts).not.toContain('Hidden action beyond the requested reader slice');
  });

  it('surfaces the P3 Head Office deadline from an actual parsed PDF result', async () => {
    const { readPdf } = await loadDocTools();
    const p = path.join(workDir, 'ICT_Equipment_Audit.pdf');
    writeFileSync(p, pdfWithLines([
      'MINISTRY CIRCULAR',
      'REQUIRED ACTIONS',
      'Complete ICT 1 with serial number, condition and location for each item.',
      'Damaged or missing items require ICT 2 and a written explanation.',
      'KEY DEADLINES',
      'School inventory: 30 July 2026',
      'District verification visits: 4-15 August 2026',
      'Final consolidated report to Head Office: 29 August 2026',
      'SUBMISSION ROUTE AND FORMS',
      'Send ICT 1 and ICT 2 via the District Office before Head Office consolidation.',
      'EXCEPTIONS',
      'Schools with no damaged or missing equipment are not required to submit ICT 2.',
    ]));

    const result = await readPdf({ path: p }) as {
      text: string;
      sourceExcerpts: { sections: Array<{ heading: string; text: string; truncated: boolean }> };
    };
    const combined = result.sourceExcerpts.sections
      .map((section) => `${section.heading}\n${section.text}`)
      .join('\n\n');

    expect(result.text).toContain('Final consolidated report to Head Office: 29 August 2026');
    expect(combined).toContain('Complete ICT 1 with serial number, condition and location');
    expect(combined).toContain('Damaged or missing items require ICT 2 and a written explanation');
    expect(combined).toContain('School inventory: 30 July 2026');
    expect(combined).toContain('District verification visits: 4-15 August 2026');
    expect(combined).toContain('Final consolidated report to Head Office: 29 August 2026');
    expect(combined).toContain('Send ICT 1 and ICT 2 via the District Office before Head Office consolidation');
    expect(combined).toContain('not required to submit ICT 2');
  });
});

describe('parser dep loading is truthful: notFound vs loadError (CLWX-76)', () => {
  // The regression this closes: every doc-tool used to funnel a failed
  // require through a masking wrapper that returned null on ANY failure, then
  // threw a hardcoded "<dep> module not found — rebuild the runtime". So a
  // dep that WAS bundled but failed to evaluate (a broken platform-native
  // transitive binding — the CLWX-72 pdf-parse/DOMMatrix class) misdirected
  // triage into a pointless rebuild. All four fatal call sites now delegate to
  // requireDocDep, which must keep the two cases distinct.

  it('reports a genuinely absent module as "module not found", never as a load failure', async () => {
    const { requireDocDep } = await loadDocTools();
    let msg = '';
    try {
      requireDocDep('parser-dep-that-truly-does-not-exist-zzz');
    } catch (e) {
      msg = String((e as Error).message);
    }
    expect(msg).toMatch(/module not found/);
    expect(msg).not.toMatch(/failed to load/);
  });

  it('reports a present-but-broken module as a load failure with the real cause, never as "not found"', async () => {
    const { requireDocDep } = await loadDocTools();
    // A module that IS on disk but throws at module scope — stands in for a
    // parser whose native binding is missing on the target platform.
    const brokenPath = path.join(workDir, 'broken-native-dep.cjs');
    writeFileSync(brokenPath, "throw new Error('libvips binding missing');\n");
    let msg = '';
    try {
      requireDocDep(brokenPath, '@napi-rs/canvas binding');
    } catch (e) {
      msg = String((e as Error).message);
    }
    expect(msg).toMatch(/present but failed to load/);
    expect(msg).toMatch(/libvips binding missing/); // surfaces the ACTUAL error
    expect(msg).toMatch(/@napi-rs\/canvas binding/); // and the native hint
    expect(msg).not.toMatch(/module not found/);
  });

  it('loadDepDetailed splits the two outcomes at the source', async () => {
    const { loadDepDetailed } = await loadDocTools();

    const absent = loadDepDetailed('parser-dep-that-truly-does-not-exist-zzz');
    expect(absent.mod).toBeNull();
    expect(absent.notFound).toBe(true);
    expect(absent.loadError).toBeNull();

    const brokenPath = path.join(workDir, 'broken-native-dep-2.cjs');
    writeFileSync(brokenPath, "throw new Error('binding boom');\n");
    const broken = loadDepDetailed(brokenPath);
    expect(broken.mod).toBeNull();
    expect(broken.notFound).toBe(false);
    expect(broken.loadError).toBeInstanceOf(Error);
    expect(String(broken.loadError.message)).toMatch(/binding boom/);
  });
});
