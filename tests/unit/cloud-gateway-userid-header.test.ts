import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderAccount } from '@electron/shared/providers/types';

// KR7 (CLWX-30): the seeded cloud gateway provider account carries the
// signed-in Graph account's Entra oid as a `UserId` header so the broker can
// meter and attribute usage per principal. Fake GUIDs only in tests.
const FAKE_OID = '00000000-0000-0000-0000-000000000001';

const mocks = vi.hoisted(() => ({
  getProviderAccount: vi.fn(),
  getDefaultProviderAccountId: vi.fn(),
  saveProviderAccount: vi.fn(),
  setDefaultProviderAccount: vi.fn(),
  storeApiKey: vi.fn(),
  getApiKey: vi.fn(),
  syncSavedProviderToRuntime: vi.fn(),
  syncDefaultProviderToRuntime: vi.fn(),
  getOpenClawProviderKey: vi.fn(),
  getSetting: vi.fn(),
  setSetting: vi.fn(),
  getMicrosoftGraphAccount: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/clawx-userid-header-user-data'),
    getAppPath: vi.fn(() => '/tmp/clawx-userid-header-app'),
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
    headers: account.headers,
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
  getApiKey: mocks.getApiKey,
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

vi.mock('@electron/services/microsoft-graph/store', () => ({
  getMicrosoftGraphAccount: mocks.getMicrosoftGraphAccount,
}));

import {
  refreshCloudGatewayUserIdHeader,
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

function savedAccount(): ProviderAccount {
  expect(mocks.saveProviderAccount).toHaveBeenCalled();
  return mocks.saveProviderAccount.mock.calls.at(-1)?.[0] as ProviderAccount;
}

function gatewayAccount(overrides: Partial<ProviderAccount> = {}): ProviderAccount {
  return {
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
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('cloud gateway UserId header (KR7)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearEnv();
    cwdSpy.mockReturnValue('/tmp/clawx-userid-header-cwd');
    mocks.getProviderAccount.mockResolvedValue(null);
    mocks.getDefaultProviderAccountId.mockResolvedValue(undefined);
    mocks.saveProviderAccount.mockResolvedValue(undefined);
    mocks.setDefaultProviderAccount.mockResolvedValue(undefined);
    mocks.storeApiKey.mockResolvedValue(true);
    mocks.getApiKey.mockResolvedValue('sk-clawx-client');
    mocks.syncSavedProviderToRuntime.mockResolvedValue(undefined);
    mocks.syncDefaultProviderToRuntime.mockResolvedValue(undefined);
    mocks.getOpenClawProviderKey.mockReturnValue('custom-moecloud');
    mocks.getSetting.mockResolvedValue('online');
    mocks.setSetting.mockResolvedValue(undefined);
    mocks.getMicrosoftGraphAccount.mockResolvedValue(null);
  });

  describe('seedCloudGatewayProvider', () => {
    beforeEach(() => {
      process.env.CLAWX_CLOUD_GATEWAY_BASE_URL = 'https://gateway.example.run.app';
      process.env.CLAWX_CLOUD_GATEWAY_API_KEY = 'sk-clawx-client';
    });

    it('stamps the Graph account oid as the UserId header when signed in', async () => {
      mocks.getMicrosoftGraphAccount.mockResolvedValue({
        accountId: FAKE_OID,
        tenantId: '00000000-0000-0000-0000-0000000000aa',
        signedInAt: Date.now(),
      });

      const result = await seedCloudGatewayProvider();

      expect(result).toMatchObject({ status: 'seeded', providerId: 'moe-cloud-gateway' });
      expect(savedAccount().headers).toEqual({ UserId: FAKE_OID });
      // The header rides the same runtime sync path as the rest of the account.
      expect(mocks.syncSavedProviderToRuntime).toHaveBeenCalledWith(
        expect.objectContaining({ headers: { UserId: FAKE_OID } }),
        'sk-clawx-client',
        undefined,
      );
    });

    it('omits the headers key entirely when no Graph account is signed in', async () => {
      const result = await seedCloudGatewayProvider();

      expect(result).toMatchObject({ status: 'seeded' });
      // Absent, not empty: unauthenticated turns must keep working through
      // the broker's anonymous path.
      expect('headers' in savedAccount()).toBe(false);
    });

    it('removes a stale UserId header on reseed after sign-out, preserving other headers', async () => {
      mocks.getProviderAccount.mockResolvedValue(gatewayAccount({
        headers: { UserId: FAKE_OID, 'X-Deployment': 'pilot' },
      }));

      await seedCloudGatewayProvider();

      expect(savedAccount().headers).toEqual({ 'X-Deployment': 'pilot' });
    });

    it('drops the headers key when a stale UserId was the only header', async () => {
      mocks.getProviderAccount.mockResolvedValue(gatewayAccount({
        headers: { UserId: FAKE_OID },
      }));

      await seedCloudGatewayProvider();

      expect('headers' in savedAccount()).toBe(false);
    });
  });

  describe('refreshCloudGatewayUserIdHeader', () => {
    it('no-ops when the cloud gateway provider has not been seeded yet', async () => {
      mocks.getMicrosoftGraphAccount.mockResolvedValue({
        accountId: FAKE_OID,
        tenantId: '00000000-0000-0000-0000-0000000000aa',
        signedInAt: Date.now(),
      });

      await expect(refreshCloudGatewayUserIdHeader()).resolves.toBeUndefined();

      expect(mocks.saveProviderAccount).not.toHaveBeenCalled();
      expect(mocks.syncSavedProviderToRuntime).not.toHaveBeenCalled();
    });

    it('adds the UserId header after sign-in and re-syncs the provider to runtime', async () => {
      mocks.getProviderAccount.mockResolvedValue(gatewayAccount());
      mocks.getMicrosoftGraphAccount.mockResolvedValue({
        accountId: FAKE_OID,
        tenantId: '00000000-0000-0000-0000-0000000000aa',
        signedInAt: Date.now(),
      });

      await refreshCloudGatewayUserIdHeader();

      expect(savedAccount().headers).toEqual({ UserId: FAKE_OID });
      expect(mocks.syncSavedProviderToRuntime).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'moe-cloud-gateway',
          headers: { UserId: FAKE_OID },
        }),
        'sk-clawx-client',
        undefined,
      );
    });

    it('removes the UserId header after sign-out', async () => {
      mocks.getProviderAccount.mockResolvedValue(gatewayAccount({
        headers: { UserId: FAKE_OID },
      }));
      mocks.getMicrosoftGraphAccount.mockResolvedValue(null);

      await refreshCloudGatewayUserIdHeader();

      expect('headers' in savedAccount()).toBe(false);
      expect(mocks.syncSavedProviderToRuntime).toHaveBeenCalledTimes(1);
    });

    it('is idempotent: a second call with the same sign-in state writes nothing', async () => {
      // The saved-account mock mirrors the persisted store so the second call
      // sees the state the first call wrote.
      let stored: ProviderAccount = gatewayAccount();
      mocks.getProviderAccount.mockImplementation(async () => stored);
      mocks.saveProviderAccount.mockImplementation(async (account: ProviderAccount) => {
        stored = account;
      });
      mocks.getMicrosoftGraphAccount.mockResolvedValue({
        accountId: FAKE_OID,
        tenantId: '00000000-0000-0000-0000-0000000000aa',
        signedInAt: Date.now(),
      });

      await refreshCloudGatewayUserIdHeader();
      await refreshCloudGatewayUserIdHeader();

      expect(mocks.saveProviderAccount).toHaveBeenCalledTimes(1);
      expect(mocks.syncSavedProviderToRuntime).toHaveBeenCalledTimes(1);
      expect(stored.headers).toEqual({ UserId: FAKE_OID });
    });

    it('survives a missing stored API key by syncing with undefined', async () => {
      mocks.getProviderAccount.mockResolvedValue(gatewayAccount());
      mocks.getApiKey.mockResolvedValue(null);
      mocks.getMicrosoftGraphAccount.mockResolvedValue({
        accountId: FAKE_OID,
        tenantId: '00000000-0000-0000-0000-0000000000aa',
        signedInAt: Date.now(),
      });

      await refreshCloudGatewayUserIdHeader();

      expect(mocks.syncSavedProviderToRuntime).toHaveBeenCalledWith(
        expect.objectContaining({ headers: { UserId: FAKE_OID } }),
        undefined,
        undefined,
      );
    });

    // Keep this test LAST in the file: seeding with a gateway manager sets
    // module-level state that would leak a live manager into the
    // no-manager assertions above.
    it('threads the seed-registered gateway manager into refresh so the live gateway reloads', async () => {
      const fakeManager = { restartGateway: vi.fn() };
      await seedCloudGatewayProvider(fakeManager as never);
      mocks.saveProviderAccount.mockClear();
      mocks.syncSavedProviderToRuntime.mockClear();

      mocks.getProviderAccount.mockResolvedValue(gatewayAccount());
      mocks.getMicrosoftGraphAccount.mockResolvedValue({
        accountId: FAKE_OID,
        tenantId: '00000000-0000-0000-0000-0000000000aa',
        signedInAt: Date.now(),
      });

      await refreshCloudGatewayUserIdHeader();

      // Without the manager the sync layer cannot schedule a reload and the
      // header change would sit parked until the next app restart (KR7
      // attribution silently anonymous mid-session).
      expect(mocks.syncSavedProviderToRuntime).toHaveBeenCalledWith(
        expect.objectContaining({ headers: { UserId: FAKE_OID } }),
        'sk-clawx-client',
        fakeManager,
      );
    });
  });
});
