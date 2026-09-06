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

  it('rejects internal paths with either separator (review 2026-09-05: not host-locked)', async () => {
    const { isReadableRefusal } = await load();
    expect(isReadableRefusal('Cannot find module in node_modules\\pdf-parse\\index.js')).toBe(false);
  });

  it('rejects library documentation URLs — the jszip leak that passed v1 (CLWX-101)', async () => {
    const { isReadableRefusal } = await load();
    expect(isReadableRefusal("Can't find end of central directory : is this a zip file ? If it is, see https://stuk.github.io/jszip/documentation/howto/read_zip.html")).toBe(false);
    expect(isReadableRefusal('see HTTPS://example.com/docs for details')).toBe(false);
  });

  it('rejects bracketed library tags and parser-location artifacts — the xmldom dump that passed v2 (review 2026-09-05)', async () => {
    const { isReadableRefusal } = await load();
    expect(isReadableRefusal('error: [xmldom error]\telement parse error: Error: Hierarchy request error\n@#[line:undefined,col:undefined]')).toBe(false);
    expect(isReadableRefusal('warning: [xmldom warning]\tunclosed xml attribute')).toBe(false);
    expect(isReadableRefusal('parse failed @#[line:3,col:9]')).toBe(false);
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

  it('FAILs infra outcomes on refusal rows — a timeout is never a passing refusal (review 2026-09-05)', async () => {
    const { classifyRow } = await load();
    for (const message of ['row timed out after 60000ms', 'spawn failed: ENOMEM', 'child produced no framed verdict; stderr: ', 'child crashed before the tool ran: boom']) {
      const v = classifyRow('refusal', { ok: false, infra: true, message });
      expect(v.status).toBe('FAIL');
      expect(v.note).toContain('tool never ran');
    }
  });

  it('FAILs infra outcomes on ok rows too', async () => {
    const { classifyRow } = await load();
    const v = classifyRow('ok', { ok: false, infra: true, message: 'row timed out after 60000ms' });
    expect(v.status).toBe('FAIL');
  });

  it('records NO-TOOL rows without failing the run', async () => {
    const { classifyRow } = await load();
    const v = classifyRow('no-tool', { ok: false, message: '' });
    expect(v.status).toBe('NO-TOOL');
    expect(v.note).toContain('no document.*');
  });

  it('FAILs a readable refusal whose row wording check does not hold (CLWX-101)', async () => {
    const { classifyRow } = await load();
    const check = (m: string) => (/legacy Word document/.test(m) ? true : 'must name legacy .doc');
    const v = classifyRow('refusal', { ok: false, message: 'This file type is not supported.' }, undefined, check);
    expect(v.status).toBe('FAIL');
    expect(v.note).toContain('must name legacy .doc');
  });

  it('passes a refusal that meets its row wording check', async () => {
    const { classifyRow } = await load();
    const check = (m: string) => (/legacy Word document/.test(m) ? true : 'must name legacy .doc');
    const v = classifyRow('refusal', { ok: false, message: 'This looks like a legacy Word document (.doc). Save it as .docx and retry.' }, undefined, check);
    expect(v.status).toBe('REFUSED-READABLY');
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
    for (const row of MATRIX) {
      if (row.mode === 'register') continue; // registration rows call register(), not a doc-tools fn
      expect(known.has(row.fn)).toBe(true);
    }
  });

  it('registration rows carry a register spec and a check (no doc-tools fn)', async () => {
    const { MATRIX } = await load();
    const regRows = MATRIX.filter((r: { mode?: string }) => r.mode === 'register');
    expect(regRows.map((r: { id: string }) => r.id).sort()).toEqual([
      'plugin-registration.full',
      'plugin-registration.no-config',
      'plugin-registration.no-hostapi',
    ]);
    for (const row of regRows) {
      expect(row.fn).toBeUndefined();
      expect(row.expectation).toBe('ok');
      expect(typeof row.check).toBe('function');
      expect(row.register && typeof row.register).toBe('object');
    }
  });

  it('covers every slice-1 doc type from the card scope', async () => {
    const { MATRIX } = await load();
    const ids = MATRIX.map((r: { id: string }) => r.id).join(' ');
    for (const type of ['pdf-text', 'pdf-corrupt', 'pdf-password', 'pdf-large', 'docx', 'doc-legacy', 'rtf', 'odt', 'docx-badxml', 'docx-password', 'xlsx', 'csv', 'png', 'png-sharp-binding', 'pptx']) {
      expect(ids).toContain(type);
    }
  });

  it('pins the CLWX-77 wording bar on the pdf refusal rows: the raw pdfjs messages must fail them', async () => {
    const { MATRIX } = await load();
    const rawByRow: Record<string, string> = {
      'pdf-corrupt.read_pdf': 'Invalid PDF structure.',
      'pdf-password.read_pdf': 'No password given',
    };
    for (const [id, rawMessage] of Object.entries(rawByRow)) {
      const row = MATRIX.find((r: { id: string }) => r.id === id);
      expect(typeof row.refusalCheck).toBe('function');
      expect(row.refusalCheck(rawMessage)).not.toBe(true);
    }
  });

  it('pins the >10MB bar on the pdf-large row: a small parse result must fail its content check', async () => {
    const { MATRIX } = await load();
    const row = MATRIX.find((r: { id: string }) => r.id === 'pdf-large.read_pdf');
    expect(row.expectation).toBe('ok');
    expect(row.check({ bytes: 1024, text: 'ICT audit circular', totalChars: 50 })).not.toBe(true);
    expect(row.check({ bytes: 10_500_487, text: 'ARTIFACT HARNESS PDF: ICT audit circular fixture.', totalChars: 50 })).toBe(true);
  });

  it('pins the CLWX-101 wording bar on the legacy-doc and rtf rows: the old jszip text must fail them', async () => {
    const { MATRIX } = await load();
    const jszipText = "Can't find end of central directory : is this a zip file ? If it is, see https://stuk.github.io/jszip/documentation/howto/read_zip.html";
    for (const id of ['doc-legacy.read_docx', 'rtf.read_docx']) {
      const row = MATRIX.find((r: { id: string }) => r.id === id);
      expect(typeof row.refusalCheck).toBe('function');
      expect(row.refusalCheck(jszipText)).not.toBe(true);
    }
  });

  it('gives every non-no-tool row an expectation the classifier understands', async () => {
    const { MATRIX } = await load();
    for (const row of MATRIX) {
      expect(['ok', 'refusal', 'no-tool']).toContain(row.expectation);
      if (row.expectation !== 'no-tool') {
        // Doc rows need an input (fixture or args); registration rows need
        // their register spec instead.
        expect(row.mode === 'register' ? row.register : (row.fixture || row.args)).toBeTruthy();
      }
    }
  });
});

