import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderAccount } from '@electron/shared/providers/types';

const mocks = vi.hoisted(() => ({
  userDataPath: '/tmp/clawx-cloud-seed-user-data',
  appPath: '/tmp/clawx-cloud-seed-app',
  cwdPath: '/tmp/clawx-cloud-seed-cwd',
  getProviderAccount: vi.fn(),
  getDefaultProviderAccountId: vi.fn(),
  saveProviderAccount: vi.fn(),
  setDefaultProviderAccount: vi.fn(),
  storeApiKey: vi.fn(),
  syncSavedProviderToRuntime: vi.fn(),
  syncDefaultProviderToRuntime: vi.fn(),
  getOpenClawProviderKey: vi.fn(),
  getSetting: vi.fn(),
  setSetting: vi.fn(),
  getMicrosoftGraphAccount: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return mocks.userDataPath;
      return '/tmp';
    }),
    getAppPath: vi.fn(() => mocks.appPath),
  },
}));

vi.mock('@electron/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@electron/services/providers/provider-store', () => ({
  getProviderAccount: mocks.getProviderAccount,
  getDefaultProviderAccountId: mocks.getDefaultProviderAccountId,
  providerAccountToConfig: (account: ProviderAccount) => ({
    id: account.id,
    name: account.label,
    type: account.vendorId,
    baseUrl: account.baseUrl,
    apiProtocol: account.apiProtocol,
    model: account.model,
    fallbackModels: account.fallbackModels,
    enabled: account.enabled,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  }),
  saveProviderAccount: mocks.saveProviderAccount,
  setDefaultProviderAccount: mocks.setDefaultProviderAccount,
}));

vi.mock('@electron/utils/secure-storage', () => ({
  storeApiKey: mocks.storeApiKey,
}));

vi.mock('@electron/services/providers/provider-runtime-sync', () => ({
  getOpenClawProviderKey: mocks.getOpenClawProviderKey,
  syncSavedProviderToRuntime: mocks.syncSavedProviderToRuntime,
  syncDefaultProviderToRuntime: mocks.syncDefaultProviderToRuntime,
}));

vi.mock('@electron/utils/store', () => ({
  getSetting: mocks.getSetting,
  setSetting: mocks.setSetting,
}));

// KR7 boundary: the seed reads the signed-in Graph account to stamp the
// UserId metering header. This was the ONLY unmocked collaborator in this
// unit suite, and its real implementation lazily does
// `await import('electron-store')` -> `import 'electron'` -> the electron
// package entry, which SYNCHRONOUSLY spawns `install.js` ("Downloading
// Electron binary...") when node_modules/electron/dist is absent — exactly
// what hosted34244582967 (windows-latest, clean 1d745567) logged inside the
// first seeding test before it hit the 5000ms default timeout. Mock the
// boundary so the unit suite is hermetic and deterministic; the account
// present/absent/failing cases are pinned explicitly below.
vi.mock('@electron/services/microsoft-graph/store', () => ({
  getMicrosoftGraphAccount: mocks.getMicrosoftGraphAccount,
}));

import {
  normalizeCloudGatewayBaseUrl,
  resolveCloudGatewaySeedConfig,
  seedCloudGatewayProvider,
} from '@electron/main/cloud-gateway-provider-seed';

const cwdSpy = vi.spyOn(process, 'cwd');

const ENV_KEYS = [
  'CLAWX_CLOUD_GATEWAY_ENABLED',
  'CLAWX_CLOUD_GATEWAY_CONFIG',
  'CLAWX_CLOUD_GATEWAY_PROVIDER_ID',
  'CLAWX_CLOUD_GATEWAY_LABEL',
  'CLAWX_CLOUD_GATEWAY_BASE_URL',
  'CLAWX_CLOUD_GATEWAY_API_KEY',
  'CLAWX_CLOUD_GATEWAY_API_KEY_FILE',
  'CLAWX_CLOUD_GATEWAY_MODEL',
  'CLAWX_CLOUD_GATEWAY_MODELS',
  'CLAWX_CLOUD_GATEWAY_FALLBACK_MODELS',
  'CLAWX_CLOUD_GATEWAY_API_PROTOCOL',
  'CLAWX_CLOUD_GATEWAY_SET_DEFAULT',
  'CLAWX_CLOUD_GATEWAY_SET_PREFERRED_CHANNEL',
];

