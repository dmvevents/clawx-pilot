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
 * Rules this module follows, each one traced to a review finding:
 * - It never writes the runtime's files. Credentials go through the runtime's SDK.
 * - The SDK is reachable only through `sdkFor()`, which first moves every retired file
 *   the SDK could consult (the requested agent's, the main agent's — the SDK merges
 *   inherited main credentials — and the shared `credentials/oauth.json`) out of the
 *   way, under one in-process lock. A single SDK call made while such a file exists
 *   would poison every later call in this process.
 * - Read-only status paths never archive and never touch the SDK while a retired
 *   file exists; they report "pending migration" (null) instead. Only writes migrate.
 * - Before a write archives an `auth-profiles.json` the app itself wrote, the API-key
 *   profiles of OTHER providers in it are imported through the SDK, so no credential
 *   becomes reachable only by hand.
 * - Every write is proven by resolving the key back through the runtime — the same
 *   path a turn takes — and the resolved profile must be the one written. Failure is a
 *   typed error; the archive stays archived (putting the file back would refuse every
 *   provider). Files are renamed, never deleted.
 *
 * The SDK is loaded from the bundled runtime directory (see openclaw-sdk.ts for why a
 * static import cannot work from inside the asar), so the writer and the gateway are
 * always the same openclaw version.
 */
import { createRequire } from 'module';
import { homedir } from 'os';
import { basename, join } from 'node:path';
import { access, readFile, rename } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { getOpenClawDir, getOpenClawResolvedDir } from './paths';
import { readOpenClawConfig, writeOpenClawConfig } from './channel-config';
import { withConfigLock } from './config-mutex';

/** Files the runtime treats as retired credential sources (`resolveLegacyAuthProfileSourceCandidates`). */
export const RETIRED_AUTH_FILES = ['auth-profiles.json', 'auth-state.json', 'auth.json'] as const;
/** The fourth retired source, shared and only consulted for the main agent: `<oauthDir>/oauth.json`. */
export function sharedRetiredOAuthFile(): string {
  return join(homedir(), '.openclaw', 'credentials', 'oauth.json');
}

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
  upsertAuthProfileWithLock(params: {
    profileId: string;
    credential: { type: 'api_key'; provider: string; key: string };
    agentDir?: string;
  }): Promise<unknown>;
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
    upsertAuthProfileWithLock: pick(auth, 'upsertAuthProfileWithLock'),
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

/**
 * Windows: renaming a file another process holds open fails with EPERM/EBUSY/EACCES
 * for a moment (the gateway or an editor may have it). Same retry channel-config.ts
 * uses for its atomic config write.
 */
async function renameWithRetry(from: string, to: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES') throw error;
      lastError = error;
      await sleep(100 * (attempt + 1));
    }
  }
  throw lastError;
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

/** Every retired file the SDK could consult when operating on `agentDir`. */
function retiredCandidates(agentDir: string): string[] {
  const mainDir = getAgentDir(MAIN_AGENT_ID);
  const dirs = agentDir === mainDir ? [mainDir] : [agentDir, mainDir];
  const files = dirs.flatMap((dir) => RETIRED_AUTH_FILES.map((name) => join(dir, name)));
  files.push(sharedRetiredOAuthFile());
  return files;
}

/** True when any retired file the SDK would consult for `agentDir` is present. */
export async function hasPendingLegacyCredentialFiles(agentDir: string): Promise<boolean> {
  for (const path of retiredCandidates(agentDir)) {
    if (await exists(path)) return true;
  }
  return false;
}

// Archival is serialized in-process: two operations racing on the same file would
// otherwise let one win the rename and hand the other a raw ENOENT.
let archiveChain: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = archiveChain.then(fn, fn);
  archiveChain = run.catch(() => undefined);
  return run;
}

/**
 * Move every retired credential file the SDK could consult for `agentDir` out of the
 * way, all-or-nothing. Renamed, never deleted. If one rename fails, the ones already
 * moved are put back and the failure is raised. A file that disappears between the
 * existence check and the rename was archived by a concurrent caller and is skipped.
 * Doctor's own `.migrated-*` archives are left alone.
 */
