import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderConfig } from '@electron/utils/secure-storage';
import type { ProviderAccount } from '../../shared/providers/types';

const mocks = vi.hoisted(() => ({
  listProviderAccounts: vi.fn(),
  getProvider: vi.fn(),
  getDefaultProvider: vi.fn(),
  setDefaultProvider: vi.fn(),
  syncDefaultProviderToRuntime: vi.fn(),
  ensureProviderAccountRuntime: vi.fn(),
  getOpenClawProviderKey: vi.fn(),
  setAllAgentsModel: vi.fn(),
  getProviderDefaultModel: vi.fn(),
  probeLocalProviderReadiness: vi.fn(),
}));

vi.mock('@electron/services/providers/provider-store', () => ({
  listProviderAccounts: mocks.listProviderAccounts,
}));

vi.mock('@electron/utils/secure-storage', () => ({
  getProvider: mocks.getProvider,
  getDefaultProvider: mocks.getDefaultProvider,
  setDefaultProvider: mocks.setDefaultProvider,
}));

vi.mock('@electron/services/providers/provider-runtime-sync', () => ({
  ensureProviderAccountRuntime: mocks.ensureProviderAccountRuntime,
  syncDefaultProviderToRuntime: mocks.syncDefaultProviderToRuntime,
  getOpenClawProviderKey: mocks.getOpenClawProviderKey,
}));

vi.mock('@electron/utils/agent-config', () => ({
  setAllAgentsModel: mocks.setAllAgentsModel,
}));

vi.mock('@electron/utils/provider-registry', () => ({
  getProviderDefaultModel: mocks.getProviderDefaultModel,
}));

vi.mock('@electron/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@electron/main/local-provider-seed', () => ({
  probeLocalProviderReadiness: mocks.probeLocalProviderReadiness,
}));

import {
  applyChannelChange,
  listAvailableChannels,
  getActiveChannel,
  prepareTransientChannelChange,
  runChannelPreflight,
} from '@electron/services/providers/channel-router';

function makeAccount(overrides: Partial<ProviderAccount> = {}): ProviderAccount {
  return {
    id: 'gemini-1',
    vendorId: 'google',
    label: 'Gemini',
    authMode: 'api_key',
    enabled: true,
    isDefault: false,
    model: 'gemini-2.5-pro',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  } as ProviderAccount;
}

function makeProvider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'gemini-1',
    name: 'Gemini',
    type: 'google',
    enabled: true,
    model: 'gemini-2.5-pro',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  } as ProviderConfig;
}

