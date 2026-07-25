#!/usr/bin/env node
/**
 * 5-prompt Windows E2E harness.
 *
 * Exercises the six native document.* tools registered by the
 * moe-principal-assistant plugin (Lane A) against seeded fixtures.
 * The harness deliberately does NOT depend on the packaged desktop binary:
 *   - The ClawX gateway is out of scope for the runner (LLM tool-picking
 *     is verified separately by scripts/v2-chatbot-e2e.ts).
 *   - This harness proves the doc-tools *implementation* works on the
 *     target OS: identical code paths run in the Electron main / gateway
 *     runtime when the agent invokes them.
 *
 * Modes:
 *   direct  (default) — imports doc-tools.mjs and calls each handler with
 *                       the prompt's `tool_args`. Fast, deterministic,
 *                       proves the JS deps resolve on the runner.
 *   binary            — reserved. Once the installer zip lands on the
 *                       Windows VM, --mode=binary will spawn the installed
 *                       Electron app in headless CLI mode and feed prompts
 *                       to the running gateway. Skeleton present; enabled
 *                       via CLI flag so this scaffold PR is inert without
 *                       the installer.
 *
 * Output:
 *   - stdout: one line per prompt, PASS/FAIL/SKIP with a short reason.
 *   - --junit <path>: JUnit XML for CI ingestion.
 */

import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');

function parseArgs(argv) {
  const args = { mode: 'direct', junit: null, spec: null, filter: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--mode') args.mode = argv[++i];
    else if (a.startsWith('--mode=')) args.mode = a.slice('--mode='.length);
    else if (a === '--junit') args.junit = argv[++i];
    else if (a.startsWith('--junit=')) args.junit = a.slice('--junit='.length);
    else if (a === '--spec') args.spec = argv[++i];
    else if (a.startsWith('--spec=')) args.spec = a.slice('--spec='.length);
    else if (a === '--only') args.filter = argv[++i];
    else if (a.startsWith('--only=')) args.filter = a.slice('--only='.length);
  }
  return args;
}

async function loadSpec(customPath) {
  const file = customPath
    ? path.resolve(customPath)
    : path.join(__dirname, 'prompts.json');
  const raw = await readFile(file, 'utf8');
  return { specPath: file, prompts: JSON.parse(raw) };
}

async function seedFixture(workDir, fixture) {
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
    xlsx.utils.book_append_sheet(
      wb,
      xlsx.utils.aoa_to_sheet(rows),
      'Marks',
    );
    const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
    await writeFile(outPath, buf);
    return outPath;
  }
  if (fixture.kind === 'pdf') {
    // Minimal valid single-page PDF containing the marker text.
    // Hand-authored so the harness has no PDF-writing dep.
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
    // 1x1 transparent PNG — enough for read_image to return metadata + dataUrl.
    const png = Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c626001000000050001aaaaaa00000000049454e44ae426082',
      'hex',
    );
    await writeFile(outPath, png);
    return outPath;
  }
  throw new Error(`unknown fixture kind: ${fixture.kind}`);
}

async function runDirect(prompt, workDir) {
  const docTools = await import(
    pathToFileURL(
      path.join(REPO_ROOT, 'extensions', 'moe-principal-assistant', 'doc-tools.mjs'),
    ).href
  );
  const fixturePath = await seedFixture(workDir, prompt.fixture);
  const tool = prompt.expect_calls_tool;
  const args = { ...(prompt.tool_args ?? {}) };
  let stdout = '';
  let result;
  switch (tool) {
    case 'document.read_docx':
      result = await docTools.readDocx({ path: fixturePath, ...args });
      stdout = String(result.markdown ?? result.text ?? result.html ?? '');
      break;
    case 'document.write_docx': {
      const outPath = path.join(workDir, 'Output_Files', prompt.output_name);
      result = await docTools.writeDocx({ path: outPath, ...args });
      stdout = `wrote ${result.path} (${result.bytes} bytes)`;
      const st = await stat(result.path);
      if (!st.size) throw new Error('write_docx produced empty file');
      break;
    }
    case 'document.read_pdf':
      result = await docTools.readPdf({ path: fixturePath, ...args });
      stdout = String(result.text ?? '');
      break;
    case 'document.read_xlsx':
      result = await docTools.readXlsx({ path: fixturePath, ...args });
      stdout = JSON.stringify(result.rows);
      break;
    case 'document.write_xlsx': {
      const outPath = path.join(workDir, 'Output_Files', prompt.output_name);
      result = await docTools.writeXlsx({ path: outPath, ...args });
      stdout = `wrote ${result.path} (${result.bytes} bytes)`;
      const st = await stat(result.path);
      if (!st.size) throw new Error('write_xlsx produced empty file');
      break;
    }
    case 'document.read_image':
      result = await docTools.readImage({ path: fixturePath, ...args });
      stdout = String(result.dataUrl ?? '').slice(0, 200);
      break;
    default:
      throw new Error(`unsupported tool: ${tool}`);
  }
  const rx = new RegExp(prompt.expected_stdout_regex);
  if (!rx.test(stdout)) {
    throw new Error(
      `expected_stdout_regex /${prompt.expected_stdout_regex}/ did not match. stdout preview: ${stdout.slice(0, 160)}`,
    );
  }
  return { tool, stdoutPreview: stdout.slice(0, 160) };
}

