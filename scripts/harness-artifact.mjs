#!/usr/bin/env node
/**
 * harness-artifact.mjs — CLWX-77 artifact-grade doc-tooling matrix (slice 1).
 *
 * Why this exists: every packaging-class defect so far (playwright-core
 * moe.9, canvas binding moe.15, pdf-parse/DOMMatrix CLWX-72) shipped because
 * tests ran from the repo workspace, where Node's walk-up resolution finds
 * the repo node_modules and silently masks packaged-runtime gaps. This
 * harness closes that seam: it stages the SHIPPED plugin source plus the
 * REAL gateway bundle (build/openclaw/node_modules) into a temp directory
 * OUTSIDE the repo tree — so walk-up finds nothing — and exercises each
 * doc-type × command row in a child process whose only dep roots are the
 * staged bundle (via CLAWX_APP_RESOURCES, the same seam the packaged app
 * uses in extensions/moe-principal-assistant/doc-tools.mjs).
 *
 * Row statuses:
 *   PASS              — expected-ok row resolved and its content check held.
 *   REFUSED-READABLY  — expected-refusal row threw a principal-readable error.
 *   FAIL              — anything else (raw trace, wrong outcome, bad content).
 *   NO-TOOL           — doc type has no document.* entrypoint (recorded so
 *                       the matrix is honest about coverage; not a failure).
 *
 * Fixture GENERATION may use workspace deps (docx/xlsx) — the system under
 * test is only ever the staged runtime in the child process.
 *
 * Usage:
 *   pnpm harness:artifact                 # full slice, temp stage, cleanup
 *   pnpm harness:artifact --only pdf-text.read_pdf
 *   pnpm harness:artifact --report docs/evidence/HARNESS_ARTIFACT.md
 *   pnpm harness:artifact --stage-dir /tmp/clawx-stage --keep-stage
 *
 * Slice 1 covers document.read/write against the staged bundle. Later
 * sub-steps (tracked on CLWX-77): packaged-node/electron-env spawn parity,
 * password-protected + >10MB pdf rows, outlook/forms registration smoke,
 * gateway-process transport, package preflight wiring, K-ledger rows.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '..');
const BUNDLE_NM = path.join(REPO_ROOT, 'build', 'openclaw', 'node_modules');
const PLUGIN_SRC = path.join(REPO_ROOT, 'extensions', 'moe-principal-assistant');
const CHILD_SCRIPT = path.join(__dirname, 'harness-artifact-child.mjs');
const ROW_TIMEOUT_MS = 60_000;

// ── classification (pure; unit-tested in tests/unit/harness-artifact.test.ts)

/**
 * Principal-readable refusal heuristic v1: the message must exist and must
 * not look like an internal dump. "Readable" here is the CLWX-77 bar —
 * "never raw stack traces" — not a prose-quality judgement.
 */
export function isReadableRefusal(message) {
  if (typeof message !== 'string' || !message.trim()) return false;
  if (/\n\s+at\s+\S/.test(message)) return false; // stack frames leaked
  if (message.includes('[object Object]')) return false;
  if (/\b(ENOENT|EACCES|EPERM|ERR_[A-Z_]+)\b/.test(message)) return false;
  if (message.includes(`node_modules${path.sep}`)) return false;
  if (/^\s*(Type|Reference|Syntax)Error\b/.test(message)) return false;
  return true;
}

/**
 * Fold a child outcome into a row status.
 *  expectation: 'ok' | 'refusal' | 'no-tool'
 *  outcome: { ok: true, result } | { ok: false, message }
 *  contentCheck: optional (result) => true | string  (string = failure note)
 */
export function classifyRow(expectation, outcome, contentCheck) {
  if (expectation === 'no-tool') {
    return { status: 'NO-TOOL', note: 'no document.* entrypoint for this type (persona carve-out, CLWX-80)' };
  }
  if (expectation === 'ok') {
    if (!outcome.ok) return { status: 'FAIL', note: `expected ok, threw: ${outcome.message}` };
    if (contentCheck) {
      const verdict = contentCheck(outcome.result);
      if (verdict !== true) return { status: 'FAIL', note: `content check failed: ${verdict}` };
    }
    return { status: 'PASS', note: '' };
  }
  // expectation === 'refusal'
  if (outcome.ok) return { status: 'FAIL', note: 'expected a refusal, call resolved ok' };
  if (!isReadableRefusal(outcome.message)) {
    return { status: 'FAIL', note: `refusal is not principal-readable: ${outcome.message}` };
  }
  return { status: 'REFUSED-READABLY', note: outcome.message.slice(0, 160) };
}

