/**
 * The GA gate's own gate (CLWX-90 / CLWX-106).
 *
 * `scripts/ga-gate.mjs` decides GA GO/NO-GO, and until 2026-09-07
 * `grep -rl "ga-gate" tests/` returned NOTHING. That absence is the mechanism, not
 * a detail: a fail-open shipped inside the gate itself and survived two review
 * lenses because nothing could contradict it. Every row below is a defect that was
 * real in this file's history, expressed as a test that fails if it returns.
 */
import { describe, expect, it } from 'vitest';

import { classifyRow, scorecard, surfacesOf } from '../../scripts/ga-gate-verdict.mjs';

type Row = {
  id: string;
  tier: string;
  box: string;
  status: string;
  optional?: boolean;
  blocked?: boolean;
};

const row = (over: Partial<Row> & { id: string }): Row => ({
  tier: 'T1',
  box: 'ExtValA',
  status: 'PASS',
  ...over,
});

describe('classifyRow — exit-code contract, fail-closed', () => {
  it('REGRESSION (HIGH-1, 2026-09-07): a row that exits 1 is a product FAIL even when its output mentions needs_signin', () => {
    // The shipped-then-reverted classifier regex-matched /needs_signin/ over the
    // row's combined stdout+stderr. clwx46-stale-read-check.ts prints
    // `[SAFE-REFUSE: ... status=needs_signin]` on its HEALTHY path (:91) and exits 1
    // on a real stale-read LEAK (:118) — so one healthy refusal in the same run as
    // the actual CLWX-46 defect relabelled that defect "lane blocked" and the gate
    // exited 0. The classifier must not be able to see output at all.
    expect(classifyRow({ exitCode: 1, laneContract: true })).toBe('FAIL');
    // And the signature must give it no way to: passing stdout is not part of it.
    expect(Object.keys(classifyRow as unknown as object)).not.toContain('stdout');
  });

  it('exit 0 is PASS, with or without the lane contract', () => {
    expect(classifyRow({ exitCode: 0 })).toBe('PASS');
    expect(classifyRow({ exitCode: 0, laneContract: true })).toBe('PASS');
  });

  it('exit 2 on a declared lane-contract row is BLOCKED, not a product failure', () => {
    expect(classifyRow({ exitCode: 2, laneContract: true })).toBe('BLOCKED');
  });

  it('exit 2 WITHOUT the lane contract is a FAIL — fail-closed, a row must opt in', () => {
    // pnpm lint:ps exits 2 when PSScriptAnalyzer is absent, and on the acceptance
    // machine that is a lane defect the gate must go red on, not skip.
    expect(classifyRow({ exitCode: 2 })).toBe('FAIL');
  });

  it('every other non-zero exit is a FAIL, including signals and the null of a timeout', () => {
    for (const exitCode of [3, 127, 143, null, undefined]) {
      expect(classifyRow({ exitCode, laneContract: true } as never)).toBe('FAIL');
    }
  });
});

describe('surfacesOf — a row speaks for a named GA surface', () => {
  it('maps email-family and forms rows, and the whole-tier skip to both', () => {
    expect(surfacesOf(row({ id: 'outlook-eval 15-row (K6/K14 guards)' }))).toEqual(['Email']);
    expect(surfacesOf(row({ id: 'stale-read check (CLWX-46 guard)' }))).toEqual(['Email']);
    expect(surfacesOf(row({ id: 'compose auto-recovery (CLWX-58 guard)' }))).toEqual(['Email']);
    expect(surfacesOf(row({ id: '2-gate SEND proof' }))).toEqual(['Email']);
    expect(surfacesOf(row({ id: 'forms Daily Report fill+gate (dry, CLWX-62)' }))).toEqual(['Forms']);
    expect(surfacesOf(row({ id: 'live-lane' }))).toEqual(['Email', 'Forms']);
  });

  it('falls back to the row box for anything unrecognised, never to empty', () => {
    expect(surfacesOf(row({ id: 'typecheck', box: 'hygiene' }))).toEqual(['hygiene']);
  });
});

