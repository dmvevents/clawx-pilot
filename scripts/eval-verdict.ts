/**
 * Pure verdict logic for the live Outlook eval (`scripts/v2-eval.ts`).
 *
 * WHY this module exists at all (CLWX-119, and the residual named on CLWX-120).
 *
 * `v2-eval.ts` cannot be imported by a test: it opens a CDP browser and calls
 * `process.exit` at the end of `main()`. So every judgement it made — which
 * failures mean "the lane was never ready" versus "the product is broken", when
 * a refusal is honest, how slow is too slow — lived in a script no test could
 * reach. That is exactly how a fail-open shipped inside `scripts/ga-gate.mjs`
 * and survived two review lenses, and the remedy that worked there works here:
 * extract the judgement into a pure module that the script imports as its
 * SINGLE decision point, and pin the module.
 *
 * Pinning a copy of this logic in a test would verify a surface that is not the
 * shipped surface. `v2-eval.ts` must import these functions, never re-implement
 * them.
 */

/**
 * A row's failure cause, as far as the verdict cares.
 *
 * `laneNotReady` is a TYPED opt-in, deliberately not inferred from `notes`.
 *
 * The bug this replaces: the exit contract decided "lane not ready" by running
 * `/needs_signin/i` over each failing row's free-text `notes`. That was wrong in
 * BOTH directions, which is why it had to go rather than be tightened:
 *
 *   fail-OPEN   — the token reaches `notes` only because most rows happen to
 *                 interpolate `status=${r.status}`. Any row that mentions the
 *                 word for any other reason (a leak list, a quoted reason
 *                 string, a future note about sign-in handling) hands a REAL
 *                 product failure the "lane not ready" label and exit 0.
 *   fail-CLOSED — the rows that build richer notes without the status token get
 *                 the opposite treatment: a genuine sign-in wall is reported as
 *                 a product FAIL, the false-attribution the gate's own
 *                 probe-honesty rule forbids.
 *
 * Same lesson as CLWX-120: a verdict keyed off log text is a verdict keyed off
 * a lie waiting to happen. A row must POSITIVELY declare that it died at the
 * sign-in wall; silence means product failure, which is the direction that
 * keeps defects visible.
 */
export interface VerdictRow {
  id: string;
  status: 'pass' | 'fail' | 'skip';
  latencyMs: number;
  notes?: string;
  /** Set by a row that observed `status === 'needs_signin'` from the driver. */
  laneNotReady?: boolean;
}

/**
 * Latency thresholds. Both numbers are the PRODUCT's own user-visible
 * commitments, taken from decisions already recorded in this repo — not
 * invented for the eval, because the GA latency budget is an open owner ask
 * (`GA_FINISH_SPRINT_2026-09-03.md` §6, owner lane) and inventing one here
 * would pre-empt that decision.
 *
 *   SLOW (30s)     — the point at which the product itself admits it is slow
 *                    (CLWX-47 / TB-3: the "still working" notice at 30s).
 *   CEILING (90s)  — the point at which the product GIVES UP and fails over to
 *                    another channel (CLWX-94: the 90s watchdog failover).
 *
 * A row that returns correct data after the ceiling therefore contradicts the
 * product's own contract: in the app, that turn would already have been failed
 * over. Reporting it as a clean PASS is the "no silent caps" violation the
 * register keeps catching, so it FAILs. If the owner's budget lands tighter,
 * these constants move — the mechanism does not.
 */
export const LATENCY_SLOW_MS = 30_000;
export const LATENCY_CEILING_MS = 90_000;

export type LatencyClass = 'ok' | 'slow' | 'over_ceiling';

/**
 * Boundary rule: the thresholds are inclusive lower bounds ("at 30s the notice
 * has fired"), so exactly 30_000 is already slow and exactly 90_000 is already
 * over the ceiling. Stated because a boundary left to the reader is a boundary
 * two people will read two ways.
 */
export function classifyLatency(latencyMs: number): LatencyClass {
  if (!Number.isFinite(latencyMs) || latencyMs < 0) return 'ok'; // unmeasured, never a verdict
  if (latencyMs >= LATENCY_CEILING_MS) return 'over_ceiling';
  if (latencyMs >= LATENCY_SLOW_MS) return 'slow';
  return 'ok';
}

/**
 * Rows that PASSED on correctness but blew the ceiling. Only passing rows are
 * eligible: a row that already failed does not need a second reason, and a
 * SKIPPED row measured nothing, so charging it for its own duration would
 * manufacture a failure out of an unexercised row.
 */
export function latencyViolations(rows: readonly VerdictRow[]): VerdictRow[] {
  return rows.filter((r) => r.status === 'pass' && classifyLatency(r.latencyMs) === 'over_ceiling');
}

export interface LaneVerdict {
  /** 0 pass · 1 product failure · 2 lane not ready — this repo's uniform lane-script contract. */
  exitCode: 0 | 1 | 2;
  reason: string;
}