export async function archiveRetiredAuthFiles(agentDir: string, now: Date = new Date()): Promise<ArchivedFile[]> {
  return serialized(async () => {
    const stamp = now.toISOString().replace(/[:.]/g, '-');
    const archived: ArchivedFile[] = [];
    for (const from of retiredCandidates(agentDir)) {
      if (!(await exists(from))) continue;
      const to = `${from}.clawx-retired-${stamp}`;
      try {
        await renameWithRetry(from, to);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        await restoreArchivedAuthFiles(archived);
        throw error;
      }
      archived.push({ from, to });
    }
    return archived;
  });
}

/** Best-effort inverse of archiveRetiredAuthFiles; returns the entries it could not restore. */
export async function restoreArchivedAuthFiles(archived: ArchivedFile[]): Promise<ArchivedFile[]> {
  const notRestored: ArchivedFile[] = [];
  for (const entry of archived) {
    try {
      if (await exists(entry.to) && !(await exists(entry.from))) {
        await renameWithRetry(entry.to, entry.from);
      }
    } catch {
      notRestored.push(entry);
    }
  }
  return notRestored;
}

interface LegacyApiKeyProfile {
  profileId: string;
  provider: string;
  key: string;
}

/**
 * API-key profiles the app itself once wrote into `auth-profiles.json` for providers
 * other than `exceptProvider`. Read before the file is archived so they can be carried
 * into the runtime store through the supported writer; OAuth entries are reported, not
 * carried (their refresh state belongs to the runtime's own login flows).
 */
async function readLegacyApiKeyProfiles(agentDir: string, exceptProvider: string): Promise<{ carry: LegacyApiKeyProfile[]; skippedOAuth: string[] }> {
  const carry: LegacyApiKeyProfile[] = [];
  const skippedOAuth: string[] = [];
  const path = join(agentDir, 'auth-profiles.json');
  if (!(await exists(path))) return { carry, skippedOAuth };
  try {
    const raw = JSON.parse(await readFile(path, 'utf8')) as { profiles?: Record<string, { type?: string; provider?: string; key?: string }> };
    for (const [profileId, entry] of Object.entries(raw?.profiles ?? {})) {
      if (!entry?.provider || entry.provider === exceptProvider) continue;
      if (entry.type === 'api_key' && typeof entry.key === 'string' && entry.key) {
        carry.push({ profileId, provider: entry.provider, key: entry.key });
      } else if (entry.type === 'oauth') {
        skippedOAuth.push(profileId);
      }
    }
  } catch {
    // Unparseable: nothing to carry; the archive keeps the bytes.
  }
  return { carry, skippedOAuth };
}

/**
 * The only way this module reaches the SDK. Archival of every retired file the SDK
 * would consult happens here, before any SDK call, because the runtime caches a
 * migration refusal for the life of the process.
 */
async function sdkFor(agentDir: string, sdk?: OpenClawAuthSdk): Promise<{ sdk: OpenClawAuthSdk; archived: ArchivedFile[] }> {
  const archived = await archiveRetiredAuthFiles(agentDir);
  return { sdk: sdk ?? loadOpenClawAuthSdk(), archived };
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
    // The SDK helpers return a fresh object even when nothing changed; compare content
    // so a boot with an already-recorded profile does not rewrite openclaw.json.
    if (JSON.stringify(next) !== JSON.stringify(cfg)) {
      await writeOpenClawConfig(next as unknown as Parameters<typeof writeOpenClawConfig>[0]);
    }
    return next;
  });
}