function clearEnv(): void {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
}

describe('cloud-gateway-provider-seed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearEnv();
    cwdSpy.mockReturnValue(mocks.cwdPath);
    mocks.getProviderAccount.mockResolvedValue(null);
    mocks.getDefaultProviderAccountId.mockResolvedValue(undefined);
    mocks.saveProviderAccount.mockResolvedValue(undefined);
    mocks.setDefaultProviderAccount.mockResolvedValue(undefined);
    mocks.storeApiKey.mockResolvedValue(true);
    mocks.syncSavedProviderToRuntime.mockResolvedValue(undefined);
    mocks.syncDefaultProviderToRuntime.mockResolvedValue(undefined);
    mocks.getOpenClawProviderKey.mockReturnValue('custom-moecloud');
    // Default: no Graph account signed in -> no UserId header stamped.
    mocks.getMicrosoftGraphAccount.mockResolvedValue(null);
    // Default scenario: a post-migration box where the principal explicitly
    // chose On this device. channelDefaultMigrated=true marks that the seed's
    // one-time launch-default pass already ran, so the persisted value is an
    // explicit toggle and must be respected (moe.13 no-clobber).
    mocks.getSetting.mockImplementation(async (key: string) => {
      if (key === 'preferredChannel') return 'on-device';
      if (key === 'channelDefaultMigrated') return true;
      return false;
    });
    mocks.setSetting.mockResolvedValue(undefined);
  });

  it('normalizes Cloud Run and endpoint URLs to an OpenAI-compatible /v1 base URL', () => {
    expect(normalizeCloudGatewayBaseUrl('https://gateway.example.run.app')).toBe(
      'https://gateway.example.run.app/v1',
    );
    expect(normalizeCloudGatewayBaseUrl('https://gateway.example.run.app/v1/chat/completions')).toBe(
      'https://gateway.example.run.app/v1',
    );
    expect(normalizeCloudGatewayBaseUrl('https://gateway.example.run.app/v1/responses')).toBe(
      'https://gateway.example.run.app/v1',
    );
  });

  it('returns null when no complete env or file config is present', async () => {
    await expect(resolveCloudGatewaySeedConfig()).resolves.toBeNull();
  });

  it('seeds env-configured cloud gateway as default and flips the preferred channel online', async () => {
    process.env.CLAWX_CLOUD_GATEWAY_BASE_URL = 'https://gateway.example.run.app';
    process.env.CLAWX_CLOUD_GATEWAY_API_KEY = 'sk-clawx-client';

    const result = await seedCloudGatewayProvider();

    expect(result).toMatchObject({
      status: 'seeded',
      providerId: 'moe-cloud-gateway',
      runtimeProviderKey: 'custom-moecloud',
      defaulted: true,
    });

    expect(mocks.saveProviderAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'moe-cloud-gateway',
        vendorId: 'custom',
        label: 'MOE Cloud Gateway',
        authMode: 'api_key',
        baseUrl: 'https://gateway.example.run.app/v1',
        apiProtocol: 'openai-completions',
        model: 'moe-demo-pro',
        fallbackModels: ['moe-demo'],
        enabled: true,
        isDefault: true,
        metadata: { customModels: ['moe-demo-pro', 'moe-demo'] },
      }),
    );
    // No signed-in Graph account -> the headers key must stay off entirely so
    // unauthenticated turns use the broker's anonymous path.
    const savedAccount = mocks.saveProviderAccount.mock.calls[0][0] as ProviderAccount;
    expect(savedAccount.headers).toBeUndefined();
    expect(mocks.storeApiKey).toHaveBeenCalledWith('moe-cloud-gateway', 'sk-clawx-client');
    expect(mocks.syncSavedProviderToRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'moe-cloud-gateway',
        type: 'custom',
        baseUrl: 'https://gateway.example.run.app/v1',
        model: 'moe-demo-pro',
        fallbackModels: ['moe-demo'],
      }),
      'sk-clawx-client',
      undefined,
    );
    expect(mocks.setDefaultProviderAccount).toHaveBeenCalledWith('moe-cloud-gateway');
    expect(mocks.syncDefaultProviderToRuntime).toHaveBeenCalledWith('moe-cloud-gateway', undefined);
    // The mocked settings store returns an EXISTING 'on-device' choice — the
    // seed must respect it, not flip it back to online on every boot (that
    // silently reverted a principal's channel selection; found live on the
    // moe.13 KR2 run, 2026-09-02).
    expect(mocks.setSetting).not.toHaveBeenCalledWith('preferredChannel', expect.anything());
    expect(mocks.setSetting).toHaveBeenCalledWith('setupComplete', true);
  });

  it('stamps the Graph UserId metering header when a Graph account is signed in (KR7)', async () => {
    process.env.CLAWX_CLOUD_GATEWAY_BASE_URL = 'https://gateway.example.run.app';
    process.env.CLAWX_CLOUD_GATEWAY_API_KEY = 'sk-clawx-client';
    mocks.getMicrosoftGraphAccount.mockResolvedValue({
      accountId: 'entra-oid-1234',
      email: 'principal@example.gov.tt',
      tenantId: 'tenant-1',
      signedInAt: 1757300000000,
    });

    const result = await seedCloudGatewayProvider();

    expect(result).toMatchObject({ status: 'seeded', providerId: 'moe-cloud-gateway' });
    expect(mocks.saveProviderAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'moe-cloud-gateway',
        headers: { UserId: 'entra-oid-1234' },
      }),
    );
  });

  it('still seeds without a UserId header when the Graph account read fails', async () => {
    // Pins the production `.catch(() => null)` boundary deterministically:
    // before hosted34244582967 this path was only ever exercised by the real
    // Graph store accidentally throwing (after trying to download an Electron
    // binary), which is neither hermetic nor a guaranteed control.
    process.env.CLAWX_CLOUD_GATEWAY_BASE_URL = 'https://gateway.example.run.app';
    process.env.CLAWX_CLOUD_GATEWAY_API_KEY = 'sk-clawx-client';
    mocks.getMicrosoftGraphAccount.mockRejectedValue(new Error('graph store unavailable'));

    const result = await seedCloudGatewayProvider();

    expect(result).toMatchObject({ status: 'seeded', providerId: 'moe-cloud-gateway', defaulted: true });
    const savedAccount = mocks.saveProviderAccount.mock.calls[0][0] as ProviderAccount;
    expect(savedAccount.headers).toBeUndefined();
  });

  it('defaults preferredChannel to online only when no choice exists yet', async () => {
    process.env.CLAWX_CLOUD_GATEWAY_BASE_URL = 'https://gateway.example.run.app';
    process.env.CLAWX_CLOUD_GATEWAY_API_KEY = 'sk-clawx-client';
    // Truly fresh install: preferredChannel has never been set.
    mocks.getSetting.mockImplementation(async (key: string) => (
      key === 'preferredChannel' ? undefined : false
    ));

    await seedCloudGatewayProvider();

    expect(mocks.setSetting).toHaveBeenCalledWith('preferredChannel', 'online');
    // The one-time launch-default pass is recorded so later explicit toggles
    // are never treated as a stale legacy default.
    expect(mocks.setSetting).toHaveBeenCalledWith('channelDefaultMigrated', true);
  });

  it('migrates a legacy persisted on-device default to online exactly once', async () => {
    process.env.CLAWX_CLOUD_GATEWAY_BASE_URL = 'https://gateway.example.run.app';
    process.env.CLAWX_CLOUD_GATEWAY_API_KEY = 'sk-clawx-client';
    // In-place upgrade over an old build: its store constructor persisted the
    // then-default 'on-device' to disk (conf writes the whole defaults object),
    // so the value is present WITHOUT any explicit user toggle. No migration
    // marker yet -> treat it as the stale legacy default and flip to Online.
    mocks.getSetting.mockImplementation(async (key: string) => {
      if (key === 'preferredChannel') return 'on-device';
      if (key === 'channelDefaultMigrated') return undefined;
      return false;
    });

    await seedCloudGatewayProvider();

    expect(mocks.setSetting).toHaveBeenCalledWith('preferredChannel', 'online');
    expect(mocks.setSetting).toHaveBeenCalledWith('channelDefaultMigrated', true);
  });

  it('does not rewrite an explicit on-device choice after the migration marker is set', async () => {
    process.env.CLAWX_CLOUD_GATEWAY_BASE_URL = 'https://gateway.example.run.app';
    process.env.CLAWX_CLOUD_GATEWAY_API_KEY = 'sk-clawx-client';
    // beforeEach scenario: marker=true + persisted 'on-device' = an explicit
    // post-migration toggle (moe.13). The seed must leave it alone and must
    // not re-write the already-set marker (idempotency invariant).
    await seedCloudGatewayProvider();

    expect(mocks.setSetting).not.toHaveBeenCalledWith('preferredChannel', expect.anything());
    expect(mocks.setSetting).not.toHaveBeenCalledWith('channelDefaultMigrated', expect.anything());
  });

  it('can seed boot provider config without queueing a pre-start gateway refresh', async () => {
    process.env.CLAWX_CLOUD_GATEWAY_BASE_URL = 'https://gateway.example.run.app';
    process.env.CLAWX_CLOUD_GATEWAY_API_KEY = 'sk-clawx-client';
    mocks.getSetting.mockImplementation(async (key: string) => (
      key === 'preferredChannel' ? undefined : false
    ));
    const gateway = {} as never;

    await seedCloudGatewayProvider(gateway, { skipGatewayRefresh: true });

    expect(mocks.saveProviderAccount).toHaveBeenCalledWith(expect.objectContaining({
      id: 'moe-cloud-gateway',
      baseUrl: 'https://gateway.example.run.app/v1',
      model: 'moe-demo-pro',
    }));
    expect(mocks.storeApiKey).toHaveBeenCalledWith('moe-cloud-gateway', 'sk-clawx-client');
    expect(mocks.setDefaultProviderAccount).toHaveBeenCalledWith('moe-cloud-gateway');
    expect(mocks.syncSavedProviderToRuntime).toHaveBeenCalledWith(expect.any(Object), 'sk-clawx-client', undefined);
    expect(mocks.syncDefaultProviderToRuntime).toHaveBeenCalledWith('moe-cloud-gateway', undefined);
    expect(mocks.setSetting).toHaveBeenCalledWith('preferredChannel', 'online');
  });

  it('can seed without taking default when explicitly configured that way', async () => {
    process.env.CLAWX_CLOUD_GATEWAY_BASE_URL = 'https://gateway.example.run.app';
    process.env.CLAWX_CLOUD_GATEWAY_API_KEY = 'sk-clawx-client';
    process.env.CLAWX_CLOUD_GATEWAY_SET_DEFAULT = '0';
    process.env.CLAWX_CLOUD_GATEWAY_SET_PREFERRED_CHANNEL = '0';
    mocks.getDefaultProviderAccountId.mockResolvedValue('google-existing');

    const result = await seedCloudGatewayProvider();

    expect(result).toMatchObject({ status: 'seeded', defaulted: false });
    expect(mocks.setDefaultProviderAccount).not.toHaveBeenCalled();
    expect(mocks.syncDefaultProviderToRuntime).not.toHaveBeenCalled();
    expect(mocks.setSetting).not.toHaveBeenCalled();
  });
});
