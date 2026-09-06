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
 *   # --stage-dir always refreshes the bundle copy from build/openclaw;
 *   # --reuse-bundle skips the refresh (negative-control probes only —
 *   # a reused copy may be STALE vs a rebuilt bundle).
 *   # Staged-PLUGIN mutations for falsifiability probes: the plugin copy is
 *   # re-staged on EVERY harness run, so mutate a kept stage and drive
 *   # scripts/harness-artifact-child.mjs directly (CLAWX_APP_RESOURCES set),
 *   # then fold through foldChildExit + classifyRow — the parent path
 *   # deliberately cannot run against a tampered plugin copy.
 *
 * Covered so far: document.read/write against the staged bundle incl. the
 * password-protected + >10MB pdf rows (2026-09-06), and the plugin
 * REGISTRATION smoke (outlook/forms/browser/principal/document inventory per
 * activation mode, 2026-09-06). Later sub-steps (tracked on CLWX-77):
 * packaged-node/electron-env spawn parity, gateway-process transport,
 * package preflight wiring, K-ledger rows, Windows-lane run.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { crc32 } from 'node:zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '..');
const BUNDLE_NM = path.join(REPO_ROOT, 'build', 'openclaw', 'node_modules');
const PLUGIN_SRC = path.join(REPO_ROOT, 'extensions', 'moe-principal-assistant');
const CHILD_SCRIPT = path.join(__dirname, 'harness-artifact-child.mjs');
const ROW_TIMEOUT_MS = 60_000;

// ── classification (pure; unit-tested in tests/unit/harness-artifact.test.ts)

/**
 * Principal-readable refusal heuristic v2: the message must exist and must
 * not look like an internal dump. "Readable" here is the CLWX-77 bar —
 * "never raw stack traces" — not a prose-quality judgement. v2 adds the URL
 * reject: jszip's "see https://stuk.github.io/jszip/…" passed v1 while being
 * pure library internals (CLWX-101) — no principal refusal links anywhere.
 */