describe('channel-router applyChannelChange', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getOpenClawProviderKey.mockImplementation((type: string, id: string) => `${type}-${id}`);
    mocks.getProviderDefaultModel.mockReturnValue(undefined);
    mocks.getDefaultProvider.mockResolvedValue(undefined);
    mocks.setDefaultProvider.mockResolvedValue(undefined);
    mocks.syncDefaultProviderToRuntime.mockResolvedValue(undefined);
    mocks.ensureProviderAccountRuntime.mockResolvedValue(undefined);
    mocks.setAllAgentsModel.mockResolvedValue(undefined);
    mocks.probeLocalProviderReadiness.mockResolvedValue({ ready: true, reason: 'ok', status: 200 });
  });

  it('runs the four-store transaction for the online channel', async () => {
    mocks.listProviderAccounts.mockResolvedValue([
      makeAccount({ id: 'ollama-local', vendorId: 'ollama', baseUrl: 'http://localhost:11434/v1' }),
      makeAccount({ id: 'gemini-1', vendorId: 'google', model: 'gemini-2.5-pro' }),
    ]);
    mocks.getProvider.mockResolvedValue(makeProvider({ id: 'gemini-1', type: 'google', model: 'gemini-2.5-pro' }));
    mocks.getDefaultProvider.mockResolvedValue('ollama-local');

    const result = await applyChannelChange('online');

    expect(result.channel).toBe('online');
    expect(result.accountId).toBe('gemini-1');
    expect(result.modelRef).toBe('google-gemini-1/gemini-2.5-pro');
    expect(result.switched).toBe(true);

    expect(mocks.setDefaultProvider).toHaveBeenCalledWith('gemini-1');
    expect(mocks.syncDefaultProviderToRuntime).toHaveBeenCalledWith('gemini-1', undefined, { skipGatewayRefresh: false });
    expect(mocks.setAllAgentsModel).toHaveBeenCalledWith('google-gemini-1/gemini-2.5-pro');
  });

  it('picks the on-device account by localhost baseUrl', async () => {
    mocks.listProviderAccounts.mockResolvedValue([
      makeAccount({ id: 'gemini-1', vendorId: 'google', model: 'gemini-2.5-pro' }),
      makeAccount({ id: 'ollama-local', vendorId: 'ollama', baseUrl: 'http://localhost:11434/v1', model: 'hermes3:8b' }),
    ]);
    mocks.getProvider.mockResolvedValue(
      makeProvider({ id: 'ollama-local', type: 'ollama', model: 'hermes3:8b', baseUrl: 'http://localhost:11434/v1' }),
    );
    mocks.getDefaultProvider.mockResolvedValue('gemini-1');

    const result = await applyChannelChange('on-device');

    expect(result.channel).toBe('on-device');
    expect(result.accountId).toBe('ollama-local');
    expect(result.modelRef).toBe('ollama-ollama-local/hermes3:8b');
    expect(mocks.setDefaultProvider).toHaveBeenCalledWith('ollama-local');
    expect(mocks.setAllAgentsModel).toHaveBeenCalledWith('ollama-ollama-local/hermes3:8b');
  });

  it('throws when the requested channel has no configured account', async () => {
    mocks.listProviderAccounts.mockResolvedValue([
      makeAccount({ id: 'ollama-local', vendorId: 'ollama', baseUrl: 'http://localhost:11434/v1' }),
    ]);

    await expect(applyChannelChange('online')).rejects.toThrow(
      /No provider account is configured for the "online" channel/,
    );
    expect(mocks.setAllAgentsModel).not.toHaveBeenCalled();
    expect(mocks.setDefaultProvider).not.toHaveBeenCalled();
  });

  it('throws when the picked account has no model and no fallback', async () => {
    mocks.listProviderAccounts.mockResolvedValue([
      makeAccount({ id: 'gemini-1', vendorId: 'google', model: undefined }),
    ]);
    mocks.getProvider.mockResolvedValue(makeProvider({ id: 'gemini-1', type: 'google', model: undefined }));
    mocks.getProviderDefaultModel.mockReturnValue(undefined);

    await expect(applyChannelChange('online')).rejects.toThrow(/has no model configured/);
    expect(mocks.setAllAgentsModel).not.toHaveBeenCalled();
  });

  it('falls back to provider-registry default model when account has none', async () => {
    mocks.listProviderAccounts.mockResolvedValue([
      makeAccount({ id: 'gemini-1', vendorId: 'google', model: undefined }),
    ]);
    mocks.getProvider.mockResolvedValue(makeProvider({ id: 'gemini-1', type: 'google', model: undefined }));
    mocks.getProviderDefaultModel.mockReturnValue('gemini-2.5-flash');

    const result = await applyChannelChange('online');

    expect(result.modelRef).toBe('google-gemini-1/gemini-2.5-flash');
    expect(mocks.setAllAgentsModel).toHaveBeenCalledWith('google-gemini-1/gemini-2.5-flash');
  });

  it('prefers the isDefault account in the channel', async () => {
    mocks.listProviderAccounts.mockResolvedValue([
      makeAccount({ id: 'gemini-1', vendorId: 'google', model: 'gemini-2.5-flash', isDefault: false }),
      makeAccount({ id: 'gemini-2', vendorId: 'google', model: 'gemini-2.5-pro', isDefault: true }),
    ]);
    mocks.getProvider.mockResolvedValue(makeProvider({ id: 'gemini-2', type: 'google', model: 'gemini-2.5-pro' }));

    const result = await applyChannelChange('online');

    expect(result.accountId).toBe('gemini-2');
  });

  it('skips setDefaultProvider when the picked account is already default', async () => {
    mocks.listProviderAccounts.mockResolvedValue([
      makeAccount({ id: 'gemini-1', vendorId: 'google', model: 'gemini-2.5-pro', isDefault: true }),
    ]);
    mocks.getProvider.mockResolvedValue(makeProvider({ id: 'gemini-1', type: 'google', model: 'gemini-2.5-pro' }));
    mocks.getDefaultProvider.mockResolvedValue('gemini-1');

    const result = await applyChannelChange('online');

    expect(result.switched).toBe(false);
    expect(mocks.setDefaultProvider).not.toHaveBeenCalled();
    expect(mocks.syncDefaultProviderToRuntime).toHaveBeenCalledWith('gemini-1', undefined, { skipGatewayRefresh: false });
    expect(mocks.setAllAgentsModel).toHaveBeenCalled();
  });

  it('forwards skipGatewayRefresh for pre-start callers that own gateway lifecycle', async () => {
    const gateway = {} as never;
    mocks.listProviderAccounts.mockResolvedValue([
      makeAccount({ id: 'ollama-local', vendorId: 'ollama', baseUrl: 'http://localhost:11434/v1', model: 'hermes3:8b' }),
    ]);
    mocks.getProvider.mockResolvedValue(
      makeProvider({ id: 'ollama-local', type: 'ollama', model: 'hermes3:8b', baseUrl: 'http://localhost:11434/v1' }),
    );
    mocks.getDefaultProvider.mockResolvedValue('gemini-1');

    await applyChannelChange('on-device', gateway, { skipGatewayRefresh: true });

    expect(mocks.syncDefaultProviderToRuntime).toHaveBeenCalledWith('ollama-local', gateway, { skipGatewayRefresh: true });
    expect(mocks.setDefaultProvider).toHaveBeenCalledWith('ollama-local');
    expect(mocks.setAllAgentsModel).toHaveBeenCalledWith('ollama-ollama-local/hermes3:8b');
  });
});