async function runBinary(_prompt, _workDir) {
  // Skeleton for post-installer execution. The Windows workflow's harness
  // step only runs after `Run installer (silent, with logs)` succeeds, so
  // %LOCALAPPDATA%\Programs\Ministry of Education\Ministry of Education.exe
  // will exist on the runner. We DO NOT invoke it in this scaffold PR
  // because Anton has explicitly asked for maker != checker; the checker
  // will unblock --mode=binary in a follow-up once the installer URL is
  // wired and the gateway CLI harness lands.
  throw new Error(
    'binary mode not enabled in scaffold — awaiting installer URL and gateway-CLI harness follow-up',
  );
}

function junitXml(results) {
  const total = results.length;
  const failures = results.filter((r) => r.status === 'FAIL').length;
  const skipped = results.filter((r) => r.status === 'SKIP').length;
  const escape = (s) =>
    String(s)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  const cases = results
    .map((r) => {
      const attrs = `name="${escape(r.id)}" classname="clawx.harness.windows-e2e" time="${(r.durationMs / 1000).toFixed(3)}"`;
      if (r.status === 'PASS') return `    <testcase ${attrs}/>`;
      if (r.status === 'SKIP')
        return `    <testcase ${attrs}><skipped message="${escape(r.reason ?? '')}"/></testcase>`;
      return `    <testcase ${attrs}><failure message="${escape(r.reason ?? '')}"><![CDATA[${r.detail ?? ''}]]></failure></testcase>`;
    })
    .join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites tests="${total}" failures="${failures}" skipped="${skipped}">`,
    `  <testsuite name="clawx.harness.windows-e2e" tests="${total}" failures="${failures}" skipped="${skipped}">`,
    cases,
    '  </testsuite>',
    '</testsuites>',
    '',
  ].join('\n');
}

async function main() {
  const args = parseArgs(process.argv);
  const { specPath, prompts } = await loadSpec(args.spec);
  const filtered = args.filter
    ? prompts.filter((p) => p.id === args.filter)
    : prompts;
  const workRoot = await mkdtemp(path.join(tmpdir(), 'clawx-harness-'));
  process.stdout.write(
    `clawx-harness: mode=${args.mode} spec=${specPath} prompts=${filtered.length} work=${workRoot}\n`,
  );

  const results = [];
  for (const p of filtered) {
    const promptWork = path.join(workRoot, p.id);
    await mkdir(promptWork, { recursive: true });
    const start = Date.now();
    let status = 'PASS';
    let reason = '';
    let detail = '';
    try {
      const runner = args.mode === 'binary' ? runBinary : runDirect;
      const timeoutMs = p.timeout_ms ?? 30000;
      const run = runner(p, promptWork);
      const timeout = new Promise((_, rej) =>
        setTimeout(() => rej(new Error(`timeout ${timeoutMs}ms`)), timeoutMs),
      );
      const out = await Promise.race([run, timeout]);
      reason = out?.stdoutPreview ?? 'ok';
    } catch (err) {
      status = args.mode === 'binary' && /binary mode not enabled/.test(err.message) ? 'SKIP' : 'FAIL';
      reason = err.message.split('\n')[0].slice(0, 200);
      detail = err.stack ?? '';
    }
    const durationMs = Date.now() - start;
    results.push({ id: p.id, status, reason, detail, durationMs });
    process.stdout.write(
      `  [${status}] ${p.id.padEnd(24)} ${durationMs}ms  ${reason.slice(0, 100)}\n`,
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
    // best-effort cleanup
  }

  const failed = results.filter((r) => r.status === 'FAIL');
  if (failed.length) {
    process.stderr.write(`clawx-harness: ${failed.length} failure(s)\n`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`clawx-harness: fatal ${err.stack ?? err.message}\n`);
  process.exit(2);
});
