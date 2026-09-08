// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ shell: { openExternal: vi.fn() } }));
vi.mock('../../electron/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../electron/utils/microsoft-graph-oauth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../electron/utils/microsoft-graph-oauth')>();
  return {
    ...actual,
    loginMicrosoftGraphOAuth: vi.fn(),
    refreshMicrosoftGraphToken: vi.fn(),
  };
});
vi.mock('../../electron/services/microsoft-graph/store', () => ({
  getMicrosoftGraphConfig: vi.fn(),
  getMicrosoftGraphAccount: vi.fn(),
  getMicrosoftGraphSecret: vi.fn(),
  getMockMailboxEnabled: vi.fn(async () => false),
  setMicrosoftGraphAccount: vi.fn(),
  setMicrosoftGraphSecret: vi.fn(),
  clearMicrosoftGraph: vi.fn(),
}));

import { getAccessToken } from '../../electron/services/microsoft-graph/manager';
import { refreshMicrosoftGraphToken } from '../../electron/utils/microsoft-graph-oauth';
import {
  getMicrosoftGraphConfig,
  getMicrosoftGraphSecret,
} from '../../electron/services/microsoft-graph/store';

const mockConfig = vi.mocked(getMicrosoftGraphConfig);
const mockSecret = vi.mocked(getMicrosoftGraphSecret);
const mockRefresh = vi.mocked(refreshMicrosoftGraphToken);

describe('getAccessToken refresh failure classification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.mockResolvedValue({ tenantId: 'tenant-1', clientId: 'client-1' });
    mockSecret.mockResolvedValue({
      access: 'stale-access',
      refresh: 'stale-refresh',
      expires: Date.now() - 1_000, // already expired → forces a refresh
      scope: 'User.Read Mail.Read offline_access',
    });
  });

  it('maps a Microsoft-rejected refresh (invalid_grant) to AUTH_REQUIRED', async () => {
    const rejected = new Error('Microsoft token refresh failed (400): invalid_grant');
    (rejected as Error & { oauthError?: string }).oauthError = 'invalid_grant';
    mockRefresh.mockRejectedValue(rejected);

    await expect(getAccessToken()).rejects.toMatchObject({
      name: 'MicrosoftGraphAuthRequired',
    });
  });

  it('keeps transient refresh failures as plain errors (no forced re-sign-in)', async () => {
    mockRefresh.mockRejectedValue(new Error('Microsoft token refresh failed (503): retry later'));

    await expect(getAccessToken()).rejects.toMatchObject({
      name: 'Error',
      message: expect.stringContaining('503'),
    });
  });
});
