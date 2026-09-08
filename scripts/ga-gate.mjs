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
 *   node scripts/ga-gate.mjs                 # development health: T0 + T1 live Mac lane when available; NOT release acceptance
 *   GA_GATE_STATIC=1 node scripts/ga-gate.mjs  # development health: T0 only (CI-safe); NOT release acceptance
 *   GA_GATE_E2E=1 node scripts/ga-gate.mjs     # + renderer e2e (Playwright
 *                                              #   + Electron boots, ~min)
 *   GA_GATE_FULL=1 node scripts/ga-gate.mjs    # + NSCC eval (Bedrock, ~5min)
 *   GA_GATE_SEND=1 node scripts/ga-gate.mjs    # + live 2-gate SEND proof
 *                                              #   (test.fac sandbox ONLY)
 *   GA_GATE_RELEASE=1 node scripts/ga-gate.mjs # strict release evidence judgement;
 *                                              #   fails closed on missing/SKIP/INFO criteria
 *   node scripts/ga-gate.mjs --release         # same strict release judgement
 *
 * Development-health exit: non-zero if any non-skipped check fails, or if a
 * normal non-static run BLOCKS a required T1 lane. Flag-driven skips still do
 * not affect the exit code: GA_GATE_STATIC=1 and opt-in rows left unset are
 * intentional narrower development checks, not missing requested evidence.
 * Strict release exit: non-zero if any release-required criterion is absent or
 * any release-required row is not PASS, including SKIP/BLOCKED/NOT_RUN/INFO.
 * GA_GATE_INSTALLED_EVIDENCE supplies one measured Windows evidence directory.
 * GA_GATE_MANIFEST and GA_GATE_ARTIFACT_DIR select the manifest and staged bits.
 * Without installed evidence, T2 is only a diagnostic probe and cannot pass.
 * Portable machine evidence is written under artifacts/release-evidence/.
 * Report: printed + written to docs/evidence/GA_GATE_<date>.md.
 */
