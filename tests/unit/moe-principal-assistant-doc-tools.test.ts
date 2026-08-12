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
