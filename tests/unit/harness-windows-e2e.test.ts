// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const RUNNER = path.join(REPO_ROOT, 'harness', 'run.ts');
const PROMPTS = path.join(REPO_ROOT, 'tests', 'e2e', 'prompts.json');
const GOLDEN_DIR = path.join(REPO_ROOT, 'tests', 'e2e', 'golden');
const require = createRequire(import.meta.url);
const TSX_CLI = path.join(path.dirname(require.resolve('tsx/package.json')), 'dist', 'cli.mjs');

type PromptSpec = { id: string; prompt: string; expect_calls_tool: string; expected_stdout_regex: string; timeout_ms: number };
type GoldenSpec = { id: string; tool_called: string; result_schema: object; assertions: object };

function runHarness(args: string[] = [], timeout = 60_000) {
  return spawnSync(process.execPath, [TSX_CLI, RUNNER, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout,
  });
}

describe('harness/run.ts — 5-prompt doc-tooling E2E', () => {
  it('spec has exactly the 5 prompts (P1..P5) from Prompt Tests.docx', async () => {
    const prompts = JSON.parse(await readFile(PROMPTS, 'utf8')) as PromptSpec[];
    expect(prompts).toHaveLength(5);
    expect(prompts.map((p) => p.id)).toEqual([
      'P1-docx-summarize',
      'P2-docx-rewrite-save',
      'P3-pdf-summarize',
      'P4-xlsx-grade',
      'P5-image-fields',
    ]);
    for (const p of prompts) {
      expect(typeof p.prompt).toBe('string');
      expect(typeof p.expect_calls_tool).toBe('string');
      expect(typeof p.expected_stdout_regex).toBe('string');
      expect(typeof p.timeout_ms).toBe('number');
      expect([
        'document.read_pdf',
        'document.read_docx',
        'document.write_docx',
        'document.read_xlsx',
        'document.write_xlsx',
        'document.read_image',
      ]).toContain(p.expect_calls_tool);
    }
  });

  it('golden dir has 5 files, one per prompt id, each carrying schema + assertions', async () => {
    const files = await readdir(GOLDEN_DIR);
    const jsons = files.filter((f) => f.endsWith('.json')).sort();
    expect(jsons).toEqual([
      'P1-docx-summarize.json',
      'P2-docx-rewrite-save.json',
      'P3-pdf-summarize.json',
      'P4-xlsx-grade.json',
      'P5-image-fields.json',
    ]);
    for (const f of jsons) {
      const golden = JSON.parse(await readFile(path.join(GOLDEN_DIR, f), 'utf8')) as GoldenSpec;
      expect(golden.id).toBe(f.replace(/\.json$/, ''));
      expect(typeof golden.tool_called).toBe('string');
      expect(typeof golden.result_schema).toBe('object');
      expect(typeof golden.assertions).toBe('object');
    }
  });

  it('runs direct-mode against seeded fixtures and PASSes all 5', () => {
    const res = runHarness([], 60_000);
    expect(res.status).toBe(0);
    const combined = `${res.stdout}\n${res.stderr}`;
    expect(combined).toMatch(/\[PASS\] P1-docx-summarize/);
    expect(combined).toMatch(/\[PASS\] P2-docx-rewrite-save/);
    expect(combined).toMatch(/\[PASS\] P3-pdf-summarize/);
    expect(combined).toMatch(/\[PASS\] P4-xlsx-grade/);
    expect(combined).toMatch(/\[PASS\] P5-image-fields/);
    expect(combined).not.toMatch(/\[FAIL\]/);
    // vitest per-test timeout must exceed the spawnSync child ceiling (60s) so a
    // slow cold `tsx` start under CPU contention (e.g. running inside the full
    // preflight suite) is not mis-flagged as a failure. Default 5s was too tight.
  }, 90_000);

  it('binary mode SKIPs cleanly with exit 0 (does not red-fail CI)', () => {
    const res = runHarness(['--mode=binary'], 30_000);
    expect(res.status).toBe(0);
    const combined = `${res.stdout}\n${res.stderr}`;
    expect(combined).toMatch(/\[SKIP\] P1-docx-summarize/);
    expect(combined).toMatch(/binary mode not enabled/);
    expect(combined).not.toMatch(/\[FAIL\]/);
  }, 45_000); // vitest ceiling above the 30s spawnSync child ceiling
});
