#!/usr/bin/env node
/**
 * clawx-mcp-server.mjs — thin stdio MCP adapter over the ClawX host-API
 * (CLWX-71).
 *
 * Exposes the app's gated forms/outlook capabilities as MCP tools so ANY
 * MCP client (Claude Code, Claude Desktop, future agents) can drive them.
 * This adapter is a PROXY, deliberately dumb: every request is forwarded
 * verbatim to the host-API on 127.0.0.1, where the REAL protections live —
 * the two-gate send (confirm:true + compose-pane subject fingerprint), the
 * forms hard-confirm gate, the PRINCIPAL_SKILL_ALLOWLIST kill-switch, and
 * the audit-first outbox writes all execute server-side in the app and
 * CANNOT be bypassed from here. Same gates, same logs, zero new attack
 * surface, no CDP contention.
 *
 * SECURITY CONTRACT (CLWX-71 acceptance):
 *   - The host-API bearer token comes ONLY from the CLAWX_HOST_API_TOKEN
 *     env var — never argv, never config files, never logged.
 *   - All logging goes to stderr (stdout is the MCP protocol channel) and
 *     carries tool names, argument KEY NAMES, and counts — never argument
 *     values, subjects, recipients, or body content.
 *   - Raw browser MCPs (playwright-mcp --cdp-endpoint, chrome-devtools-mcp)
 *     can also attach to the principal's Chrome, but they are UNGATED
 *     click/type surfaces — dev/debug only, NEVER principal-facing. This
 *     adapter is the sanctioned path precisely because it cannot skip the
 *     gates. (docs/MCP_INTEGRATION_RESEARCH_2026-09-03.md)
 *
 * Run (the app must be running; the token is per-boot):
 *   CLAWX_HOST_API_TOKEN=... node scripts/clawx-mcp-server.mjs   # env-only
 * Claude Code registration — use the TOKEN-FREE launcher so the credential
 * never appears in ANY argv (Codex finding, 2026-09-06):
 *   claude mcp add clawx -- node scripts/clawx-mcp-launcher.mjs
 */
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const HOST_API_PORT = Number(process.env.CLAWX_HOST_API_PORT ?? 13210);
// Browser-driven operations are slow (attach + navigate + settle).
const REQUEST_TIMEOUT_MS = 180_000;

const CONFIRM_NOTE =
  'HARD GATE (server-side, cannot be bypassed): without confirm:true this refuses. '
  + 'Sandbox policy: confirmed submits/sends are for the test.fac sandbox only — '
  + 'never a production destination without explicit operator direction. '
  + 'IRREVERSIBLE + browser-driven (slow): raise your client timeout; if the call '
  + 'errors or times out the outcome is UNKNOWN — never retry automatically, '
  + 'verify in Outlook/the form first.';

/**
 * The tool table IS the adapter (pure data; unit-tested): MCP tool name →
 * host-API route + JSON-Schema input. Gates stay server-side; descriptions
 * carry the contract so clients behave.
 */
