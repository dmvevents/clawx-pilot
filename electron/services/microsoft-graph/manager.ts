/**
 * Microsoft Graph capability manager.
 *
 * Owns:
 *  - the sign-in flow (delegates to microsoft-graph-oauth.ts)
 *  - access-token freshness (auto-refresh when expiring)
 *  - the small set of Graph REST calls the agent needs (mail + calendar)
 *
 * Intentionally NOT in `node_modules/openclaw/dist/extensions/`: the openclaw
 * gateway runs in a child Node process without access to ClawX's electron
 * stores or BrowserWindow. We expose Graph calls via IPC instead, so the
 * renderer can invoke them and the agent can call them through openclaw tools
 * that wrap the IPC bridge — same model used for the other host APIs.
 */
import { shell } from 'electron';
import { logger } from '../../utils/logger';
import {
  DEFAULT_GRAPH_SCOPES,
  loginMicrosoftGraphOAuth,
  refreshMicrosoftGraphToken,
  type MicrosoftGraphOAuthCredentials,
} from '../../utils/microsoft-graph-oauth';
import {
  clearMicrosoftGraph,
  getMicrosoftGraphAccount,
  getMicrosoftGraphConfig,
  getMicrosoftGraphSecret,
  getMockMailboxEnabled,
  setMicrosoftGraphAccount,
  setMicrosoftGraphSecret,
  type MicrosoftGraphConfig,
} from './store';
import { MOCK_MAILBOX } from './mock-mailbox';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const REFRESH_LEEWAY_MS = 60_000; // refresh 1 minute before expiry

let inFlightRefresh: Promise<string> | null = null;

export class MicrosoftGraphAuthRequired extends Error {
  constructor(message = 'Microsoft Graph not signed in') {
    super(message);
    this.name = 'MicrosoftGraphAuthRequired';
  }
}

export class MicrosoftGraphNotConfigured extends Error {
  constructor(message = 'Microsoft Graph not configured (missing tenantId or clientId)') {
    super(message);
    this.name = 'MicrosoftGraphNotConfigured';
  }
}

async function requireConfig(): Promise<MicrosoftGraphConfig> {
  const cfg = await getMicrosoftGraphConfig();
  if (!cfg?.tenantId || !cfg?.clientId) throw new MicrosoftGraphNotConfigured();
  return cfg;
}

/**
 * Returns a fresh access token, refreshing if it's about to expire. Throws
 * `MicrosoftGraphAuthRequired` if the user has not signed in yet.
 */
export async function getAccessToken(): Promise<string> {
  const secret = await getMicrosoftGraphSecret();
  if (!secret) throw new MicrosoftGraphAuthRequired();
  if (Date.now() < secret.expires - REFRESH_LEEWAY_MS) {
    return secret.access;
  }
  if (inFlightRefresh) return inFlightRefresh;

  inFlightRefresh = (async () => {
    try {
      const cfg = await requireConfig();
      const refreshed = await refreshMicrosoftGraphToken({
        tenantId: cfg.tenantId,
        clientId: cfg.clientId,
        refreshToken: secret.refresh,
        scopes: cfg.scopes ?? DEFAULT_GRAPH_SCOPES,
      });
      await persistCredentials(refreshed);
      return refreshed.access;
    } finally {
      inFlightRefresh = null;
    }
  })();
  return inFlightRefresh;
}

async function persistCredentials(token: MicrosoftGraphOAuthCredentials): Promise<void> {
  await setMicrosoftGraphAccount({
    accountId: token.accountId,
    email: token.email,
    tenantId: token.tenantId,
    signedInAt: Date.now(),
  });
  await setMicrosoftGraphSecret({
    access: token.access,
    refresh: token.refresh,
    expires: token.expires,
    scope: token.scope,
  });
}

export interface SignInOptions {
  /** Force the Microsoft account picker even if the user is signed in elsewhere. */
  promptSelectAccount?: boolean;
  /** Renderer-side callback when the loopback port is taken / times out. */
  onManualCodeRequired?: (payload: {
    authorizationUrl: string;
    reason: 'port_in_use' | 'callback_timeout';
  }) => void;
  /** Renderer resolves a manual code paste; called only after onManualCodeRequired. */
  onManualCodeInput?: () => Promise<string>;
}

export async function signIn(options: SignInOptions = {}): Promise<{
  accountId: string;
  email?: string;
  tenantId: string;
}> {
  const cfg = await requireConfig();
  const credentials = await loginMicrosoftGraphOAuth({
    tenantId: cfg.tenantId,
    clientId: cfg.clientId,
    scopes: cfg.scopes ?? DEFAULT_GRAPH_SCOPES,
    promptSelectAccount: options.promptSelectAccount,
    openUrl: async (url) => {
      await shell.openExternal(url);
    },
    onProgress: (msg) => logger.info(`[msgraph] ${msg}`),
    onManualCodeRequired: options.onManualCodeRequired,
    onManualCodeInput: options.onManualCodeInput,
  });
  await persistCredentials(credentials);
  return {
    accountId: credentials.accountId,
    email: credentials.email,
    tenantId: credentials.tenantId,
  };
}

export async function signOut(): Promise<void> {
  await clearMicrosoftGraph();
}

export interface MicrosoftGraphStatus {
  configured: boolean;
  signedIn: boolean;
  account: { accountId: string; email?: string; tenantId: string } | null;
  expiresAt: number | null;
  /** When true, list/read/draft/send operate against fixtures, not Graph. */
  mockMailbox: boolean;
  /** Whether the current request will be served by the mock layer. */
  effectiveMock: boolean;
}

