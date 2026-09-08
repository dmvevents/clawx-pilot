import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertOpenClawWindowsPtyGuard } from './openclaw-windows-pty-guard-patch.mjs';

export const TARGET_OPENCLAW_VERSION = '2026.9.2';
export const REQUIRED_OPENCLAW_NODE_ENGINE = '>=22.22.3 <23 || >=24.15.0 <25 || >=25.9.0';

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPTS_DIR, '..');
const MOE_REGISTRY_CHILD_SCRIPT = path.join(SCRIPTS_DIR, 'openclaw-2026-9-moe-registry-child.mjs');
// Exported for the child helper (openclaw-2026-9-moe-registry-child.mjs) so
// the runtime inventory checks stay pinned to this single reviewed copy.
export const MOE_NO_HOSTAPI_TOOLS = [
  'document.find',
  'document.read_pdf',
  'document.read_docx',
  'document.write_docx',
  'document.read_xlsx',
  'document.write_xlsx',
  'document.read_image',
  'principal.draft_letter',
  'principal.draft_memo',
  'principal.summarise_circular',
  'principal.daily_report_payload',
  'principal.daily_report_form_payload',
  'principal.suspension_payload',
  'principal.find_school',
  'principal.nscc_lookup',
];
// Exported so the unit lane can pin this copy of the inventory against the
// harness-artifact contract (TRANSPORT_FULL_EXPECTED) — this list drifted
// silently when outlook.readiness landed (6ec32807) and again when
// browser.open_chrome landed (41359e12); both register inside the same
// host-API + skillAllowlist gate as the rest of their families.
export const MOE_HOSTAPI_TOOLS = [
  ...MOE_NO_HOSTAPI_TOOLS,
  'browser.open_chrome',
  'browser.diagnose',
  'browser.repair_chrome_cdp',
  'outlook.readiness',
  'outlook.open',
  'outlook.read_inbox',
  'outlook.draft_email',
  'outlook.send_email',
  'outlook.search_inbox',
  'outlook.read_email',
  'outlook.reply',
  'outlook.forward',
  'outlook.mark_read',
  'outlook.list_attachments',
  'outlook.download_attachment',
  'forms.list',
  'forms.preview_suspension',
  'forms.preview_daily_report',
  'forms.submit_suspension',
  'forms.submit_daily_report',
];

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function listDistJs(openclawDir) {
  const distDir = path.join(openclawDir, 'dist');
  return fs.readdirSync(distDir)
    .filter((name) => name.endsWith('.js'))
    .map((name) => path.join(distDir, name));
}

