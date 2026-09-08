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

// Default delegated scopes. This is the read-only baseline the Ministry's
// admin consent actually covers (offline_access + User.Read + Mail.Read).
// Requesting anything richer by default makes every in-app sign-in fail with
// a consent error, so richer sets (Mail.ReadWrite, Mail.Send, Calendars.Read)
// must be opted into explicitly via config.scopes once consent is granted.
export const DEFAULT_GRAPH_SCOPES = [
  'offline_access',
  'User.Read',
  'Mail.Read',
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

/**
 * The user ended sign-in on Microsoft's page (Cancel / "No, don't allow" /
 * consent declined). Entra redirects to the loopback with `error=access_denied`
 * (OAuth 2.0 authorization error response). A distinct type lets callers show
 * a neutral "cancelled" outcome instead of an error toast or a 10-minute wait.
 */
export class MicrosoftGraphSignInDeclined extends Error {
  constructor(message = 'Microsoft sign-in was cancelled') {
    super(message);
    this.name = 'MicrosoftGraphSignInDeclined';
  }
}

export type OAuthCallbackResult =
  | { kind: 'code'; code: string }
  | { kind: 'error'; error: string; description: string }
  | { kind: 'state_mismatch' }
  | { kind: 'missing_code' }
  | { kind: 'not_callback' };

/**
 * Pure interpretation of one loopback request against the expected CSRF
 * state. Exported for tests; the local HTTP server delegates here.
 */
export function interpretOAuthCallback(rawUrl: string, expectedState: string): OAuthCallbackResult {
  const url = new URL(rawUrl || '', 'http://localhost');
  if (url.pathname !== REDIRECT_PATH) return { kind: 'not_callback' };
  // CSRF state first: a callback that does not carry the pending request's
  // state is not part of our flow, so neither its code nor its error may be
  // attributed to it. Entra echoes `state` on both success and error
  // redirects (OAuth 2.0 §4.1.2 / §4.1.2.1), so genuine cancels still match.
  // Without this ordering, anything able to reach the loopback could cancel
  // the real sign-in by sending error=access_denied with no/forged state.
  if (url.searchParams.get('state') !== expectedState) return { kind: 'state_mismatch' };
  const error = url.searchParams.get('error');
  if (error) {
    return { kind: 'error', error, description: url.searchParams.get('error_description') || '' };
  }
  const code = url.searchParams.get('code');
  if (!code) return { kind: 'missing_code' };
  return { kind: 'code', code };
}

interface LocalServer {
  close: () => void;
  waitForCode: () => Promise<
    { code: string } | { error: string; description: string } | null
  >;
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
  let lastError: { error: string; description: string } | null = null;

  const server = createServer((req, res) => {
    try {
      const result = interpretOAuthCallback(req.url || '', state);
      switch (result.kind) {
        case 'not_callback':
          res.statusCode = 404;
          res.end('Not found');
          return;
        case 'error':
          // Entra redirected back with an OAuth error (e.g. access_denied when
          // the user cancels). Record it so waitForCode resolves immediately
          // instead of waiting out the 10-minute window.
          lastError = { error: result.error, description: result.description };
          res.statusCode = 400;
          // Plain text so a crafted error_description is never interpreted
          // as HTML by the browser (no content sniffing).
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end(`Microsoft sign-in error: ${result.error}\n${result.description}`);
          return;
        case 'state_mismatch':
          res.statusCode = 400;
          res.end('State mismatch');
          return;
        case 'missing_code':
          res.statusCode = 400;
          res.end('Missing authorization code');
          return;
        case 'code':
          lastCode = result.code;
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(SUCCESS_HTML);
          return;
      }
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
              if (lastError) return lastError;
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
    // Attach the OAuth error code (e.g. invalid_grant when the refresh token
    // is expired/revoked, interaction_required under Conditional Access) so
    // callers can distinguish "sign in again" from transient failures.
    let oauthError: string | undefined;
    try {
      oauthError = (JSON.parse(text) as { error?: string }).error;
    } catch {
      // non-JSON body: leave the code unset
    }
    const err = new Error(`Microsoft token refresh failed (${response.status}): ${text}`);
    (err as Error & { oauthError?: string }).oauthError = oauthError;
    throw err;
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
      if (result && 'error' in result) {
        // The user completed the redirect with an OAuth error instead of a
        // code. access_denied means they cancelled/declined on Microsoft's
        // page — a normal user decision, surfaced as a typed outcome. Other
        // errors (consent policy, tenant restrictions) fail loud with detail.
        if (result.error === 'access_denied') {
          throw new MicrosoftGraphSignInDeclined();
        }
        throw new Error(
          `Microsoft sign-in failed (${result.error})${result.description ? `: ${result.description}` : ''}`,
        );
      }
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
