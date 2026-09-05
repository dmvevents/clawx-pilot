/**
 * CLWX-66 document-classification e2e.
 *
 * The path under test is the live agent behaviour for "principal drops a
 * document, the assistant routes it to the right taxonomy class". The product
 * doc (docs/PRODUCT_PRINCIPAL_ASSISTANT.md, "Classify incoming documents")
 * encodes the taxonomy the persona is expected to route to:
 *
 *   MoE_circular, parent_letter, staff_leave_application, attendance_report,
 *   inventory_form, meeting_minutes, disciplinary_record, other
 *
 * Classification is NOT a standalone registered tool — the persona is expected
 * to return the class alongside extracted fields. So the production surface for
 * this leg is the plugin's real persona system prompt driving a real model
 * call, over text that came through the production document reader. This
 * harness therefore, for each of three fixture documents drawn from DISTINCT
 * taxonomy classes:
 *
 *   1. Writes the fixture text to a real .docx via the plugin's own writeDocx,
 *      then reads it back through the production readDocx path (mammoth) — the
 *      same reader the agent uses when a principal drops a document. This means
 *      the classifier sees exactly what the runtime would hand it, not the raw
 *      fixture bytes.
 *   2. Sends that extracted text to the eval LLM (Bedrock, same lane as
 *      scripts/clwx63-extract-chain-e2e.ts) under the plugin's real persona
 *      SYSTEM_PROMPT (imported from the extension) plus a classification
 *      instruction that lists the product-doc taxonomy as the closed set of
 *      allowed answers. The model must reply with exactly one class token.
 *   3. Asserts the returned class equals the fixture's expected class.
 *
 * PASS iff all three fixtures route to the right class. Nothing here touches
 * Chrome/CDP, Outlook, or Forms; nothing is sent or submitted; no file leaves
 * the temp dir.
 *
 * Run (AWS creds for Bedrock):
 *   pnpm exec tsx scripts/clwx66-classify-e2e.ts
 *   CLWX66_PROBE_ONLY=1 pnpm exec tsx scripts/clwx66-classify-e2e.ts
 * (probe-only reports fixture + credential readiness and always exits 2 — it
 * never proves the classification.)
 *
 * Exit codes: 0 PASS (all three fixtures classified correctly) /
 * 1 FAIL (any fixture routed to the wrong class, or a model reply was not a
 * recognised class token) / 2 lane not ready (fixtures missing, or the Bedrock
 * lane is unavailable — no AWS credentials, or probe-only mode).
 */
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const FIXTURE_DIR = process.env.CLWX66_FIXTURE_DIR ?? join(process.cwd(), 'tests/e2e/fixtures/clwx66');
const EXPECTED_JSON = join(FIXTURE_DIR, 'expected-classes.json');
const MODEL_ID = process.env.CLAWX_AGENT_EVAL_MODEL ?? 'us.anthropic.claude-sonnet-4-5-20250929-v1:0';
const REGION = process.env.AWS_REGION ?? 'us-east-2';

interface ExpectedFile {
  taxonomy: string[];
  documents: Array<{ file: string; expectedClass: string; note?: string }>;
}

function fail(msg: string): never {
  console.log(msg);
  process.exit(1);
}

function notReady(msg: string): never {
  console.log(`LANE NOT READY: ${msg}`);
  process.exit(2);
}

/** The classification contract layered on top of the real persona prompt. */
function classificationSystemPrompt(systemPrompt: string, taxonomy: string[]): string {
  return [
    systemPrompt,
    '',
    'CLASSIFICATION TASK.',
    'A single document follows. Classify it into EXACTLY ONE of these document',
    'classes, and reply with ONLY that class token — no prose, no punctuation,',
    'no code fences, no explanation:',
    taxonomy.map((c) => `  - ${c}`).join('\n'),
    'If the document does not clearly fit any specific class, answer "other".',
  ].join('\n');
}

