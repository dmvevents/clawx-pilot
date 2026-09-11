// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';

type ColumnTotal = {
  column: string;
  index: number;
  sum: number;
  count: number;
  rowsIncluded: number;
  sheetTotalRow?: number;
  matchesSheetTotal?: boolean;
};
type DocTools = {
  parseSheetNumber: (cell: unknown) => number | null;
  computeColumnTotals: (aoa: unknown) => ColumnTotal[];
  readXlsx: (args: { path: string; sheet?: string; maxRows?: number }) => Promise<{
    rows: unknown[][];
    truncated: boolean;
    columnTotals: ColumnTotal[];
  }>;
};

async function loadDocTools(): Promise<DocTools> {
  return (await import('../../extensions/moe-principal-assistant/doc-tools.mjs')) as unknown as DocTools;
}

let workDir: string;
beforeAll(() => {
  workDir = mkdtempSync(path.join(tmpdir(), 'moe-xlsx-totals-'));
});
afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

// The enrolment fixture the installed moe.35 summed to 180 twice (rows total 160).
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

describe('parseSheetNumber', () => {
  it('accepts plain, grouped, currency and accounting-negative numbers', async () => {
    const { parseSheetNumber } = await loadDocTools();
    expect(parseSheetNumber(21)).toBe(21);
    expect(parseSheetNumber('21')).toBe(21);
    expect(parseSheetNumber('1,250')).toBe(1250);
    expect(parseSheetNumber('TT$ 750')).toBe(750);
    expect(parseSheetNumber('$1,250.50')).toBe(1250.5);
    expect(parseSheetNumber('(50)')).toBe(-50);
    expect(parseSheetNumber('-50')).toBe(-50);
    expect(parseSheetNumber('12.5')).toBe(12.5);
  });

  // Review lane B minors: these used to be read as a wrong number or drop the
  // column silently. Refusing is the fail-closed direction and is explicit.
  it('refuses locale-ambiguous, percentage, date and non-numeric cells', async () => {
    const { parseSheetNumber } = await loadDocTools();
    for (const cell of ['1.250', '1.250.000', '1,25', '45%', '', '   ', 'n/a', 'TT$', '$', new Date('2026-09-11'), null, undefined]) {
      expect(parseSheetNumber(cell), String(cell)).toBeNull();
    }
  });
});

describe('computeColumnTotals (CLWX-1 spreadsheet totals)', () => {
  it('sums every all-numeric column over the data rows and skips text columns', async () => {
    const { computeColumnTotals } = await loadDocTools();
    expect(computeColumnTotals(ENROLMENT)).toEqual([
      { column: 'Boys', index: 1, sum: 77, count: 7, rowsIncluded: 7 },
      { column: 'Girls', index: 2, sum: 83, count: 7, rowsIncluded: 7 },
      { column: 'Total', index: 3, sum: 160, count: 7, rowsIncluded: 7 },
    ]);
  });

  /**
   * Review lane A M3 / lane B M4: the sheet's own bottom "Total" row was summed
   * as data, so a register that already carries its totals returned double —
   * and the tool description tells the model to quote these numbers.
   */
  it("excludes the sheet's own total row and reconciles against it", async () => {
    const { computeColumnTotals } = await loadDocTools();
    const withTotalRow = [...ENROLMENT, ['TOTAL', 77, 83, 160]];
    const totals = computeColumnTotals(withTotalRow);
    expect(totals.map((t) => [t.column, t.sum])).toEqual([['Boys', 77], ['Girls', 83], ['Total', 160]]);
    for (const t of totals) {
      expect(t.rowsIncluded).toBe(7);
      expect(t.matchesSheetTotal).toBe(true);
    }
    expect(totals[2].sheetTotalRow).toBe(160);
  });

  it('flags a total row that disagrees with the data instead of hiding it', async () => {
    const { computeColumnTotals } = await loadDocTools();
    const totals = computeColumnTotals([...ENROLMENT, ['Grand total', 77, 83, 999]]);
    const totalCol = totals.find((t) => t.column === 'Total');
    expect(totalCol).toMatchObject({ sum: 160, sheetTotalRow: 999, matchesSheetTotal: false });
    expect(totals.find((t) => t.column === 'Girls')).toMatchObject({ matchesSheetTotal: true });
  });

  it('tolerates blanks and skips columns with any uncertain cell', async () => {
    const { computeColumnTotals } = await loadDocTools();
    const aoa = [
      ['Item', 'Amount', 'Notes', 'Ambiguous', 'Percent'],
      ['a', '1,250', 'ok', '1.250', '45%'],
      ['b', '', '12', '2', '10%'],
      ['c', 'TT$ 750', 'n/a', '3', '5%'],
    ];
    expect(computeColumnTotals(aoa)).toEqual([{ column: 'Amount', index: 1, sum: 2000, count: 2, rowsIncluded: 3 }]);
  });

  it('returns nothing for header-only or malformed input', async () => {
    const { computeColumnTotals } = await loadDocTools();
    expect(computeColumnTotals([['A', 'B']])).toEqual([]);
    expect(computeColumnTotals(null)).toEqual([]);
  });
});

describe('readXlsx returns tool-computed columnTotals over ALL rows', () => {
  it('reports the exact totals even when the returned row window is truncated', async () => {
    const { readXlsx } = await loadDocTools();
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ENROLMENT), 'Enrolment');
    const file = path.join(workDir, 'enrolment.xlsx');
    XLSX.writeFile(wb, file);
    const full = await readXlsx({ path: file });
    expect(full.columnTotals.find((c) => c.column === 'Total')?.sum).toBe(160);
    expect(full.columnTotals.find((c) => c.column === 'Girls')?.sum).toBe(83);
    const windowed = await readXlsx({ path: file, maxRows: 3 });
    expect(windowed.truncated).toBe(true);
    expect(windowed.rows).toHaveLength(3);
    expect(windowed.columnTotals.find((c) => c.column === 'Total')?.sum).toBe(160);
    expect(windowed.columnTotals.find((c) => c.column === 'Total')?.rowsIncluded).toBe(7);
  });
});