// ── fixtures (raw-byte ones inline; docx/xlsx via workspace deps in seed())

const PDF_MARKER = 'ARTIFACT HARNESS PDF: ICT audit circular fixture.';
function pdfWithText(marker) {
  const stream = `BT /F1 12 Tf 72 720 Td (${marker}) Tj ET`;
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
function pdfNoText() {
  return [
    '%PDF-1.4',
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
    '2 0 obj<</Type/Pages/Count 1/Kids [3 0 R]>>endobj',
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox [0 0 612 792]/Contents 4 0 R>>endobj',
    '4 0 obj<</Length 0>>stream\n\nendstream endobj',
    'trailer<</Size 5/Root 1 0 R>>',
    '%%EOF',
  ].join('\n');
}
const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const EMPTY_ZIP = Buffer.concat([Buffer.from('PK\x05\x06', 'binary'), Buffer.alloc(18)]);
const PNG_1PX = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c626001000000050001aaaaaa00000000049454e44ae426082',
  'hex',
);

/**
 * The slice-1 matrix. `fixture` seeds a file in the row's work dir (string |
 * Buffer | async fn(workDir) => filePath); `args` may reference the seeded
 * path via the FIXTURE token.
 */
export const MATRIX = [
  {
    id: 'pdf-text.read_pdf', fn: 'readPdf', expectation: 'ok',
    fixture: { name: 'circular.pdf', bytes: () => pdfWithText(PDF_MARKER) },
    check: (r) => (String(r.text ?? '').includes('ICT audit circular') ? true : `marker missing from extracted text (totalChars=${r.totalChars})`),
  },
  {
    id: 'pdf-scanned-notext.read_pdf', fn: 'readPdf', expectation: 'ok',
    fixture: { name: 'scan.pdf', bytes: () => pdfNoText() },
    // A scanned/image-only pdf must not crash; principal-facing empty-text
    // handling is a persona concern recorded via the note.
    check: (r) => (typeof r.totalChars === 'number' ? true : 'result missing totalChars'),
  },
  {
    id: 'pdf-corrupt.read_pdf', fn: 'readPdf', expectation: 'refusal',
    fixture: { name: 'broken.pdf', bytes: () => `%PDF-1.4\n${'garbage '.repeat(64)}` },
  },
  {
    id: 'docx.read_docx', fn: 'readDocx', expectation: 'ok',
    fixture: { name: 'letter.docx', seed: 'docx', paragraphs: ['Dear parent, the ICT audit is Friday.'] },
    check: (r) => (String(r.markdown ?? '').includes('ICT audit') ? true : 'seed paragraph missing from markdown'),
  },
  {
    id: 'doc-legacy.read_docx', fn: 'readDocx', expectation: 'refusal',
    fixture: { name: 'legacy.doc', bytes: () => Buffer.concat([OLE_MAGIC, Buffer.alloc(512)]) },
  },
  {
    id: 'rtf.read_docx', fn: 'readDocx', expectation: 'refusal',
    fixture: { name: 'memo.rtf', bytes: () => '{\\rtf1\\ansi Hello from RTF land.}' },
  },
  {
    id: 'odt.read_docx', fn: 'readDocx', expectation: 'refusal',
    fixture: { name: 'notes.odt', bytes: () => EMPTY_ZIP },
  },
  {
    id: 'docx-out.write_docx', fn: 'writeDocx', expectation: 'ok',
    args: (workDir) => ({ path: path.join(workDir, 'out.docx'), title: 'Minutes', paragraphs: ['Meeting opened at 9am.'] }),
    check: (r) => (r.bytes > 0 && existsSync(r.path) ? true : 'no bytes written'),
  },
  {
    id: 'xlsx.read_xlsx', fn: 'readXlsx', expectation: 'ok',
    fixture: { name: 'marks.xlsx', seed: 'xlsx', rows: [['student', 'marks'], ['A. Charran', 87]] },
    check: (r) => (JSON.stringify(r.rows ?? []).includes('Charran') ? true : 'seed row missing'),
  },
  {
    id: 'csv.read_xlsx', fn: 'readXlsx', expectation: 'ok',
    fixture: { name: 'roster.csv', bytes: () => 'student,marks\nB. Mohammed,91\n' },
    check: (r) => (JSON.stringify(r.rows ?? []).includes('Mohammed') ? true : 'csv row missing'),
  },
  {
    id: 'xlsx-out.write_xlsx', fn: 'writeXlsx', expectation: 'ok',
    args: (workDir) => ({ path: path.join(workDir, 'out.xlsx'), sheets: [{ name: 'Daily', rows: [['present', 412]] }] }),
    check: (r) => (r.bytes > 0 && existsSync(r.path) ? true : 'no bytes written'),
  },
  {
    id: 'png.read_image', fn: 'readImage', expectation: 'ok',
    fixture: { name: 'badge.png', bytes: () => PNG_1PX },
    check: (r) => (String(r.dataUrl ?? '').startsWith('data:image/') ? true : 'no dataUrl produced'),
  },
  {
    id: 'pptx.read', fn: null, expectation: 'no-tool',
    // No document.read_pptx exists; the persona carves .pptx out honestly
    // (CLWX-80 fix). This row keeps the gap visible in every matrix run.
  },
];

