// @vitest-environment node
//
// Mechanical contract test for .github/workflows/windows-installer-e2e.yml.
//
// We don't rely on yamllint (not installed / not enforced in CI). Instead we
// js-yaml the workflow file and assert the shape a reviewer or future edit
// could silently break: the dispatch inputs, the runner OS, that the steps
// are all named, and that at least one step uploads artifacts.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const WORKFLOW_PATH = path.join(
  REPO_ROOT,
  '.github',
  'workflows',
  'windows-installer-e2e.yml',
);

type Step = {
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  with?: Record<string, unknown>;
};
type Strategy = {
  'fail-fast'?: boolean;
  matrix?: Record<string, unknown>;
};
type Job = {
  'runs-on'?: string;
  steps?: Step[];
  strategy?: Strategy;
  needs?: string | string[];
  if?: string;
};
type Workflow = {
  on?: { workflow_dispatch?: { inputs?: Record<string, { required?: boolean; default?: string }> } };
  jobs?: Record<string, Job>;
};

function loadWorkflow(): Workflow {
  const raw = readFileSync(WORKFLOW_PATH, 'utf8');
  return yaml.load(raw) as Workflow;
}

describe('.github/workflows/windows-installer-e2e.yml — dispatch contract', () => {
  it('parses as YAML', () => {
    expect(() => loadWorkflow()).not.toThrow();
  });

  it('installer_url dispatch input is required', () => {
    const wf = loadWorkflow();
    const inputs = wf.on?.workflow_dispatch?.inputs;
    expect(inputs).toBeDefined();
    expect(inputs?.installer_url?.required).toBe(true);
  });

  it('harness_prompts_ref dispatch input defaults to "main"', () => {
    const wf = loadWorkflow();
    const inputs = wf.on?.workflow_dispatch?.inputs;
    expect(inputs?.harness_prompts_ref?.default).toBe('main');
  });

  it('the installer-e2e matrix job runs on windows-latest', () => {
    const wf = loadWorkflow();
    const jobs = wf.jobs ?? {};
    // The matrix job is the one that installs + runs the harness against
    // the .exe; it MUST be windows-latest. Aggregation jobs (consolidated
    // summary etc.) can run on any linux runner — they only download
    // artifacts and emit markdown.
    const matrixJob = Object.values(jobs).find((j) => j.strategy?.matrix);
    expect(matrixJob).toBeDefined();
    expect(matrixJob?.['runs-on']).toBe('windows-latest');
  });

  it('has at least 8 named steps across all jobs', () => {
    const wf = loadWorkflow();
    const steps = Object.values(wf.jobs ?? {}).flatMap((j) => j.steps ?? []);
    const named = steps.filter((s) => typeof s.name === 'string' && s.name.trim().length > 0);
    expect(named.length).toBeGreaterThanOrEqual(8);
    expect(named.length).toBe(steps.length);
  });

  it('has at least one step that uploads an artifact via actions/upload-artifact', () => {
    const wf = loadWorkflow();
    const steps = Object.values(wf.jobs ?? {}).flatMap((j) => j.steps ?? []);
    const uploaders = steps.filter(
      (s) => typeof s.uses === 'string' && s.uses.startsWith('actions/upload-artifact@'),
    );
    expect(uploaders.length).toBeGreaterThanOrEqual(1);
    for (const s of uploaders) {
      expect(s.with).toBeDefined();
      expect(typeof (s.with as Record<string, unknown>).name).toBe('string');
    }
  });
});

