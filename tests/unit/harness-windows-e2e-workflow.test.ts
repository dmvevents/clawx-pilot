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

type Step = { name?: string; uses?: string; run?: string; with?: Record<string, unknown> };
type Job = { 'runs-on'?: string; steps?: Step[] };
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
