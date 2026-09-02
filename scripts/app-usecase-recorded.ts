/**
 * Screen-recorded REAL use case in the running Ministry of Education Electron app.
 *
 * USE CASE (demo item 1): type "Summarise my last 5 emails" into the app's chat
 * composer, submit the turn, wait for it to settle, and record the whole thing.
 * The agent uses the live Outlook browser lane (signed-in Chrome on CDP 18792) —
 * READ ONLY. This harness never sends an email, never submits a form, never sets
 * confirm:true, never touches ~/.openclaw config, and never restarts the app.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ATTACH MECHANISM (why UI automation and not CDP screencast):
 *   scripts/snapshot-ui.ts attaches to the app renderer over CDP, but ONLY when
 *   the app was launched with --remote-debugging-port=9223. The running app
 *   (PID from `pgrep`) was NOT launched with that flag — port 9223 is closed
 *   (verified: `curl 127.0.0.1:9223/json/version` -> connection refused). There
 *   is therefore NO CDP path to the app's own renderer, so we cannot reuse the
 *   Page.startScreencast machinery from scripts/forms-submit-recorded.ts against
 *   the app (that script screencasts the *Chrome* on 18792, a different target).
 *
 *   Fallback per the task spec: macOS screen recording of the frontmost app
 *   window via `screencapture -v` while driving the composer with System Events
 *   keystrokes (osascript). Screen Recording permission is probed first.
 *
 * SETTLE + ASSERTION (non-OCR, ground-truth):
 *   The gateway writes a trajectory JSONL per session under
 *   ~/.openclaw/agents/<agent>/sessions/<id>.trajectory.jsonl. Each turn appends
 *   a `model.completed` entry whose `data.finalPromptText` echoes the user prompt
 *   and whose `data.assistantTexts` holds the reply chunks. We snapshot the
 *   newest entry BEFORE submit, then poll for a NEW `model.completed` whose
 *   finalPromptText contains our prompt. SUCCESS when assistantTexts is non-empty
 *   and data.promptErrorSource is null; FAILURE (model-call error, e.g. the
 *   composer-override 400 class) when promptErrorSource is set or assistantTexts
 *   stays empty past the timeout. The reply text is then asserted to reference
 *   real inbox subjects and to contain no tool-frame noise (EXEC-NOISE-LEAK).
 *
 * Run:
 *   pnpm exec tsx scripts/app-usecase-recorded.ts
 *
 * Evidence: skills/laptop/evidence/2026-09-03-app-usecase-recorded/
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { homedir } from 'node:os';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EVIDENCE_DIR = join(REPO_ROOT, 'skills/laptop/evidence/2026-09-03-app-usecase-recorded');
const APP_NAME = 'Ministry of Education';
const OPENCLAW_DIR = join(homedir(), '.openclaw');
const SESSIONS_INDEX = join(OPENCLAW_DIR, 'agents', 'main', 'sessions', 'sessions.json');
const GATEWAY_PORT = 18789;
const HOST_API_PORT = 13210;
const CHROME_CDP_PORT = 18792;
const PROMPT = 'Summarise my last 5 emails';
const TURN_TIMEOUT_MS = 240_000;
const FFMPEG = findFfmpeg();

// Distinctive words drawn from the real test.fac inbox subjects. A genuine reply
// that actually read the inbox should surface at least two of these groups.
const INBOX_SUBJECT_GROUPS: Array<{ label: string; words: string[] }> = [
  { label: 'VOLUNTEER COACHES NEEDED', words: ['volunteer', 'coach'] },
  { label: 'Media Release: Ministry Advances Processing of 45,953 School Supplies', words: ['45,953', '45953', 'school supplies', 'media release'] },
  { label: 'Greetings: Happy Independence Day', words: ['independence'] },
  { label: 'Join Us Live Today: Launch of Six New Learning Resources', words: ['learning resource', 'six new', 'launch'] },
];

// Tool-frame / raw-JSON leak markers that must NOT appear in a principal-facing reply.
const EXEC_NOISE_MARKERS = [/\bExec:/i, /"tool_call"/i, /"toolCallId"/i, /\bfunction_call\b/i, /```json\s*\{\s*"name"/i];

function log(msg: string): void {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

function fatal(code: number, msg: string): never {
  console.error(`FATAL: ${msg}`);
  process.exit(code);
}

function findFfmpeg(): string | null {
  const candidates = [
    join(REPO_ROOT, 'resources/bin/darwin-arm64/ffmpeg'),
    '/opt/homebrew/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    '/usr/bin/ffmpeg',
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  const which = spawnSync('which', ['ffmpeg'], { encoding: 'utf-8' });
  return which.status === 0 ? which.stdout.trim() : null;
}

function osa(script: string): { ok: boolean; out: string } {
  const res = spawnSync('osascript', ['-e', script], { encoding: 'utf-8', timeout: 20_000 });
  return { ok: res.status === 0, out: (res.stdout ?? '').trim() || (res.stderr ?? '').trim() };
}

/** Multi-line osascript via stdin (heredoc equivalent). */
function osaMulti(script: string): { ok: boolean; out: string } {
  const res = spawnSync('osascript', [], { input: script, encoding: 'utf-8', timeout: 20_000 });
  return { ok: res.status === 0, out: (res.stdout ?? '').trim() || (res.stderr ?? '').trim() };
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

// ── Preflight ────────────────────────────────────────────────────────────────

async function preflight(): Promise<void> {
  log('preflight: app process');
  const pg = spawnSync('pgrep', ['-f', `${APP_NAME}.app/Contents/MacOS`], { encoding: 'utf-8' });
  if (pg.status !== 0 || !pg.stdout.trim()) fatal(4, `app "${APP_NAME}" is not running (pgrep found no MacOS process)`);
  log(`preflight: app pid(s) ${pg.stdout.trim().split('\n').join(',')}`);

  const gw = await httpStatus(GATEWAY_PORT);
  if (gw === null) fatal(4, `gateway ${GATEWAY_PORT} not reachable`);
  log(`preflight: gateway ${GATEWAY_PORT} -> HTTP ${gw}`);

  const host = await httpStatus(HOST_API_PORT);
  // 401 is expected (auth-token gated) and proves the host-API is up.
  if (host === null) fatal(4, `host-API ${HOST_API_PORT} not reachable`);
  log(`preflight: host-API ${HOST_API_PORT} -> HTTP ${host} (401 = up, auth-gated)`);

  const cdp = await httpStatus(CHROME_CDP_PORT, '/json/version');
  if (cdp !== 200) log(`preflight: WARN Chrome CDP ${CHROME_CDP_PORT} -> ${cdp ?? 'down'} (Outlook lane may be unavailable)`);
  else log(`preflight: Chrome CDP ${CHROME_CDP_PORT} -> 200 (Outlook lane up)`);

  // Screen Recording permission probe: self-terminating 2s video.
  log('preflight: screen-recording permission probe (2s)');
  const probe = join(EVIDENCE_DIR, 'permission-probe.mov');
  const pr = spawnSync('/usr/sbin/screencapture', ['-v', '-V', '2', '-D', '1', probe], { encoding: 'utf-8', timeout: 15_000 });
  if (pr.status !== 0 || !existsSync(probe) || statSync(probe).size < 1000) {
    fatal(4, 'screen-recording permission NOT granted (probe produced no video). Grant Screen Recording to the terminal in System Settings > Privacy.');
  }
  log(`preflight: screen recording OK (probe ${(statSync(probe).size / 1024).toFixed(0)}KB)`);

  if (!FFMPEG) fatal(4, 'no ffmpeg found (needed to crop/encode the recording)');
  log(`preflight: ffmpeg at ${FFMPEG}`);
}

// ── Window surfacing / geometry ───────────────────────────────────────────────

interface WinGeom { x: number; y: number; w: number; h: number; scale: number; }

/**
 * Bring the app window to the front. Post-boot windows can be hidden (the close
 * handler hides rather than destroys), so a dock-icon click fires Electron's
 * `activate` -> focusMainWindow -> show(). Then AXRaise + frontmost.
 */
function surfaceWindow(): WinGeom {
  osaMulti(`
tell application "System Events" to tell process "Dock" to click UI element "${APP_NAME}" of list 1
delay 1
tell application "${APP_NAME}" to activate
delay 0.4
tell application "System Events" to tell process "${APP_NAME}"
  set frontmost to true
  if (count of windows) > 0 then perform action "AXRaise" of window 1
end tell
delay 0.4
`);
  const g = osaMulti(`
tell application "System Events" to tell process "${APP_NAME}"
  if (count of windows) is 0 then
    return "none"
  else
    set p to position of window 1
    set s to size of window 1
    return (item 1 of p) & "," & (item 2 of p) & "," & (item 1 of s) & "," & (item 2 of s)
  end if
end tell
`);
  if (!g.ok || g.out === 'none') fatal(5, `could not surface app window: ${g.out}`);
  const [x, y, w, h] = g.out.split(',').map((n) => Math.round(Number(n)));
  if (![x, y, w, h].every(Number.isFinite) || w < 100 || h < 100) fatal(5, `bad window geometry: "${g.out}"`);

  // Detect display scale (retina) = full-screen pixel width / logical points width.
  const still = join(EVIDENCE_DIR, '_scaleprobe.png');
  spawnSync('/usr/sbin/screencapture', ['-x', still], { timeout: 10_000 });
  let scale = 2;
  const dims = FFMPEG ? spawnSync(FFMPEG, ['-hide_banner', '-i', still], { encoding: 'utf-8' }).stderr ?? '' : '';
  const m = /,\s*(\d{3,5})x(\d{3,5})/.exec(dims);
  const desktop = osa('tell application "Finder" to get bounds of window of desktop 1');
  const dm = /(-?\d+),\s*(-?\d+),\s*(\d+),\s*(\d+)/.exec(desktop.out);
  if (m && dm) {
    const pixW = Number(m[1]);
    const ptW = Number(dm[3]);
    if (ptW > 0) scale = Math.max(1, Math.round((pixW / ptW) * 100) / 100);
  }
  log(`window: pos ${x},${y} size ${w}x${h} scale ${scale}`);
  return { x, y, w, h, scale };
}

/** The chat route is `/`; File>New Chat navigates to a nonexistent `/chat` (blank). */
function ensureChatRoute(): void {
  osaMulti(`
tell application "${APP_NAME}" to activate
delay 0.3
tell application "System Events" to tell process "${APP_NAME}"
  click menu item "Dashboard" of menu "Navigate" of menu bar 1
end tell
`);
  osa(`tell application "${APP_NAME}" to activate`);
}

// ── Session trajectory (settle + reply extraction) ─────────────────────────────

interface ModelCompleted { ts: string; seq: number; provider: string; modelId: string; finalPromptText: string; assistantTexts: string[]; promptErrorSource: unknown; }

function activeTrajectoryPath(): string | null {
  if (!existsSync(SESSIONS_INDEX)) return null;
  try {
    const idx = JSON.parse(readFileSync(SESSIONS_INDEX, 'utf-8')) as Record<string, { sessionFile?: string }>;
    const entry = idx['agent:main:main'] ?? Object.values(idx)[0];
    const sf = entry?.sessionFile;
    if (sf && sf.endsWith('.jsonl')) {
      const traj = sf.replace(/\.jsonl$/, '.trajectory.jsonl');
      if (existsSync(traj)) return traj;
    }
  } catch { /* fall through */ }
  // Fallback: newest .trajectory.jsonl in the main agent sessions dir.
  const dir = join(OPENCLAW_DIR, 'agents', 'main', 'sessions');
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.endsWith('.trajectory.jsonl')).map((f) => join(dir, f));
  if (!files.length) return null;
  files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return files[0];
}

