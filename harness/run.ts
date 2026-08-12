#!/usr/bin/env node
/**
 * harness/run.ts — 5-prompt doc-tooling E2E harness.
 *
 * Loads deterministic prompts from tests/e2e/prompts.json, seeds a
 * fixture per prompt, invokes the corresponding doc-tooling entrypoint
 * (extensions/moe-principal-assistant/doc-tools.mjs), asserts response
 * shape + doc-tool markers against the golden JSON in
 * tests/e2e/golden/<id>.json, and writes JUnit XML.
 *
 * Offline by design: no installer, no Electron app, no LLM roundtrip.
 * Proves the Lane A doc-tool implementations resolve their bundled deps
 * and produce a schema-conforming response on the target OS.
 *
 * Naming note (surfaced in PR #13): the incoming spec named markers
 * `create_doc / insert_paragraph / apply_style / export_pdf /
 * list_headings`. The Lane A tools this repo actually ships are
 * `document.read_pdf / read_docx / write_docx / read_xlsx / write_xlsx /
 * read_image`. This harness asserts on the shipped names; if the
 * checker prefers the abstract names, we add a thin alias layer in a
 * follow-up.
 *
 * Usage:
 *   pnpm harness:ci                       # runs this harness + JUnit
 *   pnpm harness:windows-e2e --junit …    # writes to a chosen path
 *   pnpm harness:windows-e2e --only P3-pdf-summarize
 *   pnpm harness:windows-e2e --mode=binary  # reserved; SKIPs (exit 0)
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const PROMPTS_PATH = path.join(REPO_ROOT, 'tests', 'e2e', 'prompts.json');
const GOLDEN_DIR = path.join(REPO_ROOT, 'tests', 'e2e', 'golden');
const DOC_TOOLS_PATH = path.join(
  REPO_ROOT,
  'extensions',
  'moe-principal-assistant',
  'doc-tools.mjs',
);

type Mode = 'direct' | 'binary';

interface Prompt {
  id: string;
  prompt: string;
  expect_calls_tool: string;
  expected_stdout_regex: string;
  timeout_ms: number;
  fixture: {
    kind: 'docx' | 'xlsx' | 'pdf' | 'png';
    name: string;
    seed_paragraphs?: string[];
    seed_rows?: unknown[][];
  };
  tool_args?: Record<string, unknown>;
  output_name?: string;
}

interface Golden {
  id: string;
  tool_called: string;
  result_schema: Record<string, string>;
  assertions: Record<string, unknown>;
}

interface RunResult {
  id: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  reason: string;
  detail: string;
  durationMs: number;
}

function parseArgs(argv: string[]): { mode: Mode; junit: string | null; filter: string | null } {
  const args: { mode: Mode; junit: string | null; filter: string | null } = {
    mode: 'direct',
    junit: null,
    filter: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--mode') args.mode = argv[++i] as Mode;
    else if (a.startsWith('--mode=')) args.mode = a.slice('--mode='.length) as Mode;
    else if (a === '--junit') args.junit = argv[++i];
    else if (a.startsWith('--junit=')) args.junit = a.slice('--junit='.length);
    else if (a === '--only') args.filter = argv[++i];
    else if (a.startsWith('--only=')) args.filter = a.slice('--only='.length);
  }
  return args;
}

async function loadPrompts(): Promise<Prompt[]> {
  return JSON.parse(await readFile(PROMPTS_PATH, 'utf8')) as Prompt[];
}

async function loadGolden(id: string): Promise<Golden> {
  return JSON.parse(await readFile(path.join(GOLDEN_DIR, `${id}.json`), 'utf8')) as Golden;
}

async function seedFixture(workDir: string, fixture: Prompt['fixture']): Promise<string> {
  const outPath = path.join(workDir, fixture.name);
  if (fixture.kind === 'docx') {
    const { Document, Packer, Paragraph } = await import('docx');
    const seed = fixture.seed_paragraphs ?? ['Harness fixture.'];
    const doc = new Document({
      sections: [
        {
          properties: {},
          children: seed.map((t) => new Paragraph({ text: String(t) })),
        },
      ],
    });
    await writeFile(outPath, await Packer.toBuffer(doc));
    return outPath;
  }
  if (fixture.kind === 'xlsx') {
    const xlsx = await import('xlsx');
    const wb = xlsx.utils.book_new();
    const rows = fixture.seed_rows ?? [['a', 'b'], [1, 2]];
    xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(rows as unknown[][]), 'Marks');
    const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    await writeFile(outPath, buf);
    return outPath;
  }
  if (fixture.kind === 'pdf') {
    const marker = 'HARNESS PDF: ICT Audit circular fixture.';
    const stream = `BT /F1 12 Tf 72 720 Td (${marker}) Tj ET`;
    const pdf = [
      '%PDF-1.4',
      '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
      '2 0 obj<</Type/Pages/Count 1/Kids [3 0 R]>>endobj',
      '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox [0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj',
      `4 0 obj<</Length ${stream.length}>>stream\n${stream}\nendstream endobj`,
      '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj',
      'xref',
      '0 6',
      '0000000000 65535 f',
      '0000000009 00000 n',
      '0000000052 00000 n',
      '0000000095 00000 n',
      '0000000180 00000 n',
      '0000000260 00000 n',
      'trailer<</Size 6/Root 1 0 R>>',
      'startxref',
      '320',
      '%%EOF',
    ].join('\n');
    await writeFile(outPath, pdf, 'binary');
    return outPath;
  }
  if (fixture.kind === 'png') {
    const png = Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c626001000000050001aaaaaa00000000049454e44ae426082',
      'hex',
    );
    await writeFile(outPath, png);
    return outPath;
  }
  throw new Error(`unknown fixture kind: ${(fixture as { kind: string }).kind}`);
}

interface DocTools {
  readPdf: (a: { path: string; maxChars?: number }) => Promise<Record<string, unknown>>;
  readDocx: (a: { path: string; format?: string }) => Promise<Record<string, unknown>>;
  writeDocx: (a: { path: string; title?: string; paragraphs: string[] }) => Promise<Record<string, unknown>>;
  readXlsx: (a: { path: string; sheet?: string; maxRows?: number }) => Promise<Record<string, unknown>>;
  writeXlsx: (a: { path: string; sheets: unknown[] }) => Promise<Record<string, unknown>>;
  readImage: (a: { path: string; maxDim?: number }) => Promise<Record<string, unknown>>;
}

async function loadDocTools(): Promise<DocTools> {
  return (await import(pathToFileURL(DOC_TOOLS_PATH).href)) as unknown as DocTools;
}

function checkSchema(result: Record<string, unknown>, schema: Record<string, string>): void {
  for (const [key, expected] of Object.entries(schema)) {
    if (!(key in result)) throw new Error(`schema: missing key "${key}"`);
    if (expected === 'any') continue;
    const actual = result[key];
    if (expected === 'array') {
      if (!Array.isArray(actual)) throw new Error(`schema: "${key}" expected array, got ${typeof actual}`);
      continue;
    }
    if (expected === 'object') {
      if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) {
        throw new Error(`schema: "${key}" expected object, got ${Array.isArray(actual) ? 'array' : typeof actual}`);
      }
      continue;
    }
    if (typeof actual !== expected) {
      throw new Error(`schema: "${key}" expected ${expected}, got ${typeof actual}`);
    }
  }
}

function checkAssertions(result: Record<string, unknown>, assertions: Record<string, unknown>): void {
  for (const [key, expected] of Object.entries(assertions)) {
    if (key === 'file_exists_at_path') {
      if (expected === true) {
        const p = String(result.path);
        if (!existsSync(p)) throw new Error(`assertion file_exists_at_path: ${p} missing`);
      }
      continue;
    }
    if (key.endsWith('_min')) {
      const field = key.slice(0, -'_min'.length);
      const actual = Number(result[field]);
      if (!Number.isFinite(actual) || actual < Number(expected)) {
        throw new Error(`assertion ${key}: ${field}=${actual} < ${expected}`);
      }
      continue;
    }
    if (key.endsWith('_max')) {
      const field = key.slice(0, -'_max'.length);
      const actual = Number(result[field]);
      if (!Number.isFinite(actual) || actual > Number(expected)) {
        throw new Error(`assertion ${key}: ${field}=${actual} > ${expected}`);
      }
      continue;
    }
    if (key.endsWith('_equals')) {
      const field = key.slice(0, -'_equals'.length);
      if (result[field] !== expected) {
        throw new Error(`assertion ${key}: ${field}=${JSON.stringify(result[field])} !== ${JSON.stringify(expected)}`);
      }
      continue;
    }
    if (key.endsWith('_matches')) {
      const field = key.slice(0, -'_matches'.length);
      const rx = new RegExp(String(expected));
      if (!rx.test(String(result[field] ?? ''))) {
        throw new Error(
          `assertion ${key}: /${String(expected)}/ !~ ${String(result[field] ?? '').slice(0, 120)}`,
        );
      }
      continue;
    }
  }
}

async function runDirect(prompt: Prompt, workDir: string): Promise<{ preview: string }> {
  const golden = await loadGolden(prompt.id);
  if (golden.tool_called !== prompt.expect_calls_tool) {
    throw new Error(
      `golden/${prompt.id}.json tool_called="${golden.tool_called}" but prompt.expect_calls_tool="${prompt.expect_calls_tool}"`,
    );
  }
  const docTools = await loadDocTools();
  const fixturePath = await seedFixture(workDir, prompt.fixture);
  const args = { ...(prompt.tool_args ?? {}) };
  let result: Record<string, unknown>;
  switch (prompt.expect_calls_tool) {
    case 'document.read_docx':
      result = await docTools.readDocx({ path: fixturePath, ...(args as { format?: string }) });
      break;
    case 'document.write_docx': {
      const outPath = path.join(workDir, 'Output_Files', prompt.output_name ?? 'out.docx');
      result = await docTools.writeDocx({
        path: outPath,
        title: (args as { title?: string }).title,
        paragraphs: (args as { paragraphs: string[] }).paragraphs,
      });
      break;
    }
    case 'document.read_pdf':
      result = await docTools.readPdf({ path: fixturePath, ...(args as { maxChars?: number }) });
      break;
    case 'document.read_xlsx':
      result = await docTools.readXlsx({ path: fixturePath, ...(args as { sheet?: string; maxRows?: number }) });
      break;
    case 'document.write_xlsx': {
      const outPath = path.join(workDir, 'Output_Files', prompt.output_name ?? 'out.xlsx');
      result = await docTools.writeXlsx({
        path: outPath,
        sheets: (args as { sheets: unknown[] }).sheets,
      });
      break;
    }
    case 'document.read_image':
      result = await docTools.readImage({ path: fixturePath, ...(args as { maxDim?: number }) });
      break;
    default:
      throw new Error(`unsupported tool: ${prompt.expect_calls_tool}`);
  }
  checkSchema(result, golden.result_schema);
  checkAssertions(result, golden.assertions);
  const stdoutForPromptRegex = String(
    result.markdown ?? result.text ?? result.dataUrl ?? result.path ?? JSON.stringify(result),
  );
  const rx = new RegExp(prompt.expected_stdout_regex);
  if (!rx.test(stdoutForPromptRegex)) {
    throw new Error(
      `expected_stdout_regex /${prompt.expected_stdout_regex}/ !~ ${stdoutForPromptRegex.slice(0, 160)}`,
    );
  }
  const preview =
    typeof result.path === 'string'
      ? String(result.path)
      : stdoutForPromptRegex.slice(0, 100);
  return { preview };
}

async function runBinary(_p: Prompt, _w: string): Promise<never> {
  throw new Error('binary mode not enabled in scaffold — awaits installer URL follow-up');
}

function junitXml(results: RunResult[]): string {
  const total = results.length;
  const failures = results.filter((r) => r.status === 'FAIL').length;
  const skipped = results.filter((r) => r.status === 'SKIP').length;
  const escape = (s: string): string =>
    String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  const cases = results
    .map((r) => {
      const attrs = `name="${escape(r.id)}" classname="clawx.harness.doc-tooling-e2e" time="${(r.durationMs / 1000).toFixed(3)}"`;
      if (r.status === 'PASS') return `    <testcase ${attrs}/>`;
      if (r.status === 'SKIP')
        return `    <testcase ${attrs}><skipped message="${escape(r.reason)}"/></testcase>`;
      return `    <testcase ${attrs}><failure message="${escape(r.reason)}"><![CDATA[${r.detail}]]></failure></testcase>`;
    })
    .join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites tests="${total}" failures="${failures}" skipped="${skipped}">`,
    `  <testsuite name="clawx.harness.doc-tooling-e2e" tests="${total}" failures="${failures}" skipped="${skipped}">`,
    cases,
    '  </testsuite>',
    '</testsuites>',
    '',
  ].join('\n');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const prompts = await loadPrompts();
  const filtered = args.filter ? prompts.filter((p) => p.id === args.filter) : prompts;
  const workRoot = await mkdtemp(path.join(tmpdir(), 'clawx-harness-'));
  process.stdout.write(
    `clawx-harness: mode=${args.mode} spec=${PROMPTS_PATH} prompts=${filtered.length} work=${workRoot}\n`,
  );

  const results: RunResult[] = [];
  for (const p of filtered) {
    const promptWork = path.join(workRoot, p.id);
    await mkdir(promptWork, { recursive: true });
    const start = Date.now();
    let status: RunResult['status'] = 'PASS';
    let reason: string;
    let detail = '';
    try {
      const runner = args.mode === 'binary' ? runBinary : runDirect;
      const timeoutMs = p.timeout_ms ?? 30000;
      const run = runner(p, promptWork);
      const timeout = new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error(`timeout ${timeoutMs}ms`)), timeoutMs),
      );
      const out = await Promise.race([run, timeout]);
      reason = (out as { preview?: string }).preview ?? 'ok';
    } catch (err) {
      const e = err as Error;
      status =
        args.mode === 'binary' && /binary mode not enabled/.test(e.message) ? 'SKIP' : 'FAIL';
      reason = e.message.split('\n')[0].slice(0, 200);
      detail = e.stack ?? '';
    }
    results.push({ id: p.id, status, reason, detail, durationMs: Date.now() - start });
    process.stdout.write(
      `  [${status}] ${p.id.padEnd(24)} ${(Date.now() - start)}ms  ${reason.slice(0, 100)}\n`,
    );
  }

  if (args.junit) {
    const dest = path.resolve(args.junit);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, junitXml(results));
    process.stdout.write(`clawx-harness: wrote JUnit XML → ${dest}\n`);
  }

  try {
    await rm(workRoot, { recursive: true, force: true });
  } catch {
    // best effort
  }

  const failed = results.filter((r) => r.status === 'FAIL');
  if (failed.length) {
    process.stderr.write(`clawx-harness: ${failed.length} failure(s)\n`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`clawx-harness: fatal ${(err as Error).stack ?? (err as Error).message}\n`);
  process.exit(2);
});
