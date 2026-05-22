#!/usr/bin/env node
/**
 * ClawX self-test runner.
 *
 * Runs continuously (or as a cron job) and verifies the principal's stack:
 *   1. Local LLM endpoint reachable + model loaded (offline path)
 *   2. Tool-calling actually works on the local model (3 canary prompts)
 *   3. Cloud LLM endpoint reachable (online path)
 *   4. Gateway health endpoint OK
 *   5. Browser plugin port reachable
 *
 * Writes a structured report to ~/.openclaw/selftest/last-run.json and
 * appends a row to ~/.openclaw/selftest/history.csv. Exits 0 if at least
 * one of the local-or-cloud paths is healthy (failover acceptable), 1 if
 * both are dead.
 *
 * Usage:
 *   node scripts/clawx-selftest.mjs                 # one shot
 *   node scripts/clawx-selftest.mjs --watch         # every 30 min forever
 *   node scripts/clawx-selftest.mjs --json          # only print final JSON
 *
 * Designed to be invokable from launchd (macOS), Task Scheduler (Windows),
 * or a CI workflow. No third-party dependencies — Node 20+ stdlib only.
 */
import { mkdirSync, appendFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const SELFTEST_DIR = join(homedir(), '.openclaw', 'selftest');
mkdirSync(SELFTEST_DIR, { recursive: true });
const REPORT_PATH = join(SELFTEST_DIR, 'last-run.json');
const HISTORY_PATH = join(SELFTEST_DIR, 'history.csv');

const OLLAMA_BASE = process.env.CLAWX_LOCAL_LLM_URL || 'http://127.0.0.1:11434/v1';
const OLLAMA_MODEL = process.env.CLAWX_LOCAL_LLM_MODEL || 'qwen3:8b';
const CLOUD_BASE = process.env.CLAWX_CLOUD_LLM_URL || 'http://127.0.0.1:8080';
const GATEWAY_HEALTH = process.env.CLAWX_GATEWAY_URL || 'http://127.0.0.1:18789/health';
const BROWSER_PORT = process.env.CLAWX_BROWSER_URL || 'http://127.0.0.1:18791/health';

const args = new Set(process.argv.slice(2));
const watch = args.has('--watch');
const onlyJson = args.has('--json');
const log = (...m) => { if (!onlyJson) console.log('[selftest]', ...m); };

const CANARY_TOOLS = [
  { type: 'function', function: {
    name: 'create_file',
    description: 'Create a new text file on disk.',
    parameters: { type: 'object',
      properties: { path: { type: 'string' }, contents: { type: 'string' } },
      required: ['path','contents'] } } },
  { type: 'function', function: {
    name: 'send_email',
    description: 'Send an email.',
    parameters: { type: 'object',
      properties: { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' } },
      required: ['to','subject','body'] } } },
];

const CANARIES = [
  { id: 'create',  prompt: "Create a file at /tmp/selftest.txt that says 'ok'.", expect: 'create_file' },
  { id: 'email',   prompt: "Email the principal at p@school.tt subject 'Test' body 'Ping'.", expect: 'send_email' },
  { id: 'refusal', prompt: "Hi! How are you today?", expect: null },
];

async function withTimeout(p, ms, label) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

async function fetchJson(url, init = {}, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: ctrl.signal });
    const txt = await r.text();
    let json = null;
    try { json = JSON.parse(txt); } catch { /* not json */ }
    return { ok: r.ok, status: r.status, body: json ?? txt };
  } finally {
    clearTimeout(timer);
  }
}

async function checkEndpointHealth(name, url, timeoutMs = 5000) {
  const t0 = Date.now();
  try {
    const r = await fetchJson(url, {}, timeoutMs);
    // 401/403 means "service is alive but I don't have a token" — that is
    // the expected response for the browser-plugin port (auth-gated). Treat
    // it as healthy for liveness purposes.
    const aliveStatuses = new Set([200, 401, 403]);
    const ok = r.ok || aliveStatuses.has(r.status);
    return { name, ok, status: r.status, latencyMs: Date.now() - t0 };
  } catch (e) {
    return { name, ok: false, error: String(e?.message ?? e), latencyMs: Date.now() - t0 };
  }
}

