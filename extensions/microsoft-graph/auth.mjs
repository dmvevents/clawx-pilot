/**
 * Entra ID OAuth2 helpers for the microsoft-graph plugin.
 *
 * Two flows are supported:
 *   - auth-code-pkce: best for the desktop app; opens a system browser, captures
 *     the redirect on a one-shot loopback HTTP server, then exchanges the code.
 *   - device-code: best for headless or restricted hosts; the user opens
 *     https://microsoft.com/devicelogin in any browser and enters a short code.
 *
 * Tokens are cached in memory only here. The host (ClawX/openclaw) must persist
 * { accessToken, refreshToken, expiresAt, scope, account } in a place
 * appropriate for its security model — typically the OS keychain via
 * provider-runtime-sync. See bindToProviderStore() below for the wiring point.
 *
 * No live calls happen until the plugin is configured and the user signs in.
 */

import crypto from 'node:crypto';

const GRAPH_BASE = 'https://login.microsoftonline.com';

/** Build the OIDC endpoint URLs for a tenant. */
export function endpointsFor(tenantId) {
  if (!tenantId) throw new Error('microsoft-graph: tenantId is required');
  const base = `${GRAPH_BASE}/${encodeURIComponent(tenantId)}/oauth2/v2.0`;
  return {
    authorize: `${base}/authorize`,
    token: `${base}/token`,
    deviceCode: `${base}/devicecode`,
  };
}

function base64UrlEncode(buf) {
  return Buffer.from(buf).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

/** Generate a PKCE pair. The verifier is opaque; the challenge is its SHA-256. */
export function generatePkce() {
  const verifier = base64UrlEncode(crypto.randomBytes(32));
  const challenge = base64UrlEncode(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge, method: 'S256' };
}

/**
 * Build the authorization URL the user should open in their browser.
 * The host should pass the returned `state` back when handling the redirect
 * to defend against CSRF.
 */
export function buildAuthorizeUrl({ tenantId, clientId, redirectUri, scopes, prompt }) {
  const { authorize } = endpointsFor(tenantId);
  const state = base64UrlEncode(crypto.randomBytes(16));
  const pkce = generatePkce();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: scopes.join(' '),
    state,
    code_challenge: pkce.challenge,
    code_challenge_method: pkce.method,
  });
  if (prompt) params.set('prompt', prompt);
  return { url: `${authorize}?${params.toString()}`, state, pkce };
}

/** Exchange a redirect's `code` for tokens (auth-code-pkce). */
export async function exchangeCode({ tenantId, clientId, redirectUri, code, codeVerifier, scopes }) {
  const { token } = endpointsFor(tenantId);
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
    scope: scopes.join(' '),
  });
  return await postForm(token, body);
}

/** Refresh an expired access token. */
export async function refreshAccessToken({ tenantId, clientId, refreshToken, scopes }) {
  const { token } = endpointsFor(tenantId);
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: scopes.join(' '),
  });
  return await postForm(token, body);
}

/**
 * Begin the device-code flow. Returns { user_code, verification_uri, device_code,
 * expires_in, interval }. Show user_code + verification_uri to the user, then
 * call pollDeviceCode() with device_code.
 */
export async function startDeviceCode({ tenantId, clientId, scopes }) {
  const { deviceCode } = endpointsFor(tenantId);
  const body = new URLSearchParams({
    client_id: clientId,
    scope: scopes.join(' '),
  });
  return await postForm(deviceCode, body);
}

/** Poll the token endpoint until the user completes the device-code flow. */
export async function pollDeviceCode({ tenantId, clientId, deviceCode, intervalSeconds = 5 }) {
  const { token } = endpointsFor(tenantId);
  while (true) {
    const body = new URLSearchParams({
      client_id: clientId,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: deviceCode,
    });
    try {
      return await postForm(token, body);
    } catch (err) {
      const reason = err && typeof err === 'object' ? err.errorCode : null;
      if (reason === 'authorization_pending') {
        await sleep(intervalSeconds * 1000);
        continue;
      }
      if (reason === 'slow_down') {
        intervalSeconds += 5;
        await sleep(intervalSeconds * 1000);
        continue;
      }
      throw err;
    }
  }
}

async function postForm(url, body) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const err = new Error(json.error_description || `HTTP ${resp.status}`);
    err.status = resp.status;
    err.errorCode = json.error;
    err.raw = json;
    throw err;
  }
  return json;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/**
 * Wiring point — left intentionally empty in the stub. The host should call
 * this with a setter/getter pair that persists tokens via the same mechanism
 * used for other OAuth providers (electron/services/providers/provider-runtime-sync.ts).
 */
export function bindToProviderStore(_persistence) {
  // no-op until the host opts in
}