export const TOOL_TABLE = [
  {
    name: 'forms_list',
    route: '/api/forms/list',
    description: 'List the Microsoft Forms this app can drive (MoE Daily Report, Student Suspensions).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'forms_preview_daily_report',
    route: '/api/forms/preview-daily-report',
    description: 'Fill the Primary School Daily Report in the visible browser for principal review. Args: { payload } (field map). Does NOT submit.',
    inputSchema: {
      type: 'object',
      properties: { payload: { type: 'object', description: 'Daily Report field payload (principal.daily_report_form_payload shape)' } },
      required: ['payload'],
      additionalProperties: false,
    },
  },
  {
    name: 'forms_submit_daily_report',
    route: '/api/forms/submit-daily-report',
    mutating: true,
    description: `Submit the previously previewed Daily Report. ${CONFIRM_NOTE}`,
    inputSchema: {
      type: 'object',
      properties: { confirm: { type: 'boolean', description: 'Must be exactly true after the principal reviewed the previewed form.' } },
      additionalProperties: false,
    },
  },
  {
    name: 'forms_preview_suspension',
    route: '/api/forms/preview-suspension',
    description: 'Fill the Student Suspensions form in the visible browser for principal review. Args: { payload }. Does NOT submit.',
    inputSchema: {
      type: 'object',
      properties: { payload: { type: 'object', description: 'Suspensions field payload (principal.suspension_payload shape)' } },
      required: ['payload'],
      additionalProperties: false,
    },
  },
  {
    name: 'forms_submit_suspension',
    route: '/api/forms/submit-suspension',
    mutating: true,
    description: `Submit the previously previewed Suspensions form. ${CONFIRM_NOTE}`,
    inputSchema: {
      type: 'object',
      properties: { confirm: { type: 'boolean', description: 'Must be exactly true after the principal reviewed the previewed form.' } },
      additionalProperties: false,
    },
  },
  {
    name: 'outlook_open',
    route: '/api/outlook/open',
    description: "Open/attach Outlook Web in the principal's existing Chrome session (profile=user).",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'outlook_read_inbox',
    route: '/api/outlook/read-inbox',
    description: 'Read the most recent inbox messages. Args: { top? } (default 10).',
    inputSchema: {
      type: 'object',
      properties: { top: { type: 'number', description: 'How many messages (default 10).' } },
      additionalProperties: false,
    },
  },
  {
    name: 'outlook_draft_email',
    route: '/api/outlook/draft',
    description: 'Open a compose pane with to/subject/body for principal review. Drafts are always left open; nothing is sent.',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'array', items: { type: 'string' } },
        cc: { type: 'array', items: { type: 'string' } },
        bcc: { type: 'array', items: { type: 'string' } },
        subject: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['to', 'subject', 'body'],
      additionalProperties: true,
    },
  },
  {
    name: 'outlook_send_email',
    route: '/api/outlook/send',
    mutating: true,
    description: `Send the ALREADY-REVIEWED open draft. TWO-GATE: requires confirm:true AND args.subject matching the open compose pane's subject. ${CONFIRM_NOTE}`,
    inputSchema: {
      type: 'object',
      properties: {
        confirm: { type: 'boolean' },
        subject: { type: 'string', description: 'Must match the open compose pane subject (the second gate).' },
      },
      required: ['subject'],
      additionalProperties: true,
    },
  },
];

/**
 * Log-safe view of tool args (pure; unit-tested): key names and counts
 * only — never values. Key NAMES are caller-controlled content too (Codex
 * finding, 2026-09-06: a key carrying confidential text + a newline both
 * leaked and forged a log line), so only identifier-shaped keys are
 * printed; anything else is counted, not echoed. Arrays report lengths;
 * objects report their key counts.
 */
const SAFE_KEY_RE = /^[a-zA-Z0-9_]{1,32}$/;
export function logSafeArgSummary(args) {
  if (!args || typeof args !== 'object') return 'none';
  const parts = [];
  let oddKeys = 0;
  for (const [k, v] of Object.entries(args)) {
    if (!SAFE_KEY_RE.test(k)) { oddKeys += 1; continue; }
    if (Array.isArray(v)) parts.push(`${k}[${v.length}]`);
    else if (v && typeof v === 'object') parts.push(`${k}{${Object.keys(v).length}}`);
    else if (typeof v === 'boolean') parts.push(`${k}=${v}`); // confirm=true/false is the gate signal, not payload
    else parts.push(k);
  }
  if (oddKeys > 0) parts.push(`+${oddKeys} non-identifier key(s) withheld`);
  return parts.join(' ');
}

function logErr(msg) {
  process.stderr.write(`[clawx-mcp ${new Date().toISOString().slice(11, 19)}] ${msg}\n`);
}