import { execSync, spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
// The judgement lives in a sibling module with no I/O and no side effects on import,
// because THIS file cannot be imported by a test: it spawns pnpm and calls
// process.exit at module scope. Splitting it is not cosmetic — until 2026-09-07
// `grep -rl ga-gate tests/` returned nothing, and a gate with no gate of its own is
// how the fail-open below shipped and survived two review lenses. The gate imports
// the same module the test pins; a copied classifier would verify a surface that is
// not the shipped surface.
import { classifyRow, scorecard } from './ga-gate-verdict.mjs';
import { readCurrentSource } from './release-build-source.mjs';
import { evaluateInstalledEvidence } from './installed-release-evidence.mjs';
import { candidateProblems, loadReleaseBuildProfile, validateReleaseEvidence, writeReleaseEvidence } from './release-evidence.mjs';

const STATIC_ONLY = process.env.GA_GATE_STATIC === '1';
const FULL = process.env.GA_GATE_FULL === '1';
const SEND = process.env.GA_GATE_SEND === '1';
const RELEASE = process.env.GA_GATE_RELEASE === '1' || process.argv.includes('--release');
const results = [];
const startedAt = new Date().toISOString();
const initialSource = readCurrentSource(process.cwd());
let manifest = null;
try {
  const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
  manifest = JSON.parse(readFileSync(process.env.GA_GATE_MANIFEST || `docs/release-manifests/${version}.json`, 'utf8'));
} catch { /* Missing or malformed candidate is an explicit release blocker below. */ }
const installedDir = process.env.GA_GATE_INSTALLED_EVIDENCE;
let buildProfile = null;
try {
  buildProfile = loadReleaseBuildProfile({ profilePath: process.env.GA_GATE_BUILD_PROFILE, manifest, source: initialSource });
} catch (error) {
  console.error(`[ga-gate] ${error.message}`);
  process.exit(3);
}

const T1_REQUIRED_CRITERIA = [
  't1-outlook-eval',
  't1-stale-read',
  't1-compose-recovery',
  't1-forms-suspensions',
  't1-forms-daily-report',
  't1-send-proof',
  't1-nscc-qna',
];

const LOG_DIR = path.resolve(process.env.GA_GATE_OUTPUT_DIR || 'artifacts/release-evidence', startedAt.replace(/[:.]/g, '-'));
mkdirSync(LOG_DIR, { recursive: true });

// `laneContract` is how a lane condition gets classified from EVIDENCE instead of
// from a precondition probe. The previous design refused to run the email rows
// unless a probe found an Outlook tab first — but the driver opens its own tab and
// the session cookies live in the profile, so "no tab open" is a perfectly healthy
// lane (proven 2026-09-07: with zero Outlook tabs, ensureOutlookTab opened one and
// landed signed in as test.fac in seconds). Refusing to run turned a healthy lane
// into three BLOCKED rows — the same dishonesty as the FAIL it was fixing, just
// pointed the other way. So: run the row, and let the row itself say which kind of
// failure it hit.
//
// It says so with its EXIT CODE, never with a substring of its output. The first
// version of this classifier regex-matched /needs_signin/ over the whole combined
// stdout+stderr, which is a fail-OPEN and strictly worse than the FAIL it replaced
// (Claude correctness lens, 2026-09-07): clwx46-stale-read-check.ts prints
// `[SAFE-REFUSE: ... status=needs_signin]` on its HEALTHY path at :91 and then
// exits 1 at :118 on a real stale-read leak, so one healthy refusal in the same run
// as the actual CLWX-46 defect relabelled the defect "not a product failure" and
// exited 0. It also mis-classified the inverse: clwx58's real lane abort
// ("LANE NOT READY: could not open the seed owned draft") matched no regex and was
// recorded as a product FAIL.
//
// All four lane scripts already implement the same contract, so there is nothing to
// infer: 0 = pass, 1 = product failure, 2 = lane not ready. (clwx46 :58/:72/:118/
// :122/:126/:131, clwx58 :74/:86/:124/:127/:132, v2-eval via `laneVerdict()` in
// scripts/eval-verdict.ts — it was inlined at :549/:555 until 2026-09-07, when it
// turned out to be deciding "lane not ready" by regex-matching its own notes, the
// same fail-open as below — v2-send-test :32-63/:69.) Fail-closed: only exit 2
// blocks; every other non-zero stays a FAIL.
function run(id, tier, box, cmd, { timeout = 600_000, optional = false, laneContract = false, blockedWhy, criteria = [] } = {}) {
  process.stdout.write(`[${tier}] ${id} ... `);
  const t0 = Date.now();
  const r = spawnSync('bash', ['-c', cmd], { timeout, encoding: 'utf8' });
  // ONE decision point, and it is the exported one — if `ok` were computed here
  // independently, the test could pin `classifyRow` while production used something
  // else, which is the "verified surface that is not the shipped surface" trap.
  const verdict = classifyRow({ exitCode: r.status, laneContract });
  const ok = verdict === 'PASS';
  const completedAt = new Date().toISOString();
  const execution = { exitCode: r.status, startedAt: new Date(t0).toISOString(), completedAt };
  const secs = Math.round((Date.now() - t0) / 1000);
  // Full output per check — a failing gate must be diagnosable without a
  // re-run (three-line tails cost a full re-diagnosis on the first RED run).
  const logFile = path.join(LOG_DIR, `${id.replace(/[^a-z0-9-]+/gi, '_')}.log`);
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  writeFileSync(logFile, `$ ${cmd}\nexit=${r.status}\n\n--- stdout ---\n${r.stdout ?? ''}\n--- stderr ---\n${r.stderr ?? ''}`);
  if (verdict === 'BLOCKED') {
    results.push({ id, tier, box, status: 'SKIP', secs, optional: false, blocked: true, log: logFile, criteria, ...execution, tail: `${blockedWhy} — log: ${logFile}` });
    console.log(`SKIP (${secs}s) — BLOCKED by the lane, not a product failure (exit 2): ${blockedWhy}`);
    return false;
  }
  results.push({ id, tier, box, status: ok ? 'PASS' : 'FAIL', secs, optional, log: logFile, criteria, ...execution, tail: out.split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 240) });
  console.log(`${ok ? 'PASS' : 'FAIL'} (${secs}s)${ok ? '' : ` — log: ${logFile}`}`);
  return ok;
}
// `blocked` separates the two kinds of skip, which a reader must not conflate:
//   flag-driven  — the operator chose a narrower run (GA_GATE_STATIC, !E2E, !FULL,
//                  !SEND). Expected, and the flags are printed in the header.
//   blocked      — the current flags say this row SHOULD have run and the
//                  environment stopped it. That is the only skip a GREEN verdict
//                  can quietly hide, so only these qualify the verdict below.
function skip(id, tier, box, why, { blocked = false, criteria = [] } = {}) {
  results.push({ id, tier, box, status: 'SKIP', secs: 0, optional: false, blocked, criteria, tail: why });
  console.log(`[${tier}] ${id} ... SKIP (${why})`);
}
function probe(cmd) {
  try { execSync(cmd, { stdio: 'pipe', timeout: 8_000 }); return true; } catch { return false; }
}
/** Row count of the live Outlook eval, read from the suite instead of authored. */
function evalRowCount() {
  try {
    const n = (readFileSync('scripts/v2-eval.ts', 'utf8').match(/await runRow\(/g) ?? []).length;
    return n > 0 ? `${n}-row` : '(row count unknown)';
  } catch { return '(row count unknown)'; }
}

console.log(`=== GA gate ${new Date().toISOString()} (mode=${RELEASE ? 'strict-release-evidence; not GA approval' : 'development-health; not release acceptance'} static=${STATIC_ONLY} e2e=${process.env.GA_GATE_E2E === '1'} full=${FULL} send=${SEND}) ===\n`);

if (RELEASE) {
  const problems = candidateProblems(manifest, initialSource);
  results.push({ id: 'release-artifact-provenance', tier: 'release', box: 'artifact identity', status: problems.length ? 'FAIL' : 'PASS', secs: 0, criteria: ['release-artifact-provenance'], tail: problems.join(' ').slice(0, 1000) || 'Candidate artifacts belong to this clean source revision.' });
}

// ── T0: static — always required ─────────────────────────────────────────
run('typecheck', 'T0', 'hygiene', 'pnpm typecheck', { criteria: ['t0-typecheck'] });
run('lint', 'T0', 'hygiene', 'pnpm lint:check', { criteria: ['t0-lint'] });
// CLWX-83 gates were exposed as standalone scripts but absent from every
// release path — a fail-open-by-omission (Codex adversarial review,
// 2026-09-06). lint:ps exits 2 when pwsh/PSScriptAnalyzer are missing,
// which FAILS the row: on the acceptance machine a missing analyzer is a
// lane defect, not a skip (setup: windows-pilot/README.md).
run('pwsh lint (CLWX-83)', 'T0', 'hygiene', 'pnpm lint:ps', { criteria: ['t0-pwsh-lint'] });
run('agent model pins (CLWX-83)', 'T0', 'hygiene', 'pnpm doctor:agents', { criteria: ['t0-agent-model-pins'] });
run('unit-suite', 'T0', 'hygiene', 'pnpm exec vitest run tests/unit --silent', { criteria: ['t0-unit-suite'] });
// CLWX-115: the RAJ-2 misinterpretation class (meal preferences read back as
// shirt sizes) previously lived ONLY in scripts/raj2-reply-fidelity-check.ts —
// a standalone live n=1 probe whose word/entity MEMBERSHIP assertions cannot
// see a swapped association ("Keisha gets chicken, Marcus gets vegetarian"
// against the opposite source is 100% sourced words) or a dropped negation
// ("Anil is attending" is a strict subset of "Anil is NOT attending"). This
// row runs the deterministic association/negation checker over its synthetic
// fixture INCLUDING mutation controls: the swap, attribute-swap and
// negation-drop outputs must FAIL or the runner exits 1 — a weakened checker
// reds the gate rather than going quietly vacuous. Fail-closed: a missing or
// hollow fixture also exits 1, and there is deliberately no laneContract, so
// every non-zero is a product FAIL, never BLOCKED. Evidence class: source
// fixture only — this row cannot stand in for installed-agent fidelity and
// does not close CLWX-115 by itself.
run('raj2 association-fidelity fixture (CLWX-115)', 'T0', 'ExtValA-fixture', 'node scripts/raj2-association-fidelity-gate.mjs', { criteria: ['t0-raj2-association-fixture'] });
run('bundle-verify (CLWX-72 gate)', 'T0', 'hygiene+KR1', 'pnpm exec zx scripts/bundle-openclaw.mjs >/dev/null 2>&1 && node scripts/verify-openclaw-bundle.mjs', { criteria: ['t0-bundle-verify'] });
run('doc-tooling harness (KR1 proxy)', 'T0', 'KR1', 'pnpm run harness:doc-tooling-e2e', { criteria: ['t0-doc-tooling-harness'] });
// Renderer e2e (Playwright + Electron). Opt-in: each spec boots a real
// Electron app, so this row costs minutes — but it is the ONLY tier that
// exercises renderer boot under mocked IPC (the CLWX-91 blank-window class
// was invisible to the gate precisely because this row did not exist).
if (process.env.GA_GATE_E2E === '1') {
  run('renderer-e2e (Playwright, CLWX-91)', 'T0', 'hygiene', 'pnpm test:e2e', { timeout: 1_800_000, criteria: ['renderer-e2e'] });
} else {
  skip('renderer-e2e (Playwright)', 'T0', 'hygiene', 'GA_GATE_E2E!=1 (opt-in; ~6min. Baseline 2026-09-06: 32 green / 13 red — the reds are fork-decision drift (deleted locales, anonymised provider labels), dispositioned under CLWX-102)', { criteria: ['renderer-e2e'] });
}

// ── T1: live Mac lane (user Chrome CDP + test.fac sandbox) ───────────────
//
// The preflight used to be a single CDP reachability probe for the whole tier,
// which is the same under-specification the T2 row had: a reachable CDP port
// proves Chrome is listening, NOT that the email lane is usable. With CDP up but
// the Chrome session signed OUT, every email row dies at the sign-in wall and the
// scorecard attributes that to the PRODUCT. An environment gate the owner clears
// must read as BLOCKED, never as a product FAIL (the rule vm-verify-moe19.sh
// :100-116 already states).
//
// The FIRST attempt at that split required an Outlook tab to already be open
// before the email rows were allowed to run, which was wrong in the other
// direction and equally dishonest: the driver opens its own tab and Chrome holds
// the session cookies in the profile, so "no tab open" is a healthy lane. Proven
// 2026-09-07 — with zero Outlook tabs in the context, ensureOutlookTab opened one
// and landed signed in as test.fac in seconds. Gating on the tab turned that
// healthy lane into three BLOCKED rows, hiding real coverage.
//
// So the email rows RUN whenever CDP is up, and BLOCKED is decided from their own
// output: the product has a first-class `needs_signin` status for exactly this
// state (outlook-actions.ts:302+), and that string — not a guess about the
// environment — is the classifier. Anything else that fails stays a FAIL.
const CDP_UP = !STATIC_ONLY && probe('curl -s -o /dev/null --max-time 3 http://127.0.0.1:18792/json/version');
// Diagnostic only, and printed rather than swallowed: the tab probe no longer
// decides whether rows run, so a wrong answer here can no longer hide coverage.
// Matched on its POSITIVE token, never on exit 0 alone: a script that no-ops
// exits 0, and the probe's own main-module guard was one whose correctness
// depended on the shape of the path it ran from (it no-ops on Windows and on any
// percent-encoded path — see the guard comment there). Absence of evidence must
// not read as evidence.
const OUTLOOK_TAB = CDP_UP && probe('node scripts/probe-outlook-tab.mjs | grep -q "^outlook-tab: present"');
if (STATIC_ONLY) {
  skip('live-lane', 'T1', 'email+forms', 'GA_GATE_STATIC=1', { criteria: T1_REQUIRED_CRITERIA });
} else if (!CDP_UP) {
  skip('live-lane', 'T1', 'email+forms', 'Chrome CDP :18792 not reachable — start the lane and rerun', { blocked: true, criteria: T1_REQUIRED_CRITERIA });
} else {
  // Lane hygiene between live checks: any timed-out row can leave a compose
  // open and cascade into the NEXT check (seen live 2026-09-03). Cheap and
  // idempotent, so run it before each lane consumer that drafts.
  const CLEAN = 'pnpm exec tsx scripts/outlook-cleanup-compose.ts >/dev/null 2>&1;';
  console.log(`[T1] preflight: CDP up, Outlook tab already open = ${OUTLOOK_TAB} (diagnostic only — the driver opens its own tab)`);
  const SIGNIN_WHY = 'lane BLOCKED, not a product failure — the row exited 2 (its own "lane not ready" code), which on this lane means the Chrome session could not present a usable mailbox (Microsoft sign-in wall, or too few rows to assert against), so nothing about email integration was tested. CAE revokes cookies within minutes on this tenant, so this is routine. Unlock: in the SAME Chrome (profile=user), sign in as the test.fac sandbox account, then rerun. See the row log for which of the two it was';
  const EMAIL_ROW = { laneContract: true, blockedWhy: SIGNIN_WHY };
  // The label used to read "outlook-eval 15-row" while the suite ran 18 rows
  // (CLWX-119c). A count authored into a label once and never re-checked is a
  // coverage claim that decays silently — the same class as a hardcoded matrix
  // total. Derive it from the suite, and if the derivation finds nothing say so
  // rather than inventing a number; the eval also prints its MEASURED
  // pass/fail/skip as its last line, which is what lands in this row's tail.
  run(`outlook-eval ${evalRowCount()} (K6/K14 guards)`, 'T1', 'ExtValA', `${CLEAN} pnpm exec tsx scripts/v2-eval.ts`, { ...EMAIL_ROW, criteria: ['t1-outlook-eval'] });
  run('stale-read check (CLWX-46 guard)', 'T1', 'ExtValA', 'pnpm exec tsx scripts/clwx46-stale-read-check.ts', { ...EMAIL_ROW, criteria: ['t1-stale-read'] });
  run('compose auto-recovery (CLWX-58 guard)', 'T1', 'ExtValA', `${CLEAN} pnpm exec tsx scripts/clwx58-compose-recovery-check.ts`, { ...EMAIL_ROW, criteria: ['t1-compose-recovery'] });
  run('forms Suspensions fill+gate (dry)', 'T1', 'forms', 'pnpm exec tsx scripts/forms-fill-suspensions.ts', { criteria: ['t1-forms-suspensions'] });
  run('forms Daily Report fill+gate (dry, CLWX-62)', 'T1', 'forms', 'pnpm exec tsx scripts/forms-fill-daily-report.ts', { criteria: ['t1-forms-daily-report'] });
  // The SEND row keeps a stricter rule than the read rows: a real dispatch is
  // never attempted speculatively. It runs only when the operator asked for it
  // AND a signed-in tab is already visible, and reclassifies the same way.
  // "no Outlook tab is open" is exactly what the probe can support and no more:
  // it reads CDP targets by hostname and knows nothing about auth state, so a tab
  // left on outlook.office.com after CAE revocation satisfies it (Claude
  // correctness lens, 2026-09-07 — the message used to claim "signed-in").
  if (SEND && !OUTLOOK_TAB) skip('2-gate SEND proof', 'T1', 'email', `GA_GATE_SEND=1 but no Outlook tab is open, and a live dispatch is not attempted speculatively. Unlock: open outlook.cloud.microsoft as the test.fac sandbox account in the SAME Chrome, then rerun`, { blocked: true, criteria: ['t1-send-proof'] });
  else if (SEND) run('2-gate SEND proof (sandbox)', 'T1', 'email', `${CLEAN} pnpm exec tsx scripts/v2-send-test.ts`, { ...EMAIL_ROW, criteria: ['t1-send-proof'] });
  else skip('2-gate SEND proof', 'T1', 'email', 'GA_GATE_SEND!=1 (refusal rows covered by the eval; real dispatch opt-in)', { criteria: ['t1-send-proof'] });
  if (FULL) run('NSCC Q&A eval (CLWX-42)', 'T1', 'routine-query', 'pnpm exec tsx scripts/nscc-qna-eval.ts', { criteria: ['t1-nscc-qna'] });
  else skip('NSCC Q&A eval', 'T1', 'routine-query', 'GA_GATE_FULL!=1', { criteria: ['t1-nscc-qna'] });
}

// ── T2: packaged/VM lane — status probe only (the batch runs via V-batch) ─
//
// `nc -z` proves ONLY that a local listener is bound. An IAP tunnel whose
// credentials have died keeps that listener up and resets every connection
// ("kex_exchange_identification: read: Connection reset by peer"), so nc
// false-POSITIVES — the inverse of the known Windows-Firewall false negative.
// This gate reported "IAP tunnel up — run the V-batch workflow" against a
// tunnel that could not authenticate (2026-09-06: nc said open, ssh reset at
// key exchange, `gcloud compute instances list` demanded reauth). A reader
// takes that row as "the VM lane is available" and it is not. The lane script
// already got this right (vm-verify-moe19.sh:100-116, control leg) and the
// state vector records three separate stale-:12222 incidents; the gate was the
// one place still trusting the socket. Same false-green class as the vacuous
// bundled-package check (VERIFY-VACUOUS-PACKAGES, fixed @ 30f97164).
//
// Three states, kept distinguishable — "bound but dead" must never read as up.
if (installedDir && !STATIC_ONLY) {
  try {
    const installed = await evaluateInstalledEvidence({ manifest, evidenceDir: installedDir, buildProfile });
    results.push({ id: 'installed Windows app evidence', tier: 'T2', box: 'KR2+W-matrix', status: installed.ok ? 'PASS' : 'FAIL', secs: 0, criteria: ['t2-installed-windows-app'], tail: installed.checks.filter((check) => check.status !== 'PASS').map((check) => `${check.id}=${check.status}`).join('; ') || 'Measured installed Windows evidence matches the candidate.' });
  } catch {
    results.push({ id: 'installed Windows app evidence', tier: 'T2', box: 'KR2+W-matrix', status: 'FAIL', secs: 0, criteria: ['t2-installed-windows-app'], tail: 'Installed producer evidence is invalid or unreadable.' });
  }
} else {
  const VM_PORT = process.env.CLAWX_SSH_PORT || '12222';
  const VM_USER = process.env.CLAWX_VM_USER || 'clawxtest';
  const vmBound = probe(`nc -z -w3 localhost ${VM_PORT}`);
  // Negative control: if a port nothing listens on also answers, the probe
  // method itself is untrustworthy and no verdict from it may be believed (PF-3).
  const vmProbeSane = !probe('nc -z -w2 localhost 9999');
  // These three are all environment blocks, so they carry blocked:true — honest
  // metadata a reader (and the markdown footer) can distinguish from a flag choice.
  // They do NOT enter the required-tier PARTIAL qualifier: T2 is optional by design
  // (the V-batch owns these surfaces) and the tunnel is down in the normal case, so
  // qualifying every default run would be warning fatigue, not signal.
  if (!vmProbeSane) {
    skip('vm-lane (KR2 + W-matrix)', 'T2', 'KR2', `probe method UNTRUSTWORTHY — control-leg port 9999 answered, so the :${VM_PORT} result proves nothing; investigate before believing any tunnel state`, { blocked: true, criteria: ['t2-installed-windows-app'] });
  } else if (!vmBound) {
    skip('vm-lane (KR2 + W-matrix)', 'T2', 'KR2', 'IAP tunnel down (no local listener) — VM surfaces evidenced by the last V-batch (see state vector); start VM + rerun batch to refresh', { blocked: true, criteria: ['t2-installed-windows-app'] });
  } else if (probe(`ssh -o BatchMode=yes -o ConnectTimeout=8 -o StrictHostKeyChecking=no -p ${VM_PORT} ${VM_USER}@localhost 'echo GUEST_SSH_OK' 2>/dev/null | grep -q GUEST_SSH_OK`)) {
    results.push({ id: 'vm-lane', tier: 'T2', box: 'KR2+W-matrix', status: 'INFO', secs: 0, optional: true, criteria: ['t2-installed-windows-app'], tail: `IAP tunnel up AND guest ssh handshake verified on :${VM_PORT} — run the V-batch workflow for install-verify + W-matrix surfaces; this probe is not installed-app release proof` });
    console.log('[T2] vm-lane ... INFO (tunnel up, handshake verified; V-batch owns these surfaces)');
  } else {
    skip('vm-lane (KR2 + W-matrix)', 'T2', 'KR2', `IAP tunnel NOT USABLE — :${VM_PORT} is bound but the guest ssh handshake failed, which is a live tunnel with dead credentials. This lane is BLOCKED, not available. Owner (interactive): gcloud auth login; if auth is already good: pkill -f start-iap-tunnel, then re-run`, { blocked: true, criteria: ['t2-installed-windows-app'] });
  }

}

// ── Scorecard ─────────────────────────────────────────────────────────────
// All of the judgement lives in ./ga-gate-verdict.mjs so a test can drive it with
// synthetic rows; this block only renders what it returns.
//
// A blocked skip at a required tier is the one thing a GREEN verdict can hide.
// T0 is always required; T1 is required unless GA_GATE_STATIC. This matters more
// since T1 became row-granular: the email rows can block while the forms rows
// pass, so the tier LOOKS run. GREEN then reads as "the email lane passed" when
// it never executed. The verdict therefore carries the qualifier inline rather
// than relying on the reader to scan the table.
//
// Development health mode remains flag-skip tolerant so local runs keep their
// original signal, but a normal non-static run exits nonzero when a required T1
// lane is BLOCKED. Strict release mode is the CLWX-106 enforcement path: it uses
// explicit criterion ids on rows and fails closed when release-required proof is
// missing or non-passing. Flag-driven skips remain useful diagnostics in
// development, but they are blockers in release mode.
const finalSource = readCurrentSource(process.cwd());
if (RELEASE && (finalSource.gitCommit !== initialSource.gitCommit || finalSource.gitDirty !== false)) {
  const provenance = results.find((row) => row.id === 'release-artifact-provenance');
  provenance.status = 'FAIL';
  provenance.tail = 'Source changed during acceptance or is not clean.';
}
const completedAt = new Date().toISOString();
const evidenceInput = { outputDir: LOG_DIR, manifest, source: initialSource, rows: results, staticOnly: STATIC_ONLY, release: RELEASE, installedDir: STATIC_ONLY ? undefined : installedDir, buildProfile, startedAt, completedAt };
let reportPath;
try {
  reportPath = await writeReleaseEvidence(evidenceInput);
  if (RELEASE && scorecard(results, { release: true, staticOnly: STATIC_ONLY }).exitCode === 0) {
    const verified = await validateReleaseEvidence({ reportPath, manifest, releaseDir: process.env.GA_GATE_ARTIFACT_DIR || 'release', source: finalSource });
    if (!verified.ok) {
      const provenance = results.find((row) => row.id === 'release-artifact-provenance');
      provenance.status = 'FAIL';
      provenance.tail = verified.problems.join('; ').slice(0, 1500);
      await writeReleaseEvidence(evidenceInput);
    }
  }
} catch {
  if (RELEASE) {
    const provenance = results.find((row) => row.id === 'release-artifact-provenance');
    provenance.status = 'FAIL';
    provenance.tail = 'Failed to preserve or validate the machine evidence bundle.';
  }
  console.log('Machine evidence bundle unavailable; publication cannot use this run.');
}
const { headline, qualifier, fails, skips, blockedOptional, releaseBlockers, exitCode } = scorecard(results, { staticOnly: STATIC_ONLY, release: RELEASE });
const partial = headline.startsWith('INCOMPLETE');
// Local calendar date, computed BEFORE the title: the run is read as "today's gate"
// by a human in AST and toISOString rolls over at 20:00 local, so a UTC title put
// tomorrow's date on a report filed under today's filename (LOW-13).
const stamp = new Date();
const day = `${stamp.getFullYear()}-${String(stamp.getMonth() + 1).padStart(2, '0')}-${String(stamp.getDate()).padStart(2, '0')}`;
let md = `# GA gate run — ${day} (${stamp.toISOString()})\n\nmode: ${RELEASE ? 'strict release evidence gate (not GA approval)' : 'development health check (not release acceptance)'}\n\nflags: static=${STATIC_ONLY} e2e=${process.env.GA_GATE_E2E === '1'} full=${FULL} send=${SEND} release=${RELEASE}\n\n| Check | Tier | GA box | Status | s | Tail |\n|---|---|---|---|---|---|\n`;
for (const r of results) md += `| ${r.id} | ${r.tier} | ${r.box} | **${r.status}** | ${r.secs} | ${r.tail.replace(/\|/g, '/')} |\n`;
md += `\n**Verdict: ${headline}${qualifier}** — ${results.filter((r) => r.status === 'PASS').length} pass / ${fails.length} fail / ${skips.length} skip.\n`;
md += skips.length ? `\nSkips are NOT coverage — each names its unlock above.\n` : '';
md += blockedOptional.length ? `\nBlocked optional lanes (owned by the V-batch, not by this gate): ${blockedOptional.map((r) => r.id).join('; ')}.\n` : '';
if (RELEASE) {
  md += `\nRelease strict gate: ${exitCode === 0 ? 'PASS' : 'FAIL'} — this is evidence for release review, not GA approval.\n`;
  if (releaseBlockers.length > 0) {
    md += `\nRelease blockers:\n`;
    for (const blocker of releaseBlockers) md += `- ${blocker.criterion}: ${blocker.reason}\n`;
  }
}
if (reportPath) md += `\nMachine evidence: ${reportPath} (contains the source/artifact identity and raw producer references).\n`;
mkdirSync('docs/evidence', { recursive: true });
// Never clobber: a second run must not silently overwrite the report a board
// comment already cites. (`day` is computed with the title, above.)
let out = path.join('docs/evidence', `GA_GATE_${day}.md`);
for (let n = 2; existsSync(out); n += 1) out = path.join('docs/evidence', `GA_GATE_${day}_run${n}.md`);
writeFileSync(out, md);
if (RELEASE && releaseBlockers.length > 0) {
  console.log(`Release strict gate FAIL (not GA approval): ${releaseBlockers.map((blocker) => `${blocker.criterion}=${blocker.status}`).join(', ')}`);
}
console.log(`\n${fails.length > 0 || releaseBlockers.length > 0 ? '✗ GATE RED' : partial ? '! GATE INCOMPLETE' : '✓ GATE GREEN'}${qualifier} — ${results.filter((r) => r.status === 'PASS').length} pass, ${fails.length} fail, ${skips.length} skip. Report: ${out}`);
process.exit(exitCode);
