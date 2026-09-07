/**
 * The GA gate's DECISION logic, separated from the process that runs it.
 *
 * Why this file exists: `scripts/ga-gate.mjs` decides GA GO/NO-GO (CLWX-90) and
 * until 2026-09-07 it had zero tests — `grep -rl ga-gate tests/` returned nothing.
 * That is not incidental: it is the mechanism by which a fail-open shipped INSIDE
 * the gate and survived two review lenses. The gate's own family of defects is
 * "one surface never learned the repo's own technique"; a verification surface
 * with no verification of its own is the purest case of it.
 *
 * The gate script cannot be imported by a test (it spawns pnpm, writes reports and
 * calls process.exit at module scope), so the judgement moves here instead: pure
 * functions, no I/O, no side effects on import, and the SAME module the gate
 * imports — a test that pinned a copy would verify a surface that is not the
 * shipped surface.
 *
 * Pinned by tests/unit/ga-gate-verdict.test.ts.
 */

/**
 * Classify one check row from its EXIT CODE, never from a substring of its output.
 *
 * Contract, implemented identically by all four lane scripts:
 *   0 = pass, 1 = product failure, 2 = lane not ready.
 * (clwx46-stale-read-check.ts :58/:72/:118/:122/:126/:131,
 *  clwx58-compose-recovery-check.ts :74/:86/:124/:127/:132,
 *  v2-eval.ts :549/:555, v2-send-test.ts :32-63/:69.)
 *
 * The first version of this classifier regex-matched /needs_signin/ over the row's
 * combined stdout+stderr. That is a fail-OPEN, and strictly worse than the FAIL it
 * replaced (Claude correctness lens, 2026-09-07): clwx46-stale-read-check.ts prints
 * `[SAFE-REFUSE: ... status=needs_signin]` on its HEALTHY path at :91 and then exits
 * 1 at :118 on a real stale-read leak — so one healthy refusal occurring in the same
 * run as the actual CLWX-46 defect relabelled that defect "not a product failure"
 * and exited 0. A regex over stdout is fail-open because ANY single row can emit the
 * token; an exit code is a whole-run contract. It also mis-classified the inverse:
 * clwx58's real lane abort ("LANE NOT READY: could not open the seed owned draft")
 * matched no regex and was recorded as a product FAIL.
 *
 * Fail-closed: only a row that DECLARED the lane contract and exited exactly 2 is
 * BLOCKED. Every other non-zero stays a product FAIL.
 */
export function classifyRow({ exitCode, laneContract = false }) {
  if (exitCode === 0) return 'PASS';
  if (laneContract && exitCode === 2) return 'BLOCKED';
  return 'FAIL';
}

/**
 * Which GA surface a row speaks for. A row may speak for more than one.
 *
 * Names the SURFACE rather than the row id because "outlook-eval ... BLOCKED"
 * still reads as a detail a reader skims past, while "Email: NOT TESTED this run"
 * does not.
 */
export function surfacesOf(r) {
  if (/outlook|email|send|stale-read|compose/i.test(r.id)) return ['Email'];
  if (/forms/i.test(r.id)) return ['Forms'];
  if (/live-lane/i.test(r.id)) return ['Email', 'Forms'];   // the whole-tier skip
  return [r.box];
}

/**
 * Build the verdict from a result set.
 *
 * "NOT TESTED" is a claim about a SURFACE, so it may only be made about a surface
 * with ZERO executed rows. Keying it off "any blocked required row" under-claimed as
 * badly as the old GREEN over-claimed (Claude correctness lens, 2026-09-07): with
 * GA_GATE_SEND=1 and no tab open, three email rows PASS and only the SEND row
 * blocks, and the verdict still read "Email: NOT TESTED this run. Nothing about
 * Email was proven." A coverage hole inside a proven surface is real, but it is a
 * different statement, so it gets its own sentence instead of the headline.
 *
 * T1-only for `blockedRequired`: T0 rows are all `run()` calls, which cannot report
 * blocked, so a T0 clause here would be unreachable code pretending to be a safety
 * net. T2 is optional by design (the V-batch owns those surfaces) and its tunnel is
 * down in the normal case, so qualifying every default run on T2 would be warning
 * fatigue rather than signal — those surface separately as `blockedOptional`.
 */
export function scorecard(rows, { staticOnly = false } = {}) {
  const fails = rows.filter((r) => r.status === 'FAIL' && !r.optional);
  const skips = rows.filter((r) => r.status === 'SKIP');
  const passes = rows.filter((r) => r.status === 'PASS');
  const blockedRequired = skips.filter((r) => r.blocked && r.tier === 'T1' && !staticOnly);
  const blockedOptional = skips.filter((r) => r.blocked && r.tier !== 'T1');
  const executedSurfaces = new Set(
    rows.filter((r) => r.status === 'PASS' || r.status === 'FAIL').flatMap(surfacesOf),
  );
  const unproven = [...new Set(blockedRequired.flatMap(surfacesOf))].filter((s) => !executedSurfaces.has(s));
  const partial = fails.length === 0 && unproven.length > 0;
  const qualifier = partial
    ? ` — ${unproven.join(' + ')}: NOT TESTED this run. ${blockedRequired.length} required check(s) were BLOCKED and never executed (${blockedRequired.map((r) => r.id).join('; ')}). Nothing failed, and nothing about ${unproven.join('/')} was proven.`
    : fails.length === 0 && blockedRequired.length > 0
      ? ` — partial coverage: ${blockedRequired.length} required check(s) were BLOCKED (${blockedRequired.map((r) => r.id).join('; ')}), but other rows on the same surface(s) DID execute, so this is a hole inside a proven surface, not an untested surface.`
      : '';
  const headline = fails.length > 0
    ? 'RED'
    : partial
      ? 'INCOMPLETE (nothing failed, required coverage missing)'
      : 'GREEN';
  return { headline, qualifier, unproven, partial, fails, skips, passes, blockedRequired, blockedOptional };
}
