/**
 * CLWX-77 guards: the artifact-harness classifier and matrix shape.
 *
 * The harness itself spawns child processes against a 500MB staged bundle —
 * too heavy for the unit lane — so these tests pin the pure logic that
 * decides row verdicts: what counts as a principal-readable refusal, how
 * outcomes fold into PASS/REFUSED-READABLY/FAIL/NO-TOOL, and that the
 * matrix rows stay well-formed (unique ids, known entrypoints).
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync as fsRealpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

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
    const known = new Set(['findDocuments', 'readPdf', 'readDocx', 'writeDocx', 'readXlsx', 'writeXlsx', 'readImage', null]);
    for (const row of MATRIX) {
      // registration rows call register(), transport rows use the scoped OpenClaw loader — neither uses a doc-tools fn
      if (row.mode === 'register' || row.mode === 'transport') continue;
      expect(known.has(row.fn)).toBe(true);
    }
  });

  it('registration rows carry a register spec and a check (no doc-tools fn)', async () => {
    const { MATRIX } = await load();
    const regRows = MATRIX.filter((r: { mode?: string }) => r.mode === 'register');
    expect(regRows.map((r: { id: string }) => r.id).sort()).toEqual([
      'plugin-registration.full',
      'plugin-registration.killswitch',
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
        // Doc rows need an input (fixture or args); registration/transport
        // rows need their mode spec instead.
        const input = row.mode === 'register' ? row.register
          : row.mode === 'transport' ? row.transport
            : (row.fixture || row.args);
        expect(input).toBeTruthy();
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
    expect(row.check({ names: all, networkAttempts: 1 })).toBe(true);
    const noOutlook = all.filter((n: string) => !n.startsWith('outlook.'));
    const verdict = row.check({ names: noOutlook, networkAttempts: 1 });
    expect(verdict).not.toBe(true);
    expect(String(verdict)).toContain('outlook.send_email');
  });

  it('full-registration row check FAILs when the fetch stub recorded zero attempts (stub not in the path)', async () => {
    const { MATRIX, DOC_TOOL_NAMES, PRINCIPAL_TOOL_NAMES, BROWSER_TOOL_NAMES, OUTLOOK_TOOL_NAMES, FORMS_TOOL_NAMES } = await load();
    const row = MATRIX.find((r: { id: string }) => r.id === 'plugin-registration.full');
    const all = [...DOC_TOOL_NAMES, ...PRINCIPAL_TOOL_NAMES, ...BROWSER_TOOL_NAMES, ...OUTLOOK_TOOL_NAMES, ...FORMS_TOOL_NAMES];
    const verdict = row.check({ names: all, networkAttempts: 0 });
    expect(verdict).not.toBe(true);
    expect(String(verdict)).toContain('network attempt');
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

describe('foldChildExit (Codex lane 2026-09-06: exit status beats a framed verdict)', () => {
  it('passes through a framed verdict on clean exit', async () => {
    const { foldChildExit } = await load();
    const v = { ok: true, result: { names: [] } };
    expect(foldChildExit(0, null, v, '')).toBe(v);
  });

  it('discards a framed SUCCESS when the child exited nonzero (async crash after register())', async () => {
    const { foldChildExit } = await load();
    const out = foldChildExit(1, null, { ok: true, result: { names: [] } }, 'async boom');
    expect(out.ok).toBe(false);
    expect(out.infra).toBe(true);
    expect(out.message).toContain('exited 1');
    expect(out.message).toContain('discarded');
  });

  it('treats a signal death as infra failure', async () => {
    const { foldChildExit } = await load();
    const out = foldChildExit(null, 'SIGSEGV', { ok: true, result: {} }, '');
    expect(out.ok).toBe(false);
    expect(out.infra).toBe(true);
    expect(out.message).toContain('SIGSEGV');
  });

  it('reports a missing verdict on clean exit as infra failure', async () => {
    const { foldChildExit } = await load();
    const out = foldChildExit(0, null, null, 'some stderr');
    expect(out.infra).toBe(true);
    expect(out.message).toContain('no framed verdict');
  });
});

describe('registration-inventory fast-lane drift guard (Claude lens 2026-09-06)', () => {
  // The heavy harness run is the authoritative check, but inventory drift
  // must also fail in the UNIT lane: parse the registerTool name literals
  // straight out of index.mjs source and set-compare with the exported
  // constants. Same discipline as the CLWX-86 route-literal drift guard.
  it('the 33 hardcoded names match the registerTool literals in index.mjs', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile('extensions/moe-principal-assistant/index.mjs', 'utf8');
    const found = new Set<string>();
    for (const m of src.matchAll(/name:\s*'((?:document|principal|browser|outlook|forms)\.[a-z_]+)'/g)) {
      found.add(m[1]);
    }
    const { DOC_TOOL_NAMES, PRINCIPAL_TOOL_NAMES, BROWSER_TOOL_NAMES, OUTLOOK_TOOL_NAMES, FORMS_TOOL_NAMES, inventoryDiff } = await load();
    const expected = [...DOC_TOOL_NAMES, ...PRINCIPAL_TOOL_NAMES, ...BROWSER_TOOL_NAMES, ...OUTLOOK_TOOL_NAMES, ...FORMS_TOOL_NAMES];
    expect(inventoryDiff(expected, [...found])).toBe(true);
    expect(found.size).toBe(33);
  });

  it('inventoryDiff flags duplicate registrations — set semantics cannot hide a double register', async () => {
    const { inventoryDiff } = await load();
    const note = inventoryDiff(['a', 'b'], ['a', 'b', 'a']);
    expect(note).toContain('duplicated: a');
    expect(inventoryDiff(['a', 'b'], ['a', 'b'])).toBe(true);
  });

  it('killswitch row expects exactly the inventory minus the outlook family', async () => {
    const { MATRIX, OUTLOOK_TOOL_NAMES, DOC_TOOL_NAMES, PRINCIPAL_TOOL_NAMES, BROWSER_TOOL_NAMES, FORMS_TOOL_NAMES } = await load();
    const row = MATRIX.find((r: { id: string }) => r.id === 'plugin-registration.killswitch');
    expect(row.register.host.skillAllowlist).toEqual([]);
    const withoutOutlook = [...DOC_TOOL_NAMES, ...PRINCIPAL_TOOL_NAMES, ...BROWSER_TOOL_NAMES, ...FORMS_TOOL_NAMES];
    expect(row.check({ names: withoutOutlook })).toBe(true);
    const leak = row.check({ names: [...withoutOutlook, OUTLOOK_TOOL_NAMES[0]] });
    expect(leak).not.toBe(true);
    expect(String(leak)).toContain('outlook.open');
  });
});

describe('expandMatrix — electron-env spawn parity (CLWX-92 shape, trail 2026-09-06)', () => {
  it('gives every doc and register row an @electronlike twin', async () => {
    const { MATRIX, expandMatrix } = await load();
    const expanded = expandMatrix(MATRIX);
    for (const row of MATRIX) {
      if (row.expectation === 'no-tool' || row.mode === 'transport') continue;
      expect(expanded.some((r: { id: string; envShape: string }) => r.id === row.id && r.envShape === 'node')).toBe(true);
      expect(expanded.some((r: { id: string; envShape: string }) => r.id === `${row.id}@electronlike` && r.envShape === 'electronlike')).toBe(true);
    }
  });

  it('does NOT expand no-tool or transport rows (a faked electron shape around the real gateway dist is untruthful)', async () => {
    const { MATRIX, expandMatrix } = await load();
    const expanded = expandMatrix(MATRIX);
    const electronlikeIds = expanded.filter((r: { envShape: string }) => r.envShape === 'electronlike').map((r: { id: string }) => r.id);
    expect(electronlikeIds.some((id: string) => id.startsWith('gateway-transport'))).toBe(false);
    expect(electronlikeIds.some((id: string) => id.startsWith('pptx'))).toBe(false);
    const noTool = MATRIX.filter((r: { expectation: string }) => r.expectation === 'no-tool').length;
    const transport = MATRIX.filter((r: { mode?: string }) => r.mode === 'transport').length;
    expect(expanded.length).toBe((MATRIX.length - noTool - transport) * 2 + noTool + transport);
  });

  it('expanded ids stay unique', async () => {
    const { MATRIX, expandMatrix } = await load();
    const ids = expandMatrix(MATRIX).map((r: { id: string }) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('foldRepeatVerdicts — K8 intermittence bar (trail 2026-09-06)', () => {
  it('folds agreeing iterations into one verdict marked consistent', async () => {
    const { foldRepeatVerdicts } = await load();
    const v = foldRepeatVerdicts([
      { status: 'PASS', note: '' },
      { status: 'PASS', note: '' },
      { status: 'PASS', note: '' },
    ]);
    expect(v.status).toBe('PASS');
    expect(v.note).toContain('3× consistent');
  });

  it('FAILs on ANY disagreement — intermittence can never average out to a pass (K8)', async () => {
    const { foldRepeatVerdicts } = await load();
    const v = foldRepeatVerdicts([
      { status: 'PASS', note: '' },
      { status: 'FAIL', note: 'expected ok, threw: worker crashed' },
      { status: 'PASS', note: '' },
    ]);
    expect(v.status).toBe('FAIL');
    expect(v.note).toContain('INTERMITTENT');
    expect(v.note).toContain('K8');
    expect(v.note).toContain('worker crashed');
  });

  it('mixed non-FAIL statuses still carry a meaningful detail — no dangling dash (lens minor, 2026-09-06)', async () => {
    const { foldRepeatVerdicts } = await load();
    const v = foldRepeatVerdicts([
      { status: 'PASS', note: '' },
      { status: 'REFUSED-READABLY', note: 'file is password-protected' },
      { status: 'PASS', note: '' },
    ]);
    expect(v.status).toBe('FAIL');
    expect(v.note).toContain('INTERMITTENT');
    expect(v.note).toContain('file is password-protected');
    expect(v.note.trim().endsWith('—')).toBe(false);
  });

  it('a consistent FAIL stays a plain FAIL (not mislabeled intermittent)', async () => {
    const { foldRepeatVerdicts } = await load();
    const v = foldRepeatVerdicts([
      { status: 'FAIL', note: 'boom' },
      { status: 'FAIL', note: 'boom' },
      { status: 'FAIL', note: 'boom' },
    ]);
    expect(v.status).toBe('FAIL');
    expect(v.note).not.toContain('INTERMITTENT');
  });

  it('single-iteration rows pass through untouched; zero iterations is a harness FAIL', async () => {
    const { foldRepeatVerdicts } = await load();
    const single = { status: 'REFUSED-READABLY', note: 'readable' };
    expect(foldRepeatVerdicts([single])).toBe(single);
    expect(foldRepeatVerdicts([]).status).toBe('FAIL');
  });

  it('the K8-tagged matrix rows all carry repeat >= 3 (the ledger criterion is >=3x)', async () => {
    const { MATRIX } = await load();
    const k8 = MATRIX.filter((r: { kLedger?: string }) => r.kLedger === 'K8');
    expect(k8.length).toBeGreaterThanOrEqual(5);
    for (const row of k8) expect(row.repeat).toBeGreaterThanOrEqual(3);
    // and they cover read AND write on the K8 families (pdf read, docx r/w, xlsx r/w)
    const fns = new Set(k8.map((r: { fn: string }) => r.fn));
    for (const fn of ['readPdf', 'readDocx', 'writeDocx', 'readXlsx', 'writeXlsx']) {
      expect(fns.has(fn)).toBe(true);
    }
  });
});


type FakeTransportStage = {
  dir: string;
  gatewayDir: string;
  pluginRoot: string;
  workspaceDir: string;
};

function canonicalRealpath(value: string): string {
  return (fsRealpathSync.native ?? fsRealpathSync)(value);
}

function writeFakeTransportStage(options: { toolNames?: string[]; reportRawRoot?: boolean; stdoutFlood?: boolean } = {}): FakeTransportStage {
  const dir = canonicalRealpath(mkdtempSync(path.join(tmpdir(), 'clwx-transport-child-')));
  const gatewayDir = path.join(dir, 'resources', 'openclaw');
  const distDir = path.join(gatewayDir, 'dist');
  const pluginRoot = path.join(dir, 'resources', 'extensions', 'moe-principal-assistant');
  const workspaceDir = path.join(dir, 'home', '.openclaw', 'workspace');
  mkdirSync(distDir, { recursive: true });
  mkdirSync(pluginRoot, { recursive: true });
  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(path.join(gatewayDir, 'node_modules'), { recursive: true });
  writeFileSync(path.join(gatewayDir, 'package.json'), JSON.stringify({ type: 'module' }));
  const toolNames = options.toolNames ?? ['document.read_pdf'];
  const stdoutFlood = options.stdoutFlood ? "process.stdout.write('x'.repeat(2 * 1024 * 1024) + '\\n');" : '';
  const rootExpression = options.reportRawRoot
    ? "options.env.CLAWX_APP_RESOURCES + '/extensions/moe-principal-assistant'"
    : "canonicalRealpath(options.env.CLAWX_APP_RESOURCES + '/extensions/moe-principal-assistant')";
  writeFileSync(path.join(distDir, 'loader-test.js'), `
import { realpathSync } from 'node:fs';

const canonicalRealpath = realpathSync.native ?? realpathSync;

function loadOpenClawPlugins(options) {
  ${stdoutFlood}
  const requested = new Set(options.onlyPluginIds ?? []);
  const all = [
    { id: 'moe-principal-assistant', status: 'loaded', activated: true, rootDir: ${rootExpression}, toolNames: ${JSON.stringify(toolNames)} },
    { id: 'unrelated-stock-plugin', status: 'loaded', activated: true, rootDir: '/unrelated', toolNames: ['unrelated.tool'] },
  ];
  const plugins = process.env.MOCK_RETURN_EXTRA === '1' ? all : all.filter((plugin) => requested.has(plugin.id));
  return { workspaceDir: options.workspaceDir, plugins };
}
export { loadOpenClawPlugins as r };
`);
  writeFileSync(path.join(distDir, 'load-context-test.js'), `
function resolvePluginRuntimeLoadContext(options) {
  return { ...options, config: {} };
}
function buildPluginRuntimeLoadOptions(context, overrides) {
  return { ...context, ...overrides };
}
export { resolvePluginRuntimeLoadContext as i, buildPluginRuntimeLoadOptions as t };
`);
  return { dir, gatewayDir, pluginRoot, workspaceDir };
}

function portableHarnessEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? '',
  };
  for (const key of ['SystemRoot', 'SystemDrive', 'windir', 'PATHEXT', 'ComSpec']) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
}

function runTransportChild(stage: FakeTransportStage, options: { returnExtra?: boolean } = {}) {
  const childPath = path.resolve('scripts/harness-artifact-transport-child.mjs');
  const result = spawnSync(process.execPath, [childPath, JSON.stringify({
    gatewayDir: stage.gatewayDir,
    pluginId: 'moe-principal-assistant',
    workspaceDir: stage.workspaceDir,
  })], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '',
      HOME: path.dirname(path.dirname(stage.workspaceDir)),
      CLAWX_APP_RESOURCES: path.join(stage.dir, 'resources'),
      MOCK_PLUGIN_ROOT: stage.pluginRoot,
      MOCK_RETURN_EXTRA: options.returnExtra ? '1' : '0',
      NODE_OPTIONS: '',
    },
  });
  const line = result.stdout.split('\n').find((entry) => entry.startsWith('CLAWX77_TRANSPORT_VERDICT:'));
  if (!line) throw new Error(`transport child emitted no verdict; exit=${result.status}; stderr=${result.stderr}; stdout=${result.stdout}`);
  return {
    exitCode: result.status,
    stderr: result.stderr,
    payload: JSON.parse(line.slice('CLAWX77_TRANSPORT_VERDICT:'.length)),
  };
}

describe('gateway-transport rows (real plugin-host, trail 2026-09-06)', () => {
  it('parseInspectJson extracts the JSON block after interleaved register log lines', async () => {
    const { parseInspectJson } = await load();
    const stdout = [
      'Config warnings:',
      '- plugins.entries.x: something',
      'moe-principal-assistant: document.* tools registered (read_pdf)',
      '{',
      '  "workspaceDir": "/x",',
      '  "plugin": { "id": "moe-principal-assistant", "status": "loaded", "toolNames": ["document.read_pdf"] }',
      '}',
    ].join('\n');
    const parsed = parseInspectJson(stdout);
    expect(parsed?.plugin?.status).toBe('loaded');
  });

  it('parseInspectJson returns null on no JSON and on garbage', async () => {
    const { parseInspectJson } = await load();
    expect(parseInspectJson('plugin exploded before printing')).toBe(null);
    expect(parseInspectJson('')).toBe(null);
    expect(parseInspectJson(undefined)).toBe(null);
  });

  it('checkTransportInspect demands loaded + activated + exact inventory', async () => {
    const { checkTransportInspect, TRANSPORT_NO_HOSTAPI_EXPECTED } = await load();
    const good = {
      plugin: { id: 'moe-principal-assistant', status: 'loaded', activated: true, toolNames: [...TRANSPORT_NO_HOSTAPI_EXPECTED] },
    };
    expect(checkTransportInspect(TRANSPORT_NO_HOSTAPI_EXPECTED, good)).toBe(true);
    expect(String(checkTransportInspect(TRANSPORT_NO_HOSTAPI_EXPECTED, { plugin: { ...good.plugin, status: 'error' } }))).toContain('status');
    expect(String(checkTransportInspect(TRANSPORT_NO_HOSTAPI_EXPECTED, { plugin: { ...good.plugin, activated: false } }))).toContain('not activated');
    expect(String(checkTransportInspect(TRANSPORT_NO_HOSTAPI_EXPECTED, {}))).toContain('no plugin object');
    const missingTool = { plugin: { ...good.plugin, toolNames: good.plugin.toolNames.slice(1) } };
    expect(String(checkTransportInspect(TRANSPORT_NO_HOSTAPI_EXPECTED, missingTool))).toContain('missing:');
  });


  it('checkTransportInspect rejects broad diagnostics payloads and wrong plugin ids', async () => {
    const { checkTransportInspect, TRANSPORT_NO_HOSTAPI_EXPECTED } = await load();
    const broadPayload = {
      plugins: [
        { id: 'moe-principal-assistant' },
        { id: 'unrelated-stock-plugin' },
      ],
      plugin: {
        id: 'moe-principal-assistant',
        status: 'loaded',
        activated: true,
        toolNames: [...TRANSPORT_NO_HOSTAPI_EXPECTED],
      },
    };
    const broadVerdict = checkTransportInspect(TRANSPORT_NO_HOSTAPI_EXPECTED, broadPayload);
    expect(broadVerdict).not.toBe(true);
    expect(String(broadVerdict)).toContain('single scoped plugin payload');

    const wrongPlugin = checkTransportInspect(TRANSPORT_NO_HOSTAPI_EXPECTED, {
      plugin: {
        id: 'not-moe-principal-assistant',
        status: 'loaded',
        activated: true,
        toolNames: [...TRANSPORT_NO_HOSTAPI_EXPECTED],
      },
    });
    expect(wrongPlugin).not.toBe(true);
    expect(String(wrongPlugin)).toContain('moe-principal-assistant');
  });

  it('transport contract inventories: 15 tools without host-API, 33 with (matches the register-mode rows)', async () => {
    const { TRANSPORT_NO_HOSTAPI_EXPECTED, TRANSPORT_FULL_EXPECTED, DOC_TOOL_NAMES, PRINCIPAL_TOOL_NAMES } = await load();
    expect(TRANSPORT_NO_HOSTAPI_EXPECTED.length).toBe(15);
    expect(TRANSPORT_FULL_EXPECTED.length).toBe(33);
    expect(TRANSPORT_NO_HOSTAPI_EXPECTED).toEqual([...DOC_TOOL_NAMES, ...PRINCIPAL_TOOL_NAMES]);
  });

  it('checkTransportSource rejects a plugin loaded from anywhere but the stage (Codex HIGH, 2026-09-06)', async () => {
    const { checkTransportSource } = await load();
    expect(checkTransportSource('/stage/resources/extensions/moe-principal-assistant', {
      plugin: { rootDir: '/stage/resources/extensions/moe-principal-assistant' },
    })).toBe(true);
    const bleed = checkTransportSource('/stage/resources/extensions/moe-principal-assistant', {
      plugin: { rootDir: '/Users/dev/repo/extensions/moe-principal-assistant' },
    });
    expect(bleed).not.toBe(true);
    expect(String(bleed)).toContain('/Users/dev/repo');
    expect(String(bleed)).toContain('NOT the staged copy');
    expect(String(checkTransportSource('/stage/x', {}))).toContain('no plugin.rootDir');
    expect(String(checkTransportSource('/stage/x', { plugin: { rootDir: '' } }))).toContain('no plugin.rootDir');
  });

  it('validateFastSelection refuses a renamed or duplicated fast row (Codex MEDIUM, 2026-09-06)', async () => {
    const { MATRIX, expandMatrix, validateFastSelection, FAST_ROW_IDS } = await load();
    const expanded = expandMatrix(MATRIX);
    expect(validateFastSelection(expanded, FAST_ROW_IDS)).toBe(true);
    // Codex's exact probe: rename the pdf row → the gate must refuse, not shrink.
    const renamed = expanded.map((r: { id: string }) => (r.id.startsWith('pdf-text.read_pdf') ? { ...r, id: r.id.replace('pdf-text', 'pdf-body') } : r));
    const verdict = validateFastSelection(renamed, FAST_ROW_IDS);
    expect(verdict).not.toBe(true);
    expect(String(verdict)).toContain('pdf-text.read_pdf');
    const doubled = [...expanded, { id: 'pdf-text.read_pdf' }];
    expect(String(validateFastSelection(doubled, FAST_ROW_IDS))).toContain('more than once');
  });

  it('transport child loads only the requested staged plugin through the OpenClaw loader', async () => {
    const stage = writeFakeTransportStage();
    try {
      const verdict = runTransportChild(stage);
      expect(verdict.exitCode).toBe(0);
      expect(verdict.payload.ok).toBe(true);
      expect(verdict.payload.result.plugin.id).toBe('moe-principal-assistant');
      expect(verdict.payload.result.plugin.rootDir).toBe(canonicalRealpath(stage.pluginRoot));
      expect(verdict.payload.result.plugin.toolNames).toEqual(['document.read_pdf']);
      expect(JSON.stringify(verdict.payload)).not.toContain('unrelated-stock-plugin');
    } finally {
      rmSync(stage.dir, { recursive: true, force: true });
    }
  });

  it('canonicalizeStageDir resolves aliases through the nearest existing ancestor', async () => {
    const { canonicalizeStageDir } = await load();
    const stage = writeFakeTransportStage();
    const aliasPath = `${stage.dir}-missing-parent-alias`;
    const aliasType = process.platform === 'win32' ? 'junction' : 'dir';
    try {
      symlinkSync(stage.dir, aliasPath, aliasType);
      const nested = path.join(aliasPath, 'new', 'nested', 'stage');
      const canonical = await canonicalizeStageDir(nested);
      expect(canonical).toBe(path.join(stage.dir, 'new', 'nested', 'stage'));
    } finally {
      rmSync(aliasPath, { force: true });
      rmSync(stage.dir, { recursive: true, force: true });
    }
  });

  it('parent transport row canonicalizes an aliased stage path before handing roots to OpenClaw', async () => {
    const { TRANSPORT_NO_HOSTAPI_EXPECTED } = await load();
    const stage = writeFakeTransportStage({
      reportRawRoot: true,
      toolNames: [...TRANSPORT_NO_HOSTAPI_EXPECTED],
    });
    const aliasPath = `${stage.dir}-alias`;
    const aliasType = process.platform === 'win32' ? 'junction' : 'dir';
    try {
      symlinkSync(stage.dir, aliasPath, aliasType);
      const result = spawnSync(process.execPath, ['scripts/harness-artifact.mjs',
        '--stage-dir', aliasPath,
        '--reuse-bundle',
        '--fast',
        '--only', 'gateway-transport.no-hostapi',
      ], {
        encoding: 'utf8',
        env: {
          ...portableHarnessEnv(),
          HOME: path.join(stage.dir, 'outer-home'),
          TMPDIR: tmpdir(),
          LANG: 'C.UTF-8',
          NODE_OPTIONS: '',
          CLAWX77_TRANSPORT_TIMEOUT_MS: '10000',
        },
      });
      expect(result.status, `${result.stdout}
${result.stderr}`).toBe(0);
      expect(result.stdout).toContain(`Staging artifact runtime in ${stage.dir}`);
      expect(result.stdout).toContain('PASS              gateway-transport.no-hostapi');
    } finally {
      rmSync(aliasPath, { force: true });
      rmSync(stage.dir, { recursive: true, force: true });
    }
  });

  it('parent transport row parses the child verdict after chatty stdout drains', async () => {
    const { TRANSPORT_NO_HOSTAPI_EXPECTED } = await load();
    const stage = writeFakeTransportStage({
      toolNames: [...TRANSPORT_NO_HOSTAPI_EXPECTED],
      stdoutFlood: true,
    });
    try {
      const result = spawnSync(process.execPath, ['scripts/harness-artifact.mjs',
        '--stage-dir', stage.dir,
        '--reuse-bundle',
        '--fast',
        '--only', 'gateway-transport.no-hostapi',
      ], {
        encoding: 'utf8',
        env: {
          ...portableHarnessEnv(),
          HOME: path.join(stage.dir, 'outer-home'),
          TMPDIR: tmpdir(),
          LANG: 'C.UTF-8',
          NODE_OPTIONS: '',
          CLAWX77_TRANSPORT_TIMEOUT_MS: '10000',
        },
      });
      expect(result.status, `${result.stdout}
${result.stderr}`).toBe(0);
      expect(result.stdout).toContain('PASS              gateway-transport.no-hostapi');
      expect(result.stdout).toContain('1 PASS');
    } finally {
      rmSync(stage.dir, { recursive: true, force: true });
    }
  });

  it('transport child refuses a loader result containing unrelated plugins', async () => {
    const stage = writeFakeTransportStage();
    try {
      const verdict = runTransportChild(stage, { returnExtra: true });
      expect(verdict.exitCode).toBe(0);
      expect(verdict.payload.ok).toBe(false);
      expect(verdict.payload.infra).toBe(true);
      expect(verdict.payload.message).toContain('expected exactly 1');
    } finally {
      rmSync(stage.dir, { recursive: true, force: true });
    }
  });

  it('full transport row check FAILs when the outlook family is absent (falsifiability)', async () => {
    const { MATRIX, TRANSPORT_FULL_EXPECTED } = await load();
    const row = MATRIX.find((r: { id: string }) => r.id === 'gateway-transport.full');
    expect(row.mode).toBe('transport');
    const ok = row.check({ plugin: { id: 'moe-principal-assistant', status: 'loaded', activated: true, toolNames: [...TRANSPORT_FULL_EXPECTED] } });
    expect(ok).toBe(true);
    const noOutlook = TRANSPORT_FULL_EXPECTED.filter((n: string) => !n.startsWith('outlook.'));
    const verdict = row.check({ plugin: { id: 'moe-principal-assistant', status: 'loaded', activated: true, toolNames: noOutlook } });
    expect(verdict).not.toBe(true);
    expect(String(verdict)).toContain('outlook.send_email');
  });
});

describe('checkEnvShapeApplied — the electronlike fake must be PROVEN, not assumed (falsifiability lens MAJOR, 2026-09-06)', () => {
  it('passes an electronlike row whose child echoed the fake', async () => {
    const { checkEnvShapeApplied } = await load();
    expect(checkEnvShapeApplied('electronlike', { electron: '35.0.0', type: 'utility' })).toBe(true);
  });

  it('FAILs an electronlike row that ran as plain node — the neutered-fake false-GREEN', async () => {
    const { checkEnvShapeApplied } = await load();
    const v = checkEnvShapeApplied('electronlike', { electron: null, type: null });
    expect(v).not.toBe(true);
    expect(String(v)).toContain('NOT applied');
  });

  it('FAILs an electronlike row with no env echo at all (old child / plumbing break)', async () => {
    const { checkEnvShapeApplied } = await load();
    const v = checkEnvShapeApplied('electronlike', undefined);
    expect(v).not.toBe(true);
    expect(String(v)).toContain('no env echo');
  });

  it('does not constrain node-shape rows (the --node-bin electron degeneracy is a warning, not a row failure)', async () => {
    const { checkEnvShapeApplied } = await load();
    expect(checkEnvShapeApplied('node', { electron: '35.0.0', type: null })).toBe(true);
    expect(checkEnvShapeApplied('node', undefined)).toBe(true);
  });
});

describe('sanitizeNoteCell (evidence-report hygiene, lens minors 2026-09-06)', () => {
  it('flattens newlines and escapes pipes — a multi-line stderr note cannot break the table', async () => {
    const { sanitizeNoteCell } = await load();
    expect(sanitizeNoteCell('line1\nline2\r\nline3 | pipe')).toBe('line1 line2 line3 \\| pipe');
  });

  it('redacts the home directory to ~', async () => {
    const { sanitizeNoteCell } = await load();
    expect(sanitizeNoteCell('loaded from /Users/dev/repo/x', '/Users/dev')).toBe('loaded from ~/repo/x');
  });

  it('handles empty and undefined notes', async () => {
    const { sanitizeNoteCell } = await load();
    expect(sanitizeNoteCell('')).toBe('');
    expect(sanitizeNoteCell(undefined)).toBe('');
  });
});

describe('FAST_ROW_IDS drift guard (package preflight wiring, trail 2026-09-06)', () => {
  it('every fast row id exists in the expanded matrix — a renamed row cannot silently drop out of the preflight', async () => {
    const { MATRIX, expandMatrix, FAST_ROW_IDS } = await load();
    const ids = new Set(expandMatrix(MATRIX).map((r: { id: string }) => r.id));
    for (const id of FAST_ROW_IDS) expect(ids.has(id)).toBe(true);
  });

  it('the fast subset covers each regression family: electron-env pdf, docx r/w, xlsx, sharp binding, registration, transport', async () => {
    const { FAST_ROW_IDS } = await load();
    expect(FAST_ROW_IDS).toContain('pdf-text.read_pdf@electronlike'); // CLWX-92 class
    expect(FAST_ROW_IDS).toContain('pdf-text.read_pdf');
    expect(FAST_ROW_IDS).toContain('pdf-title.find');
    expect(FAST_ROW_IDS.some((id: string) => id.includes('read_docx'))).toBe(true);
    expect(FAST_ROW_IDS.some((id: string) => id.includes('write_docx'))).toBe(true);
    expect(FAST_ROW_IDS.some((id: string) => id.includes('read_xlsx'))).toBe(true);
    expect(FAST_ROW_IDS).toContain('png-sharp-binding.read_image'); // moe.15 canvas class
    expect(FAST_ROW_IDS).toContain('plugin-registration.full');
    expect(FAST_ROW_IDS.some((id: string) => id.startsWith('gateway-transport'))).toBe(true);
  });

  it('the package script actually runs the fast subset after bundle verify (wiring, not just capability)', async () => {
    const { readFile } = await import('node:fs/promises');
    const pkg = JSON.parse(await readFile('package.json', 'utf8'));
    const script = String(pkg.scripts.package);
    expect(script).toContain('harness-artifact.mjs --fast');
    expect(script.indexOf('verify-openclaw-bundle.mjs')).toBeLessThan(script.indexOf('harness-artifact.mjs --fast'));
  });
});
