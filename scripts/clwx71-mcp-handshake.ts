/**
 * CLWX-71 — MCP adapter live handshake + gate proof.
 *
 * Spawns scripts/clawx-mcp-server.mjs over stdio exactly as an MCP client
 * would, using the SDK's own Client, and proves against the RUNNING app:
 *   1. HANDSHAKE + INVENTORY — initialize succeeds; tools/list returns the
 *      full 9-tool table (set equality).
 *   2. GATE PROOF (refusal leg) — outlook_send_email WITHOUT confirm
 *      travels MCP → adapter → host-API → the outlook manager's hard gate
 *      and comes back status:"refused" (never sent): the server-side gate
 *      rules the MCP surface end-to-end. (The forms submit refusal is
 *      recorded too, but the INSTALLED app on this Mac is moe.10, which
 *      predates the /api/forms/* routes — that leg returns the relayed 404
 *      readably today and becomes provable on the next build.)
 *   3. READ LEG (recorded honestly) — outlook_read_inbox through MCP; on a
 *      wedged Chrome this returns the manager's readable error, which
 *      proves the proxy path but not the read itself (status recorded, does
 *      not gate this harness).
 *
 * The confirmed-submit leg (gate proof, positive half) and the
 * Claude-Code-registered client leg remain on the card — sandbox +
 * operator-session gated.
 *
 * Token recovery: the established KERN_PROCARGS2 pattern (clwx65 lane) —
 * held in memory, passed to the child via env only, never logged.
 *
 * Run: pnpm exec tsx scripts/clwx71-mcp-handshake.ts
 * Exit: 0 = handshake + inventory + refusal gate all held; 4 = lane not
 * available (app down / token unrecoverable); 1 = a proof failed.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_PATH = join(REPO_ROOT, 'scripts', 'clawx-mcp-server.mjs');
const APP_NAME = 'Ministry of Education';
const HOST_API_PORT = 13210;

const EXPECTED_TOOLS = [
  'forms_list', 'forms_preview_daily_report', 'forms_submit_daily_report',
  'forms_preview_suspension', 'forms_submit_suspension',
  'outlook_open', 'outlook_read_inbox', 'outlook_draft_email', 'outlook_send_email',
].sort();

function log(msg: string): void {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}
function fatal(code: number, msg: string): never {
  console.error(`FATAL: ${msg}`);
  process.exit(code);
}

function httpStatus(port: number): Promise<number | null> {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 3_000 }, (res) => {
      res.resume();
      resolve(res.statusCode ?? null);
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

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

function recoverToken(): string {
  const env = process.env.CLAWX_HOST_API_TOKEN;
  if (env && env.trim()) return env.trim();
  const pg = spawnSync('pgrep', ['-f', `${APP_NAME}.app/Contents/MacOS/${APP_NAME}$`], { encoding: 'utf-8' });
  const appPid = Number(pg.stdout.trim().split('\n')[0]);
  if (pg.status !== 0 || !appPid) fatal(4, `app "${APP_NAME}" is not running`);
  const ps = spawnSync('ps', ['-axo', 'pid=,ppid=,comm='], { encoding: 'utf-8' });
  let gatewayPid: number | null = null;
  for (const line of ps.stdout.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (m && Number(m[2]) === appPid && /openclaw-gateway/.test(m[3])) { gatewayPid = Number(m[1]); break; }
  }
  if (!gatewayPid) fatal(4, 'no openclaw-gateway child process');
  const res = spawnSync('python3', ['-c', PROCARGS_SNIPPET, String(gatewayPid)], { encoding: 'utf-8', timeout: 15_000 });
  const token = (res.stdout ?? '').trim();
  if (res.status !== 0 || !token) fatal(4, `could not recover host-API token (python exit ${res.status})`);
  return token;
}

function firstText(result: { content?: Array<{ type?: string; text?: string }> }): string {
  const block = (result.content ?? []).find((c) => c.type === 'text');
  return String(block?.text ?? '');
}

(async () => {
  console.log('=== CLWX-71 MCP adapter: handshake + inventory + gate proof (refusal leg) ===');
  if ((await httpStatus(HOST_API_PORT)) === null) fatal(4, `host-API ${HOST_API_PORT} not reachable — app not running`);
  const token = recoverToken();
  log('token recovered (in-memory only)');

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_PATH],
    env: { ...process.env, CLAWX_HOST_API_TOKEN: token } as Record<string, string>,
    stderr: 'pipe',
  });
  const client = new Client({ name: 'clwx71-handshake', version: '0.0.1' });
  await client.connect(transport);
  log('PROOF 1a: MCP initialize handshake OK');

  const tools = await client.listTools();
  const names = tools.tools.map((t) => t.name).sort();
  if (JSON.stringify(names) !== JSON.stringify(EXPECTED_TOOLS)) {
    fatal(1, `tool inventory mismatch.\n  expected: ${EXPECTED_TOOLS.join(', ')}\n  got:      ${names.join(', ')}`);
  }
  const sendTool = tools.tools.find((t) => t.name === 'outlook_send_email');
  if (!/confirm/i.test(String(sendTool?.description)) || !/gate/i.test(String(sendTool?.description))) {
    fatal(1, 'outlook_send_email description does not carry the gate contract');
  }
  log(`PROOF 1b: tools/list = ${names.length}/9 exact-set match; gate contract present in descriptions`);

  // PROOF 2 — the hard gate rules the MCP surface: SEND without confirm.
  // A subject that matches no draft: even a gate bug cannot reach a real
  // send, and the expected result is the manager's pre-browser refusal.
  const refusal = await client.callTool({
    name: 'outlook_send_email',
    arguments: { subject: 'clwx71-gate-probe-nonexistent-draft' },
  });
  const refusalText = firstText(refusal as { content?: Array<{ type?: string; text?: string }> });
  if (/"status"\s*:\s*"sent"/.test(refusalText)) {
    fatal(1, `GATE BREACH: send without confirm reported sent!\n${refusalText.slice(0, 400)}`);
  }
  // The refusal must be THE CONFIRM GATE specifically ("confirm flag not
  // set") — a downstream refusal like "No open draft found" also says
  // "confirm" and previously false-PASSed this proof (Codex M2 mutation:
  // adding confirm:true still exited 0). Exact-reason matching closes it.
  if (!/"status"\s*:\s*"refused"/.test(refusalText) || !/confirm flag not set/i.test(refusalText)) {
    fatal(1, `expected the CONFIRM-GATE refusal ("confirm flag not set"), got: ${refusalText.slice(0, 300)}`);
  }
  log(`PROOF 2: outlook_send_email WITHOUT confirm → status "refused" end-to-end (never sent). Refusal head: ${refusalText.replace(/\s+/g, ' ').slice(0, 140)}`);

  // PROOF 2b (recorded, non-gating today) — forms submit without confirm.
  // The INSTALLED app is moe.10 (no /api/forms routes): expect the relayed
  // 404 readably; on a current build this must be a confirm refusal. Either
  // way "submitted" is a breach.
  const formsRefusal = await client.callTool({ name: 'forms_submit_daily_report', arguments: {} });
  const formsText = firstText(formsRefusal as { content?: Array<{ type?: string; text?: string }> });
  if (/"status"\s*:\s*"submitted"/.test(formsText)) {
    fatal(1, `GATE BREACH: forms submit without confirm reported submitted!\n${formsText.slice(0, 400)}`);
  }
  log(`PROOF 2b (recorded): forms_submit_daily_report without confirm → ${formsText.replace(/\s+/g, ' ').slice(0, 120)}`);

  // PROOF 3 (recorded, non-gating) — read leg through the proxy.
  const read = await client.callTool({ name: 'outlook_read_inbox', arguments: { top: 3 } });
  const readText = firstText(read as { content?: Array<{ type?: string; text?: string }> });
  const readOk = /"status"\s*:\s*"ok"/.test(readText) && /"messages"/.test(readText);
  log(`PROOF 3 (recorded): outlook_read_inbox via MCP → ${readOk ? 'LIVE READ OK' : `readable non-read result (lane-dependent): ${readText.replace(/\s+/g, ' ').slice(0, 140)}`}`);

  await client.close();
  console.log('\nVERDICT: PASS — handshake, exact 9-tool inventory, and the no-confirm refusal gate all held through the MCP surface.');
  console.log(`Read leg: ${readOk ? 'live read succeeded' : 'recorded as lane-dependent (Chrome attach state); proxy path proven by the readable result'}.`);
  process.exit(0);
})().catch((e) => {
  console.error('FATAL:', e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
