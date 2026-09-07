import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Regression guard for the Google `store` 400 (2026-09-02): the
// generativelanguage.googleapis.com OpenAI-compat endpoint rejects the
// OpenAI-only `store` request field with a bodyless HTTP 400, and the
// gateway only omits `store` when the model entry carries
// `compat.supportsStore: false`. The channel-toggle rebuild
// (setOpenClawDefaultModelWithOverride, which passes neither
// includeRegistryModels nor mergeExistingModels) used to rebuild the
// google models array from bare {id, name} entries, silently stripping
// the flag. These tests drive the module-private writer choke points
// (upsertOpenClawProviderEntry / updateModelsJsonProviderEntriesForAgents)
// through their exported wrappers.

const { testHome, testUserData } = vi.hoisted(() => {
  const suffix = Math.random().toString(36).slice(2);
  return {
    testHome: `/tmp/clawx-openclaw-google-store-compat-${suffix}`,
    testUserData: `/tmp/clawx-openclaw-google-store-compat-user-data-${suffix}`,
  };
});

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const mocked = {
    ...actual,
    homedir: () => testHome,
  };
  return {
    ...mocked,
    default: mocked,
  };
});

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => testUserData,
    getVersion: () => '0.0.0-test',
  },
}));

vi.mock('@electron/utils/paths', async () => {
  const actual = await vi.importActual<typeof import('@electron/utils/paths')>('@electron/utils/paths');
  const resolvedDir = join(testHome, '.openclaw-test-openclaw');
  return {
    ...actual,
    getOpenClawResolvedDir: () => resolvedDir,
    getOpenClawDir: () => resolvedDir,
  };
});

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const CUSTOM_BASE_URL = 'https://gateway.example.run.app/v1';

type ModelEntry = { id: string; compat?: Record<string, unknown> };

async function writeOpenClawJson(config: unknown): Promise<void> {
  const openclawDir = join(testHome, '.openclaw');
  await mkdir(openclawDir, { recursive: true });
  await writeFile(join(openclawDir, 'openclaw.json'), JSON.stringify(config, null, 2), 'utf8');
}

async function readProviderEntry(providerKey: string): Promise<Record<string, unknown>> {
  const content = await readFile(join(testHome, '.openclaw', 'openclaw.json'), 'utf8');
  const config = JSON.parse(content) as Record<string, unknown>;
  const models = config.models as Record<string, unknown>;
  const providers = models.providers as Record<string, unknown>;
  return providers[providerKey] as Record<string, unknown>;
}

function modelById(entry: Record<string, unknown>, id: string): ModelEntry | undefined {
  const models = entry.models as ModelEntry[];
  return models.find((m) => m.id === id);
}

// The channel-toggle rebuild: applyChannelChange -> syncDefaultProviderToRuntime
// -> setOpenClawDefaultModelWithOverride. Passes neither includeRegistryModels
// nor mergeExistingModels, so before the fix it rebuilt bare model entries.
async function runChannelToggleRebuild(): Promise<void> {
  const { setOpenClawDefaultModelWithOverride } = await import('@electron/utils/openclaw-auth');
  await setOpenClawDefaultModelWithOverride(
    'google',
    'google/gemini-2.5-pro',
    { baseUrl: GEMINI_BASE_URL, api: 'openai-completions' },
    ['google/gemini-2.5-flash'],
  );
}

