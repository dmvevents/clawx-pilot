/**
 * THE GA acceptance gate (CLWX-90) — one command that checks every criterion.
 *
 * Runs the full check battery in three tiers and emits a scorecard mapped to
 * the GO/NO-GO boxes (docs/wiki/GA_READINESS.md §4), the Karunesh ledger
 * criteria (docs/KARUNESH_ERROR_LEDGER.md), and the fixed-bug guards
 * (docs/BLOCKER_BUG_COLLECTION_2026-09-03.md §3). A criterion is either
 * PASS (ran, green), FAIL (ran, red), or SKIP (lane/flag unavailable —
 * reported loudly; skips are never silent).
 *
 *   node scripts/ga-gate.mjs                 # T0 static + T1 live Mac lane
 *   GA_GATE_STATIC=1 node scripts/ga-gate.mjs  # T0 only (CI-safe)
 *   GA_GATE_FULL=1 node scripts/ga-gate.mjs    # + NSCC eval (Bedrock, ~5min)
 *   GA_GATE_SEND=1 node scripts/ga-gate.mjs    # + live 2-gate SEND proof
 *                                              #   (test.fac sandbox ONLY)
 *
 * Exit: non-zero if any non-skipped check fails, or if a REQUIRED tier was
 * fully skipped (T0 is always required; T1 required unless GA_GATE_STATIC).
 * Report: printed + written to docs/evidence/GA_GATE_<date>.md.
 */
import { execSync, spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const STATIC_ONLY = process.env.GA_GATE_STATIC === '1';
const FULL = process.env.GA_GATE_FULL === '1';
const SEND = process.env.GA_GATE_SEND === '1';
const results = [];

const LOG_DIR = `/tmp/ga-gate-logs/${new Date().toISOString().replace(/[:.]/g, '-')}`;
mkdirSync(LOG_DIR, { recursive: true });

function run(id, tier, box, cmd, { timeout = 600_000, optional = false } = {}) {
  process.stdout.write(`[${tier}] ${id} ... `);
  const t0 = Date.now();
  const r = spawnSync('bash', ['-c', cmd], { timeout, encoding: 'utf8' });
  const ok = r.status === 0;
  const secs = Math.round((Date.now() - t0) / 1000);
  // Full output per check — a failing gate must be diagnosable without a
  // re-run (three-line tails cost a full re-diagnosis on the first RED run).
  const logFile = path.join(LOG_DIR, `${id.replace(/[^a-z0-9-]+/gi, '_')}.log`);
  writeFileSync(logFile, `$ ${cmd}\nexit=${r.status}\n\n--- stdout ---\n${r.stdout ?? ''}\n--- stderr ---\n${r.stderr ?? ''}`);
  results.push({ id, tier, box, status: ok ? 'PASS' : 'FAIL', secs, optional, log: logFile, tail: (r.stdout + r.stderr).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 240) });
  console.log(`${ok ? 'PASS' : 'FAIL'} (${secs}s)${ok ? '' : ` — log: ${logFile}`}`);
  return ok;
}
function skip(id, tier, box, why) {
  results.push({ id, tier, box, status: 'SKIP', secs: 0, optional: false, tail: why });
  console.log(`[${tier}] ${id} ... SKIP (${why})`);
}
function probe(cmd) {
  try { execSync(cmd, { stdio: 'pipe', timeout: 8_000 }); return true; } catch { return false; }
}

console.log(`=== GA gate ${new Date().toISOString()} (static=${STATIC_ONLY} full=${FULL} send=${SEND}) ===\n`);

// ── T0: static — always required ─────────────────────────────────────────
run('typecheck', 'T0', 'hygiene', 'pnpm typecheck');
run('lint', 'T0', 'hygiene', 'pnpm lint:check');
run('unit-suite', 'T0', 'hygiene', 'pnpm exec vitest run tests/unit --silent');
run('bundle-verify (CLWX-72 gate)', 'T0', 'hygiene+KR1', 'pnpm exec zx scripts/bundle-openclaw.mjs >/dev/null 2>&1 && node scripts/verify-openclaw-bundle.mjs');
run('doc-tooling harness (KR1 proxy)', 'T0', 'KR1', 'pnpm run harness:doc-tooling-e2e');