describe('.github/workflows/windows-installer-e2e.yml — post-run steps (always-guarded)', () => {
  it('has the 3 post-run steps: failure-category summary, JUnit upload, screenshot upload', () => {
    const wf = loadWorkflow();
    const steps = Object.values(wf.jobs ?? {}).flatMap((j) => j.steps ?? []);
    const names = steps.map((s) => s.name ?? '');
    // Case-insensitive substring match so a future rename that keeps the
    // intent (e.g. "Summarize" vs "Summarise") still passes.
    const has = (needle: string) =>
      names.some((n) => n.toLowerCase().includes(needle.toLowerCase()));
    expect(has('failure_category')).toBe(true);
    expect(has('Upload harness-junit')).toBe(true);
    expect(has('screenshot')).toBe(true);
  });

  it('all 3 post-run steps are guarded by if: always()', () => {
    const wf = loadWorkflow();
    const steps = Object.values(wf.jobs ?? {}).flatMap((j) => j.steps ?? []);
    const postRun = steps.filter((s) => {
      const n = (s.name ?? '').toLowerCase();
      return (
        n.includes('failure_category') ||
        n.includes('upload harness-junit') ||
        n.includes('screenshot')
      );
    });
    // Sanity: caught all three (summary + JUnit upload + collect + upload
    // screenshots = 4 in the current shape). Assert >=3 so a future
    // reshuffle that keeps the same intent survives.
    expect(postRun.length).toBeGreaterThanOrEqual(3);
    for (const s of postRun) {
      expect(s.if).toBe('always()');
    }
  });

  it('every actions/upload-artifact step sets retention-days', () => {
    const wf = loadWorkflow();
    const steps = Object.values(wf.jobs ?? {}).flatMap((j) => j.steps ?? []);
    const uploaders = steps.filter(
      (s) => typeof s.uses === 'string' && s.uses.startsWith('actions/upload-artifact@'),
    );
    expect(uploaders.length).toBeGreaterThanOrEqual(2);
    for (const s of uploaders) {
      const w = s.with as Record<string, unknown> | undefined;
      expect(w).toBeDefined();
      const retention = w?.['retention-days'];
      expect(typeof retention).toBe('number');
      expect(retention).toBe(14);
    }
  });
});

describe('.github/workflows/windows-installer-e2e.yml — matrix runner', () => {
  it('strategy.matrix.installer_version has >=3 entries', () => {
    const wf = loadWorkflow();
    const matrixJobs = Object.values(wf.jobs ?? {}).filter((j) => j.strategy?.matrix);
    expect(matrixJobs.length).toBeGreaterThanOrEqual(1);
    for (const job of matrixJobs) {
      const versions = job.strategy?.matrix?.installer_version;
      expect(Array.isArray(versions)).toBe(true);
      expect((versions as unknown[]).length).toBeGreaterThanOrEqual(3);
    }
  });

  it('fail-fast: false is set on every matrix job (so one version breaking does not cancel the others)', () => {
    const wf = loadWorkflow();
    const matrixJobs = Object.values(wf.jobs ?? {}).filter((j) => j.strategy?.matrix);
    expect(matrixJobs.length).toBeGreaterThanOrEqual(1);
    for (const job of matrixJobs) {
      expect(job.strategy?.['fail-fast']).toBe(false);
    }
  });

  it('every actions/upload-artifact name is keyed by matrix.installer_version', () => {
    const wf = loadWorkflow();
    const steps = Object.values(wf.jobs ?? {}).flatMap((j) => j.steps ?? []);
    const uploaders = steps.filter(
      (s) => typeof s.uses === 'string' && s.uses.startsWith('actions/upload-artifact@'),
    );
    expect(uploaders.length).toBeGreaterThanOrEqual(2);
    for (const s of uploaders) {
      const name = (s.with as Record<string, unknown> | undefined)?.name;
      expect(typeof name).toBe('string');
      expect(name as string).toMatch(/\$\{\{\s*matrix\.installer_version\s*\}\}/);
    }
  });
});

