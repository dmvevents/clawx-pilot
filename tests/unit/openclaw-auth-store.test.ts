import { existsSync } from 'fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// CLWX-139: the runtime refuses every auth lookup while a retired credential file
// exists next to a store its per-agent diagnostic cannot see into. These tests pin
// the properties that made the defect invisible to the previous 107 green tests:
// the retired file is never written, it is moved aside before any SDK call, the
// readback goes through the runtime, and a failed readback keeps the archive (never
// puts the file back, which would refuse every provider).

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
    upsertAuthProfileWithLock: vi.fn(async ({ profileId, credential }) => {
      // Like the real writer, refuse while a retired file exists: the migration guard
      // runs inside the SDK's store load, before any write.
      if (existsSync(retiredFile)) {
        throw new Error('Auth profile store requires legacy credential migration; run openclaw doctor --fix.');
      }
      store.set(`${credential.provider}|${profileId}`, credential.key);
      return { profiles: {} };
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
    ensureAuthProfileStore: vi.fn(() => ({
      profiles: Object.fromEntries([...store.keys()].map((k) => {
        const [provider, id] = k.split('|');
        return [id, { type: id.endsWith(':oauth') ? 'oauth' : 'api_key', provider }];
      })),
    })),
    // The fake runtime behaves like 2026.9.2: a retired file next to the store
    // refuses resolution regardless of what the store holds.
    resolveApiKeyForProvider: vi.fn(async ({ provider }) => {
      if (existsSync(retiredFile)) {
        throw new Error('Auth profile store requires legacy credential migration; run openclaw doctor --fix.');
      }
      for (const [key, value] of store) if (key.startsWith(`${provider}|`)) return { apiKey: value, source: 'profile', profileId: key.split('|')[1] };
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

    expect(sdk.upsertAuthProfileWithLock).toHaveBeenCalledWith({
      profileId: 'custom-moecloud:default',
      credential: { type: 'api_key', provider: 'custom-moecloud', key: 'k-1' },
      agentDir,
    });
    expect(result).toEqual({ profileId: 'custom-moecloud:default', source: 'profile', archived: ['auth-profiles.json'], carried: [] });

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

  it('keeps the retired file archived and throws a typed error when the runtime cannot read the credential back', async () => {
    await writeFile(retiredFile, JSON.stringify({ version: 1, profiles: { keep: 'me' } }), 'utf8');
    const sdk = makeSdk({
      resolveApiKeyForProvider: vi.fn(async () => {
        throw new Error('No API key found for provider "custom-moecloud".');
      }),
    });
    const { upsertProviderApiKey, CredentialUnreadableError } = await import('@electron/utils/openclaw-auth-store');

    await expect(upsertProviderApiKey({ provider: 'custom-moecloud', apiKey: 'k-1', sdk }))
      .rejects.toBeInstanceOf(CredentialUnreadableError);

    // Not restored: putting the retired file back would refuse every provider. The
    // copy is kept by name for recovery.
    const files = await readdir(agentDir);
    expect(files).not.toContain('auth-profiles.json');
    const kept = files.find((f) => f.startsWith('auth-profiles.json.clawx-retired-'));
    expect(kept).toBeDefined();
    expect(JSON.parse(await readFile(join(agentDir, kept!), 'utf8'))).toEqual({ version: 1, profiles: { keep: 'me' } });
  });

  it('also archives the shared credentials/oauth.json for the main agent', async () => {
    const sharedDir = join(testHome, '.openclaw', 'credentials');
    await mkdir(sharedDir, { recursive: true });
    await writeFile(join(sharedDir, 'oauth.json'), '{}', 'utf8');
    const sdk = makeSdk();
    const { upsertProviderApiKey } = await import('@electron/utils/openclaw-auth-store');

    const result = await upsertProviderApiKey({ provider: 'custom-moecloud', apiKey: 'k-1', sdk });

    expect(result.archived).toEqual(['oauth.json']);
    expect((await readdir(sharedDir)).some((f) => f.startsWith('oauth.json.clawx-retired-'))).toBe(true);
  });

  it('status reads report pending migration (null) without touching the SDK or the file while a retired file exists', async () => {
    await writeFile(retiredFile, '{}', 'utf8');
    const sdk = makeSdk();
    sdk.store.set('custom-moecloud|custom-moecloud:default', 'k-1');
    const { readbackProviderApiKey } = await import('@electron/utils/openclaw-auth-store');

    expect(await readbackProviderApiKey({ provider: 'custom-moecloud', sdk })).toBeNull();
    expect(sdk.resolveApiKeyForProvider).not.toHaveBeenCalled();
    expect(await readdir(agentDir)).toEqual(['auth-profiles.json']); // not archived by a read

    await rm(retiredFile);
    expect(await readbackProviderApiKey({ provider: 'custom-moecloud', sdk })).toEqual({ apiKey: 'k-1', source: 'profile', profileId: 'custom-moecloud:default' });
    sdk.store.clear();
    expect(await readbackProviderApiKey({ provider: 'custom-moecloud', sdk })).toBeNull();
  });

  it('a write also clears the main agent\'s retired files when operating on a secondary agent (the SDK merges inherited main credentials)', async () => {
    await writeFile(retiredFile, '{}', 'utf8'); // main agent's file
    const workDir = join(testHome, '.openclaw', 'agents', 'work', 'agent');
    await mkdir(workDir, { recursive: true });
    const sdk = makeSdk();
    const { upsertProviderApiKey } = await import('@electron/utils/openclaw-auth-store');

    const result = await upsertProviderApiKey({ provider: 'custom-moecloud', apiKey: 'k-1', agentId: 'work', sdk });

    expect(result.archived).toEqual(['auth-profiles.json']);
    expect((await readdir(agentDir)).includes('auth-profiles.json')).toBe(false);
  });

  it('fails typed when the runtime writer returns null, and when the readback resolves a different profile', async () => {
    const { upsertProviderApiKey, CredentialUnreadableError } = await import('@electron/utils/openclaw-auth-store');
    const nullWriter = makeSdk({ upsertAuthProfileWithLock: vi.fn(async () => null) });
    await expect(upsertProviderApiKey({ provider: 'custom-moecloud', apiKey: 'k-1', sdk: nullWriter })).rejects.toBeInstanceOf(CredentialUnreadableError);

    const wrongProfile = makeSdk({ resolveApiKeyForProvider: vi.fn(async () => ({ apiKey: 'old', source: 'profile', profileId: 'custom-moecloud:backup' })) });
    await expect(upsertProviderApiKey({ provider: 'custom-moecloud', apiKey: 'k-1', sdk: wrongProfile })).rejects.toThrow(/instead of the written profile/);
  });

  it('carries other providers\' API keys from the app\'s own retired file into the runtime store before archiving it', async () => {
    await writeFile(retiredFile, JSON.stringify({ version: 1, profiles: {
      'anthropic:default': { type: 'api_key', provider: 'anthropic', key: 'sk-ant' },
      'openai-codex:default': { type: 'oauth', provider: 'openai-codex', access: 'a', refresh: 'r', expires: 1 },
      'custom-moecloud:default': { type: 'api_key', provider: 'custom-moecloud', key: 'stale' },
    } }), 'utf8');
    const sdk = makeSdk();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { upsertProviderApiKey } = await import('@electron/utils/openclaw-auth-store');

    const result = await upsertProviderApiKey({ provider: 'custom-moecloud', apiKey: 'k-1', sdk });

    expect(result.carried).toEqual(['anthropic:default']);
    expect(sdk.store.get('anthropic|anthropic:default')).toBe('sk-ant');
    expect(sdk.store.get('custom-moecloud|custom-moecloud:default')).toBe('k-1'); // ours, not the stale one
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('openai-codex:default'));
    warn.mockRestore();
  });

  it('carries main\'s legacy keys even when a secondary agent operates first, never overwrites a current credential, and does not count a null write', async () => {
    await writeFile(retiredFile, JSON.stringify({ version: 1, profiles: {
      'anthropic:default': { type: 'api_key', provider: 'anthropic', key: 'legacy-ant' },
      'gemini:default': { type: 'api_key', provider: 'gemini', key: 'legacy-gem' },
    } }), 'utf8'); // main agent's retired file
    const workDir = join(testHome, '.openclaw', 'agents', 'work', 'agent');
    await mkdir(workDir, { recursive: true });
    const sdk = makeSdk();
    sdk.store.set('anthropic|anthropic:default', 'current-ant'); // already in the store: must win
    const upsert = sdk.upsertAuthProfileWithLock as ReturnType<typeof vi.fn>;
    const original = upsert.getMockImplementation()!;
    upsert.mockImplementation(async (params: { profileId: string; credential: { provider: string; key: string } }) => {
      if (params.credential.provider === 'gemini') return null; // the runtime did not persist this one
      return original(params);
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { upsertProviderApiKey } = await import('@electron/utils/openclaw-auth-store');

    const result = await upsertProviderApiKey({ provider: 'custom-moecloud', apiKey: 'k-1', agentId: 'work', sdk });

    expect(result.archived).toEqual(['auth-profiles.json']); // main's file, archived by the secondary-agent write
    expect(result.carried).toEqual([]); // anthropic skipped (current wins), gemini not persisted
    expect(sdk.store.get('anthropic|anthropic:default')).toBe('current-ant');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('gemini:default'));
    warn.mockRestore();
  });

  it('refuses to report a removal as done when the targeted profiles are still in the runtime store', async () => {
    const sdk = makeSdk({ removeProviderAuthProfilesWithLock: vi.fn(async () => null) }); // does not delete
    sdk.store.set('custom-moecloud|custom-moecloud:default', 'k-1');
    const { removeProviderCredentials, CredentialRemovalError } = await import('@electron/utils/openclaw-auth-store');

    await expect(removeProviderCredentials({ provider: 'custom-moecloud', sdk })).rejects.toBeInstanceOf(CredentialRemovalError);
    expect(sdk.removeAuthProfileConfig).not.toHaveBeenCalled();
  });
});
