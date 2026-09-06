/**
 * CLWX-71 guards: the MCP adapter's tool table, log hygiene, and fail-fast
 * token contract (scripts/clawx-mcp-server.mjs). The live handshake + gate
 * proof runs in scripts/clwx71-mcp-handshake.ts against the running app;
 * these pin the pure surfaces.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mod: any;

async function load() {
  if (!mod) mod = await import('../../scripts/clawx-mcp-server.mjs');
  return mod;
}

const SERVER_PATH = path.resolve(__dirname, '../../scripts/clawx-mcp-server.mjs');

describe('TOOL_TABLE contract (CLWX-71)', () => {
  it('exposes exactly the nine sanctioned tools', async () => {
    const { TOOL_TABLE } = await load();
    const names = TOOL_TABLE.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual([
      'forms_list', 'forms_preview_daily_report', 'forms_preview_suspension',
      'forms_submit_daily_report', 'forms_submit_suspension',
      'outlook_draft_email', 'outlook_open', 'outlook_read_inbox', 'outlook_send_email',
    ]);
    expect(new Set(names).size).toBe(9);
  });

  it('every tool proxies a host-API forms/outlook route with an object schema', async () => {
    const { TOOL_TABLE } = await load();
    for (const tool of TOOL_TABLE) {
      expect(tool.route).toMatch(/^\/api\/(forms|outlook)\//);
      expect(tool.inputSchema.type).toBe('object');
      expect(typeof tool.description).toBe('string');
    }
  });

  it('the gated tools carry the hard-gate + sandbox contract in their descriptions', async () => {
    const { TOOL_TABLE } = await load();
    for (const name of ['forms_submit_daily_report', 'forms_submit_suspension', 'outlook_send_email']) {
      const tool = TOOL_TABLE.find((t: { name: string }) => t.name === name);
      expect(tool.description).toMatch(/HARD GATE/);
      expect(tool.description).toMatch(/confirm:true/);
      expect(tool.description).toMatch(/test\.fac sandbox only/);
    }
    // The two-gate send names BOTH gates.
    const send = TOOL_TABLE.find((t: { name: string }) => t.name === 'outlook_send_email');
    expect(send.description).toMatch(/TWO-GATE/);
    expect(send.description).toMatch(/subject matching/i);
  });
});

describe('log hygiene (CLWX-71 acceptance 4: counts only, never bodies)', () => {
  it('logSafeArgSummary never emits argument values', async () => {
    const { logSafeArgSummary } = await load();
    const out = logSafeArgSummary({
      to: ['principal@moe.gov.tt', 'second@moe.gov.tt'],
      subject: 'CONFIDENTIAL suspension of Student A',
      body: 'secret body text',
      confirm: false,
      payload: { school: 'Demo Primary', headcount: 412 },
    });
    expect(out).toContain('to[2]');
    expect(out).toContain('subject');
    expect(out).toContain('payload{2}');
    expect(out).toContain('confirm=false');
    expect(out).not.toMatch(/CONFIDENTIAL|secret|moe\.gov\.tt|Demo Primary|412/);
  });

  it('handles empty and non-object args', async () => {
    const { logSafeArgSummary } = await load();
    expect(logSafeArgSummary(undefined)).toBe('none');
    expect(logSafeArgSummary({})).toBe('');
  });

  it('withholds non-identifier KEY NAMES — a key carrying content or newlines can neither leak nor forge log lines (Codex M1)', async () => {
    const { logSafeArgSummary } = await load();
    const out = logSafeArgSummary({
      'CONFIDENTIAL: Student A suspended\n[forged-log-line]': 1,
      'subject line smuggled as a key': 2,
      confirm: true,
    });
    expect(out).toContain('confirm=true');
    expect(out).toContain('+2 non-identifier key(s) withheld');
    expect(out).not.toMatch(/CONFIDENTIAL|Student A|smuggled|forged/);
    expect(out).not.toContain('\n');
  });

  it('transport failures on MUTATING tools report OUTCOME UNKNOWN and forbid automatic retry (Codex H2)', async () => {
    const { transportFailureMessage, TOOL_TABLE } = await load();
    const send = TOOL_TABLE.find((t: { name: string }) => t.name === 'outlook_send_email');
    const read = TOOL_TABLE.find((t: { name: string }) => t.name === 'outlook_read_inbox');
    const sendMsg = transportFailureMessage(send, 'timeout', 13210);
    expect(sendMsg).toMatch(/OUTCOME UNKNOWN/);
    expect(sendMsg).toMatch(/Do NOT retry automatically/i);
    expect(sendMsg).toMatch(/verify in Outlook/i);
    const readMsg = transportFailureMessage(read, 'unreachable', 13210);
    expect(readMsg).toMatch(/not reachable/);
    expect(readMsg).not.toMatch(/OUTCOME UNKNOWN/);
  });

  it('exactly the three irreversible tools are marked mutating', async () => {
    const { TOOL_TABLE } = await load();
    const mutating = TOOL_TABLE.filter((t: { mutating?: boolean }) => t.mutating).map((t: { name: string }) => t.name).sort();
    expect(mutating).toEqual(['forms_submit_daily_report', 'forms_submit_suspension', 'outlook_send_email']);
  });

  it('the server source never logs to stdout (the MCP protocol channel)', () => {
    const src = readFileSync(SERVER_PATH, 'utf8');
    expect(src).not.toMatch(/console\.log/);
    expect(src).not.toMatch(/process\.stdout\.write/);
  });
});

describe('token contract (CLWX-71 acceptance 4: env only, fail fast)', () => {
  it('refuses to start without CLAWX_HOST_API_TOKEN — exit 4, readable stderr, no token echo', () => {
    const env = { ...process.env };
    delete env.CLAWX_HOST_API_TOKEN;
    const res = spawnSync(process.execPath, [SERVER_PATH], { env, encoding: 'utf8', timeout: 30_000 });
    expect(res.status).toBe(4);
    expect(res.stderr).toMatch(/CLAWX_HOST_API_TOKEN is not set/);
    expect(res.stderr).toMatch(/never argv/);
  });

  it('the server source never puts the token in argv, logs, or errors', () => {
    const src = readFileSync(SERVER_PATH, 'utf8');
    // The token variable feeds ONLY the Authorization header.
    const uses = [...src.matchAll(/\btoken\b/g)].length;
    expect(uses).toBeGreaterThan(0);
    expect(src).not.toMatch(/logErr\([^)]*token/i);
    expect(src).not.toMatch(/argv[^\n]*token/i);
  });
});

describe('dependency classification (CLWX-71 acceptance 5, auditor rule)', () => {
  it('@modelcontextprotocol/sdk sits in dependencies, NOT devDependencies', () => {
    const pkg = JSON.parse(readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8'));
    expect(pkg.dependencies['@modelcontextprotocol/sdk']).toBeTruthy();
    expect(pkg.devDependencies?.['@modelcontextprotocol/sdk']).toBeUndefined();
  });

  it('the server imports no phantom deps (zod stays un-imported; SDK low-level API only)', () => {
    const src = readFileSync(SERVER_PATH, 'utf8');
    expect(src).not.toMatch(/from 'zod'|from "zod"/);
  });
});

describe('token-free registration (Codex M3)', () => {
  it('neither the docs nor the server header show the token inline in a registration command', () => {
    const doc = readFileSync(path.resolve(__dirname, '../../docs/MCP_ADAPTER.md'), 'utf8');
    const src = readFileSync(SERVER_PATH, 'utf8');
    for (const text of [doc, src]) {
      expect(text).not.toMatch(/mcp add[^\n]*-e CLAWX_HOST_API_TOKEN=/);
    }
    expect(doc).toContain('clawx-mcp-launcher.mjs');
  });

  it('the launcher keeps the token out of argv (spawn args carry only pids, never the token variable)', () => {
    const launcher = readFileSync(path.resolve(__dirname, '../../scripts/clawx-mcp-launcher.mjs'), 'utf8');
    expect(launcher).toMatch(/startServer\(recoverToken\(\)\)/);
    // No spawn call receives the token: the only spawnSync args are pgrep/ps
    // literals and the python pid argument.
    expect(launcher).not.toMatch(/spawnSync\([^)]*token/i);
    expect(launcher).not.toMatch(/console\.log|process\.stdout\.write/);
  });
});
