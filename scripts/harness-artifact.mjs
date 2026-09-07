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
 *   pnpm harness:artifact --fast          # pinned fast subset (package preflight)
 *   pnpm harness:artifact --only pdf-text.read_pdf@electronlike
 *   pnpm harness:artifact --report docs/evidence/HARNESS_ARTIFACT.md
 *   pnpm harness:artifact --stage-dir /tmp/clawx-stage --keep-stage
 *   pnpm harness:artifact --node-bin /path/to/packaged/node   # spawn rows
 *   #   under a REAL packaged node binary (Windows-lane / ELECTRON_RUN_AS_NODE
 *   #   parity runs); default is the dev process.execPath.
 *   # --stage-dir normally refreshes the gateway copy from build/openclaw;
 *   # --reuse-bundle skips the refresh and requires an existing
 *   # <stage-dir>/resources/openclaw bundle (native diagnostics /
 *   # negative-control probes only — a reused copy may be STALE vs a
 *   # rebuilt bundle unless the caller binds provenance separately).
 *   # Staged-PLUGIN mutations for falsifiability probes: the plugin copy is
 *   # re-staged on EVERY harness run, so mutate a kept stage and drive
 *   # scripts/harness-artifact-child.mjs directly (CLAWX_APP_RESOURCES set),
 *   # then fold through foldChildExit + classifyRow — the parent path
 *   # deliberately cannot run against a tampered plugin copy.
 *
 * Covered so far: document.read/write against the staged bundle incl. the
 * password-protected + >10MB pdf rows (2026-09-06), the plugin REGISTRATION
 * smoke (tool inventory per activation mode, 2026-09-06), and — landed
 * 2026-09-06 (trail tick):
 *   - ELECTRON-ENV SPAWN PARITY: every doc/register row also runs under the
 *     Electron UtilityProcess env shape (process.versions.electron +
 *     process.type='utility' — the packaged gateway's actual shape via
 *     utilityProcess.fork, and the CLWX-92/moe.16 failure env), as
 *     `<id>@electronlike` rows. Transport rows are deliberately EXCLUDED
 *     from the fake shape: the real gateway dist under a faked electron env
 *     without real electron modules would test an untruthful combination —
 *     the true utility-env gateway run is the Windows/VM lane.
 *   - GATEWAY-PROCESS TRANSPORT: rows import the STAGED OpenClaw
 *     plugin loader scoped to the MoE plugin with a hermetic
 *     OPENCLAW_STATE_DIR whose config points plugins.load.paths at the
 *     staged plugin — the plugin loads through the REAL gateway plugin-host
 *     (not the harness mock) and the reported toolNames must match the
 *     contract inventory.
 *   - K-LEDGER ROWS (K8 intermittence): kLedger-tagged doc read/write rows
 *     run 3× per shape in FRESH children; iterations that disagree FAIL the
 *     row naming the K8 class ("sometimes reads well, other times errors").
 *     K10 variants (scanned/password/large pdf) are tagged where they live.
 *     Honest mapping: K1/K2/K11/K12/K13 live in the Outlook/VM lanes
 *     (v2-eval, VM matrix), K4 in the ASR lane (CLWX-87), K9/K14 are in-app
 *     fixtures — none of those can be graded by this harness.
 *   - PACKAGE PREFLIGHT WIRING: `--fast` runs the pinned FAST_ROW_IDS subset
 *     and is wired into the `package` script right after
 *     verify-openclaw-bundle, so package:mac / build:win cannot ship a bundle
 *     that fails the fast lane.
 * Remaining sub-steps (tracked on CLWX-77): Windows-lane run (true packaged
 * node.exe + real utility-env gateway), in-app K10 drag-gesture cell.
 */
