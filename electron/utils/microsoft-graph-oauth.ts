/**
 * Microsoft Entra ID (Azure AD) OAuth2 / OIDC sign-in for the
 * microsoft-graph capability extension.
 *
 * Mirrors the structure of `openai-codex-oauth.ts` 1:1 — same loopback-redirect
 * + PKCE shape, same manual-paste fallback, same proxy-aware fetch. The only
 * differences are the per-tenant authorize/token URLs and Microsoft-specific
 * response fields (id_token, account JWT claims).
 *
 * Why we don't use MSAL Node:
 *  - The desktop app already has a native loopback OAuth implementation tested
 *    against OpenAI and Google. Reusing the shape keeps audit surface small
 *    and avoids a new ~3 MB dependency.
 *  - MSAL's value-adds (cross-process token cache, B2C policies, broker auth)
 *    are not relevant for a single-user desktop app talking to Graph.
 *  - The interface stays compatible — we can swap to MSAL later without
 *    changing call sites if Conditional Access ever requires broker auth.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { proxyAwareFetch } from './proxy-fetch';

const REDIRECT_URI = 'http://localhost:53682/callback';
const REDIRECT_PORT = 53682;
const REDIRECT_PATH = '/callback';

// Default delegated scopes. Must match the scopes that the tenant's app
// registration has consented to. Caller can override if their registration
// uses a narrower set.
export const DEFAULT_GRAPH_SCOPES = [
  'offline_access',
  'openid',
  'profile',
  'email',
  'User.Read',
  'Mail.Read',
  'Mail.ReadWrite',
  'Mail.Send',
  'Calendars.Read',
];

const SUCCESS_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Sign-in successful</title>
  <style>body{font-family:-apple-system,Segoe UI,sans-serif;max-width:480px;margin:80px auto;padding:24px;color:#222}</style>
</head>
<body>
  <h2>Sign-in successful</h2>
  <p>You can close this tab and return to Ministry of Education.</p>
</body>
</html>`;

export interface MicrosoftGraphOAuthCredentials {
  access: string;
  refresh: string;
  expires: number;
  /** UPN (user principal name) — typically the user's email. */
  email?: string;
  /** Entra `oid` claim — stable per-user identifier within the tenant. */
  accountId: string;
  /** Tenant ID resolved from the id_token (`tid`); useful to confirm the
   * token came from the expected tenant. */
  tenantId: string;
  /** Granted scopes returned by the token endpoint (space-delimited). */
  scope: string;
}

export interface MicrosoftGraphAuthorizationFlow {
  verifier: string;
  state: string;
  url: string;
}

interface LocalServer {
  close: () => void;
  waitForCode: () => Promise<{ code: string } | null>;
}

function toBase64Url(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function createPkce(): { verifier: string; challenge: string } {
  const verifier = toBase64Url(randomBytes(32));
  const challenge = toBase64Url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function createState(): string {
  return toBase64Url(randomBytes(32));
}

function authorizeUrlFor(tenantId: string): string {
  return `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/authorize`;
}

function tokenUrlFor(tenantId: string): string {
  return `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;
}

function parseAuthorizationInput(input: string): { code?: string; state?: string } {
  const value = input.trim();
  if (!value) return {};
  try {
    const url = new URL(value);
    return {
      code: url.searchParams.get('code') ?? undefined,
      state: url.searchParams.get('state') ?? undefined,
    };
  } catch {
    // not a URL — treat as raw code
  }
  if (value.includes('code=')) {
    const params = new URLSearchParams(value);
    return {
      code: params.get('code') ?? undefined,
      state: params.get('state') ?? undefined,
    };
  }
  return { code: value };
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export interface CreateAuthorizationFlowParams {
  tenantId: string;
  clientId: string;
  scopes?: string[];
  /** Force account picker even if the user is already signed in elsewhere. */
  promptSelectAccount?: boolean;
}

function createAuthorizationFlow(params: CreateAuthorizationFlowParams): MicrosoftGraphAuthorizationFlow {
  const { verifier, challenge } = createPkce();
  const state = createState();
  const scopes = (params.scopes ?? DEFAULT_GRAPH_SCOPES).join(' ');
  const url = new URL(authorizeUrlFor(params.tenantId));
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('response_mode', 'query');
  url.searchParams.set('scope', scopes);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  if (params.promptSelectAccount) {
    url.searchParams.set('prompt', 'select_account');
  }
  return { verifier, state, url: url.toString() };
}

function startLocalOAuthServer(state: string): Promise<LocalServer | null> {
  let lastCode: string | null = null;

  const server = createServer((req, res) => {
    try {
      const url = new URL(req.url || '', 'http://localhost');
      if (url.pathname !== REDIRECT_PATH) {
        res.statusCode = 404;
        res.end('Not found');
        return;
      }

      const error = url.searchParams.get('error');
      if (error) {
        res.statusCode = 400;
        const description = url.searchParams.get('error_description') || '';
        res.end(`Microsoft sign-in error: ${error}\n${description}`);
        return;
      }

      if (url.searchParams.get('state') !== state) {
        res.statusCode = 400;
        res.end('State mismatch');
        return;
      }

      const code = url.searchParams.get('code');
      if (!code) {
        res.statusCode = 400;
        res.end('Missing authorization code');
        return;
      }

      lastCode = code;
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(SUCCESS_HTML);
    } catch {
      res.statusCode = 500;
      res.end('Internal error');
    }
  });

  return new Promise((resolve) => {
    server
      .listen(REDIRECT_PORT, 'localhost', () => {
        resolve({
          close: () => server.close(),
          waitForCode: async () => {
            const sleep = () => new Promise((r) => setTimeout(r, 100));
            // Wait up to 10 minutes for the user to complete sign-in.
            for (let i = 0; i < 6000; i += 1) {
              if (lastCode) return { code: lastCode };
              await sleep();
            }
            return null;
          },
        });
      })
      .on('error', () => resolve(null));
  });
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  id_token?: string;
}

async function exchangeAuthorizationCode(
  params: { tenantId: string; clientId: string; code: string; verifier: string; scopes: string[] },
): Promise<MicrosoftGraphOAuthCredentials> {
  const response = await proxyAwareFetch(tokenUrlFor(params.tenantId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: params.clientId,
      code: params.code,
      code_verifier: params.verifier,
      redirect_uri: REDIRECT_URI,
      scope: params.scopes.join(' '),
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Microsoft token exchange failed (${response.status}): ${text}`);
  }
  const json = (await response.json()) as TokenResponse;
  return finalizeCredentials(json);
}

