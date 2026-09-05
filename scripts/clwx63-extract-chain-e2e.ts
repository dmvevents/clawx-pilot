/**
 * CLWX-63 document-to-form extraction chain e2e.
 *
 * The chain under test is the live agent path for "principal drops a
 * suspension letter, the assistant prefills the statutory form":
 *
 *   1. The fixture suspension letter (tests/e2e/fixtures/clwx63/, invented
 *      Student A / Parent A data only) is written to a real .docx via the
 *      plugin's own writeDocx, then read back through the production
 *      readDocx path (mammoth) — the same reader the agent uses.
 *   2. The letter text goes to the eval LLM (Bedrock, same lane as
 *      v2-chatbot-e2e.ts) with the REGISTERED principal.suspension_payload
 *      tool description + JSON schema as the extraction contract — the
 *      exact surface the live agent sees.
 *   3. The LLM's args run through the real principal.suspension_payload
 *      execute(), then the real forms.preview_suspension execute() —
 *      including normalizeSuspensionPreviewPayload and its statutory
 *      no-invention refusal (MOE_DEMO_DEFAULTS is never set here).
 *   4. The plugin's host-API facade is the only piece replaced: this script
 *      runs without the Electron app, so a local fetch shim routes
 *      /api/forms/preview-suspension to SuspensionsActions open+fill against
 *      the test.fac Suspensions clone — the same driver the host route uses
 *      (the unit suite stubs this facade the same way). The shim HARD-THROWS
 *      if any caller ever passes a truthy confirm flag to
 *      /api/forms/submit-suspension: this script can never submit, by
 *      construction, and no code path here ever sets that flag.
 *   5. The normalized payload the driver filled is diffed against
 *      tests/e2e/fixtures/clwx63/expected-values.json; a field whose value
 *      matched but whose fill errored counts as a miss too. PASS iff the
 *      total misses <= 3.
 *   6. The hard-confirm gate is asserted: forms.submit_suspension with
 *      { confirm: false } must refuse. The filled form is left OPEN and
 *      UNSUBMITTED in the principal's Chrome tab for human review.
 *
 * Run (Chrome on :18792 with test.fac signed in, AWS creds for Bedrock):
 *   pnpm exec tsx scripts/clwx63-extract-chain-e2e.ts
 *   CLWX63_PROBE_ONLY=1 pnpm exec tsx scripts/clwx63-extract-chain-e2e.ts
 * (probe-only reports lane attachability and always exits 2 — it never
 * proves the chain and never opens the form.)
 *
 * Exit codes: 0 PASS (chain prefilled the clone, <=3 misses, gate refused) /
 * 1 FAIL (extraction, normalization refusal, fill, diff, or gate failure) /
 * 2 lane not ready (fixtures or cloned-form URL missing, CDP endpoint not
 * attachable — the current wedge answers /json/version 200 yet times out on
 * attach, so the probe must attach, not just ping — Bedrock lane
 * unavailable, or probe-only mode).
 */
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { FormsDriver, type FillResult } from '../electron/services/forms-browser-v2/forms-driver.ts';
import { SuspensionsActions, type SuspensionsPayload } from '../electron/services/forms-browser-v2/suspensions-actions.ts';

const CDP_ENDPOINT = 'http://127.0.0.1:18792';
const FIXTURE_DIR = join(process.cwd(), 'tests/e2e/fixtures/clwx63');
const LETTER_TXT = join(FIXTURE_DIR, 'suspension-letter.txt');
const EXPECTED_JSON = join(FIXTURE_DIR, 'expected-values.json');
const URL_PATH = join(process.cwd(), 'extensions/moe-principal-assistant/forms/suspensions-test-fac-url.txt');
const MODEL_ID = process.env.CLAWX_AGENT_EVAL_MODEL ?? 'us.anthropic.claude-sonnet-4-5-20250929-v1:0';
const REGION = process.env.AWS_REGION ?? 'us-east-2';
// Never listened on: the fetch shim intercepts these URLs before any socket
// is opened, and a bypass dies with ECONNREFUSED instead of reaching the
// real host API on :13210.
const SENTINEL_PORT = '59631';
const MAX_MISSES = 3;

function fail(msg: string): never {
  console.log(msg);
  process.exit(1);
}

function notReady(msg: string): never {
  console.log(`LANE NOT READY: ${msg}`);
  process.exit(2);
}

interface RegisteredTool {
  name: string;
  description?: string;
  parameters?: unknown;
  execute?: (toolCallId: string, params?: Record<string, unknown>) => Promise<unknown>;
}

interface ShimState {
  actions: SuspensionsActions;
  formUrl: string;
  /** The normalized payload forms.preview_suspension handed the driver. */
  lastNormalizedPayload: Record<string, unknown> | null;
  lastFill: Pick<FillResult, 'filledCount' | 'skippedCount' | 'errors'> | null;
}

