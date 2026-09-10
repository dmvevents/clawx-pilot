/**
 * Boot-time seed for the managed online model gateway.
 *
 * The Windows demo build should work without a user manually opening Models
 * and pasting provider credentials. This seed creates a custom
 * OpenAI-compatible provider account from env or a local config file, stores
 * only the LiteLLM client key, and makes the Online channel the launch
 * default. Actual upstream provider credentials stay behind the gateway.
 */
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { app } from 'electron';
import type { GatewayManager } from '../gateway/manager';
import { SEED_CLOUD_GATEWAY_PROVIDER } from '../../shared/feature-flags';
import type { ProviderAccount, ProviderProtocol } from '../shared/providers/types';
import { logger } from '../utils/logger';
import { getSetting, setSetting } from '../utils/store';
import { getApiKey, storeApiKey } from '../utils/secure-storage';
import { getMicrosoftGraphAccount } from '../services/microsoft-graph/store';
import {
  getDefaultProviderAccountId,
  getProviderAccount,
  providerAccountToConfig,
  saveProviderAccount,
  setDefaultProviderAccount,
} from '../services/providers/provider-store';
import {
  getOpenClawProviderKey,
  syncDefaultProviderToRuntime,
  syncSavedProviderToRuntime,
} from '../services/providers/provider-runtime-sync';
import { readbackProviderApiKey } from '../utils/openclaw-auth-store';

const DEFAULT_PROVIDER_ID = 'moe-cloud-gateway';
const DEFAULT_LABEL = 'MOE Cloud Gateway';
const DEFAULT_MODEL = 'moe-demo-pro';
const DEFAULT_MODELS = ['moe-demo-pro', 'moe-demo'];
const CONFIG_FILE_NAME = 'cloud-gateway.json';
const DEFAULT_PROTOCOL: ProviderProtocol = 'openai-completions';
const ALLOWED_PROTOCOLS = new Set<ProviderProtocol>([
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
  'openrouter',
]);

type RawCloudGatewayConfig = Partial<{
  enabled: boolean | string;
  providerId: string;
  label: string;
  baseUrl: string;
  apiKey: string;
  apiKeyFile: string;
  model: string;
  models: string[] | string;
  fallbackModels: string[] | string;
  apiProtocol: ProviderProtocol;
  setDefault: boolean | string;
  setPreferredChannel: boolean | string;
}>;

export interface CloudGatewaySeedConfig {
  providerId: string;
  label: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  models: string[];
  fallbackModels: string[];
  apiProtocol: ProviderProtocol;
  setDefault: boolean;
  setPreferredChannel: boolean;
}

export type CloudGatewaySeedResult =
  | { status: 'skipped'; reason: string }
  | { status: 'seeded'; providerId: string; runtimeProviderKey: string; defaulted: boolean };

function boolFromUnknown(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return fallback;
  const raw = value.trim().toLowerCase();
  if (!raw) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return fallback;
}

function splitList(value: string[] | string | undefined): string[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value !== 'string') {
    return [];
  }
  return value.split(',');
}

