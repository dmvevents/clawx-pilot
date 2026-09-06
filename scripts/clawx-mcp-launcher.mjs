#!/usr/bin/env node
/**
 * clawx-mcp-launcher.mjs — token-free launcher for the ClawX MCP adapter
 * (CLWX-71, Codex M3 fix).
 *
 * Registering the server with the token inline (`claude mcp add clawx -e
 * CLAWX_HOST_API_TOKEN=... -- node ...`) puts the credential in the
 * REGISTRATION process's argv — visible to process-argument capture even
 * though the server itself reads env. This launcher removes the token from
 * every argv: it recovers the per-boot host-API token IN-PROCESS from the
 * running app's gateway child env (the established KERN_PROCARGS2
 * mechanism, macOS) and starts the stdio server directly with the token
 * held in memory only.
 *
 * Registration (no secret anywhere):
 *   claude mcp add clawx -- node scripts/clawx-mcp-launcher.mjs
 *
 * Precedence: an already-set CLAWX_HOST_API_TOKEN env var wins (supported
 * cross-platform); recovery is the macOS fallback for interactive use.
 */
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { startServer } from './clawx-mcp-server.mjs';

const APP_NAME = 'Ministry of Education';

const PROCARGS_SNIPPET = `
import ctypes, ctypes.util, struct, sys
libc = ctypes.CDLL(ctypes.util.find_library('c'))
pid = int(sys.argv[1])
mib = (ctypes.c_int * 3)(1, 49, pid)  # CTL_KERN, KERN_PROCARGS2
size = ctypes.c_size_t(0)
if libc.sysctl(mib, 3, None, ctypes.byref(size), None, 0) != 0: sys.exit(1)
buf = ctypes.create_string_buffer(size.value)
if libc.sysctl(mib, 3, buf, ctypes.byref(size), None, 0) != 0: sys.exit(1)
for s in buf.raw[4:size.value].split(b'\\x00'):
    if s.startswith(b'CLAWX_HOST_API_TOKEN='):
        sys.stdout.write(s.split(b'=', 1)[1].decode()); sys.exit(0)
sys.exit(3)
`;

function fail(msg) {
  process.stderr.write(`FATAL: ${msg}\n`);
  process.exit(4);
}

function recoverToken() {
  const env = process.env.CLAWX_HOST_API_TOKEN;
  if (env && env.trim()) return env.trim();
  if (process.platform !== 'darwin') {
    fail('CLAWX_HOST_API_TOKEN is not set and in-process recovery is macOS-only. Set the env var (never argv).');
  }
  const pg = spawnSync('pgrep', ['-f', `${APP_NAME}.app/Contents/MacOS/${APP_NAME}$`], { encoding: 'utf-8' });
  const appPid = Number(pg.stdout.trim().split('\n')[0]);
  if (pg.status !== 0 || !appPid) fail(`the "${APP_NAME}" app is not running — start it first (the host-API token is per-boot).`);
  const ps = spawnSync('ps', ['-axo', 'pid=,ppid=,comm='], { encoding: 'utf-8' });
  let gatewayPid = null;
  for (const line of ps.stdout.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (m && Number(m[2]) === appPid && /openclaw-gateway/.test(m[3])) { gatewayPid = Number(m[1]); break; }
  }
  if (!gatewayPid) fail('no openclaw-gateway child of the app was found — is the gateway running?');
  const res = spawnSync('python3', ['-c', PROCARGS_SNIPPET, String(gatewayPid)], { encoding: 'utf-8', timeout: 15_000 });
  const token = (res.stdout ?? '').trim();
  if (res.status !== 0 || !token) fail('could not recover the host-API token from the gateway process env.');
  return token;
}

function isDirectInvocation() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(path.resolve(process.argv[1]))).href;
  } catch {
    return false;
  }
}

if (isDirectInvocation()) {
  startServer(recoverToken()).catch((err) => {
    process.stderr.write(`clawx-mcp-launcher crashed: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exit(1);
  });
}