export async function refreshMicrosoftGraphToken(
  params: { tenantId: string; clientId: string; refreshToken: string; scopes?: string[] },
): Promise<MicrosoftGraphOAuthCredentials> {
  const scopes = params.scopes ?? DEFAULT_GRAPH_SCOPES;
  const response = await proxyAwareFetch(tokenUrlFor(params.tenantId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: params.clientId,
      refresh_token: params.refreshToken,
      scope: scopes.join(' '),
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Microsoft token refresh failed (${response.status}): ${text}`);
  }
  const json = (await response.json()) as TokenResponse;
  return finalizeCredentials(json);
}

function finalizeCredentials(json: TokenResponse): MicrosoftGraphOAuthCredentials {
  if (!json.access_token || typeof json.expires_in !== 'number') {
    throw new Error('Microsoft token response missing access_token or expires_in');
  }
  if (!json.refresh_token) {
    // Without offline_access, the response has no refresh_token. We fail loud
    // because every realistic agent workflow needs token refresh.
    throw new Error('Microsoft token response missing refresh_token (was offline_access scope granted?)');
  }
  const idClaims = json.id_token ? decodeJwtPayload(json.id_token) : null;
  const accessClaims = decodeJwtPayload(json.access_token);
  const accountId =
    (idClaims?.oid as string | undefined) ?? (accessClaims?.oid as string | undefined) ?? '';
  const tenantId =
    (idClaims?.tid as string | undefined) ?? (accessClaims?.tid as string | undefined) ?? '';
  const email =
    (idClaims?.preferred_username as string | undefined) ??
    (idClaims?.email as string | undefined) ??
    (idClaims?.upn as string | undefined) ??
    (accessClaims?.upn as string | undefined);
  if (!accountId || !tenantId) {
    throw new Error('Microsoft token missing oid/tid claims; cannot identify account');
  }
  return {
    access: json.access_token,
    refresh: json.refresh_token,
    expires: Date.now() + json.expires_in * 1000,
    accountId,
    tenantId,
    email,
    scope: json.scope ?? '',
  };
}

export interface LoginMicrosoftGraphOptions {
  tenantId: string;
  clientId: string;
  scopes?: string[];
  promptSelectAccount?: boolean;
  openUrl: (url: string) => Promise<void>;
  onProgress?: (message: string) => void;
  onManualCodeRequired?: (payload: {
    authorizationUrl: string;
    reason: 'port_in_use' | 'callback_timeout';
  }) => void;
  onManualCodeInput?: () => Promise<string>;
}

export async function loginMicrosoftGraphOAuth(
  options: LoginMicrosoftGraphOptions,
): Promise<MicrosoftGraphOAuthCredentials> {
  const scopes = options.scopes ?? DEFAULT_GRAPH_SCOPES;
  const { verifier, state, url } = createAuthorizationFlow({
    tenantId: options.tenantId,
    clientId: options.clientId,
    scopes,
    promptSelectAccount: options.promptSelectAccount,
  });
  options.onProgress?.('Opening Microsoft sign-in page…');

  const server = await startLocalOAuthServer(state);

  try {
    await options.openUrl(url);
    options.onProgress?.(
      server
        ? 'Waiting for Microsoft sign-in callback…'
        : 'Callback port unavailable, waiting for manual authorization code…',
    );

    let code: string | undefined;
    if (server) {
      const result = await server.waitForCode();
      code = result?.code ?? undefined;
      if (!code && options.onManualCodeInput) {
        options.onManualCodeRequired?.({ authorizationUrl: url, reason: 'callback_timeout' });
        code = await options.onManualCodeInput();
      }
    } else {
      if (!options.onManualCodeInput) {
        throw new Error(
          `Cannot start Microsoft OAuth callback server on localhost:${REDIRECT_PORT}`,
        );
      }
      options.onManualCodeRequired?.({ authorizationUrl: url, reason: 'port_in_use' });
      code = await options.onManualCodeInput();
    }

    if (!code) throw new Error('Missing Microsoft authorization code');

    const parsed = parseAuthorizationInput(code);
    if (parsed.state && parsed.state !== state) {
      throw new Error('Microsoft OAuth state mismatch');
    }
    code = parsed.code;
    if (!code) throw new Error('Missing Microsoft authorization code');

    return await exchangeAuthorizationCode({
      tenantId: options.tenantId,
      clientId: options.clientId,
      code,
      verifier,
      scopes,
    });
  } finally {
    server?.close();
  }
}
