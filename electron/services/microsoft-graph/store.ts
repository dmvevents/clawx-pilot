/**
 * Persistent store for the Microsoft Graph capability extension.
 *
 * Kept separate from the LLM provider store (`clawx-providers.json`) because
 * Microsoft Graph isn't an AI provider — it's a tenant-scoped data integration
 * with its own per-tenant config (tenantId + clientId + scopes) and its own
 * single-account model. Mixing it into `provider-runtime-sync.ts` would have
 * required widening the AI provider type union and the runtime sync flows for
 * a use case that has nothing to do with model inference.
 *
 * Store layout (electron-store, file: clawx-microsoft-graph.json):
 *   schemaVersion: 1
 *   config: { tenantId, clientId, scopes, redirectUri }   // per-deployment
 *   account: { accountId, email, tenantId, signedInAt }   // single-account
 *   secret: { access, refresh, expires, scope }           // tokens (sensitive)
 *
 * The secret block lives in the same file rather than the OS keychain because
 * (a) ClawX's existing OAuth providers do the same with electron-store, and
 * (b) macOS keychain access from Electron requires bundle signing in package
 * mode. Future hardening: move `secret` to keytar when packaging is signed.
 */
import { constants } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type Store from 'electron-store';

export interface MicrosoftGraphConfig {
  /** Tenant ID (GUID) or domain (e.g. "moe.gov.tt"). */
  tenantId: string;
  /** Application (client) ID from the Entra app registration. */
  clientId: string;
  /** Delegated scopes; defaults applied at sign-in time when omitted. */
  scopes?: string[];
  /** Redirect URI; only override if your app registration uses a different one. */
  redirectUri?: string;
  /** Enable Graph-backed Outlook read endpoints (config-based transport toggle). */
  graphOutlookRead?: boolean;
  /** Enable Graph-backed Outlook draft/send endpoints (config-based transport toggle). */
  graphOutlookCompose?: boolean;
}

export interface MicrosoftGraphAccount {
  accountId: string;
  email?: string;
  tenantId: string;
  signedInAt: number;
}

export interface MicrosoftGraphSecret {
  access: string;
  refresh: string;
  expires: number;
  scope: string;
}

