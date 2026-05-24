/**
 * Phase 8: LLM tool-pick eval for the agentic Outlook OKR's KR2.
 *
 * The existing `scripts/v2-eval.ts` calls v2 OutlookActions directly and
 * grades the IMPLEMENTATION. This eval grades the LLM's TOOL SELECTION:
 * given a natural-language principal prompt, does the model pick the
 * correct outlook.* tool with reasonable arguments?
 *
 * Method: send each prompt to a chosen LLM (default: claude-sonnet-4-5
 * via Bedrock, since it's the same provider we use for VLM grounding
 * and is reachable via AWS_PROFILE=bedrock). Parse the model's chosen
 * tool name and argument shape from its output. Score against an
 * expected tool name and an expected key set on args.
 *
 * Pure-LLM-evaluation: no Outlook calls happen during the eval. We're
 * measuring the model's grasp of the tool surface, not the runtime.
 *
 * Run:
 *   pnpm exec tsx scripts/v2-agent-eval.ts
 *
 * Output: pass/fail/skip per prompt + a summary, written to
 * /tmp/v2-agent-eval-results.json
 */
import { writeFileSync } from 'fs';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const MODEL_ID = process.env.CLAWX_AGENT_EVAL_MODEL ?? 'us.anthropic.claude-sonnet-4-5-20250929-v1:0';
const REGION = process.env.AWS_REGION ?? 'us-east-2';

interface ToolSpec {
  name: string;
  description: string;
  argShape: string[];
}

const OUTLOOK_TOOLS: ToolSpec[] = [
  { name: 'outlook.open', description: 'Open Outlook Web in the principal\'s existing Chrome session.', argShape: [] },
  { name: 'outlook.read_inbox', description: 'Return the top N recent inbox messages.', argShape: ['top'] },
  { name: 'outlook.search_inbox', description: 'Filter the inbox by sender, subject, date, unread, or attachment.', argShape: ['from', 'subjectContains', 'dateGte', 'dateLt', 'unread', 'hasAttachment', 'top'] },
  { name: 'outlook.read_email', description: 'Open one message by id and return full body + attachments.', argShape: ['id'] },
  { name: 'outlook.draft_email', description: 'Open a New Mail compose pane and fill it. Does not send.', argShape: ['to', 'subject', 'body', 'cc', 'bcc'] },
  { name: 'outlook.send_email', description: 'Send an email. HARD GATE: requires confirm:true.', argShape: ['to', 'subject', 'body', 'confirm'] },
  { name: 'outlook.reply', description: 'Reply or reply-all to a message.', argShape: ['id', 'body', 'replyAll'] },
  { name: 'outlook.forward', description: 'Forward a message to a new recipient.', argShape: ['id', 'to', 'body'] },
  { name: 'outlook.mark_read', description: 'Mark a message as read or unread.', argShape: ['id', 'read'] },
  { name: 'outlook.list_attachments', description: 'List metadata for a message\'s attachments. Does not download.', argShape: ['id'] },
  { name: 'outlook.download_attachment', description: 'Download a specific attachment. HARD GATE: requires confirm:true.', argShape: ['id', 'filename', 'confirm'] },
];

interface EvalRow {
  id: string;
  prompt: string;
  expectedTool: string;
  /**
   * Required arg keys. The model must include all of these. Extra keys
   * are fine; missing any is a fail.
   */
  expectedArgKeys: string[];
  /**
   * Acceptable alternative tools — when the model picks a tool that's
   * a valid first-step toward the user's request rather than the
   * literal expected tool. e.g. "Mark that email as read" implies the
   * model needs to look up the email first; search_inbox or read_inbox
   * are reasonable detours and still grade as pass.
   *
   * For prompts where the agent should refuse / ask for clarification
   * rather than pick a tool, set expectedTool to '__none__'.
   */
  acceptableAlternatives?: string[];
}

