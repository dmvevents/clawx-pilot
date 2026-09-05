/**
 * CLWX-67 (Mac leg): reminder pipeline e2e — cron -> agentTurn -> visible chat prompt.
 *
 * The agentTurn cron path is BUILT (moe-seed.ts registers the 3:30pm job shape;
 * electron/api/routes/cron.ts exposes the CRUD surface) but has never been
 * proven end-to-end on any platform. This harness creates exactly ONE
 * scheduled cron entry via the app's own host-API route (the same
 * `cron.add` shape moe-seed ships: agentTurn payload, isolated session,
 * wakeMode next-heartbeat, delivery none), waits for the SCHEDULED fire —
 * never `cron.run --force` — and asserts the reminder renders as a visible
 * chat prompt in the running Ministry of Education app.
 *
 * Drive mechanism (write side): host-API on :13210, bearer token recovered
 * from the openclaw-gateway child process via sysctl KERN_PROCARGS2 — the
 * established mechanism from scripts/clwx65-write-turn.ts. The token is held
 * in memory and NEVER logged or written to evidence.
 *
 * Observe mechanism (UI side): unlike the clwx65 context, THIS execution
 * context holds TCC assistive access, so the app UI is driven read-mostly via
 * System Events accessibility (AXManualAccessibility, the documented Electron
 * switch): find the cron session row in the sidebar, click it so the
 * transcript renders, assert the reminder text is present in the window's
 * accessibility tree, and capture the window region with screencapture.
 * There is no CDP path to the app renderer (not launched with
 * --remote-debugging-port), so scripts/snapshot-ui.ts --mode=production
 * cannot attach; the AX + screencapture pair replaces it.
 *
 * Defer leg: the principal's answer is relayed into the SAME cron run session
 * over /api/chat/send-with-media (composer-equivalent chat.send RPC). The
 * reply must be a defer acknowledgment — the turn is asserted to contain NO
 * outlook/forms/browser/send/submit tool calls.
 *
 * Ground truth: the cron run log ~/.openclaw/cron/runs/<jobId>.jsonl
 * (electron/api/routes/cron.ts::readCronRunLog shape) plus the per-session
 * trajectory JSONL under ~/.openclaw/agents/main/sessions/.
 *
 * Cron hygiene (hard requirement): exactly one test entry is created; a
 * finally block deletes it and verifies via GET /api/cron/jobs that it is
 * gone, so no phantom reminder can ever fire on this machine later.
 *
 * Scope guards: never touches Outlook, Forms, or Chrome (:18792); never
 * restarts the app; never force-triggers the job; never edits ~/.openclaw
 * files by hand (all writes go through the app's own API surface).
 *
 * Run:
 *   pnpm exec tsx scripts/clwx67-reminder-e2e.ts
 *
 * Evidence: docs/evidence/clwx67-reminder/
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { homedir } from 'node:os';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EVIDENCE_DIR = join(REPO_ROOT, 'docs/evidence/clwx67-reminder');
const APP_NAME = 'Ministry of Education';
const OPENCLAW_DIR = join(homedir(), '.openclaw');
const SESSIONS_DIR = join(OPENCLAW_DIR, 'agents', 'main', 'sessions');
const CRON_RUNS_DIR = join(OPENCLAW_DIR, 'cron', 'runs');
const GATEWAY_PORT = 18789;
const HOST_API_PORT = 13210;

const JOB_NAME = `CLWX-67 reminder e2e ${new Date().toISOString().slice(11, 16)}`;
// The reminder the principal sees. First line is the visible prompt; the rest
// steers the agent to a reminder-only turn (no form/email tools, defer-aware).
const REMINDER_MESSAGE = [
  'Reminder: 3:45pm — submit today\'s Daily Report.',
  '',
  'Deliver this reminder to the principal in one short message: the Primary',
  'School Daily Report is due by 3:45pm today. Ask whether they want to',
  'proceed now or defer. This is a reminder turn ONLY — do not open, fill, or',
  'submit any form, and do not send any email. If the principal replies with',
  'a defer, acknowledge the deferral and confirm when they will be reminded.',
].join('\n');
const REMINDER_MARKER = 'submit today\'s Daily Report';
const DEFER_MESSAGE =
  'Defer this reminder — I\'m still in a staff meeting. Remind me again at 3:40pm tomorrow; do not fill or submit anything.';
const DEFER_MARKER = 'still in a staff meeting';
// Tool families a reminder/defer turn must never touch (hard rule: the defer
// answer path is chat-only; no forms, no email, no browser).
const FORBIDDEN_TOOL_RE = /outlook|forms|browser|send_email|download_attachment|form_fill|submit/i;

const FIRE_GRACE_MS = 360_000; // heartbeat wake + default cron stagger tolerance
const TURN_TIMEOUT_MS = 300_000;

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

// ── Host-API token recovery (KERN_PROCARGS2, never logged) ───────────────────

function findAppPid(): number {
  const pg = spawnSync('pgrep', ['-f', `${APP_NAME}.app/Contents/MacOS/${APP_NAME}$`], { encoding: 'utf-8' });
  const appPid = Number(pg.stdout.trim().split('\n')[0]);
  if (pg.status !== 0 || !appPid) fatal(4, `app "${APP_NAME}" is not running (pgrep found no MacOS process)`);
  return appPid;
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
  if (res.status !== 0 || !token) {
    fatal(4, `could not recover host-API token from gateway pid ${gatewayPid} (python exit ${res.status})`);
  }
  return token;
}

async function preflight(): Promise<{ appPid: number; gatewayPid: number }> {
  log('preflight: app process');
  const appPid = findAppPid();
  log(`preflight: app pid ${appPid}`);

  const gw = await httpStatus(GATEWAY_PORT);
  if (gw === null) fatal(4, `gateway ${GATEWAY_PORT} not reachable`);
  log(`preflight: gateway ${GATEWAY_PORT} -> HTTP ${gw}`);

  const host = await httpStatus(HOST_API_PORT);
  // 401 is expected (auth-token gated) and proves the host-API is up.
  if (host === null) fatal(4, `host-API ${HOST_API_PORT} not reachable`);
  log(`preflight: host-API ${HOST_API_PORT} -> HTTP ${host} (401 = up, auth-gated)`);

  const gatewayPid = findGatewayPid(appPid);
  if (!gatewayPid) fatal(4, `no openclaw-gateway child of app pid ${appPid}`);
  log(`preflight: openclaw-gateway pid ${gatewayPid}`);
  return { appPid, gatewayPid };
}

// ── Host-API request helper ──────────────────────────────────────────────────

function hostApi(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  token: string,
  body?: Record<string, unknown>,
  timeoutMs = 130_000,
): Promise<{ status: number | null; body: string }> {
  return new Promise((resolve) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        host: '127.0.0.1',
        port: HOST_API_PORT,
        path,
        method,
        timeout: timeoutMs,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(payload
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
            : {}),
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

// ── Cron job lifecycle (create -> observe fire -> remove) ────────────────────

interface CronJobView {
  id: string;
  name: string;
  message?: string;
  schedule?: { kind?: string; expr?: string; at?: string };
  enabled?: boolean;
  createdAt?: string;
  nextRun?: string;
  lastRun?: { time?: string; success?: boolean; error?: string; duration?: number };
}

interface CronRunEntry {
  jobId?: string;
  action?: string;
  status?: string;
  error?: string;
  summary?: string;
  sessionId?: string;
  sessionKey?: string;
  ts?: number;
  runAtMs?: number;
  durationMs?: number;
  model?: string;
  provider?: string;
}

async function listJobs(token: string): Promise<CronJobView[]> {
  const res = await hostApi('GET', '/api/cron/jobs', token, undefined, 15_000);
  if (res.status !== 200) fatal(5, `GET /api/cron/jobs failed: HTTP ${res.status ?? 'ERR'} ${res.body.slice(0, 200)}`);
  const parsed = JSON.parse(res.body) as CronJobView[];
  return Array.isArray(parsed) ? parsed : [];
}

/** UTC cron expr for a one-shot fire: pin minute/hour/day/month so the job
 *  can never recur past the test window even if cleanup were to fail. */
