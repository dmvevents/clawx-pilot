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
    mocks.getSetting.mockResolvedValue('on-device');
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
