#!/usr/bin/env node
/**
 * clwx-vlm-grade-screens.mjs — VLM grading of REAL Windows desktop
 * screenshots (moe.19 verify directive, 2026-09-06).
 *
 * The CDP viewport only shows what the renderer THINKS it drew; the
 * stakeholder sees the desktop. Each screenshot (captured by
 * windows-pilot/scripts/pilot-desktop-screenshot.ps1 at <=2000px wide —
 * the Bedrock image cap; larger frames downscale unpredictably and grade
 * falsely) is judged by the same Bedrock Anthropic lane the app's
 * vlm-grounder uses, against a per-shot check written in a manifest.
 *
 * Manifest (JSON): { shots: [ { id, imagePath, check } ] } — `check` is
 * the falsifiable question, e.g. "The Ministry of Education app shell is
 * visible (chat composer + sidebar), NOT a setup wizard, NOT a blank
 * window; the header shows Online or On this device — never a raw model
 * id". The grader forces a strict verdict JSON.
 *
 * Usage:
 *   node scripts/clwx-vlm-grade-screens.mjs --manifest <shots.json> --report <out.md>
 * Exit: 0 all PASS; 1 any FAIL; 3 blocked input.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const MODEL_ID = process.env.CLAWX_VLM_GRADE_MODEL ?? 'us.anthropic.claude-sonnet-4-5-20250929-v1:0';
const REGION = process.env.AWS_REGION ?? 'us-east-2';

const SYSTEM = `You grade Windows desktop screenshots from an installed pilot app ("Ministry of Education").
Judge ONLY what is visible. Answer strictly as JSON: {"verdict":"PASS"|"FAIL","observed":"<=60 words of what you actually see>","violations":["..."]}.
FAIL when the check is not clearly satisfied, when a setup wizard / blank window / crash dialog is visible, or when TRUST rules are violated: raw model identifiers (e.g. gemini-*, claude-*, gpt-*), dollar costs, raw HTTP errors or stack traces visible anywhere on screen.`;

function parseArgs(argv) {
  const a = { manifest: null, report: null };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--manifest') a.manifest = argv[++i];
    else if (argv[i] === '--report') a.report = argv[++i];
  }
  return a;
}

async function gradeShot(client, shot) {
  const bytes = readFileSync(shot.imagePath);
  const body = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 400,
    system: SYSTEM,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: bytes.toString('base64') } },
        { type: 'text', text: `CHECK for shot "${shot.id}": ${shot.check}\nReturn the verdict JSON only.` },
      ],
    }],
  };
  const resp = await client.send(new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: new TextEncoder().encode(JSON.stringify(body)),
  }));
  const parsed = JSON.parse(new TextDecoder().decode(resp.body));
  const text = (parsed.content ?? []).find((c) => c.type === 'text')?.text ?? '';
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return { verdict: 'FAIL', observed: `unparsable grader output: ${text.slice(0, 120)}`, violations: ['grader-output'] };
  try { return JSON.parse(m[0]); } catch { return { verdict: 'FAIL', observed: `bad grader JSON: ${m[0].slice(0, 120)}`, violations: ['grader-json'] }; }
}

(async () => {
  const args = parseArgs(process.argv);
  if (!args.manifest || !existsSync(args.manifest)) {
    console.error('BLOCKED: --manifest <shots.json> required');
    process.exit(3);
  }
  const manifest = JSON.parse(readFileSync(args.manifest, 'utf8'));
  const shots = manifest.shots ?? [];
  if (!shots.length) { console.error('BLOCKED: manifest has no shots'); process.exit(3); }
  for (const s of shots) {
    if (!existsSync(s.imagePath)) { console.error(`BLOCKED: image missing for ${s.id}: ${s.imagePath}`); process.exit(3); }
  }
  const client = new BedrockRuntimeClient({ region: REGION });
  const rows = [];
  for (const shot of shots) {
    const r = await gradeShot(client, shot);
    rows.push({ id: shot.id, check: shot.check, ...r });
    console.log(`${String(r.verdict).padEnd(5)} ${shot.id} — ${r.observed}`);
  }
  const fails = rows.filter((r) => r.verdict !== 'PASS');
  console.log(`\n${fails.length ? '✗' : '✓'} VLM desktop grading: ${rows.length - fails.length}/${rows.length} PASS (model=${MODEL_ID})`);
  if (args.report) {
    mkdirSync(path.dirname(path.resolve(args.report)), { recursive: true });
    writeFileSync(args.report, [
      `# VLM desktop-screen grading (${new Date().toISOString().slice(0, 10)})`,
      '',
      `Grader: ${MODEL_ID} over REAL desktop screenshots (<=2000px, Bedrock cap).`,
      '',
      '| Shot | Verdict | Check | Observed | Violations |',
      '|---|---|---|---|---|',
      ...rows.map((r) => `| ${r.id} | ${r.verdict} | ${String(r.check).replace(/\|/g, '\\|').slice(0, 120)} | ${String(r.observed).replace(/\|/g, '\\|')} | ${(r.violations ?? []).join('; ')} |`),
      '',
    ].join('\n'));
    console.log(`report: ${args.report}`);
  }
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('FATAL:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