function oneShotUtcCronExpr(fireAt: Date): string {
  return `${fireAt.getUTCMinutes()} ${fireAt.getUTCHours()} ${fireAt.getUTCDate()} ${fireAt.getUTCMonth() + 1} *`;
}

async function createReminderJob(token: string): Promise<{ job: CronJobView; fireAt: Date; nextRunBeforeTzFix: string | null; nextRunAfterTzFix: string | null }> {
  // Schedule 2 minutes out; add one more when close to the minute boundary so
  // registration always lands well before the target minute starts.
  const now = new Date();
  const bump = now.getSeconds() > 40 ? 3 : 2;
  const fireAt = new Date(now.getTime() + bump * 60_000);
  fireAt.setSeconds(0, 0);
  const expr = oneShotUtcCronExpr(fireAt);
  log(`creating cron job "${JOB_NAME}" expr(UTC)="${expr}" (fires ${fireAt.toISOString()})`);
  const res = await hostApi('POST', '/api/cron/jobs', token, {
    name: JOB_NAME,
    message: REMINDER_MESSAGE,
    schedule: expr,
    enabled: true,
  }, 20_000);
  if (res.status !== 200) fatal(5, `POST /api/cron/jobs failed: HTTP ${res.status ?? 'ERR'} ${res.body.slice(0, 300)}`);
  const job = JSON.parse(res.body) as CronJobView;
  if (!job?.id) fatal(5, `cron.add returned no id: ${res.body.slice(0, 300)}`);
  const nextRunBeforeTzFix = job.nextRun ?? null;
  log(`cron job created id=${job.id} nextRun(before tz fix)=${nextRunBeforeTzFix ?? '(unset)'}`);

  // FINDING (this card): POST /api/cron/jobs never sets schedule.tz, so the
  // gateway parses the expr in the tz its process resolved at boot
  // (Intl.DateTimeFormat().resolvedOptions().timeZone in dist/schedule-*.js),
  // which on this machine diverges from the current system clock (run 1
  // produced a nextRun a full YEAR out). Pin the schedule to UTC via the PUT
  // route, whose buildCronUpdatePatch passes object schedules through to
  // cron.update untouched.
  const put = await hostApi('PUT', `/api/cron/jobs/${encodeURIComponent(job.id)}`, token, {
    schedule: { kind: 'cron', expr, tz: 'UTC' },
  }, 20_000);
  if (put.status !== 200) fatal(5, `PUT /api/cron/jobs/${job.id} (tz pin) failed: HTTP ${put.status ?? 'ERR'} ${put.body.slice(0, 300)}`);
  const updated = (await listJobs(token)).find((j) => j.id === job.id);
  const nextRunAfterTzFix = updated?.nextRun ?? null;
  log(`schedule pinned to UTC; nextRun(after tz fix)=${nextRunAfterTzFix ?? '(unset)'}`);
  const nextMs = nextRunAfterTzFix ? Date.parse(nextRunAfterTzFix) : NaN;
  if (!Number.isFinite(nextMs) || Math.abs(nextMs - fireAt.getTime()) > 90_000) {
    // Cleanup happens in main's finally only after this returns, so remove
    // the job here before failing hard.
    await hostApi('DELETE', `/api/cron/jobs/${encodeURIComponent(job.id)}`, token, undefined, 20_000);
    fatal(5, `nextRun ${nextRunAfterTzFix ?? '(unset)'} is not within 90s of scheduled ${fireAt.toISOString()} even with tz=UTC pinned (job removed)`);
  }
  return { job, fireAt, nextRunBeforeTzFix, nextRunAfterTzFix };
}

