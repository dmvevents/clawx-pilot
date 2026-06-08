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

export function readMicrosoftGraphConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): MicrosoftGraphConfig | null {
  const tenantId = env.CLAWX_MICROSOFT_GRAPH_TENANT_ID?.trim()
    || env.CLAWX_MS_GRAPH_TENANT_ID?.trim()
    || '';
  const clientId = env.CLAWX_MICROSOFT_GRAPH_CLIENT_ID?.trim()
    || env.CLAWX_MS_GRAPH_CLIENT_ID?.trim()
    || '';
  if (!tenantId || !clientId) return null;

  const scopesRaw = env.CLAWX_MICROSOFT_GRAPH_SCOPES?.trim()
    || env.CLAWX_MS_GRAPH_SCOPES?.trim()
    || '';
  const scopes = scopesRaw
    ? scopesRaw.split(/[,\s]+/).map((scope) => scope.trim()).filter(Boolean)
    : undefined;
  const redirectUri = env.CLAWX_MICROSOFT_GRAPH_REDIRECT_URI?.trim()
    || env.CLAWX_MS_GRAPH_REDIRECT_URI?.trim()
    || undefined;

  return { tenantId, clientId, scopes, redirectUri };
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
  return store.get('config') ?? readMicrosoftGraphConfigFromEnv();
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
