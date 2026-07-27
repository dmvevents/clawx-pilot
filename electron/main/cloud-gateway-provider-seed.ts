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
import { storeApiKey } from '../utils/secure-storage';
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

export async function seedCloudGatewayProvider(
  gatewayManager?: GatewayManager,
): Promise<CloudGatewaySeedResult> {
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

  await saveProviderAccount(account);
  await storeApiKey(account.id, seed.apiKey);
  await syncSavedProviderToRuntime(providerAccountToConfig(account), seed.apiKey, gatewayManager);

  if (shouldBecomeDefault) {
    await setDefaultProviderAccount(account.id);
    await syncDefaultProviderToRuntime(account.id, gatewayManager);
  }

  if (seed.setPreferredChannel) {
    const current = await getSetting('preferredChannel').catch(() => undefined);
    if (current !== 'online') {
      await setSetting('preferredChannel', 'online');
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
  logger.info('[cloud-gateway-seed] Seeded cloud gateway provider', {
    providerId: account.id,
    runtimeProviderKey,
    baseUrl: account.baseUrl,
    model: account.model,
    defaulted: shouldBecomeDefault,
    apiKeyPresent: true,
  });

  return {
    status: 'seeded',
    providerId: account.id,
    runtimeProviderKey,
    defaulted: shouldBecomeDefault,
  };
}
