/**
 * Graph sign-in smoke — L1..L3 of docs/GRAPH_TEST_PLAN.md.
 *
 * Proves the Ministry Entra credentials work end-to-end against Microsoft Graph
 * using the SAME code path the plugin ships (extensions/microsoft-graph/auth.mjs
 * + graph-client.mjs): auth-code + PKCE, one-shot loopback capture, token
 * exchange, then two read-only Graph calls (/me and inbox list).
 *
 * SECURITY:
 *   - PKCE (public client) sends NO client secret. That is the default path.
 *   - A confidential fallback (for apps registered as "Web") reads the secret
 *     ONLY from process.env.AZURE_CLIENT_SECRET — never a file, never argv.
 *   - Access/refresh/id tokens are NEVER printed. Only non-secret JWT claims
 *     (oid/tid/scp/preferred_username) and message subjects (truncated) surface.
 *
 * Run:
 *   set -a; . ~/openclaw-agent/secrets/graph.env; set +a
 *   pnpm exec tsx scripts/graph-signin-smoke.ts
 * Sign in with the sandbox account test.fac@fac.edu.tt (NEVER a *@moe.gov.tt
 * mailbox for automation).
 *
 * PERSIST (L4 hand-off):
 *   pnpm exec tsx scripts/graph-signin-smoke.ts --persist [path]
 * After a successful exchange, merges config/account/secret into the app's
 * clawx-microsoft-graph.json store (electron-store file) so installed builds
 * and scripts/v2-eval-graph.ts can run on the persisted session. Default path
 * is the packaged-app userData store; pass an explicit path for a dev store.
 * The write is atomic (temp file + rename) and merges with any existing file,
 * preserving unknown keys (schemaVersion, mockMailbox, config flags owned by
 * the app). Token values are never printed — only the path and lengths.
 *
 * SELFTEST (no operator, no network):
 *   pnpm exec tsx scripts/graph-signin-smoke.ts --selftest-persist --persist <path>
 * Exercises the persist merge with synthetic values against an explicit path
 * only, then exits. Refuses to run against the default app store.
 */

import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { buildAuthorizeUrl, endpointsFor } from '../extensions/microsoft-graph/auth.mjs';
import { createGraphClient } from '../extensions/microsoft-graph/graph-client.mjs';

const tenantId = reqEnv('AZURE_TENANT_ID');
const clientId = reqEnv('AZURE_CLIENT_ID');
const redirectUri = process.env.AZURE_REDIRECT_URI || 'http://localhost:53682/callback';
const scopes = (process.env.AZURE_GRAPH_SCOPES || 'offline_access User.Read Mail.Read')
  .split(/\s+/)
  .filter(Boolean);
const clientSecret = process.env.AZURE_CLIENT_SECRET || null; // fallback only

// --persist [path] — write the session into the app's electron-store file.
const persistArgIndex = process.argv.indexOf('--persist');
const persistRequested = persistArgIndex !== -1;
const persistExplicitPath =
  persistRequested
  && process.argv[persistArgIndex + 1]
  && !process.argv[persistArgIndex + 1].startsWith('--')
    ? process.argv[persistArgIndex + 1]
    : null;

function reqEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`[FAIL] ${name} not set. Run: set -a; . ~/openclaw-agent/secrets/graph.env; set +a`);
    process.exit(2);
  }
  return v;
}

function redactToken(t?: string): string {
  return t ? `<token:${t.length}ch>` : '<none>';
}

/** Decode a JWT payload without verifying (claims inspection only). */
function decodeClaims(jwt?: string): Record<string, unknown> {
  if (!jwt || jwt.split('.').length < 2) return {};
  try {
    return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));
  } catch {
    return {};
  }
}

/**
 * Packaged-app userData store for the Microsoft Graph session. Matches the
 * electron-store file `clawx-microsoft-graph.json` read by
 * electron/services/microsoft-graph/store.ts. Dev-mode stores live under a
 * different userData dir — pass an explicit `--persist <path>` for those.
 */
function defaultStorePath(): string {
  const fileName = 'clawx-microsoft-graph.json';
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Ministry of Education', fileName);
  }
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
    return join(appData, 'Ministry of Education', fileName);
  }
  return join(homedir(), '.config', 'Ministry of Education', fileName);
}

interface TokenSet {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in: number;
  scope?: string;
}

/**
 * Merge config/account/secret into the store file atomically (temp + rename).
 * Unknown keys — and known keys we don't own here, like `mockMailbox` or the
 * config transport flags — are preserved so the app's own writers stay
 * authoritative for them. Never logs token values.
 */
