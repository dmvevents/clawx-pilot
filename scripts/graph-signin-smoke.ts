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
 */

import http from 'node:http';
import { spawn } from 'node:child_process';
import { buildAuthorizeUrl, endpointsFor } from '../extensions/microsoft-graph/auth.mjs';
import { createGraphClient } from '../extensions/microsoft-graph/graph-client.mjs';

const tenantId = reqEnv('AZURE_TENANT_ID');
const clientId = reqEnv('AZURE_CLIENT_ID');
const redirectUri = process.env.AZURE_REDIRECT_URI || 'http://localhost:53682/callback';
const scopes = (process.env.AZURE_GRAPH_SCOPES || 'offline_access User.Read Mail.Read')
  .split(/\s+/)
  .filter(Boolean);
const clientSecret = process.env.AZURE_CLIENT_SECRET || null; // fallback only

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

async function main() {
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