async function callHostApi(route, args, token, clientSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  // Client cancellation propagates to the fetch: without this a timed-out
  // MCP call kept running server-side and could still complete a send
  // (Codex finding, 2026-09-06).
  const onClientAbort = () => controller.abort();
  if (clientSignal) {
    if (clientSignal.aborted) controller.abort();
    else clientSignal.addEventListener('abort', onClientAbort, { once: true });
  }
  try {
    const resp = await fetch(`http://127.0.0.1:${HOST_API_PORT}${route}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(args ?? {}),
      signal: controller.signal,
    });
    const text = await resp.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = { success: false, error: `non-JSON host-API response (http ${resp.status})` }; }
    return { httpStatus: resp.status, body: parsed };
  } finally {
    clearTimeout(timer);
    if (clientSignal) clientSignal.removeEventListener('abort', onClientAbort);
  }
}

/**
 * Transport-failure wording (pure; unit-tested). For MUTATING tools
 * (send/submit) a failure after dispatch means the outcome is UNKNOWN —
 * the app may have completed the irreversible action; an automatic retry
 * could duplicate it (Codex finding, 2026-09-06). Read-only tools keep the
 * simple unreachable/timeout message.
 */
export function transportFailureMessage(tool, cls, port) {
  if (tool.mutating) {
    return `OUTCOME UNKNOWN: the ${tool.name} request ${cls === 'timeout' ? 'timed out' : 'lost its connection'} after dispatch — the app may have completed the send/submit anyway. Do NOT retry automatically: verify in Outlook/the form (and the app's audit outbox) first, then decide with the principal.`;
  }
  return `ClawX host-API ${cls === 'timeout' ? 'timed out' : 'is not reachable'} on 127.0.0.1:${port} — is the Ministry of Education app running?`;
}

export function buildServer(token) {
  const server = new Server(
    { name: 'clawx-hostapi', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_TABLE.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
    const tool = TOOL_TABLE.find((t) => t.name === req.params.name);
    if (!tool) {
      return { content: [{ type: 'text', text: `Unknown tool: ${req.params.name}` }], isError: true };
    }
    const args = req.params.arguments ?? {};
    logErr(`call ${tool.name} args: ${logSafeArgSummary(args)}`);
    try {
      const { httpStatus, body } = await callHostApi(tool.route, args, token, extra?.signal);
      logErr(`done ${tool.name} http=${httpStatus} success=${body?.success === true}`);
      // The host-API result (incl. readable refusals from the server-side
      // gates) is returned verbatim — the adapter adds nothing and hides
      // nothing from the client.
      return {
        content: [{ type: 'text', text: JSON.stringify(body?.data ?? body, null, 2) }],
        isError: httpStatus !== 200 || body?.success !== true,
      };
    } catch (err) {
      const cls = err?.name === 'AbortError' || err?.name === 'TimeoutError' ? 'timeout' : 'unreachable';
      logErr(`fail ${tool.name} class=${cls}${tool.mutating ? ' outcome=UNKNOWN' : ''}`);
      return {
        content: [{ type: 'text', text: transportFailureMessage(tool, cls, HOST_API_PORT) }],
        isError: true,
      };
    }
  });
  return server;
}

/** Start the stdio server with an in-memory token (used by main() and by
 * scripts/clawx-mcp-launcher.mjs, which recovers the token itself so it
 * never appears in ANY argv — Codex finding, 2026-09-06). */
export async function startServer(token) {
  const server = buildServer(token.trim());
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logErr(`ready: ${TOOL_TABLE.length} tools proxied to 127.0.0.1:${HOST_API_PORT} (gates stay server-side)`);
  return server;
}

async function main() {
  const token = process.env.CLAWX_HOST_API_TOKEN;
  if (!token || !token.trim()) {
    // Fail fast and readable; the token is per-boot and in-memory only.
    process.stderr.write(
      'FATAL: CLAWX_HOST_API_TOKEN is not set. The ClawX host-API bearer token must be provided via env (never argv) '
      + '— or use scripts/clawx-mcp-launcher.mjs, which recovers the per-boot token in-process so it never touches argv at all.\n',
    );
    process.exit(4);
  }
  await startServer(token);
}

// Realpath comparison — a symlinked invocation must still run main()
// (harness-artifact isolation-lens lesson, 2026-09-06).
function isDirectInvocation() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(path.resolve(process.argv[1]))).href;
  } catch {
    return false;
  }
}

if (isDirectInvocation()) {
  main().catch((err) => {
    process.stderr.write(`clawx-mcp-server crashed: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exit(1);
  });
}