function readRunLog(jobId: string): CronRunEntry[] {
  const path = join(CRON_RUNS_DIR, `${jobId}.jsonl`);
  let raw: string;
  try { raw = readFileSync(path, 'utf-8'); } catch { return []; }
  const out: CronRunEntry[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as CronRunEntry;
      if (entry?.jobId === jobId) out.push(entry);
    } catch { /* skip malformed lines */ }
  }
  return out;
}

async function waitForScheduledFire(
  token: string,
  jobId: string,
  fireAt: Date,
): Promise<CronRunEntry> {
  const deadline = fireAt.getTime() + FIRE_GRACE_MS;
  let lastNote = '';
  while (Date.now() < deadline) {
    const finished = readRunLog(jobId).filter((e) => !e.action || e.action === 'finished');
    if (finished.length > 0) return finished[finished.length - 1];
    // Diagnostics only: surface scheduler state transitions while waiting.
    const job = (await listJobs(token)).find((j) => j.id === jobId);
    const note = `nextRun=${job?.nextRun ?? '?'} lastRun=${job?.lastRun?.time ?? '(none)'}`;
    if (note !== lastNote) { log(`  cron state: ${note}`); lastNote = note; }
    await new Promise((r) => setTimeout(r, 5_000));
  }
  // Throw (never fatal/exit) so main's finally still removes the job.
  throw new Error(`cron job ${jobId} did not produce a finished run entry within ${FIRE_GRACE_MS / 1000}s of ${fireAt.toISOString()}`);
}