import { spawn } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { cp, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { crc32 } from 'node:zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '..');
const OPENCLAW_DIR = path.join(REPO_ROOT, 'build', 'openclaw');
const BUNDLE_NM = path.join(OPENCLAW_DIR, 'node_modules');
const PLUGIN_SRC = path.join(REPO_ROOT, 'extensions', 'moe-principal-assistant');
const CHILD_SCRIPT = path.join(__dirname, 'harness-artifact-child.mjs');
const TRANSPORT_CHILD_SCRIPT = path.join(__dirname, 'harness-artifact-transport-child.mjs');
const ROW_TIMEOUT_MS = 60_000;
// The transport row imports the staged OpenClaw plugin-host in a child. Give
// it more headroom than a doc-tools child because it still loads the shipped
// plugin runtime and dependencies. The
// env override exists for slow build hosts — the fast lane is a release
// gate and a red-for-CPU-reasons build needs a knob, not a code edit
// (isolation lens, 2026-09-06).
const TRANSPORT_TIMEOUT_MS = Number(process.env.CLAWX77_TRANSPORT_TIMEOUT_MS ?? 120_000);

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
  'principal.suspension_payload', 'principal.find_school', 'principal.nscc_lookup',
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

// ── gateway-process transport (CLWX-77 trail leg, 2026-09-06)
//
// The register-mode rows prove the plugin against a MOCK gateway API; these
// prove it through the REAL gateway plugin-host: a scoped child imports the
// staged OpenClaw loader with onlyPluginIds=['moe-principal-assistant'], the
// same registerTool surface used by the shipped gateway process, and reports
// the registered toolNames. State is hermetic (OPENCLAW_STATE_DIR inside the
// stage); network is stubbed via a --require preload (fetch records+rejects,
// no socket) so the CLWX-86 capability probe deterministically fails open.
export const TRANSPORT_PLUGIN_ID = 'moe-principal-assistant';
export const TRANSPORT_NO_HOSTAPI_EXPECTED = [...DOC_TOOL_NAMES, ...PRINCIPAL_TOOL_NAMES];
export const TRANSPORT_FULL_EXPECTED = [
  ...DOC_TOOL_NAMES, ...PRINCIPAL_TOOL_NAMES, ...BROWSER_TOOL_NAMES,
  ...OUTLOOK_TOOL_NAMES, ...FORMS_TOOL_NAMES,
];

/**
 * Extract the top-level JSON object from legacy `plugins inspect --json`
 * stdout, which interleaves plugin register log lines and config warnings
 * before the JSON block (pure; unit-tested). Retained for fixture/backward
 * parser coverage; current transport rows use the scoped child verdict.
 */
export function parseInspectJson(stdout) {
  if (typeof stdout !== 'string' || !stdout.trim()) return null;
  const lines = stdout.split('\n');
  let offset = 0;
  for (const line of lines) {
    if (line.trimEnd() === '{') {
      try {
        return JSON.parse(stdout.slice(offset));
      } catch { /* a log line that was just "{" — keep scanning */ }
    }
    offset += line.length + 1;
  }
  return null;
}

/**
 * Grade a transport-row inspect payload (pure; unit-tested): the plugin must
 * be loaded + activated through the real gateway host and its toolNames must
 * match the contract inventory exactly (inventoryDiff semantics).
 */
export function checkTransportInspect(expectedTools, payload) {
  if (Array.isArray(payload?.plugins)) {
    return `transport payload included ${payload.plugins.length} plugin(s); expected a single scoped plugin payload`;
  }
  const plugin = payload?.plugin;
  if (!plugin) return 'inspect payload has no plugin object';
  if (plugin.id !== TRANSPORT_PLUGIN_ID) return `plugin id is "${plugin.id ?? 'unknown'}", expected "${TRANSPORT_PLUGIN_ID}"`;
  if (plugin.status !== 'loaded') return `plugin status is "${plugin.status}", expected "loaded"`;
  if (plugin.activated !== true) return `plugin not activated (activationReason: ${plugin.activationReason ?? 'unknown'})`;
  return inventoryDiff(expectedTools, plugin.toolNames);
}

/**
 * Verify the gateway loaded the plugin FROM THE STAGE (pure; unit-tested).
 * Codex lane finding (2026-09-06): without this, an inherited
 * OPENCLAW_CONFIG_PATH (or any discovery bleed) could satisfy the inventory
 * check with the DEVELOPER's unstaged plugin — the row would grade the wrong
 * artifact. Both paths must be pre-resolved (realpath) by the caller.
 */
export function checkTransportSource(expectedRootDir, payload) {
  const rootDir = payload?.plugin?.rootDir;
  if (typeof rootDir !== 'string' || !rootDir) return 'inspect payload has no plugin.rootDir';
  if (path.resolve(rootDir) !== path.resolve(expectedRootDir)) {
    return `plugin loaded from "${rootDir}" — NOT the staged copy at "${expectedRootDir}" (config/discovery bleed; the row would grade the wrong artifact)`;
  }
  return true;
}

/**
 * Validate a fast-mode selection (pure; unit-tested). Codex lane finding
 * (2026-09-06): the generic empty-selection check let a renamed row shrink
 * the fast gate to 6/8 rows with exit 0 — every pinned id must resolve
 * exactly once BEFORE any child spawns, or the gate refuses to run.
 */
/**
 * Assert the child actually ran under the shape its row id claims (pure;
 * unit-tested). Falsifiability lens (2026-09-06): with applyEnvShape
 * neutered, @electronlike rows produced byte-identical PASS verdicts and the
 * report still asserted UtilityProcess coverage — the exact false-GREEN
 * class this harness exists to eliminate. The child echoes the OBSERVED
 * process.versions.electron + process.type in every verdict; an
 * @electronlike row whose echo does not show the fake FAILs.
 */
export function checkEnvShapeApplied(envShape, envObserved) {
  if (envShape !== 'electronlike') return true;
  if (!envObserved || typeof envObserved !== 'object') {
    return 'electronlike row returned no env echo — cannot prove the UtilityProcess fake applied (old child or plumbing break)';
  }
  if (envObserved.type !== 'utility' || !envObserved.electron) {
    return `electronlike fake NOT applied (observed electron=${envObserved.electron ?? 'null'}, type=${envObserved.type ?? 'null'}) — the row ran as plain node`;
  }
  return true;
}

/**
 * Sanitize a note for a markdown table cell (pure; unit-tested): pipes
 * escaped, newlines flattened, the user's home dir redacted to `~` (report
 * files are committed evidence; the pilot mirror is public — CLWX-18).
 */
export function sanitizeNoteCell(note, home = process.env.HOME) {
  let out = String(note ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
  if (home && home !== '/') out = out.split(home).join('~');
  return out;
}

export function validateFastSelection(expandedRows, fastIds) {
  const counts = new Map();
  for (const row of expandedRows) counts.set(row.id, (counts.get(row.id) ?? 0) + 1);
  const missing = fastIds.filter((id) => !counts.has(id));
  const duplicated = fastIds.filter((id) => (counts.get(id) ?? 0) > 1);
  if (!missing.length && !duplicated.length) return true;
  const parts = [];
  if (missing.length) parts.push(`missing from the expanded matrix: ${missing.join(', ')}`);
  if (duplicated.length) parts.push(`resolve more than once: ${duplicated.join(', ')}`);
  return `fast subset integrity failure — ${parts.join('; ')}`;
}

export async function canonicalizeStageDir(stageDir) {
  const resolved = path.resolve(stageDir);
  const missing = [];
  let cursor = resolved;

  while (true) {
    try {
      return path.join(await realpath(cursor), ...missing);
    } catch (err) {
      if (err?.code !== 'ENOENT') throw err;
      const parent = path.dirname(cursor);
      if (parent === cursor) {
        throw new Error(`unable to canonicalize stage dir ${resolved}: no existing ancestor`);
      }
      missing.unshift(path.basename(cursor));
      cursor = parent;
    }
  }
}

// Written into the stage and passed via NODE_OPTIONS=--require so the
// transport child gets the same deterministic network isolation as the
// register-mode children: every fetch attempt is rejected without a socket.
// The sentinel write makes the stub FALSIFIABLE: NODE_OPTIONS is silently
// ignored by some runtimes (packaged Electron), and a transport row must
// FAIL loudly — not run un-stubbed — when the preload never loaded
// (falsifiability + isolation lenses, 2026-09-06).
const TRANSPORT_PRELOAD_SOURCE = `'use strict';
if (process.env.CLAWX77_NET_STUB_SENTINEL) {
  try { require('node:fs').writeFileSync(process.env.CLAWX77_NET_STUB_SENTINEL, 'loaded'); } catch {}
}
globalThis.fetch = async () => {
  throw new Error('artifact-harness: network disabled in gateway-transport row');
};
`;

/**
 * The slice-1 matrix. `fixture` seeds a file in the row's work dir (string |
 * Buffer | async fn(workDir) => filePath); `args` may reference the seeded
 * path via the FIXTURE token.
 */
export const MATRIX = [
  {
    // kLedger K8: "SOMETIMES the agent reads the pdf documents well and other
    // times it gives an error" — repeat 3× in fresh children per shape; any
    // iteration disagreeing fails the row as intermittence.
    id: 'pdf-text.read_pdf', fn: 'readPdf', expectation: 'ok', kLedger: 'K8', repeat: 3,
    fixture: { name: 'circular.pdf', bytes: () => pdfWithText(PDF_MARKER) },
    check: (r) => (String(r.text ?? '').includes('ICT audit circular') ? true : `marker missing from extracted text (totalChars=${r.totalChars})`),
  },
  {
    id: 'pdf-scanned-notext.read_pdf', fn: 'readPdf', expectation: 'ok', kLedger: 'K10',
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
    id: 'pdf-password.read_pdf', fn: 'readPdf', expectation: 'refusal', kLedger: 'K10',
    fixture: { name: 'protected.pdf', bytes: () => pdfEncrypted() },
    refusalCheck: (m) => (/password-protected/.test(m) && !/No password given/.test(m)
      ? true : 'must name password protection, not the raw pdfjs message'),
  },
  {
    // >10MB pdf must parse fine and keep its text extraction (CLWX-77 large
    // row): guards against size caps or buffer-handling regressions in the
    // staged runtime that a 1KB fixture can never catch.
    id: 'pdf-large.read_pdf', fn: 'readPdf', expectation: 'ok', kLedger: 'K10',
    fixture: { name: 'yearbook.pdf', bytes: () => pdfWithText(PDF_MARKER, { padBytes: 10_500_000 }) },
    check: (r) => (r.bytes > 10_000_000 && String(r.text ?? '').includes('ICT audit circular')
      ? true : `expected >10MB parsed with marker (bytes=${r.bytes}, totalChars=${r.totalChars})`),
  },
  {
    id: 'docx.read_docx', fn: 'readDocx', expectation: 'ok', kLedger: 'K8', repeat: 3,
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
    id: 'docx-out.write_docx', fn: 'writeDocx', expectation: 'ok', kLedger: 'K8', repeat: 3,
    args: (workDir) => ({ path: path.join(workDir, 'out.docx'), title: 'Minutes', paragraphs: ['Meeting opened at 9am.'] }),
    check: (r) => (r.bytes > 0 && existsSync(r.path) ? true : 'no bytes written'),
  },
  {
    id: 'xlsx.read_xlsx', fn: 'readXlsx', expectation: 'ok', kLedger: 'K8', repeat: 3,
    fixture: { name: 'marks.xlsx', seed: 'xlsx', rows: [['student', 'marks'], ['A. Charran', 87]] },
    check: (r) => (JSON.stringify(r.rows ?? []).includes('Charran') ? true : 'seed row missing'),
  },
  {
    id: 'csv.read_xlsx', fn: 'readXlsx', expectation: 'ok',
    fixture: { name: 'roster.csv', bytes: () => 'student,marks\nB. Mohammed,91\n' },
    check: (r) => (JSON.stringify(r.rows ?? []).includes('Mohammed') ? true : 'csv row missing'),
  },
  {
    id: 'xlsx-out.write_xlsx', fn: 'writeXlsx', expectation: 'ok', kLedger: 'K8', repeat: 3,
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
    // the ENTIRE 32-tool inventory must register from the STAGED PLUGIN copy
    // (outlook 11 + forms 5 + browser 2 + principal 8 + document 6). Pins the
    // env/config gates and entry-file integrity. Honest coverage note: index
    // .mjs's static import graph today is builtins + local files (doc deps
    // load lazily at call time — the doc rows cover those), so this row
    // exercises staged-BUNDLE resolution only if a future eager npm import
    // appears — at which point a bundle gap fails it loudly.
    id: 'plugin-registration.full', mode: 'register', expectation: 'ok',
    register: { pluginConfig: FULL_PLUGIN_CONFIG, hostApi: FAKE_HOST_API },
    check: (r) => {
      const diff = inventoryDiff(
        [...DOC_TOOL_NAMES, ...PRINCIPAL_TOOL_NAMES, ...BROWSER_TOOL_NAMES, ...OUTLOOK_TOOL_NAMES, ...FORMS_TOOL_NAMES],
        r.names,
      );
      if (diff !== true) return diff;
      // The fetch stub must PROVABLY intercept — with host-API env present
      // the CLWX-86 probe fires, so zero recorded attempts means the stub
      // was not in the path and the isolation claim is unverified
      // (falsifiability lens, 2026-09-06: networkAttempts was collected but
      // never consumed).
      return (r.networkAttempts ?? 0) >= 1
        ? true : `expected the stubbed capability probe to record >=1 network attempt, got ${r.networkAttempts}`;
    },
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
  {
    // Gateway-process transport, no host-API env: the staged OpenClaw loader
    // loads the staged plugin through the REAL plugin-host; without the
    // host-API env exactly doc + principal register (the honest-degradation
    // contract, mirrored from plugin-registration.no-hostapi but through the
    // production loader instead of the harness mock).
    id: 'gateway-transport.no-hostapi', mode: 'transport', expectation: 'ok',
    transport: { pluginConfig: FULL_PLUGIN_CONFIG },
    check: (r) => checkTransportInspect(TRANSPORT_NO_HOSTAPI_EXPECTED, r),
  },
  {
    // Gateway-process transport, full activation: with host-API env present
    // (fake port/token; fetch stubbed via preload so the CLWX-86 probe fails
    // open without a socket) the ENTIRE 32-tool inventory must register
    // through the real gateway host.
    id: 'gateway-transport.full', mode: 'transport', expectation: 'ok',
    transport: { pluginConfig: FULL_PLUGIN_CONFIG, hostApi: FAKE_HOST_API },
    check: (r) => checkTransportInspect(TRANSPORT_FULL_EXPECTED, r),
  },
];

// ── matrix expansion: electron-env spawn parity + K8 repeat (CLWX-77 trail)

export const ENV_SHAPES = ['node', 'electronlike'];

/**
 * Expand the authored matrix into runnable rows (pure; unit-tested): every
 * doc/register row gains an `@electronlike` twin running under the faked
 * UtilityProcess env shape (the packaged gateway's real shape — CLWX-92).
 * NO-TOOL rows are not expanded (nothing runs). Transport rows are not
 * expanded either: faking the electron shape around the REAL gateway dist
 * without real electron modules would grade an untruthful combination — the
 * genuine utility-env gateway run is the Windows/VM lane (trail item).
 */
export function expandMatrix(matrix) {
  const rows = [];
  for (const row of matrix) {
    if (row.expectation === 'no-tool' || row.mode === 'transport') {
      rows.push({ ...row, envShape: 'node' });
      continue;
    }
    rows.push({ ...row, envShape: 'node' });
    rows.push({ ...row, id: `${row.id}@electronlike`, envShape: 'electronlike' });
  }
  return rows;
}

/**
 * Fold repeated-iteration verdicts into one row verdict (pure; unit-tested).
 * All iterations agreeing → that verdict, note marked consistent. ANY
 * disagreement → FAIL naming the per-iteration statuses — this is exactly
 * the K8 signal ("sometimes it works, sometimes it errors") and must never
 * average out to a pass.
 */
export function foldRepeatVerdicts(verdicts) {
  if (!Array.isArray(verdicts) || verdicts.length === 0) {
    return { status: 'FAIL', note: 'repeat fold received no iteration verdicts (harness bug)' };
  }
  if (verdicts.length === 1) return verdicts[0];
  const statuses = verdicts.map((v) => v.status);
  if (new Set(statuses).size > 1) {
    // Note fallback chain: a FAIL iteration's note, else the first non-empty
    // note, else a plain statement — never a dangling dash (lens finding,
    // 2026-09-06: mixed PASS/REFUSED iterations produced "… — " with nothing
    // after it).
    const detail = verdicts.find((v) => v.status === 'FAIL')?.note
      || verdicts.map((v) => v.note).find(Boolean)
      || 'iteration statuses disagree';
    return {
      status: 'FAIL',
      note: `INTERMITTENT across ${verdicts.length} iterations (K8 class): ${statuses.join(', ')} — ${detail}`,
    };
  }
  return { ...verdicts[0], note: `${verdicts[0].note ? `${verdicts[0].note} ` : ''}(${verdicts.length}× consistent)`.trim() };
}

// ── fast subset (package preflight wiring, CLWX-77 trail)
//
// One row per regression family, kept fast enough for every package build:
// the CLWX-92 electron-env pdf class, docx/xlsx read+write, the sharp native
// binding (moe.15 canvas class, image edition), the full registration
// inventory, and the real-gateway transport load. Expanded-row ids; the
// drift guard in tests/unit/harness-artifact.test.ts pins subset ⊆ matrix
// and family coverage. Repeats are skipped in fast mode (K8 depth belongs to
// the full run).
export const FAST_ROW_IDS = [
  'pdf-text.read_pdf',
  'pdf-text.read_pdf@electronlike',
  'docx.read_docx',
  'docx-out.write_docx',
  'xlsx.read_xlsx',
  'png-sharp-binding.read_image',
  'plugin-registration.full',
  'gateway-transport.no-hostapi',
];

// ── staging

async function stageArtifact(stageDir, { reuseBundle = false } = {}) {
  const resources = path.join(stageDir, 'resources');
  const pluginDest = path.join(resources, 'extensions', 'moe-principal-assistant');
  // The FULL gateway dir (openclaw.mjs + dist + node_modules), mirroring the
  // shipped resources/openclaw layout: the node_modules seam the doc rows
  // resolve through is unchanged, and the transport rows get the real
  // gateway entry to boot.
  const gatewayDest = path.join(resources, 'openclaw');
  await mkdir(path.dirname(pluginDest), { recursive: true });
  await rm(pluginDest, { recursive: true, force: true });
  await cp(PLUGIN_SRC, pluginDest, { recursive: true });
  if (reuseBundle && existsSync(path.join(gatewayDest, 'node_modules'))) {
    // Explicit opt-in only (negative-control probes mutate the stage). A
    // silently reused stage after a bundle rebuild would test a STALE bundle
    // and report GREEN for a broken artifact (review finding, 2026-09-05).
    console.warn('WARNING: --reuse-bundle set — testing the EXISTING staged gateway, which may be stale vs build/openclaw.');
  } else {
    await rm(gatewayDest, { recursive: true, force: true });
    await mkdir(path.dirname(gatewayDest), { recursive: true });
    // APFS clonefile makes the 500MB copy near-instant on darwin; a symlink
    // would be WRONG here — Node resolves modules at their realpath, so
    // transitive requires would walk up into the repo node_modules and mask
    // exactly the gap class this harness exists to catch.
    if (process.platform === 'darwin') {
      // clonefile requires a clone-capable same-volume target; a non-APFS or
      // cross-volume --stage-dir must fall back to a byte copy instead of
      // aborting every mac package build (lens finding, 2026-09-06).
      const cloned = await new Promise((resolve) => {
        const child = spawn('cp', ['-Rc', OPENCLAW_DIR, gatewayDest], { stdio: 'inherit' });
        child.on('exit', (code) => resolve(code === 0));
        child.on('error', () => resolve(false));
      });
      if (!cloned) {
        console.warn('WARNING: cp -Rc (clonefile) failed — falling back to a byte copy (non-APFS or cross-volume stage dir; this is slow).');
        await rm(gatewayDest, { recursive: true, force: true });
        await cp(OPENCLAW_DIR, gatewayDest, { recursive: true });
      }
    } else {
      await cp(OPENCLAW_DIR, gatewayDest, { recursive: true });
    }
  }
  const preloadPath = path.join(stageDir, 'transport-net-stub.cjs');
  await writeFile(preloadPath, TRANSPORT_PRELOAD_SOURCE);
  return { resources, pluginDest, gatewayDest, preloadPath };
}

/**
 * Run a gateway-transport row: seed a hermetic OPENCLAW_STATE_DIR whose
 * config points plugins.load.paths at the STAGED plugin, then spawn a small
 * child that imports the STAGED OpenClaw plugin loader and scopes it to the
 * MoE plugin. This keeps the real plugin-host boundary without accidentally
 * running `plugins inspect`, whose diagnostics path loads every discovered
 * OpenClaw plugin before filtering to the requested id on Windows.
 */
async function runTransport(row, { pluginDest, gatewayDest, preloadPath }, stageDir, { nodeBin } = {}) {
  const stateDir = path.join(stageDir, 'state', row.id.replace(/[^a-z0-9_.-]/gi, '_'));
  await rm(stateDir, { recursive: true, force: true });
  await mkdir(stateDir, { recursive: true });
  // realpath both sides of the source assertion up front: mkdtemp stages on
  // macOS live under symlinked roots (/tmp → /private/tmp) and the gateway
  // reports resolved paths.
  const realPluginDest = await realpath(pluginDest);
  await writeFile(path.join(stateDir, 'openclaw.json'), JSON.stringify({
    plugins: {
      load: { paths: [pluginDest] },
      entries: { [TRANSPORT_PLUGIN_ID]: { enabled: true, config: row.transport.pluginConfig } },
    },
  }, null, 2));
  // ALLOWLISTED env — never spread process.env here. The bundled gateway
  // honors config/discovery overrides (OPENCLAW_CONFIG_PATH beats
  // OPENCLAW_STATE_DIR) and provider/key vars; an inherited developer env
  // could redirect the row at the dev machine's real config and plugins —
  // Codex lane probe confirmed the override precedence (2026-09-06).
  // OPENCLAW_NO_RESPAWN mirrors the production launcher AND keeps the
  // timeout SIGKILL effective — without it the CLI wrapper respawns itself
  // and the kill only reaps the wrapper (Codex lane finding, 2026-09-06).
  //
  // HOME is a STAGE-LOCAL fake home, not the real one: the gateway resolves
  // its workspace from HOME (~/.openclaw/workspace), ignoring
  // OPENCLAW_STATE_DIR — with the real HOME, every release build hands the
  // developer's live ~/.openclaw/workspace into the plugin-load context
  // (isolation lens probe, 2026-09-06; fix verified same row verdicts with
  // workspaceDir inside the stage).
  const fakeHome = path.join(stateDir, 'home');
  await mkdir(fakeHome, { recursive: true });
  const netStubSentinel = path.join(stateDir, 'net-stub-loaded');
  const env = {
    PATH: process.env.PATH,
    HOME: fakeHome,
    TMPDIR: process.env.TMPDIR,
    LANG: process.env.LANG,
    OPENCLAW_STATE_DIR: stateDir,
    CLAWX_APP_RESOURCES: path.dirname(gatewayDest),
    OPENCLAW_DISABLE_BONJOUR: '1',
    OPENCLAW_NO_RESPAWN: '1',
    NODE_OPTIONS: `--require ${JSON.stringify(preloadPath)}`,
    CLAWX77_NET_STUB_SENTINEL: netStubSentinel,
    NODE_PATH: '',
  };
  if (process.platform === 'win32') {
    // Node on Windows needs the system roots (winsock/DNS/crypto) and spawn
    // plumbing; the profile dirs point at the fake home so isolation holds
    // (correctness lens, 2026-09-06 — unverified-on-Windows finding closed
    // by construction; the Windows-lane run re-proves it live).
    for (const key of ['SystemRoot', 'SystemDrive', 'windir', 'PATHEXT', 'ComSpec', 'TEMP', 'TMP']) {
      if (process.env[key] !== undefined) env[key] = process.env[key];
    }
    env.USERPROFILE = fakeHome;
    env.APPDATA = path.join(fakeHome, 'AppData', 'Roaming');
    env.LOCALAPPDATA = path.join(fakeHome, 'AppData', 'Local');
  }
  if (row.transport.hostApi) {
    env.CLAWX_HOST_API_PORT = String(row.transport.hostApi.port);
    env.CLAWX_HOST_API_TOKEN = String(row.transport.hostApi.token);
  }
  return new Promise((resolve) => {
    const child = spawn(
      nodeBin ?? process.execPath,
      [TRANSPORT_CHILD_SCRIPT, JSON.stringify({
        gatewayDir: gatewayDest,
        pluginId: TRANSPORT_PLUGIN_ID,
        workspaceDir: path.join(fakeHome, '.openclaw', 'workspace'),
      })],
      { cwd: path.dirname(TRANSPORT_CHILD_SCRIPT), env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    let exitCode = null;
    let exitSignal = null;
    let settled = false;
    const settle = (outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      settle({ ok: false, infra: true, message: `transport row timed out after ${TRANSPORT_TIMEOUT_MS}ms` });
    }, TRANSPORT_TIMEOUT_MS);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('exit', (code, signal) => {
      exitCode = code;
      exitSignal = signal;
    });
    child.on('close', (code, signal) => {
      exitCode = exitCode ?? code;
      exitSignal = exitSignal ?? signal;
      // The net-stub preload must PROVABLY have loaded — NODE_OPTIONS is
      // silently ignored by some runtimes (packaged Electron via
      // --node-bin), and an un-stubbed run only "passes" because the fake
      // port happens to be closed on this machine. Parse on `close`, not
      // `exit`, because `close` is the event that guarantees stdout/stderr
      // streams have drained.
      if (!existsSync(netStubSentinel)) {
        settle({ ok: false, infra: true, message: 'net-stub preload never loaded (NODE_OPTIONS ignored by this runtime?) — refusing to grade an un-stubbed gateway run' });
        return;
      }
      const line = stdout.split('\n').filter((l) => l.startsWith('CLAWX77_TRANSPORT_VERDICT:')).pop();
      let outcome = null;
      try {
        outcome = JSON.parse(line.slice('CLAWX77_TRANSPORT_VERDICT:'.length));
      } catch { /* no framed transport verdict — report below */ }
      const folded = foldChildExit(exitCode, exitSignal, outcome, stderr.slice(0, 300));
      if (!folded.ok) {
        settle(folded);
        return;
      }
      const payload = folded.result;
      // Stage-integrity gate BEFORE the inventory check: the plugin the
      // gateway reports must be the STAGED copy, not something an inherited
      // config/discovery path found elsewhere (Codex lane, 2026-09-06).
      const sourceVerdict = checkTransportSource(realPluginDest, payload);
      if (sourceVerdict !== true) {
        settle({ ok: false, infra: true, message: sourceVerdict });
        return;
      }
      settle({ ok: true, result: payload });
    });
    child.on('error', (err) => {
      settle({ ok: false, infra: true, message: `transport child spawn failed: ${err.message}` });
    });
  });
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

function runChild(spec, resources, { nodeBin } = {}) {
  return new Promise((resolve) => {
    const child = spawn(nodeBin ?? process.execPath, [CHILD_SCRIPT, JSON.stringify(spec)], {
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

/**
 * Grade one child outcome for a row: the env-shape assertion runs FIRST
 * (an @electronlike row whose echo does not show the fake FAILs before any
 * expectation logic — checkEnvShapeApplied), then classifyRow. Infra
 * outcomes skip the shape gate (the tool never ran; classifyRow already
 * FAILs them). A node-shape row observing electron markers means the parity
 * matrix is degenerate (e.g. --node-bin pointing at an Electron binary) —
 * loud warning, not a row failure.
 */
function gradeOutcome(row, outcome) {
  if (!outcome.infra) {
    const shapeVerdict = checkEnvShapeApplied(row.envShape, outcome.env);
    if (shapeVerdict !== true) return { status: 'FAIL', note: shapeVerdict };
    if (row.envShape === 'node' && outcome.env?.electron) {
      console.warn(`WARNING: node-shape row ${row.id} observed electron=${outcome.env.electron} — both shapes are electron; the parity matrix is degenerate under this runtime.`);
    }
  }
  return classifyRow(row.expectation, outcome, row.check, row.refusalCheck);
}

function parseArgs(argv) {
  const args = { only: null, report: null, stageDir: null, keepStage: false, reuseBundle: false, fast: false, nodeBin: null };
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
    else if (a === '--fast') args.fast = true;
    else if (a === '--node-bin') args.nodeBin = argv[++i];
    else if (a.startsWith('--node-bin=')) args.nodeBin = a.slice(11);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const rawStageDir = args.stageDir
    ? path.resolve(args.stageDir)
    : await mkdtemp(path.join(os.tmpdir(), 'clawx-artifact-'));
  const stageDir = await canonicalizeStageDir(rawStageDir);
  const bundleNodeModules = args.reuseBundle
    ? path.join(stageDir, 'resources', 'openclaw', 'node_modules')
    : BUNDLE_NM;
  if (!existsSync(bundleNodeModules)) {
    const hint = args.reuseBundle
      ? `prepare ${path.join(stageDir, 'resources', 'openclaw')} before using --reuse-bundle`
      : 'run: pnpm exec zx scripts/bundle-openclaw.mjs';
    console.error(`FAIL: gateway bundle not found at ${bundleNodeModules} — ${hint}`);
    process.exit(1);
  }
  // Equality matters as much as containment: `--stage-dir .` from the repo
  // root passed the old prefix check and would rm -rf tracked resources/
  // paths before staging 1.4GB INSIDE the repo (lens finding, 2026-09-06).
  const repoRootForGuard = await realpath(REPO_ROOT);
  if (path.resolve(stageDir) === repoRootForGuard || stageDir.startsWith(repoRootForGuard + path.sep)) {
    console.error('FAIL: --stage-dir must be OUTSIDE the repo tree (walk-up resolution would mask bundle gaps).');
    process.exit(1);
  }
  console.log(`Staging artifact runtime in ${stageDir} …`);
  const t0 = Date.now();
  const staged = await stageArtifact(stageDir, { reuseBundle: args.reuseBundle });
  const { resources, pluginDest } = staged;
  const docToolsPath = path.join(pluginDest, 'doc-tools.mjs');

  const expanded = expandMatrix(MATRIX);
  if (args.fast) {
    // Every pinned fast row must resolve exactly once BEFORE anything runs —
    // a renamed row must refuse the gate, never shrink it (Codex lane
    // finding, 2026-09-06: 6/8 rows exited 0 under a rename).
    const fastVerdict = validateFastSelection(expanded, FAST_ROW_IDS);
    if (fastVerdict !== true) {
      console.error(`FAIL: ${fastVerdict}`);
      process.exit(1);
    }
  }
  const rows = expanded.filter((r) => {
    if (args.only) return r.id === args.only;
    if (args.fast) return FAST_ROW_IDS.includes(r.id);
    return true;
  });
  if (!rows.length) {
    console.error(`FAIL: --only ${args.only} matches no row. Rows: ${expanded.map((r) => r.id).join(', ')}`);
    process.exit(1);
  }
  console.log(`Staged in ${((Date.now() - t0) / 1000).toFixed(1)}s. Running ${rows.length}${args.fast ? ' (fast subset)' : ''} of ${expanded.length} rows …\n`);

  const results = [];
  for (const row of rows) {
    const started = Date.now();
    // Fast mode runs each row once (speed); the full run honors the K8
    // repeat tag — 3 FRESH children per shape, disagreement = intermittence.
    const iterations = args.fast ? 1 : (row.repeat ?? 1);
    let verdict;
    if (row.expectation === 'no-tool') {
      verdict = classifyRow('no-tool', { ok: false, message: '' });
    } else if (row.mode === 'transport') {
      const outcome = await runTransport(row, staged, stageDir, { nodeBin: args.nodeBin });
      verdict = classifyRow(row.expectation, outcome, row.check, row.refusalCheck);
    } else if (row.mode === 'register') {
      const iterVerdicts = [];
      for (let i = 0; i < iterations; i += 1) {
        // Harness-owned keys AFTER the row spread — a future register.envShape
        // key must never silently clobber the dispatched shape (lens finding,
        // 2026-09-06).
        const outcome = await runChild(
          { ...row.register, mode: 'register', pluginIndexPath: path.join(pluginDest, 'index.mjs'), envShape: row.envShape },
          resources,
          { nodeBin: args.nodeBin },
        );
        iterVerdicts.push(gradeOutcome(row, outcome));
      }
      verdict = foldRepeatVerdicts(iterVerdicts);
    } else {
      const iterVerdicts = [];
      for (let i = 0; i < iterations; i += 1) {
        // Per-iteration work dirs keep write rows independent — a leftover
        // output file must never make iteration 2 vacuously green.
        const dirName = `${row.id.replace(/[^a-z0-9_.-]/gi, '_')}${iterations > 1 ? `-i${i + 1}` : ''}`;
        const workDir = path.join(stageDir, 'work', dirName);
        await mkdir(workDir, { recursive: true });
        const fixturePath = await seedRowFixture(row, workDir);
        const callArgs = row.args ? row.args(workDir) : { path: fixturePath };
        const outcome = await runChild(
          { docToolsPath, fn: row.fn, args: callArgs, envShape: row.envShape },
          resources,
          { nodeBin: args.nodeBin },
        );
        iterVerdicts.push(gradeOutcome(row, outcome));
      }
      verdict = foldRepeatVerdicts(iterVerdicts);
    }
    const ms = Date.now() - started;
    results.push({ id: row.id, kLedger: row.kLedger ?? '', ...verdict, ms });
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
      `Staged plugin + FULL gateway (build/openclaw) outside the repo tree; each row`,
      `ran in a child process resolving deps ONLY from the staged copy`,
      `(CLAWX_APP_RESOURCES seam). Registration rows call the staged plugin's`,
      `register() with a mock gateway API; gateway-transport rows import the STAGED`,
      `OpenClaw plugin loader with onlyPluginIds=['moe-principal-assistant'] and a`,
      `hermetic OPENCLAW_STATE_DIR — the plugin loads through the real gateway`,
      `plugin-host while unrelated bundled plugins are excluded. fetch is stubbed before the`,
      `plugin loads in both modes — the full registration row asserts the stub`,
      `recorded the CLWX-86 probe attempt, and transport rows FAIL unless the`,
      `preload's load-sentinel exists — so the probe is deterministically`,
      `unreachable (fail-open) with no socket opened on the plain-node lanes`,
      `graded here (an Electron --node-bin lane ignores NODE_OPTIONS and would`,
      `FAIL the sentinel check rather than run un-stubbed).`,
      '',
      `Env shapes: \`@electronlike\` rows ran under the faked Electron UtilityProcess`,
      `shape (process.versions.electron + process.type='utility') — the packaged`,
      `gateway's real env (utilityProcess.fork) and the CLWX-92/moe.16 failure shape.`,
      `Transport rows run plain-node only by design (a faked electron shape around`,
      `the real gateway dist would grade an untruthful combination); the true`,
      `utility-env gateway run is the Windows/VM lane.`,
      '',
      `K-ledger mapping: K8 rows repeat 3× per shape in fresh children (disagreement`,
      `= FAIL, intermittence named); K10 tags mark the pdf variants. K1/K2/K11/K12/`,
      `K13 live in the Outlook/VM lanes, K4 in the ASR lane (CLWX-87), K9/K14 are`,
      `in-app fixtures — this harness does not grade those.`,
      '',
      '| Row | Status | K | Note | ms |',
      '|---|---|---|---|---|',
      // Note cells: newlines break the markdown table on exactly the failing
      // runs where the report matters most (multi-line child stderr), and
      // home paths in infra notes are needless PII in a committed artifact.
      ...results.map((r) => `| ${r.id} | ${r.status} | ${r.kLedger} | ${sanitizeNoteCell(r.note)} | ${r.ms} |`),
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

/**
 * Direct-invocation check must compare REALPATHS: Node realpath-resolves the
 * entry module's import.meta.url, so a symlinked invocation path (symlinked
 * checkout, /tmp → /private/tmp, Windows junction) made the old
 * `path.resolve(argv[1])` comparison miss and main() silently never ran —
 * exit 0, no output, while `--fast` sat inside the package chain as a
 * release gate (isolation lens, 2026-09-06).
 */
function isDirectInvocation() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(path.resolve(process.argv[1]))).href;
  } catch {
    return false;
  }
}

if (isDirectInvocation()) {
  main().catch((err) => {
    console.error(`harness:artifact crashed: ${err instanceof Error ? err.stack : String(err)}`);
    process.exit(1);
  });
}