// ── staging

async function stageArtifact(stageDir) {
  const resources = path.join(stageDir, 'resources');
  const pluginDest = path.join(resources, 'extensions', 'moe-principal-assistant');
  const bundleDest = path.join(resources, 'openclaw', 'node_modules');
  await mkdir(path.dirname(pluginDest), { recursive: true });
  await cp(PLUGIN_SRC, pluginDest, { recursive: true });
  if (!existsSync(bundleDest)) {
    await mkdir(path.dirname(bundleDest), { recursive: true });
    // APFS clonefile makes the 500MB bundle copy near-instant on darwin; a
    // symlink would be WRONG here — Node resolves modules at their realpath,
    // so transitive requires would walk up into the repo node_modules and
    // mask exactly the gap class this harness exists to catch.
    if (process.platform === 'darwin') {
      await new Promise((resolve, reject) => {
        const child = spawn('cp', ['-Rc', BUNDLE_NM, bundleDest], { stdio: 'inherit' });
        child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`cp -Rc exited ${code}`))));
        child.on('error', reject);
      });
    } else {
      await cp(BUNDLE_NM, bundleDest, { recursive: true });
    }
  }
  return { resources, pluginDest };
}

async function seedRowFixture(row, workDir) {
  if (!row.fixture) return null;
  const outPath = path.join(workDir, row.fixture.name);
  if (row.fixture.bytes) {
    const data = row.fixture.bytes();
    await writeFile(outPath, typeof data === 'string' ? Buffer.from(data, 'binary') : data);
    return outPath;
  }
  if (row.fixture.seed === 'docx') {
    const { Document, Packer, Paragraph } = await import('docx');
    const doc = new Document({
      sections: [{ properties: {}, children: row.fixture.paragraphs.map((t) => new Paragraph({ text: String(t) })) }],
    });
    await writeFile(outPath, await Packer.toBuffer(doc));
    return outPath;
  }
  if (row.fixture.seed === 'xlsx') {
    const xlsx = await import('xlsx');
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(row.fixture.rows), 'Sheet1');
    await writeFile(outPath, xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' }));
    return outPath;
  }
  throw new Error(`row ${row.id}: unknown fixture kind`);
}

function runChild(spec, resources) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CHILD_SCRIPT, JSON.stringify(spec)], {
      cwd: path.dirname(CHILD_SCRIPT),
      env: {
        ...process.env,
        CLAWX_APP_RESOURCES: resources,
        // Defensive: never inherit a workspace-augmented module path.
        NODE_PATH: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ ok: false, message: `row timed out after ${ROW_TIMEOUT_MS}ms` });
    }, ROW_TIMEOUT_MS);
    child.on('exit', () => {
      clearTimeout(timer);
      const line = stdout.split('\n').filter(Boolean).pop() ?? '';
      try {
        resolve(JSON.parse(line));
      } catch {
        resolve({ ok: false, message: `child produced no JSON verdict; stderr: ${stderr.slice(0, 300)}` });
      }
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, message: `spawn failed: ${err.message}` });
    });
  });
}

// ── main

