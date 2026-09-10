/**
 * Provider credentials for the bundled OpenClaw runtime.
 *
 * The runtime owns its credential store. Since openclaw 2026.9.2 that store is
 * SQLite and `auth-profiles.json` is a retired file: while it exists in an agent
 * directory whose per-agent store the runtime's diagnostic cannot see into, every
 * auth lookup — including the runtime's own SDK writer and reader — fails closed
 * before env or config is consulted, and a turn is refused with "requires legacy
 * credential migration" (CLWX-139). That refusal is cached per store for the life
 * of the process. The app used to compose that file on every boot, which also undid
 * any `doctor --fix` migration.
 *
 * This module therefore never writes the runtime's files itself, and it moves any
 * retired file out of the way BEFORE touching the SDK, so the guard is never armed
 * in this process. It writes through the runtime's supported SDK writer, then proves
 * the result by resolving the key back through the runtime — the same code path a
 * turn uses. A write that cannot be read back restores the archived file and is
 * reported as a typed failure, so an install is never left without its only copy of
 * a credential. Files are renamed, never deleted.
 *
 * The SDK is loaded from the bundled runtime directory (see openclaw-sdk.ts for why a
 * static import cannot work from inside the asar), so the writer and the gateway are
 * always the same openclaw version.
 */
import { createRequire } from 'module';
import { homedir } from 'os';
import { basename, join } from 'node:path';
import { access, rename } from 'node:fs/promises';
import { getOpenClawDir, getOpenClawResolvedDir } from './paths';
import { readOpenClawConfig, writeOpenClawConfig } from './channel-config';
import { withConfigLock } from './config-mutex';

/** Files the runtime treats as retired credential sources (`resolveLegacyAuthProfileSourceCandidates`). */
export const RETIRED_AUTH_FILES = ['auth-profiles.json', 'auth-state.json', 'auth.json'] as const;

export const MAIN_AGENT_ID = 'main';

type RuntimeConfig = Record<string, unknown>;

export interface ResolvedRuntimeApiKey {
  apiKey?: string;
  source?: string;
  profileId?: string;
  mode?: string;
}

export interface RuntimeAuthProfileStore {
  profiles: Record<string, { type?: string; provider?: string } & Record<string, unknown>>;
}

export interface OpenClawAuthSdk {
  upsertApiKeyProfile(params: {
    provider: string;
    input: string;
    agentDir?: string;
    profileId?: string;
    options?: { config?: RuntimeConfig };
  }): string;
  writeOAuthCredentials(
    provider: string,
    creds: Record<string, unknown>,
    agentDir?: string,
    options?: { profileName?: string; syncSiblingAgents?: boolean },
  ): Promise<string>;
  applyAuthProfileConfig(
    cfg: RuntimeConfig,
    params: { profileId: string; provider: string; mode: 'api_key' | 'oauth' },
  ): RuntimeConfig;
  ensureAuthProfileStore(agentDir?: string): RuntimeAuthProfileStore;
  removeProviderAuthProfilesWithLock(params: { provider: string; agentDir?: string; profileIds?: string[] }): Promise<unknown>;
  removeAuthProfileConfig(cfg: RuntimeConfig, profileId: string): RuntimeConfig;
  resolveApiKeyForProvider(params: { provider: string; cfg: RuntimeConfig; agentDir?: string }): Promise<ResolvedRuntimeApiKey>;
  isProviderAuthError(error: unknown): boolean;
}

export class OpenClawAuthSdkUnavailableError extends Error {
  readonly code = 'OPENCLAW_AUTH_SDK_UNAVAILABLE';
  constructor(detail: string) {
    super(`The bundled OpenClaw runtime does not expose its credential SDK (${detail}). Credentials cannot be stored in a form the runtime reads.`);
    this.name = 'OpenClawAuthSdkUnavailableError';
  }
}

export class CredentialUnreadableError extends Error {
  readonly code = 'CREDENTIAL_UNREADABLE';
  constructor(
    readonly provider: string,
    readonly agentId: string,
    readonly runtimeMessage: string,
  ) {
    super(`Credential for provider "${provider}" (agent ${agentId}) is not readable by the runtime: ${runtimeMessage}`);
    this.name = 'CredentialUnreadableError';
  }
}

