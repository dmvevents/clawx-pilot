/**
 * CLWX-42 — NSCC stakeholder-authored Q&A eval (live model, context-provided).
 *
 * Raj supplied NSCC_2026__Test_QnA.docx (2026-05-14): 20 questions with
 * expected answers + page refs, "based only on the uploaded NSCC 2026
 * document". This runner asks the live cloud model (same Bedrock client
 * mechanism as scripts/v2-chatbot-e2e.ts / scripts/raj2-reply-fidelity-check.ts)
 * each question WITH the NSCC 2026 full text as provided context, then asserts
 * deterministically per row:
 *
 *   (a) KEY POINTS — every key-point group from eval/fixtures/nscc-qna.json
 *       matches the answer (any variant within a group; case-insensitive,
 *       word-boundary, whitespace/quote-normalized). Variants are drawn from
 *       the stakeholder's own expected answer plus the NSCC source phrasing.
 *   (b) NSCC CITATION — the answer names the NSCC / (National School) Code of
 *       Conduct as its source.
 *
 * Page-citation accuracy (answer mentions the stakeholder's expected page
 * number) is reported per row but does NOT gate: the text extraction does not
 * carry reliable page boundaries, so gating on it would test the extraction,
 * not the model.
 *
 * Scope note (honest): this proves the Q&A harness + model correctness WITH
 * the NSCC text provided in-context. The card's full acceptance ("fresh
 * session, NO file attached, in-app") additionally needs the NSCC knowledge
 * pack shipped inside the app — separate wiring, reported on the card.
 *
 * Hard limits: read-only; no sends of any kind; no browser; no secrets read,
 * printed, or written.
 *
 * Inputs:
 *   NSCC_TEXT_PATH — plain-text NSCC 2026 extraction (default: known local
 *                    extraction path, see DEFAULT_TEXT_PATHS)
 *   NSCC_PDF_PATH  — alternatively, the NSCC-2026.pdf; extracted via the
 *                    repo's own document.read_pdf path (doc-tools.mjs)
 *   CLAWX_AGENT_EVAL_MODEL / AWS_REGION — model routing (same as v2 scripts)
 *   NSCC_EVAL_OUT  — optional path for a full JSON report (per-row answers)
 *
 * Exit codes: 0 pass-rate >= 80%; 1 below floor; 2 fatal; 3 BLOCKED-INPUT
 * (fixture/knowledge text missing or wrong edition); 4 BLOCKED-INFRA (model
 * unreachable).
 *
 * Run: pnpm exec tsx scripts/nscc-qna-eval.ts
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const MODEL_ID = process.env.CLAWX_AGENT_EVAL_MODEL ?? 'us.anthropic.claude-sonnet-4-5-20250929-v1:0';
const REGION = process.env.AWS_REGION ?? 'us-east-2';
const PASS_RATE_FLOOR = 0.8;
const MAX_TOKENS = 1024;
const ANSWER_LOG_CHARS = 400;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_PATH = path.join(REPO_ROOT, 'eval', 'fixtures', 'nscc-qna.json');

/** Known local NSCC 2026 text extractions, tried in order when no env override. */
const DEFAULT_TEXT_PATHS = [
  path.join(REPO_ROOT, 'extensions', 'moe-principal-assistant', 'data', 'nscc-2026.txt'),
  path.resolve(REPO_ROOT, '..', 'moe-tt-voice', 'anton-claw-tt-voice', 'moe', 'data', 'nscc-2026.txt'),
];

interface QnaCase {
  id: string;
  question: string;
  expected_answer: string;
  expected_page: string;
  key_points: string[][];
}

interface Fixture {
  source_doc: string;
  cases: QnaCase[];
}

interface RowResult {
  id: string;
  question: string;
  expected_page: string;
  answer: string;
  latencyMs: number;
  missedGroups: string[][];
  citationOk: boolean;
  pageCited: boolean;
  pass: boolean;
}

// ── deterministic matching ───────────────────────────────────────────────────

/** Lowercase; straighten curly quotes; fold dashes/NBSP; collapse whitespace. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A variant matches as a whole phrase: spaces match any whitespace run, and
 * alphanumeric edges get word boundaries so "no" never matches inside "know".
 */
function variantMatches(normAnswer: string, variant: string): boolean {
  const v = normalize(variant);
  if (!v) return false;
  let pattern = escapeRegExp(v).replace(/ /g, '\\s+');
  if (/^[a-z0-9]/.test(v)) pattern = `(?<![a-z0-9])${pattern}`;
  if (/[a-z0-9]$/.test(v)) pattern = `${pattern}(?![a-z0-9])`;
  return new RegExp(pattern, 'i').test(normAnswer);
}

const CITATION_RE = /(?<![a-z0-9])nscc(?![a-z0-9])|national school code of conduct|code of conduct/;

