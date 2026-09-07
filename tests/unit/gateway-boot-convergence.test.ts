import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readOpenClawConfig: vi.fn(),
  writeOpenClawConfig: vi.fn(),
  applyOnDeviceToolTrim: vi.fn(),
  listProviderAccounts: vi.fn(),
  saveProviderAccount: vi.fn(),
  getDefaultProviderAccountId: vi.fn(),
  setDefaultProviderAccount: vi.fn(),
  storeApiKey: vi.fn(),
  getOpenClawProviderKey: vi.fn(),
  syncSavedProviderToRuntime: vi.fn(),
  patchProviderModelCompat: vi.fn(),
}));

vi.mock('@electron/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../shared/feature-flags', () => ({
  SEED_LOCAL_LLM_PROVIDER: true,
  TRIM_ONDEVICE_TOOL_CATALOG: true,
}));

vi.mock('@electron/utils/channel-config', () => ({
  readOpenClawConfig: mocks.readOpenClawConfig,
  writeOpenClawConfig: mocks.writeOpenClawConfig,
}));

vi.mock('@electron/utils/ondevice-tool-policy', () => ({
  applyOnDeviceToolTrim: mocks.applyOnDeviceToolTrim,
}));

vi.mock('@electron/services/providers/provider-store', () => ({
  listProviderAccounts: mocks.listProviderAccounts,
  saveProviderAccount: mocks.saveProviderAccount,
  setDefaultProviderAccount: mocks.setDefaultProviderAccount,
  getDefaultProviderAccountId: mocks.getDefaultProviderAccountId,
  providerAccountToConfig: (account: Record<string, unknown>) => ({
    id: account.id,
    name: account.label,
    type: account.vendorId,
    baseUrl: account.baseUrl,
    apiProtocol: account.apiProtocol,
    model: account.model,
    enabled: account.enabled,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  }),
}));

vi.mock('@electron/utils/secure-storage', () => ({
  storeApiKey: mocks.storeApiKey,
}));

vi.mock('@electron/services/providers/provider-runtime-sync', () => ({
  getOpenClawProviderKey: mocks.getOpenClawProviderKey,
  syncSavedProviderToRuntime: mocks.syncSavedProviderToRuntime,
}));

vi.mock('@electron/utils/openclaw-auth', () => ({
  patchProviderModelCompat: mocks.patchProviderModelCompat,
}));

import { seedDefaultLocalProvider } from '@electron/main/local-provider-seed';

describe('gateway boot convergence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readOpenClawConfig.mockResolvedValue({});
    mocks.writeOpenClawConfig.mockResolvedValue(undefined);
    mocks.applyOnDeviceToolTrim.mockReturnValue({ config: {}, changed: false });
    mocks.listProviderAccounts.mockResolvedValue([]);
    mocks.saveProviderAccount.mockResolvedValue(undefined);
    mocks.getDefaultProviderAccountId.mockResolvedValue(undefined);
    mocks.setDefaultProviderAccount.mockResolvedValue(undefined);
    mocks.storeApiKey.mockResolvedValue(undefined);
    mocks.getOpenClawProviderKey.mockImplementation((type: string, id: string) => `${type}-${id}`);
    mocks.syncSavedProviderToRuntime.mockResolvedValue(undefined);
    mocks.patchProviderModelCompat.mockResolvedValue(undefined);
  });

  it('seeds the local boot provider config without passing a pre-start manager to runtime sync', async () => {
    const gateway = {} as never;

    await seedDefaultLocalProvider(gateway, { skipGatewayRefresh: true });

    expect(mocks.saveProviderAccount).toHaveBeenCalledWith(expect.objectContaining({
      id: 'ollama-local-qwen2.5-3b-instruct',
      vendorId: 'ollama',
      model: 'qwen2.5:3b-instruct',
      isDefault: true,
    }));
    expect(mocks.storeApiKey).toHaveBeenCalledWith('ollama-local-qwen2.5-3b-instruct', 'ollama-local');
    expect(mocks.syncSavedProviderToRuntime).toHaveBeenCalledWith(expect.objectContaining({
      id: 'ollama-local-qwen2.5-3b-instruct',
      type: 'ollama',
      model: 'qwen2.5:3b-instruct',
    }), 'ollama-local', undefined);
  });

  it('keeps live local provider sync refreshable when not on the boot-suppressed path', async () => {
    const gateway = {} as never;

    await seedDefaultLocalProvider(gateway);

    expect(mocks.syncSavedProviderToRuntime).toHaveBeenCalledWith(expect.any(Object), 'ollama-local', gateway);
  });
});