export function isReadableRefusal(message) {
  if (typeof message !== 'string' || !message.trim()) return false;
  if (/\n\s+at\s+\S/.test(message)) return false; // stack frames leaked
  if (message.includes('[object Object]')) return false;
  if (/\b(ENOENT|EACCES|EPERM|ERR_[A-Z_]+)\b/.test(message)) return false;
  // Both separators: libraries hard-code either, regardless of host OS.
  if (message.includes('node_modules/') || message.includes('node_modules\\')) return false;
  if (/^\s*(Type|Reference|Syntax)Error\b/.test(message)) return false;
  if (/https?:\/\//i.test(message)) return false; // library doc-links (CLWX-101)
  // Bracketed library tags ("[xmldom error]") and parser-location artifacts
  // ("@#[line:…") are internal dumps that carry none of the other markers
  // (review finding, 2026-09-05).
  if (/\[[a-z]+ (error|warning)\]/i.test(message)) return false;
  if (message.includes('@#[line:')) return false;
  return true;
}

/**
 * Fold a child outcome into a row status.
 *  expectation: 'ok' | 'refusal' | 'no-tool'
 *  outcome: { ok: true, result } | { ok: false, message }
 *  contentCheck: optional (result) => true | string  (string = failure note)
 *  refusalCheck: optional (message) => true | string — wording bar for rows
 *    whose refusal must say something specific (CLWX-101), on top of the
 *    generic isReadableRefusal heuristic.
 */
export function classifyRow(expectation, outcome, contentCheck, refusalCheck) {
  if (expectation === 'no-tool') {
    return { status: 'NO-TOOL', note: 'no document.* entrypoint for this type (persona carve-out, CLWX-80)' };
  }
  // Harness-infrastructure failures (timeout, spawn error, no verdict, child
  // crash) mean the tool NEVER RAN — they must never grade as a passing
  // refusal, or a hanging parser would show GREEN on exactly the rows this
  // harness exists to grade strictly (review finding, 2026-09-05).
  if (!outcome.ok && outcome.infra) {
    return { status: 'FAIL', note: `harness infrastructure failure (tool never ran): ${outcome.message}` };
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
  if (refusalCheck) {
    const verdict = refusalCheck(outcome.message);
    if (verdict !== true) {
      return { status: 'FAIL', note: `refusal wording check failed: ${verdict} — got: ${outcome.message.slice(0, 160)}` };
    }
  }
  return { status: 'REFUSED-READABLY', note: outcome.message.slice(0, 160) };
}

// ── fixtures (raw-byte ones inline; docx/xlsx via workspace deps in seed())

const PDF_MARKER = 'ARTIFACT HARNESS PDF: ICT audit circular fixture.';
function pdfWithText(marker, { padBytes = 0 } = {}) {
  const stream = `BT /F1 12 Tf 72 720 Td (${marker}) Tj ET`;
  const objects = [
    '%PDF-1.4',
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
    '2 0 obj<</Type/Pages/Count 1/Kids [3 0 R]>>endobj',
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox [0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj',
    `4 0 obj<</Length ${stream.length}>>stream\n${stream}\nendstream endobj`,
    '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj',
  ];
  if (padBytes > 0) {
    // An unused padding stream pushes the file over a size bar (the >10MB
    // CLWX-77 row) while keeping the parse surface identical to pdf-text.
    const pad = 'x'.repeat(padBytes);
    objects.push(`6 0 obj<</Length ${pad.length}>>stream\n${pad}\nendstream endobj`);
  }
  objects.push(`trailer<</Size ${padBytes > 0 ? 7 : 6}/Root 1 0 R>>`, '%%EOF');
  return objects.join('\n');
}
/**
 * An /Encrypt entry in the trailer makes pdfjs throw PasswordException
 * ("No password given") before any decryption attempt — no real cryptography
 * needed for the fixture (verified against pdf-parse 2026-09-06).
 */
function pdfEncrypted() {
  const key = `<${'68656c6c6f'.repeat(6)}6f6f>`; // 32 arbitrary bytes, hex form
  return [
    '%PDF-1.4',
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
    '2 0 obj<</Type/Pages/Count 1/Kids [3 0 R]>>endobj',
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox [0 0 612 792]>>endobj',
    `4 0 obj<</Filter/Standard/V 1/R 2/O ${key} /U ${key} /P -44>>endobj`,
    'trailer<</Size 5/Root 1 0 R/Encrypt 4 0 R>>',
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

/**
 * Minimal STORED (no compression) zip builder for fixtures that must be a
 * VALID zip container with controlled entry content — e.g. a docx whose
 * word/document.xml is malformed (the residual xmldom class, CLWX-101 review
 * finding). Hand-rolled so fixtures don't depend on a zip library the
 * workspace only carries transitively. entries: Array<[name, content]>.
 */
export function buildStoredZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const crc = crc32(data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4);         // version needed to extract
    local.writeUInt16LE(0, 8);          // method: stored
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central directory signature
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 10);         // method: stored
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);    // local header offset
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);      // end-of-central-directory signature
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, eocd]);
}
const PNG_1PX = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c626001000000050001aaaaaa00000000049454e44ae426082',
  'hex',
);

// ── registration-smoke contract (CLWX-77 outlook/forms registration leg)
//
// The plugin's registered-tool inventory is a CONTRACT: a bundled-dep break
// anywhere in index.mjs's import graph, or a regression in the config/env
// gates, silently costs the principal whole capability families ("the agent
// can't do email"). These lists pin the inventory per activation mode; adding
// a tool is a conscious matrix update, exactly like adding a doc-type row.
export const DOC_TOOL_NAMES = [
  'document.read_pdf', 'document.read_docx', 'document.write_docx',
  'document.read_xlsx', 'document.write_xlsx', 'document.read_image',
];
export const PRINCIPAL_TOOL_NAMES = [
  'principal.draft_letter', 'principal.draft_memo', 'principal.summarise_circular',
  'principal.daily_report_payload', 'principal.daily_report_form_payload',
  'principal.suspension_payload', 'principal.find_school',
];
export const BROWSER_TOOL_NAMES = ['browser.diagnose', 'browser.repair_chrome_cdp'];
export const OUTLOOK_TOOL_NAMES = [
  'outlook.open', 'outlook.read_inbox', 'outlook.draft_email', 'outlook.send_email',
  'outlook.search_inbox', 'outlook.read_email', 'outlook.reply', 'outlook.forward',
  'outlook.mark_read', 'outlook.list_attachments', 'outlook.download_attachment',
];
export const FORMS_TOOL_NAMES = [
  'forms.list', 'forms.preview_suspension', 'forms.preview_daily_report',
  'forms.submit_suspension', 'forms.submit_daily_report',
];

