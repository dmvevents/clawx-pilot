import { mkdir, readdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// CLWX-139: the runtime refuses every auth lookup while a retired credential file
// exists next to a store its per-agent diagnostic cannot see into. These tests pin
// the properties that made the defect invisible to the previous 107 green tests:
// the retired file is never written, it is removed before the readback, the
// readback goes through the runtime, and a failed readback restores the file.

const testHome = join(tmpdir(), 'clawx-openclaw-auth-store-test-home');

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, default: { ...actual, homedir: () => testHome }, homedir: () => testHome };
});

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => join(testHome, 'userData') },
}));

const agentDir = join(testHome, '.openclaw', 'agents', 'main', 'agent');
const retiredFile = join(agentDir, 'auth-profiles.json');

type Sdk = import('@electron/utils/openclaw-auth-store').OpenClawAuthSdk;

function makeSdk(overrides: Partial<Sdk> = {}): Sdk & { store: Map<string, string> } {
  const store = new Map<string, string>();
  const sdk: Sdk & { store: Map<string, string> } = {
    store,
    upsertApiKeyProfile: vi.fn(({ provider, input, profileId }) => {
      const id = profileId ?? `${provider}:default`;
      store.set(`${provider}|${id}`, input);
      return id;
    }),
    writeOAuthCredentials: vi.fn(async (provider, creds) => {
      store.set(`${provider}|${provider}:default`, String((creds as { access: string }).access));
      return `${provider}:default`;
    }),
    applyAuthProfileConfig: vi.fn((cfg, params) => ({
      ...cfg,
      auth: {
        ...(cfg.auth as Record<string, unknown> | undefined),
        profiles: {
          ...((cfg.auth as { profiles?: Record<string, unknown> } | undefined)?.profiles ?? {}),
          [params.profileId]: { provider: params.provider, mode: params.mode },
        },
      },
    })),
    removeProviderAuthProfilesWithLock: vi.fn(async ({ provider }) => {
      for (const key of [...store.keys()]) if (key.startsWith(`${provider}|`)) store.delete(key);
      return null;
    }),
    removeAuthProfileConfig: vi.fn((cfg) => cfg),
    // The fake runtime behaves like 2026.9.2: a retired file next to the store
    // refuses resolution regardless of what the store holds.
    resolveApiKeyForProvider: vi.fn(async ({ provider }) => {
      const { existsSync } = await import('fs');
      if (existsSync(retiredFile)) {
        throw new Error('Auth profile store requires legacy credential migration; run openclaw doctor --fix.');
      }
      for (const [key, value] of store) if (key.startsWith(`${provider}|`)) return { apiKey: value, source: 'profile' };
      throw new Error(`No API key found for provider "${provider}".`);
    }),
    isProviderAuthError: vi.fn(() => true),
    ...overrides,
  };
  return sdk;
}

async function writeConfig(config: unknown): Promise<void> {
  await mkdir(join(testHome, '.openclaw'), { recursive: true });
  await writeFile(join(testHome, '.openclaw', 'openclaw.json'), JSON.stringify(config, null, 2), 'utf8');
}

describe('openclaw-auth-store', () => {
  beforeEach(async () => {
    vi.resetModules();
    await rm(testHome, { recursive: true, force: true });
    await mkdir(agentDir, { recursive: true });
    await writeConfig({ models: { providers: {} } });
  });

  it('writes through the runtime SDK, archives the retired file, and proves the readback', async () => {
    await writeFile(retiredFile, JSON.stringify({ version: 1, profiles: {} }), 'utf8');
    const sdk = makeSdk();
    const { upsertProviderApiKey } = await import('@electron/utils/openclaw-auth-store');

    const result = await upsertProviderApiKey({ provider: 'custom-moecloud', apiKey: 'k-1', sdk });

    expect(sdk.upsertApiKeyProfile).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'custom-moecloud',
      input: 'k-1',
      agentDir,
      profileId: 'custom-moecloud:default',
    }));
    expect(result).toEqual({ profileId: 'custom-moecloud:default', source: 'profile', archived: ['auth-profiles.json'] });

    const files = await readdir(agentDir);
    expect(files).not.toContain('auth-profiles.json');
    expect(files.some((f) => f.startsWith('auth-profiles.json.clawx-retired-'))).toBe(true);

    // The readback ran after the archive, through the runtime, for this agent.
    expect(sdk.resolveApiKeyForProvider).toHaveBeenCalledWith(expect.objectContaining({ provider: 'custom-moecloud', agentDir }));

    // The runtime's auth-profile config entry landed in openclaw.json via the canonical writer.
    const cfg = JSON.parse(await readFile(join(testHome, '.openclaw', 'openclaw.json'), 'utf8')) as {
      auth: { profiles: Record<string, unknown> };
    };
    expect(cfg.auth.profiles['custom-moecloud:default']).toEqual({ provider: 'custom-moecloud', mode: 'api_key' });
  });

  it('never creates the retired file, even when the agent directory is empty', async () => {
    const sdk = makeSdk();
    const { upsertProviderApiKey } = await import('@electron/utils/openclaw-auth-store');

    await upsertProviderApiKey({ provider: 'custom-moecloud', apiKey: 'k-1', sdk });

    expect(await readdir(agentDir)).toEqual([]);
  });

  it('restores the archived file and throws a typed error when the runtime cannot read the credential back', async () => {
    await writeFile(retiredFile, JSON.stringify({ version: 1, profiles: { keep: 'me' } }), 'utf8');
    const sdk = makeSdk({
      resolveApiKeyForProvider: vi.fn(async () => {
        throw new Error('No API key found for provider "custom-moecloud".');
      }),
    });
    const { upsertProviderApiKey, CredentialUnreadableError } = await import('@electron/utils/openclaw-auth-store');

    await expect(upsertProviderApiKey({ provider: 'custom-moecloud', apiKey: 'k-1', sdk }))
      .rejects.toBeInstanceOf(CredentialUnreadableError);

    // The only copy of the credential was never destroyed.
    expect(await readdir(agentDir)).toEqual(['auth-profiles.json']);
    expect(JSON.parse(await readFile(retiredFile, 'utf8'))).toEqual({ version: 1, profiles: { keep: 'me' } });
  });

  it('reads back exactly as a turn resolves: null while a retired file is present', async () => {
    await writeFile(retiredFile, '{}', 'utf8');
    const sdk = makeSdk();
    sdk.store.set('custom-moecloud|custom-moecloud:default', 'k-1');
    const { readbackProviderApiKey } = await import('@electron/utils/openclaw-auth-store');

    expect(await readbackProviderApiKey({ provider: 'custom-moecloud', sdk })).toBeNull();

    await rm(retiredFile);
    expect(await readbackProviderApiKey({ provider: 'custom-moecloud', sdk })).toEqual({ apiKey: 'k-1', source: 'profile' });
  });

  it('removes credentials through the SDK and sweeps any retired file', async () => {
    await writeFile(retiredFile, '{}', 'utf8');
    const sdk = makeSdk();
    sdk.store.set('custom-moecloud|custom-moecloud:default', 'k-1');
    const { removeProviderCredentials } = await import('@electron/utils/openclaw-auth-store');

    await removeProviderCredentials({ provider: 'custom-moecloud', sdk });

    expect(sdk.removeProviderAuthProfilesWithLock).toHaveBeenCalledWith({ provider: 'custom-moecloud', agentDir });
    expect(sdk.store.size).toBe(0);
    expect((await readdir(agentDir)).includes('auth-profiles.json')).toBe(false);
  });
});