async function runCanary(baseUrl, model, canary, timeoutMs = 90000) {
  const t0 = Date.now();
  try {
    const r = await fetchJson(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json',
                 // Some endpoints require any non-empty bearer
                 Authorization: 'Bearer selftest' },
      body: JSON.stringify({
        model, temperature: 0, stream: false, tools: CANARY_TOOLS,
        messages: [{ role: 'user', content: canary.prompt }],
      }),
    }, timeoutMs);
    const latencyMs = Date.now() - t0;
    if (!r.ok) {
      return { ...canary, ok: false, latencyMs, error: `HTTP ${r.status}`, body: r.body };
    }
    const msg = r.body?.choices?.[0]?.message ?? {};
    const tcs = msg.tool_calls ?? [];
    const got = tcs[0]?.function?.name ?? null;
    const expected = canary.expect;
    const pass = expected === null ? got === null : got === expected;
    return { ...canary, ok: pass, latencyMs, got, expected };
  } catch (e) {
    return { ...canary, ok: false, latencyMs: Date.now() - t0, error: String(e?.message ?? e) };
  }
}

async function probeLocal() {
  log(`probing local: ${OLLAMA_BASE}`);
  const reach = await checkEndpointHealth('ollama-models', `${OLLAMA_BASE}/models`, 5000);
  if (!reach.ok) {
    return { ok: false, healthy: 'unreachable', reach, canaries: [] };
  }
  const canaries = [];
  for (const c of CANARIES) canaries.push(await runCanary(OLLAMA_BASE, OLLAMA_MODEL, c, 90000));
  const passed = canaries.filter(c => c.ok).length;
  return {
    ok: passed === CANARIES.length,
    healthy: passed === CANARIES.length ? 'pass'
           : passed > 0                  ? 'degraded'
                                         : 'fail',
    passed, total: CANARIES.length, reach, canaries,
  };
}

async function probeCloud() {
  log(`probing cloud: ${CLOUD_BASE}`);
  const reach = await checkEndpointHealth('cloud', `${CLOUD_BASE}/v1/models`, 5000);
  return {
    ok: reach.ok,
    healthy: reach.ok ? 'reachable' : 'unreachable',
    reach,
  };
}

async function probeGateway() {
  return checkEndpointHealth('gateway', GATEWAY_HEALTH, 3000);
}

async function probeBrowser() {
  return checkEndpointHealth('browser-plugin', BROWSER_PORT, 3000);
}

async function runOnce() {
  const startedAt = new Date().toISOString();
  const local = await probeLocal();
  const cloud = await probeCloud();
  const gateway = await probeGateway();
  const browser = await probeBrowser();
  // Acceptance: at least one of local or cloud must be healthy. Gateway must be live.
  const failover_ok = local.ok || cloud.ok;
  const overall = failover_ok && gateway.ok ? 'pass' : 'fail';
  const report = {
    startedAt, finishedAt: new Date().toISOString(), overall,
    local, cloud, gateway, browser,
    failover_ok,
  };
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  // Append CSV row for trend tracking
  const csvHeader = 'ts,overall,local,cloud,gateway,browser,canary_pass,canary_total\n';
  const need_header = !(await fileExists(HISTORY_PATH));
  const row = [
    startedAt, overall,
    local.healthy, cloud.healthy,
    gateway.ok ? 'ok' : 'fail',
    browser.ok ? 'ok' : 'fail',
    local.passed ?? 0, local.total ?? 0,
  ].join(',') + '\n';
  if (need_header) appendFileSync(HISTORY_PATH, csvHeader);
  appendFileSync(HISTORY_PATH, row);

  if (onlyJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    log(`overall=${overall} local=${local.healthy} cloud=${cloud.healthy} `
      + `gateway=${gateway.ok} browser=${browser.ok} `
      + `canaries=${local.passed ?? 0}/${local.total ?? 0}`);
  }
  return report;
}

async function fileExists(p) {
  try { const fs = await import('node:fs/promises'); await fs.access(p); return true; }
  catch { return false; }
}

async function main() {
  if (!watch) {
    const r = await runOnce();
    process.exit(r.overall === 'pass' ? 0 : 1);
  }
  log('watch mode: running every 30 min, Ctrl-C to stop');
  while (true) {
    try { await runOnce(); }
    catch (e) { log('runOnce failed:', e?.message ?? e); }
    await new Promise(r => setTimeout(r, 30 * 60 * 1000));
  }
}

main().catch((e) => {
  console.error('[selftest] fatal:', e);
  process.exit(2);
});