interface ExpectedFile {
  autoRecorded: string[];
  notApplicable: string[];
  expected: Record<string, unknown>;
}

/**
 * Cheap lane probe, clwx46 style. The wedge this guards against is real:
 * /json/version can answer 200 while connectOverCDP times out on a stale
 * target, so an HTTP ping alone lies — the probe must attach (bounded) and
 * disconnect. Disconnecting a CDP probe never closes the user's Chrome.
 */
async function probeLane(): Promise<{ ready: boolean; note: string; formUrl: string }> {
  if (!existsSync(URL_PATH)) {
    return { ready: false, note: `no cloned-form URL at ${URL_PATH}`, formUrl: '' };
  }
  const formUrl = readFileSync(URL_PATH, 'utf-8').trim();
  if (!/^https:\/\/forms\.(office\.com|cloud\.microsoft)\//i.test(formUrl)) {
    return { ready: false, note: `form URL on disk doesn't look like a Forms response URL: ${formUrl.slice(0, 60)}`, formUrl: '' };
  }
  try {
    const resp = await fetch(`${CDP_ENDPOINT}/json/version`, { signal: AbortSignal.timeout(3_000) });
    if (!resp.ok) return { ready: false, note: `/json/version HTTP ${resp.status}`, formUrl };
  } catch (err) {
    return { ready: false, note: `/json/version unreachable: ${err instanceof Error ? err.message : String(err)}`, formUrl };
  }
  try {
    const browser = await chromium.connectOverCDP(CDP_ENDPOINT, { timeout: 8_000 });
    await browser.close();
  } catch (err) {
    return { ready: false, note: `CDP attach failed (endpoint answers HTTP but is not attachable): ${err instanceof Error ? err.message : String(err)}`, formUrl };
  }
  return { ready: true, note: 'CDP attachable, cloned-form URL on disk', formUrl };
}

/**
 * Replace ONLY the host-API HTTP hop of the forms facade: preview routes to
 * the local SuspensionsActions (the identical driver the Electron host route
 * drives), submit routes to the driver's own hard-confirm gate. Response
 * envelope mirrors electron/api/routes/forms.ts sendJson exactly.
 */
function installFormsFetchShim(state: ShimState): void {
  const realFetch = globalThis.fetch;
  const base = `http://127.0.0.1:${SENTINEL_PORT}/api/forms`;
  const shimJson = (data: unknown) =>
    ({
      status: 200,
      ok: true,
      text: async () => JSON.stringify({ success: true, data }),
      json: async () => ({ success: true, data }),
    }) as unknown as Response;
  globalThis.fetch = (async (input: unknown, init?: { body?: unknown }) => {
    const url = typeof input === 'string' ? input : String((input as { url?: unknown })?.url ?? input);
    if (!url.startsWith(base)) return realFetch(input as Parameters<typeof fetch>[0], init as Parameters<typeof fetch>[1]);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    if (url.endsWith('/preview-suspension')) {
      const payload = body.payload as SuspensionsPayload;
      state.lastNormalizedPayload = payload as unknown as Record<string, unknown>;
      const o = await state.actions.open(state.formUrl);
      if (o.status !== 'opened') return shimJson({ status: 'error', reason: o.reason ?? 'open failed' });
      const f = await state.actions.fill(payload);
      state.lastFill = { filledCount: f.filledCount, skippedCount: f.skippedCount, errors: f.errors };
      // Mirror the manager: field errors flip the status, but counts and the
      // error list still come back so the diff can reason over them.
      return shimJson({
        status: f.status === 'filled' ? 'previewed' : 'error',
        url: state.formUrl,
        filledCount: f.filledCount,
        skippedCount: f.skippedCount,
        errors: f.errors,
        ...(f.status === 'filled' ? {} : { reason: `fill reported ${f.errors.length} field error(s)` }),
      });
    }
    if (url.endsWith('/submit-suspension')) {
      // TRIPWIRE: this harness never submits. Even a future edit that flips
      // the confirm flag upstream dies here, before the driver sees it.
      if (body.confirm === true) {
        throw new Error('clwx63 tripwire: a truthy confirm flag reached the submit route — this harness never submits');
      }
      const r = await state.actions.submit({ confirm: false });
      return shimJson(r);
    }
    return shimJson({ status: 'error', reason: `clwx63 shim: unexpected forms endpoint ${url.slice(0, 120)}` });
  }) as typeof fetch;
}