/** Digit runs in the expected page cell ("pp. 11-12" -> ["11","12"]). */
function expectedPageNumbers(pageCell: string): string[] {
  return pageCell.match(/\d+/g) ?? [];
}

function pageCited(normAnswer: string, pageCell: string): boolean {
  return expectedPageNumbers(pageCell).some((n) =>
    new RegExp(`(?<!\\d)${n}(?!\\d)`).test(normAnswer),
  );
}

// ── knowledge context ────────────────────────────────────────────────────────

async function loadNsccText(): Promise<{ text: string; source: string }> {
  const pdfPath = process.env.NSCC_PDF_PATH;
  if (pdfPath) {
    // The repo's own document.read_pdf path (extension dep, plain ESM).
    const docTools = (await import(
      path.join(REPO_ROOT, 'extensions', 'moe-principal-assistant', 'doc-tools.mjs')
    )) as { readPdf: (a: { path: string; maxChars?: number }) => Promise<{ text: string; pages: number }> };
    const r = await docTools.readPdf({ path: pdfPath, maxChars: 600_000 });
    return { text: r.text, source: `${pdfPath} (pdf, ${r.pages} pages, via document.read_pdf path)` };
  }
  const candidates = process.env.NSCC_TEXT_PATH ? [process.env.NSCC_TEXT_PATH] : DEFAULT_TEXT_PATHS;
  for (const p of candidates) {
    if (existsSync(p)) return { text: readFileSync(p, 'utf8'), source: p };
  }
  throw Object.assign(
    new Error(
      `NSCC 2026 text not found. Tried: ${candidates.join(', ')}. ` +
      'Set NSCC_TEXT_PATH to an NSCC 2026 text extraction or NSCC_PDF_PATH to NSCC-2026.pdf.',
    ),
    { blocked: true },
  );
}

/** The eval is meaningless against the 2018 edition — refuse to run on it. */
function assertNscc2026(text: string): void {
  if (!/national school code of conduct/i.test(text)) {
    throw Object.assign(new Error('Knowledge text does not look like the NSCC at all.'), { blocked: true });
  }
  if (/revised may 25, 2018/i.test(text) && !/revised edition \(2026\)/i.test(text)) {
    throw Object.assign(
      new Error('Knowledge text is the 2018 NSCC revision; the stakeholder Q&A is based ONLY on the 2026 edition.'),
      { blocked: true },
    );
  }
  if (!/2026/.test(text)) {
    throw Object.assign(
      new Error('Knowledge text has no 2026 marker; expected the NSCC 2026 revised edition.'),
      { blocked: true },
    );
  }
}

// ── LLM turn (same mechanism as scripts/v2-chatbot-e2e.ts) ──────────────────

const SYSTEM_PROMPT = `You are a digital administrative assistant for a primary-school principal in Trinidad & Tobago.
The user provides the full text of the National School Code of Conduct (NSCC) 2026 and asks one question about it.
Answer the question using ONLY the provided NSCC document — do not add outside knowledge or assumptions.
Be brief: 2-5 sentences. Always name the NSCC (National School Code of Conduct) as your source, and cite the page number when it is identifiable from the provided text. If the document does not contain the answer, say so plainly.`;

async function callBedrock(
  client: BedrockRuntimeClient,
  userText: string,
): Promise<{ text: string; latencyMs: number }> {
  const t0 = Date.now();
  const body = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
  };
  const cmd = new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: new TextEncoder().encode(JSON.stringify(body)),
  });
  const resp = await client.send(cmd);
  const decoded = new TextDecoder().decode(resp.body!);
  const parsed = JSON.parse(decoded) as { content?: Array<{ type?: string; text?: string }> };
  const block = parsed.content?.find((c) => c.type === 'text');
  return { text: block?.text ?? '', latencyMs: Date.now() - t0 };
}

const THROTTLE_RE = /throttl|too ?many ?requests|rate ?limit|429/i;

async function callWithRetry(
  client: BedrockRuntimeClient,
  userText: string,
): Promise<{ text: string; latencyMs: number }> {
  const backoffsMs = [5_000, 15_000];
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await callBedrock(client, userText);
    } catch (err) {
      const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      if (attempt < backoffsMs.length && THROTTLE_RE.test(msg)) {
        console.log(`    throttled (${msg}); retrying in ${backoffsMs[attempt] / 1000}s`);
        await new Promise((r) => setTimeout(r, backoffsMs[attempt]));
        continue;
      }
      throw err;
    }
  }
}

// ── main ─────────────────────────────────────────────────────────────────────

