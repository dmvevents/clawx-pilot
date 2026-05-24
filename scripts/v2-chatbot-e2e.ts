/**
 * Chatbot end-to-end smoke. Closest autonomous proxy for "type into the
 * chat composer and watch the agent do it" — we construct what the LLM
 * would output for a known prompt, then route the tool call through the
 * exact same manager that the agent + IPC + host-API path uses.
 *
 * Layers exercised:
 *   1. Bedrock Sonnet 4.5 picks the right tool from a NL prompt
 *   2. v2 OutlookActions runs the tool against the real test.fac@fac.edu.tt session
 *   3. The result has the shape the agent would render
 */
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { PlaywrightDriver } from '../electron/services/outlook-browser-v2/playwright-driver.ts';
import { VlmGrounder } from '../electron/services/outlook-browser-v2/vlm-grounder.ts';
import { OutlookActions } from '../electron/services/outlook-browser-v2/outlook-actions.ts';

const MODEL_ID = process.env.CLAWX_AGENT_EVAL_MODEL ?? 'us.anthropic.claude-sonnet-4-5-20250929-v1:0';
const REGION = process.env.AWS_REGION ?? 'us-east-2';

const TOOLS_SYSTEM_PROMPT = `You are an AI assistant for a primary-school principal in Trinidad & Tobago.
Reply with EXACTLY ONE JSON object on a single line: { "tool": "outlook.<name>", "args": { ... } }

Available tools:
- outlook.open                  args: <none>
- outlook.read_inbox            args: top
- outlook.search_inbox          args: from?, subjectContains?, dateGte?, dateLt?, unread?, hasAttachment?, top?
- outlook.read_email            args: id
- outlook.draft_email           args: to, subject, body, cc?, bcc?
- outlook.send_email            args: to, subject, body, confirm:true
- outlook.reply                 args: id, body, replyAll?
- outlook.forward               args: id, to, body?
- outlook.mark_read             args: id, read
- outlook.list_attachments      args: id
- outlook.download_attachment   args: id, filename, confirm:true

Reply with the JSON object only. No prose.`;

interface Step {
  prompt: string;
  description: string;
}

const FLOW: Step[] = [
  { prompt: 'Open my inbox', description: 'Step 1: open Outlook' },
  { prompt: 'Show me my 5 most recent emails', description: 'Step 2: list inbox' },
  { prompt: 'Draft an email to test.fac@fac.edu.tt subject "E2E smoke" body "End-to-end smoke from the chatbot script — do not send."', description: 'Step 3: draft a new email' },
];

interface Picked {
  tool: string | null;
  args?: Record<string, unknown>;
}

function parseLLMOutput(text: string): Picked {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    const obj = JSON.parse(cleaned);
    return {
      tool: typeof obj.tool === 'string' ? obj.tool : null,
      args: obj.args && typeof obj.args === 'object' ? obj.args : undefined,
    };
  } catch {
    return { tool: null };
  }
}

async function callBedrock(client: BedrockRuntimeClient, prompt: string): Promise<{ text: string; latencyMs: number }> {
  const t0 = Date.now();
  const body = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 256,
    system: TOOLS_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
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
  const block = parsed.content?.find(c => c.type === 'text');
  return { text: block?.text ?? '', latencyMs: Date.now() - t0 };
}

async function runTool(actions: OutlookActions, picked: Picked): Promise<{ ok: boolean; result: unknown; latencyMs: number; error?: string }> {
  const t0 = Date.now();
  try {
    let result: unknown;
    switch (picked.tool) {
      case 'outlook.open':
        result = await actions.open();
        break;
      case 'outlook.read_inbox':
        result = await actions.readInbox((picked.args?.top as number | undefined) ?? 10);
        break;
      case 'outlook.search_inbox':
        result = await actions.searchInbox((picked.args ?? {}) as Parameters<OutlookActions['searchInbox']>[0]);
        break;
      case 'outlook.read_email':
        result = await actions.readEmail({ id: picked.args!.id as string });
        break;
      case 'outlook.draft_email':
        result = await actions.draftEmail(picked.args as Parameters<OutlookActions['draftEmail']>[0]);
        break;
      case 'outlook.send_email':
        result = await actions.sendEmail(picked.args as Parameters<OutlookActions['sendEmail']>[0]);
        break;
      case 'outlook.reply':
        result = await actions.reply(picked.args as Parameters<OutlookActions['reply']>[0]);
        break;
      case 'outlook.forward':
        result = await actions.forward(picked.args as Parameters<OutlookActions['forward']>[0]);
        break;
      case 'outlook.mark_read':
        result = await actions.markRead(picked.args as Parameters<OutlookActions['markRead']>[0]);
        break;
      case 'outlook.list_attachments':
        result = await actions.listAttachments({ id: picked.args!.id as string });
        break;
      case 'outlook.download_attachment':
        result = await actions.downloadAttachment(picked.args as Parameters<OutlookActions['downloadAttachment']>[0]);
        break;
      default:
        return { ok: false, result: null, latencyMs: Date.now() - t0, error: `unknown tool: ${picked.tool}` };
    }
    return { ok: true, result, latencyMs: Date.now() - t0 };
  } catch (err) {
    return { ok: false, result: null, latencyMs: Date.now() - t0, error: err instanceof Error ? err.message : String(err) };
  }
}

async function main() {
  console.log('=== chatbot end-to-end smoke ===\n');

  const client = new BedrockRuntimeClient({ region: REGION });
  const driver = new PlaywrightDriver({ cdpEndpoint: 'http://127.0.0.1:18792' });
  const grounder = new VlmGrounder();
  const actions = new OutlookActions(driver, grounder);

  // Cleanup any leftover compose state.
  try {
    await driver.ensureBrowser();
    const page = await driver.ensureOutlookTab();
    await driver.pressKey('Escape').catch(() => null);
    await driver.sleep(300);
    const inboxLink = page.getByRole('treeitem', { name: /^inbox/i }).first();
    if ((await inboxLink.count().catch(() => 0)) > 0) {
      await inboxLink.click({ timeout: 3_000 }).catch(() => null);
    }
  } catch { /* best effort */ }

  let allOk = true;
  for (const step of FLOW) {
    console.log(`\n${step.description}`);
    console.log(`  user: "${step.prompt}"`);

    const { text, latencyMs: llmMs } = await callBedrock(client, step.prompt);
    const picked = parseLLMOutput(text);
    console.log(`  LLM (${llmMs}ms): tool=${picked.tool} args=${JSON.stringify(picked.args ?? {})}`);

    if (!picked.tool) {
      console.log(`  ✗ LLM declined to pick a tool`);
      allOk = false;
      continue;
    }

    const exec = await runTool(actions, picked);
    if (exec.ok) {
      const r = exec.result as Record<string, unknown>;
      console.log(`  ✓ tool ran (${exec.latencyMs}ms): status=${r.status} ${r.message ? '— ' + r.message : ''}`);
    } else {
      console.log(`  ✗ tool failed (${exec.latencyMs}ms): ${exec.error}`);
      allOk = false;
    }
  }

  console.log(`\n=== ${allOk ? 'ALL PASS' : 'FAIL'} ===`);
  process.exit(allOk ? 0 : 1);
}

main().catch(err => {
  console.error('CRASH:', err instanceof Error ? err.message : String(err));
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(2);
});