async function registerPlugin(): Promise<Record<string, RegisteredTool>> {
  process.env.CLAWX_HOST_API_PORT = SENTINEL_PORT;
  process.env.CLAWX_HOST_API_TOKEN = 'clwx63-shim';
  // Statutory no-invention contract stays live: a field the LLM failed to
  // extract must REFUSE, never demo-default.
  delete process.env.MOE_DEMO_DEFAULTS;
  // @ts-expect-error untyped gateway plugin module (.mjs)
  const plugin = await import('../extensions/moe-principal-assistant/index.mjs');
  const tools: RegisteredTool[] = [];
  plugin.register({
    pluginConfig: {
      principalName: 'Test Principal (auto)',
      schoolName: 'Aranguez GPS',
      educationDistrict: 'Caroni',
      schoolType: 'Government',
    },
    registerTool: (tool: RegisteredTool) => tools.push(tool),
    log: { info() {}, warn() {} },
  });
  return Object.fromEntries(tools.map((t) => [t.name, t]));
}

/** The extraction contract IS the registered tool surface the agent sees. */
function extractionSystemPrompt(tool: RegisteredTool): string {
  return [
    'You are the Ministry of Education assistant for a primary-school principal in Trinidad & Tobago.',
    'A suspension letter follows. Extract the arguments for the tool principal.suspension_payload and reply with EXACTLY ONE JSON object of arguments on a single line. No prose, no code fences.',
    'Extract ONLY values stated in the letter. Never invent or guess a value that is not written there — this feeds a statutory form.',
    '',
    `Tool description: ${tool.description ?? ''}`,
    `Tool JSON schema: ${JSON.stringify(tool.parameters)}`,
  ].join('\n');
}

async function callBedrock(client: BedrockRuntimeClient, system: string, userText: string): Promise<{ text: string; latencyMs: number }> {
  const t0 = Date.now();
  const body = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 2048,
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

function parseLLMArgs(text: string): Record<string, unknown> | null {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    const obj: unknown = JSON.parse(cleaned);
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj as Record<string, unknown>;
    return null;
  } catch {
    return null;
  }
}

function diffPayload(
  expectedFile: ExpectedFile,
  actual: Record<string, unknown>,
  fillErrors: FillResult['errors'],
): { misses: string[]; checked: number } {
  const misses: string[] = [];
  const errById = new Map(fillErrors.map((e) => [e.fieldId, e.reason] as const));
  const canon = (v: unknown): string =>
    Array.isArray(v)
      ? v.map((x) => String(x).trim()).sort().join('|')
      : String(v ?? '').trim();
  let checked = 0;
  for (const [fieldId, want] of Object.entries(expectedFile.expected)) {
    checked += 1;
    const got = actual[fieldId];
    if (canon(got) !== canon(want)) {
      // A wrong value that also failed to fill is still ONE miss.
      misses.push(`${fieldId}: extracted "${canon(got).slice(0, 60)}" != expected "${canon(want).slice(0, 60)}"`);
      continue;
    }
    const fillErr = errById.get(fieldId);
    if (fillErr) misses.push(`${fieldId}: value matched but fill failed: ${fillErr.slice(0, 80)}`);
  }
  return { misses, checked };
}