async function callBedrock(
  client: BedrockRuntimeClient,
  system: string,
  userText: string,
): Promise<{ text: string; latencyMs: number }> {
  const t0 = Date.now();
  const body = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 64,
    system,
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

/**
 * Map a model reply to a taxonomy class. The prompt asks for a bare token, but
 * a lenient parse (case-insensitive, punctuation-stripped, substring fallback)
 * keeps the assertion about the CLASS the model chose, not its formatting.
 */
function parseClass(reply: string, taxonomy: string[]): string | null {
  const cleaned = reply
    .trim()
    .replace(/^```(?:\w+)?\s*/i, '')
    .replace(/\s*```$/, '')
    .replace(/[.`"']/g, '')
    .trim();
  const lower = cleaned.toLowerCase();
  // Exact (case-insensitive) match first.
  for (const c of taxonomy) {
    if (lower === c.toLowerCase()) return c;
  }
  // Then a whole-token match anywhere in a short reply.
  for (const c of taxonomy) {
    const re = new RegExp(`(^|[^a-z_])${c.toLowerCase()}([^a-z_]|$)`, 'i');
    if (re.test(lower)) return c;
  }
  return null;
}

async function main() {
  if (!existsSync(EXPECTED_JSON)) {
    notReady(`fixtures missing: ${EXPECTED_JSON} (need expected-classes.json + the referenced .txt files)`);
  }
  const expected = JSON.parse(readFileSync(EXPECTED_JSON, 'utf-8')) as ExpectedFile;
  const taxonomy = expected.taxonomy;
  if (!Array.isArray(taxonomy) || taxonomy.length < 2) {
    notReady('expected-classes.json has no usable taxonomy array');
  }
  for (const d of expected.documents) {
    if (!existsSync(join(FIXTURE_DIR, d.file))) {
      notReady(`fixture document missing: ${d.file}`);
    }
  }
  const distinct = new Set(expected.documents.map((d) => d.expectedClass));
  if (expected.documents.length < 3 || distinct.size < 3) {
    notReady(`need 3 fixtures from 3 distinct classes (have ${expected.documents.length} docs, ${distinct.size} classes)`);
  }

  const haveCreds = Boolean(
    process.env.AWS_ACCESS_KEY_ID ||
      process.env.AWS_PROFILE ||
      process.env.AWS_SESSION_TOKEN ||
      process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI ||
      process.env.AWS_WEB_IDENTITY_TOKEN_FILE,
  );
  if (process.env.CLWX66_PROBE_ONLY === '1') {
    console.log(
      `PROBE-ONLY: fixtures READY (${expected.documents.length} docs / ${distinct.size} classes); ` +
        `Bedrock creds ${haveCreds ? 'present' : 'ABSENT'} — model ${MODEL_ID} @ ${REGION}`,
    );
    process.exit(2); // a probe never proves classification
  }

  // Production document reader path — writeDocx then readDocx (mammoth), the
  // same round-trip clwx63 uses so the classifier sees reader output. The
  // extensions/**/*.mjs plugins are untyped by design (scripts/types/mjs-modules.d.ts).
  const docTools = await import('../extensions/moe-principal-assistant/doc-tools.mjs');
  // The persona system prompt IS the production classification surface: the
  // exact prompt the host prepends when the plugin is enabled.
  const persona = await import('../extensions/moe-principal-assistant/persona.mjs');
  const tmpDir = mkdtempSync(join(os.tmpdir(), 'clwx66-classify-'));

  let client: BedrockRuntimeClient;
  try {
    client = new BedrockRuntimeClient({ region: REGION });
  } catch (err) {
    notReady(`Bedrock client init failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const system = classificationSystemPrompt(String(persona.SYSTEM_PROMPT ?? ''), taxonomy);
  const results: Array<{ file: string; expected: string; actual: string | null; raw: string; ok: boolean }> = [];

  console.log(`CLWX-66 classification e2e — ${expected.documents.length} fixtures, model ${MODEL_ID} @ ${REGION}`);
  console.log(`Taxonomy: ${taxonomy.join(', ')}\n`);

  for (const doc of expected.documents) {
    const src = readFileSync(join(FIXTURE_DIR, doc.file), 'utf-8');
    const docxPath = join(tmpDir, doc.file.replace(/\.txt$/, '.docx'));
    // writeDocx wants a title + paragraphs; splitting on blank lines keeps the
    // shape a real .docx would have without inventing content.
    await docTools.writeDocx({
      path: docxPath,
      title: doc.file.replace(/\.txt$/, ''),
      paragraphs: src.split(/\r?\n/),
    });
    const read = await docTools.readDocx({ path: docxPath, format: 'text' });
    const text = String(read.text ?? '');
    if (text.length < 100) {
      fail(`FAIL: readDocx returned only ${text.length} chars for ${doc.file} — reader path broken, cannot classify`);
    }

    let reply: string;
    try {
      const r = await callBedrock(client, system, text);
      reply = r.text;
      const actual = parseClass(reply, taxonomy);
      const ok = actual === doc.expectedClass;
      results.push({ file: doc.file, expected: doc.expectedClass, actual, raw: reply.trim(), ok });
      console.log(
        `${ok ? 'PASS' : 'FAIL'}  ${doc.file}  (${read.bytes}B docx, ${text.length} chars, ${r.latencyMs}ms)\n` +
          `      expected=${doc.expectedClass}  actual=${actual ?? 'UNRECOGNISED'}  raw="${reply.trim().slice(0, 60)}"`,
      );
    } catch (err) {
      notReady(`Bedrock classification lane unavailable on ${doc.file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} fixtures routed to the correct class`);
  if (passed !== results.length) {
    fail('\nCLWX66 FAIL — at least one document routed to the wrong class');
  }
  console.log('\nCLWX66 PASS — all fixtures routed to the correct taxonomy class');
  process.exit(0);
}

main().catch((err) => {
  console.error(`INFRA: ${err instanceof Error ? err.message : String(err)}`);
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(2);
});
