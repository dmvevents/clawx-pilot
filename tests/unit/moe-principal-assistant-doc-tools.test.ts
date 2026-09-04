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
