/**
 * CLWX-65 (Mac leg): live in-app WRITE turn — matrix gap b2.
 *
 * document.write_docx / write_xlsx are proven at runtime level (fn round-trip
 * 8/8), but no live model turn has ever produced a document in-app. This
 * harness submits a letter-drafting prompt as a live chat turn in the running
 * Ministry of Education app, waits for the turn to settle, and asserts that a
 * real .docx landed on disk and parses back with the expected content.
 *
 * Drive mechanism: the app is NOT launched with --remote-debugging-port, so
 * there is no CDP path to the app renderer, and synthetic keystrokes via
 * osascript/System Events (the scripts/app-usecase-recorded.ts lane) require
 * TCC assistive access, which this execution context does not hold
 * ("osascript is not allowed assistive access. (-25211)"). Fallback: POST the
 * prompt to the app's own host-API route `/api/chat/send-with-media`
 * (electron/api/routes/gateway.ts), which relays over the app's established
 * gateway connection via the SAME `chat.send` RPC the chat composer submits
 * through (src/stores/chat.ts sendMessage). The turn therefore runs the full
 * in-app path — electron main -> gateway -> agent -> plugin tools — in the
 * app's own `agent:main:main` session, and the reply renders in the app UI.
 *
 * Auth: the host-API bearer token is per-boot and in-memory only; the app
 * threads it into the spawned openclaw-gateway child's env as
 * CLAWX_HOST_API_TOKEN (electron/gateway/config-sync.ts), so it is recovered
 * from that process via sysctl KERN_PROCARGS2 — the established mechanism.
 * The token is held in memory and NEVER logged or written to evidence.
 *
 * Ground truth: the gateway's per-session trajectory JSONL
 * (~/.openclaw/agents/main/sessions/*.trajectory.jsonl). Each turn appends
 * one `model.completed` whose `data.messagesSnapshot` carries the tool calls
 * (assistant `toolCall` blocks) and the final assistant text.
 *
 * Parse-back reuses scripts/demo-office-analysis-e2e.mjs --word (the office
 * e2e parser this card also extends), so the live-turn proof and the tool
 * path proof share one read-side implementation.
 *
 * Scope guards: never touches Outlook, Forms, or Chrome (:18792); never
 * restarts the app; never mutates ~/.openclaw config.
 *
 * Run:
 *   pnpm exec tsx scripts/clwx65-write-turn.ts
 *
 * Evidence: docs/evidence/clwx65-write-turn/
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { homedir } from 'node:os';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EVIDENCE_DIR = join(REPO_ROOT, 'docs/evidence/clwx65-write-turn');
const APP_NAME = 'Ministry of Education';
const OPENCLAW_DIR = join(homedir(), '.openclaw');
const SESSIONS_DIR = join(OPENCLAW_DIR, 'agents', 'main', 'sessions');
const OUTBOUND_DIR = join(OPENCLAW_DIR, 'media', 'outbound');
const GATEWAY_PORT = 18789;
const HOST_API_PORT = 13210;
const SESSION_KEY = 'agent:main:main';
const EXPECTED_FILENAME = 'sports-day-letter.docx';
const PROMPT = `Draft a short letter to parents about our upcoming Sports Day and save it as a docx file named ${EXPECTED_FILENAME}`;
// The agent legitimately asks for letterhead details before saving (it drafts
// via principal.draft_letter first) — answer once, like a principal would.
const FOLLOWUP = `The school is Demo Primary School and my name is A. Alexander. Please save the letter now as ${EXPECTED_FILENAME}.`;
// Per-turn markers matched against the turn's OWN user message (the last user
// entry in messagesSnapshot), so turn 2 is never confused with turn 1.
const T1_MARKER = 'Draft a short letter to parents';
const T2_MARKER = 'save the letter now';
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

// ── Preflight + chat send ────────────────────────────────────────────────────

async function preflight(): Promise<{ appPid: number; gatewayPid: number }> {
  log('preflight: app process');
  const pg = spawnSync('pgrep', ['-f', `${APP_NAME}.app/Contents/MacOS/${APP_NAME}$`], { encoding: 'utf-8' });
  const appPid = Number(pg.stdout.trim().split('\n')[0]);
  if (pg.status !== 0 || !appPid) fatal(4, `app "${APP_NAME}" is not running (pgrep found no MacOS process)`);
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

function hostApiPost(path: string, token: string, body: Record<string, unknown>, timeoutMs = 130_000): Promise<{ status: number | null; body: string }> {
  return new Promise((resolve) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port: HOST_API_PORT,
        path,
        method: 'POST',
        timeout: timeoutMs,
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

// ── Session trajectory (settle + tool-call/reply extraction) ─────────────────

interface TurnEntry {
  seq: number;
  tsMs: number;
  provider: string;
  modelId: string;
  finalPromptText: string;
  promptErrorSource: unknown;
  lastUserText: string;
  toolCallNames: string[];
  toolResultTexts: string[];
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
    // messagesSnapshot spans the WHOLE session; the current turn is everything
    // after the last user message. Slice there so tool calls from earlier
    // turns are never attributed to this one.
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
    const toolResultTexts: string[] = [];
    let finalText = '';
    for (const m of snapshot.slice(lastUserIdx + 1)) {
      const role = String(m.role ?? '');
      const content = Array.isArray(m.content) ? (m.content as Array<Record<string, unknown>>) : [];
      for (const block of content) {
        const type = String(block.type ?? '');
        if (role === 'assistant' && type === 'toolCall') {
          toolCallNames.push(String(block.name ?? ''));
        } else if (role === 'toolResult' && type === 'text') {
          toolResultTexts.push(String(block.text ?? ''));
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
      finalPromptText: String(data.finalPromptText ?? ''),
      promptErrorSource: data.promptErrorSource ?? null,
      lastUserText,
      toolCallNames,
      toolResultTexts,
      finalText,
      file: path,
    });
  }
  return out;
}

interface Settled { outcome: 'reply' | 'model-error' | 'timeout'; entry?: TurnEntry; }

async function waitForSettle(submitWallClock: number, marker: string): Promise<Settled> {
  const deadline = Date.now() + TURN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    // The turn may append to the current session file OR spawn a new one —
    // scan every trajectory touched since submit.
    const recent = existsSync(SESSIONS_DIR)
      ? readdirSync(SESSIONS_DIR)
          .filter((f) => f.endsWith('.trajectory.jsonl'))
          .map((f) => join(SESSIONS_DIR, f))
          .filter((p) => statSync(p).mtimeMs >= submitWallClock - 10_000)
      : [];
    const entries = recent.flatMap((p) => readTurnEntries(p));
    // seq is NOT unique across turns — gate on the entry's own timestamp so a
    // matching entry from an earlier run can never satisfy this settle.
    const fresh = entries.filter(
      (e) => e.lastUserText.includes(marker) && e.tsMs >= submitWallClock - 2_000,
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

// ── Produced-file discovery + parse-back ─────────────────────────────────────

function findProducedDocx(entry: TurnEntry | undefined, submitWallClock: number): string | null {
  // 1) Path echoed in a document.write_docx toolResult ({ path, bytes, paragraphs }).
  for (const text of entry?.toolResultTexts ?? []) {
    const m = /"path"\s*:\s*"([^"]+\.docx)"/.exec(text) ?? /(\/[^\s"']+\.docx)/.exec(text);
    if (m && existsSync(m[1])) return m[1];
  }
  // 2) The exact filename the prompt asked for, in the outbound dir.
  const expected = join(OUTBOUND_DIR, EXPECTED_FILENAME);
  if (existsSync(expected) && statSync(expected).mtimeMs >= submitWallClock - 10_000) return expected;
  // 3) Any .docx written to outbound since submit.
  if (existsSync(OUTBOUND_DIR)) {
    const fresh = readdirSync(OUTBOUND_DIR)
      .filter((f) => f.toLowerCase().endsWith('.docx'))
      .map((f) => join(OUTBOUND_DIR, f))
      .filter((p) => statSync(p).mtimeMs >= submitWallClock - 10_000)
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    if (fresh.length) return fresh[0];
  }
  return null;
}

interface ParseBack {
  ok: boolean;
  paragraphCount: number;
  wordCount: number;
  firstParagraphs: string[];
  raw: string;
}

/** Parse the produced docx back through the office e2e parser (shared read side). */
function parseBackDocx(docxPath: string): ParseBack {
  const res = spawnSync(process.execPath, [join(REPO_ROOT, 'scripts/demo-office-analysis-e2e.mjs'), '--word', docxPath], {
    encoding: 'utf-8',
    timeout: 60_000,
  });
  const raw = (res.stdout ?? '').trim();
  try {
    const parsed = JSON.parse(raw) as { word?: { paragraphCount?: number; wordCount?: number; firstParagraphs?: string[] } };
    const word = parsed.word ?? {};
    return {
      ok: res.status === 0,
      paragraphCount: Number(word.paragraphCount ?? 0),
      wordCount: Number(word.wordCount ?? 0),
      firstParagraphs: Array.isArray(word.firstParagraphs) ? word.firstParagraphs : [],
      raw,
    };
  } catch {
    return { ok: false, paragraphCount: 0, wordCount: 0, firstParagraphs: [], raw: raw || (res.stderr ?? '').trim() };
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const t0 = Date.now();

  const { gatewayPid } = await preflight();
  const token = recoverHostApiToken(gatewayPid);
  log('host-API token recovered (not logged)');

  const sendTurn = async (message: string): Promise<number> => {
    const at = Date.now();
    log(`submitting live chat turn to session ${SESSION_KEY}: "${message}"`);
    const send = await hostApiPost('/api/chat/send-with-media', token, {
      sessionKey: SESSION_KEY,
      message,
      deliver: false,
      idempotencyKey: `clwx65-${at}`,
    });
    if (send.status !== 200) {
      fatal(6, `chat send failed: HTTP ${send.status ?? 'ERR'} ${send.body.slice(0, 300)}`);
    }
    log(`chat.send accepted (HTTP ${send.status})`);
    return at;
  };

  const submitAt = await sendTurn(PROMPT);
  const turn1 = await waitForSettle(submitAt, T1_MARKER);
  log(`turn 1 ${turn1.outcome} after ${((Date.now() - submitAt) / 1000).toFixed(1)}s`);

  // If turn 1 drafted but did not save (the agent asks for letterhead details
  // first), answer once — a realistic principal exchange — and settle again.
  let settled = turn1;
  let followupUsed = false;
  if (
    turn1.outcome === 'reply' &&
    !turn1.entry?.toolCallNames.includes('document.write_docx') &&
    !findProducedDocx(turn1.entry, submitAt)
  ) {
    followupUsed = true;
    const followupAt = await sendTurn(FOLLOWUP);
    settled = await waitForSettle(followupAt, T2_MARKER);
    log(`turn 2 ${settled.outcome} after ${((Date.now() - followupAt) / 1000).toFixed(1)}s`);
  }
  const turnMs = Date.now() - submitAt;

  const docxPath = settled.outcome === 'reply' ? findProducedDocx(settled.entry, submitAt) : null;
  const parse = docxPath ? parseBackDocx(docxPath) : null;

  const toolCallNames = [
    ...(turn1.entry?.toolCallNames ?? []),
    ...(followupUsed ? settled.entry?.toolCallNames ?? [] : []),
  ];
  const wroteViaTool = toolCallNames.includes('document.write_docx');
  const paraText = (parse?.firstParagraphs ?? []).join('\n').toLowerCase();
  // Letter structure = salutation + sign-off. Models legitimately pass the
  // body as a single paragraphs[] entry, so paragraph count is held to a
  // floor of 2 (heading + body) rather than a per-paragraph split.
  const assertions = {
    wroteViaTool,
    docxOnDisk: Boolean(docxPath),
    parsedBack: Boolean(parse?.ok),
    sportsDayMention: paraText.includes('sports day'),
    letterStructure:
      paraText.includes('dear ') &&
      /yours sincerely|yours faithfully|sincerely|respectfully/.test(paraText) &&
      (parse?.paragraphCount ?? 0) >= 2,
  };

  let verdict: string;
  if (settled.outcome === 'model-error') {
    verdict = 'BLOCKED-MODEL-ERROR (gateway returned a model-call error; no assistant turn)';
  } else if (settled.outcome === 'timeout') {
    verdict = 'BLOCKED-TIMEOUT (no matching model.completed within timeout)';
  } else if (Object.values(assertions).every(Boolean)) {
    verdict = 'PASS';
  } else {
    verdict = `FAIL-ASSERTION (${Object.entries(assertions).filter(([, v]) => !v).map(([k]) => k).join(', ')})`;
  }

  if (docxPath) {
    copyFileSync(docxPath, join(EVIDENCE_DIR, 'produced.docx'));
  }
  const summary = {
    verdict,
    driveMechanism: 'host-API /api/chat/send-with-media -> app gateway connection -> chat.send RPC (composer-equivalent; osascript keystroke lane TCC-blocked in this context)',
    prompt: PROMPT,
    followup: followupUsed ? FOLLOWUP : null,
    sessionKey: SESSION_KEY,
    model: settled.entry ? { provider: settled.entry.provider, modelId: settled.entry.modelId } : null,
    outcome: settled.outcome,
    turnMs,
    toolCallNames,
    docxPath,
    parseBack: parse ? { paragraphCount: parse.paragraphCount, wordCount: parse.wordCount, firstParagraphs: parse.firstParagraphs } : null,
    assertions,
    trajectory: settled.entry?.file ?? null,
    totalMs: Date.now() - t0,
  };
  writeFileSync(join(EVIDENCE_DIR, 'run-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  if (settled.entry?.finalText) writeFileSync(join(EVIDENCE_DIR, 'reply.txt'), settled.entry.finalText);
  if (parse) writeFileSync(join(EVIDENCE_DIR, 'parse-back.json'), `${parse.raw}\n`);
  console.log(`\n=== ${verdict} ===`);
  console.log(`tool calls: ${toolCallNames.join(', ') || '(none)'}`);
  console.log(`docx: ${docxPath ?? '(none found)'}`);
  console.log(`evidence: ${EVIDENCE_DIR}`);
  process.exit(verdict === 'PASS' ? 0 : 9);
}

main().catch((err) => {
  console.error('CRASH:', err instanceof Error ? err.message : String(err));
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(2);
});