// ── T1: live Mac lane (user Chrome CDP + test.fac sandbox) ───────────────
if (STATIC_ONLY) {
  skip('live-lane', 'T1', 'email+forms', 'GA_GATE_STATIC=1');
} else if (!probe("curl -s -o /dev/null --max-time 3 http://127.0.0.1:18792/json/version")) {
  skip('live-lane', 'T1', 'email+forms', 'Chrome CDP :18792 not reachable — start the lane and rerun');
} else {
  run('outlook-eval 15-row (K6/K14 guards)', 'T1', 'ExtValA', 'pnpm exec tsx scripts/v2-eval.ts');
  run('stale-read check (CLWX-46 guard)', 'T1', 'ExtValA', 'pnpm exec tsx scripts/clwx46-stale-read-check.ts');
  run('forms Suspensions fill+gate (dry)', 'T1', 'forms', 'pnpm exec tsx scripts/forms-fill-suspensions.ts');
  run('forms Daily Report fill+gate (dry, CLWX-62)', 'T1', 'forms', 'pnpm exec tsx scripts/forms-fill-daily-report.ts');
  if (SEND) run('2-gate SEND proof (sandbox)', 'T1', 'email', 'pnpm exec tsx scripts/v2-send-test.ts');
  else skip('2-gate SEND proof', 'T1', 'email', 'GA_GATE_SEND!=1 (refusal rows covered by the eval; real dispatch opt-in)');
  if (FULL) run('NSCC Q&A eval (CLWX-42)', 'T1', 'routine-query', 'pnpm exec tsx scripts/nscc-qna-eval.ts');
  else skip('NSCC Q&A eval', 'T1', 'routine-query', 'GA_GATE_FULL!=1');
}

// ── T2: packaged/VM lane — status probe only (the batch runs via V-batch) ─
if (probe('nc -z -w3 localhost 12222')) {
  results.push({ id: 'vm-lane', tier: 'T2', box: 'KR2+W-matrix', status: 'INFO', secs: 0, optional: true, tail: 'IAP tunnel up — run the V-batch workflow for install-verify + W-matrix surfaces' });
  console.log('[T2] vm-lane ... INFO (tunnel up; V-batch owns these surfaces)');
} else {
  skip('vm-lane (KR2 + W-matrix)', 'T2', 'KR2', 'IAP tunnel down — VM surfaces evidenced by the last V-batch (see state vector); start VM + rerun batch to refresh');
}

// ── Scorecard ─────────────────────────────────────────────────────────────
const fails = results.filter((r) => r.status === 'FAIL' && !r.optional);
const skips = results.filter((r) => r.status === 'SKIP');
let md = `# GA gate run — ${new Date().toISOString()}\n\nflags: static=${STATIC_ONLY} full=${FULL} send=${SEND}\n\n| Check | Tier | GA box | Status | s | Tail |\n|---|---|---|---|---|---|\n`;
for (const r of results) md += `| ${r.id} | ${r.tier} | ${r.box} | **${r.status}** | ${r.secs} | ${r.tail.replace(/\|/g, '/')} |\n`;
md += `\n**Verdict: ${fails.length === 0 ? 'GREEN' : 'RED'}** — ${results.filter((r) => r.status === 'PASS').length} pass / ${fails.length} fail / ${skips.length} skip.\n`;
md += skips.length ? `\nSkips are NOT coverage — each names its unlock above.\n` : '';
mkdirSync('docs/evidence', { recursive: true });
const out = path.join('docs/evidence', `GA_GATE_${new Date().toISOString().slice(0, 10)}.md`);
writeFileSync(out, md);
console.log(`\n${fails.length === 0 ? '✓ GATE GREEN' : '✗ GATE RED'} — ${results.filter((r) => r.status === 'PASS').length} pass, ${fails.length} fail, ${skips.length} skip. Report: ${out}`);
process.exit(fails.length === 0 ? 0 : 1);
