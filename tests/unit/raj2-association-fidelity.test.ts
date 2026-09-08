/**
 * CLWX-115 — the recurring association/negation fidelity fixture's own gate.
 *
 * Three surfaces are pinned here, because each has failed silently elsewhere
 * in this repo's history:
 *   1. the CHECKER (eval/lib/raj2-association-fidelity.mjs) — must catch the
 *      classes the standalone membership probe provably cannot: swapped
 *      person→fact bindings, attribute-class swaps (the literal RAJ-2 report),
 *      dropped/inverted negation, quantity drift, dropped persons/actions;
 *   2. the RUNNER (scripts/raj2-association-fidelity-gate.mjs) — must be
 *      fail-closed: missing fixture, hollow fixture and weakened-checker
 *      shapes all exit 1; only the fully-matched fixture exits 0;
 *   3. the GATE REGISTRATION — ga-gate.mjs must carry the row as a required
 *      (non-optional, no-laneContract) T0 `run(...)`, because a check that
 *      exists but is wired nowhere is exactly how the standalone probe
 *      stopped counting (CLWX-115's stated gap).
 *
 * Everything here is synthetic and offline: no model call, no tenant, no
 * email content. Green here is SOURCE-FIXTURE evidence only and does not
 * establish installed-agent fidelity.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  REQUIRED_MUTATION_CLASSES,
  checkAssociationFidelity,
  evaluateFixture,
  findMentions,
  validateFixtureShape,
} from '../../eval/lib/raj2-association-fidelity.mjs';

type FixtureCase = { id: string; expected: string; mutationClass: string | null; output: string };
type Fixture = {
  expectations: {
    persons: Array<{ name: string; aliases?: string[]; facts?: Array<Record<string, unknown>> }>;
    requiredActionTokens: string[];
  };
  cases: FixtureCase[];
};

const FIXTURE_PATH = path.resolve('eval/fixtures/raj2-association-fidelity.json');
const RUNNER_PATH = path.resolve('scripts/raj2-association-fidelity-gate.mjs');
const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as Fixture;

const caseById = (id: string): FixtureCase => {
  const found = fixture.cases.find((c) => c.id === id);
  if (!found) throw new Error(`fixture case ${id} is missing`);
  return found;
};

const failureTypes = (output: string): string[] => [
  ...new Set(checkAssociationFidelity(output, fixture.expectations).failures.map((f: { type: string }) => f.type)),
];

function runRunner(env: Record<string, string> = {}) {
  const r = spawnSync('node', [RUNNER_PATH], { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 30_000 });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

function writeTempFixture(mutate: (f: Fixture) => void): string {
  const copy = JSON.parse(JSON.stringify(fixture)) as Fixture;
  mutate(copy);
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'raj2-fixture-')), 'fixture.json');
  writeFileSync(file, JSON.stringify(copy));
  return file;
}

describe('CLWX-115 checker: person→fact bindings the membership probe cannot see', () => {
  it('passes the faithful readback, including the unattributed aggregate recap in the reply', () => {
    const { verdict, failures } = checkAssociationFidelity(caseById('faithful').output, fixture.expectations);
    expect(failures).toEqual([]);
    expect(verdict).toBe('PASS');
  });

  it('fails a swapped meal association between the two Keishas as a misattribution, not a wording nit', () => {
    const types = failureTypes(caseById('swap-meal-association').output);
    expect(types).toContain('association-misattributed');
    expect(types).toContain('association-missing');
  });

  it('fails the literal RAJ-2 class — shirt sizes read back as meal preferences — via the attribute cue', () => {
    const types = failureTypes(caseById('shirt-sizes-as-meals').output);
    expect(types).toContain('attribute-cue-missing');
    expect(types).toContain('association-missing');
  });

  it('fails a dropped negation: "Anil is attending" is a token subset of the source and must still be red', () => {
    expect(failureTypes(caseById('negation-dropped').output)).toContain('negation-dropped');
  });

  it('fails a borrowed negation: the adjacent fact\'s "no meal" cannot negate "attending" (W2 Finding 1)', () => {
    const { failures } = checkAssociationFidelity(
      caseById('negation-borrowed-from-adjacent-fact').output,
      fixture.expectations,
    );
    expect(failures).toContainEqual(
      expect.objectContaining({ type: 'negation-dropped', person: 'Anil Rampersad', value: 'attending' }),
    );
  });

  it('a preposition does not lend the next fact\'s negation: "attending with no meal or shirt" (delta review)', () => {
    // W2 delta-review blocking finding: "with" is not a clause fence, so the
    // fence test alone lets the forward-attributive "no meal" bind backwards
    // onto "attending". The cue's own noun claims it; attendance stays red.
    const { failures } = checkAssociationFidelity(
      caseById('negation-borrowed-across-preposition').output,
      fixture.expectations,
    );
    expect(failures).toContainEqual(
      expect.objectContaining({ type: 'negation-dropped', person: 'Anil Rampersad', value: 'attending' }),
    );
  });

  it('the "despite no meal or shirt" variant of the borrowed negation is also red', () => {
    const output = caseById('faithful').output.replace(
      'Anil Rampersad is not attending, so he needs no meal or shirt.',
      'Anil Rampersad is attending despite no meal or shirt.',
    );
    const { failures } = checkAssociationFidelity(output, fixture.expectations);
    expect(failures).toContainEqual(
      expect.objectContaining({ type: 'negation-dropped', person: 'Anil Rampersad', value: 'attending' }),
    );
  });

  it('a stray "not" across a clause boundary does not satisfy a negated fact', () => {
    // Reviewer variant of Finding 1: "not one to skip" is separated from
    // "attending" by a comma; the cue must not bind across it.
    const output = caseById('faithful').output.replace(
      'Anil Rampersad is not attending, so he needs no meal or shirt.',
      'Anil Rampersad, not one to skip, is attending on Friday.',
    );
    const { failures } = checkAssociationFidelity(output, fixture.expectations);
    expect(failures).toContainEqual(
      expect.objectContaining({ type: 'negation-dropped', person: 'Anil Rampersad', value: 'attending' }),
    );
  });

  it('fails the within-sentence attribute swap: "small meal and a vegetarian shirt" (W2 Finding 2)', () => {
    // Both cue words are present in the segment; only proximity to the value
    // exposes that every binding is swapped. Both of Keisha Mohammed's facts
    // must red, and this is a cue failure, not a missing association.
    const { failures } = checkAssociationFidelity(
      caseById('within-sentence-attribute-swap').output,
      fixture.expectations,
    );
    expect(failures).toContainEqual(
      expect.objectContaining({ type: 'attribute-cue-missing', person: 'Keisha Mohammed', attribute: 'meal' }),
    );
    expect(failures).toContainEqual(
      expect.objectContaining({ type: 'attribute-cue-missing', person: 'Keisha Mohammed', attribute: 'shirt-size' }),
    );
    expect(failures.map((f: { type: string }) => f.type)).not.toContain('association-missing');
  });

  it('fails an inverted negation: "does not want the vegetarian meal" against a positive source fact', () => {
    expect(failureTypes(caseById('negation-inverted').output)).toContain('negation-inverted');
  });

  it('fails quantity drift (3 jerseys → 4) because the sourced quantity leaves the person binding', () => {
    expect(failureTypes(caseById('quantity-drift').output)).toContain('association-missing');
  });

  it('fails a dropped person and a dropped requested action', () => {
    expect(failureTypes(caseById('person-dropped').output)).toContain('association-missing');
    expect(failureTypes(caseById('action-dropped').output)).toContain('action-token-missing');
  });

  it('never passes vacuously: a content-free summary is red on association AND action coverage', () => {
    const types = failureTypes(caseById('vacuous-summary').output);
    expect(types).toContain('association-missing');
    expect(types).toContain('action-token-missing');
  });

  it('does not double-claim overlapping mentions: "Marcus" inside "Marcus Persad" is one mention', () => {
    const mentions = findMentions('Marcus Persad wants the fish meal.', fixture.expectations.persons);
    expect(mentions).toHaveLength(1);
    expect(mentions[0].person).toBe('Marcus Persad');
  });

  it('lookahead negation applies only to negated facts — "extra-large shirt with no peanuts" stays green', () => {
    // Regression pin for the window design: if the inverted-negation rule ever
    // gains an after-window, the legitimate "no" of the NEXT fact reds a
    // faithful sentence, and this test catches it before the fixture does.
    const { failures } = checkAssociationFidelity(
      'Keisha Ali wants the chicken meal and an extra-large shirt with no peanuts in her meal. '
      + 'Keisha Mohammed wants the vegetarian meal and a small shirt. '
      + 'Marcus Persad wants the fish meal, a medium shirt and 3 extra jerseys. '
      + 'Anil Rampersad is not attending. Please confirm with the caterer by Wednesday.',
      fixture.expectations,
    );
    expect(failures).toEqual([]);
  });
});

describe('CLWX-115 fixture integrity (fail-closed structure)', () => {
  it('is structurally sound: overlapping names, a negated fact, a quantity, action tokens and all controls', () => {
    expect(validateFixtureShape(fixture)).toEqual([]);
    const firstNames = fixture.expectations.persons.map((p) => p.name.split(/\s+/)[0]);
    expect(new Set(firstNames).size).toBeLessThan(firstNames.length); // the two Keishas
  });

  it('carries every required mutation class as an expected-FAIL control', () => {
    const classes = new Set(fixture.cases.filter((c) => c.expected === 'FAIL').map((c) => c.mutationClass));
    for (const required of REQUIRED_MUTATION_CLASSES) expect(classes.has(required)).toBe(true);
  });

  it('evaluateFixture matches every authored expectation — controls FAIL, faithful PASSes', () => {
    const { ok, results } = evaluateFixture(fixture);
    expect(ok).toBe(true);
    expect(results.filter((r: { expected: string }) => r.expected === 'FAIL').length).toBeGreaterThanOrEqual(3);
  });

  it('a fixture stripped of its mutation controls is rejected as hollow, not accepted as green', () => {
    const hollow = JSON.parse(JSON.stringify(fixture)) as Fixture;
    hollow.cases = hollow.cases.filter((c) => c.expected === 'PASS');
    const problems = validateFixtureShape(hollow);
    expect(problems.some((p: string) => p.includes('mutation control'))).toBe(true);
    expect(evaluateFixture(hollow).ok).toBe(false);
  });
});

describe('CLWX-115 runner: fail-closed exits', () => {
  it('exits 0 on the shipped fixture and labels the evidence class', () => {
    const run = runRunner();
    expect(run.status).toBe(0);
    expect(run.out).toContain('NOT installed-agent fidelity');
    expect(run.out).toContain('does not close CLWX-115');
  });

  it('exits 1 when the fixture is missing (fail-closed, never a skip)', () => {
    const run = runRunner({ RAJ2_FIXTURE: path.join(tmpdir(), 'raj2-does-not-exist.json') });
    expect(run.status).toBe(1);
    expect(run.out).toContain('fail-closed');
  });

  it('exits 1 when a mutation control passes the checker — a weakened checker reds the gate', () => {
    // Simulate the weakened-checker shape from the fixture side: give the
    // swap control the FAITHFUL output. The checker now (correctly, from its
    // view) computes PASS where the fixture demands FAIL, which is exactly
    // what a gutted checker produces against the real swap text.
    const file = writeTempFixture((f) => {
      const control = f.cases.find((c) => c.id === 'swap-meal-association');
      if (!control) throw new Error('control missing');
      control.output = caseById('faithful').output;
    });
    const run = runRunner({ RAJ2_FIXTURE: file });
    expect(run.status).toBe(1);
    expect(run.out).toContain('MISMATCH swap-meal-association');
  });

  it('exits 1 when the fixture is hollow (controls stripped)', () => {
    const file = writeTempFixture((f) => {
      f.cases = f.cases.filter((c) => c.expected === 'PASS');
    });
    const run = runRunner({ RAJ2_FIXTURE: file });
    expect(run.status).toBe(1);
    expect(run.out).toContain('FIXTURE-CONTRACT FAIL');
  });
});

describe('CLWX-115 gate registration', () => {
  const gateSource = readFileSync(path.resolve('scripts/ga-gate.mjs'), 'utf8');

  it('a FAIL from the fixture row reds the gate in development, static and release modes', async () => {
    // The row is a plain non-optional T0 run(): pin that a FAIL propagates to a
    // nonzero exit through the SAME verdict module the gate imports, in every
    // mode — including static, where this row still executes (T0 has no skip
    // path), and release, where fails.length alone forces exit 1 even though
    // the criterion is not in RELEASE_REQUIRED_CRITERIA.
    const { scorecard, classifyRow } = await import('../../scripts/ga-gate-verdict.mjs');
    expect(classifyRow({ exitCode: 1, laneContract: false })).toBe('FAIL'); // runner's fail-closed exit
    expect(classifyRow({ exitCode: 2, laneContract: false })).toBe('FAIL'); // no lane contract: 2 is not BLOCKED
    const rows = [
      { id: 'typecheck', tier: 'T0', box: 'hygiene', status: 'PASS', criteria: ['t0-typecheck'] },
      { id: 'raj2 association-fidelity fixture (CLWX-115)', tier: 'T0', box: 'ExtValA-fixture', status: 'FAIL', criteria: ['t0-raj2-association-fixture'] },
    ];
    expect(scorecard(rows, {}).exitCode).toBe(1);
    expect(scorecard(rows, { staticOnly: true }).exitCode).toBe(1);
    expect(scorecard(rows, { release: true }).exitCode).toBe(1);
    expect(scorecard(rows, {}).headline).toBe('RED');
  });

  it('ga-gate.mjs runs the fixture row at T0 with its own criterion id', () => {
    const call = gateSource
      .split(/\n(?=run\(|skip\()/)
      .find((chunk) => chunk.includes('raj2-association-fidelity-gate.mjs'));
    expect(call, 'the CLWX-115 fixture row is not wired into ga-gate.mjs').toBeTruthy();
    expect(call).toContain("run('raj2 association-fidelity fixture (CLWX-115)', 'T0'");
    expect(call).toContain("criteria: ['t0-raj2-association-fixture']");
  });

  it('the row is required and fail-closed: no optional flag, no laneContract, no skip() path', () => {
    const start = gateSource.indexOf("run('raj2 association-fidelity fixture (CLWX-115)'");
    expect(start).toBeGreaterThan(-1);
    const call = gateSource.slice(start, gateSource.indexOf(';', start) + 1);
    expect(call).not.toContain('optional: true');
    expect(call).not.toContain('laneContract');
    // No skip() branch may ever name this row: a fixture that cannot run must
    // FAIL the gate, not SKIP out of it (preserves CLWX-106 semantics).
    expect(gateSource).not.toMatch(/skip\([^)]*raj2/i);
  });
});
