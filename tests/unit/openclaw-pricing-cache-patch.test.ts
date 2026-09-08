import fs from 'node:fs';
import { mkdtemp, rm, mkdir, writeFile, copyFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PATCH_MARKER,
  TARGET_OPENCLAW_VERSION,
  patchOpenClawPricingCache,
  transformOpenClawPricingCacheSource,
  verifyOpenClawPricingCachePatch,
} from '../../scripts/openclaw-pricing-cache-patch.mjs';

const ROOT = path.resolve(__dirname, '..', '..');
const installedOpenClawVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', 'openclaw', 'package.json'), 'utf8')).version;
const describeForPinnedOpenClaw = installedOpenClawVersion === TARGET_OPENCLAW_VERSION ? describe : describe.skip;
const ACTUAL_USAGE_FORMAT = path.join(ROOT, 'node_modules', 'openclaw', 'dist', 'usage-format-DDiDZsKE.js');
const OTHER_USAGE_FORMAT = path.join(ROOT, 'node_modules', 'openclaw', 'dist', 'usage-format-xnB_wIM3.js');
const actualSource = fs.existsSync(ACTUAL_USAGE_FORMAT) ? fs.readFileSync(ACTUAL_USAGE_FORMAT, 'utf8') : '';
const tempDirs: string[] = [];

type FetchRecord = { url: string };

type LoadedPricingModule = {
  refreshGatewayModelPricingCache: (params: { config: unknown; fetchImpl: (url: string) => Promise<unknown> }) => Promise<void>;
  resolveModelCostConfig: (params: { provider: string; model: string; config?: unknown }) => unknown;
  getGatewayModelPricingCacheMeta: () => { size: number };
  __pluginCalls: () => number;
  __clearPricingRefreshTimerForTest: () => void;
};

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeTempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'clawx-pricing-patch-'));
  tempDirs.push(dir);
  return dir;
}

