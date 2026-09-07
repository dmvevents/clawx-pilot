/**
 * CLWX-43 — Mac-lane latency measurement: three demo-shaped prompts fired as
 * REAL in-app turns on the RUNNING Ministry of Education app.
 *
 * Latency is Raj's only twice-volunteered complaint; the 2026-09-02 first
 * cut mined driver JSONs on the e2 persona VM (79.6 / 103.4 / 182.2s
 * tool-turns, median ≈103s vs the proposed p50 ≤15s budget). This adds the
 * Mac lane: same wall-clock KPI (submit → the turn's `model.completed`
 * trajectory timestamp — the poll interval does NOT inflate the number),
 * current runtime, no Chrome/Outlook/Forms dependency.
 *
 * Drive mechanism: identical to scripts/clwx65-write-turn.ts (the proven
 * lane) — POST `/api/chat/send-with-media` on the host-API, which relays
 * over the app's own gateway connection via the same `chat.send` RPC the
 * composer uses; ground truth from the per-session trajectory JSONL. Token
 * recovered via KERN_PROCARGS2, held in memory, never logged.
 *
 * HONEST CAVEATS (printed + written into the report):
 *   - This is an M-series dev Mac, not the pilot laptop; the laptop-lane
 *     repeat remains the named remainder on the card.
 *   - n=1 per prompt shape (three shapes); a budget sign-off wants more
 *     samples — this is the current-runtime data point, not the full study.
 *   - The turns render in the app UI (same as the CLWX-65 lane) and P3
 *     writes one memo docx into ~/.openclaw/media/outbound (named, left in
 *     place as turn evidence).
 *
 * Scope guards: never touches Outlook/Forms/Chrome; never restarts the app;
 * never mutates ~/.openclaw config.
 *
 * Run: pnpm exec tsx scripts/clwx43-latency-mac-lane.ts
 * Exit: 0 all turns settled (latency is DATA; the budget verdict is the
 * owner's); 4 lane not available (app not running / token unrecoverable);
 * 1 harness failure.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { homedir } from 'node:os';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP_NAME = 'Ministry of Education';
const SESSIONS_DIR = join(homedir(), '.openclaw', 'agents', 'main', 'sessions');
const GATEWAY_PORT = 18789;
const HOST_API_PORT = 13210;
const SESSION_KEY = 'agent:main:main';
const TURN_TIMEOUT_MS = 300_000;
const CIRCULAR_FIXTURE = join(
  REPO_ROOT,
  'skills/laptop/evidence/2026-08-20-raj-prompt-replay/fixtures/01_Ministry_Circular_ICT_Equipment_Audit.pdf',
);

interface PromptSpec { id: string; shape: string; marker: string; text: string }
const PROMPTS: PromptSpec[] = [
  {
    id: 'routine-question',
    shape: 'no-tool routine answer',
    marker: 'nothing to report',
    text: 'What time is the Primary School Daily Report due each school day, and what should I do if there is nothing to report?',
  },
  {
    id: 'circular-summary',
    shape: 'document.read_pdf + summarise',
    marker: 'five short bullets',
    text: `Please summarise the key points of the Ministry circular at ${CIRCULAR_FIXTURE} in five short bullets.`,
  },
  {
    id: 'memo-write',
    shape: 'draft + document.write_docx',
    marker: 'fire drill memo',
    text: 'Draft a short fire drill memo to staff about the drill this Friday at 10 am and save it as a docx named fire-drill-memo.docx. The school is Demo Primary School and my name is A. Alexander — no further details needed, please save it now.',
  },
];

function log(msg: string): void {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}
function fatal(code: number, msg: string): never {
  console.error(`FATAL: ${msg}`);
  process.exit(code);
}

function httpStatus(port: number, path = '/'): Promise<number | null> {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path, timeout: 3_000 }, (res) => {
      res.resume();
      resolve(res.statusCode ?? null);
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

function findGatewayPid(appPid: number): number | null {
  const ps = spawnSync('ps', ['-axo', 'pid=,ppid=,comm='], { encoding: 'utf-8' });
  if (ps.status !== 0) return null;
  for (const line of ps.stdout.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (!m) continue;
    if (Number(m[2]) === appPid && /openclaw-gateway/.test(m[3])) return Number(m[1]);
  }
  return null;
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

function recoverHostApiToken(gatewayPid: number): string {
  const env = process.env.CLAWX_HOST_API_TOKEN;
  if (env && env.trim()) return env.trim();
  const res = spawnSync('python3', ['-c', PROCARGS_SNIPPET, String(gatewayPid)], { encoding: 'utf-8', timeout: 15_000 });
  const token = (res.stdout ?? '').trim();
  if (res.status !== 0 || !token) fatal(4, `could not recover host-API token from gateway pid ${gatewayPid}`);
  return token;
}

function hostApiPost(path: string, token: string, body: Record<string, unknown>): Promise<{ status: number | null; body: string }> {
  return new Promise((resolve) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port: HOST_API_PORT,
        path,
        method: 'POST',
        timeout: 130_000,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          Authorization: `Bearer ${token}`,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => resolve({ status: res.statusCode ?? null, body: data }));
      },
    );
    req.on('error', (err) => resolve({ status: null, body: String(err) }));
    req.on('timeout', () => { req.destroy(); resolve({ status: null, body: 'timeout' }); });
    req.end(payload);
  });
}

interface TurnEntry {
  tsMs: number;
  provider: string;
  modelId: string;
  promptErrorSource: unknown;
  lastUserText: string;
  toolCallNames: string[];
  finalText: string;
}

function readTurnEntries(path: string): TurnEntry[] {
  const out: TurnEntry[] = [];
  let raw: string;
  try { raw = readFileSync(path, 'utf-8'); } catch { return out; }
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let o: Record<string, unknown>;
    try { o = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
    if (o.type !== 'model.completed') continue;
    let data: Record<string, unknown> = {};
    const d = o.data;
    if (typeof d === 'string') { try { data = JSON.parse(d) as Record<string, unknown>; } catch { data = {}; } }
    else if (d && typeof d === 'object') data = d as Record<string, unknown>;
    const snapshot = Array.isArray(data.messagesSnapshot) ? (data.messagesSnapshot as Array<Record<string, unknown>>) : [];
    let lastUserIdx = -1;
    for (let i = snapshot.length - 1; i >= 0; i -= 1) {
      if (String(snapshot[i].role ?? '') === 'user') { lastUserIdx = i; break; }
    }
    let lastUserText = '';
    const toolCallNames: string[] = [];
    let finalText = '';
    for (let i = 0; i < snapshot.length; i += 1) {
      const m = snapshot[i];
      const role = String(m.role ?? '');
      const blocks = Array.isArray(m.content) ? (m.content as Array<Record<string, unknown>>) : [];
      for (const block of blocks) {
        const type = String(block.type ?? '');
        if (i === lastUserIdx && role === 'user' && type === 'text') lastUserText += String(block.text ?? '');
        if (i > lastUserIdx && role === 'assistant' && type === 'toolCall') {
          toolCallNames.push(String((block as { name?: unknown }).name ?? ''));
        }
        if (i > lastUserIdx && role === 'assistant' && type === 'text') finalText = String(block.text ?? '');
      }
    }
    out.push({
      tsMs: Date.parse(String(o.ts ?? '')) || 0,
      provider: String(o.provider ?? ''),
      modelId: String(o.modelId ?? ''),
      promptErrorSource: data.promptErrorSource ?? null,
      lastUserText,
      toolCallNames,
      finalText,
    });
  }
  return out;
}

interface Settled { outcome: 'reply' | 'model-error' | 'timeout'; entry?: TurnEntry }

async function waitForSettle(submitWallClock: number, marker: string): Promise<Settled> {
  const deadline = Date.now() + TURN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const recent = existsSync(SESSIONS_DIR)
      ? readdirSync(SESSIONS_DIR)
          .filter((f) => f.endsWith('.trajectory.jsonl'))
          .map((f) => join(SESSIONS_DIR, f))
          .filter((p) => statSync(p).mtimeMs >= submitWallClock - 10_000)
      : [];
    const entries = recent.flatMap((p) => readTurnEntries(p));
    const fresh = entries.filter((e) => e.lastUserText.includes(marker) && e.tsMs >= submitWallClock - 2_000);
    // A tool-using turn appends SEVERAL model.completed entries (one per
    // model round); latency is submit -> the FINAL settle, so take the last
    // entry that carries final assistant text.
    const finished = fresh.filter((e) => e.finalText.trim());
    const target = finished[finished.length - 1];
    if (target) {
      if (target.promptErrorSource) return { outcome: 'model-error', entry: target };
      return { outcome: 'reply', entry: target };
    }
    await new Promise((r) => setTimeout(r, 3_000));
  }
  return { outcome: 'timeout' };
}

(async () => {
  const onlyIdx = process.argv.indexOf('--only');
  const only = onlyIdx !== -1 ? process.argv[onlyIdx + 1] : null;
  const prompts = only ? PROMPTS.filter((p) => p.id === only) : PROMPTS;
  if (!prompts.length) fatal(1, `--only ${only} matches no prompt (${PROMPTS.map((p) => p.id).join(', ')})`);
  console.log('=== CLWX-43 Mac-lane latency: 3 demo-shaped live in-app turns ===');
  console.log('CAVEATS: M-series dev Mac (not the pilot laptop); n=1 per shape; wall-clock = submit -> final model.completed trajectory timestamp.\n');
  if (!existsSync(CIRCULAR_FIXTURE)) fatal(1, `circular fixture missing: ${CIRCULAR_FIXTURE}`);

  const pg = spawnSync('pgrep', ['-f', `${APP_NAME}.app/Contents/MacOS/${APP_NAME}$`], { encoding: 'utf-8' });
  const appPid = Number(pg.stdout.trim().split('\n')[0]);
  if (pg.status !== 0 || !appPid) fatal(4, `app "${APP_NAME}" is not running`);
  if ((await httpStatus(GATEWAY_PORT)) === null) fatal(4, `gateway ${GATEWAY_PORT} not reachable`);
  if ((await httpStatus(HOST_API_PORT)) === null) fatal(4, `host-API ${HOST_API_PORT} not reachable`);
  const gatewayPid = findGatewayPid(appPid);
  if (!gatewayPid) fatal(4, 'no openclaw-gateway child process');
  const token = recoverHostApiToken(gatewayPid);
  log(`lane up: app ${appPid}, gateway ${gatewayPid}`);

  const results: Array<{ id: string; shape: string; outcome: string; wallSeconds: number | null; tools: string[]; provider: string; modelId: string; finalChars: number }> = [];
  for (const prompt of prompts) {
    log(`turn ${prompt.id}: sending`);
    const t0 = Date.now();
    const resp = await hostApiPost('/api/chat/send-with-media', token, {
      sessionKey: SESSION_KEY,
      message: prompt.text,
      deliver: false,
      idempotencyKey: `clwx43-${prompt.id}-${t0}`,
    });
    if (resp.status !== 200) fatal(1, `send failed for ${prompt.id}: http ${resp.status} ${resp.body.slice(0, 200)}`);
    const settled = await waitForSettle(t0, prompt.marker);
    const wallSeconds = settled.entry ? (settled.entry.tsMs - t0) / 1000 : null;
    results.push({
      id: prompt.id,
      shape: prompt.shape,
      outcome: settled.outcome,
      wallSeconds,
      tools: settled.entry?.toolCallNames ?? [],
      provider: settled.entry?.provider ?? '',
      modelId: settled.entry?.modelId ?? '',
      finalChars: settled.entry?.finalText.trim().length ?? 0,
    });
    log(`turn ${prompt.id}: ${settled.outcome}${wallSeconds !== null ? ` in ${wallSeconds.toFixed(1)}s` : ''} (tools: ${settled.entry?.toolCallNames.join(', ') || 'none'})`);
  }

  console.log('\nprompt            | shape                          | wall (s) | tools');
  console.log('------------------|--------------------------------|----------|------');
  for (const r of results) {
    console.log(`${r.id.padEnd(18)}| ${r.shape.padEnd(31)}| ${r.wallSeconds === null ? 'TIMEOUT' : r.wallSeconds.toFixed(1).padStart(8)} | ${r.tools.join(',') || '-'}`);
  }
  const settledTimes = results.filter((r) => r.wallSeconds !== null).map((r) => r.wallSeconds as number).sort((a, b) => a - b);
  const median = settledTimes.length ? settledTimes[Math.floor(settledTimes.length / 2)] : null;
  console.log(`\nmedian: ${median === null ? 'n/a' : `${median.toFixed(1)}s`} | proposed budget p50 <=15s / p90 <=30s | 2026-09-02 VM baseline median ~103s`);

  const evidenceDir = join(REPO_ROOT, 'docs', 'evidence');
  mkdirSync(evidenceDir, { recursive: true });
  const reportPath = join(evidenceDir, 'CLWX43_LATENCY_MAC_LANE_2026-09-06.md');
  // A --only retry must never overwrite the full-run report with one row.
  if (only) {
    console.log('(--only run: report not written)');
    process.exit(results.some((r) => r.outcome !== 'reply') ? 1 : 0);
  }
  writeFileSync(reportPath, [
    '# CLWX-43 latency — Mac lane (live in-app turns, 2026-09-06)',
    '',
    'Mechanism: host-API `chat.send` relay into the RUNNING app (the proven CLWX-65 lane);',
    'wall-clock = submit -> the turn\'s final `model.completed` trajectory timestamp.',
    'CAVEATS: M-series dev Mac, NOT the pilot laptop (laptop-lane repeat stays the named',
    'remainder); n=1 per prompt shape; turns rendered in the live app UI; the memo turn',
    'leaves fire-drill-memo.docx in ~/.openclaw/media/outbound as turn evidence.',
    '',
    '| Prompt | Shape | Wall (s) | Tools | Reply chars |',
    '|---|---|---|---|---|',
    ...results.map((r) => `| ${r.id} | ${r.shape} | ${r.wallSeconds === null ? 'TIMEOUT' : r.wallSeconds.toFixed(1)} | ${r.tools.join(', ') || '-'} | ${r.finalChars} |`),
    '',
    `Median (settled turns): ${median === null ? 'n/a' : `${median.toFixed(1)}s`}.`,
    'Reference points: proposed budget p50 <=15s / p90 <=30s (owner sign-off pending);',
    '2026-09-02 e2-VM baseline: tool turns 79.6 / 103.4 / 182.2s, median ~103s.',
    `Channel (from trajectory): ${[...new Set(results.map((r) => `${r.provider}/${r.modelId}`).filter((s) => s !== '/'))].join(', ') || 'unknown'}.`,
    '',
  ].join('\n'));
  console.log(`report written: ${reportPath}`);

  const anyTimeout = results.some((r) => r.outcome !== 'reply');
  process.exit(anyTimeout ? 1 : 0);
})().catch((e) => {
  console.error('FATAL:', e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
