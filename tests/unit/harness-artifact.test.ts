/**
 * CLWX-77 guards: the artifact-harness classifier and matrix shape.
 *
 * The harness itself spawns child processes against a 500MB staged bundle —
 * too heavy for the unit lane — so these tests pin the pure logic that
 * decides row verdicts: what counts as a principal-readable refusal, how
 * outcomes fold into PASS/REFUSED-READABLY/FAIL/NO-TOOL, and that the
 * matrix rows stay well-formed (unique ids, known entrypoints).
 */
import { describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mod: any;

async function load() {
  if (!mod) mod = await import('../../scripts/harness-artifact.mjs');
  return mod;
}

describe('isReadableRefusal (CLWX-77 principal bar)', () => {
  it('accepts a plain-language refusal', async () => {
    const { isReadableRefusal } = await load();
    expect(isReadableRefusal('refused to read /x: only files under the user\'s home or tmp directory are allowed.')).toBe(true);
    expect(isReadableRefusal('pdf-parse module not found — the packaged runtime is missing this dep.')).toBe(true);
  });

  it('rejects empty and non-string messages', async () => {
    const { isReadableRefusal } = await load();
    expect(isReadableRefusal('')).toBe(false);
    expect(isReadableRefusal('   ')).toBe(false);
    expect(isReadableRefusal(undefined)).toBe(false);
  });

  it('rejects leaked stack frames', async () => {
    const { isReadableRefusal } = await load();
    expect(isReadableRefusal('boom\n    at Object.<anonymous> (/app/x.js:1:1)')).toBe(false);
  });

  it('rejects raw error codes and internal paths', async () => {
    const { isReadableRefusal } = await load();
    expect(isReadableRefusal('ENOENT: no such file or directory')).toBe(false);
    expect(isReadableRefusal('Cannot find module in node_modules/pdf-parse/index.js')).toBe(false);
    expect(isReadableRefusal('TypeError: x is not a function')).toBe(false);
    expect(isReadableRefusal('[object Object]')).toBe(false);
  });
});

describe('classifyRow', () => {
  it('PASSes an expected-ok row whose content check holds', async () => {
    const { classifyRow } = await load();
    const v = classifyRow('ok', { ok: true, result: { text: 'hello' } }, (r: { text: string }) => (r.text === 'hello' ? true : 'nope'));
    expect(v.status).toBe('PASS');
  });

  it('FAILs an expected-ok row that threw', async () => {
    const { classifyRow } = await load();
    const v = classifyRow('ok', { ok: false, message: 'it broke' });
    expect(v.status).toBe('FAIL');
    expect(v.note).toContain('it broke');
  });

  it('FAILs an expected-ok row whose content check fails (no false-PASS on garbage output)', async () => {
    const { classifyRow } = await load();
    const v = classifyRow('ok', { ok: true, result: { text: '' } }, (r: { text: string }) => (r.text ? true : 'marker missing'));
    expect(v.status).toBe('FAIL');
    expect(v.note).toContain('marker missing');
  });

  it('marks an expected refusal with a readable message REFUSED-READABLY', async () => {
    const { classifyRow } = await load();
    const v = classifyRow('refusal', { ok: false, message: 'This file type is not supported yet. Export it as PDF instead.' });
    expect(v.status).toBe('REFUSED-READABLY');
  });

  it('FAILs an expected refusal that leaked a raw stack (the CLWX-77 trust bar)', async () => {
    const { classifyRow } = await load();
    const v = classifyRow('refusal', { ok: false, message: 'boom\n    at parse (/x/node_modules/lib/index.js:5:3)' });
    expect(v.status).toBe('FAIL');
  });

  it('FAILs an expected refusal that resolved ok (silent acceptance of a bad type)', async () => {
    const { classifyRow } = await load();
    const v = classifyRow('refusal', { ok: true, result: {} });
    expect(v.status).toBe('FAIL');
  });

  it('records NO-TOOL rows without failing the run', async () => {
    const { classifyRow } = await load();
    const v = classifyRow('no-tool', { ok: false, message: '' });
    expect(v.status).toBe('NO-TOOL');
    expect(v.note).toContain('no document.*');
  });
});

describe('MATRIX shape', () => {
  it('has unique row ids', async () => {
    const { MATRIX } = await load();
    const ids = MATRIX.map((r: { id: string }) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses only shipped doc-tools entrypoints (or null for no-tool rows)', async () => {
    const { MATRIX } = await load();
    const known = new Set(['readPdf', 'readDocx', 'writeDocx', 'readXlsx', 'writeXlsx', 'readImage', null]);
    for (const row of MATRIX) expect(known.has(row.fn)).toBe(true);
  });

  it('covers every slice-1 doc type from the card scope', async () => {
    const { MATRIX } = await load();
    const ids = MATRIX.map((r: { id: string }) => r.id).join(' ');
    for (const type of ['pdf-text', 'pdf-corrupt', 'docx', 'doc-legacy', 'rtf', 'odt', 'xlsx', 'csv', 'png', 'pptx']) {
      expect(ids).toContain(type);
    }
  });

  it('gives every non-no-tool row an expectation the classifier understands', async () => {
    const { MATRIX } = await load();
    for (const row of MATRIX) {
      expect(['ok', 'refusal', 'no-tool']).toContain(row.expectation);
      if (row.expectation !== 'no-tool') {
        expect(row.fixture || row.args).toBeTruthy();
      }
    }
  });
});