describe('google generativelanguage store compat stamping', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(testHome, { recursive: true, force: true });
    await rm(testUserData, { recursive: true, force: true });
    await writeOpenClawJson({ models: { providers: {} } });
  });

  it('stamps supportsStore=false on the channel-toggle rebuild path', async () => {
    // Simulate the stale live state: google entry present, no compat.
    await writeOpenClawJson({
      models: {
        providers: {
          google: {
            baseUrl: GEMINI_BASE_URL,
            api: 'openai-completions',
            models: [
              { id: 'gemini-2.5-flash', name: 'gemini-2.5-flash' },
              { id: 'gemini-2.5-pro', name: 'gemini-2.5-pro' },
            ],
          },
        },
      },
    });

    await runChannelToggleRebuild();

    const entry = await readProviderEntry('google');
    expect(entry.baseUrl).toBe(GEMINI_BASE_URL);
    expect(modelById(entry, 'gemini-2.5-pro')?.compat).toMatchObject({ supportsStore: false });
    expect(modelById(entry, 'gemini-2.5-flash')?.compat).toMatchObject({ supportsStore: false });
  });

  it('is idempotent: a second rebuild produces the identical entry', async () => {
    await runChannelToggleRebuild();
    const first = await readProviderEntry('google');
    await runChannelToggleRebuild();
    const second = await readProviderEntry('google');
    expect(second).toEqual(first);
  });

  it('stamps supportsStore=false through syncProviderConfigToOpenClaw too', async () => {
    const { syncProviderConfigToOpenClaw } = await import('@electron/utils/openclaw-auth');
    await syncProviderConfigToOpenClaw('google', 'gemini-2.5-pro', {
      baseUrl: GEMINI_BASE_URL,
      api: 'openai-completions',
    });

    const entry = await readProviderEntry('google');
    expect(modelById(entry, 'gemini-2.5-pro')?.compat).toMatchObject({ supportsStore: false });
  });

  it('does not stamp compat for non-google endpoints', async () => {
    const { syncProviderConfigToOpenClaw } = await import('@electron/utils/openclaw-auth');
    await syncProviderConfigToOpenClaw('custom-moecloud', 'moe-demo-pro', {
      baseUrl: CUSTOM_BASE_URL,
      api: 'openai-completions',
      apiKeyEnv: 'custom-moecloud',
    });

    const entry = await readProviderEntry('custom-moecloud');
    const model = modelById(entry, 'moe-demo-pro');
    expect(model).toBeDefined();
    expect(model?.compat).toBeUndefined();
  });

  describe('per-agent models.json writer', () => {
    async function readAgentModelsJson(): Promise<Record<string, unknown>> {
      const content = await readFile(
        join(testHome, '.openclaw', 'agents', 'main', 'agent', 'models.json'),
        'utf8',
      );
      return JSON.parse(content) as Record<string, unknown>;
    }

    it('stamps supportsStore=false on google model entries', async () => {
      const { updateAgentModelProvider } = await import('@electron/utils/openclaw-auth');
      await updateAgentModelProvider('google', {
        baseUrl: GEMINI_BASE_URL,
        api: 'openai-completions',
        models: [{ id: 'gemini-2.5-pro', name: 'gemini-2.5-pro' }],
        apiKey: 'fake-test-key',
      });

      const data = await readAgentModelsJson();
      const providers = data.providers as Record<string, Record<string, unknown>>;
      const model = modelById(providers.google, 'gemini-2.5-pro');
      expect(model?.compat).toMatchObject({ supportsStore: false });
    });

    it('preserves unrelated compat keys carried by existing entries', async () => {
      const modelsPath = join(testHome, '.openclaw', 'agents', 'main', 'agent', 'models.json');
      await mkdir(join(modelsPath, '..'), { recursive: true });
      await writeFile(modelsPath, JSON.stringify({
        providers: {
          google: {
            baseUrl: GEMINI_BASE_URL,
            api: 'openai-completions',
            models: [{
              id: 'gemini-2.5-pro',
              name: 'gemini-2.5-pro',
              compat: { supportsReasoningEffort: true },
            }],
          },
        },
      }), 'utf8');

      const { updateAgentModelProvider } = await import('@electron/utils/openclaw-auth');
      await updateAgentModelProvider('google', {
        baseUrl: GEMINI_BASE_URL,
        api: 'openai-completions',
        models: [{ id: 'gemini-2.5-pro', name: 'gemini-2.5-pro' }],
        apiKey: 'fake-test-key',
      });

      const data = await readAgentModelsJson();
      const providers = data.providers as Record<string, Record<string, unknown>>;
      const model = modelById(providers.google, 'gemini-2.5-pro');
      expect(model?.compat).toMatchObject({
        supportsReasoningEffort: true,
        supportsStore: false,
      });
    });

    it('does not stamp compat for non-google endpoints', async () => {
      const { updateAgentModelProvider } = await import('@electron/utils/openclaw-auth');
      await updateAgentModelProvider('custom-moecloud', {
        baseUrl: CUSTOM_BASE_URL,
        api: 'openai-completions',
        models: [{ id: 'moe-demo-pro', name: 'moe-demo-pro' }],
        apiKey: 'fake-test-key',
      });

      const data = await readAgentModelsJson();
      const providers = data.providers as Record<string, Record<string, unknown>>;
      const model = modelById(providers['custom-moecloud'], 'moe-demo-pro');
      expect(model).toBeDefined();
      expect(model?.compat).toBeUndefined();
    });
  });
});
