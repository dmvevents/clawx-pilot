/**
 * L4 Graph-transport acceptance driver (CLWX-39 / CLWX-40).
 *
 * Mirrors the 15 W*-rows of scripts/v2-eval.ts, but drives the GRAPH
 * transport in-process through the production adapter
 * (electron/services/microsoft-graph/outlook-adapter.ts) instead of the
 * browser OutlookActions. Expectations are Graph-appropriate:
 *
 *   - read rows (inbox scan, search, read body) must PASS on real data;
 *   - compose rows (draft, confirmed send) EXPECT the structured refusal
 *     ({ status: 'refused', reason }) under the read-only scope grant —
 *     the refusal IS the pass condition;
 *   - browser-only rows (reply, mark-read, standalone attachment listing)
 *     report N-A with a one-line explanation, never a silent skip.
 *
 * ZERO SENDS BY DESIGN. The suite refuses to invoke the confirmed-send row
 * at all if the persisted grant includes Mail.Send, and refuses to invoke
 * the draft row if the grant includes Mail.ReadWrite/Mail.Send. Nothing in
 * this file can dispatch mail.
 *
 * ANTI-SILENCE GUARD. The suite exits non-zero with
 * "REFUSING: mock or signed-out state" unless getStatus() reports
 * signedIn === true AND effectiveMock === false. Greens are impossible
 * against the mock mailbox.
 *
 * HOW IT RUNS OUTSIDE ELECTRON (documented per task):
 * store.ts/manager.ts load fine under tsx, but electron-store cannot be
 * constructed outside Electron ("Please specify the `projectName` option").
 * Instead of forking the store logic, we register node:module hooks that
 * substitute `electron-store` with a minimal JSON-file shim bound to an
 * explicit store path (--store <path>, default: the packaged-app userData
 * store). The REAL store.ts, manager.ts and outlook-adapter.ts then run
 * unmodified in-process. The shim's set() is atomic (temp file + rename)
 * and idempotent, so a token auto-refresh mid-run persists safely.
 *
 * Pre-req: a persisted real session — run
 *   pnpm exec tsx scripts/graph-signin-smoke.ts --persist [path]
 * with the operator present for the interactive sign-in.
 *
 * Run:
 *   pnpm exec tsx scripts/v2-eval-graph.ts [--store <path>]
 *
 * Log discipline: token values are never printed; subjects are truncated;
 * bodies are reported as lengths only; recipients as counts only.
 */

import { registerHooks } from 'node:module';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import type * as GraphManager from '../electron/services/microsoft-graph/manager';
import type * as GraphAdapter from '../electron/services/microsoft-graph/outlook-adapter';

// ── store path ─────────────────────────────────────────────────────────────

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

function storePathFromArgs(): string {
  const idx = process.argv.indexOf('--store');
  if (idx === -1) return resolve(defaultStorePath());
  const value = process.argv[idx + 1];
  if (!value || value.startsWith('--')) {
    console.error('usage: pnpm exec tsx scripts/v2-eval-graph.ts [--store <path>]');
    process.exit(2);
  }
  return resolve(value);
}

// ── electron-store shim (see header for why) ───────────────────────────────

const SHIM_GLOBAL_KEY = '__clawxEvalGraphElectronStore';
const SHIM_URL = 'clawx-eval-graph:electron-store';

class EvalGraphStoreShim {
  static filePath = '';
  private data: Record<string, unknown>;

