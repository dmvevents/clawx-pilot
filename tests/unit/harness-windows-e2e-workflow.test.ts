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
