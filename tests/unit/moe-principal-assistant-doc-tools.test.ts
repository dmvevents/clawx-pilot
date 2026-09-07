// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
import { Document, Packer, Paragraph } from 'docx';
// eslint-disable-next-line @typescript-eslint/no-var-requires
import * as XLSX from 'xlsx';

async function loadDocTools() {
  return import('../../extensions/moe-principal-assistant/doc-tools.mjs');
}

let workDir: string;

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
  });

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