interface MicrosoftGraphStoreShape {
  schemaVersion: number;
  config: MicrosoftGraphConfig | null;
  account: MicrosoftGraphAccount | null;
  secret: MicrosoftGraphSecret | null;
  /** When true, list/read tools return fixture data instead of hitting Graph. */
  mockMailbox: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let storeInstance: any = null;

type RawMicrosoftGraphConfig = Partial<
  Omit<MicrosoftGraphConfig, 'enabled' | 'scopes' | 'graphOutlookRead' | 'graphOutlookCompose'> & {
    enabled: boolean | string;
    scopes: string[] | string;
    graphOutlookRead: boolean | string;
    graphOutlookCompose: boolean | string;
  }
>;

const CONFIG_FILE_NAME = 'microsoft-graph.json';

function boolFromUnknown(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return fallback;
  const raw = value.trim().toLowerCase();
  if (!raw) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return fallback;
}

/** Tri-state boolean: undefined when absent or unparseable, so an omitted
 *  toggle stays "not configured" rather than silently defaulting. */
function optionalBoolFromUnknown(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;
  const raw = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return undefined;
}

function cleanList(values: string[] | string | undefined): string[] | undefined {
  const raw = Array.isArray(values) ? values : (values ? values.split(/[,\s]+/) : []);
  const seen = new Set<string>();
  const cleaned = raw
    .map((scope) => scope.trim())
    .filter((scope) => {
      if (!scope || seen.has(scope)) return false;
      seen.add(scope);
      return true;
    });
  return cleaned.length > 0 ? cleaned : undefined;
}

function normalizeMicrosoftGraphConfig(
  raw: RawMicrosoftGraphConfig | null | undefined,
): MicrosoftGraphConfig | null {
  if (!raw || !boolFromUnknown(raw.enabled, true)) return null;
  const tenantId = raw.tenantId?.trim() ?? '';
  const clientId = raw.clientId?.trim() ?? '';
  if (!tenantId || !clientId) return null;
  const scopes = cleanList(raw.scopes);
  const redirectUri = raw.redirectUri?.trim() || undefined;
  const graphOutlookRead = optionalBoolFromUnknown(raw.graphOutlookRead);
  const graphOutlookCompose = optionalBoolFromUnknown(raw.graphOutlookCompose);
  return { tenantId, clientId, scopes, redirectUri, graphOutlookRead, graphOutlookCompose };
}

export function readMicrosoftGraphConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): MicrosoftGraphConfig | null {
  return normalizeMicrosoftGraphConfig({
    enabled: env.CLAWX_MICROSOFT_GRAPH_ENABLED ?? env.CLAWX_MS_GRAPH_ENABLED,
    tenantId: env.CLAWX_MICROSOFT_GRAPH_TENANT_ID
      ?? env.CLAWX_MS_GRAPH_TENANT_ID,
    clientId: env.CLAWX_MICROSOFT_GRAPH_CLIENT_ID
      ?? env.CLAWX_MS_GRAPH_CLIENT_ID,
    scopes: env.CLAWX_MICROSOFT_GRAPH_SCOPES
      ?? env.CLAWX_MS_GRAPH_SCOPES,
    redirectUri: env.CLAWX_MICROSOFT_GRAPH_REDIRECT_URI
      ?? env.CLAWX_MS_GRAPH_REDIRECT_URI,
    graphOutlookRead: env.CLAWX_MICROSOFT_GRAPH_OUTLOOK_READ
      ?? env.CLAWX_MS_GRAPH_OUTLOOK_READ,
    graphOutlookCompose: env.CLAWX_MICROSOFT_GRAPH_OUTLOOK_COMPOSE
      ?? env.CLAWX_MS_GRAPH_OUTLOOK_COMPOSE,
  });
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

async function electronPaths(): Promise<{ userData?: string; appPath?: string }> {
  try {
    const electron = await import('electron');
    return {
      userData: electron.app?.getPath?.('userData'),
      appPath: electron.app?.getAppPath?.(),
    };
  } catch {
    return {};
  }
}

async function candidateConfigPaths(env: NodeJS.ProcessEnv = process.env): Promise<string[]> {
  const explicit = env.CLAWX_MICROSOFT_GRAPH_CONFIG?.trim()
    || env.CLAWX_MS_GRAPH_CONFIG?.trim()
    || '';
  const paths = await electronPaths();
  const candidates = [
    explicit || undefined,
    paths.userData ? join(paths.userData, CONFIG_FILE_NAME) : undefined,
    processResourcesPath() ? join(processResourcesPath() as string, 'resources', CONFIG_FILE_NAME) : undefined,
    paths.appPath ? join(paths.appPath, 'resources', CONFIG_FILE_NAME) : undefined,
    join(process.cwd(), 'resources', CONFIG_FILE_NAME),
  ].filter((path): path is string => Boolean(path));

  const seen = new Set<string>();
  return candidates
    .map((candidate) => resolve(candidate))
    .filter((candidate) => {
      if (seen.has(candidate)) return false;
      seen.add(candidate);
      return true;
    });
}

export async function readMicrosoftGraphConfigFromFile(
  path: string,
): Promise<MicrosoftGraphConfig | null> {
  const parsed = JSON.parse(await readFile(path, 'utf-8')) as RawMicrosoftGraphConfig;
  return normalizeMicrosoftGraphConfig(parsed);
}

export async function readMicrosoftGraphConfigFromDisk(
  env: NodeJS.ProcessEnv = process.env,
): Promise<MicrosoftGraphConfig | null> {
  for (const path of await candidateConfigPaths(env)) {
    if (!(await fileExists(path))) continue;
    try {
      const config = await readMicrosoftGraphConfigFromFile(path);
      if (config) return config;
    } catch {
      // Invalid bootstrap files are ignored so a bad optional seed does not
      // prevent the app from launching; Settings still allows manual config.
    }
  }
  return null;
}

async function getStore(): Promise<Store<MicrosoftGraphStoreShape>> {
  if (!storeInstance) {
    const Module = (await import('electron-store')).default;
    storeInstance = new Module<MicrosoftGraphStoreShape>({
      name: 'clawx-microsoft-graph',
      defaults: {
        schemaVersion: 1,
        config: null,
        account: null,
        secret: null,
        mockMailbox: false,
      },
    });
  }
  return storeInstance;
}

export async function getMicrosoftGraphConfig(): Promise<MicrosoftGraphConfig | null> {
  const store = await getStore();
  return store.get('config')
    ?? readMicrosoftGraphConfigFromEnv()
    ?? await readMicrosoftGraphConfigFromDisk();
}

export async function setMicrosoftGraphConfig(
  config: MicrosoftGraphConfig | null,
): Promise<void> {
  const store = await getStore();
  if (!config) {
    store.set('config', null);
    return;
  }
  if (!config.tenantId || !config.clientId) {
    throw new Error('tenantId and clientId are required');
  }
  store.set('config', {
    tenantId: config.tenantId.trim(),
    clientId: config.clientId.trim(),
    scopes: config.scopes,
    redirectUri: config.redirectUri,
    graphOutlookRead: config.graphOutlookRead,
    graphOutlookCompose: config.graphOutlookCompose,
  });
}

export async function getMicrosoftGraphAccount(): Promise<MicrosoftGraphAccount | null> {
  const store = await getStore();
  return store.get('account');
}

export async function setMicrosoftGraphAccount(
  account: MicrosoftGraphAccount | null,
): Promise<void> {
  const store = await getStore();
  store.set('account', account);
}

export async function getMicrosoftGraphSecret(): Promise<MicrosoftGraphSecret | null> {
  const store = await getStore();
  return store.get('secret');
}

export async function setMicrosoftGraphSecret(
  secret: MicrosoftGraphSecret | null,
): Promise<void> {
  const store = await getStore();
  store.set('secret', secret);
}

export async function clearMicrosoftGraph(): Promise<void> {
  const store = await getStore();
  store.set('account', null);
  store.set('secret', null);
}

export async function getMockMailboxEnabled(): Promise<boolean> {
  const store = await getStore();
  return store.get('mockMailbox') ?? false;
}

export async function setMockMailboxEnabled(enabled: boolean): Promise<void> {
  const store = await getStore();
  store.set('mockMailbox', Boolean(enabled));
}
