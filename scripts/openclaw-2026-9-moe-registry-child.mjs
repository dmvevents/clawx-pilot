// Bounded owned child for the OpenClaw 2026.9 MoE registry/PDF disposition.
//
// Why a child process (hosted34252050616, native auto-d controls): loading the
// MoE plugin through dist/plugins/build-smoke-entry.js opens the OpenClaw
// state database (loader openDatabase -> openOpenClawStateDatabase) whose
// handle is retained in a module-level cache (cachedDatabases in the hashed
// openclaw-state-db-cache chunk) for the LIFETIME OF THE PROCESS. On Windows
// that live sqlite handle makes the verifier's owned mkdtemp scratch root
// undeletable (EPERM on state-*/state/openclaw.sqlite survives bounded
// recursive-rm retries and short-TEMP), while a fresh process after exit
// removes the same tree cleanly. The close APIs
// (closeOpenClawStateDatabaseByPath/closeOpenClawStateDatabase) are NOT
// exported from any stable dist/plugin-sdk or dist/plugins surface — only
// from hashed chunks — and closing every cached DB in the caller's process
// could break unrelated handles. So the smallest supported lifecycle boundary
// is process exit: this child performs the real registry loads + PDF execute
// smoke, proves success with an explicit nonce marker + exit 0, and the
// parent deletes the scratch root only AFTER the child (and its DB handle)
// is gone.
//
// Contract with the parent (scripts/openclaw-2026-9-upgrade-verifier.mjs):
// - argv[2] is one JSON payload: { openclawDir, pluginRoot, tempRoot, nonce }
//   (all required non-empty strings; tempRoot is parent-owned scratch).
// - On success: prints `CLWX_MOE_REGISTRY_PROOF <nonce>` and exits 0.
// - On any failure: prints the real error to stderr and exits non-zero.
//   No retries, no cleanup of the parent-owned tempRoot, no writes outside it.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  MOE_HOSTAPI_TOOLS,
  MOE_NO_HOSTAPI_TOOLS,
  MOE_REGISTRY_PROOF_PREFIX,
  assertSameSet,
} from './openclaw-2026-9-upgrade-verifier.mjs';

const MOE_PLUGIN_ID = 'moe-principal-assistant';
const MOE_PLUGIN_CONFIG = {
  principalName: 'Mrs. Test',
  schoolName: 'Demo Primary',
  educationDistrict: 'Victoria',
  schoolType: 'Government',
};

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

// The exact disposition checks previously performed in-process by
// assertMoePluginToolRegistration: both registries (no-HostAPI and HostAPI),
// exact inventories, and the document.read_pdf execute smoke.
export async function runMoeRegistryVerification({ openclawDir, pluginRoot, tempRoot }) {
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
}

export function parseMoeRegistryChildPayload(raw) {
  let payload;
  try {
    payload = JSON.parse(String(raw ?? ''));
  } catch (thrown) {
    throw new Error(`MoE registry child payload is not valid JSON: ${thrown instanceof Error ? thrown.message : String(thrown)}`);
  }
  for (const key of ['openclawDir', 'pluginRoot', 'tempRoot', 'nonce']) {
    if (typeof payload?.[key] !== 'string' || payload[key].trim() === '') {
      throw new Error(`MoE registry child payload missing required string field: ${key}`);
    }
  }
  return payload;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const payload = parseMoeRegistryChildPayload(process.argv[2]);
    await runMoeRegistryVerification(payload);
    // Explicit per-invocation proof marker; the parent refuses exit 0 without it.
    console.log(`${MOE_REGISTRY_PROOF_PREFIX} ${payload.nonce}`);
    // Explicit success exit: do not rely on the event loop draining while the
    // cached OpenClaw state DB handle is still open in this process.
    process.exit(0);
  } catch (thrown) {
    console.error(thrown instanceof Error ? (thrown.stack ?? thrown.message) : `non-Error thrown: ${String(thrown)}`);
    process.exit(1);
  }
}