const PROMPTS: EvalRow[] = [
  // W1
  { id: 'open-1', prompt: 'Open my email', expectedTool: 'outlook.open', expectedArgKeys: [] },
  // W2.1, W2.2
  { id: 'inbox-1', prompt: 'What\'s in my inbox?', expectedTool: 'outlook.read_inbox', expectedArgKeys: [] },
  { id: 'unread-1', prompt: 'How many unread emails do I have?', expectedTool: 'outlook.search_inbox', expectedArgKeys: ['unread'] },
  // W2.3
  { id: 'sender-1', prompt: 'Anything from districtoffice@moe.gov.tt today?', expectedTool: 'outlook.search_inbox', expectedArgKeys: ['from'] },
  // W2.4
  { id: 'subject-1', prompt: 'Find the email about budget approvals', expectedTool: 'outlook.search_inbox', expectedArgKeys: ['subjectContains'] },
  // W3.1 — implicit "latest from district HQ" requires search first
  { id: 'read-1', prompt: 'What does the latest message from district HQ say?', expectedTool: 'outlook.read_email', expectedArgKeys: ['id'], acceptableAlternatives: ['outlook.search_inbox'] },
  // W4.1
  { id: 'draft-1', prompt: 'Draft an email to p@school.tt: Meeting at 10am tomorrow', expectedTool: 'outlook.draft_email', expectedArgKeys: ['to', 'subject', 'body'] },
  // W4.3 — single-turn prompt without prior context; model can't fabricate
  // an open draft. Refusal (tool=null) is the agentically-correct answer
  // here. send_email is acceptable only if the model assumes a prior draft.
  { id: 'send-1', prompt: 'Yes, send that email I just drafted', expectedTool: 'outlook.send_email', expectedArgKeys: ['confirm'], acceptableAlternatives: ['__none__'] },
  // W5.1 — same implicit-id problem
  { id: 'reply-1', prompt: 'Reply to that last email saying I\'ll attend', expectedTool: 'outlook.reply', expectedArgKeys: ['id', 'body'], acceptableAlternatives: ['outlook.search_inbox', 'outlook.read_inbox', '__none__'] },
  // W5.2
  { id: 'replyall-1', prompt: 'Reply all to the budget email — I support it', expectedTool: 'outlook.reply', expectedArgKeys: ['id', 'body', 'replyAll'], acceptableAlternatives: ['outlook.search_inbox'] },
  // W5.3
  { id: 'forward-1', prompt: 'Forward the school inspection report to p@school.tt', expectedTool: 'outlook.forward', expectedArgKeys: ['id', 'to'], acceptableAlternatives: ['outlook.search_inbox', '__none__'] },
  // W6.1
  { id: 'markread-1', prompt: 'Mark that email as read', expectedTool: 'outlook.mark_read', expectedArgKeys: ['id', 'read'], acceptableAlternatives: ['__none__'] },
  // W8.1, W8.2
  { id: 'listatt-1', prompt: 'What attachments are on the email about teacher evaluations?', expectedTool: 'outlook.list_attachments', expectedArgKeys: ['id'], acceptableAlternatives: ['outlook.search_inbox'] },
  { id: 'searchatt-1', prompt: 'Find emails with PDF attachments from this week', expectedTool: 'outlook.search_inbox', expectedArgKeys: ['hasAttachment'] },
  // W8.3
  { id: 'download-1', prompt: 'Yes, download the PDF report.pdf from that email', expectedTool: 'outlook.download_attachment', expectedArgKeys: ['id', 'filename', 'confirm'] },
];

const SYSTEM_PROMPT = `You are an AI assistant for a primary-school principal in Trinidad & Tobago.
You have access to a set of Outlook tools. Reply with EXACTLY ONE JSON object on a single line:

  { "tool": "outlook.<name>", "args": { ... } }

Or if no tool matches, reply:

  { "tool": null, "reasoning": "short explanation" }

Available tools:

${OUTLOOK_TOOLS.map(t => `  - ${t.name}: ${t.description} (args: ${t.argShape.join(', ') || '<none>'})`).join('\n')}

Rules:
- Pick the SINGLE most appropriate tool.
- Include only argument keys you have specific values for. Don't invent IDs.
- For send_email and download_attachment, only include confirm:true when the user
  explicitly confirms ("yes, send", "yes, download").
- The user has already opened Outlook for previous queries — assume that.
- Reply with the JSON object only. No prose.`;

interface Result {
  id: string;
  prompt: string;
  expectedTool: string;
  expectedArgKeys: string[];
  status: 'pass' | 'fail' | 'error';
  pickedTool: string | null;
  pickedArgKeys: string[];
  notes: string;
  latencyMs: number;
}