describe('.github/workflows/windows-installer-e2e.yml — consolidated summary', () => {
  function findConsolidatedJob() {
    const wf = loadWorkflow();
    const jobs = wf.jobs ?? {};
    // Pick the job that has needs: on the matrix job and does not have a
    // matrix strategy of its own — that's the aggregation job.
    const matrixJobIds = Object.entries(jobs)
      .filter(([, j]) => j.strategy?.matrix)
      .map(([id]) => id);
    return Object.entries(jobs).find(([, j]) => {
      if (j.strategy?.matrix) return false;
      const needs = Array.isArray(j.needs) ? j.needs : j.needs ? [j.needs] : [];
      return matrixJobIds.some((id) => needs.includes(id));
    });
  }

  it('consolidated-summary job exists (a non-matrix job that needs the matrix job)', () => {
    const entry = findConsolidatedJob();
    expect(entry).toBeDefined();
    const [id] = entry!;
    expect(typeof id).toBe('string');
  });

  it('needs: array includes the matrix installer-e2e job', () => {
    const wf = loadWorkflow();
    const jobs = wf.jobs ?? {};
    const matrixJobIds = Object.entries(jobs)
      .filter(([, j]) => j.strategy?.matrix)
      .map(([id]) => id);
    expect(matrixJobIds.length).toBeGreaterThanOrEqual(1);
    const entry = findConsolidatedJob();
    expect(entry).toBeDefined();
    const [, job] = entry!;
    const needs = Array.isArray(job.needs) ? job.needs : job.needs ? [job.needs] : [];
    for (const matrixId of matrixJobIds) {
      expect(needs).toContain(matrixId);
    }
  });

  it('job-level if: always() is set on the consolidated-summary job', () => {
    const entry = findConsolidatedJob();
    expect(entry).toBeDefined();
    const [, job] = entry!;
    expect(job.if).toBe('always()');
  });

  it('downloads all 3 matrix artifact names (harness-junit-{nightly,stable,previous})', () => {
    const entry = findConsolidatedJob();
    expect(entry).toBeDefined();
    const [, job] = entry!;
    const downloadSteps = (job.steps ?? []).filter(
      (s) => typeof s.uses === 'string' && s.uses.startsWith('actions/download-artifact@'),
    );
    const downloadedNames = downloadSteps
      .map((s) => (s.with as Record<string, unknown> | undefined)?.name)
      .filter((n): n is string => typeof n === 'string');
    for (const v of ['nightly', 'stable', 'previous']) {
      expect(downloadedNames).toContain(`harness-junit-${v}`);
    }
  });

  it('dedup step exists, is guarded by if: always(), and runs after the 3 downloads', () => {
    const entry = findConsolidatedJob();
    expect(entry).toBeDefined();
    const [, job] = entry!;
    const steps = job.steps ?? [];
    const dedupIdx = steps.findIndex((s) =>
      (s.name ?? '').toLowerCase().includes('dedup'),
    );
    expect(dedupIdx).toBeGreaterThanOrEqual(0);
    const dedupStep = steps[dedupIdx];
    expect(dedupStep.if).toBe('always()');
    // Must come after all three download steps.
    const lastDownloadIdx = steps.reduce(
      (acc, s, i) =>
        typeof s.uses === 'string' && s.uses.startsWith('actions/download-artifact@')
          ? i
          : acc,
      -1,
    );
    expect(lastDownloadIdx).toBeGreaterThanOrEqual(0);
    expect(dedupIdx).toBeGreaterThan(lastDownloadIdx);
  });
});

// @ts-expect-error — .mjs sibling with no bundled .d.ts
import { dedupFailureCategories } from '../../harness/src/failure-dedup.mjs';

function junitWithCategories(cats: string[]): string {
  const props = cats
    .map(
      (c) =>
        `        <property name="failure_category" value="${c}" />`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="x" tests="1" failures="${cats.length}" skipped="0">
    <testcase name="t1" classname="x" time="0.1">
      <failure message="m" type="AssertionError">boom</failure>
      <properties>
${props}
      </properties>
    </testcase>
  </testsuite>
</testsuites>`;
}

describe('harness/src/failure-dedup.mjs — REGRESSION SUSPECT logic', () => {
  it('overlap-2-versions: category in 2 of 3 legs -> flagged as suspect', () => {
    const legs = [
      { version: 'nightly', xml: junitWithCategories(['timeout']) },
      { version: 'stable', xml: junitWithCategories(['timeout']) },
      { version: 'previous', xml: junitWithCategories(['schema_violation']) },
    ];
    const { suspects, perVersionOnly, markdown } = dedupFailureCategories(legs);
    expect(suspects).toHaveLength(1);
    expect(suspects[0].category).toBe('timeout');
    expect(suspects[0].versions.sort()).toEqual(['nightly', 'stable']);
    expect(perVersionOnly.map((p: { category: string }) => p.category)).toEqual([
      'schema_violation',
    ]);
    expect(markdown).toMatch(/REGRESSION SUSPECT/);
    expect(markdown).toMatch(/`timeout`/);
    expect(markdown).toMatch(/`nightly`/);
    expect(markdown).toMatch(/`stable`/);
  });

  it('overlap-3-versions: category in all 3 legs -> flagged with all 3 versions', () => {
    const legs = [
      { version: 'nightly', xml: junitWithCategories(['missing_output']) },
      { version: 'stable', xml: junitWithCategories(['missing_output']) },
      { version: 'previous', xml: junitWithCategories(['missing_output']) },
    ];
    const { suspects, perVersionOnly, markdown } = dedupFailureCategories(legs);
    expect(suspects).toHaveLength(1);
    expect(suspects[0].category).toBe('missing_output');
    expect(suspects[0].versions.sort()).toEqual(['nightly', 'previous', 'stable']);
    expect(perVersionOnly).toHaveLength(0);
    expect(markdown).toMatch(/REGRESSION SUSPECT/);
    expect(markdown).toMatch(/`missing_output`/);
    for (const v of ['nightly', 'stable', 'previous']) {
      expect(markdown).toContain(`\`${v}\``);
    }
  });

  it('no-overlap: every category confined to one version -> per-version-only note', () => {
    const legs = [
      { version: 'nightly', xml: junitWithCategories(['timeout']) },
      { version: 'stable', xml: junitWithCategories(['schema_violation']) },
      { version: 'previous', xml: junitWithCategories(['missing_output']) },
    ];
    const { suspects, perVersionOnly, markdown } = dedupFailureCategories(legs);
    expect(suspects).toHaveLength(0);
    expect(perVersionOnly).toHaveLength(3);
    expect(markdown).not.toMatch(/REGRESSION SUSPECT/);
    expect(markdown).toMatch(/per-version-only/);
  });
});