function readModelCompletions(path: string): ModelCompleted[] {
  const out: ModelCompleted[] = [];
  let raw = '';
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
    const at = data.assistantTexts;
    out.push({
      ts: String(o.ts ?? ''),
      seq: Number(o.seq ?? 0),
      provider: String(o.provider ?? ''),
      modelId: String(o.modelId ?? ''),
      finalPromptText: String(data.finalPromptText ?? ''),
      assistantTexts: Array.isArray(at) ? (at as unknown[]).map((x) => String(x)) : [],
      promptErrorSource: data.promptErrorSource ?? null,
    });
  }
  return out;
}

interface Settled { outcome: 'reply' | 'model-error' | 'timeout'; entry?: ModelCompleted; reply: string; }

async function waitForSettle(trajPath: string, baselineSeq: number): Promise<Settled> {
  const deadline = Date.now() + TURN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const entries = readModelCompletions(trajPath);
    const fresh = entries.filter((e) => e.seq > baselineSeq && e.finalPromptText.includes(PROMPT));
    const target = fresh[fresh.length - 1];
    if (target) {
      if (target.promptErrorSource) return { outcome: 'model-error', entry: target, reply: '' };
      const reply = target.assistantTexts.join('\n').trim();
      if (reply) return { outcome: 'reply', entry: target, reply };
    }
    await new Promise((r) => setTimeout(r, 3_000));
    log(`  ...waiting for turn to settle (${((deadline - Date.now()) / 1000).toFixed(0)}s left)`);
  }
  return { outcome: 'timeout', reply: '' };
}