function findDistFile(openclawDir, predicate, label) {
  const matches = listDistJs(openclawDir).filter((file) => predicate(readText(file), path.basename(file)));
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one ${label} bundle file under ${openclawDir}, found ${matches.length}`);
  }
  return matches[0];
}

function assertOpenClawVersion(openclawDir) {
  const pkg = JSON.parse(readText(path.join(openclawDir, 'package.json')));
  if (pkg.version !== TARGET_OPENCLAW_VERSION) {
    throw new Error(`OpenClaw upgrade verifier targets ${TARGET_OPENCLAW_VERSION}, found ${pkg.version}`);
  }
  return pkg;
}

export function satisfiesOpenClawNodeEngine(version) {
  const [maj = 0, min = 0, patch = 0] = String(version).split('.').map((part) => Number(part));
  if (![maj, min, patch].every(Number.isFinite)) return false;
  return (maj === 22 && (min > 22 || (min === 22 && patch >= 3)))
    || (maj === 24 && min >= 15)
    || (maj === 25 && min >= 9)
    || maj > 25;
}

function assertNodeEngine(pkg) {
  const engine = String(pkg.engines?.node ?? '');
  if (engine !== REQUIRED_OPENCLAW_NODE_ENGINE) {
    throw new Error(`Unexpected OpenClaw node engine range: ${engine || '(missing)'}`);
  }
  if (!satisfiesOpenClawNodeEngine('24.15.0')) {
    throw new Error('Bundled Node target 24.15.0 does not satisfy OpenClaw node engine range');
  }
}

function assertChatHistoryUsesNonBlockingStartupProjection(openclawDir) {
  const chatFile = findDistFile(openclawDir, (source) => source.includes('const chatHistoryHandlers = {') && source.includes('handleChatHistoryRequest'), 'chat.history');
  const source = readText(chatFile);
  if (source.includes('catalog: await context.loadGatewayModelCatalog()')) {
    throw new Error(`chat.history still contains the old blocking catalog await in ${path.basename(chatFile)}`);
  }
  if (!source.includes('readPolicy: method === "chat.history" ? "ready" : "current"')
    || !source.includes('const startupProjectionPromise')
    || !source.includes('resolveConfiguredThinkingDefault')) {
    throw new Error(`chat.history missing upstream ready startup projection/configured-thinking flow in ${path.basename(chatFile)}`);
  }
  return chatFile;
}

function assertSdkAliasUsesUpstreamAliasMap(openclawDir) {
  const source = listDistJs(openclawDir).map(readText).join('\n');
  if (source.includes('function ensureOpenClawPluginSdkAlias') || source.includes('function writeRuntimeModuleWrapper')) {
    throw new Error('OpenClaw SDK alias still uses removed runtime wrapper materialization helpers');
  }
  if (!source.includes('function resolvePluginSdkScopedAliasMap') || !source.includes('cachedPluginSdkScopedAliasMaps')) {
    throw new Error('OpenClaw SDK alias map cache implementation not found');
  }
}

function assertPricingUsesNativeCatalogPricing(openclawDir) {
  const source = listDistJs(openclawDir).map(readText).join('\n');
  if (source.includes('function refreshGatewayModelPricingCache') || source.includes('function canonicalizeOpenRouterProvider')) {
    throw new Error('OpenClaw pricing still exposes the old refresh/cache implementation targeted by CLWX-106');
  }
  if (!source.includes('function normalizeOpenRouterModelPricing') || !source.includes('MODEL_PRICING_SOURCES')) {
    throw new Error('OpenClaw native model catalog pricing implementation not found');
  }
}

// Owned-temp cleanup for the mkdtemp scratch root this verifier creates.
//
// hosted34244582967 (clean 1d745567) first surfaced the EPERM; the bounded
// recursive-rm retries added in 8fb8bd96 did NOT absorb it — hosted34252050616
// (5785e570) still failed with `EPERM ... \Temp\clwx-openclaw-moe-plugin-7UYvaV`
// after maxRetries 10 / retryDelay 100. Native auto-d controls (Node 24.20.0,
// locked OpenClaw 2026.9.2) resolved the ambiguity:
// - the only content left behind is state-*/state/openclaw.sqlite (+ -shm/-wal);
// - a short TEMP root (C:\ct) does NOT remove the EPERM (not a path/ACL issue);
// - a fresh same-user process AFTER the test process exits deletes the same
//   tree cleanly (not a permanent permission fault).
// Cause: loading the MoE registry through build-smoke-entry opens the OpenClaw
// state database and the handle is retained process-wide in the loader's
// module-level cache (cachedDatabases in the hashed openclaw-state-db-cache
// chunk); no stable dist/plugin-sdk or dist/plugins surface exports the close
// API. The registry/PDF checks therefore run in a bounded owned child process
// (openclaw-2026-9-moe-registry-child.mjs) and this cleanup runs only after
// the child — and its DB handle — has exited.
//
// Policy:
// 1. Retry with Node's documented recursive-rm backoff (maxRetries/retryDelay
//    apply to exactly EBUSY/EMFILE/ENFILE/ENOTEMPTY/EPERM when recursive),
//    which absorbs a briefly-held handle without hiding anything.
// 2. If the error survives the bounded retries, SURFACE it as a failure —
//    exhaustion is never converted into success, because a residual EPERM
//    may be a real permission fault. The preserved scratch dir path rides on
//    the thrown error for diagnostics.
// 3. When the verification body ALSO failed, throw both causes together so
//    the cleanup failure cannot mask the primary verification error (the old
//    bare `finally { fs.rmSync(...) }` replaced e.g. an inventory mismatch
//    with the EPERM).
// 4. All thrown values are normalized to Errors at this boundary: JavaScript
//    permits `throw false` / `throw 0` / `throw ''`, and the previous
//    truthiness checks would have silently dropped such a primary or cleanup
//    failure into a pass.
export const OWNED_TEMP_RM_OPTIONS = Object.freeze({
  recursive: true,
  force: true,
  maxRetries: 10,
  retryDelay: 100,
});

// Normalizes any thrown value into an Error so falsy throws (false, 0, '',
// null, undefined) cannot be dropped by truthiness checks at the
// verification/cleanup boundary. Errors pass through unchanged (identity is
// preserved for rethrow contracts); everything else is wrapped with the
// original value retained on `cause`.
export function normalizeThrown(value) {
  if (value instanceof Error) return value;
  let rendered;
  try {
    rendered = JSON.stringify(value);
  } catch {
    rendered = undefined;
  }
  const error = new Error(`non-Error thrown (${typeof value}): ${rendered ?? String(value)}`);
  error.cause = value;
  return error;
}

// Exported (with an injectable rm for deterministic controls in the unit
// lane) — production callers pass tempRoot and the primary error, if any.
// A nullish primaryError means "verification body did not throw"; any other
// value — including falsy non-nullish values — is normalized and surfaced.
export function finalizeOwnedVerifierTempRoot(tempRoot, primaryError = null, rmImpl = fs.rmSync) {
  primaryError = primaryError === null || primaryError === undefined ? null : normalizeThrown(primaryError);
  let cleanupError = null;
  try {
    rmImpl(tempRoot, { ...OWNED_TEMP_RM_OPTIONS });
  } catch (error) {
    cleanupError = normalizeThrown(error);
  }
  if (primaryError && cleanupError) {
    throw new AggregateError(
      [primaryError, cleanupError],
      `${primaryError.message}; owned temp cleanup also failed after bounded retries `
      + `(scratch dir preserved: ${tempRoot}): ${cleanupError.message}`,
    );
  }
  if (primaryError) throw primaryError;
  if (cleanupError) {
    cleanupError.message = `owned temp cleanup failed after bounded retries `
      + `(scratch dir preserved: ${tempRoot}): ${cleanupError.message}`;
    throw cleanupError;
  }
}

// Exported for the unit lane's missing/extra rejection controls only.
export function assertSameSet(label, actual, expected) {
  const actualSorted = [...actual].sort();
  const expectedSorted = [...expected].sort();
  const missing = expectedSorted.filter((name) => !actualSorted.includes(name));
  const extra = actualSorted.filter((name) => !expectedSorted.includes(name));
  if (missing.length || extra.length) {
    throw new Error(`${label} mismatch; missing=[${missing.join(', ')}] extra=[${extra.join(', ')}]`);
  }
}

// Child-process boundary for the MoE registry/PDF disposition. The loads run
// in scripts/openclaw-2026-9-moe-registry-child.mjs (see the block comment on
// OWNED_TEMP_RM_OPTIONS for the DB-handle-lifetime evidence): success requires
// BOTH exit code 0 AND the per-invocation nonce proof marker on stdout, so a
// child that dies silently, times out, is killed, or prints stale output can
// never pass. One spawn only — a failed child is a failure, never replayed.
export const MOE_REGISTRY_PROOF_PREFIX = 'CLWX_MOE_REGISTRY_PROOF';
export const MOE_REGISTRY_CHILD_TIMEOUT_MS = 90_000;
export const MOE_REGISTRY_CHILD_MAX_BUFFER_BYTES = 8 * 1024 * 1024;

function boundedTail(text, limit = 2000) {
  const value = String(text ?? '').trim();
  return value.length > limit ? `…${value.slice(-limit)}` : value;
}

// Exported for the unit lane's refusal controls (spawn-result shaped input).
export function assertMoeRegistryChildResult(result, nonce) {
  if (result.error) {
    throw new Error(`MoE registry child did not complete (timeout/spawn failure): ${normalizeThrown(result.error).message}`);
  }
  if (result.signal) {
    throw new Error(`MoE registry child was killed by signal ${result.signal} (bounded lifetime ${MOE_REGISTRY_CHILD_TIMEOUT_MS}ms)`);
  }
  if (result.status !== 0) {
    throw new Error(`MoE registry child exited ${result.status}: ${boundedTail(result.stderr) || '(no stderr)'}`);
  }
  const marker = `${MOE_REGISTRY_PROOF_PREFIX} ${nonce}`;
  const hasMarker = String(result.stdout ?? '').split(/\r?\n/).some((line) => line.trim() === marker);
  if (!hasMarker) {
    throw new Error(`MoE registry child exited 0 without the proof marker "${marker}" — refusing to treat it as verified`);
  }
}

async function assertMoePluginToolRegistration(openclawDir) {
  const pluginRoot = path.join(ROOT, 'extensions', 'moe-principal-assistant');
  if (!fs.existsSync(path.join(pluginRoot, 'openclaw.plugin.json'))) {
    throw new Error(`MoE plugin manifest missing: ${pluginRoot}`);
  }
  const manifest = JSON.parse(readText(path.join(pluginRoot, 'openclaw.plugin.json')));
  assertSameSet('MoE manifest contracts.tools', manifest.contracts?.tools ?? [], MOE_HOSTAPI_TOOLS);

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'clwx-openclaw-moe-plugin-'));
  let primaryError = null;
  try {
    const nonce = randomUUID();
    const result = spawnSync(process.execPath, [
      MOE_REGISTRY_CHILD_SCRIPT,
      JSON.stringify({ openclawDir, pluginRoot, tempRoot, nonce }),
    ], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: MOE_REGISTRY_CHILD_TIMEOUT_MS,
      maxBuffer: MOE_REGISTRY_CHILD_MAX_BUFFER_BYTES,
    });
    assertMoeRegistryChildResult(result, nonce);
  } catch (thrown) {
    primaryError = normalizeThrown(thrown);
  }
  // The child (and the OpenClaw state-DB handle its loader cached) has exited
  // before the owned scratch root is removed.
  finalizeOwnedVerifierTempRoot(tempRoot, primaryError);
}

async function assertRuntimeImports(openclawDir) {
  const imports = [
    ['model catalog pricing', 'dist/plugin-sdk/model-catalog-pricing.js', ['normalizeOpenRouterModelPricing', 'normalizeModelPricingCatalog']],
    ['agent runtime thinking', 'dist/plugin-sdk/agent-runtime.js', ['resolveThinkingDefault', 'resolveThinkingDefaultWithRuntimeCatalog']],
    ['document extractor sdk', 'dist/plugin-sdk/document-extractor.js', []],
    ['gateway method runtime', 'dist/plugin-sdk/gateway-method-runtime.js', ['dispatchGatewayMethod']],
    ['transport ready runtime', 'dist/plugin-sdk/transport-ready-runtime.js', ['waitForTransportReady']],
    ['plugin loader', 'dist/plugins/loader.js', ['loadOpenClawPlugins', 'resolveRuntimePluginRegistry']],
  ];
  for (const [label, rel, names] of imports) {
    const file = path.join(openclawDir, rel);
    if (!fs.existsSync(file)) throw new Error(`${label} import target missing: ${rel}`);
    const mod = await import(`${pathToFileURL(file).href}?verify=${Date.now()}-${Math.random()}`);
    for (const name of names) {
      if (typeof mod[name] !== 'function') throw new Error(`${label} missing export ${name}`);
    }
  }
}

export async function verifyOpenClaw20269Upgrade(openclawDir = path.join(process.cwd(), 'build', 'openclaw'), options = {}) {
  const pkg = assertOpenClawVersion(openclawDir);
  assertNodeEngine(pkg);
  assertChatHistoryUsesNonBlockingStartupProjection(openclawDir);
  assertSdkAliasUsesUpstreamAliasMap(openclawDir);
  assertPricingUsesNativeCatalogPricing(openclawDir);
  if (options.requireBundlePtyGuard === true) {
    assertOpenClawWindowsPtyGuard(openclawDir);
  }
  await assertRuntimeImports(openclawDir);
  await assertMoePluginToolRegistration(openclawDir);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    const openclawDir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(process.cwd(), 'build', 'openclaw');
    await verifyOpenClaw20269Upgrade(openclawDir);
    console.log(`✓ OpenClaw ${TARGET_OPENCLAW_VERSION} upgrade disposition verified`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