describe('channel-router prepareTransientChannelChange', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getOpenClawProviderKey.mockImplementation((type: string, id: string) => `${type}-${id}`);
    mocks.getProviderDefaultModel.mockReturnValue(undefined);
    mocks.getDefaultProvider.mockResolvedValue('gemini-1');
    mocks.setDefaultProvider.mockResolvedValue(undefined);
    mocks.syncDefaultProviderToRuntime.mockResolvedValue(undefined);
    mocks.ensureProviderAccountRuntime.mockResolvedValue(undefined);
    mocks.setAllAgentsModel.mockResolvedValue(undefined);
    mocks.probeLocalProviderReadiness.mockResolvedValue({ ready: true, reason: 'ok', status: 200 });
  });

  it('returns the target session model without changing global provider defaults', async () => {
    mocks.listProviderAccounts.mockResolvedValue([
      makeAccount({ id: 'gemini-1', vendorId: 'google', model: 'gemini-2.5-pro' }),
      makeAccount({ id: 'ollama-local', vendorId: 'ollama', baseUrl: 'http://localhost:11434/v1', model: 'hermes3:8b' }),
    ]);
    mocks.getProvider.mockResolvedValue(
      makeProvider({ id: 'ollama-local', type: 'ollama', model: 'hermes3:8b', baseUrl: 'http://localhost:11434/v1' }),
    );

    const result = await prepareTransientChannelChange('on-device');

    expect(result).toMatchObject({
      channel: 'on-device',
      accountId: 'ollama-local',
      modelRef: 'ollama-ollama-local/hermes3:8b',
    });
    expect(mocks.ensureProviderAccountRuntime).toHaveBeenCalledWith('ollama-local');
    expect(mocks.getDefaultProvider).not.toHaveBeenCalled();
    expect(mocks.setDefaultProvider).not.toHaveBeenCalled();
    expect(mocks.syncDefaultProviderToRuntime).not.toHaveBeenCalled();
    expect(mocks.setAllAgentsModel).not.toHaveBeenCalled();
  });

  it('throws before any global write when the transient channel has no account', async () => {
    mocks.listProviderAccounts.mockResolvedValue([
      makeAccount({ id: 'gemini-1', vendorId: 'google', model: 'gemini-2.5-pro' }),
    ]);
    mocks.getProvider.mockResolvedValue(
      makeProvider({ id: 'gemini-1', type: 'google', model: 'gemini-2.5-pro' }),
    );

    await expect(prepareTransientChannelChange('on-device')).rejects.toThrow(
      /No provider account is configured for the "on-device" channel/,
    );
    expect(mocks.ensureProviderAccountRuntime).not.toHaveBeenCalled();
    expect(mocks.setDefaultProvider).not.toHaveBeenCalled();
    expect(mocks.setAllAgentsModel).not.toHaveBeenCalled();
  });
});