// @ts-expect-error — .mjs sibling with no bundled .d.ts
import { buildPerTestcaseTable } from '../../harness/src/per-testcase-table.mjs';

/**
 * Build a JUnit XML fixture with an all-pass suite of `passCount` cases
 * (each self-closing), matching the shape renderJUnitXml emits for
 * passing rows.
 */
function junitAllPass(passCount: number, suiteTs = '2026-07-25T18:00:00Z'): string {
  const cases = Array.from({ length: passCount }, (_, i) =>
    `    <testcase name="P${i + 1}" classname="clawx.harness" time="0.100"/>`,
  ).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites tests="${passCount}" failures="0" skipped="0">
  <testsuite name="clawx.harness" tests="${passCount}" failures="0" skipped="0" timestamp="${suiteTs}">
${cases}
  </testsuite>
</testsuites>`;
}

/**
 * Build a JUnit XML fixture with mixed pass + fail rows. Each failing
 * row carries a per-testcase timestamp attribute and a failure_category
 * property, matching the shape harness/run.ts + PR #16 emit.
 */
function junitWithFailures(
  totalTests: number,
  failures: Array<{ name: string; category: string; timestamp: string }>,
  suiteTs = '2026-07-25T18:00:00Z',
): string {
  const passCount = totalTests - failures.length;
  const passCases = Array.from({ length: passCount }, (_, i) =>
    `    <testcase name="OK${i + 1}" classname="clawx.harness" time="0.100"/>`,
  ).join('\n');
  const failCases = failures
    .map(
      (f) =>
        `    <testcase name="${f.name}" classname="clawx.harness" time="0.500" timestamp="${f.timestamp}"><properties><property name="failure_category" value="${f.category}"/></properties><failure message="boom" type="AssertionError"><![CDATA[detail]]></failure></testcase>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites tests="${totalTests}" failures="${failures.length}" skipped="0">
  <testsuite name="clawx.harness" tests="${totalTests}" failures="${failures.length}" skipped="0" timestamp="${suiteTs}">
${passCases}
${failCases}
  </testsuite>
</testsuites>`;
}

describe('harness/src/per-testcase-table.mjs — per-testcase failure table', () => {
  it('all-pass across all 3 legs -> single-line all-passed message (0 failures)', () => {
    // 197 total: 66 + 66 + 65 to mirror the real 197-testcase corpus
    // the workflow is graded against.
    const legs = [
      { version: 'nightly', xml: junitAllPass(66) },
      { version: 'stable', xml: junitAllPass(66) },
      { version: 'previous', xml: junitAllPass(65) },
    ];
    const { rows, totalTests, allPassed, markdown } = buildPerTestcaseTable(legs);
    expect(rows).toHaveLength(0);
    expect(totalTests).toBe(197);
    expect(allPassed).toBe(true);
    // Locked message shape — reviewers scan for this exact sentence on
    // every green run.
    expect(markdown).toContain(
      'All 197 testcases passed across all 3 installer_versions.',
    );
    // No table pipe-header should render when all-passed.
    expect(markdown).not.toMatch(/\|\s*test_name\s*\|/);
  });

  it('3-versions × 2-failures each, dedup of same failure_category -> sorted 6-row table', () => {
    // Each leg has the SAME two failure categories on the SAME two test
    // names — but they're distinct testcase rows per leg. The table
    // must render all 6 rows (one per (test_name, installer_version)
    // combination); "dedup" applies to failure_category counts in the
    // suspect callout, NOT to per-testcase rows.
    const legs = [
      {
        version: 'nightly',
        xml: junitWithFailures(
          10,
          [
            { name: 'P1-docx-summarize', category: 'timeout', timestamp: '2026-07-25T18:01:00Z' },
            { name: 'P2-xlsx-total', category: 'schema_violation', timestamp: '2026-07-25T18:02:00Z' },
          ],
          '2026-07-25T18:00:00Z',
        ),
      },
      {
        version: 'stable',
        xml: junitWithFailures(
          10,
          [
            { name: 'P1-docx-summarize', category: 'timeout', timestamp: '2026-07-25T19:01:00Z' },
            { name: 'P2-xlsx-total', category: 'schema_violation', timestamp: '2026-07-25T19:02:00Z' },
          ],
          '2026-07-25T19:00:00Z',
        ),
      },
      {
        version: 'previous',
        xml: junitWithFailures(
          10,
          [
            { name: 'P1-docx-summarize', category: 'timeout', timestamp: '2026-07-25T20:01:00Z' },
            { name: 'P2-xlsx-total', category: 'schema_violation', timestamp: '2026-07-25T20:02:00Z' },
          ],
          '2026-07-25T20:00:00Z',
        ),
      },
    ];
    const { rows, allPassed, markdown } = buildPerTestcaseTable(legs);
    expect(allPassed).toBe(false);
    expect(rows).toHaveLength(6);
    // Sort key: (failure_category asc, test_name asc). Both P1 and P2
    // rows keep their per-version identity — 3 x schema_violation
    // BEFORE 3 x timeout (schema_violation < timeout lexicographically).
    const catSeq = rows.map((r: { failure_category: string }) => r.failure_category);
    expect(catSeq).toEqual([
      'schema_violation',
      'schema_violation',
      'schema_violation',
      'timeout',
      'timeout',
      'timeout',
    ]);
    // Every row must carry the correct testcase timestamp from JUnit
    // — the sort must not corrupt this. schema_violation is P2 across
    // all 3 legs; timeout is P1.
    const schemaRows = rows.filter(
      (r: { failure_category: string }) => r.failure_category === 'schema_violation',
    );
    expect(schemaRows.every((r: { test_name: string }) => r.test_name === 'P2-xlsx-total')).toBe(true);
    const timeoutRows = rows.filter(
      (r: { failure_category: string }) => r.failure_category === 'timeout',
    );
    expect(timeoutRows.every((r: { test_name: string }) => r.test_name === 'P1-docx-summarize')).toBe(true);
    // Markdown carries the required header row + 6 body rows.
    const bodyRows = markdown
      .split('\n')
      .filter((l: string) => l.startsWith('|') && !l.startsWith('| ---') && !l.includes('test_name'));
    expect(bodyRows).toHaveLength(6);
    expect(markdown).toContain(
      '| test_name | installer_version | failure_category | owner | flake_rate | first_failure_ts_from_junit |',
    );
    // Every distinct per-testcase timestamp survives into the output.
    for (const ts of [
      '2026-07-25T18:01:00Z',
      '2026-07-25T18:02:00Z',
      '2026-07-25T19:01:00Z',
      '2026-07-25T19:02:00Z',
      '2026-07-25T20:01:00Z',
      '2026-07-25T20:02:00Z',
    ]) {
      expect(markdown).toContain(ts);
    }
  });

  it('mixed unique + shared failure_categories -> sort order (category asc, test_name asc) preserved', () => {
    // 5 failures spanning 3 categories: two share `timeout` on distinct
    // test names (D-doc + A-alpha); one row per each of
    // `schema_violation` and `missing_output` and `zzz_last`. Correct
    // sort must group by category asc, then test_name asc within each
    // group.
    const legs = [
      {
        version: 'nightly',
        xml: junitWithFailures(
          10,
          [
            { name: 'D-doc-summarize', category: 'timeout', timestamp: '2026-07-25T10:01:00Z' },
            { name: 'A-alpha-extract', category: 'timeout', timestamp: '2026-07-25T10:02:00Z' },
            { name: 'M-missing', category: 'missing_output', timestamp: '2026-07-25T10:03:00Z' },
          ],
          '2026-07-25T10:00:00Z',
        ),
      },
      {
        version: 'stable',
        xml: junitWithFailures(
          10,
          [
            { name: 'S-schema-bad', category: 'schema_violation', timestamp: '2026-07-25T11:01:00Z' },
          ],
          '2026-07-25T11:00:00Z',
        ),
      },
      {
        version: 'previous',
        xml: junitWithFailures(
          10,
          [
            { name: 'Z-last-row', category: 'zzz_last', timestamp: '2026-07-25T12:01:00Z' },
          ],
          '2026-07-25T12:00:00Z',
        ),
      },
    ];
    const { rows, allPassed } = buildPerTestcaseTable(legs);
    expect(allPassed).toBe(false);
    expect(rows).toHaveLength(5);
    // Expected order:
    //   1. missing_output   / M-missing        / nightly
    //   2. schema_violation / S-schema-bad     / stable
    //   3. timeout          / A-alpha-extract  / nightly
    //   4. timeout          / D-doc-summarize  / nightly
    //   5. zzz_last         / Z-last-row       / previous
    expect(rows.map((r: { failure_category: string }) => r.failure_category)).toEqual([
      'missing_output',
      'schema_violation',
      'timeout',
      'timeout',
      'zzz_last',
    ]);
    expect(rows.map((r: { test_name: string }) => r.test_name)).toEqual([
      'M-missing',
      'S-schema-bad',
      'A-alpha-extract',
      'D-doc-summarize',
      'Z-last-row',
    ]);
    expect(rows.map((r: { installer_version: string }) => r.installer_version)).toEqual([
      'nightly',
      'stable',
      'nightly',
      'nightly',
      'previous',
    ]);
    // Timestamps come from the per-testcase attribute, NOT the suite
    // attribute — proves the parser reads the right field.
    expect(rows[0].first_failure_ts_from_junit).toBe('2026-07-25T10:03:00Z');
    expect(rows[1].first_failure_ts_from_junit).toBe('2026-07-25T11:01:00Z');
    expect(rows[4].first_failure_ts_from_junit).toBe('2026-07-25T12:01:00Z');
  });
});

// @ts-expect-error — .mjs sibling with no bundled .d.ts
import {
  DEFAULT_OWNER,
  parseCodeowners,
  parseOwnersJson,
  resolveOwner,
} from '../../harness/src/testcase-owners.mjs';

describe('harness/src/testcase-owners.mjs — test-code-owner routing', () => {
  it('CODEOWNERS match: failing testcase resolves to the mapped @team handle', () => {
    // Realistic CODEOWNERS shape. `P1-*` maps docx tests to @clawx-docs
    // via a directory glob — testcase names are matched against the
    // classname-derived path the workflow feeds in.
    const codeownersRules = parseCodeowners(
      [
        '# CODEOWNERS — first line is a comment, must be ignored',
        '',
        'P1-docx-*   @clawx-docs',
        'P4-forms-*  @clawx-forms  @clawx-web',
        '/harness/tests/**  @clawx-harness',
      ].join('\n'),
    );
    // Testcase-name direct match on the P1-docx-* pattern.
    expect(
      resolveOwner('P1-docx-summarize', { codeownersRules }),
    ).toBe('@clawx-docs');
    // Multi-owner rule returns the first handle (GitHub semantics for
    // "primary owner"), and matches the P4-forms-* rule.
    expect(
      resolveOwner('P4-forms-suspensions', { codeownersRules }),
    ).toBe('@clawx-forms');
    // Full-path match (leading `/`) works too — for classname-derived
    // paths a test may hand in.
    expect(
      resolveOwner('harness/tests/unit-x', { codeownersRules }),
    ).toBe('@clawx-harness');
  });

  it('fallback: no CODEOWNERS/OWNERS.json match -> @clawx-triage default', () => {
    // Realistic case: a new testcase lands before its owner rule is
    // added. Reviewer must still see SOMEONE in the OWNERS column.
    const codeownersRules = parseCodeowners(
      ['P1-docx-*   @clawx-docs'].join('\n'),
    );
    const ownersJsonRules = parseOwnersJson(
      JSON.stringify({ 'P4-forms-suspensions': '@clawx-forms' }),
    );
    // Unmapped testcase — falls through both sources.
    expect(
      resolveOwner('P99-brand-new-test', { codeownersRules, ownersJsonRules }),
    ).toBe('@clawx-triage');
    // Confirm the exported constant is the same value the workflow
    // renders on unowned rows.
    expect(DEFAULT_OWNER).toBe('@clawx-triage');
    // With NO sources loaded at all, every testcase falls to the
    // default — a repo with neither file still renders a valid table.
    expect(resolveOwner('anything', {})).toBe('@clawx-triage');
  });

  it('OWNERS.json wins over CODEOWNERS when both exist', () => {
    // CODEOWNERS routes P1-docx-* to @clawx-docs (the coarse default).
    // OWNERS.json intentionally overrides one specific testcase to
    // @clawx-oncall — a per-test escape hatch for hot regressions.
    const codeownersRules = parseCodeowners(
      ['P1-docx-*   @clawx-docs'].join('\n'),
    );
    const ownersJsonRules = parseOwnersJson(
      JSON.stringify({
        'P1-docx-summarize': '@clawx-oncall',
        'P2-*': '@clawx-xlsx',
      }),
    );
    // Exact key in OWNERS.json wins over CODEOWNERS glob.
    expect(
      resolveOwner('P1-docx-summarize', { ownersJsonRules, codeownersRules }),
    ).toBe('@clawx-oncall');
    // Prefix key in OWNERS.json wins over CODEOWNERS glob.
    expect(
      resolveOwner('P2-xlsx-total', { ownersJsonRules, codeownersRules }),
    ).toBe('@clawx-xlsx');
    // Testcase NOT in OWNERS.json falls through to CODEOWNERS.
    expect(
      resolveOwner('P1-docx-otherpath', { ownersJsonRules, codeownersRules }),
    ).toBe('@clawx-docs');
    // And per-testcase-table.mjs threads the owner column through.
    const legs = [
      {
        version: 'nightly',
        xml: junitWithFailures(
          5,
          [
            {
              name: 'P1-docx-summarize',
              category: 'timeout',
              timestamp: '2026-07-25T18:01:00Z',
            },
          ],
          '2026-07-25T18:00:00Z',
        ),
      },
      { version: 'stable', xml: junitAllPass(5) },
      { version: 'previous', xml: junitAllPass(5) },
    ];
    const { rows, markdown } = buildPerTestcaseTable(legs, {
      ownersJsonRules,
      codeownersRules,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].owner).toBe('@clawx-oncall');
    // OWNERS column lands between failure_category and first_failure_ts.
    expect(markdown).toContain(
      '| test_name | installer_version | failure_category | owner | flake_rate | first_failure_ts_from_junit |',
    );
    // No historyJunits passed here — flake_rate defaults to 0.00 and
    // no [known-flaky] prefix is applied.
    expect(markdown).toContain(
      '| P1-docx-summarize | nightly | timeout | @clawx-oncall | 0.00 | 2026-07-25T18:01:00Z |',
    );
  });
});

// @ts-expect-error — .mjs sibling with no bundled .d.ts
import {
  DEFAULT_FLAKE_THRESHOLD,
  DEFAULT_FLAKE_WINDOW,
  analyzeFlakeRate,
} from '../../harness/src/flake-analyzer.mjs';

/**
 * Build a JUnit XML fixture containing exactly one failure row for
 * `testName` if `failing` is true, otherwise a pass row. Shape matches
 * harness/run.ts renderJUnitXml — same as junitWithFailures above but
 * scoped to a single testcase so we can drive analyzeFlakeRate.
 */
function junitHistoryEntry(testName: string, failing: boolean): string {
  const passOrFailBody = failing
    ? `    <testcase name="${testName}" classname="clawx.harness" time="0.500" timestamp="2026-07-24T00:00:00Z"><properties><property name="failure_category" value="timeout"/></properties><failure message="boom" type="AssertionError"><![CDATA[detail]]></failure></testcase>`
    : `    <testcase name="${testName}" classname="clawx.harness" time="0.100"/>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites tests="1" failures="${failing ? 1 : 0}" skipped="0">
  <testsuite name="clawx.harness" tests="1" failures="${failing ? 1 : 0}" skipped="0" timestamp="2026-07-24T00:00:00Z">
${passOrFailBody}
  </testsuite>
</testsuites>`;
}

describe('harness/src/flake-analyzer.mjs — SLA-based flake-suppression', () => {
  it('empty history -> flake_rate = 0 and no [known-flaky] prefix on any row', () => {
    // Repo with no history dir: analyzeFlakeRate([], ...) -> 0. And the
    // per-testcase-table pipeline degrades gracefully — flake_rate is 0
    // on every row, threshold 0.20 is never met.
    expect(analyzeFlakeRate([], 'P1-docx-summarize')).toBe(0);
    expect(analyzeFlakeRate([], 'anything')).toBe(0);
    // End-to-end: no historyJunits passed at all -> no prefix rendered.
    const legs = [
      {
        version: 'nightly',
        xml: junitWithFailures(
          5,
          [
            {
              name: 'P1-docx-summarize',
              category: 'timeout',
              timestamp: '2026-07-25T18:01:00Z',
            },
          ],
          '2026-07-25T18:00:00Z',
        ),
      },
      { version: 'stable', xml: junitAllPass(5) },
      { version: 'previous', xml: junitAllPass(5) },
    ];
    const { markdown } = buildPerTestcaseTable(legs);
    expect(markdown).not.toContain('[known-flaky]');
    // The flake_rate column renders "0.00" for every row on empty history.
    expect(markdown).toContain(' | 0.00 | 2026-07-25T18:01:00Z |');
    // Exported defaults are what the CLI wrapper reads from env.
    expect(DEFAULT_FLAKE_WINDOW).toBe(10);
    expect(DEFAULT_FLAKE_THRESHOLD).toBeCloseTo(0.2);
  });

  it('3-of-10 failing history -> flake_rate = 0.30 and row flagged as [known-flaky]', () => {
    // 10 historical runs, 3 of them failed the same testcase. That's
    // above the default 0.20 threshold, so the row must carry the
    // [known-flaky] prefix in the rendered markdown.
    const testName = 'P1-docx-summarize';
    const historyJunits = [
      junitHistoryEntry(testName, true),
      junitHistoryEntry(testName, true),
      junitHistoryEntry(testName, true),
      junitHistoryEntry(testName, false),
      junitHistoryEntry(testName, false),
      junitHistoryEntry(testName, false),
      junitHistoryEntry(testName, false),
      junitHistoryEntry(testName, false),
      junitHistoryEntry(testName, false),
      junitHistoryEntry(testName, false),
    ];
    expect(analyzeFlakeRate(historyJunits, testName)).toBeCloseTo(0.3);
    // End-to-end through the table renderer.
    const legs = [
      {
        version: 'nightly',
        xml: junitWithFailures(
          5,
          [
            { name: testName, category: 'timeout', timestamp: '2026-07-25T18:01:00Z' },
          ],
          '2026-07-25T18:00:00Z',
        ),
      },
      { version: 'stable', xml: junitAllPass(5) },
      { version: 'previous', xml: junitAllPass(5) },
    ];
    const { rows, markdown } = buildPerTestcaseTable(legs, { historyJunits });
    expect(rows).toHaveLength(1);
    expect(rows[0].flake_rate).toBeCloseTo(0.3);
    expect(markdown).toContain('[known-flaky] P1-docx-summarize');
    expect(markdown).toContain(' | 0.30 | 2026-07-25T18:01:00Z |');
  });

  it('1-of-10 failing history -> flake_rate = 0.10 and row NOT flagged (below 0.20 threshold)', () => {
    // 10 runs, 1 failure — below the default 0.20 threshold. No
    // [known-flaky] prefix; the reviewer sees this as a fresh regression,
    // not a repeat offender.
    const testName = 'P2-xlsx-total';
    const historyJunits = [
      junitHistoryEntry(testName, true),
      junitHistoryEntry(testName, false),
      junitHistoryEntry(testName, false),
      junitHistoryEntry(testName, false),
      junitHistoryEntry(testName, false),
      junitHistoryEntry(testName, false),
      junitHistoryEntry(testName, false),
      junitHistoryEntry(testName, false),
      junitHistoryEntry(testName, false),
      junitHistoryEntry(testName, false),
    ];
    expect(analyzeFlakeRate(historyJunits, testName)).toBeCloseTo(0.1);
    const legs = [
      {
        version: 'nightly',
        xml: junitWithFailures(
          5,
          [
            { name: testName, category: 'schema_violation', timestamp: '2026-07-25T18:01:00Z' },
          ],
          '2026-07-25T18:00:00Z',
        ),
      },
      { version: 'stable', xml: junitAllPass(5) },
      { version: 'previous', xml: junitAllPass(5) },
    ];
    const { rows, markdown } = buildPerTestcaseTable(legs, { historyJunits });
    expect(rows).toHaveLength(1);
    expect(rows[0].flake_rate).toBeCloseTo(0.1);
    expect(markdown).not.toContain('[known-flaky]');
    expect(markdown).toContain(' | 0.10 | 2026-07-25T18:01:00Z |');
    // A custom threshold under the row's flake_rate flips the prefix on.
    const { markdown: mkStrict } = buildPerTestcaseTable(legs, {
      historyJunits,
      flakeThreshold: 0.05,
    });
    expect(mkStrict).toContain('[known-flaky] P2-xlsx-total');
  });
});