export class CredentialRemovalError extends Error {
  readonly code = 'CREDENTIAL_REMOVAL_FAILED';
  constructor(
    readonly provider: string,
    readonly agentId: string,
    detail: string,
  ) {
    super(`Credential for provider "${provider}" (agent ${agentId}) was not removed: ${detail}`);
    this.name = 'CredentialRemovalError';
  }
}

let cachedSdk: OpenClawAuthSdk | null = null;

function pick<T>(mod: Record<string, unknown>, name: string): T {
  const value = mod[name];
  if (typeof value !== 'function') {
    throw new OpenClawAuthSdkUnavailableError(`missing export ${name}`);
  }
  return value as T;
}

/**
 * Load the runtime's credential SDK from the bundled openclaw directory. Lazy so
 * that importing this module never fails in environments without a bundle (unit
 * tests inject a fake through `sdk`).
 */
export function loadOpenClawAuthSdk(): OpenClawAuthSdk {
  if (cachedSdk) return cachedSdk;
  const load = (subpath: string): Record<string, unknown> => {
    const errors: string[] = [];
    for (const base of [getOpenClawResolvedDir(), getOpenClawDir()]) {
      try {
        return createRequire(join(base, 'package.json'))(subpath) as Record<string, unknown>;
      } catch (error) {
        errors.push(`${base}: ${(error as Error).message}`);
      }
    }
    throw new OpenClawAuthSdkUnavailableError(`${subpath} not resolvable — ${errors.join('; ')}`);
  };
  const auth = load('openclaw/plugin-sdk/provider-auth');
  const runtime = load('openclaw/plugin-sdk/provider-auth-runtime');
  cachedSdk = {
    upsertApiKeyProfile: pick(auth, 'upsertApiKeyProfile'),
    writeOAuthCredentials: pick(auth, 'writeOAuthCredentials'),
    applyAuthProfileConfig: pick(auth, 'applyAuthProfileConfig'),
    ensureAuthProfileStore: pick(auth, 'ensureAuthProfileStore'),
    removeProviderAuthProfilesWithLock: pick(auth, 'removeProviderAuthProfilesWithLock'),
    removeAuthProfileConfig: pick(runtime, 'removeAuthProfileConfig'),
    resolveApiKeyForProvider: pick(runtime, 'resolveApiKeyForProvider'),
    isProviderAuthError: pick(runtime, 'isProviderAuthError'),
  };
  return cachedSdk;
}

/** Test seam: replace or clear the cached SDK. */
export function setOpenClawAuthSdkForTesting(sdk: OpenClawAuthSdk | null): void {
  cachedSdk = sdk;
}

export function getAgentDir(agentId: string = MAIN_AGENT_ID): string {
  return join(homedir(), '.openclaw', 'agents', agentId, 'agent');
}