export async function getStatus(): Promise<MicrosoftGraphStatus> {
  const cfg = await getMicrosoftGraphConfig();
  const account = await getMicrosoftGraphAccount();
  const secret = await getMicrosoftGraphSecret();
  const mock = await getMockMailboxEnabled();
  return {
    configured: Boolean(cfg?.tenantId && cfg?.clientId),
    signedIn: Boolean(secret && account),
    account: account
      ? { accountId: account.accountId, email: account.email, tenantId: account.tenantId }
      : null,
    expiresAt: secret?.expires ?? null,
    mockMailbox: mock,
    effectiveMock: mock || !secret,
  };
}

// ── Graph REST helpers ─────────────────────────────────────────────────────

async function graph<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  query?: Record<string, string | number>,
): Promise<T> {
  const token = await getAccessToken();
  const url = new URL(`${GRAPH_BASE}${path}`);
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
  const resp = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (resp.status === 204) return null as T;
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const errBody = json as { error?: { code?: string; message?: string } };
    const err = new Error(errBody?.error?.message || `Graph HTTP ${resp.status}`);
    (err as Error & { status?: number; code?: string }).status = resp.status;
    (err as Error & { code?: string }).code = errBody?.error?.code;
    throw err;
  }
  return json as T;
}

function toRecipients(value?: string | string[]): Array<{ emailAddress: { address: string } }> {
  if (!value) return [];
  const arr = Array.isArray(value) ? value : [value];
  return arr.filter(Boolean).map((address) => ({ emailAddress: { address } }));
}

export interface ListMessagesArgs {
  top?: number;
  filter?: string;
  search?: string;
}
export interface SendMailArgs {
  subject: string;
  body: string;
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  saveToSent?: boolean;
}
export interface DraftReplyArgs {
  subject: string;
  body: string;
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
}

async function shouldUseMockMailbox(): Promise<boolean> {
  if (await getMockMailboxEnabled()) return true;
  // If not signed in, fall back to mock so demos work without an Entra app.
  const secret = await getMicrosoftGraphSecret();
  return !secret;
}

function filterMockMessages(args: ListMessagesArgs): unknown[] {
  let items: typeof MOCK_MAILBOX = [...MOCK_MAILBOX];
  if (args.search) {
    const q = args.search.toLowerCase();
    items = items.filter((m) =>
      m.subject.toLowerCase().includes(q) || m.bodyPreview.toLowerCase().includes(q),
    );
  }
  const top = args.top ?? 25;
  return items.slice(0, top);
}

export const graphCalls = {
  me: async () => {
    if (await shouldUseMockMailbox()) {
      return {
        displayName: 'Demo Principal',
        userPrincipalName: 'principal@school.example',
        jobTitle: 'Principal',
        __mock: true,
      };
    }
    return graph<Record<string, unknown>>('GET', '/me');
  },
  listMessages: async (args: ListMessagesArgs = {}) => {
    if (await shouldUseMockMailbox()) {
      return { value: filterMockMessages(args), __mock: true } as { value: unknown[] };
    }
    return graph<{ value: unknown[] }>('GET', '/me/messages', undefined, {
      $top: args.top ?? 25,
      ...(args.filter ? { $filter: args.filter } : {}),
      ...(args.search ? { $search: `"${args.search}"` } : {}),
      $select:
        'id,subject,from,toRecipients,receivedDateTime,isRead,bodyPreview,webLink',
    });
  },
  getMessage: async (id: string) => {
    if (await shouldUseMockMailbox()) {
      const found = MOCK_MAILBOX.find((m) => m.id === id);
      if (!found) {
        const err = new Error(`Mock message not found: ${id}`);
        (err as Error & { status?: number }).status = 404;
        throw err;
      }
      return found as unknown as Record<string, unknown>;
    }
    return graph<Record<string, unknown>>('GET', `/me/messages/${encodeURIComponent(id)}`);
  },
  createDraft: async (args: DraftReplyArgs) => {
    if (await shouldUseMockMailbox()) {
      logger.info(`[msgraph mock] createDraft to=${JSON.stringify(args.to)} subject=${args.subject}`);
      return {
        id: `mock-draft-${Date.now()}`,
        subject: args.subject,
        bodyPreview: (args.body ?? '').slice(0, 200),
        __mock: true,
      };
    }
    return graph<Record<string, unknown>>('POST', '/me/messages', {
      subject: args.subject,
      body: { contentType: 'HTML', content: args.body ?? '' },
      toRecipients: toRecipients(args.to),
      ccRecipients: toRecipients(args.cc),
      bccRecipients: toRecipients(args.bcc),
    });
  },
  sendMail: async (args: SendMailArgs) => {
    if (await shouldUseMockMailbox()) {
      logger.info(
        `[msgraph mock] sendMail to=${JSON.stringify(args.to)} subject=${args.subject}`,
      );
      return { ok: true, __mock: true };
    }
    await graph<null>('POST', '/me/sendMail', {
      message: {
        subject: args.subject,
        body: { contentType: 'HTML', content: args.body ?? '' },
        toRecipients: toRecipients(args.to),
        ccRecipients: toRecipients(args.cc),
        bccRecipients: toRecipients(args.bcc),
      },
      saveToSentItems: args.saveToSent ?? true,
    });
    return { ok: true };
  },
};