async function main() {
  if (!existsSync(LETTER_TXT) || !existsSync(EXPECTED_JSON)) {
    notReady(`fixtures missing under ${FIXTURE_DIR} (need suspension-letter.txt + expected-values.json)`);
  }

  const probe = await probeLane();
  if (process.env.CLWX63_PROBE_ONLY === '1') {
    console.log(`PROBE-ONLY: lane ${probe.ready ? 'ATTACHABLE' : 'NOT attachable'} — ${probe.note}`);
    process.exit(2); // a probe never proves the chain
  }
  if (!probe.ready) notReady(probe.note);

  // Step 1: fixture letter -> real .docx -> production readDocx.
  console.log('Step 1: fixture letter -> .docx (writeDocx) -> letter text (readDocx, production reader)');
  // @ts-expect-error untyped gateway plugin module (.mjs)
  const docTools = await import('../extensions/moe-principal-assistant/doc-tools.mjs');
  const letterSource = readFileSync(LETTER_TXT, 'utf-8');
  const docxPath = join(os.tmpdir(), 'clwx63-suspension-letter.docx');
  await docTools.writeDocx({
    path: docxPath,
    title: 'Notice of Suspension - Principal Report (test fixture)',
    paragraphs: letterSource.split(/\r?\n/),
  });
  const read = await docTools.readDocx({ path: docxPath, format: 'text' });
  const letterText = String(read.text ?? '');
  if (letterText.length < 200) fail(`FAIL: readDocx returned only ${letterText.length} chars from the fixture docx`);
  console.log(`  -> ${read.bytes} bytes docx, ${letterText.length} chars extracted`);

  // Step 2: register the plugin; the fetch shim replaces only the host-API hop.
  const driver = new FormsDriver();
  const actions = new SuspensionsActions(driver);
  const shimState: ShimState = { actions, formUrl: probe.formUrl, lastNormalizedPayload: null, lastFill: null };
  installFormsFetchShim(shimState);
  const byName = await registerPlugin();
  const payloadTool = byName['principal.suspension_payload'];
  const previewTool = byName['forms.preview_suspension'];
  const submitTool = byName['forms.submit_suspension'];
  if (!payloadTool?.execute || !previewTool?.execute || !submitTool?.execute) {
    fail('FAIL: expected plugin tools missing (principal.suspension_payload / forms.preview_suspension / forms.submit_suspension)');
  }

  // Step 3: LLM extraction against the registered tool contract.
  console.log('\nStep 2: LLM extraction (Bedrock) against the registered principal.suspension_payload contract');
  let llmArgs: Record<string, unknown>;
  try {
    const client = new BedrockRuntimeClient({ region: REGION });
    const { text, latencyMs } = await callBedrock(client, extractionSystemPrompt(payloadTool), letterText);
    console.log(`  -> ${latencyMs}ms, ${text.length} chars`);
    const parsed = parseLLMArgs(text);
    if (!parsed) fail('FAIL: LLM output was not a single JSON object of tool args');
    llmArgs = parsed;
  } catch (err) {
    notReady(`Bedrock extraction lane unavailable: ${err instanceof Error ? err.message : String(err)}`);
  }
  console.log(`  -> ${Object.keys(llmArgs).length} arg(s) extracted`);

  // Step 4: production tool chain — structured payload, then normalize+fill.
  console.log('\nStep 3: principal.suspension_payload (production arg validation + payload build)');
  let structured: Record<string, unknown>;
  try {
    structured = (await payloadTool.execute('clwx63-payload', llmArgs)) as Record<string, unknown>;
  } catch (err) {
    fail(`FAIL: principal.suspension_payload rejected the extracted args: ${err instanceof Error ? err.message : String(err)}`);
  }

  console.log('\nStep 4: forms.preview_suspension -> normalize -> SuspensionsActions fill on the test.fac clone');
  const preview = (await previewTool.execute('clwx63-preview', { payload: structured })) as Record<string, unknown>;
  const previewStatus = String(preview.status ?? '');
  if (previewStatus === 'refused') {
    fail(
      `FAIL: preview refused (${String(preview.reason ?? '')}) missing=${JSON.stringify(preview.missingFields ?? [])} — the extraction did not supply every statutory field, and demo defaults are (correctly) off`,
    );
  }
  if (!shimState.lastNormalizedPayload || !shimState.lastFill) {
    fail(`FAIL: preview never reached the fill driver (status=${previewStatus} reason=${String(preview.reason ?? '')})`);
  }
  console.log(
    `  -> status=${previewStatus} filled=${shimState.lastFill.filledCount} skipped=${shimState.lastFill.skippedCount} errors=${shimState.lastFill.errors.length}`,
  );

  // Step 5: diff the values the driver filled against the fixture's truth.
  console.log('\nStep 5: diff normalized/filled values vs expected-values.json');
  const expectedFile = JSON.parse(readFileSync(EXPECTED_JSON, 'utf-8')) as ExpectedFile;
  const { misses, checked } = diffPayload(expectedFile, shimState.lastNormalizedPayload, shimState.lastFill.errors);
  for (const m of misses) console.log(`  MISS ${m}`);
  console.log(
    `  -> ${checked - misses.length}/${checked} fields match (${misses.length} miss(es), tolerance ${MAX_MISSES}); auto-recorded by the form: ${expectedFile.autoRecorded.join(', ')}`,
  );

  // Step 6: the hard-confirm gate must hold. This is the ONLY submit call in
  // the harness and its confirm flag is hardwired false (plus the shim
  // tripwire above); the filled form stays open and unsubmitted for review.
  console.log('\nStep 6: hard-confirm gate — forms.submit_suspension without confirm must refuse');
  const gate = (await submitTool.execute('clwx63-gate', { confirm: false })) as Record<string, unknown>;
  const gateStatus = String(gate.status ?? '');
  console.log(`  -> status=${gateStatus}`);
  if (gateStatus !== 'refused') {
    fail(`\nCLWX63 FAIL — the hard-confirm gate did not refuse (status=${gateStatus}); this outranks the diff`);
  }

  if (misses.length > MAX_MISSES) {
    fail(`\nCLWX63 FAIL — ${misses.length} miss(es) exceeds the ${MAX_MISSES}-miss tolerance`);
  }
  console.log(
    `\nCLWX63 PASS — letter -> extraction -> payload -> prefill chain landed with ${misses.length} miss(es) (<= ${MAX_MISSES}) and the gate refused; the form is left OPEN and UNSUBMITTED for review`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(`INFRA: ${err instanceof Error ? err.message : String(err)}`);
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(2);
});