function jsonResponse(payload: unknown) {
  const bytes = Buffer.from(JSON.stringify(payload), 'utf8');
  return {
    ok: true,
    status: 200,
    headers: { get: () => String(bytes.length) },
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

function pricing(input: string, output = input) {
  return {
    prompt: input,
    completion: output,
    input_cache_read: '0',
    input_cache_write: '0',
  };
}

function litellmPricing(input: string, output = input) {
  return {
    input_cost_per_token: input,
    output_cost_per_token: output,
    cache_read_input_token_cost: '0',
    cache_creation_input_token_cost: '0',
  };
}

function makeFetch(openRouterModels: Array<{ id: string; pricing: unknown }>, litellm: Record<string, unknown> = {}) {
  const records: FetchRecord[] = [];
  const fetchImpl = async (url: string) => {
    records.push({ url });
    if (url.includes('openrouter.ai')) return jsonResponse({ data: openRouterModels });
    if (url.includes('litellm')) return jsonResponse(litellm);
    throw new Error(`unexpected fetch URL ${url}`);
  };
  return { fetchImpl, records };
}

async function loadPatchedPricingModule(): Promise<LoadedPricingModule> {
  const transformed = transformOpenClawPricingCacheSource(actualSource).source;
  const withoutImports = transformed.replace(/^import .*;\n/gm, '');
  const stubbed = `
let pluginCalls = 0;
function normalizeLowercaseStringOrEmpty(value) { return typeof value === 'string' ? value.trim().toLowerCase() : ''; }
function normalizeOptionalString(value) { return typeof value === 'string' && value.trim() ? value.trim() : undefined; }
function resolvePrimaryStringValue(value) { return typeof value === 'string' ? value : typeof value?.model === 'string' ? value.model : undefined; }
function createSubsystemLogger() { return { child: () => ({ warn() {}, info() {}, debug() {} }) }; }
function resolveManifestContractPluginIds() { return []; }
function normalizeProviderId(value) { return String(value ?? '').trim().toLowerCase().replace(/_/g, '-'); }
const DEFAULT_PROVIDER = 'anthropic';
function normalizeProviderModelIdWithPlugin({ provider, context }) {
  pluginCalls += 1;
  const model = context.modelId;
  if (provider === 'anthropic') {
    return model.replace(/^claude-(\\d+)\\.(\\d+)-/u, 'claude-$1-$2-').replace(/^claude-([a-z]+)-(\\d+)\\.(\\d+)$/u, 'claude-$1-$2-$3');
  }
  return model;
}
function parseModelRef(raw, defaultProvider = DEFAULT_PROVIDER) {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  const slash = value.indexOf('/');
  if (slash === -1) return { provider: defaultProvider, model: value };
  return { provider: value.slice(0, slash), model: value.slice(slash + 1) };
}
function normalizeModelRef(provider, model, options = {}) {
  const normalizedProvider = normalizeProviderId(provider);
  let normalizedModel = String(model ?? '').trim();
  if (options.allowPluginNormalization !== false) {
    normalizedModel = normalizeProviderModelIdWithPlugin({ provider: normalizedProvider, context: { provider: normalizedProvider, modelId: normalizedModel } }) ?? normalizedModel;
  }
  return { provider: normalizedProvider, model: normalizedModel };
}
function resolveModelRefFromString({ raw, defaultProvider = DEFAULT_PROVIDER, aliasIndex }) {
  const resolvedRaw = aliasIndex?.get?.(raw) ?? raw;
  return { ref: parseModelRef(resolvedRaw, defaultProvider) };
}
function buildModelAliasIndex({ cfg }) {
  return new Map(Object.entries(cfg?.models?.aliases ?? {}));
}
function modelKey(provider, model) { return provider + '/' + model; }
function resolvePluginWebSearchConfig() { return undefined; }
const fs = { statSync() { throw new Error('no models.json in unit fixture'); }, readFileSync() { throw new Error('no models.json in unit fixture'); } };
const path = { join: (...parts) => parts.join('/') };
function resolveOpenClawAgentDir() { return '/missing-openclaw-agent-dir'; }
${withoutImports}
export { refreshGatewayModelPricingCache, resolveModelCostConfig, getGatewayModelPricingCacheMeta };
export function __pluginCalls() { return pluginCalls; }
export function __clearPricingRefreshTimerForTest() { clearRefreshTimer(); }
`;
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(stubbed, 'utf8').toString('base64')}`;
  return await import(moduleUrl) as LoadedPricingModule;
}

async function refreshAndResolve(params: {
  config: unknown;
  openRouterModels: Array<{ id: string; pricing: unknown }>;
  litellm?: Record<string, unknown>;
  provider: string;
  model: string;
}) {
  const mod = await loadPatchedPricingModule();
  const { fetchImpl } = makeFetch(params.openRouterModels, params.litellm ?? {});
  await mod.refreshGatewayModelPricingCache({ config: params.config, fetchImpl });
  try {
    return {
      cost: mod.resolveModelCostConfig({ provider: params.provider, model: params.model, config: params.config }) as { input?: number; output?: number } | undefined,
      cache: mod.getGatewayModelPricingCacheMeta(),
      pluginCalls: mod.__pluginCalls(),
    };
  } finally {
    mod.__clearPricingRefreshTimerForTest();
  }
}

describeForPinnedOpenClaw('openclaw pricing cache patch', () => {
  it('patches the pinned pricing refresh source and is idempotent', () => {
    const first = transformOpenClawPricingCacheSource(actualSource);
    const second = transformOpenClawPricingCacheSource(first.source);

    expect(first.patched).toBe(true);
    expect(first.source).toContain(PATCH_MARKER);
    expect(first.source).toContain('function buildOpenRouterPricingLookupCandidates(refs)');
    expect(first.source).toContain('function shouldNormalizeOpenRouterCatalogEntry(id, candidates)');
    expect(first.source).toContain('const normalized = normalizeProviderId(provider);');
    expect(second.patched).toBe(false);
    expect(second.source).toBe(first.source);
  });

  it('fails closed when the pinned target snippets drift', () => {
    expect(() => transformOpenClawPricingCacheSource('function refreshGatewayModelPricingCache() {}')).toThrow(/target drift/);
    expect(() => transformOpenClawPricingCacheSource(actualSource.replace('function canonicalizeOpenRouterProvider', 'function canonicalizeOpenRouterProviderDrifted'))).toThrow(/provider canonicalizer/);
  });

  it('fails closed when a marked patch has missing or modified helper code', () => {
    const transformed = transformOpenClawPricingCacheSource(actualSource).source;

    expect(() => transformOpenClawPricingCacheSource(transformed.replace('function buildOpenRouterPricingLookupCandidates(refs)', 'function buildOpenRouterPricingLookupCandidatesModified(refs)'))).toThrow(/patched snippets are incomplete/);
    expect(() => transformOpenClawPricingCacheSource(transformed.replace('if (candidates.exactIds.has(trimmed)) return true;', 'if (candidates.exactIds.has(trimmed)) return false;'))).toThrow(/patched snippets are incomplete/);
  });

  it('patches pricing-bootstrap usage-format chunks while ignoring harmless usage-format chunks', async () => {
    const dir = await makeTempDir();
    const openclawDir = path.join(dir, 'openclaw');
    const distDir = path.join(openclawDir, 'dist');
    await mkdir(distDir, { recursive: true });
    await writeFile(path.join(openclawDir, 'package.json'), JSON.stringify({ version: TARGET_OPENCLAW_VERSION }), 'utf8');
    await copyFile(ACTUAL_USAGE_FORMAT, path.join(distDir, 'usage-format-hot.js'));
    await copyFile(OTHER_USAGE_FORMAT, path.join(distDir, 'usage-format-small.js'));

    const result = patchOpenClawPricingCache(openclawDir);
    verifyOpenClawPricingCachePatch(openclawDir);

    expect(result.targets.map((target) => path.basename(target))).toEqual(['usage-format-hot.js']);
    expect(result.patched).toBe(true);
    expect(fs.readFileSync(path.join(distDir, 'usage-format-hot.js'), 'utf8')).toContain(PATCH_MARKER);
    expect(fs.readFileSync(path.join(distDir, 'usage-format-small.js'), 'utf8')).not.toContain(PATCH_MARKER);
    expect(patchOpenClawPricingCache(openclawDir).patched).toBe(false);
  });

  it('does not normalize thousands of irrelevant remote providers through plugins', async () => {
    const irrelevant = Array.from({ length: 2_000 }, (_, index) => ({
      id: `irrelevant-${index}/remote-model-${index}`,
      pricing: pricing('0.000009'),
    }));
    const result = await refreshAndResolve({
      config: { agents: { defaults: { model: 'anthropic/claude-3-5-sonnet' } } },
      openRouterModels: [
        ...irrelevant,
        { id: 'anthropic/claude-3-5-sonnet', pricing: pricing('0.000001', '0.000002') },
      ],
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
    });

    expect(result.cost?.input).toBe(1);
    expect(result.cost?.output).toBe(2);
    expect(result.cache.size).toBe(1);
    expect(result.pluginCalls).toBeLessThan(20);
  });

  it('preserves alias resolution and dotted Anthropic fallback candidates', async () => {
    const result = await refreshAndResolve({
      config: {
        models: { aliases: { teacher: 'anthropic/claude-3-5-sonnet' } },
        agents: { defaults: { model: 'teacher' } },
      },
      openRouterModels: [
        { id: 'anthropic/claude-3.5-sonnet', pricing: pricing('0.000003') },
      ],
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
    });

    expect(result.cost?.input).toBe(3);
    expect(result.cache.size).toBe(1);
  });

  it('preserves nested wrapper-provider OpenRouter candidates', async () => {
    const result = await refreshAndResolve({
      config: { agents: { defaults: { model: 'openrouter/anthropic/claude-3-5-sonnet' } } },
      openRouterModels: [
        { id: 'anthropic/claude-3.5-sonnet', pricing: pricing('0.000004') },
      ],
      provider: 'openrouter',
      model: 'anthropic/claude-3-5-sonnet',
    });

    expect(result.cost?.input).toBe(4);
    expect(result.cache.size).toBe(1);
  });

  it('preserves exact OpenRouter lookup priority over normalized candidates', async () => {
    const result = await refreshAndResolve({
      config: { agents: { defaults: { model: 'anthropic/claude-3-5-sonnet' } } },
      openRouterModels: [
        { id: 'anthropic/claude-3.5-sonnet', pricing: pricing('0.000009') },
        { id: 'anthropic/claude-3-5-sonnet', pricing: pricing('0.000001') },
      ],
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
    });

    expect(result.cost?.input).toBe(1);
  });

  it('preserves LiteLLM fallback pricing when OpenRouter has no match', async () => {
    const result = await refreshAndResolve({
      config: { agents: { defaults: { model: 'anthropic/litellm-only' } } },
      openRouterModels: [],
      litellm: { 'anthropic/litellm-only': litellmPricing('0.000005', '0.000006') },
      provider: 'anthropic',
      model: 'litellm-only',
    });

    expect(result.cost?.input).toBe(5);
    expect(result.cost?.output).toBe(6);
    expect(result.cache.size).toBe(1);
  });
});
