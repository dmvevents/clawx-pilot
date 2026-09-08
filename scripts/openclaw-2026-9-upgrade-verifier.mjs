import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertOpenClawWindowsPtyGuard } from './openclaw-windows-pty-guard-patch.mjs';

export const TARGET_OPENCLAW_VERSION = '2026.9.2';
export const REQUIRED_OPENCLAW_NODE_ENGINE = '>=22.22.3 <23 || >=24.15.0 <25 || >=25.9.0';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MOE_PLUGIN_ID = 'moe-principal-assistant';
const MOE_PLUGIN_CONFIG = {
  principalName: 'Mrs. Test',
  schoolName: 'Demo Primary',
  educationDistrict: 'Victoria',
  schoolType: 'Government',
};
const MOE_NO_HOSTAPI_TOOLS = [
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
// hosted34244582967 (clean 1d745567, windows-latest): every disposition
// assertion passed, then the plain `fs.rmSync(tempRoot, { recursive, force })`
// in the finally threw `EPERM ... \Temp\clwx-openclaw-moe-plugin-OPDKpz`
// (syscall 'rm') and failed the suite. The observed code was EPERM; the
// underlying cause is UNKNOWN — a transient handle on the just-executed
// plugin state (AV scan / lazy fd release) is a plausible hypothesis, but
// EPERM can equally mean a permanent permission problem, and the two are
// indistinguishable from the error alone.
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
export const OWNED_TEMP_RM_OPTIONS = Object.freeze({
  recursive: true,
  force: true,
  maxRetries: 10,
  retryDelay: 100,
});

// Exported (with an injectable rm for deterministic controls in the unit
// lane) — production callers pass tempRoot and the primary error, if any.
export function finalizeOwnedVerifierTempRoot(tempRoot, primaryError = null, rmImpl = fs.rmSync) {
  let cleanupError = null;
  try {
    rmImpl(tempRoot, { ...OWNED_TEMP_RM_OPTIONS });
  } catch (error) {
    cleanupError = error;
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

function pdfWithText(text) {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
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

async function withProcessEnv(overrides, fn) {
  const previous = new Map();
  for (const key of Object.keys(overrides)) previous.set(key, process.env[key]);
  try {
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = String(value);
    }
    return await fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function buildMoePluginConfig(pluginRoot, hostApi = false) {
  const config = {
    plugins: {
      load: { paths: [pluginRoot] },
      entries: { [MOE_PLUGIN_ID]: { enabled: true, config: MOE_PLUGIN_CONFIG } },
    },
  };
  if (hostApi) config.tools = {};
  return config;
}

async function loadMoeRegistry(openclawDir, pluginRoot, tempRoot, hostApi = false) {
  const buildSmokeEntry = path.join(openclawDir, 'dist', 'plugins', 'build-smoke-entry.js');
  if (!fs.existsSync(buildSmokeEntry)) {
    throw new Error('OpenClaw plugin build-smoke-entry runtime surface missing');
  }
  const smoke = await import(`${pathToFileURL(buildSmokeEntry).href}?verify=${Date.now()}-${Math.random()}`);
  const stateDir = path.join(tempRoot, hostApi ? 'state-hostapi' : 'state-no-hostapi');
  const homeDir = path.join(tempRoot, hostApi ? 'home-hostapi' : 'home-no-hostapi');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(homeDir, { recursive: true });
  const configPath = path.join(stateDir, 'openclaw.json');
  fs.writeFileSync(configPath, JSON.stringify(buildMoePluginConfig(pluginRoot, hostApi), null, 2));
  const env = {
    ...process.env,
    HOME: homeDir,
    OPENCLAW_STATE_DIR: stateDir,
    OPENCLAW_CONFIG_PATH: configPath,
    OPENCLAW_DISABLE_BONJOUR: '1',
    OPENCLAW_NO_RESPAWN: '1',
    CLAWX_APP_RESOURCES: path.dirname(openclawDir),
    ...(hostApi
      ? { CLAWX_HOST_API_PORT: '1', CLAWX_HOST_API_TOKEN: 'test-token' }
      : { CLAWX_HOST_API_PORT: undefined, CLAWX_HOST_API_TOKEN: undefined }),
  };
  return await withProcessEnv(env, async () => {
    const workspaceDir = path.join(homeDir, '.openclaw', 'workspace');
    const context = smoke.resolvePluginRuntimeLoadContext({ env, workspaceDir });
    return smoke.loadOpenClawPlugins(smoke.buildPluginRuntimeLoadOptions(context, {
      workspaceDir,
      env,
      onlyPluginIds: [MOE_PLUGIN_ID],
      loadModules: true,
      activate: false,
      cache: false,
    }));
  });
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
    const registry = await loadMoeRegistry(openclawDir, pluginRoot, tempRoot, false);
    const plugin = registry.plugins?.[0];
    if (registry.plugins?.length !== 1 || plugin?.id !== MOE_PLUGIN_ID || plugin.status !== 'loaded') {
      throw new Error(`MoE plugin did not load through OpenClaw 2026.9.2 registry: ${JSON.stringify(plugin ?? null)}`);
    }
    assertSameSet('MoE no-HostAPI runtime toolNames', plugin.toolNames ?? [], MOE_NO_HOSTAPI_TOOLS);
    if (!Array.isArray(registry.tools) || registry.tools.length !== MOE_NO_HOSTAPI_TOOLS.length) {
      throw new Error(`MoE no-HostAPI runtime registered ${registry.tools?.length ?? 0} executable tool factories`);
    }
    const pdfEntry = registry.tools.find((entry) => Array.isArray(entry.names) && entry.names.includes('document.read_pdf'));
    if (!pdfEntry || typeof pdfEntry.factory !== 'function') {
      throw new Error('MoE document.read_pdf runtime factory missing from OpenClaw registry');
    }
    const pdfTool = pdfEntry.factory({ sessionKey: 'verify-session' });
    if (pdfTool?.name !== 'document.read_pdf' || typeof pdfTool.execute !== 'function' || pdfTool.parameters?.type !== 'object') {
      throw new Error('MoE document.read_pdf factory did not produce an execute-based JSON-schema tool');
    }
    const pdfFixture = path.join(tempRoot, 'clwx-openclaw-2026-9-plugin-fixture.pdf');
    fs.writeFileSync(pdfFixture, pdfWithText('OPENCLAW 2026.9 MOE PDF CONTRACT'));
    const pdfResult = await pdfTool.execute('verify-call-1', { path: pdfFixture, maxChars: 1000 });
    if (!String(pdfResult?.text ?? '').includes('OPENCLAW 2026.9 MOE PDF CONTRACT')) {
      throw new Error('MoE document.read_pdf execute call did not return fixture text through the OpenClaw registry');
    }

    const hostRegistry = await loadMoeRegistry(openclawDir, pluginRoot, tempRoot, true);
    const hostPlugin = hostRegistry.plugins?.[0];
    assertSameSet('MoE HostAPI runtime toolNames', hostPlugin?.toolNames ?? [], MOE_HOSTAPI_TOOLS);
  } catch (error) {
    primaryError = error;
  }
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
