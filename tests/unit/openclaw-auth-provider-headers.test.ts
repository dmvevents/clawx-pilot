import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// KR7 seam (c): ProviderConfig.headers must survive the trip into
// ~/.openclaw/openclaw.json so the bundled gateway merges them into outbound
// model calls. upsertOpenClawProviderEntry is module-private, so this drives
// it through the exported syncProviderConfigToOpenClaw wrapper.

const { testHome, testUserData } = vi.hoisted(() => {
  const suffix = Math.random().toString(36).slice(2);
  return {
    testHome: `/tmp/clawx-openclaw-provider-headers-${suffix}`,
    testUserData: `/tmp/clawx-openclaw-provider-headers-user-data-${suffix}`,
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

const PROVIDER_KEY = 'custom-moecloud';
const FAKE_OID = '00000000-0000-0000-0000-000000000001';

async function writeOpenClawJson(config: unknown): Promise<void> {
  const openclawDir = join(testHome, '.openclaw');
  await mkdir(openclawDir, { recursive: true });
  await writeFile(join(openclawDir, 'openclaw.json'), JSON.stringify(config, null, 2), 'utf8');
}

async function readProviderEntry(): Promise<Record<string, unknown>> {
  const content = await readFile(join(testHome, '.openclaw', 'openclaw.json'), 'utf8');
  const config = JSON.parse(content) as Record<string, unknown>;
  const models = config.models as Record<string, unknown>;
  const providers = models.providers as Record<string, unknown>;
  return providers[PROVIDER_KEY] as Record<string, unknown>;
}

async function syncGatewayProvider(headers?: Record<string, string>): Promise<void> {
  const { syncProviderConfigToOpenClaw } = await import('@electron/utils/openclaw-auth');
  await syncProviderConfigToOpenClaw(PROVIDER_KEY, 'moe-demo-pro', {
    baseUrl: 'https://gateway.example.run.app/v1',
    api: 'openai-completions',
    apiKeyEnv: PROVIDER_KEY,
    headers,
  });
}

describe('provider entry headers in openclaw.json', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(testHome, { recursive: true, force: true });
    await rm(testUserData, { recursive: true, force: true });
    await writeOpenClawJson({ models: { providers: {} } });
  });

  it('writes non-empty headers into models.providers.<key>.headers', async () => {
    await syncGatewayProvider({ UserId: FAKE_OID });

    const entry = await readProviderEntry();
    expect(entry.baseUrl).toBe('https://gateway.example.run.app/v1');
    expect(entry.api).toBe('openai-completions');
    expect(entry.headers).toEqual({ UserId: FAKE_OID });
  });

  it('deletes the headers key when an empty headers object is written', async () => {
    await syncGatewayProvider({ UserId: FAKE_OID });
    await syncGatewayProvider({});

    const entry = await readProviderEntry();
    expect('headers' in entry).toBe(false);
    // The rest of the entry survives the header removal.
    expect(entry.baseUrl).toBe('https://gateway.example.run.app/v1');
  });

  it('leaves existing headers untouched when headers is omitted', async () => {
    await syncGatewayProvider({ UserId: FAKE_OID });
    await syncGatewayProvider(undefined);

    const entry = await readProviderEntry();
    expect(entry.headers).toEqual({ UserId: FAKE_OID });
  });

  it('replaces stale header values on rewrite', async () => {
    await syncGatewayProvider({ UserId: FAKE_OID });
    await syncGatewayProvider({ UserId: '00000000-0000-0000-0000-000000000002' });

    const entry = await readProviderEntry();
    expect(entry.headers).toEqual({ UserId: '00000000-0000-0000-0000-000000000002' });
  });
});
