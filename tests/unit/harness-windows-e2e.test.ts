// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const RUNNER = path.join(REPO_ROOT, 'scripts', 'harness', 'run.mjs');
const SPEC = path.join(REPO_ROOT, 'scripts', 'harness', 'prompts.json');

describe('scripts/harness/run.mjs — 5-prompt Windows E2E scaffold', () => {
  it('spec has exactly the 5 prompts from Prompt Tests.docx', async () => {
    const raw = await readFile(SPEC, 'utf8');
    const prompts = JSON.parse(raw);
    expect(prompts).toHaveLength(5);
    expect(prompts.map((p: any) => p.id)).toEqual([
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
      // Only tools we actually expose from doc-tools.mjs.
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

  it('runs direct-mode against the seeded fixtures and PASSes all 5', () => {
    const res = spawnSync(
      process.execPath,
      [RUNNER],
      { cwd: REPO_ROOT, encoding: 'utf8', timeout: 60_000 },
    );
    expect(res.status).toBe(0);
    const combined = `${res.stdout}\n${res.stderr}`;
    expect(combined).toMatch(/\[PASS\] P1-docx-summarize/);
    expect(combined).toMatch(/\[PASS\] P2-docx-rewrite-save/);
    expect(combined).toMatch(/\[PASS\] P3-pdf-summarize/);
    expect(combined).toMatch(/\[PASS\] P4-xlsx-grade/);
    expect(combined).toMatch(/\[PASS\] P5-image-fields/);
    expect(combined).not.toMatch(/\[FAIL\]/);
  });

  it('binary mode SKIPs cleanly with exit 0 (does not red-fail CI)', () => {
    const res = spawnSync(
      process.execPath,
      [RUNNER, '--mode=binary'],
      { cwd: REPO_ROOT, encoding: 'utf8', timeout: 30_000 },
    );
    expect(res.status).toBe(0);
    const combined = `${res.stdout}\n${res.stderr}`;
    expect(combined).toMatch(/\[SKIP\] P1-docx-summarize/);
    expect(combined).toMatch(/binary mode not enabled/);
    expect(combined).not.toMatch(/\[FAIL\]/);
  });
});