function scoreRow(row: EvalRow, picked: { tool: string | null; args?: Record<string, unknown>; reasoning?: string }, latencyMs: number): Result {
  const pickedTool = picked.tool;
  const pickedArgKeys = picked.args ? Object.keys(picked.args) : [];

  if (row.expectedTool === '__none__') {
    return {
      id: row.id, prompt: row.prompt, expectedTool: row.expectedTool, expectedArgKeys: row.expectedArgKeys,
      status: pickedTool === null ? 'pass' : 'fail',
      pickedTool, pickedArgKeys, latencyMs,
      notes: pickedTool === null ? 'correctly refused' : `picked ${pickedTool} but expected refusal`,
    };
  }

  // Allow acceptable alternatives — search/read first then act later
  // is agentically correct for implicit-id prompts. '__none__' = refusal
  // is also acceptable when the prompt lacks prior context.
  const accepted = pickedTool === row.expectedTool
    || (row.acceptableAlternatives ?? []).some(alt =>
        alt === '__none__' ? pickedTool === null : alt === pickedTool);

  if (!accepted) {
    return {
      id: row.id, prompt: row.prompt, expectedTool: row.expectedTool, expectedArgKeys: row.expectedArgKeys,
      status: 'fail',
      pickedTool, pickedArgKeys, latencyMs,
      notes: `wrong tool: expected ${row.expectedTool} (or one of ${(row.acceptableAlternatives ?? []).join('|') || 'none'}), got ${pickedTool}`,
    };
  }

  // If the model picked an alternative (not the literal expected tool),
  // we don't grade arg keys — the alt has different keys. Just pass.
  if (pickedTool !== row.expectedTool) {
    return {
      id: row.id, prompt: row.prompt, expectedTool: row.expectedTool, expectedArgKeys: row.expectedArgKeys,
      status: 'pass',
      pickedTool, pickedArgKeys, latencyMs,
      notes: `acceptable alternative: ${pickedTool ?? 'null'}`,
    };
  }

  // Check that all REQUIRED keys are present. Allow extra keys (model can
  // surface defaults, that's fine).
  const missing = row.expectedArgKeys.filter(k => !pickedArgKeys.includes(k));
  if (missing.length > 0) {
    return {
      id: row.id, prompt: row.prompt, expectedTool: row.expectedTool, expectedArgKeys: row.expectedArgKeys,
      status: 'fail',
      pickedTool, pickedArgKeys, latencyMs,
      notes: `tool correct, but missing required arg keys: ${missing.join(', ')}`,
    };
  }

  return {
    id: row.id, prompt: row.prompt, expectedTool: row.expectedTool, expectedArgKeys: row.expectedArgKeys,
    status: 'pass',
    pickedTool, pickedArgKeys, latencyMs,
    notes: 'ok',
  };
}

async function callBedrock(client: BedrockRuntimeClient, userPrompt: string): Promise<{ text: string; latencyMs: number }> {
  const t0 = Date.now();
  const body = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 256,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: [{ type: 'text', text: userPrompt }] }],
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

function parseModelOutput(text: string): { tool: string | null; args?: Record<string, unknown>; reasoning?: string } {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    const obj = JSON.parse(cleaned);
    return {
      tool: typeof obj.tool === 'string' ? obj.tool : null,
      args: obj.args && typeof obj.args === 'object' ? obj.args : undefined,
      reasoning: typeof obj.reasoning === 'string' ? obj.reasoning : undefined,
    };
  } catch {
    return { tool: null, reasoning: 'unparseable model output' };
  }
}

async function main() {
  console.log(`=== v2 LLM tool-pick eval (model=${MODEL_ID}) ===`);
  const client = new BedrockRuntimeClient({ region: REGION });
  const results: Result[] = [];

  for (const row of PROMPTS) {
    let result: Result;
    try {
      const { text, latencyMs } = await callBedrock(client, row.prompt);
      const picked = parseModelOutput(text);
      result = scoreRow(row, picked, latencyMs);
    } catch (err) {
      result = {
        id: row.id, prompt: row.prompt, expectedTool: row.expectedTool, expectedArgKeys: row.expectedArgKeys,
        status: 'error',
        pickedTool: null, pickedArgKeys: [], latencyMs: 0,
        notes: `THREW: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    results.push(result);
    const emoji = result.status === 'pass' ? '✓' : result.status === 'error' ? '!' : '✗';
    console.log(`${emoji}  ${result.id} (${result.latencyMs}ms) — ${result.notes}`);
    if (result.status !== 'pass') {
      console.log(`     prompt: "${row.prompt}"`);
      console.log(`     expected: ${row.expectedTool} args=[${row.expectedArgKeys.join(',')}]`);
      console.log(`     picked: ${result.pickedTool ?? 'null'} args=[${result.pickedArgKeys.join(',')}]`);
    }
  }

  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.filter(r => r.status === 'fail').length;
  const errored = results.filter(r => r.status === 'error').length;
  const total = results.length;
  const passRate = (passed / total) * 100;
  console.log(`\n=== summary ===`);
  console.log(`pass: ${passed}/${total} (${passRate.toFixed(1)}%)`);
  console.log(`fail: ${failed}`);
  console.log(`error: ${errored}`);
  console.log(`KR2 target ≥80%: ${passRate >= 80 ? 'MET' : 'MISSED'}`);

  const summary = {
    runAt: new Date().toISOString(),
    model: MODEL_ID,
    region: REGION,
    pass: passed, fail: failed, error: errored, total, passRate,
    rows: results,
  };
  writeFileSync('/tmp/v2-agent-eval-results.json', JSON.stringify(summary, null, 2));
  console.log(`\nResults: /tmp/v2-agent-eval-results.json`);
  process.exit(failed > 0 || errored > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('FAILED:', err instanceof Error ? err.message : String(err));
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(2);
});
