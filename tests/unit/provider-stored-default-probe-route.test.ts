import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';

const mocks = vi.hoisted(() => ({
  providerService: {
    getDefaultAccountId: vi.fn(),
    listAccounts: vi.fn(),
    getAccount: vi.fn(),
    getEffectiveAccountApiKey: vi.fn(),
    listVendors: vi.fn(),
    createAccount: vi.fn(),
    setDefaultAccount: vi.fn(),
    listAccountsKeyInfo: vi.fn(),
  },
  validateApiKeyWithProvider: vi.fn(),
  sendJson: vi.fn(),
}));

vi.mock('@electron/services/providers/provider-service', () => ({
  getProviderService: () => mocks.providerService,
}));

vi.mock('@electron/services/providers/provider-validation', () => ({
  validateApiKeyWithProvider: mocks.validateApiKeyWithProvider,
}));

vi.mock('@electron/api/route-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@electron/api/route-utils')>();
  return { ...actual, sendJson: mocks.sendJson };
});

vi.mock('@electron/utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { handleProviderRoutes } from '@electron/api/routes/providers';

const ONLINE_ACCOUNT = {
  id: 'google',
  vendorId: 'google',
  label: 'Google',
  authMode: 'api_key',
  model: 'gemini-2.5-pro',
  isDefault: true,
};
const LOCAL_ACCOUNT = {
  id: 'ollama',
  vendorId: 'ollama',
  label: 'Ollama',
  authMode: 'api_key',
  baseUrl: 'http://127.0.0.1:11434',
  model: 'qwen2.5:3b-instruct',
  isDefault: true,
};

function callProbe(): Promise<boolean> {
  return handleProviderRoutes(
    { method: 'GET' } as IncomingMessage,
    {} as ServerResponse,
    new URL('http://127.0.0.1:13210/api/provider-accounts/default/probe'),
    {} as never,
  );
}

function lastPayload<T extends Record<string, unknown> = Record<string, unknown>>(): T {
  const [, , payload] = mocks.sendJson.mock.calls.at(-1) as [unknown, number, T];
  return payload;
}

describe('GET /api/provider-accounts/default/probe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.providerService.getDefaultAccountId.mockResolvedValue('google');
    mocks.providerService.listAccounts.mockResolvedValue([ONLINE_ACCOUNT]);
    mocks.providerService.getAccount.mockResolvedValue(ONLINE_ACCOUNT);
    mocks.providerService.getEffectiveAccountApiKey.mockResolvedValue('sk-from-openclaw-or-store');
    mocks.validateApiKeyWithProvider.mockResolvedValue({ valid: true, status: 200 });
  });

  it('proves the stored default Online account only after a strict 2xx authenticated probe', async () => {
    await expect(callProbe()).resolves.toBe(true);

    expect(mocks.providerService.getEffectiveAccountApiKey).toHaveBeenCalledWith(ONLINE_ACCOUNT);
    expect(mocks.validateApiKeyWithProvider).toHaveBeenCalledWith('google', 'sk-from-openclaw-or-store', expect.objectContaining({
      quiet: true,
      signal: expect.any(AbortSignal),
    }));
    expect(mocks.sendJson).toHaveBeenCalledWith(expect.anything(), 200, {
      success: true,
      valid: true,
      accountId: 'google',
      channel: 'online',
      status: 200,
      reason: 'ok',
    });
  });

  it('rejects auth-valid but unavailable responses such as 429 for recovery', async () => {
    mocks.validateApiKeyWithProvider.mockResolvedValue({ valid: true, status: 429 });

    await callProbe();

    expect(lastPayload()).toMatchObject({ success: true, valid: false, accountId: 'google', channel: 'online', status: 429, reason: 'unavailable' });
  });

  it('rejects local defaults before reading or validating a credential', async () => {
    mocks.providerService.getDefaultAccountId.mockResolvedValue('ollama');
    mocks.providerService.listAccounts.mockResolvedValue([LOCAL_ACCOUNT]);

    await callProbe();

    expect(mocks.providerService.getEffectiveAccountApiKey).not.toHaveBeenCalled();
    expect(mocks.validateApiKeyWithProvider).not.toHaveBeenCalled();
    expect(lastPayload()).toMatchObject({ success: true, valid: false, accountId: 'ollama', channel: 'on-device', status: null, reason: 'offline-channel' });
  });

  it('rejects a default account change that happens while the probe is in flight', async () => {
    mocks.providerService.getDefaultAccountId
      .mockResolvedValueOnce('google')
      .mockResolvedValueOnce('anthropic');

    await callProbe();

    expect(lastPayload()).toMatchObject({ success: true, valid: false, accountId: 'google', channel: 'online', status: 200, reason: 'changed-default' });
  });

  it('sanitizes unexpected service failures before validation starts', async () => {
    mocks.providerService.getDefaultAccountId.mockRejectedValue(new Error('boom sk-secret https://api.example.test'));

    await callProbe();

    const payload = lastPayload();
    expect(payload).toEqual({
      success: true,
      valid: false,
      accountId: null,
      channel: null,
      status: null,
      reason: 'probe-error',
    });
    expect(JSON.stringify(payload)).not.toContain('sk-secret');
    expect(JSON.stringify(payload)).not.toContain('api.example.test');
  });

  it('returns a sanitized failure instead of upstream error details', async () => {
    mocks.validateApiKeyWithProvider.mockResolvedValue({ valid: false, status: 401, error: 'Invalid API key: sk-secret at https://api.example.test/v1/models' });

    await callProbe();

    const payload = lastPayload();
    expect(payload).toEqual({
      success: true,
      valid: false,
      accountId: 'google',
      channel: 'online',
      status: 401,
      reason: 'unavailable',
    });
    expect(JSON.stringify(payload)).not.toContain('sk-secret');
    expect(JSON.stringify(payload)).not.toContain('api.example.test');
  });
});
