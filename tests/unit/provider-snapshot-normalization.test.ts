import { beforeEach, describe, expect, it, vi } from 'vitest';

// CLWX-91: a Host API answering 200 with a NON-ARRAY body on a list endpoint
// (version skew, error object, or the e2e mock fallback `{}`) must degrade to
// an empty list. Before the fix, `{}` flowed into the provider store and the
// first `accounts.filter(...)` inside a render-path useMemo (ChatInput's
// pickAccountForChannel) threw, tripping the app error boundary — the whole
// window blanked and `main-layout` never rendered.

const mockHostApiFetch = vi.fn();
vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => mockHostApiFetch(...args),
}));

import { fetchProviderSnapshot } from '@/lib/provider-accounts';
import { pickAccountForChannel } from '@/lib/provider-display';

function mockRoutes(routes: Record<string, unknown>) {
  mockHostApiFetch.mockImplementation(async (path: string) => {
    if (path in routes) return routes[path];
    return {};
  });
}

describe('fetchProviderSnapshot – non-array payload normalization (CLWX-91)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('coerces `{}` bodies on every list endpoint to empty arrays instead of poisoning the snapshot', async () => {
    // The exact hostile input: the e2e ipc-mock fallback answers every
    // unmocked route with `{ status: 200, ok: true, json: {} }`.
    mockRoutes({
      '/api/provider-accounts': {},
      '/api/provider-accounts/key-info': {},
      '/api/provider-vendors': {},
      '/api/provider-accounts/default': {},
      '/api/providers': {},
    });

    const snapshot = await fetchProviderSnapshot();

    expect(Array.isArray(snapshot.accounts)).toBe(true);
    expect(snapshot.accounts).toEqual([]);
    expect(Array.isArray(snapshot.vendors)).toBe(true);
    expect(snapshot.vendors).toEqual([]);
    expect(Array.isArray(snapshot.statuses)).toBe(true);
    expect(snapshot.defaultAccountId).toBeNull();

    // The downstream render-path call that used to throw
    // "e.filter is not a function" must now be safe end-to-end.
    expect(() => pickAccountForChannel(snapshot.accounts, 'online')).not.toThrow();
    expect(pickAccountForChannel(snapshot.accounts, 'online')).toBeNull();
  });

  it('warns (does not throw) when a list endpoint returns a truthy non-array body', async () => {
    mockRoutes({
      '/api/provider-accounts': { success: false, error: 'skewed host API' },
      '/api/provider-accounts/key-info': [],
      '/api/provider-vendors': { unexpected: true },
      '/api/provider-accounts/default': { accountId: null },
    });

    const snapshot = await fetchProviderSnapshot();

    expect(snapshot.accounts).toEqual([]);
    expect(snapshot.vendors).toEqual([]);
    const warned = (console.warn as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    expect(warned.some((w) => w.includes('/api/provider-accounts'))).toBe(true);
    expect(warned.some((w) => w.includes('/api/provider-vendors'))).toBe(true);
  });

  it('passes well-formed array payloads through untouched', async () => {
    const account = {
      id: 'acc-1',
      vendorId: 'anthropic',
      label: 'Main',
      authMode: 'api_key',
      enabled: true,
      isDefault: true,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    };
    mockRoutes({
      '/api/provider-accounts': [account],
      '/api/provider-accounts/key-info': [{ accountId: 'acc-1', hasKey: true, keyMasked: 'sk-***' }],
      '/api/provider-vendors': [{ id: 'anthropic', displayName: 'Anthropic' }],
      '/api/provider-accounts/default': { accountId: 'acc-1' },
    });

    const snapshot = await fetchProviderSnapshot();

    expect(snapshot.accounts).toHaveLength(1);
    expect(snapshot.accounts[0].id).toBe('acc-1');
    expect(snapshot.vendors).toHaveLength(1);
    expect(snapshot.defaultAccountId).toBe('acc-1');
    expect(console.warn).not.toHaveBeenCalled();
  });
});
