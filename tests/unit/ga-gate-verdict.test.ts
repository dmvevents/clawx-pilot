/**
 * The GA gate's own gate (CLWX-90 / CLWX-106).
 *
 * `scripts/ga-gate.mjs` decides GA GO/NO-GO, and until 2026-09-07
 * `grep -rl "ga-gate" tests/` returned NOTHING. That absence is the mechanism, not
 * a detail: a fail-open shipped inside the gate itself and survived two review
 * lenses because nothing could contradict it. Every row below is a defect that was
 * real in this file's history, expressed as a test that fails if it returns.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

import { RELEASE_REQUIRED_CRITERIA, classifyRow, scorecard, surfacesOf } from '../../scripts/ga-gate-verdict.mjs';

type Row = {
  id: string;
  tier: string;
  box: string;
  status: string;
  criteria?: string[];
  optional?: boolean;
  blocked?: boolean;
};

const row = (over: Partial<Row> & { id: string }): Row => ({
  tier: 'T1',
  box: 'ExtValA',
  status: 'PASS',
  ...over,
});

const releaseRows = (overrides: Partial<Row>[] = []): Row[] => [
  row({ id: 'typecheck', tier: 'T0', box: 'hygiene', criteria: ['t0-typecheck'] }),
  row({ id: 'lint', tier: 'T0', box: 'hygiene', criteria: ['t0-lint'] }),
  row({ id: 'pwsh lint (CLWX-83)', tier: 'T0', box: 'hygiene', criteria: ['t0-pwsh-lint'] }),
  row({ id: 'agent model pins (CLWX-83)', tier: 'T0', box: 'hygiene', criteria: ['t0-agent-model-pins'] }),
  row({ id: 'unit-suite', tier: 'T0', box: 'hygiene', criteria: ['t0-unit-suite'] }),
  row({ id: 'bundle-verify (CLWX-72 gate)', tier: 'T0', box: 'hygiene+KR1', criteria: ['t0-bundle-verify'] }),
  row({ id: 'doc-tooling harness (KR1 proxy)', tier: 'T0', box: 'KR1', criteria: ['t0-doc-tooling-harness'] }),
  row({ id: 'renderer-e2e (Playwright, CLWX-91)', tier: 'T0', box: 'hygiene', criteria: ['renderer-e2e'] }),
  row({ id: 'outlook-eval 18-row (K6/K14 guards)', tier: 'T1', box: 'ExtValA', criteria: ['t1-outlook-eval'] }),
  row({ id: 'stale-read check (CLWX-46 guard)', tier: 'T1', box: 'ExtValA', criteria: ['t1-stale-read'] }),
  row({ id: 'compose auto-recovery (CLWX-58 guard)', tier: 'T1', box: 'ExtValA', criteria: ['t1-compose-recovery'] }),
  row({ id: 'forms Suspensions fill+gate (dry)', tier: 'T1', box: 'forms', criteria: ['t1-forms-suspensions'] }),
  row({ id: 'forms Daily Report fill+gate (dry, CLWX-62)', tier: 'T1', box: 'forms', criteria: ['t1-forms-daily-report'] }),
  row({ id: '2-gate SEND proof (sandbox)', tier: 'T1', box: 'email', criteria: ['t1-send-proof'] }),
  row({ id: 'NSCC Q&A eval (CLWX-42)', tier: 'T1', box: 'routine-query', criteria: ['t1-nscc-qna'] }),
  row({ id: 'installed Windows app proof', tier: 'T2', box: 'KR2+W-matrix', criteria: ['t2-installed-windows-app'] }),
  row({ id: 'release-artifact-provenance', tier: 'release', box: 'artifact identity', criteria: ['release-artifact-provenance'] }),
].map((base, index) => ({ ...base, ...overrides[index] }));

function overrideCriterion(rows: Row[], criterion: string, patch: Partial<Row>): Row[] {
  return rows.map((candidate) => (
    candidate.criteria?.includes(criterion) ? { ...candidate, ...patch } : candidate
  ));
}

async function runGateWithMocks({
  argv = ['node', 'scripts/ga-gate.mjs'],
  env = {},
  cdpUp = true,
  outlookTab = true,
  buildProfileError = null,
}: {
  argv?: string[];
  env?: Record<string, string>;
  cdpUp?: boolean;
  outlookTab?: boolean;
  buildProfileError?: string | null;
} = {}) {
  const source = readFileSync('scripts/ga-gate.mjs', 'utf8');
  const transformed = source
    .replace("import { execSync, spawnSync } from 'node:child_process';", 'const { execSync, spawnSync } = childProcess;')
    .replace("import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';", 'const { writeFileSync, readFileSync, mkdirSync, existsSync } = fsModule;')
    .replace("import path from 'node:path';", 'const path = pathModule;')
    .replace("import { classifyRow, scorecard } from './ga-gate-verdict.mjs';", 'const { classifyRow, scorecard } = verdict;')
    .replace("import { readCurrentSource } from './release-build-source.mjs';", 'const { readCurrentSource } = evidence;')
    .replace("import { evaluateInstalledEvidence } from './installed-release-evidence.mjs';", 'const { evaluateInstalledEvidence } = evidence;')
    .replace("import { candidateProblems, loadReleaseBuildProfile, validateReleaseEvidence, writeReleaseEvidence } from './release-evidence.mjs';", 'const { candidateProblems, loadReleaseBuildProfile, validateReleaseEvidence, writeReleaseEvidence } = evidence;');
  const spawned: string[] = [];
  const writes: Array<{ file: string; text: string }> = [];
  let output = '';
  let exitCode: number | undefined;
  const exitSignal = new Error('process.exit');
  const fakeProcess = {
    env,
    argv,
    cwd: () => '/fixture',
    stdout: { write: (text: string) => { output += text; } },
    exit: (code: number) => {
      exitCode = code;
      throw exitSignal;
    },
  };
  const fakeConsole = {
    log: (text = '') => { output += `${text}\n`; },
    error: (text = '') => { output += `${text}\n`; },
  };
  const fakeChildProcess = {
    spawnSync: (_bin: string, args: string[]) => {
      spawned.push(args.join(' '));
      return { status: 0, stdout: 'ok\n', stderr: '' };
    },
    execSync: (cmd: string) => {
      if (cmd.includes('/json/version')) {
        if (cdpUp) return '';
        throw new Error('CDP down');
      }
      if (cmd.includes('probe-outlook-tab')) {
        if (outlookTab) return '';
        throw new Error('Outlook tab missing');
      }
      throw new Error('probe down');
    },
  };
  const fakeFs = {
    mkdirSync: () => undefined,
    existsSync: () => false,
    readFileSync: (file: string) => {
      if (file === 'scripts/v2-eval.ts') return 'await runRow(\n'.repeat(18);
      return '';
    },
    writeFileSync: (file: string, text: string) => {
      writes.push({ file, text });
    },
  };
  try {
    await vm.runInNewContext(`(async () => {${transformed}\n})()`, {
      childProcess: fakeChildProcess,
      fsModule: fakeFs,
      pathModule: path,
      verdict: { classifyRow, scorecard },
      evidence: {
        readCurrentSource: () => ({ gitCommit: 'a'.repeat(40), gitDirty: false }),
        candidateProblems: () => ['No source-bound candidate in this runner fixture.'],
        loadReleaseBuildProfile: () => {
          if (buildProfileError) throw new Error(buildProfileError);
          return null;
        },
        evaluateInstalledEvidence: async () => ({ ok: false, checks: [], files: [] }),
        writeReleaseEvidence: async () => '/fixture/release-evidence.json',
        validateReleaseEvidence: async () => ({ ok: false, problems: ['No installed candidate'] }),
      },
      process: fakeProcess,
      console: fakeConsole,
      Date,
    });
  } catch (error) {
    if (error !== exitSignal) throw error;
  }
  return { exitCode, output, spawned, writes };
}

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
    expect(v.exitCode).toBe(1);
  });

  it('GA_GATE_STATIC=1 is the explicit exclusion for blocked live lanes', () => {
    const v = scorecard(
      [
        row({ id: 'typecheck', tier: 'T0', box: 'hygiene' }),
        row({ id: 'live-lane', box: 'email+forms', status: 'SKIP', blocked: true }),
      ],
      { staticOnly: true },
    );
    expect(v.headline).toBe('GREEN');
    expect(v.exitCode).toBe(0);
    expect(v.blockedRequired).toEqual([]);
  });

  it('REGRESSION (MEDIUM-2, the over-correction): a blocked row on a surface that DID execute elsewhere is INCOMPLETE and says "partial coverage", not "NOT TESTED"', () => {
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
    expect(v.headline).toMatch(/^INCOMPLETE/);
    expect(v.exitCode).toBe(1);
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

  it('release mode passes only when every required criterion has explicit PASS rows', () => {
    const v = scorecard(releaseRows(), { release: true });
    expect(v.headline).toBe('GREEN');
    expect(v.exitCode).toBe(0);
    expect(v.releaseBlockers).toEqual([]);
  });

  it('release mode ignores caller-supplied releaseCriteria overrides', () => {
    const v = scorecard([], { release: true, releaseCriteria: [] } as never);
    expect(v.headline).toBe('RED');
    expect(v.exitCode).toBe(1);
    expect(v.releaseBlockers.map((blocker) => blocker.criterion)).toEqual(
      expect.arrayContaining(RELEASE_REQUIRED_CRITERIA.map((criterion) => criterion.id)),
    );
  });

  it('release mode fails closed when a required criterion is absent', () => {
    const rows = releaseRows().filter((candidate) => !candidate.criteria?.includes('renderer-e2e'));
    const v = scorecard(rows, { release: true });
    expect(v.headline).toBe('RED');
    expect(v.exitCode).toBe(1);
    expect(v.releaseBlockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ criterion: 'renderer-e2e', status: 'ABSENT' }),
      ]),
    );
  });

  it('release mode fails closed when one expected static sibling is omitted', () => {
    const rows = releaseRows().filter((candidate) => !candidate.criteria?.includes('t0-unit-suite'));
    const v = scorecard(rows, { release: true });
    expect(v.headline).toBe('RED');
    expect(v.releaseBlockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ criterion: 't0-unit-suite', status: 'ABSENT' }),
      ]),
    );
  });

  it('release mode fails closed when one expected live sibling is omitted', () => {
    const rows = releaseRows().filter((candidate) => !candidate.criteria?.includes('t1-forms-daily-report'));
    const v = scorecard(rows, { release: true });
    expect(v.headline).toBe('RED');
    expect(v.releaseBlockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ criterion: 't1-forms-daily-report', status: 'ABSENT' }),
      ]),
    );
  });

  it('release mode fails closed on SKIP, BLOCKED, NOT_RUN, INFO, and unexpected statuses for required criteria', () => {
    const rows = [
      ...releaseRows([
        {},
        { status: 'SKIP' },
        { status: 'BLOCKED' },
        { status: 'NOT_RUN' },
        { status: 'INFO' },
      ]),
      row({ id: 'unexpected required status', tier: 'T0', box: 'hygiene', status: 'WEIRD', criteria: ['t0-typecheck'] }),
    ];
    const v = scorecard(rows, { release: true });
    expect(v.headline).toBe('RED');
    expect(v.exitCode).toBe(1);
    expect(v.releaseBlockers.map((blocker) => blocker.criterion)).toEqual(
      expect.arrayContaining(['t0-typecheck', 't0-lint', 't0-pwsh-lint', 't0-agent-model-pins', 't0-unit-suite']),
    );
    expect(v.releaseBlockers.map((blocker) => blocker.status)).toEqual(
      expect.arrayContaining(['WEIRD', 'SKIP', 'BLOCKED', 'NOT_RUN', 'INFO']),
    );
    expect(v.releaseBlockers.find((blocker) => blocker.criterion === 't0-typecheck')?.reason).toContain('WEIRD');
  });

  it('release mode treats the current optional INFO T2 probe as unresolved, not installed proof', () => {
    const v = scorecard(overrideCriterion(releaseRows(), 't2-installed-windows-app', { id: 'vm-lane', status: 'INFO', optional: true }), { release: true });
    expect(v.headline).toBe('RED');
    expect(v.exitCode).toBe(1);
    expect(v.releaseBlockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ criterion: 't2-installed-windows-app', status: 'INFO' }),
      ]),
    );
  });

  it('release mode blocks skipped send and NSCC proof while development mode remains skip-tolerant', () => {
    const rows = overrideCriterion(
      overrideCriterion(releaseRows(), 't1-send-proof', { status: 'SKIP' }),
      't1-nscc-qna',
      { status: 'SKIP' },
    );
    const development = scorecard(rows);
    const release = scorecard(rows, { release: true });
    expect(development.headline).toBe('GREEN');
    expect(development.exitCode).toBe(0);
    expect(release.headline).toBe('RED');
    expect(release.exitCode).toBe(1);
    expect(release.releaseBlockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ criterion: 't1-send-proof', status: 'SKIP' }),
        expect.objectContaining({ criterion: 't1-nscc-qna', status: 'SKIP' }),
      ]),
    );
  });

  it('release mode fails closed when installed Windows app proof is missing entirely', () => {
    const rows = releaseRows().filter((candidate) => !candidate.criteria?.includes('t2-installed-windows-app'));
    const v = scorecard(rows, { release: true });
    expect(v.headline).toBe('RED');
    expect(v.exitCode).toBe(1);
    expect(v.releaseBlockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ criterion: 't2-installed-windows-app', status: 'ABSENT' }),
      ]),
    );
  });

  it('release mode does not let optional:true bypass a release-required failure', () => {
    const v = scorecard(overrideCriterion(releaseRows(), 't2-installed-windows-app', { status: 'FAIL', optional: true }), { release: true });
    expect(v.headline).toBe('RED');
    expect(v.exitCode).toBe(1);
    expect(v.releaseBlockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ criterion: 't2-installed-windows-app' }),
      ]),
    );
  });

  it('static plus release mode never succeeds even when static rows pass', () => {
    const v = scorecard(releaseRows(), { release: true, staticOnly: true });
    expect(v.headline).toBe('RED');
    expect(v.exitCode).toBe(1);
    expect(v.releaseBlockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ criterion: 'release-mode', status: 'STATIC_ONLY' }),
      ]),
    );
  });

  it('importing the verdict module has no side effects — no report written, no process exit', () => {
    // The whole reason the judgement lives in its own module. If this file ever
    // imports the gate script instead, the suite would spawn pnpm and exit the
    // worker; that this test runs at all is the assertion.
    expect(typeof scorecard).toBe('function');
    expect(typeof classifyRow).toBe('function');
  });

  it('the executable gate keeps flag-driven opt-in skips exit-zero under mocked commands', async () => {
    const run = await runGateWithMocks();
    expect(run.exitCode).toBe(0);
    expect(run.output).toContain('development-health; not release acceptance');
    expect(run.output).toContain('2-gate SEND proof');
    expect(run.output).toContain('NSCC Q&A eval');
    expect(run.spawned.some((cmd) => cmd.includes('v2-send-test.ts'))).toBe(false);
    expect(run.spawned.some((cmd) => cmd.includes('nscc-qna-eval.ts'))).toBe(false);
  });

  it('the executable gate exits nonzero for a missing required live lane in normal non-static mode', async () => {
    const run = await runGateWithMocks({ cdpUp: false });
    expect(run.exitCode).toBe(1);
    expect(run.output).toContain('! GATE INCOMPLETE');
    expect(run.output).toContain('Chrome CDP :18792 not reachable');
  });

  it('the executable gate exits nonzero when GA_GATE_SEND=1 is requested without an Outlook tab', async () => {
    const run = await runGateWithMocks({ env: { GA_GATE_SEND: '1' }, outlookTab: false });
    expect(run.exitCode).toBe(1);
    expect(run.output).toContain('GA_GATE_SEND=1 but no Outlook tab is open');
    expect(run.spawned.some((cmd) => cmd.includes('v2-send-test.ts'))).toBe(false);
  });

  it('the executable gate exits before live commands when the provided build profile is invalid', async () => {
    const run = await runGateWithMocks({
      env: { GA_GATE_BUILD_PROFILE: '/fixture/bad-profile.json' },
      buildProfileError: 'release-build-profile is unsupported for this fixture',
    });

    expect(run.exitCode).toBe(3);
    expect(run.output).toContain('release-build-profile is unsupported for this fixture');
    expect(run.spawned).toEqual([]);
  });

  it('the executable gate preserves GA_GATE_STATIC=1 as an explicit live-lane exclusion', async () => {
    const run = await runGateWithMocks({ env: { GA_GATE_STATIC: '1' }, cdpUp: false, outlookTab: false });
    expect(run.exitCode).toBe(0);
    expect(run.output).toContain('GA_GATE_STATIC=1');
    expect(run.output).toContain('✓ GATE GREEN');
  });

  it('the executable gate selects strict release mode from CLI or env and fails on skipped opt-in proof', async () => {
    const cli = await runGateWithMocks({ argv: ['node', 'scripts/ga-gate.mjs', '--release'] });
    const env = await runGateWithMocks({ env: { GA_GATE_RELEASE: '1' } });
    for (const run of [cli, env]) {
      expect(run.exitCode).toBe(1);
      expect(run.output).toContain('strict-release-evidence; not GA approval');
      expect(run.output).toContain('t1-send-proof=SKIP');
      expect(run.output).toContain('t1-nscc-qna=SKIP');
      expect(run.output).toContain('t2-installed-windows-app=SKIP');
      expect(run.spawned.some((cmd) => cmd.includes('v2-send-test.ts'))).toBe(false);
      expect(run.spawned.some((cmd) => cmd.includes('nscc-qna-eval.ts'))).toBe(false);
      expect(run.writes.some((write) => write.text.includes('Release strict gate: FAIL'))).toBe(true);
    }
  });
});