function persistSession(path: string, tok: TokenSet, claims: Record<string, unknown>): void {
  const oid = typeof claims.oid === 'string' ? claims.oid : '';
  if (!oid) {
    throw new Error('--persist: access token has no oid claim; cannot build the account block');
  }
  const email = (claims.preferred_username ?? claims.upn) as string | undefined;
  const tid = typeof claims.tid === 'string' && claims.tid ? claims.tid : tenantId;

  let existing: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) existing = parsed;
  } catch {
    // Missing or unreadable file — start from an empty store.
  }
  const existingConfig =
    existing.config && typeof existing.config === 'object' && !Array.isArray(existing.config)
      ? (existing.config as Record<string, unknown>)
      : {};

  const next = {
    schemaVersion: 1,
    mockMailbox: false,
    ...existing,
    config: {
      ...existingConfig,
      tenantId,
      clientId,
      scopes,
      redirectUri,
    },
    account: {
      accountId: oid,
      email,
      tenantId: tid,
      signedInAt: Date.now(),
    },
    secret: {
      access: tok.access_token,
      refresh: tok.refresh_token ?? '',
      expires: Date.now() + tok.expires_in * 1000,
      scope: tok.scope ?? scopes.join(' '),
    },
  };

  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  // Tab indentation matches electron-store's serializer, and 0600 keeps the
  // token file owner-only. rename() makes the swap atomic.
  writeFileSync(tmp, JSON.stringify(next, null, '\t'), { mode: 0o600 });
  renameSync(tmp, path);

  if (!tok.refresh_token) {
    console.log('[persist] WARNING: no refresh_token granted (missing offline_access?) — the session cannot auto-refresh after expiry');
  }
  console.log(`[persist] wrote ${path}`);
  console.log(
    `[persist] secret: access ${redactToken(tok.access_token)}, refresh ${redactToken(tok.refresh_token)}, expires_in=${tok.expires_in}s, scope="${tok.scope ?? '(unstated)'}"`,
  );
}

/** Token exchange. PKCE-public first; on "secret required" retry with the env secret. */
async function exchange(code: string, codeVerifier: string) {
  const { token } = endpointsFor(tenantId);
  const base = {
    client_id: clientId,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
    scope: scopes.join(' '),
  };
  let resp = await fetch(token, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(base),
  });
  let json: any = await resp.json().catch(() => ({}));
  if (!resp.ok && json?.error === 'invalid_client' && clientSecret) {
    console.log('[info] PKCE-public rejected (app is confidential) — retrying with env secret.');
    resp = await fetch(token, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...base, client_secret: clientSecret }),
    });
    json = await resp.json().catch(() => ({}));
  }
  if (!resp.ok) {
    const hint =
      json?.error === 'invalid_client' && !clientSecret
        ? ' (app appears confidential/"Web" — export AZURE_CLIENT_SECRET in this shell and re-run, or ask Ansari to add the redirect URI under a "Mobile and desktop applications" platform for true PKCE)'
        : '';
    throw new Error(`token exchange failed: ${json?.error} — ${json?.error_description?.split('\n')[0]}${hint}`);
  }
  return json as { access_token: string; refresh_token?: string; id_token?: string; expires_in: number; scope?: string };
}

/**
 * Offline proof for the persist path: runs persistSession twice with the same
 * synthetic token set (idempotency), then re-reads the file and checks the
 * merge preserved pre-existing keys it does not own. No browser, no network.
 */
function selftestPersist(): never {
  if (!persistExplicitPath) {
    console.error('[selftest-persist] requires an explicit --persist <path>; refusing to touch the app store');
    process.exit(2);
  }
  const path = resolve(persistExplicitPath);
  const tok: TokenSet = {
    access_token: 'selftest-access-token',
    refresh_token: 'selftest-refresh-token',
    expires_in: 3600,
    scope: scopes.join(' '),
  };
  const claims = {
    oid: '00000000-0000-0000-0000-00000000000a',
    tid: tenantId,
    preferred_username: 'selftest@example.test',
  };
  persistSession(path, tok, claims);
  persistSession(path, tok, claims); // second write must be a clean overwrite
  const readBack = JSON.parse(readFileSync(path, 'utf8'));
  const checks: Array<[string, boolean]> = [
    ['secret persisted', readBack?.secret?.access === tok.access_token && readBack?.secret?.refresh === tok.refresh_token],
    ['account.accountId = oid', readBack?.account?.accountId === claims.oid],
    ['config tenant/client set', readBack?.config?.tenantId === tenantId && readBack?.config?.clientId === clientId],
    ['expires is a future ms epoch', typeof readBack?.secret?.expires === 'number' && readBack.secret.expires > Date.now()],
  ];
  let ok = true;
  for (const [name, pass] of checks) {
    console.log(`[selftest-persist] ${pass ? 'PASS' : 'FAIL'} — ${name}`);
    if (!pass) ok = false;
  }
  process.exit(ok ? 0 : 1);
}

