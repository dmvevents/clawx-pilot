// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';

async function loadDocTools() {
  return import('../../extensions/moe-principal-assistant/doc-tools.mjs');
}

let workDir: string;
beforeAll(() => {
  workDir = mkdtempSync(path.join(tmpdir(), 'moe-xlsx-totals-'));
});
afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

// The enrolment fixture that the installed moe.35 summed to 180 twice (rows total 160).
const ENROLMENT = [
  ['Class', 'Boys', 'Girls', 'Total'],
  ['First Year', 10, 11, 21],
  ['Second Year', 12, 11, 23],
  ['Standard 1', 13, 13, 26],
  ['Standard 2', 11, 13, 24],
  ['Standard 3', 12, 13, 25],
  ['Standard 4', 10, 12, 22],
  ['Standard 5', 9, 10, 19],
];

describe('computeColumnTotals (CLWX-1 spreadsheet totals)', () => {
  it('sums every all-numeric column over the data rows and skips text columns', async () => {
    const { computeColumnTotals } = await loadDocTools();
    expect(computeColumnTotals(ENROLMENT)).toEqual([
      { column: 'Boys', index: 1, sum: 77, count: 7 },
      { column: 'Girls', index: 2, sum: 83, count: 7 },
      { column: 'Total', index: 3, sum: 160, count: 7 },
    ]);
  });
  it('tolerates string numerics with separators and blanks, and refuses mixed columns', async () => {
    const { computeColumnTotals } = await loadDocTools();
    const aoa = [
      ['Item', 'Amount', 'Notes'],
      ['a', '1,250', 'ok'],
      ['b', '', '12'],
      ['c', 'TT$ 750', 'n/a'],
    ];
    expect(computeColumnTotals(aoa)).toEqual([{ column: 'Amount', index: 1, sum: 2000, count: 2 }]);
  });
  it('returns nothing for header-only or malformed input', async () => {
    const { computeColumnTotals } = await loadDocTools();
    expect(computeColumnTotals([['A', 'B']])).toEqual([]);
    expect(computeColumnTotals(null as never)).toEqual([]);
  });
});

describe('readXlsx returns tool-computed columnTotals over ALL rows', () => {
  it('reports the exact totals even when the returned row window is truncated', async () => {
    const { readXlsx } = await loadDocTools();
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ENROLMENT), 'Enrolment');
    const file = path.join(workDir, 'enrolment.xlsx');
    XLSX.writeFile(wb, file);
    const full = (await readXlsx({ path: file })) as { columnTotals: Array<{ column: string; sum: number }>; rows: unknown[][] };
    expect(full.columnTotals.find((c) => c.column === 'Total')?.sum).toBe(160);
    expect(full.columnTotals.find((c) => c.column === 'Girls')?.sum).toBe(83);
    const windowed = (await readXlsx({ path: file, maxRows: 3 })) as { truncated: boolean; rows: unknown[][]; columnTotals: Array<{ column: string; sum: number }> };
    expect(windowed.truncated).toBe(true);
    expect(windowed.rows).toHaveLength(3);
    expect(windowed.columnTotals.find((c) => c.column === 'Total')?.sum).toBe(160);
  });
});