// ── Session trajectory (settle + tool-call/reply extraction) ─────────────────
// Same parser as scripts/clwx65-write-turn.ts: one model.completed per turn,
// current turn = messagesSnapshot after the last user message.

interface TurnEntry {
  seq: number;
  tsMs: number;
  provider: string;
  modelId: string;
  promptErrorSource: unknown;
  lastUserText: string;
  toolCallNames: string[];
  finalText: string;
  file: string;
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
    const blockText = (m: Record<string, unknown>): string =>
      (Array.isArray(m.content) ? (m.content as Array<Record<string, unknown>>) : [])
        .filter((b) => String(b.type ?? '') === 'text')
        .map((b) => String(b.text ?? ''))
        .join('\n');
    const lastUserText = lastUserIdx >= 0 ? blockText(snapshot[lastUserIdx]) : '';
    const toolCallNames: string[] = [];
    let finalText = '';
    for (const m of snapshot.slice(lastUserIdx + 1)) {
      const role = String(m.role ?? '');
      const content = Array.isArray(m.content) ? (m.content as Array<Record<string, unknown>>) : [];
      for (const block of content) {
        const type = String(block.type ?? '');
        if (role === 'assistant' && type === 'toolCall') {
          toolCallNames.push(String(block.name ?? ''));
        } else if (role === 'assistant' && type === 'text') {
          finalText = String(block.text ?? '');
        }
      }
    }
    out.push({
      seq: Number(o.seq ?? 0),
      tsMs: Date.parse(String(o.ts ?? '')) || 0,
      provider: String(o.provider ?? ''),
      modelId: String(o.modelId ?? ''),
      promptErrorSource: data.promptErrorSource ?? null,
      lastUserText,
      toolCallNames,
      finalText,
      file: path,
    });
  }
  return out;
}

interface Settled { outcome: 'reply' | 'model-error' | 'timeout'; entry?: TurnEntry; }

async function waitForSettle(sinceWallClock: number, marker: string, timeoutMs = TURN_TIMEOUT_MS): Promise<Settled> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const recent = existsSync(SESSIONS_DIR)
      ? readdirSync(SESSIONS_DIR)
          .filter((f) => f.endsWith('.trajectory.jsonl'))
          .map((f) => join(SESSIONS_DIR, f))
          .filter((p) => statSync(p).mtimeMs >= sinceWallClock - 10_000)
      : [];
    const entries = recent.flatMap((p) => readTurnEntries(p));
    const fresh = entries.filter(
      (e) => e.lastUserText.includes(marker) && e.tsMs >= sinceWallClock - 10_000,
    );
    const target = fresh[fresh.length - 1];
    if (target) {
      if (target.promptErrorSource) return { outcome: 'model-error', entry: target };
      if (target.finalText.trim() || target.toolCallNames.length) return { outcome: 'reply', entry: target };
    }
    await new Promise((r) => setTimeout(r, 3_000));
    log(`  ...waiting for turn to settle (${((deadline - Date.now()) / 1000).toFixed(0)}s left)`);
  }
  return { outcome: 'timeout' };
}

// ── UI leg: System Events accessibility drive + window capture ───────────────

function osascript(script: string, timeoutMs = 60_000): { ok: boolean; out: string } {
  const res = spawnSync('osascript', ['-e', script], { encoding: 'utf-8', timeout: timeoutMs });
  return { ok: res.status === 0, out: `${(res.stdout ?? '').trim()}${res.stderr ? `\n${res.stderr.trim()}` : ''}`.trim() };
}

function activateApp(): void {
  osascript(`tell application "${APP_NAME}" to activate`);
}