export function defaultProfileId(provider: string): string {
  return `${provider}:default`;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export interface ArchivedFile {
  from: string;
  to: string;
}

/**
 * Move every retired credential file out of the agent directory, all-or-nothing.
 * Renamed, never deleted: a file may hold the only copy of a credential until the
 * readback proves the store has it. If one rename fails, the ones already moved are
 * put back and the failure is raised. Doctor's own `.migrated-*` archives are left alone.
 */
export async function archiveRetiredAuthFiles(agentDir: string, now: Date = new Date()): Promise<ArchivedFile[]> {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const archived: ArchivedFile[] = [];
  for (const name of RETIRED_AUTH_FILES) {
    const from = join(agentDir, name);
    if (!(await exists(from))) continue;
    const to = `${from}.clawx-retired-${stamp}`;
    try {
      await rename(from, to);
    } catch (error) {
      await restoreArchivedAuthFiles(archived);
      throw error;
    }
    archived.push({ from, to });
  }
  return archived;
}

/** Best-effort inverse of archiveRetiredAuthFiles; returns the entries it could not restore. */
export async function restoreArchivedAuthFiles(archived: ArchivedFile[]): Promise<ArchivedFile[]> {
  const notRestored: ArchivedFile[] = [];
  for (const entry of archived) {
    try {
      if (await exists(entry.to) && !(await exists(entry.from))) {
        await rename(entry.to, entry.from);
      }
    } catch {
      notRestored.push(entry);
    }
  }
  return notRestored;
}

function describeRuntimeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function updateConfigLocked(mutate: (cfg: RuntimeConfig) => RuntimeConfig): Promise<RuntimeConfig> {
  // Read, mutate and write under the shared config lock so concurrent provider,
  // channel or sanitizer writers cannot lose this update (or we theirs).
  return withConfigLock(async () => {
    const cfg = (await readOpenClawConfig()) as unknown as RuntimeConfig;
    const next = mutate(cfg);
    if (next !== cfg) {
      await writeOpenClawConfig(next as unknown as Parameters<typeof writeOpenClawConfig>[0]);
    }
    return next;
  });
}

/**
 * Resolve a provider's key exactly as a turn would. Any retired file is moved aside
 * first, because the runtime would otherwise refuse and cache the refusal for this
 * process. Returns null when the runtime has no usable credential; throws only for
 * infrastructure failures (SDK missing, archive failure).
 */
export async function readbackProviderApiKey(params: {
  provider: string;
  agentId?: string;
  cfg?: RuntimeConfig;
  sdk?: OpenClawAuthSdk;
}): Promise<ResolvedRuntimeApiKey | null> {
  const sdk = params.sdk ?? loadOpenClawAuthSdk();
  const agentDir = getAgentDir(params.agentId);
  await archiveRetiredAuthFiles(agentDir);
  const cfg = params.cfg ?? ((await readOpenClawConfig()) as unknown as RuntimeConfig);
  try {
    const resolved = await sdk.resolveApiKeyForProvider({ provider: params.provider, cfg, agentDir });
    return typeof resolved?.apiKey === 'string' && resolved.apiKey.length > 0 ? resolved : null;
  } catch (error) {
    if (sdk.isProviderAuthError(error) || describeRuntimeError(error).includes('legacy credential migration')) {
      return null;
    }
    throw error;
  }
}

export interface UpsertCredentialResult {
  profileId: string;
  source?: string;
  archived: string[];
}

async function upsertCredential(params: {
  provider: string;
  agentId: string;
  mode: 'api_key' | 'oauth';
  sdk?: OpenClawAuthSdk;
  write: (sdk: OpenClawAuthSdk, agentDir: string, cfg: RuntimeConfig) => Promise<string>;
}): Promise<UpsertCredentialResult> {
  const sdk = params.sdk ?? loadOpenClawAuthSdk();
  const agentDir = getAgentDir(params.agentId);

  // 1. Move any retired file aside first. The runtime's writer and reader both refuse
  //    while it exists, and cache the refusal for the life of this process.
  const archived = await archiveRetiredAuthFiles(agentDir);

  const fail = async (message: string): Promise<never> => {
    const notRestored = await restoreArchivedAuthFiles(archived);
    const suffix = notRestored.length > 0
      ? ` (and ${notRestored.length} archived file(s) could not be restored: ${notRestored.map((a) => basename(a.to)).join(', ')})`
      : '';
    throw new CredentialUnreadableError(params.provider, params.agentId, message + suffix);
  };

  // 2. Write through the runtime's writer; it chooses the store (per-agent, or the
  //    relocated shared state DB) according to its own ownership record. Then record
  //    the auth-profile entry in openclaw.json under the shared lock.
  let profileId: string;
  let nextCfg: RuntimeConfig;
  try {
    const cfg = (await readOpenClawConfig()) as unknown as RuntimeConfig;
    profileId = await params.write(sdk, agentDir, cfg);
    nextCfg = await updateConfigLocked((current) =>
      sdk.applyAuthProfileConfig(current, { profileId, provider: params.provider, mode: params.mode }),
    );
  } catch (error) {
    return fail(`write failed: ${describeRuntimeError(error)}`);
  }

  // 3. Prove the property. This is the same resolution a turn performs, so it fails
  //    exactly when a turn would.
  let resolved: ResolvedRuntimeApiKey | null = null;
  let failure = 'runtime returned no usable credential';
  try {
    resolved = await readbackProviderApiKey({ provider: params.provider, agentId: params.agentId, cfg: nextCfg, sdk });
  } catch (error) {
    failure = describeRuntimeError(error);
  }
  if (!resolved) return fail(failure);

  return { profileId, source: resolved.source, archived: archived.map((a) => basename(a.from)) };
}

/** Store an API key for a provider so the bundled runtime can use it, and prove it can. */
export async function upsertProviderApiKey(params: {
  provider: string;
  apiKey: string;
  agentId?: string;
  sdk?: OpenClawAuthSdk;
}): Promise<UpsertCredentialResult> {
  const agentId = params.agentId ?? MAIN_AGENT_ID;
  return upsertCredential({
    provider: params.provider,
    agentId,
    mode: 'api_key',
    sdk: params.sdk,
    write: async (sdk, agentDir, cfg) =>
      sdk.upsertApiKeyProfile({
        provider: params.provider,
        input: params.apiKey,
        agentDir,
        profileId: defaultProfileId(params.provider),
        options: { config: cfg },
      }),
  });
}

/** Store OAuth credentials for a provider so the bundled runtime can use them, and prove it can. */
export async function upsertProviderOAuthCredentials(params: {
  provider: string;
  token: { access: string; refresh: string; expires: number; email?: string; projectId?: string };
  agentId?: string;
  sdk?: OpenClawAuthSdk;
}): Promise<UpsertCredentialResult> {
  const agentId = params.agentId ?? MAIN_AGENT_ID;
  return upsertCredential({
    provider: params.provider,
    agentId,
    mode: 'oauth',
    sdk: params.sdk,
    write: async (sdk, agentDir) =>
      sdk.writeOAuthCredentials(
        params.provider,
        {
          type: 'oauth',
          provider: params.provider,
          access: params.token.access,
          refresh: params.token.refresh,
          expires: params.token.expires,
          ...(params.token.email ? { email: params.token.email } : {}),
          ...(params.token.projectId ? { projectId: params.token.projectId } : {}),
        },
        agentDir,
        { profileName: 'default', syncSiblingAgents: false },
      ),
  });
}

/**
 * Remove a provider's stored credentials and their auth-profile config entries.
 *
 * With `onlyApiKeyDefault`, only the `<provider>:default` profile goes, and only if
 * it is an API-key profile — an OAuth credential stored under the same default id
 * survives a "remove API key" action, as it did when the app owned the file.
 * Without it, every profile of the provider is removed. A removal the SDK reports as
 * not performed is verified by a readback that must come back empty before any
 * config is changed.
 */
export async function removeProviderCredentials(params: {
  provider: string;
  agentId?: string;
  onlyApiKeyDefault?: boolean;
  sdk?: OpenClawAuthSdk;
}): Promise<{ removed: string[] }> {
  const sdk = params.sdk ?? loadOpenClawAuthSdk();
  const agentId = params.agentId ?? MAIN_AGENT_ID;
  const agentDir = getAgentDir(agentId);
  // A retired file for a removed provider is still a retired file; the runtime
  // refuses every provider (and this removal) while one exists.
  await archiveRetiredAuthFiles(agentDir);

  let profileIds: string[] | undefined;
  if (params.onlyApiKeyDefault) {
    const id = defaultProfileId(params.provider);
    const profile = sdk.ensureAuthProfileStore(agentDir)?.profiles?.[id];
    if (!profile || profile.type !== 'api_key') return { removed: [] };
    profileIds = [id];
  }

  const result = await sdk.removeProviderAuthProfilesWithLock({
    provider: params.provider,
    agentDir,
    ...(profileIds ? { profileIds } : {}),
  });

  if (result === null || result === undefined) {
    const still = await readbackProviderApiKey({ provider: params.provider, agentId, sdk }).catch(() => null);
    if (still) {
      throw new CredentialRemovalError(params.provider, agentId, 'runtime still resolves a credential after removal');
    }
  }

  const toDrop = profileIds ?? [defaultProfileId(params.provider)];
  await updateConfigLocked((cfg) => toDrop.reduce((acc, id) => sdk.removeAuthProfileConfig(acc, id), cfg));
  return { removed: toDrop };
}