function parseArgs(argv) {
  const args = { only: null, report: null, stageDir: null, keepStage: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--only') args.only = argv[++i];
    else if (a.startsWith('--only=')) args.only = a.slice(7);
    else if (a === '--report') args.report = argv[++i];
    else if (a.startsWith('--report=')) args.report = a.slice(9);
    else if (a === '--stage-dir') args.stageDir = argv[++i];
    else if (a.startsWith('--stage-dir=')) args.stageDir = a.slice(12);
    else if (a === '--keep-stage') args.keepStage = true;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!existsSync(BUNDLE_NM)) {
    console.error(`FAIL: gateway bundle not found at ${BUNDLE_NM} — run: pnpm exec zx scripts/bundle-openclaw.mjs`);
    process.exit(1);
  }
  const stageDir = args.stageDir
    ? path.resolve(args.stageDir)
    : await mkdtemp(path.join(os.tmpdir(), 'clawx-artifact-'));
  if (stageDir.startsWith(REPO_ROOT + path.sep)) {
    console.error('FAIL: --stage-dir must be OUTSIDE the repo tree (walk-up resolution would mask bundle gaps).');
    process.exit(1);
  }
  console.log(`Staging artifact runtime in ${stageDir} …`);
  const t0 = Date.now();
  const { resources, pluginDest } = await stageArtifact(stageDir);
  const docToolsPath = path.join(pluginDest, 'doc-tools.mjs');
  console.log(`Staged in ${((Date.now() - t0) / 1000).toFixed(1)}s. Running ${MATRIX.length} rows …\n`);

  const rows = MATRIX.filter((r) => !args.only || r.id === args.only);
  if (!rows.length) {
    console.error(`FAIL: --only ${args.only} matches no row. Rows: ${MATRIX.map((r) => r.id).join(', ')}`);
    process.exit(1);
  }
  const results = [];
  for (const row of rows) {
    const started = Date.now();
    let verdict;
    if (row.expectation === 'no-tool') {
      verdict = classifyRow('no-tool', { ok: false, message: '' });
    } else {
      const workDir = path.join(stageDir, 'work', row.id.replace(/[^a-z0-9_.-]/gi, '_'));
      await mkdir(workDir, { recursive: true });
      const fixturePath = await seedRowFixture(row, workDir);
      const callArgs = row.args ? row.args(workDir) : { path: fixturePath };
      const outcome = await runChild({ docToolsPath, fn: row.fn, args: callArgs }, resources);
      verdict = classifyRow(row.expectation, outcome, row.check);
    }
    const ms = Date.now() - started;
    results.push({ id: row.id, ...verdict, ms });
    console.log(`  ${verdict.status.padEnd(17)} ${row.id} (${ms}ms)${verdict.note ? ` — ${verdict.note}` : ''}`);
  }

  const fails = results.filter((r) => r.status === 'FAIL');
  const summary = `${results.length} rows: ${results.filter((r) => r.status === 'PASS').length} PASS, `
    + `${results.filter((r) => r.status === 'REFUSED-READABLY').length} REFUSED-READABLY, `
    + `${fails.length} FAIL, ${results.filter((r) => r.status === 'NO-TOOL').length} NO-TOOL`;
  console.log(`\n${fails.length ? '✗' : '✓'} harness:artifact — ${summary}`);

  if (args.report) {
    const lines = [
      `# Artifact harness matrix — slice 1 (CLWX-77)`,
      '',
      `Staged plugin + gateway bundle outside the repo tree; each row ran in a`,
      `child process resolving deps ONLY from the staged bundle (CLAWX_APP_RESOURCES seam).`,
      '',
      '| Row | Status | Note | ms |',
      '|---|---|---|---|',
      ...results.map((r) => `| ${r.id} | ${r.status} | ${r.note.replace(/\|/g, '\\|')} | ${r.ms} |`),
      '',
      `Summary: ${summary}`,
      '',
    ];
    await mkdir(path.dirname(path.resolve(args.report)), { recursive: true });
    await writeFile(path.resolve(args.report), lines.join('\n'));
    console.log(`Report written to ${args.report}`);
  }

  if (!args.keepStage && !args.stageDir) {
    await rm(stageDir, { recursive: true, force: true });
  } else {
    console.log(`Stage kept at ${stageDir}`);
  }
  process.exit(fails.length ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(`harness:artifact crashed: ${err instanceof Error ? err.stack : String(err)}`);
    process.exit(1);
  });
}
