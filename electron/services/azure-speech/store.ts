/**
 * Persistent store for the optional Azure Speech-to-Text fallback ASR.
 *
 * Kept in its own electron-store file (`clawx-azure-speech.json`) so that:
 *   - Azure Speech credentials (region + subscription key) live independently
 *     of the LLM provider store and the Microsoft Graph (Outlook) store. They
 *     are billed against the tenant's Azure subscription, not against an LLM
 *     vendor account.
 *   - A future migration to the OS keychain only has to move this one file.
 *
 * Default locale is `en-TT` (Trinidad & Tobago English) because the customer
 * is the Ministry of Education Trinidad & Tobago. Azure Speech has supported
 * en-TT since 2022.
 */
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { app } from 'electron';
import type Store from 'electron-store';
import { logger } from '../../utils/logger';

export interface AzureSpeechConfig {
  /** Azure region short name (e.g. "eastus", "southcentralus"). */
  region: string;
  /** Speech resource subscription key (sometimes called "Key 1" / "Key 2"). */
  apiKey: string;
  /** BCP-47 language tag — defaults to en-TT. */
  locale: string;
}

interface AzureSpeechStoreShape {
  schemaVersion: number;
  config: AzureSpeechConfig;
}

type RawAzureSpeechSeedConfig = Partial<{
  enabled: boolean | string;
  region: string;
  apiKey: string;
  apiKeyFile: string;
  locale: string;
}>;

const DEFAULT_CONFIG: AzureSpeechConfig = {
  region: '',
  apiKey: '',
  locale: 'en-TT',
};

const CONFIG_FILE_NAME = 'azure-speech.json';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let storeInstance: any = null;

async function getStore(): Promise<Store<AzureSpeechStoreShape>> {
  if (!storeInstance) {
    const Module = (await import('electron-store')).default;
    storeInstance = new Module<AzureSpeechStoreShape>({
      name: 'clawx-azure-speech',
      defaults: {
        schemaVersion: 1,
        config: { ...DEFAULT_CONFIG },
      },
    });
  }
  return storeInstance;
}

function boolFromUnknown(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return fallback;
  const raw = value.trim().toLowerCase();
  if (!raw) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return fallback;
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

function processResourcesPath(): string | undefined {
  return (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
}

function safeAppPath(): string | undefined {
  const maybeApp = app as typeof app & { getAppPath?: () => string };
  if (typeof maybeApp.getAppPath !== 'function') return undefined;
  try {
    return maybeApp.getAppPath();
  } catch {
    return undefined;
  }
}

function safeUserDataPath(): string | undefined {
  try {
    return app.getPath('userData');
  } catch {
    return undefined;
  }
}

export function getAzureSpeechCandidateConfigPaths(): string[] {
  const envPath = process.env.CLAWX_AZURE_SPEECH_CONFIG?.trim();
  const userDataPath = safeUserDataPath();
  const appPath = safeAppPath();
  const candidates = cleanList([
    envPath,
    userDataPath ? join(userDataPath, CONFIG_FILE_NAME) : undefined,
    processResourcesPath() ? join(processResourcesPath() as string, 'resources', CONFIG_FILE_NAME) : undefined,
    appPath ? join(appPath, 'resources', CONFIG_FILE_NAME) : undefined,
    join(process.cwd(), 'resources', CONFIG_FILE_NAME),
  ]);
  return candidates.map((candidate) => (isAbsolute(candidate) ? candidate : resolve(candidate)));
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readFirstConfigFile(): Promise<{ config: RawAzureSpeechSeedConfig; dir: string } | null> {
  for (const path of getAzureSpeechCandidateConfigPaths()) {
    if (!(await fileExists(path))) continue;
    try {
      const parsed = JSON.parse(await readFile(path, 'utf-8')) as RawAzureSpeechSeedConfig;
      return { config: parsed, dir: dirname(path) };
    } catch (error) {
      logger.warn('[azure-speech-store] Failed to read Azure Speech config', {
        path,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return null;
}

function envOverrides(): RawAzureSpeechSeedConfig {
  const env = process.env;
  return {
    enabled: env.CLAWX_AZURE_SPEECH_ENABLED,
    region: env.CLAWX_AZURE_SPEECH_REGION ?? env.AZURE_SPEECH_REGION,
    apiKey: env.CLAWX_AZURE_SPEECH_API_KEY ?? env.AZURE_SPEECH_KEY,
    apiKeyFile: env.CLAWX_AZURE_SPEECH_API_KEY_FILE ?? env.AZURE_SPEECH_KEY_FILE,
    locale: env.CLAWX_AZURE_SPEECH_LOCALE ?? env.AZURE_SPEECH_LOCALE,
  };
}

function mergeConfig(
  fileConfig: RawAzureSpeechSeedConfig | undefined,
  overrides: RawAzureSpeechSeedConfig,
): RawAzureSpeechSeedConfig {
  const merged: RawAzureSpeechSeedConfig = { ...(fileConfig ?? {}) };
  for (const [key, value] of Object.entries(overrides) as Array<[keyof RawAzureSpeechSeedConfig, unknown]>) {
    if (value !== undefined && value !== '') {
      (merged as Record<string, unknown>)[key] = value;
    }
  }
  return merged;
}

async function resolveApiKey(config: RawAzureSpeechSeedConfig, configDir?: string): Promise<string> {
  const inline = config.apiKey?.trim();
  if (inline) return inline;

  const apiKeyFile = config.apiKeyFile?.trim();
  if (!apiKeyFile) return '';

  const resolved = isAbsolute(apiKeyFile)
    ? apiKeyFile
    : resolve(configDir ?? safeUserDataPath() ?? process.cwd(), apiKeyFile);
  try {
    return (await readFile(resolved, 'utf-8')).trim();
  } catch (error) {
    logger.warn('[azure-speech-store] Failed to read Azure Speech key file', {
      path: resolved,
      error: error instanceof Error ? error.message : String(error),
    });
    return '';
  }
}

export async function resolveAzureSpeechSeedConfig(): Promise<AzureSpeechConfig | null> {
  const file = await readFirstConfigFile();
  const raw = mergeConfig(file?.config, envOverrides());
  if (!boolFromUnknown(raw.enabled, true)) {
    return null;
  }

  const region = (raw.region ?? '').trim();
  const apiKey = await resolveApiKey(raw, file?.dir);
  if (!region || !apiKey) {
    return null;
  }

  return {
    region,
    apiKey,
    locale: (raw.locale ?? DEFAULT_CONFIG.locale).trim() || DEFAULT_CONFIG.locale,
  };
}

export async function getAzureSpeechConfig(): Promise<AzureSpeechConfig> {
  const store = await getStore();
  const persisted = (store.get('config') as AzureSpeechConfig | undefined) ?? DEFAULT_CONFIG;
  const normalized = {
    region: (persisted.region ?? '').trim(),
    apiKey: (persisted.apiKey ?? '').trim(),
    locale: (persisted.locale ?? '').trim() || 'en-TT',
  };
  if (isAzureSpeechConfigured(normalized)) {
    return normalized;
  }
  return (await resolveAzureSpeechSeedConfig()) ?? normalized;
}

export async function setAzureSpeechConfig(config: AzureSpeechConfig): Promise<void> {
  const store = await getStore();
  const region = (config.region ?? '').trim();
  const apiKey = (config.apiKey ?? '').trim();
  const locale = (config.locale ?? '').trim() || 'en-TT';
  store.set('config', { region, apiKey, locale });
}

export function isAzureSpeechConfigured(config: AzureSpeechConfig): boolean {
  return Boolean(config.region && config.apiKey);
}