// ── Assertions ─────────────────────────────────────────────────────────────────

interface Assertions { subjectsMatched: string[]; enoughSubjects: boolean; execNoise: string[]; noExecNoise: boolean; }

function assertReply(reply: string): Assertions {
  const lc = reply.toLowerCase();
  const subjectsMatched = INBOX_SUBJECT_GROUPS.filter((g) => g.words.some((w) => lc.includes(w.toLowerCase()))).map((g) => g.label);
  const execNoise = EXEC_NOISE_MARKERS.filter((re) => re.test(reply)).map((re) => re.source);
  return {
    subjectsMatched,
    enoughSubjects: subjectsMatched.length >= 2,
    execNoise,
    noExecNoise: execNoise.length === 0,
  };
}

// ── Recording ───────────────────────────────────────────────────────────────────

function startRecording(outMov: string): ChildProcess {
  // Full display; -V omitted so it records until SIGINT (finalises the .mov).
  const child = spawn('/usr/sbin/screencapture', ['-v', '-D', '1', outMov], { stdio: 'ignore' });
  return child;
}

function stopRecording(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    child.on('close', () => resolve());
    child.kill('SIGINT');
    setTimeout(() => resolve(), 8_000);
  });
}

function cropToWindow(inMov: string, outMp4: string, g: WinGeom): { ok: boolean; detail: string } {
  if (!FFMPEG) return { ok: false, detail: 'no ffmpeg' };
  const cx = Math.round(g.x * g.scale);
  const cy = Math.round(g.y * g.scale);
  const cw = Math.round(g.w * g.scale);
  const ch = Math.round(g.h * g.scale);
  const res = spawnSync(FFMPEG, [
    '-hide_banner', '-y', '-i', inMov,
    '-vf', `crop=${cw}:${ch}:${cx}:${cy},scale=${g.w}:${g.h},fps=8`,
    '-pix_fmt', 'yuv420p', '-crf', '30', outMp4,
  ], { encoding: 'utf-8', timeout: 120_000 });
  if (res.status !== 0) return { ok: false, detail: `ffmpeg exit ${res.status}: ${(res.stderr ?? '').slice(-300)}` };
  return { ok: true, detail: `cropped ${cw}x${ch}+${cx}+${cy} -> ${g.w}x${g.h}` };
}