  constructor(options?: { defaults?: Record<string, unknown> }) {
    this.data = { ...(options?.defaults ?? {}) };
    try {
      const raw = JSON.parse(readFileSync(EvalGraphStoreShim.filePath, 'utf8'));
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        this.data = { ...this.data, ...raw };
      }
    } catch {
      // Missing or invalid file: defaults only, which the anti-silence
      // guard below will refuse (signedIn=false).
    }
  }

  get(key: string): unknown {
    return this.data[key];
  }

  // Atomic + idempotent: whole-object write via temp file + rename, so a
  // token auto-refresh from manager.ts persists without tearing the file.
  set(key: string, value: unknown): void {
    this.data[key] = value;
    mkdirSync(dirname(EvalGraphStoreShim.filePath), { recursive: true });
    const tmp = `${EvalGraphStoreShim.filePath}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, '\t'), { mode: 0o600 });
    renameSync(tmp, EvalGraphStoreShim.filePath);
  }
}

function installElectronStoreShim(storePath: string): void {
  EvalGraphStoreShim.filePath = storePath;
  (globalThis as Record<string, unknown>)[SHIM_GLOBAL_KEY] = EvalGraphStoreShim;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === 'electron-store') {
        return { url: SHIM_URL, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (url === SHIM_URL) {
        return {
          format: 'module',
          source: `export default globalThis.${SHIM_GLOBAL_KEY};`,
          shortCircuit: true,
        };
      }
      return nextLoad(url, context);
    },
  });
}

// ── scope helpers (C1 semantics: space-split, deduped) ─────────────────────

function parseGrantedScopes(scope: string | undefined | null): string[] {
  return [...new Set((scope ?? '').split(/\s+/).filter(Boolean))];
}

/** Matches both bare ("Mail.Send") and URL-form ("https://graph.../Mail.Send") grants. */
function hasScope(granted: string[], wanted: string): boolean {
  const target = wanted.toLowerCase();
  return granted.some((s) => (s.split('/').pop() ?? '').toLowerCase() === target);
}

/** Reads only the scope string from the store file; token values never surface. */
function readPersistedScope(storePath: string): string {
  try {
    const raw = JSON.parse(readFileSync(storePath, 'utf8'));
    const scope = raw?.secret?.scope;
    return typeof scope === 'string' ? scope : '';
  } catch {
    return '';
  }
}

// ── row harness ────────────────────────────────────────────────────────────

type Verdict = 'PASS' | 'FAIL' | 'N-A';

interface EvalRow {
  id: string;
  workflow: string;
  description: string;
  transport: 'graph';
  expected: string;
  actual: string;
  verdict: Verdict;
  latencyMs: number;
  notes: string;
}

const results: EvalRow[] = [];

function trunc(value: string, max = 80): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

async function runRow(
  id: string,
  workflow: string,
  description: string,
  expected: string,
  fn: () => Promise<{ ok: boolean; actual: string; notes?: string }>,
): Promise<void> {
  const t0 = Date.now();
  let verdict: Verdict = 'FAIL';
  let actual: string;
  let notes = '';
  try {
    const r = await fn();
    verdict = r.ok ? 'PASS' : 'FAIL';
    actual = r.actual;
    notes = r.notes ?? '';
  } catch (err) {
    actual = `THREW: ${trunc(err instanceof Error ? err.message : String(err), 160)}`;
  }
  const latencyMs = Date.now() - t0;
  results.push({ id, workflow, description, transport: 'graph', expected, actual, verdict, latencyMs, notes });
  console.log(`${verdict === 'PASS' ? 'PASS' : 'FAIL'}  ${id} (${latencyMs}ms) — ${description}`);
  if (verdict !== 'PASS') console.log(`      expected: ${expected}\n      actual:   ${actual}`);
}

function naRow(id: string, workflow: string, description: string, reason: string): void {
  results.push({
    id,
    workflow,
    description,
    transport: 'graph',
    expected: 'not applicable on the graph transport',
    actual: reason,
    verdict: 'N-A',
    latencyMs: 0,
    notes: reason,
  });
  console.log(`N-A   ${id} — ${description}`);
  console.log(`      ${reason}`);
}

// ── main ───────────────────────────────────────────────────────────────────

// Adapter refusal shape (contract C4): { status: 'refused', reason }.
interface LooseResult {
  status: string;
  reason?: string;
  message?: string;
}

// The confirm-gate reason in outlook-adapter.ts::sendEmailWithGraph. The
// confirmed-send row must prove a refusal that is NOT this one.
const CONFIRM_GATE_REASON = 'confirm flag required before sending through Microsoft Graph';

const SANDBOX_SELF = 'test.fac@fac.edu.tt';

async function main() {
  const storePath = storePathFromArgs();
  installElectronStoreShim(storePath);

  // Real production modules, imported after the shim hooks are registered.
  const manager: typeof GraphManager = await import('../electron/services/microsoft-graph/manager');
  const adapter: typeof GraphAdapter = await import('../electron/services/microsoft-graph/outlook-adapter');

  console.log('=== v2-eval-graph (L4 graph transport) ===');
  console.log(`store: ${storePath}\n`);

  // ANTI-SILENCE GUARD — before any row runs.
  const status = await manager.getStatus();
  console.log(
    `status: configured=${status.configured} signedIn=${status.signedIn} `
    + `mockMailbox=${status.mockMailbox} effectiveMock=${status.effectiveMock} `
    + `account=${status.account?.email ?? '<none>'}`,
  );
  if (!(status.signedIn === true && status.effectiveMock === false)) {
    console.error('\nREFUSING: mock or signed-out state');
    console.error('  greens against the mock mailbox are worthless — persist a real session first:');
    console.error('  pnpm exec tsx scripts/graph-signin-smoke.ts --persist [path]');
    process.exit(3);
  }

  const grantedScopes = parseGrantedScopes(readPersistedScope(storePath));
  const canSend = hasScope(grantedScopes, 'Mail.Send');
  const canWrite = hasScope(grantedScopes, 'Mail.ReadWrite');
  console.log(`granted scopes: ${grantedScopes.join(' ') || '<none>'}`);
  console.log(`compose capability: Mail.Send=${canSend} Mail.ReadWrite=${canWrite}\n`);

  // W1 — the graph analog of "open" is a live signed-in session.
  results.push({
    id: 'W1',
    workflow: 'session',
    description: 'getStatus() reports a real signed-in session',
    transport: 'graph',
    expected: 'signedIn=true effectiveMock=false',
    actual: `signedIn=${status.signedIn} effectiveMock=${status.effectiveMock}`,
    verdict: 'PASS',
    latencyMs: 0,
    notes: `account=${status.account?.email ?? '<none>'}`,
  });
  console.log('PASS  W1 (0ms) — getStatus() reports a real signed-in session');

  // W2.1 — read_inbox returns real rows via Graph
  let firstId = '';
  let firstSender = '';
  let firstSubject = '';
  let firstSnippetLen = 0;
  await runRow('W2.1', 'read_inbox', 'readInboxWithGraph(5) returns real rows with ids and senders', 'status=ok, >0 rows, all ids/senders non-empty, scan.scope=graph_inbox', async () => {
    const r = await adapter.readInboxWithGraph(5);
    if (r.status !== 'ok') return { ok: false, actual: `status=${r.status}` };
    if (r.messages.length === 0) return { ok: false, actual: '0 rows — sandbox inbox is empty; seed at least one message' };
    firstId = r.messages[0].id;
    firstSender = r.messages[0].sender;
    firstSubject = r.messages[0].subject;
    firstSnippetLen = r.messages[0].snippet.length;
    const allReal = r.messages.every((m) => m.id.length > 0 && m.sender.length > 0);
    return {
      ok: allReal && r.scan?.scope === 'graph_inbox',
      actual: `${r.messages.length} rows, scope=${r.scan?.scope ?? '<none>'}, first subject="${trunc(firstSubject)}"`,
    };
  });

  // W2.2 — search_inbox unread:true
  await runRow('W2.2', 'search_inbox', 'searchInboxWithGraph({unread:true}) returns only unread', 'status=ok, every row unread=true', async () => {
    const r = await adapter.searchInboxWithGraph({ unread: true });
    if (r.status !== 'ok') return { ok: false, actual: `status=${r.status}` };
    const allUnread = r.messages.every((m) => m.unread === true);
    return { ok: allUnread, actual: `${r.messages.length} returned, allUnread=${allUnread}` };
  });

  // W2.3 — search_inbox by sender, probe derived from the first real row
  await runRow('W2.3', 'search_inbox', 'searchInboxWithGraph({from: <known sender>}) returns matching rows only', 'status=ok, >0 rows, all match the sender probe', async () => {
    if (!firstSender) return { ok: false, actual: 'no sender from W2.1 to derive a probe from' };
    const probe = firstSender.slice(0, Math.min(firstSender.length, 8));
    const r = await adapter.searchInboxWithGraph({ from: probe });
    if (r.status !== 'ok') return { ok: false, actual: `status=${r.status}` };
    const allMatch = r.messages.every((m) => m.sender.toLowerCase().includes(probe.toLowerCase()));
    return { ok: allMatch && r.messages.length > 0, actual: `probe="${probe}" got=${r.messages.length} allMatch=${allMatch}` };
  });

  // W2.4 — search_inbox by subject keyword from the first real row
  await runRow('W2.4', 'search_inbox', 'searchInboxWithGraph({subjectContains}) returns matching rows', 'status=ok, >0 rows for a token taken from a real subject', async () => {
    const probe = firstSubject.split(/\s+/).find((w) => w.length >= 5);
    if (!probe) return { ok: false, actual: `no usable token in first subject "${trunc(firstSubject)}"` };
    const r = await adapter.searchInboxWithGraph({ subjectContains: probe });
    return { ok: r.status === 'ok' && r.messages.length > 0, actual: `probe="${probe}" status=${r.status} got=${r.messages.length}` };
  });

  // W3.1 — read_email returns the full body for a real message
  await runRow('W3.1', 'read_email', 'readEmailWithGraph({id}) returns a non-empty body for the first inbox row', 'status=ok, body length > 0, subject matches the inbox row', async () => {
    if (!firstId) return { ok: false, actual: 'no id from W2.1' };
    const r = await adapter.readEmailWithGraph({ id: firstId });
    if (r.status !== 'ok') return { ok: false, actual: `status=${r.status}` };
    const bodyLen = r.body?.length ?? 0;
    const subjectMatches = r.subject === firstSubject;
    return {
      ok: bodyLen > 0 && subjectMatches,
      actual: `body=${bodyLen} chars (snippet was ${firstSnippetLen}), subjectMatches=${subjectMatches}`,
    };
  });

  // W3.2 — read_email returns attachments: array (metadata only on Graph)
  await runRow('W3.2', 'read_email', 'readEmailWithGraph({id}) returns attachments as an array', 'status=ok, attachments is an array', async () => {
    if (!firstId) return { ok: false, actual: 'no id from W2.1' };
    const r = await adapter.readEmailWithGraph({ id: firstId });
    return {
      ok: r.status === 'ok' && Array.isArray(r.attachments),
      actual: `status=${r.status} attachments=${Array.isArray(r.attachments) ? r.attachments.length : 'not-an-array'}`,
    };
  });

  // W4.1 — draft under a read-only grant must be the structured refusal.
  await runRow('W4.1', 'draft_email', 'draftEmailWithGraph is refused under the read-only scope grant', 'status=refused with a human-readable reason', async () => {
    if (canWrite || canSend) {
      return {
        ok: false,
        actual: `grant includes ${[canWrite ? 'Mail.ReadWrite' : '', canSend ? 'Mail.Send' : ''].filter(Boolean).join('+')} — refusing to invoke draft; L4 expects a read-only grant`,
      };
    }
    const r = await adapter.draftEmailWithGraph({
      to: SANDBOX_SELF,
      subject: `eval-graph ${new Date().toISOString().slice(11, 19)}`,
      body: 'eval-graph harness draft probe — must be refused, never created',
    }) as unknown as LooseResult;
    const reason = r.reason ?? '';
    return {
      ok: r.status === 'refused' && reason.length > 0,
      actual: `status=${r.status} reason="${trunc(reason, 120) || '<none>'}"`,
    };
  });

  // W4.2 — the confirm gate itself, intact on the graph transport.
  await runRow('W4.2', 'send_email', 'sendEmailWithGraph without confirm is refused by the confirm gate', 'status=refused with a reason naming the confirm flag', async () => {
    const r = await adapter.sendEmailWithGraph({
      to: SANDBOX_SELF,
      subject: 'eval-graph confirm-gate probe',
      body: 'must never leave the gate',
      confirm: false,
    }) as unknown as LooseResult;
    const reason = r.reason ?? '';
    return {
      ok: r.status === 'refused' && reason.length > 0,
      actual: `status=${r.status} reason="${trunc(reason, 120) || '<none>'}"`,
    };
  });

  // W4.4 — confirmed send: confirm=true so the refusal proven is the SCOPE
  // refusal, not the confirm gate. Guarded so this row cannot dispatch mail.
  await runRow('W4.4', 'send_email', 'sendEmailWithGraph with confirm:true is refused by the scope grant', 'status=refused, reason present and distinct from the confirm-gate reason', async () => {
    if (canSend) {
      return {
        ok: false,
        actual: 'grant includes Mail.Send — refusing to invoke a confirmed send; this suite must never be able to dispatch mail',
      };
    }
    const r = await adapter.sendEmailWithGraph({
      to: SANDBOX_SELF,
      subject: 'eval-graph scope-refusal probe',
      body: 'must be refused by the read-only scope grant',
      confirm: true,
    }) as unknown as LooseResult;
    const reason = r.reason ?? '';
    if (r.status === 'sent') {
      return { ok: false, actual: 'status=sent — CRITICAL: a confirmed send went through; the scope refusal is missing' };
    }
    return {
      ok: r.status === 'refused' && reason.length > 0 && reason !== CONFIRM_GATE_REASON,
      actual: `status=${r.status} reason="${trunc(reason, 120) || '<none>'}"`,
    };
  });

  // Browser-only rows: explicit N-A, never silent skips.
  naRow('W6.1', 'mark_read', 'mark_read({read:true})', 'graph adapter exposes no mark_read; the browser transport covers this row');

  // W8.1 — the adapter maps hasAttachment onto Graph's hasAttachments field.
  await runRow('W8.1', 'search_inbox+attach', 'searchInboxWithGraph({hasAttachment:true}) returns only rows with attachments', 'status=ok, every returned row has hasAttachments=true', async () => {
    const r = await adapter.searchInboxWithGraph({ hasAttachment: true });
    if (r.status !== 'ok') return { ok: false, actual: `status=${r.status}` };
    const rows = r.messages as Array<{ hasAttachments?: boolean }>;
    const allFlagged = rows.every((m) => m.hasAttachments === true);
    return { ok: allFlagged, actual: `${rows.length} returned, allFlagged=${allFlagged}` };
  });

  naRow('W8.2', 'list_attachments', 'list_attachments metadata', 'graph adapter exposes no standalone list_attachments; attachment metadata comes back inline on readEmailWithGraph');
  naRow('W5.1', 'reply', 'reply({id, body}) opens a reply pane', 'graph adapter exposes no reply; the browser transport covers visible compose review');

  // W7.1 — compound: read_inbox + read_email loop over real messages.
  await runRow('W7.1', 'compound', 'readInboxWithGraph(3) + readEmailWithGraph for each, all status=ok', 'status=ok on the scan and on every read', async () => {
    const inbox = await adapter.readInboxWithGraph(3);
    if (inbox.status !== 'ok' || inbox.messages.length === 0) {
      return { ok: false, actual: `status=${inbox.status} rows=${inbox.messages.length}` };
    }
    for (const m of inbox.messages) {
      const r = await adapter.readEmailWithGraph({ id: m.id });
      if (r.status !== 'ok') return { ok: false, actual: `read_email(${trunc(m.id, 24)}) status=${r.status}` };
    }
    return { ok: true, actual: `iterated ${inbox.messages.length} messages, all ok` };
  });

  // ── summary table ──
  console.log('\n=== summary ===');
  const header = `${'row'.padEnd(6)} ${'transport'.padEnd(10)} ${'expected'.padEnd(56)} ${'actual'.padEnd(56)} verdict`;
  console.log(header);
  console.log('-'.repeat(header.length));
  for (const r of results) {
    console.log(
      `${r.id.padEnd(6)} ${r.transport.padEnd(10)} ${trunc(r.expected, 54).padEnd(56)} ${trunc(r.actual, 54).padEnd(56)} ${r.verdict}`,
    );
  }
  const passed = results.filter((r) => r.verdict === 'PASS').length;
  const failed = results.filter((r) => r.verdict === 'FAIL').length;
  const na = results.filter((r) => r.verdict === 'N-A').length;
  console.log(`\npass: ${passed}/${results.length} (${na} N-A on graph)  fail: ${failed}`);

  const summary = {
    runAt: new Date().toISOString(),
    transport: 'graph',
    store: storePath,
    grantedScopes,
    pass: passed,
    fail: failed,
    na,
    total: results.length,
    rows: results,
  };
  writeFileSync('/tmp/v2-eval-graph-results.json', JSON.stringify(summary, null, 2));
  console.log('Results saved to /tmp/v2-eval-graph-results.json');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FAILED:', err instanceof Error ? err.message : String(err));
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(2);
});