/**
 * Set-equality check for a registration row (pure; unit-tested). Returns
 * true or a note naming every missing/unexpected/duplicated tool — a partial
 * register must never pass by count alone, and a DOUBLE registration must
 * never hide behind set semantics (Claude lens finding, 2026-09-06).
 */
export function inventoryDiff(expected, actual) {
  const actualList = actual ?? [];
  const exp = new Set(expected);
  const act = new Set(actualList);
  const missing = [...exp].filter((n) => !act.has(n)).sort();
  const unexpected = [...act].filter((n) => !exp.has(n)).sort();
  const seen = new Set();
  const duplicated = [...new Set(actualList.filter((n) => (seen.has(n) ? true : (seen.add(n), false))))].sort();
  if (!missing.length && !unexpected.length && !duplicated.length) return true;
  const parts = [];
  if (missing.length) parts.push(`missing: ${missing.join(', ')}`);
  if (unexpected.length) parts.push(`unexpected: ${unexpected.join(', ')}`);
  if (duplicated.length) parts.push(`duplicated: ${duplicated.join(', ')}`);
  return parts.join('; ');
}

// A closed local port: the CLWX-86 capability probe fails unreachable →
// indeterminate → fail-open. Registration itself makes no other HTTP calls.
const FAKE_HOST_API = { port: 65123, token: 'artifact-harness-fake-token' };
const FULL_PLUGIN_CONFIG = {
  principalName: 'Test Principal',
  schoolName: 'Artifact Primary',
  educationDistrict: 'Victoria',
  schoolType: 'Government',
};

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
    // CLWX-77: pdfjs's "Invalid PDF structure." passed the generic bar only
    // by being URL-free — it is parser language with no way out named.
    refusalCheck: (m) => (/could not be read as a PDF/.test(m) && /damaged/.test(m) && !/Invalid PDF structure/.test(m)
      ? true : 'must use the damaged-or-not-a-PDF wording, never pdfjs internals'),
  },
  {
    // Password-protected PDF: pdfjs throws PasswordException ("No password
    // given") — the refusal must name the password and the way out, mirroring
    // the docx-password row (CLWX-77 password row).
    id: 'pdf-password.read_pdf', fn: 'readPdf', expectation: 'refusal',
    fixture: { name: 'protected.pdf', bytes: () => pdfEncrypted() },
    refusalCheck: (m) => (/password-protected/.test(m) && !/No password given/.test(m)
      ? true : 'must name password protection, not the raw pdfjs message'),
  },
  {
    // >10MB pdf must parse fine and keep its text extraction (CLWX-77 large
    // row): guards against size caps or buffer-handling regressions in the
    // staged runtime that a 1KB fixture can never catch.
    id: 'pdf-large.read_pdf', fn: 'readPdf', expectation: 'ok',
    fixture: { name: 'yearbook.pdf', bytes: () => pdfWithText(PDF_MARKER, { padBytes: 10_500_000 }) },
    check: (r) => (r.bytes > 10_000_000 && String(r.text ?? '').includes('ICT audit circular')
      ? true : `expected >10MB parsed with marker (bytes=${r.bytes}, totalChars=${r.totalChars})`),
  },
  {
    id: 'docx.read_docx', fn: 'readDocx', expectation: 'ok',
    fixture: { name: 'letter.docx', seed: 'docx', paragraphs: ['Dear parent, the ICT audit is Friday.'] },
    check: (r) => (String(r.markdown ?? '').includes('ICT audit') ? true : 'seed paragraph missing from markdown'),
  },
  {
    id: 'doc-legacy.read_docx', fn: 'readDocx', expectation: 'refusal',
    fixture: { name: 'legacy.doc', bytes: () => Buffer.concat([OLE_MAGIC, Buffer.alloc(512)]) },
    // CLWX-101: must name the likely format and the way out — jszip's
    // "end of central directory … see https://stuk.github.io/…" FAILs here.
    refusalCheck: (m) => (/legacy Word document \(\.doc\b/.test(m) && /Save As/i.test(m) && /\.docx/.test(m)
      ? true : 'must name legacy Word (.doc) and the Save-As-.docx way out'),
  },
  {
    id: 'rtf.read_docx', fn: 'readDocx', expectation: 'refusal',
    fixture: { name: 'memo.rtf', bytes: () => '{\\rtf1\\ansi Hello from RTF land.}' },
    refusalCheck: (m) => (/Rich Text Format file \(\.rtf\)/.test(m) && /Save As/i.test(m) && /\.docx/.test(m)
      ? true : 'must name Rich Text Format (.rtf) and the Save-As-.docx way out'),
  },
  {
    id: 'odt.read_docx', fn: 'readDocx', expectation: 'refusal',
    fixture: { name: 'notes.odt', bytes: () => EMPTY_ZIP },
    // Pinned so a mammoth upgrade that changes its missing-part text can't
    // silently re-leak library language here (review finding, 2026-09-05).
    refusalCheck: (m) => (/not a Word document inside/.test(m) && /OpenDocument/.test(m)
      ? true : 'must name the renamed-format cause (e.g. OpenDocument), not mammoth internals'),
  },
  {
    // Valid zip container, mangled XML inside — the residual class that
    // reached the principal as raw "[xmldom error] …" text (CLWX-101 review
    // finding, 2026-09-05): jszip parses fine, mammoth's xmldom throws.
    id: 'docx-badxml.read_docx', fn: 'readDocx', expectation: 'refusal',
    fixture: { name: 'mangled.docx', bytes: () => buildStoredZip([['word/document.xml', '<w:document><w:body><w:p><unclosed']]) },
    refusalCheck: (m) => (/damaged or incomplete/.test(m) && !/xmldom|@#\[line:/i.test(m)
      ? true : 'must use the damaged-file wording, never xmldom internals'),
  },
  {
    // Password-protected modern .docx is an OLE2/CFB container
    // (MS-OFFCRYPTO) with an EncryptedPackage stream — same magic as legacy
    // .doc. The refusal must name the password, not "legacy Word 97-2003"
    // (CLWX-101 review finding, 2026-09-05).
    id: 'docx-password.read_docx', fn: 'readDocx', expectation: 'refusal',
    fixture: {
      name: 'protected.docx',
      bytes: () => Buffer.concat([OLE_MAGIC, Buffer.alloc(64), Buffer.from('EncryptedPackage', 'utf16le'), Buffer.alloc(64)]),
    },
    refusalCheck: (m) => (/password-protected/.test(m) && !/legacy Word/.test(m)
      ? true : 'must name password protection, not legacy Word'),
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
    // readImage treats sharp as a soft dep (raw bytes fall through), so the
    // row above can never catch a broken native binding. The bundle SHIPS
    // sharp, so on the artifact "sharp loads and reads metadata" is the bar:
    // width comes back non-null ONLY when the native binding worked (review
    // finding, 2026-09-05 — the moe.15 canvas class, image edition).
    id: 'png-sharp-binding.read_image', fn: 'readImage', expectation: 'ok',
    fixture: { name: 'probe.png', bytes: () => PNG_1PX },
    check: (r) => (r.width === 1 && r.height === 1 ? true : `sharp did not decode metadata (width=${r.width}) — binding missing or broken in the staged bundle`),
  },
  {
    id: 'pptx.read', fn: null, expectation: 'no-tool',
    // No document.read_pptx exists; the persona carves .pptx out honestly
    // (CLWX-80 fix). This row keeps the gap visible in every matrix run.
  },
  {
    // Registration smoke, full activation: complete config + host-API env →
    // the ENTIRE 31-tool inventory must register from the STAGED PLUGIN copy
    // (outlook 11 + forms 5 + browser 2 + principal 7 + document 6). Pins the
    // env/config gates and entry-file integrity. Honest coverage note: index
    // .mjs's static import graph today is builtins + local files (doc deps
    // load lazily at call time — the doc rows cover those), so this row
    // exercises staged-BUNDLE resolution only if a future eager npm import
    // appears — at which point a bundle gap fails it loudly.
    id: 'plugin-registration.full', mode: 'register', expectation: 'ok',
    register: { pluginConfig: FULL_PLUGIN_CONFIG, hostApi: FAKE_HOST_API },
    check: (r) => inventoryDiff(
      [...DOC_TOOL_NAMES, ...PRINCIPAL_TOOL_NAMES, ...BROWSER_TOOL_NAMES, ...OUTLOOK_TOOL_NAMES, ...FORMS_TOOL_NAMES],
      r.names,
    ),
  },
  {
    // The production email kill-switch, legacy contract: host.skillAllowlist
    // WITHOUT 'outlook' suppresses exactly the outlook family — forms/
    // browser/principal/document are deliberately unaffected (asymmetric by
    // design; `outlook` in PRINCIPAL_SKILL_ALLOWLIST is the kill-switch).
    id: 'plugin-registration.killswitch', mode: 'register', expectation: 'ok',
    register: { pluginConfig: FULL_PLUGIN_CONFIG, hostApi: FAKE_HOST_API, host: { skillAllowlist: [] } },
    check: (r) => inventoryDiff(
      [...DOC_TOOL_NAMES, ...PRINCIPAL_TOOL_NAMES, ...BROWSER_TOOL_NAMES, ...FORMS_TOOL_NAMES],
      r.names,
    ),
  },
  {
    // No host-API env (e.g. gateway launched outside the app): outlook/
    // forms/browser tools must NOT register (nothing to call), while doc +
    // principal tools still do — the honest-degradation contract.
    id: 'plugin-registration.no-hostapi', mode: 'register', expectation: 'ok',
    register: { pluginConfig: FULL_PLUGIN_CONFIG },
    check: (r) => inventoryDiff([...DOC_TOOL_NAMES, ...PRINCIPAL_TOOL_NAMES], r.names),
  },
  {
    // Missing principal config: register() takes the early-return path —
    // ONLY the document tools register (they are deliberately registered
    // before the config gate; the moe-principal warn path). Pins BUG-012
    // adjacent behavior: a bad config must never take doc tools down.
    id: 'plugin-registration.no-config', mode: 'register', expectation: 'ok',
    register: { pluginConfig: {}, hostApi: FAKE_HOST_API },
    check: (r) => {
      const diff = inventoryDiff(DOC_TOOL_NAMES, r.names);
      if (diff !== true) return diff;
      return r.returned && r.returned.registered === false && r.returned.docToolsRegistered === true
        ? true : `expected returned {registered:false, docToolsRegistered:true}, got ${JSON.stringify(r.returned)}`;
    },
  },
];