describe('channel-router read-only helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getOpenClawProviderKey.mockImplementation((type: string, id: string) => `${type}-${id}`);
  });

  it('listAvailableChannels reflects classification of all accounts', async () => {
    mocks.listProviderAccounts.mockResolvedValue([
      makeAccount({ id: 'ollama-local', vendorId: 'ollama', baseUrl: 'http://localhost:11434/v1' }),
      makeAccount({ id: 'gemini-1', vendorId: 'google' }),
    ]);

    const channels = await listAvailableChannels();
    expect(channels.sort()).toEqual(['on-device', 'online']);
  });

  it('getActiveChannel returns null when no default is set', async () => {
    mocks.getDefaultProvider.mockResolvedValue(undefined);
    await expect(getActiveChannel()).resolves.toBeNull();
  });

  it('getActiveChannel classifies the current default provider', async () => {
    mocks.getDefaultProvider.mockResolvedValue('gemini-1');
    mocks.getProvider.mockResolvedValue(makeProvider({ id: 'gemini-1', type: 'google' }));

    await expect(getActiveChannel()).resolves.toBe('online');
  });
});

describe('channel-router runChannelPreflight', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getOpenClawProviderKey.mockImplementation((type: string, id: string) => `${type}-${id}`);
    mocks.getProviderDefaultModel.mockReturnValue(undefined);
    mocks.getDefaultProvider.mockResolvedValue(undefined);
    mocks.setDefaultProvider.mockResolvedValue(undefined);
    mocks.syncDefaultProviderToRuntime.mockResolvedValue(undefined);
    mocks.ensureProviderAccountRuntime.mockResolvedValue(undefined);
    mocks.setAllAgentsModel.mockResolvedValue(undefined);
  });

  it('skips when no accounts exist', async () => {
    mocks.listProviderAccounts.mockResolvedValue([]);

    const result = await runChannelPreflight('online');
    expect(result).toMatchObject({ ran: false, reason: 'no-accounts' });
    expect(mocks.setAllAgentsModel).not.toHaveBeenCalled();
  });

  it('reconciles when desired channel is available', async () => {
    mocks.listProviderAccounts.mockResolvedValue([
      makeAccount({ id: 'gemini-1', vendorId: 'google', model: 'gemini-2.5-pro' }),
    ]);
    mocks.getProvider.mockResolvedValue(makeProvider({ id: 'gemini-1', type: 'google', model: 'gemini-2.5-pro' }));

    const result = await runChannelPreflight('online');
    expect(result.ran).toBe(true);
    expect(result.applied).toBe('online');
    expect(result.modelRef).toBe('google-gemini-1/gemini-2.5-pro');
    expect(mocks.setAllAgentsModel).toHaveBeenCalledWith('google-gemini-1/gemini-2.5-pro');
  });

  it('falls back to the available channel when desired is not configured', async () => {
    mocks.listProviderAccounts.mockResolvedValue([
      makeAccount({ id: 'ollama-local', vendorId: 'ollama', baseUrl: 'http://localhost:11434/v1', model: 'hermes3:8b' }),
    ]);
    mocks.getProvider.mockResolvedValue(
      makeProvider({ id: 'ollama-local', type: 'ollama', model: 'hermes3:8b', baseUrl: 'http://localhost:11434/v1' }),
    );

    const result = await runChannelPreflight('online');
    expect(result.ran).toBe(true);
    expect(result.reason).toBe('desired-unavailable');
    expect(result.applied).toBe('on-device');
    expect(result.modelRef).toBe('ollama-ollama-local/hermes3:8b');
  });

  it('can converge boot preflight stores without queueing a pre-start gateway refresh', async () => {
    const gateway = {} as never;
    mocks.listProviderAccounts.mockResolvedValue([
      makeAccount({ id: 'gemini-1', vendorId: 'google', model: 'gemini-2.5-pro' }),
    ]);
    mocks.getProvider.mockResolvedValue(makeProvider({ id: 'gemini-1', type: 'google', model: 'gemini-2.5-pro' }));

    await runChannelPreflight('online', gateway, { skipGatewayRefresh: true });

    expect(mocks.syncDefaultProviderToRuntime).toHaveBeenCalledWith('gemini-1', gateway, {
      skipGatewayRefresh: true,
    });
    expect(mocks.setAllAgentsModel).toHaveBeenCalledWith('google-gemini-1/gemini-2.5-pro');
  });

  it('uses an imported OpenClaw cloud account before an unready local fallback during boot preflight', async () => {
    mocks.listProviderAccounts.mockResolvedValue([
      makeAccount({ id: 'custom-moecloud', vendorId: 'custom', baseUrl: 'https://gateway.example.run.app/v1', model: 'moe-demo-pro', isDefault: true }),
      makeAccount({ id: 'ollama-local', vendorId: 'ollama', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:3b-instruct' }),
    ]);
    mocks.probeLocalProviderReadiness.mockResolvedValue({ ready: false, reason: 'connection-error' });
    mocks.getProvider.mockResolvedValue(makeProvider({
      id: 'custom-moecloud',
      type: 'custom',
      baseUrl: 'https://gateway.example.run.app/v1',
      model: 'moe-demo-pro',
    }));

    const result = await runChannelPreflight('online', undefined, { requireLocalReadiness: true });

    expect(result.ran).toBe(true);
    expect(result.applied).toBe('online');
    expect(result.accountId).toBe('custom-moecloud');
    expect(result.modelRef).toBe('custom-custom-moecloud/moe-demo-pro');
    expect(mocks.setDefaultProvider).toHaveBeenCalledWith('custom-moecloud');
    expect(mocks.setAllAgentsModel).toHaveBeenCalledWith('custom-custom-moecloud/moe-demo-pro');
  });

  it('ignores an unready local account during automatic boot preflight', async () => {
    mocks.listProviderAccounts.mockResolvedValue([
      makeAccount({ id: 'ollama-local', vendorId: 'ollama', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:3b-instruct' }),
    ]);
    mocks.probeLocalProviderReadiness.mockResolvedValue({ ready: false, reason: 'connection-error' });

    const result = await runChannelPreflight('online', undefined, { requireLocalReadiness: true });

    expect(result).toMatchObject({ ran: false, reason: 'no-ready-accounts', desired: 'online' });
    expect(mocks.setDefaultProvider).not.toHaveBeenCalled();
    expect(mocks.setAllAgentsModel).not.toHaveBeenCalled();
  });

  it('preserves explicit on-device intent instead of silently applying Online during boot', async () => {
    mocks.listProviderAccounts.mockResolvedValue([
      makeAccount({ id: 'gemini-1', vendorId: 'google', model: 'gemini-2.5-pro' }),
      makeAccount({ id: 'ollama-local', vendorId: 'ollama', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:3b-instruct' }),
    ]);
    mocks.probeLocalProviderReadiness.mockImplementation(async (options: { modelId?: string }) => (
      options.modelId === 'qwen2.5:3b-instruct'
        ? { ready: false, reason: 'connection-error' }
        : { ready: true, reason: 'ok', status: 200 }
    ));

    const result = await runChannelPreflight('on-device', undefined, {
      allowChannelFallback: false,
      requireLocalReadiness: true,
    });

    expect(result).toMatchObject({ ran: false, reason: 'desired-unavailable', desired: 'on-device' });
    expect(mocks.setDefaultProvider).not.toHaveBeenCalledWith('gemini-1');
    expect(mocks.setAllAgentsModel).not.toHaveBeenCalled();
  });
});