function cleanList(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function normalizeProviderId(value: string | undefined): string {
  const normalized = (value ?? DEFAULT_PROVIDER_ID)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized || DEFAULT_PROVIDER_ID;
}

function normalizeProtocol(value: ProviderProtocol | undefined): ProviderProtocol {
  if (value && ALLOWED_PROTOCOLS.has(value)) {
    return value;
  }
  return DEFAULT_PROTOCOL;
}

export function normalizeCloudGatewayBaseUrl(input: string | undefined): string {
  let value = (input ?? '').trim();
  if (!value) return '';
  value = value.replace(/\/+$/, '');
  value = value.replace(/\/(?:chat\/completions|responses)$/i, '');
  if (!/\/v\d+(?:beta)?(?:\/openai)?$/i.test(value)) {
    value = `${value}/v1`;
  }
  return value;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function processResourcesPath(): string | undefined {
  return (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
}

function candidateConfigPaths(): string[] {
  const envPath = process.env.CLAWX_CLOUD_GATEWAY_CONFIG?.trim();
  const candidates = cleanList([
    envPath,
    join(app.getPath('userData'), CONFIG_FILE_NAME),
    processResourcesPath() ? join(processResourcesPath() as string, 'resources', CONFIG_FILE_NAME) : undefined,
    join(app.getAppPath(), 'resources', CONFIG_FILE_NAME),
    join(process.cwd(), 'resources', CONFIG_FILE_NAME),
  ]);
  return candidates.map((candidate) => isAbsolute(candidate) ? candidate : resolve(candidate));
}

async function readFirstConfigFile(): Promise<{ config: RawCloudGatewayConfig; dir: string } | null> {
  for (const path of candidateConfigPaths()) {
    if (!(await fileExists(path))) continue;
    try {
      const parsed = JSON.parse(await readFile(path, 'utf-8')) as RawCloudGatewayConfig;
      return { config: parsed, dir: dirname(path) };
    } catch (error) {
      logger.warn('[cloud-gateway-seed] Failed to read cloud gateway config', {
        path,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return null;
}

function envOverrides(): RawCloudGatewayConfig {
  const env = process.env;
  return {
    enabled: env.CLAWX_CLOUD_GATEWAY_ENABLED,
    providerId: env.CLAWX_CLOUD_GATEWAY_PROVIDER_ID,
    label: env.CLAWX_CLOUD_GATEWAY_LABEL,
    baseUrl: env.CLAWX_CLOUD_GATEWAY_BASE_URL,
    apiKey: env.CLAWX_CLOUD_GATEWAY_API_KEY,
    apiKeyFile: env.CLAWX_CLOUD_GATEWAY_API_KEY_FILE,
    model: env.CLAWX_CLOUD_GATEWAY_MODEL,
    models: env.CLAWX_CLOUD_GATEWAY_MODELS,
    fallbackModels: env.CLAWX_CLOUD_GATEWAY_FALLBACK_MODELS,
    apiProtocol: env.CLAWX_CLOUD_GATEWAY_API_PROTOCOL as ProviderProtocol | undefined,
    setDefault: env.CLAWX_CLOUD_GATEWAY_SET_DEFAULT,
    setPreferredChannel: env.CLAWX_CLOUD_GATEWAY_SET_PREFERRED_CHANNEL,
  };
}

function mergeConfig(
  fileConfig: RawCloudGatewayConfig | undefined,
  overrides: RawCloudGatewayConfig,
): RawCloudGatewayConfig {
  const merged: RawCloudGatewayConfig = { ...(fileConfig ?? {}) };
  for (const [key, value] of Object.entries(overrides) as Array<[keyof RawCloudGatewayConfig, unknown]>) {
    if (value !== undefined && value !== '') {
      (merged as Record<string, unknown>)[key] = value;
    }
  }
  return merged;
}

async function resolveApiKey(config: RawCloudGatewayConfig, configDir?: string): Promise<string> {
  const inline = config.apiKey?.trim();
  if (inline) return inline;

  const apiKeyFile = config.apiKeyFile?.trim();
  if (!apiKeyFile) return '';

  const resolved = isAbsolute(apiKeyFile)
    ? apiKeyFile
    : resolve(configDir ?? app.getPath('userData'), apiKeyFile);
  try {
    return (await readFile(resolved, 'utf-8')).trim();
  } catch (error) {
    logger.warn('[cloud-gateway-seed] Failed to read gateway API key file', {
      path: resolved,
      error: error instanceof Error ? error.message : String(error),
    });
    return '';
  }
}

export async function resolveCloudGatewaySeedConfig(): Promise<CloudGatewaySeedConfig | null> {
  const file = await readFirstConfigFile();
  const raw = mergeConfig(file?.config, envOverrides());

  if (!boolFromUnknown(raw.enabled, true)) {
    return null;
  }

  const baseUrl = normalizeCloudGatewayBaseUrl(raw.baseUrl);
  const apiKey = await resolveApiKey(raw, file?.dir);
  if (!baseUrl || !apiKey) {
    return null;
  }

  const model = (raw.model ?? DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  const models = cleanList([
    model,
    ...splitList(raw.models),
    ...splitList(raw.fallbackModels),
    ...DEFAULT_MODELS,
  ]);
  const fallbackModels = models.filter((candidate) => candidate !== model);

  return {
    providerId: normalizeProviderId(raw.providerId),
    label: raw.label?.trim() || DEFAULT_LABEL,
    baseUrl,
    apiKey,
    model,
    models,
    fallbackModels,
    apiProtocol: normalizeProtocol(raw.apiProtocol),
    setDefault: boolFromUnknown(raw.setDefault, true),
    setPreferredChannel: boolFromUnknown(raw.setPreferredChannel, true),
  };
}

// KR7: the broker meters per-principal usage on the `UserId` header, keyed on
// the signed-in Graph account's Entra oid. The value is client-stamped and
// spoofable — acceptable for pilot metering; broker-side token validation is
// a KR8-gated Ministry decision. Only the UserId key is managed here; other
// header entries on the account are preserved as-is.
function withUserIdHeader(
  headers: Record<string, string> | undefined,
  accountId: string | undefined,
): Record<string, string> | undefined {
  const next = { ...(headers ?? {}) };
  const oid = accountId?.trim();
  if (oid) {
    next.UserId = oid;
  } else {
    delete next.UserId;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

// The gateway manager handed to seedCloudGatewayProvider at boot, kept so
// mid-session refreshes (Graph sign-in/out) can schedule a live gateway
// reload instead of leaving the header change parked until next restart.
let refreshGatewayManager: GatewayManager | undefined;

/**
 * Contract C3 (KR7): re-read the Graph account and re-stamp or remove the
 * UserId header on the saved cloud gateway provider account, then re-run the
 * existing sync path so the gateway reloads with the new header set.
 *
 * Safe to call before the provider has been seeded (no-op) and idempotent:
 * when the header already matches the current sign-in state nothing is
 * written and no gateway reload is scheduled.
 */
export async function refreshCloudGatewayUserIdHeader(): Promise<void> {
  const seed = await resolveCloudGatewaySeedConfig().catch(() => null);
  const providerId = seed?.providerId ?? DEFAULT_PROVIDER_ID;
  const existing = await getProviderAccount(providerId);
  if (!existing) {
    return;
  }

  const graphAccount = await getMicrosoftGraphAccount().catch(() => null);
  const nextHeaders = withUserIdHeader(existing.headers, graphAccount?.accountId);
  if (existing.headers?.UserId === nextHeaders?.UserId) {
    return;
  }

  const account: ProviderAccount = {
    ...existing,
    updatedAt: new Date().toISOString(),
  };
  if (nextHeaders) {
    account.headers = nextHeaders;
  } else {
    delete account.headers;
  }

  await saveProviderAccount(account);
  const apiKey = await getApiKey(account.id).catch(() => null);
  await syncSavedProviderToRuntime(
    providerAccountToConfig(account),
    apiKey ?? undefined,
    refreshGatewayManager,
  );
  logger.debug('[cloud-gateway-seed] Refreshed UserId header on cloud gateway provider', {
    providerId: account.id,
    userIdPresent: Boolean(nextHeaders?.UserId),
  });
}

export interface CloudGatewaySeedOptions {
  /**
   * Boot convergence writes provider config before the Gateway starts. Passing
   * the manager into sync here can queue a deferred Windows restart that fires
   * immediately after startup, so boot callers suppress only that refresh while
   * still registering the manager for later Graph UserId header refreshes.
   */
  skipGatewayRefresh?: boolean;
}

export async function seedCloudGatewayProvider(
  gatewayManager?: GatewayManager,
  options?: CloudGatewaySeedOptions,
): Promise<CloudGatewaySeedResult> {
  if (gatewayManager) {
    refreshGatewayManager = gatewayManager;
  }
  const syncGatewayManager = options?.skipGatewayRefresh === true ? undefined : gatewayManager;
  if (!SEED_CLOUD_GATEWAY_PROVIDER) {
    logger.info('[cloud-gateway-seed] SEED_CLOUD_GATEWAY_PROVIDER disabled — skipping');
    return { status: 'skipped', reason: 'disabled' };
  }

  const seed = await resolveCloudGatewaySeedConfig();
  if (!seed) {
    logger.info('[cloud-gateway-seed] No complete cloud gateway config found — skipping');
    return { status: 'skipped', reason: 'missing-config' };
  }

  const existing = await getProviderAccount(seed.providerId);
  const defaultProviderId = await getDefaultProviderAccountId();
  const shouldBecomeDefault = seed.setDefault || !defaultProviderId || defaultProviderId === seed.providerId;
  const now = new Date().toISOString();

  // KR7: stamp the metering identity when a Graph account is signed in; when
  // absent, leave the headers key off entirely so unauthenticated turns fall
  // through to the broker's anonymous path.
  const graphAccount = await getMicrosoftGraphAccount().catch(() => null);
  const userIdHeaders = withUserIdHeader(existing?.headers, graphAccount?.accountId);
  if (graphAccount?.accountId) {
    logger.debug('[cloud-gateway-seed] Stamping UserId header from Graph account', {
      userIdPrefix: graphAccount.accountId.slice(0, 8),
    });
  }

  const account: ProviderAccount = {
    ...(existing ?? {}),
    id: seed.providerId,
    vendorId: 'custom',
    label: seed.label,
    authMode: 'api_key',
    baseUrl: seed.baseUrl,
    apiProtocol: seed.apiProtocol,
    model: seed.model,
    fallbackModels: seed.fallbackModels,
    enabled: true,
    isDefault: shouldBecomeDefault,
    metadata: {
      ...(existing?.metadata ?? {}),
      customModels: seed.models,
    },
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  if (userIdHeaders) {
    account.headers = userIdHeaders;
  } else {
    delete account.headers;
  }

  await saveProviderAccount(account);
  await storeApiKey(account.id, seed.apiKey);
  await syncSavedProviderToRuntime(providerAccountToConfig(account), seed.apiKey, syncGatewayManager);

  if (shouldBecomeDefault) {
    await setDefaultProviderAccount(account.id);
    await syncDefaultProviderToRuntime(account.id, syncGatewayManager);
  }

  if (seed.setPreferredChannel) {
    // Make Online the launch default, but ONLY when no choice exists yet. This
    // seed runs on every boot; overwriting a non-online value here silently
    // reverted a principal's "On this device" selection at next launch (found
    // live on the moe.13 KR2 run, 2026-09-02), so an EXPLICIT value is
    // authoritative and left untouched.
    //
    // "No choice yet" is `getSetting('preferredChannel') === undefined`. That
    // relies on the settings store NOT defaulting preferredChannel — a default
    // is returned by electron-store `.get()` even for never-written keys, which
    // made this guard dead (current was always 'on-device') and shipped the
    // pilot on the on-device model. See createDefaultSettings in utils/store.ts
    // and tests/unit/settings-store-defaults.test.ts. Only an explicit user
    // toggle (settings PUT -> setSetting) writes a concrete value.
    //
    // Legacy-upgrade migration (one-time, marker-gated): boxes that ever ran a
    // build whose store DID default preferredChannel had 'on-device' persisted
    // to disk at store construction (conf writes the whole defaults object), so
    // on an in-place upgrade `current` is 'on-device' even though the principal
    // never chose it — indistinguishable from an explicit choice, and it would
    // pin the upgraded fleet on-device forever. channelDefaultMigrated marks
    // that this seed has applied the launch default once on this box: before
    // the marker, a persisted 'on-device' is treated as the stale legacy
    // default and flipped to Online (per the owner's launch-channel directive);
    // after the marker, any persisted value is an explicit toggle and is
    // respected (moe.13 no-clobber). 'online' is never rewritten either way.
    const migrated = (await getSetting('channelDefaultMigrated').catch(() => undefined)) === true;
    const current = await getSetting('preferredChannel').catch(() => undefined);
    if (current === undefined || current === null) {
      await setSetting('preferredChannel', 'online');
    } else if (!migrated && current === 'on-device') {
      logger.info(
        '[cloud-gateway-seed] Migrating legacy persisted on-device launch default to online (one-time)',
      );
      await setSetting('preferredChannel', 'online');
    }
    if (!migrated) {
      await setSetting('channelDefaultMigrated', true);
    }
  }

  // A packaged cloud gateway seed means the Ministry demo build already has
  // the required model route. Skip the generic setup wizard on first launch so
  // principals land directly in the usable assistant instead of a misleading
  // "ready to be configured" flow.
  if (shouldBecomeDefault && seed.setPreferredChannel) {
    const setupComplete = await getSetting('setupComplete').catch(() => false);
    if (!setupComplete) {
      await setSetting('setupComplete', true);
    }
  }

  const runtimeProviderKey = getOpenClawProviderKey(account.vendorId, account.id);
  // Report what the runtime can actually resolve, not what this seed just wrote:
  // a file write that the gateway ignores logged `apiKeyPresent: true` on every
  // boot of a build that could not answer a turn (CLWX-139).
  const readback = await readbackProviderApiKey({ provider: runtimeProviderKey }).catch(() => null);
  logger.info('[cloud-gateway-seed] Seeded cloud gateway provider', {
    providerId: account.id,
    runtimeProviderKey,
    baseUrl: account.baseUrl,
    model: account.model,
    defaulted: shouldBecomeDefault,
    credentialReadable: Boolean(readback?.apiKey),
    credentialSource: readback?.source ?? null,
    userIdHeader: Boolean(userIdHeaders?.UserId),
  });

  return {
    status: 'seeded',
    providerId: account.id,
    runtimeProviderKey,
    defaulted: shouldBecomeDefault,
  };
}