function windowBounds(): { x: number; y: number; w: number; h: number } | null {
  const r = osascript(`
tell application "System Events"
  tell process "${APP_NAME}"
    set p to position of window 1
    set s to size of window 1
    return ((item 1 of p) as text) & "," & ((item 2 of p) as text) & "," & ((item 1 of s) as text) & "," & ((item 2 of s) as text)
  end tell
end tell`);
  if (!r.ok) return null;
  const [x, y, w, h] = r.out.split(',').map(Number);
  return Number.isFinite(x) && Number.isFinite(w) ? { x, y, w, h } : null;
}

/** All static-text values in the app window's AX tree (the visibility oracle). */
function windowTexts(): string[] {
  const r = osascript(`
tell application "System Events"
  tell process "${APP_NAME}"
    set value of attribute "AXManualAccessibility" to true
    delay 0.3
    set allElems to entire contents of window 1
    set found to {}
    repeat with el in allElems
      try
        if class of el is static text then
          set v to value of el
          if v is not missing value then set end of found to v
        end if
      end try
    end repeat
    set AppleScript's text item delimiters to linefeed
    return found as text
  end tell
end tell`, 120_000);
  return r.ok ? r.out.split('\n').filter((s) => s.trim()) : [];
}

function axSanitize(fragment: string): string {
  return fragment.replace(/[\\"]/g, ' ');
}

/** Click the center of the first static text containing `fragment`. */
function clickTextElement(fragment: string): boolean {
  const frag = axSanitize(fragment);
  const r = osascript(`
tell application "System Events"
  tell process "${APP_NAME}"
    set value of attribute "AXManualAccessibility" to true
    delay 0.3
    set allElems to entire contents of window 1
    repeat with el in allElems
      try
        if class of el is static text then
          set v to value of el
          if v is not missing value and v contains "${frag}" then
            set p to position of el
            set s to size of el
            set cx to (item 1 of p) + ((item 1 of s) div 2)
            set cy to (item 2 of p) + ((item 2 of s) div 2)
            click at {cx, cy}
            return "CLICKED " & (cx as text) & "," & (cy as text)
          end if
        end if
      end try
    end repeat
    return "NOTFOUND"
  end tell
end tell`, 120_000);
  log(`  clickTextElement("${fragment}") -> ${r.out.slice(0, 80)}`);
  return r.ok && r.out.startsWith('CLICKED');
}

function captureWindow(outPath: string): boolean {
  const b = windowBounds();
  if (!b) return false;
  const res = spawnSync('/usr/sbin/screencapture', ['-x', `-R${b.x},${b.y},${b.w},${b.h}`, outPath], { timeout: 20_000 });
  return res.status === 0 && existsSync(outPath) && statSync(outPath).size > 0;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const t0 = Date.now();

  const { gatewayPid } = await preflight();
  const token = recoverHostApiToken(gatewayPid);
  log('host-API token recovered (not logged)');

  const jobsBefore = await listJobs(token);
  log(`cron jobs before: ${jobsBefore.length}`);

  const { job, fireAt, nextRunBeforeTzFix, nextRunAfterTzFix } = await createReminderJob(token);

  const assertions: Record<string, boolean> = {
    jobCreated: true,
    scheduledFire: false,
    reminderTurnSettled: false,
    reminderNoForbiddenTools: false,
    reminderVisibleInUi: false,
    reminderScreenshot: false,
    deferReplySettled: false,
    deferNoForbiddenTools: false,
    deferVisibleInUi: false,
    deferScreenshot: false,
    cleanupVerified: false,
  };
  let runEntry: CronRunEntry | undefined;
  let reminderTurn: Settled | undefined;
  let deferTurn: Settled | undefined;
  const followupJobsRemoved: CronJobView[] = [];
  let failure = '';

  try {
    // 1. Scheduled fire (never forced): the run log is the arbiter.
    log(`waiting for scheduled fire at ${fireAt.toTimeString().slice(0, 8)} (+${FIRE_GRACE_MS / 1000}s grace for heartbeat/stagger)`);
    runEntry = await waitForScheduledFire(token, job.id, fireAt);
    assertions.scheduledFire = true;
    log(`cron fired: status=${runEntry.status} sessionId=${runEntry.sessionId} durationMs=${runEntry.durationMs}`);

    // 2. Trajectory ground truth for the reminder turn.
    reminderTurn = await waitForSettle(fireAt.getTime(), REMINDER_MARKER, 60_000);
    assertions.reminderTurnSettled = reminderTurn.outcome === 'reply';
    const reminderTools = reminderTurn.entry?.toolCallNames ?? [];
    assertions.reminderNoForbiddenTools = !reminderTools.some((t) => FORBIDDEN_TOOL_RE.test(t));
    log(`reminder turn: ${reminderTurn.outcome}; tools=[${reminderTools.join(', ') || 'none'}]`);

    // 3. Visible chat prompt: open the cron session in the app and capture it.
    activateApp();
    await new Promise((r) => setTimeout(r, 1_500));
    // The sidebar refreshes off gateway events (maybeLoadSessions); the row is
    // labeled with the job name. Match progressively narrower fragments.
    const clicked = clickTextElement('CLWX-67 reminder')
      || clickTextElement(JOB_NAME)
      || clickTextElement('CLWX-67');
    await new Promise((r) => setTimeout(r, 2_500));
    const textsAfterOpen = windowTexts();
    assertions.reminderVisibleInUi = clicked
      && textsAfterOpen.some((t) => t.includes(REMINDER_MARKER) || t.includes('3:45pm'));
    writeFileSync(join(EVIDENCE_DIR, 'ui-texts-after-open.txt'), textsAfterOpen.join('\n'));
    assertions.reminderScreenshot = captureWindow(join(EVIDENCE_DIR, 'reminder-visible.png'));
    log(`reminder visible in UI: ${assertions.reminderVisibleInUi}; screenshot: ${assertions.reminderScreenshot}`);

    // 4. Defer answer path: reply INTO the cron run session; chat-only.
    const runSessionKey = runEntry.sessionKey
      ?? (runEntry.sessionId ? `agent:main:cron:${job.id}:run:${runEntry.sessionId}` : null);
    if (!runSessionKey) throw new Error('run entry has no sessionKey/sessionId; cannot exercise defer path');
    const deferAt = Date.now();
    log(`submitting defer reply to session ${runSessionKey}`);
    const send = await hostApi('POST', '/api/chat/send-with-media', token, {
      sessionKey: runSessionKey,
      message: DEFER_MESSAGE,
      deliver: false,
      idempotencyKey: `clwx67-defer-${deferAt}`,
    });
    if (send.status !== 200) throw new Error(`defer chat send failed: HTTP ${send.status ?? 'ERR'} ${send.body.slice(0, 300)}`);
    deferTurn = await waitForSettle(deferAt, DEFER_MARKER);
    assertions.deferReplySettled = deferTurn.outcome === 'reply' && Boolean(deferTurn.entry?.finalText.trim());
    const deferTools = deferTurn.entry?.toolCallNames ?? [];
    assertions.deferNoForbiddenTools = !deferTools.some((t) => FORBIDDEN_TOOL_RE.test(t));
    log(`defer turn: ${deferTurn.outcome}; tools=[${deferTools.join(', ') || 'none'}]`);

    // 5. Defer exchange visible in the same session view.
    activateApp();
    await new Promise((r) => setTimeout(r, 2_000));
    // Re-open the row in case the view moved while the turn ran.
    clickTextElement('CLWX-67 reminder');
    await new Promise((r) => setTimeout(r, 2_000));
    const textsAfterDefer = windowTexts();
    assertions.deferVisibleInUi = textsAfterDefer.some((t) => t.includes(DEFER_MARKER));
    writeFileSync(join(EVIDENCE_DIR, 'ui-texts-after-defer.txt'), textsAfterDefer.join('\n'));
    assertions.deferScreenshot = captureWindow(join(EVIDENCE_DIR, 'defer-visible.png'));
    log(`defer visible in UI: ${assertions.deferVisibleInUi}; screenshot: ${assertions.deferScreenshot}`);
  } catch (err) {
    failure = err instanceof Error ? err.message : String(err);
    console.error(`RUN FAILURE: ${failure}`);
  } finally {
    // Cron hygiene: remove the one test entry and PROVE it is gone.
    try {
      const del = await hostApi('DELETE', `/api/cron/jobs/${encodeURIComponent(job.id)}`, token, undefined, 20_000);
      let after = await listJobs(token);
      const stillThere = after.some((j) => j.id === job.id);
      log(`cleanup: DELETE -> HTTP ${del.status}; job present after delete: ${stillThere}; jobs now: ${after.length}`);
      // The defer turn legitimately schedules a follow-up reminder via the
      // cron tool (observed live: a next-day kind "at" job). A test run must
      // not leave phantom reminders, so sweep any job created during the run.
      for (const j of after) {
        const created = j.createdAt ? Date.parse(j.createdAt) : NaN;
        if (!Number.isFinite(created) || created < t0) continue;
        log(`cleanup: sweeping run-created follow-up job "${j.name}" (id=${j.id}, nextRun=${j.nextRun ?? '?'})`);
        followupJobsRemoved.push(j);
        await hostApi('DELETE', `/api/cron/jobs/${encodeURIComponent(j.id)}`, token, undefined, 20_000);
      }
      if (followupJobsRemoved.length) {
        after = await listJobs(token);
        log(`cleanup: after follow-up sweep, jobs now: ${after.length}`);
      }
      const sweptClean = !after.some((j) => {
        const created = j.createdAt ? Date.parse(j.createdAt) : NaN;
        return j.id === job.id || (Number.isFinite(created) && created >= t0);
      });
      assertions.cleanupVerified = del.status === 200 && !stillThere && sweptClean;
    } catch (err) {
      console.error(`CLEANUP FAILURE (job id ${job.id} may still exist — remove via DELETE /api/cron/jobs/${job.id}): ${err instanceof Error ? err.message : String(err)}`);
    }
    // Politeness: put the app back on the main session (best effort; the
    // main row label varies — session key or a user-set name).
    try {
      if (!clickTextElement('agent:main:main')) clickTextElement('ClawX');
    } catch { /* view restore only */ }
  }

  const verdict = failure
    ? `BLOCKED (${failure})`
    : Object.values(assertions).every(Boolean)
      ? 'PASS'
      : `FAIL-ASSERTION (${Object.entries(assertions).filter(([, v]) => !v).map(([k]) => k).join(', ')})`;

  const summary = {
    verdict,
    card: 'CLWX-67',
    driveMechanism: 'host-API /api/cron/jobs (cron.add: agentTurn, isolated, next-heartbeat, delivery none) -> scheduled gateway fire -> System Events AX open + screencapture -> defer via /api/chat/send-with-media into the cron run session',
    job: {
      id: job.id,
      name: JOB_NAME,
      scheduledFor: fireAt.toISOString(),
      // tz finding evidence: what cron.add computed without schedule.tz vs
      // after the UTC pin. A divergence here is the CLWX-67 tz defect.
      nextRunBeforeTzFix,
      nextRunAfterTzFix,
    },
    reminderMessage: REMINDER_MESSAGE,
    deferMessage: DEFER_MESSAGE,
    runEntry: runEntry ?? null,
    reminderTurn: reminderTurn?.entry
      ? {
        outcome: reminderTurn.outcome,
        provider: reminderTurn.entry.provider,
        modelId: reminderTurn.entry.modelId,
        tsMs: reminderTurn.entry.tsMs,
        toolCallNames: reminderTurn.entry.toolCallNames,
        finalText: reminderTurn.entry.finalText,
        trajectory: reminderTurn.entry.file,
      }
      : reminderTurn?.outcome ?? null,
    deferTurn: deferTurn?.entry
      ? {
        outcome: deferTurn.outcome,
        provider: deferTurn.entry.provider,
        modelId: deferTurn.entry.modelId,
        tsMs: deferTurn.entry.tsMs,
        toolCallNames: deferTurn.entry.toolCallNames,
        finalText: deferTurn.entry.finalText,
        trajectory: deferTurn.entry.file,
      }
      : deferTurn?.outcome ?? null,
    followupJobsRemoved,
    assertions,
    failure: failure || null,
    totalMs: Date.now() - t0,
  };
  writeFileSync(join(EVIDENCE_DIR, 'run-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`\n=== ${verdict} ===`);
  console.log(`evidence: ${EVIDENCE_DIR}`);
  process.exit(verdict === 'PASS' ? 0 : 9);
}

main().catch((err) => {
  console.error('CRASH:', err instanceof Error ? err.message : String(err));
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(2);
});