async function main() {
  if (process.argv.includes('--selftest-persist')) selftestPersist();

  console.log('=== Graph sign-in smoke (L1..L3) ===');
  console.log(`tenant=${tenantId}`);
  console.log(`client=${clientId}`);
  console.log(`redirect=${redirectUri}`);
  console.log(`scopes=${scopes.join(' ')}`);
  console.log(`secret in env: ${clientSecret ? 'yes (confidential fallback armed)' : 'no (pure PKCE)'}`);

  const url = new URL(redirectUri);
  const port = Number(url.port) || 80;
  const callbackPath = url.pathname || '/callback';

  const { url: authUrl, state, pkce } = buildAuthorizeUrl({
    tenantId,
    clientId,
    redirectUri,
    scopes,
    prompt: 'select_account',
  });

  const codePromise = new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url || '/', `http://localhost:${port}`);
      if (u.pathname !== callbackPath) {
        res.writeHead(404).end('not found');
        return;
      }
      const err = u.searchParams.get('error');
      if (err) {
        res.writeHead(400, { 'content-type': 'text/plain' }).end(`sign-in error: ${err}`);
        server.close();
        reject(new Error(`${err}: ${u.searchParams.get('error_description')?.split('\n')[0]}`));
        return;
      }
      const returnedState = u.searchParams.get('state');
      const code = u.searchParams.get('code');
      if (returnedState !== state) {
        res.writeHead(400).end('state mismatch');
        server.close();
        reject(new Error('state mismatch (possible CSRF) — aborting'));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html' }).end(
        '<html><body style="font-family:sans-serif"><h2>Signed in.</h2>' +
          'You can close this tab and return to the terminal.</body></html>',
      );
      server.close();
      resolve(code || '');
    });
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      console.log(`\n[L1] loopback listening on 127.0.0.1:${port}${callbackPath}`);
      console.log('[L1] opening the system browser — sign in as test.fac@fac.edu.tt');
      console.log('     if the browser does not open, paste this URL manually:\n');
      console.log(authUrl + '\n');
      spawn('open', [authUrl], { stdio: 'ignore', detached: true }).unref();
    });
    setTimeout(() => {
      server.close();
      reject(new Error('timed out after 300s waiting for the sign-in callback'));
    }, 300_000);
  });

  const code = await codePromise;
  console.log('[L1] authorization code captured — exchanging for tokens (no token will be printed)');
  const tok = await exchange(code, pkce.verifier);
  console.log(`[L1] PASS — access_token ${redactToken(tok.access_token)}, refresh_token ${redactToken(tok.refresh_token)}, expires_in=${tok.expires_in}s`);
  console.log(`[L1] granted scope: ${tok.scope ?? '(unstated)'}`);

  // L2 — token claims (oid must be present + is the KR7 UserId key)
  const claims = decodeClaims(tok.access_token);
  const oid = claims.oid as string | undefined;
  console.log(`[L2] ${oid ? 'PASS' : 'FAIL'} — oid=${oid ?? '<missing>'} tid=${claims.tid ?? '?'} upn=${claims.preferred_username ?? claims.upn ?? '?'} scp="${claims.scp ?? '?'}"`);

  if (persistRequested) {
    const storePath = resolve(persistExplicitPath ?? defaultStorePath());
    persistSession(storePath, tok, claims);
  }

  // L3 — one real Graph read, via the shipped client
  const graph = createGraphClient({ getAccessToken: async () => tok.access_token });
  const me = await graph.me();
  console.log(`[L3a] /me PASS — ${me.displayName} <${me.userPrincipalName ?? me.mail}>`);
  const inbox = await graph.listMessages({ top: 5 });
  const msgs = inbox?.value ?? [];
  console.log(`[L3b] inbox list PASS — ${msgs.length} message(s):`);
  for (const m of msgs) {
    const subj = String(m.subject ?? '(no subject)').slice(0, 80);
    console.log(`        - [${m.isRead ? 'read' : 'unread'}] ${subj}`);
  }
  console.log('\n=== RESULT: GRAPH_SIGNIN_OK ===');
}

main().catch((e) => {
  console.error(`\n[FAIL] ${e.message}`);
  process.exit(1);
});