/**
 * The whole-run verdict.
 *
 * Exit 2 ("lane not ready") requires that there IS at least one failing row and
 * that EVERY failing row declared `laneNotReady`. One unexplained failure and
 * the run stays exit 1, because a run that mixes a sign-in wall with a real
 * defect has still found a real defect.
 */
export function laneVerdict(rows: readonly VerdictRow[]): LaneVerdict {
  const failing = rows.filter((r) => r.status === 'fail');
  const slowPasses = latencyViolations(rows);

  if (failing.length > 0) {
    const laneFails = failing.filter((r) => r.laneNotReady === true);
    if (laneFails.length === failing.length) {
      return {
        exitCode: 2,
        reason: `EVAL ABORTED: every failing row (${laneFails.length}) died at the Microsoft sign-in wall, so this run proves nothing about email integration. Lane not ready, not a product failure.`,
      };
    }
    const unexplained = failing.filter((r) => r.laneNotReady !== true).map((r) => r.id);
    return {
      exitCode: 1,
      reason: `PRODUCT FAILURE: ${failing.length} failing row(s); ${unexplained.length} not attributable to the sign-in wall (${unexplained.join(', ')}).`,
    };
  }

  if (slowPasses.length > 0) {
    return {
      exitCode: 1,
      reason: `LATENCY OVER CEILING: ${slowPasses
        .map((r) => `${r.id}=${r.latencyMs}ms`)
        .join(', ')} — each exceeded ${LATENCY_CEILING_MS}ms, the product's own watchdog-failover point (CLWX-94), so these turns would have been failed over in the app. Correctness passed; the timing did not.`,
    };
  }

  return { exitCode: 0, reason: 'all rows pass' };
}

/**
 * Per-run artifact path.
 *
 * The eval used to overwrite `/tmp/v2-eval-results.json` every run, which is
 * how CLWX-119's central finding was nearly unprovable: two runs ten minutes
 * apart swapped which rows failed, and that was only demonstrable because both
 * console logs happened to still be open. The gate reports already learned this
 * and suffix `_runN`; the eval had not.
 *
 * Kept under /tmp deliberately. Row notes can carry message subjects, and the
 * hard rule caps subjects at 120 chars and keeps them out of committed files —
 * promoting these artifacts to `docs/evidence/` needs a redaction pass first
 * (open item), so this function must not be pointed at the repo.
 */
export function evalArtifactPath(runAt: string, dir = '/tmp'): string {
  const stamp = runAt.replace(/[:.]/g, '-').replace(/[^0-9A-Za-z-]/g, '');
  return `${dir}/v2-eval-results-${stamp}.json`;
}

/** The stable path the gate and a human read for "the most recent run". */
export function evalLatestPath(dir = '/tmp'): string {
  return `${dir}/v2-eval-results.json`;
}

/**
 * `continue` carries the validated array back out, so the call site never
 * re-checks what this function already decided. Handing back only `kind:
 * 'continue'` would leave the caller to narrow `attachments` itself — a second
 * copy of the same rule, which is how the two ends of a check drift apart.
 */
export type AttachmentLocateGrade<T> =
  | { kind: 'skip'; notes: string }
  | { kind: 'fail'; notes: string }
  | { kind: 'continue'; attachments: T[] };

/**
 * W3.2's locate-outcome grading (CLWX-120), extracted so it is finally testable
 * — the residual named on that card was that this exact judgement had no test.
 *
 * Two outcomes must not be conflated:
 *
 *   stale_read_guard — the CLWX-46 guard declined to confirm the reading pane
 *                      settled on the clicked message. The product refusing to
 *                      hand over content it cannot attribute. A refusal makes
 *                      NO claim about attachments, so the row is UNEXERCISED.
 *   not_in_list      — the message could not be reached at all. A real product
 *                      failure, and it still FAILs.
 *
 * Fail-closed: only POSITIVE evidence of a refusal earns the skip. An absent
 * `notFoundReason` falls through to FAIL, so a leaner transport that never sets
 * the field cannot buy itself a green. The asymmetry that keeps this row from
 * going soft: a skip requires a refusal, but data returned and WRONG is always
 * a FAIL, never a skip.
 */
export function gradeAttachmentLocate<T>(result: {
  status: string;
  notFoundReason?: string;
  attachments?: T[];
}): AttachmentLocateGrade<T> {
  if (result.status === 'not_found' && result.notFoundReason === 'stale_read_guard') {
    return {
      kind: 'skip',
      notes:
        'UNEXERCISED — the CLWX-46 stale-read guard refused to confirm the reading pane settled on the clicked message, across two fresh ids. The guard firing is correct behaviour and makes no claim about attachment metadata, so this row proved nothing either way. Not a product failure (CLWX-120).',
    };
  }
  if (result.status !== 'ok' || !Array.isArray(result.attachments)) {
    const count = Array.isArray(result.attachments) ? result.attachments.length : 'undefined';
    return {
      kind: 'fail',
      notes: `status=${result.status} attachments=${count} notFoundReason=${result.notFoundReason ?? 'none'}`,
    };
  }
  return { kind: 'continue', attachments: result.attachments };
}