describe('inventoryDiff + registration-row contracts (CLWX-77 registration leg)', () => {
  it('accepts exact set equality regardless of order', async () => {
    const { inventoryDiff } = await load();
    expect(inventoryDiff(['b', 'a'], ['a', 'b'])).toBe(true);
  });

  it('names every missing tool — a partial register can never pass by count', async () => {
    const { inventoryDiff } = await load();
    const note = inventoryDiff(['outlook.send_email', 'outlook.forward'], ['outlook.send_email', 'outlook.reply']);
    expect(note).toContain('missing: outlook.forward');
    expect(note).toContain('unexpected: outlook.reply');
  });

  it('rejects an empty actual inventory loudly', async () => {
    const { inventoryDiff, DOC_TOOL_NAMES } = await load();
    const note = inventoryDiff(DOC_TOOL_NAMES, []);
    expect(note).toContain('missing:');
    expect(note).toContain('document.read_pdf');
  });

  it('full-registration row check FAILs when a capability family is absent (falsifiability)', async () => {
    const { MATRIX, DOC_TOOL_NAMES, PRINCIPAL_TOOL_NAMES, BROWSER_TOOL_NAMES, OUTLOOK_TOOL_NAMES, FORMS_TOOL_NAMES } = await load();
    const row = MATRIX.find((r: { id: string }) => r.id === 'plugin-registration.full');
    const all = [...DOC_TOOL_NAMES, ...PRINCIPAL_TOOL_NAMES, ...BROWSER_TOOL_NAMES, ...OUTLOOK_TOOL_NAMES, ...FORMS_TOOL_NAMES];
    expect(row.check({ names: all })).toBe(true);
    const noOutlook = all.filter((n: string) => !n.startsWith('outlook.'));
    const verdict = row.check({ names: noOutlook });
    expect(verdict).not.toBe(true);
    expect(String(verdict)).toContain('outlook.send_email');
  });

  it('no-hostapi row check REJECTS any outlook/forms/browser tool sneaking in', async () => {
    const { MATRIX, DOC_TOOL_NAMES, PRINCIPAL_TOOL_NAMES } = await load();
    const row = MATRIX.find((r: { id: string }) => r.id === 'plugin-registration.no-hostapi');
    const expected = [...DOC_TOOL_NAMES, ...PRINCIPAL_TOOL_NAMES];
    expect(row.check({ names: expected })).toBe(true);
    const verdict = row.check({ names: [...expected, 'outlook.send_email'] });
    expect(verdict).not.toBe(true);
    expect(String(verdict)).toContain('unexpected: outlook.send_email');
  });

  it('no-config row check requires the early-return contract, not just the doc inventory', async () => {
    const { MATRIX, DOC_TOOL_NAMES } = await load();
    const row = MATRIX.find((r: { id: string }) => r.id === 'plugin-registration.no-config');
    expect(row.check({ names: [...DOC_TOOL_NAMES], returned: { registered: false, docToolsRegistered: true } })).toBe(true);
    expect(row.check({ names: [...DOC_TOOL_NAMES], returned: null })).not.toBe(true);
    expect(row.check({ names: [...DOC_TOOL_NAMES], returned: { registered: true } })).not.toBe(true);
  });
});