async function resolveThroughRuntime(sdk: OpenClawAuthSdk, provider: string, agentDir: string, cfg?: RuntimeConfig): Promise<ResolvedRuntimeApiKey | null> {
  const config = cfg ?? ((await readOpenClawConfig()) as unknown as RuntimeConfig);
  try {
    const resolved = await sdk.resolveApiKeyForProvider({ provider, cfg: config, agentDir });
    return typeof resolved?.apiKey === 'string' && resolved.apiKey.length > 0 ? resolved : null;
  } catch (error) {
    if (sdk.isProviderAuthError(error) || describeRuntimeError(error).includes('legacy credential migration')) {
      return null;
    }
    throw error;
  }
}

/**
 * Status read: resolve a provider's key exactly as a turn would, WITHOUT migrating
 * anything. While a retired file the runtime would consult is present, the answer is
 * null ("pending migration") and the SDK is not touched, so a status read can neither
 * arm the runtime's cached refusal nor move a file that a write path has not yet
 * carried into the store.
 */
export async function readbackProviderApiKey(params: {
  provider: string;
  agentId?: string;
  cfg?: RuntimeConfig;
  sdk?: OpenClawAuthSdk;
}): Promise<ResolvedRuntimeApiKey | null> {
  const agentDir = getAgentDir(params.agentId);
  if (await hasPendingLegacyCredentialFiles(agentDir)) return null;
  const sdk = params.sdk ?? loadOpenClawAuthSdk();
  return resolveThroughRuntime(sdk, params.provider, agentDir, params.cfg);
}

export interface UpsertCredentialResult {
  profileId: string;
  source?: string;
  archived: string[];
  carried: string[];
}

async function upsertCredential(params: {
  provider: string;
  agentId: string;
  mode: 'api_key' | 'oauth';
  sdk?: OpenClawAuthSdk;
  write: (sdk: OpenClawAuthSdk, agentDir: string) => Promise<{ profileId: string; accepted: boolean }>;
}): Promise<UpsertCredentialResult> {
  const agentDir = getAgentDir(params.agentId);

  // 1. Read what the app's own retired file holds for OTHER providers, then move
  //    every retired file aside (sdkFor does this before handing over the SDK).
  const legacy = await readLegacyApiKeyProfiles(agentDir, params.provider);
  const { sdk, archived } = await sdkFor(agentDir, params.sdk);

  // On failure the archive stays archived: putting the file back would re-arm the
  // runtime's block for EVERY provider. The app's own secret store still holds the key
  // and the archived copy is kept by name.
  const fail = (message: string): never => {
    const kept = archived.length > 0 ? ` (retired file(s) kept as ${archived.map((a) => basename(a.to)).join(', ')})` : '';
    throw new CredentialUnreadableError(params.provider, params.agentId, message + kept);
  };

  // 2. Write through the runtime's writer; it chooses the store according to its own
  //    ownership record. Then record the auth-profile entry in openclaw.json.
  let profileId = '';
  let nextCfg: RuntimeConfig = {};
  try {
    const written = await params.write(sdk, agentDir);
    if (!written.accepted) fail('the runtime writer did not persist the credential');
    profileId = written.profileId;
    nextCfg = await updateConfigLocked((current) =>
      sdk.applyAuthProfileConfig(current, { profileId, provider: params.provider, mode: params.mode }),
    );
  } catch (error) {
    if (error instanceof CredentialUnreadableError) throw error;
    fail(`write failed: ${describeRuntimeError(error)}`);
  }

  // 3. Carry other providers' API keys from the archived file into the store, so
  //    nothing becomes recoverable only by hand. Best effort; failures are reported,
  //    not fatal for this provider.
  const carried: string[] = [];
  for (const entry of legacy.carry) {
    try {
      await sdk.upsertAuthProfileWithLock({
        profileId: entry.profileId,
        credential: { type: 'api_key', provider: entry.provider, key: entry.key },
        agentDir,
      });
      carried.push(entry.profileId);
    } catch (error) {
      console.warn(`[openclaw-auth-store] could not carry legacy profile ${entry.profileId} into the runtime store: ${describeRuntimeError(error)}`);
    }
  }
  if (legacy.skippedOAuth.length > 0) {
    console.warn(`[openclaw-auth-store] legacy OAuth profile(s) ${legacy.skippedOAuth.join(', ')} were archived, not carried; re-run the provider's sign-in`);
  }

  // 4. Prove the property: the same resolution a turn performs, and the profile it
  //    resolves must be the one just written — not an older key or a fallback source.
  let resolved: ResolvedRuntimeApiKey | null = null;
  let failure = 'runtime returned no usable credential';
  try {
    resolved = await resolveThroughRuntime(sdk, params.provider, agentDir, nextCfg);
  } catch (error) {
    failure = describeRuntimeError(error);
  }
  if (!resolved) fail(failure);
  const fromWrittenProfile = resolved!.profileId === profileId || (resolved!.source ?? '').includes(profileId);
  if (!fromWrittenProfile) {
    fail(`runtime resolved ${resolved!.profileId ?? resolved!.source ?? 'an unknown source'} instead of the written profile ${profileId}`);
  }

  return { profileId, source: resolved!.source, archived: archived.map((a) => basename(a.from)), carried };
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
    write: async (sdk, agentDir) => {
      const profileId = defaultProfileId(params.provider);
      const result = await sdk.upsertAuthProfileWithLock({
        profileId,
        credential: { type: 'api_key', provider: params.provider, key: params.apiKey },
        agentDir,
      });
      // The SDK's locked writer returns the updated store, or null when it could not write.
      return { profileId, accepted: result !== null && result !== undefined };
    },
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
    write: async (sdk, agentDir) => {
      const profileId = await sdk.writeOAuthCredentials(
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
      );
      return { profileId, accepted: typeof profileId === 'string' && profileId.length > 0 };
    },
  });
}

