// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const RUNNER = path.join(REPO_ROOT, 'harness', 'run.ts');
const PROMPTS = path.join(REPO_ROOT, 'tests', 'e2e', 'prompts.json');
const GOLDEN_DIR = path.join(REPO_ROOT, 'tests', 'e2e', 'golden');
const CORPUS_DIR = path.join(REPO_ROOT, 'harness', 'fixtures');
const CORPUS_GOLDEN_DIR = path.join(REPO_ROOT, 'harness', 'golden');
const TSX = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx');

describe('harness/run.ts — 5-prompt doc-tooling E2E', () => {
  it('spec has exactly the 5 prompts (P1..P5) from Prompt Tests.docx', async () => {
    const prompts = JSON.parse(await readFile(PROMPTS, 'utf8'));
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
      const golden = JSON.parse(await readFile(path.join(GOLDEN_DIR, f), 'utf8'));
      expect(golden.id).toBe(f.replace(/\.json$/, ''));
      expect(typeof golden.tool_called).toBe('string');
      expect(typeof golden.result_schema).toBe('object');
      expect(typeof golden.assertions).toBe('object');
    }
  });

  it('runs direct-mode against seeded fixtures and PASSes all 10 (baseline + corpus expansion)', () => {
    const res = spawnSync(TSX, [RUNNER], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 90_000 });
    expect(res.status).toBe(0);
    const combined = `${res.stdout}\n${res.stderr}`;
    for (const id of [
      'P1-docx-summarize',
      'P2-docx-rewrite-save',
      'P3-pdf-summarize',
      'P4-xlsx-grade',
      'P5-image-fields',
      'P6-docx-multipage-header-footer',
      'P7-pdf-with-tables',
      'P8-markdown-docx-roundtrip',
      'P9-xlsx-to-pdf-export',
      'P10-empty-doc-edge',
    ]) {
      expect(combined).toMatch(new RegExp(`\\[PASS\\] ${id}`));
    }
    expect(combined).not.toMatch(/\[FAIL\]/);
    // Runner announces 10 prompts loaded (baseline 5 + corpus 5).
    expect(combined).toMatch(/prompts=10/);
  });

  it('corpus expansion has 5 fixtures P6..P10 with matching goldens', async () => {
    const fixtures = (await readdir(CORPUS_DIR)).filter((f) => f.endsWith('.json')).sort();
    const goldens = (await readdir(CORPUS_GOLDEN_DIR)).filter((f) => f.endsWith('.json')).sort();
    // Lexicographic sort places "P10" before "P6".."P9" — this is what
    // readdir + .sort() returns, and what the runner iterates in.
    expect(fixtures).toEqual([
      'P10-empty-doc-edge.json',
      'P6-docx-multipage-header-footer.json',
      'P7-pdf-with-tables.json',
      'P8-markdown-docx-roundtrip.json',
      'P9-xlsx-to-pdf-export.json',
    ]);
    expect(goldens).toEqual(fixtures);
    for (const f of fixtures) {
      const p = JSON.parse(await readFile(path.join(CORPUS_DIR, f), 'utf8'));
      const g = JSON.parse(await readFile(path.join(CORPUS_GOLDEN_DIR, f), 'utf8'));
      expect(p.id).toBe(f.replace(/\.json$/, ''));
      expect(g.id).toBe(p.id);
      expect(g.tool_called).toBe(p.expect_calls_tool);
      expect(typeof p.fixture.kind).toBe('string');
      expect(typeof p.timeout_ms).toBe('number');
    }
  });

  it('binary mode SKIPs cleanly with exit 0 (does not red-fail CI)', () => {
    const res = spawnSync(TSX, [RUNNER, '--mode=binary'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 30_000,
    });
    expect(res.status).toBe(0);
    const combined = `${res.stdout}\n${res.stderr}`;
    expect(combined).toMatch(/\[SKIP\] P1-docx-summarize/);
    expect(combined).toMatch(/binary mode not enabled/);
    expect(combined).not.toMatch(/\[FAIL\]/);
  });
});
