/**
 * Provider credentials for the bundled OpenClaw runtime.
 *
 * The runtime owns its credential store. Since openclaw 2026.9.2 that store is
 * SQLite and `auth-profiles.json` is a retired file: while it exists in an agent
 * directory whose per-agent store the runtime's diagnostic cannot see into, every
 * auth lookup fails closed before env or config is consulted, and a turn is refused
 * with "requires legacy credential migration" (CLWX-139). The app used to compose
 * that file on every boot, which also undid any `doctor --fix` migration.
 *
 * This module therefore never writes the runtime's files itself. It goes through the
 * runtime's supported SDK writer, archives any retired file the app left behind, and
 * then proves the result by resolving the key back through the runtime — the same
 * code path a turn uses. A write that cannot be read back is reported as a failure
 * and the archived file is restored, so an install is never left without its only
 * copy of a credential.
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
    super(`Credential for provider "${provider}" (agent ${agentId}) was written but the runtime cannot read it back: ${runtimeMessage}`);
    this.name = 'CredentialUnreadableError';
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
 * Move any retired credential file out of the agent directory. Renamed, never
 * deleted: the file may hold the only copy of a credential until the readback proves
 * the store has it. Doctor's own `.migrated-*` archives are left alone.
 */
export async function archiveRetiredAuthFiles(agentDir: string, now: Date = new Date()): Promise<ArchivedFile[]> {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const archived: ArchivedFile[] = [];
  for (const name of RETIRED_AUTH_FILES) {
    const from = join(agentDir, name);
    if (!(await exists(from))) continue;
    const to = `${from}.clawx-retired-${stamp}`;
    await rename(from, to);
    archived.push({ from, to });
  }
  return archived;
}

export async function restoreArchivedAuthFiles(archived: ArchivedFile[]): Promise<void> {
  for (const entry of archived) {
    if (await exists(entry.to) && !(await exists(entry.from))) {
      await rename(entry.to, entry.from);
    }
  }
}

function describeRuntimeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Resolve a provider's key exactly as a turn would. Returns null when the runtime
 * has no usable credential; throws only for infrastructure failures (SDK missing).
 */
export async function readbackProviderApiKey(params: {
  provider: string;
  agentId?: string;
  cfg?: RuntimeConfig;
  sdk?: OpenClawAuthSdk;
}): Promise<ResolvedRuntimeApiKey | null> {
  const sdk = params.sdk ?? loadOpenClawAuthSdk();
  const cfg = params.cfg ?? ((await readOpenClawConfig()) as unknown as RuntimeConfig);
  try {
    const resolved = await sdk.resolveApiKeyForProvider({
      provider: params.provider,
      cfg,
      agentDir: getAgentDir(params.agentId),
    });
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
  const cfg = (await readOpenClawConfig()) as unknown as RuntimeConfig;

  // 1. Write through the runtime's writer; it chooses the store (per-agent or the
  //    relocated shared state DB) according to its own ownership record.
  const profileId = await params.write(sdk, agentDir, cfg);
  const nextCfg = sdk.applyAuthProfileConfig(cfg, { profileId, provider: params.provider, mode: params.mode });
  if (nextCfg !== cfg) {
    await writeOpenClawConfig(nextCfg as unknown as Parameters<typeof writeOpenClawConfig>[0]);
  }

  // 2. Only now remove the retired file: on a relocated machine the readback below
  //    cannot pass while it exists, and until the write above the file may have been
  //    the only copy.
  const archived = await archiveRetiredAuthFiles(agentDir);

  // 3. Prove the property. This is the same resolution a turn performs, including
  //    the migration assert, so it fails exactly when a turn would.
  let resolved: ResolvedRuntimeApiKey | null = null;
  let failure = 'runtime returned no usable credential';
  try {
    resolved = await readbackProviderApiKey({ provider: params.provider, agentId: params.agentId, cfg: nextCfg, sdk });
  } catch (error) {
    failure = describeRuntimeError(error);
  }
  if (!resolved) {
    await restoreArchivedAuthFiles(archived);
    throw new CredentialUnreadableError(params.provider, params.agentId, failure);
  }

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

/** Remove a provider's stored credentials and its auth-profile config entry. */
export async function removeProviderCredentials(params: {
  provider: string;
  agentId?: string;
  sdk?: OpenClawAuthSdk;
}): Promise<void> {
  const sdk = params.sdk ?? loadOpenClawAuthSdk();
  const agentDir = getAgentDir(params.agentId);
  await sdk.removeProviderAuthProfilesWithLock({ provider: params.provider, agentDir });
  const cfg = (await readOpenClawConfig()) as unknown as RuntimeConfig;
  const nextCfg = sdk.removeAuthProfileConfig(cfg, defaultProfileId(params.provider));
  if (nextCfg !== cfg) {
    await writeOpenClawConfig(nextCfg as unknown as Parameters<typeof writeOpenClawConfig>[0]);
  }
  // A retired file for a removed provider is still a retired file; the runtime
  // refuses every provider while one exists.
  await archiveRetiredAuthFiles(agentDir);
}
