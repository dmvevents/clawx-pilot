import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

// CLWX-136: the Gateway runs as an Electron utilityProcess, where
// process.execPath is the GUI binary. OpenClaw spawns helper children
// (sqlite read-only/integrity workers, package lifecycle scripts) via
// process.execPath with the inherited env; without ELECTRON_RUN_AS_NODE those
// children boot the full app and break the stdout JSON contract. The shim is
// the utilityProcess entry: it sets the flag in-process (immune to any
// fork-time env filtering) and then imports the real OpenClaw entry.
//
// These tests execute the SHIPPED shim under a real Node subprocess — the
// same execution mode it has inside the utility process.
const shimPath = resolve(__dirname, '../../resources/gateway/clawx-gateway-node-mode-entry.mjs');

const tempRoot = mkdtempSync(join(tmpdir(), 'clawx-gateway-shim-'));

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

function writeFixtureEntry(): string {
  const fixture = join(tempRoot, 'fixture-entry.mjs');
  // Reports what a real OpenClaw entry would observe, then spawns a
  // process.execPath grandchild the same way the SQLite workers are spawned
  // and reports the env flag the grandchild inherited.
  writeFileSync(
    fixture,
    [
      "import { spawnSync } from 'node:child_process';",
      "const grandchild = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.env.ELECTRON_RUN_AS_NODE))'], { encoding: 'utf8' });",
      'process.stdout.write(JSON.stringify({',
      '  runAsNode: process.env.ELECTRON_RUN_AS_NODE,',
      '  argv1: process.argv[1],',
      '  args: process.argv.slice(2),',
      '  grandchildRunAsNode: grandchild.stdout,',
      '}));',
      '',
    ].join('\n'),
  );
  return fixture;
}

describe('gateway Node-mode entry shim (CLWX-136)', () => {
  it('ships as a static asset under resources/gateway', () => {
    expect(existsSync(shimPath)).toBe(true);
  });

  it('sets ELECTRON_RUN_AS_NODE in-process, restores the argv contract and forwards to the real entry', () => {
    const fixture = writeFixtureEntry();
    const stdout = execFileSync(
      process.execPath,
      [shimPath, 'gateway', '--port', '18789', '--allow-unconfigured'],
      {
        encoding: 'utf8',
        env: { ...process.env, CLAWX_GATEWAY_REAL_ENTRY: fixture, ELECTRON_RUN_AS_NODE: '' },
      },
    );

    const report = JSON.parse(stdout) as {
      runAsNode: string;
      argv1: string;
      args: string[];
      grandchildRunAsNode: string;
    };
    expect(report.runAsNode).toBe('1');
    // The real entry must observe itself at argv[1], exactly as if it had
    // been forked directly (OpenClaw and its deps may resolve from argv).
    expect(report.argv1).toBe(fixture);
    expect(report.args).toEqual(['gateway', '--port', '18789', '--allow-unconfigured']);
    // The decisive property: execPath grandchildren inherit the flag.
    expect(report.grandchildRunAsNode).toBe('1');
  });

  it('fails closed with a clear error when CLAWX_GATEWAY_REAL_ENTRY is missing', () => {
    const env = { ...process.env };
    delete env.CLAWX_GATEWAY_REAL_ENTRY;
    const result = spawnSync(process.execPath, [shimPath], { encoding: 'utf8', env });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('CLAWX_GATEWAY_REAL_ENTRY');
    expect(result.stdout).toBe('');
  });
});