// ── staging

async function stageArtifact(stageDir, { reuseBundle = false } = {}) {
  const resources = path.join(stageDir, 'resources');
  const pluginDest = path.join(resources, 'extensions', 'moe-principal-assistant');
  const bundleDest = path.join(resources, 'openclaw', 'node_modules');
  await mkdir(path.dirname(pluginDest), { recursive: true });
  await rm(pluginDest, { recursive: true, force: true });
  await cp(PLUGIN_SRC, pluginDest, { recursive: true });
  if (reuseBundle && existsSync(bundleDest)) {
    // Explicit opt-in only (negative-control probes mutate the stage). A
    // silently reused stage after a bundle rebuild would test a STALE bundle
    // and report GREEN for a broken artifact (review finding, 2026-09-05).
    console.warn('WARNING: --reuse-bundle set — testing the EXISTING staged bundle, which may be stale vs build/openclaw.');
  } else {
    await rm(bundleDest, { recursive: true, force: true });
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

/**
 * Fold a child's exit status + framed verdict into the row outcome (pure;
 * unit-tested). A nonzero exit or a signal is an infrastructure FAIL even
 * when a success verdict was already framed — a controlled mutation proved
 * an async crash scheduled inside register() could exit 1 while the row
 * still graded PASS on the framed verdict (Codex lane finding, 2026-09-06);
 * the same crash in the real gateway takes the plugin host down.
 */
export function foldChildExit(code, signal, verdict, stderrSnippet = '') {
  if (signal) {
    return { ok: false, infra: true, message: `child killed by ${signal}${verdict ? ' after framing a verdict (discarded)' : ''}` };
  }
  if (code !== 0) {
    return {
      ok: false,
      infra: true,
      message: `child exited ${code}${verdict ? ' after framing a verdict (discarded — an async crash would kill the real gateway)' : ''}; stderr: ${stderrSnippet}`,
    };
  }
  if (!verdict) {
    return { ok: false, infra: true, message: `child produced no framed verdict; stderr: ${stderrSnippet}` };
  }
  return verdict;
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
    // Timeout / spawn / missing-verdict outcomes carry infra: true — the
    // tool never produced a graded outcome, so classifyRow must FAIL the
    // row, never count it as a refusal (review finding, 2026-09-05).
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ ok: false, infra: true, message: `row timed out after ${ROW_TIMEOUT_MS}ms` });
    }, ROW_TIMEOUT_MS);
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      // Sentinel-framed verdict: a chatty dep writing to stdout cannot
      // corrupt the parse (last framed line wins). Exit status is folded in
      // AFTER parsing: a framed success from a child that then crashed is
      // discarded (foldChildExit — Codex lane finding, 2026-09-06).
      const line = stdout.split('\n').filter((l) => l.startsWith('CLAWX77_VERDICT:')).pop();
      let verdict = null;
      try {
        verdict = JSON.parse(line.slice('CLAWX77_VERDICT:'.length));
      } catch { /* no framed verdict — foldChildExit reports it */ }
      resolve(foldChildExit(code, signal, verdict, stderr.slice(0, 300)));
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, infra: true, message: `spawn failed: ${err.message}` });
    });
  });
}