/**
 * Remove a provider's stored credentials and their auth-profile config entries.
 *
 * With `onlyApiKeyDefault`, only the `<provider>:default` profile goes, and only if
 * it is an API-key profile — an OAuth credential stored under the same default id
 * survives a "remove API key" action, as it did when the app owned the file.
 * Without it, every profile of the provider is removed. Removal is verified by
 * inspecting the store: the targeted profiles must be gone before config changes.
 */
export async function removeProviderCredentials(params: {
  provider: string;
  agentId?: string;
  onlyApiKeyDefault?: boolean;
  sdk?: OpenClawAuthSdk;
}): Promise<{ removed: string[] }> {
  const agentId = params.agentId ?? MAIN_AGENT_ID;
  const agentDir = getAgentDir(agentId);
  // A retired file for a removed provider is still a retired file; the runtime
  // refuses every provider (and this removal) while one exists.
  const { sdk } = await sdkFor(agentDir, params.sdk);

  const before = sdk.ensureAuthProfileStore(agentDir)?.profiles ?? {};
  let targets: string[];
  if (params.onlyApiKeyDefault) {
    const id = defaultProfileId(params.provider);
    const profile = before[id];
    if (!profile || profile.type !== 'api_key') return { removed: [] };
    targets = [id];
  } else {
    targets = Object.entries(before)
      .filter(([, p]) => p?.provider === params.provider)
      .map(([id]) => id);
    if (targets.length === 0) targets = [defaultProfileId(params.provider)];
  }

  await sdk.removeProviderAuthProfilesWithLock({
    provider: params.provider,
    agentDir,
    ...(params.onlyApiKeyDefault ? { profileIds: targets } : {}),
  });

  // Verify against the store itself, not a readback: an inline config key or a
  // fallback source can still resolve after the profiles are gone, and a readback
  // that throws proves nothing.
  const after = sdk.ensureAuthProfileStore(agentDir)?.profiles ?? {};
  const remaining = targets.filter((id) => id in after);
  if (remaining.length > 0) {
    throw new CredentialRemovalError(params.provider, agentId, `profile(s) still in the runtime store: ${remaining.join(', ')}`);
  }

  await updateConfigLocked((cfg) => targets.reduce((acc, id) => sdk.removeAuthProfileConfig(acc, id), cfg));
  return { removed: targets };
}
