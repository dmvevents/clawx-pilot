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
type Job = { 'runs-on'?: string; steps?: Step[]; strategy?: Strategy };
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

  it('every job runs on windows-latest', () => {
    const wf = loadWorkflow();
    const jobs = wf.jobs ?? {};
    const jobNames = Object.keys(jobs);
    expect(jobNames.length).toBeGreaterThan(0);
    for (const name of jobNames) {
      expect(jobs[name]['runs-on']).toBe('windows-latest');
    }
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
    const jobs = Object.values(wf.jobs ?? {});
    expect(jobs.length).toBeGreaterThan(0);
    for (const job of jobs) {
      const versions = job.strategy?.matrix?.installer_version;
      expect(Array.isArray(versions)).toBe(true);
      expect((versions as unknown[]).length).toBeGreaterThanOrEqual(3);
    }
  });

  it('fail-fast: false is set on every matrix job (so one version breaking does not cancel the others)', () => {
    const wf = loadWorkflow();
    const jobs = Object.values(wf.jobs ?? {});
    for (const job of jobs) {
      expect(job.strategy).toBeDefined();
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