function screenshotWindow(g: WinGeom, outPng: string): void {
  spawnSync('/usr/sbin/screencapture', ['-x', `-R${g.x},${g.y},${g.w},${g.h}`, outPng], { timeout: 10_000 });
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const t0 = Date.now();

  await preflight();

  const geom = surfaceWindow();
  ensureChatRoute();
  const g2 = surfaceWindow(); // re-front after menu click (focus can shift)

  const trajPath = activeTrajectoryPath();
  if (!trajPath) fatal(5, 'could not locate active session trajectory jsonl');
  log(`session trajectory: ${trajPath}`);
  const baselineSeq = readModelCompletions(trajPath).reduce((mx, e) => Math.max(mx, e.seq), 0);
  log(`baseline model.completed seq: ${baselineSeq}`);

  const movPath = join(EVIDENCE_DIR, 'full-capture.mov');
  log('recording: starting screencapture');
  const rec = startRecording(movPath);
  await new Promise((r) => setTimeout(r, 1_500));

  // Focus the composer and type the prompt. The composer sits near the bottom of
  // the window; click into it, then keystroke. We NEVER click a Send button — the
  // turn is submitted with Return, and this task is read/draft-only regardless.
  log(`typing prompt: "${PROMPT}"`);
  const clickX = g2.x + Math.round(g2.w * 0.5);
  const clickY = g2.y + g2.h - 70;
  osaMulti(`
tell application "${APP_NAME}" to activate
delay 0.3
tell application "System Events"
  tell process "${APP_NAME}"
    set frontmost to true
    if (count of windows) > 0 then perform action "AXRaise" of window 1
  end tell
  delay 0.2
  click at {${clickX}, ${clickY}}
  delay 0.3
  keystroke ${JSON.stringify(PROMPT)}
  delay 0.3
  key code 36
end tell
`);
  const submitAt = Date.now();
  log('prompt submitted (Return)');

  const settled = await waitForSettle(trajPath, baselineSeq);
  const turnMs = Date.now() - submitAt;
  log(`turn ${settled.outcome} after ${(turnMs / 1000).toFixed(1)}s`);

  // Stop recording + produce artifacts.
  await new Promise((r) => setTimeout(r, 1_000));
  log('recording: stopping');
  await stopRecording(rec);
  const finalPng = join(EVIDENCE_DIR, 'final-screenshot.png');
  const g3 = surfaceWindow();
  screenshotWindow(g3, finalPng);
  const crop = cropToWindow(movPath, join(EVIDENCE_DIR, 'video.mp4'), g3);
  log(`recording: ${crop.ok ? 'video.mp4 OK' : 'crop FAILED'} — ${crop.detail}`);

  // Assess.
  const asserts = settled.outcome === 'reply' ? assertReply(settled.reply) : null;
  let verdict: string;
  if (settled.outcome === 'reply' && asserts) {
    verdict = asserts.enoughSubjects && asserts.noExecNoise
      ? 'PASS'
      : `FAIL-ASSERTION (subjects=${asserts.subjectsMatched.length}/2 noExecNoise=${asserts.noExecNoise})`;
  } else if (settled.outcome === 'model-error') {
    verdict = 'BLOCKED-MODEL-ERROR (gateway returned a model-call error; no assistant reply — composer-override / provider class)';
  } else {
    verdict = 'BLOCKED-TIMEOUT (no reply within timeout)';
  }

  const summary = {
    verdict,
    attachMechanism: 'macOS UI automation (osascript/System Events) + screencapture video (CDP-to-app-renderer unavailable; port 9223 closed)',
    prompt: PROMPT,
    model: settled.entry ? { provider: settled.entry.provider, modelId: settled.entry.modelId } : null,
    turnMs,
    outcome: settled.outcome,
    replyChars: settled.reply.length,
    assertions: asserts,
    recording: { mov: existsSync(movPath), video: crop.ok, detail: crop.detail },
    trajectory: trajPath,
    totalMs: Date.now() - t0,
  };
  writeFileSync(join(EVIDENCE_DIR, 'run-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  if (settled.reply) writeFileSync(join(EVIDENCE_DIR, 'reply.txt'), settled.reply);
  console.log(`\n=== ${verdict} ===`);
  console.log(`evidence: ${EVIDENCE_DIR}`);
  process.exit(verdict.startsWith('PASS') ? 0 : 9);
}

main().catch((err) => {
  console.error('CRASH:', err instanceof Error ? err.message : String(err));
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(2);
});