// ── main

function parseArgs(argv) {
  const args = { only: null, report: null, stageDir: null, keepStage: false, reuseBundle: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--only') args.only = argv[++i];
    else if (a.startsWith('--only=')) args.only = a.slice(7);
    else if (a === '--report') args.report = argv[++i];
    else if (a.startsWith('--report=')) args.report = a.slice(9);
    else if (a === '--stage-dir') args.stageDir = argv[++i];
    else if (a.startsWith('--stage-dir=')) args.stageDir = a.slice(12);
    else if (a === '--keep-stage') args.keepStage = true;
    else if (a === '--reuse-bundle') args.reuseBundle = true;
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
  const { resources, pluginDest } = await stageArtifact(stageDir, { reuseBundle: args.reuseBundle });
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
    } else if (row.mode === 'register') {
      const outcome = await runChild(
        { mode: 'register', pluginIndexPath: path.join(pluginDest, 'index.mjs'), ...row.register },
        resources,
      );
      verdict = classifyRow(row.expectation, outcome, row.check, row.refusalCheck);
    } else {
      const workDir = path.join(stageDir, 'work', row.id.replace(/[^a-z0-9_.-]/gi, '_'));
      await mkdir(workDir, { recursive: true });
      const fixturePath = await seedRowFixture(row, workDir);
      const callArgs = row.args ? row.args(workDir) : { path: fixturePath };
      const outcome = await runChild({ docToolsPath, fn: row.fn, args: callArgs }, resources);
      verdict = classifyRow(row.expectation, outcome, row.check, row.refusalCheck);
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
      `# Artifact harness matrix (CLWX-77)`,
      '',
      `Staged plugin + gateway bundle outside the repo tree; each row ran in a`,
      `child process resolving deps ONLY from the staged bundle (CLAWX_APP_RESOURCES seam).`,
      `Registration rows call the staged plugin's register() with a mock gateway API;`,
      `fetch is stubbed in the child before the plugin loads, so the CLWX-86 probe is`,
      `deterministically unreachable (fail-open) and no socket is ever opened.`,
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