describe('scorecard — the headline may not over- or under-claim coverage', () => {
  it('all green is GREEN with no qualifier', () => {
    const v = scorecard([row({ id: 'typecheck', tier: 'T0', box: 'hygiene' }), row({ id: 'forms Suspensions fill+gate (dry)' })]);
    expect(v.headline).toBe('GREEN');
    expect(v.qualifier).toBe('');
  });

  it('any required FAIL is RED — a fail outranks every coverage nuance', () => {
    const v = scorecard([
      row({ id: 'outlook-eval 15-row (K6/K14 guards)', status: 'FAIL' }),
      row({ id: 'live-lane', status: 'SKIP', blocked: true }),
    ]);
    expect(v.headline).toBe('RED');
  });

  it('REGRESSION (the original false-green): a fully-blocked required surface is INCOMPLETE and names the surface, never GREEN', () => {
    const v = scorecard([
      row({ id: 'typecheck', tier: 'T0', box: 'hygiene' }),
      row({ id: 'live-lane', box: 'email+forms', status: 'SKIP', blocked: true }),
    ]);
    expect(v.headline).toMatch(/^INCOMPLETE/);
    expect(v.qualifier).toContain('NOT TESTED this run');
    expect(v.unproven).toEqual(['Email', 'Forms']);
  });

  it('REGRESSION (MEDIUM-2, the over-correction): a blocked row on a surface that DID execute elsewhere stays GREEN and says "partial coverage", not "NOT TESTED"', () => {
    // GA_GATE_SEND=1 with no Outlook tab open: three email rows execute and pass,
    // only the SEND row blocks. The first fix printed "Email: NOT TESTED this run.
    // Nothing about Email was proven." while the transcript showed three green
    // email rows — an under-claim as dishonest as the over-claim it replaced.
    const v = scorecard([
      row({ id: 'outlook-eval 15-row (K6/K14 guards)' }),
      row({ id: 'stale-read check (CLWX-46 guard)' }),
      row({ id: 'compose auto-recovery (CLWX-58 guard)' }),
      row({ id: '2-gate SEND proof', box: 'email', status: 'SKIP', blocked: true }),
    ]);
    expect(v.headline).toBe('GREEN');
    expect(v.unproven).toEqual([]);
    expect(v.qualifier).toContain('partial coverage');
    expect(v.qualifier).not.toContain('NOT TESTED');
    // Still surfaced, never silently dropped: the reader must be able to find it.
    expect(v.blockedRequired.map((r) => r.id)).toEqual(['2-gate SEND proof']);
  });

  it('a FAIL on a surface counts as coverage of it — the surface was tested, and it lost', () => {
    const v = scorecard([
      row({ id: 'outlook-eval 15-row (K6/K14 guards)', status: 'FAIL' }),
      row({ id: 'stale-read check (CLWX-46 guard)', status: 'SKIP', blocked: true }),
    ]);
    expect(v.headline).toBe('RED');
    expect(v.unproven).toEqual([]);
  });

  it('a flag-driven skip is NOT a blocked skip — a qualifier on every default run carries no signal', () => {
    const v = scorecard([
      row({ id: 'outlook-eval 15-row (K6/K14 guards)' }),
      row({ id: '2-gate SEND proof', box: 'email', status: 'SKIP' }),   // GA_GATE_SEND!=1
    ]);
    expect(v.headline).toBe('GREEN');
    expect(v.qualifier).toBe('');
    expect(v.blockedRequired).toEqual([]);
  });

  it('GA_GATE_STATIC=1 does not report the live tier as missing coverage — the operator chose a narrower run', () => {
    const v = scorecard(
      [
        row({ id: 'typecheck', tier: 'T0', box: 'hygiene' }),
        row({ id: 'live-lane', box: 'email+forms', status: 'SKIP', blocked: true }),
      ],
      { staticOnly: true },
    );
    expect(v.headline).toBe('GREEN');
    expect(v.blockedRequired).toEqual([]);
  });

  it('T2 blocked lanes report separately and never qualify the required verdict (the V-batch owns them)', () => {
    const v = scorecard([
      row({ id: 'typecheck', tier: 'T0', box: 'hygiene' }),
      row({ id: 'vm-lane (KR2 + W-matrix)', tier: 'T2', box: 'KR2', status: 'SKIP', blocked: true }),
    ]);
    expect(v.headline).toBe('GREEN');
    expect(v.blockedRequired).toEqual([]);
    expect(v.blockedOptional.map((r) => r.id)).toEqual(['vm-lane (KR2 + W-matrix)']);
  });

  it('an OPTIONAL row failing does not turn the gate red', () => {
    const v = scorecard([row({ id: 'vm-lane', tier: 'T2', box: 'KR2', status: 'FAIL', optional: true })]);
    expect(v.headline).toBe('GREEN');
    expect(v.fails).toEqual([]);
  });

  it('importing the verdict module has no side effects — no report written, no process exit', () => {
    // The whole reason the judgement lives in its own module. If this file ever
    // imports the gate script instead, the suite would spawn pnpm and exit the
    // worker; that this test runs at all is the assertion.
    expect(typeof scorecard).toBe('function');
    expect(typeof classifyRow).toBe('function');
  });
});