(async () => {
  console.log('=== CLWX-42 NSCC stakeholder Q&A eval (live model, context-provided) ===');
  console.log(`model=${MODEL_ID} region=${REGION}`);
  console.log('Read-only: no sends, no browser, no state mutation.\n');

  let fixture: Fixture;
  let nscc: { text: string; source: string };
  try {
    fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as Fixture;
    nscc = await loadNsccText();
    assertNscc2026(nscc.text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`VERDICT: BLOCKED-INPUT — ${msg}`);
    process.exit(3);
  }
  console.log(`fixture:   ${FIXTURE_PATH} (${fixture.cases.length} rows, source: ${fixture.source_doc})`);
  console.log(`knowledge: ${nscc.source} (${nscc.text.length} chars)\n`);

  const client = new BedrockRuntimeClient({ region: REGION });
  const results: RowResult[] = [];

  for (const row of fixture.cases) {
    console.log(`${row.id}: ${row.question}`);
    let text = '';
    let latencyMs = 0;
    try {
      const turn = await callWithRetry(
        client,
        `NSCC 2026 DOCUMENT TEXT:\n\n${nscc.text}\n\n---\n\nQUESTION: ${row.question}`,
      );
      text = turn.text;
      latencyMs = turn.latencyMs;
    } catch (err) {
      const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      console.error(`\nVERDICT: BLOCKED-INFRA — model call failed on ${row.id}: ${msg}`);
      process.exit(4);
    }
    if (!text.trim()) {
      console.error(`\nVERDICT: BLOCKED-INFRA — empty text block on ${row.id}.`);
      process.exit(4);
    }

    const norm = normalize(text);
    const missedGroups = row.key_points.filter(
      (group) => !group.some((variant) => variantMatches(norm, variant)),
    );
    const citationOk = CITATION_RE.test(norm);
    const cited = pageCited(norm, row.expected_page);
    const pass = missedGroups.length === 0 && citationOk;
    results.push({
      id: row.id,
      question: row.question,
      expected_page: row.expected_page,
      answer: text,
      latencyMs,
      missedGroups,
      citationOk,
      pageCited: cited,
      pass,
    });

    const flat = text.replace(/\s+/g, ' ').trim();
    console.log(`  answer (${latencyMs}ms): ${flat.slice(0, ANSWER_LOG_CHARS)}${flat.length > ANSWER_LOG_CHARS ? ' …' : ''}`);
    console.log(
      `  key-points ${row.key_points.length - missedGroups.length}/${row.key_points.length}`
      + `${missedGroups.length ? ` (missed: ${missedGroups.map((g) => g[0]).join('; ')})` : ''}`
      + ` | nscc-cited=${citationOk} | expected ${row.expected_page} cited=${cited}`,
    );
    console.log(`  ${pass ? 'PASS' : 'FAIL'}\n`);
  }

  // ── summary ────────────────────────────────────────────────────────────────
  const passed = results.filter((r) => r.pass).length;
  const passRate = results.length ? passed / results.length : 0;
  const pageHits = results.filter((r) => r.pageCited).length;

  console.log('=== summary ===');
  console.log('row       | key-points | nscc-cited | page-cited | verdict');
  console.log('----------|------------|------------|------------|--------');
  for (const r of results) {
    const total = fixture.cases.find((c) => c.id === r.id)!.key_points.length;
    console.log(
      `${r.id} | ${String(total - r.missedGroups.length).padStart(4)}/${total}     `
      + `| ${r.citationOk ? 'yes' : 'NO '}        | ${r.pageCited ? 'yes' : 'no '}        | ${r.pass ? 'PASS' : 'FAIL'}`,
    );
  }
  console.log(
    `\npass rate: ${passed}/${results.length} = ${(passRate * 100).toFixed(0)}% (floor ${PASS_RATE_FLOOR * 100}%)`
    + ` | page-citation accuracy (informational): ${pageHits}/${results.length}`,
  );

  const outPath = process.env.NSCC_EVAL_OUT;
  if (outPath) {
    writeFileSync(
      outPath,
      JSON.stringify(
        {
          ranAt: new Date().toISOString(),
          model: MODEL_ID,
          region: REGION,
          fixture: FIXTURE_PATH,
          knowledgeSource: nscc.source,
          knowledgeChars: nscc.text.length,
          passRate,
          passed,
          total: results.length,
          pageCitationHits: pageHits,
          results,
        },
        null,
        2,
      ) + '\n',
    );
    console.log(`report written: ${outPath}`);
  }

  const ok = passRate >= PASS_RATE_FLOOR;
  console.log(ok
    ? 'CLWX-42 VERDICT: PASS — stakeholder Q&A answered correctly with NSCC citations (context-provided lane).'
    : 'CLWX-42 VERDICT: FAIL — pass rate below floor on the stakeholder Q&A set.');
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error('FATAL:', e instanceof Error ? e.message : String(e));
  process.exit(2);
});
