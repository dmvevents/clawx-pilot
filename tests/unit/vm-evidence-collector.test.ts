import { createHash } from 'node:crypto';
import { createServer, type Socket } from 'node:net';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { platform, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';

const scriptPath = join(process.cwd(), 'scripts', 'vm-verify-moe19.sh');
const gatewayProducerPath = join(process.cwd(), 'windows-pilot', 'scripts', 'pilot-run-installed-gateway-smoke.ps1');
const script = readFileSync(scriptPath, 'utf8');
const gatewayProducer = readFileSync(gatewayProducerPath, 'utf8');
const require = createRequire(import.meta.url);
// This collector runs on the macOS/Linux SSH controller. Its PowerShell and
// embedded Node producers below remain covered on native Windows.
const posixControllerIt = platform() === 'win32' ? it.skip : it;

function indexOfOrThrow(needle: string): number {
  const index = script.indexOf(needle);
  if (index < 0) throw new Error(`missing script fragment: ${needle}`);
  return index;
}

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function collectorHelpers(): string {
  const start = script.indexOf('record_evidence_file() {');
  const end = script.indexOf('write_vm_run_json() {');
  if (start < 0 || end < 0 || end <= start) throw new Error('collector helper bounds not found');
  return script.slice(start, end);
}

function vmRunWriterHelper(): string {
  const start = script.indexOf('write_vm_run_json() {');
  const end = script.indexOf('trap write_vm_run_json EXIT');
  if (start < 0 || end < 0 || end <= start) throw new Error('vm-run writer helper bounds not found');
  return script.slice(start, end);
}

function gatewaySystemPresenceProbeScript(): string {
  const match = gatewayProducer.match(/\$scriptText = @'\n([\s\S]*?)\n'@/);
  if (!match?.[1]) throw new Error('gateway system-presence probe helper not found');
  return match[1];
}

async function bundledGatewayClientContract(): Promise<{ ids: string[]; modes: string[] }> {
  const distDir = dirname(require.resolve('openclaw'));
  const contractFile = readdirSync(distDir).find((name) => /^message-channel-.*\.js$/.test(name));
  if (!contractFile) throw new Error('OpenClaw message-channel contract module not found');
  const contract = await import(pathToFileURL(join(distDir, contractFile)).href) as {
    m?: Record<string, string>;
    h?: Record<string, string>;
  };
  return {
    ids: Object.values(contract.m ?? {}),
    modes: Object.values(contract.h ?? {}),
  };
}

async function bundledSystemPresenceScopes(): Promise<string[]> {
  const distDir = dirname(require.resolve('openclaw'));
  const contractFile = readdirSync(distDir).find((name) => /^method-scopes-.*\.js$/.test(name));
  if (!contractFile) throw new Error('OpenClaw method-scopes contract module not found');
  const contract = await import(pathToFileURL(join(distDir, contractFile)).href) as {
    a?: (method: string) => string[];
  };
  const scopes = contract.a?.('system-presence');
  if (!Array.isArray(scopes)) throw new Error('OpenClaw system-presence scope resolver not found');
  return scopes;
}

function gatewayConnectParamsLiteral(): string {
  const helper = gatewaySystemPresenceProbeScript();
  const connect = helper.match(/method: 'connect',[\s\S]*?params: \{([\s\S]*?)\n\s{6}\},\n\s{4}\}\)\);/);
  if (!connect?.[1]) throw new Error('gateway connect params literal not found');
  return connect[1];
}

function gatewayHelperScopes(): string[] {
  const scopes = gatewayConnectParamsLiteral().match(/scopes: \[([^\]]*)\]/)?.[1];
  if (!scopes) throw new Error('gateway helper scopes not found');
  return [...scopes.matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

function gatewayHelperClientIdentity(): { id: string | undefined; mode: string | undefined } {
  const helper = gatewaySystemPresenceProbeScript();
  const clientBlock = helper.match(/client: \{([\s\S]*?)\n\s{8}\},/);
  return {
    id: clientBlock?.[1]?.match(/id: '([^']+)'/)?.[1],
    mode: clientBlock?.[1]?.match(/mode: '([^']+)'/)?.[1],
  };
}

function gatewaySystemPresenceEnv(port: number, token: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    CLAWX_SMOKE_GATEWAY_PORT: String(port),
    CLAWX_SMOKE_GATEWAY_TOKEN: token,
    CLAWX_SMOKE_RPC_TIMEOUT_MS: '500',
  };
}

function writeGatewaySystemPresenceHelper(evidenceDir: string): string {
  const helper = join(evidenceDir, 'system-presence-rpc-smoke.cjs');
  writeFileSync(helper, gatewaySystemPresenceProbeScript());
  return helper;
}

function runGatewaySystemPresenceProbe(evidenceDir: string, port: number, token = 'pilot-smoke-token') {
  const helper = writeGatewaySystemPresenceHelper(evidenceDir);
  return spawnSync(process.execPath, [helper], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: gatewaySystemPresenceEnv(port, token),
  });
}

async function runGatewaySystemPresenceProbeAsync(evidenceDir: string, port: number, token = 'pilot-smoke-token') {
  const helper = writeGatewaySystemPresenceHelper(evidenceDir);
  return await new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [helper], {
      cwd: process.cwd(),
      env: gatewaySystemPresenceEnv(port, token),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

async function closeWebSocketServer(server: WebSocketServer): Promise<void> {
  for (const client of server.clients) client.terminate();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function withMockGateway(
  options: { expectedToken?: string; expectedClient?: { id: string; mode: string }; expectedScopes?: string[]; systemPresenceOk?: boolean },
  fn: (port: number) => Promise<void> | void,
): Promise<void> {
  const server = new WebSocketServer({ port: 0 });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  server.on('connection', (socket) => {
    socket.send(JSON.stringify({ type: 'event', event: 'connect.challenge', payload: { nonce: 'unit-nonce' } }));
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString()) as {
        id?: string;
        method?: string;
        params?: { auth?: { token?: string }; client?: { id?: string; mode?: string }; scopes?: string[] };
      };
      if (message.method === 'connect') {
        const tokenMatches = message.params?.auth?.token === (options.expectedToken ?? 'pilot-smoke-token');
        const scopes = Array.isArray(message.params?.scopes) ? message.params.scopes : [];
        const expectedScopes = options.expectedScopes ?? ['operator.read'];
        const expectedClient = options.expectedClient ?? { id: 'gateway-client', mode: 'backend' };
        const scopesMatch = scopes.length === expectedScopes.length
          && expectedScopes.every((scope, index) => scopes[index] === scope);
        const clientMatches = message.params?.client?.id === expectedClient.id
          && message.params.client.mode === expectedClient.mode;
        socket.send(JSON.stringify(tokenMatches && scopesMatch && clientMatches
          ? { type: 'res', id: message.id, ok: true, payload: { connected: true } }
          : {
            type: 'res',
            id: message.id,
            ok: false,
            error: { code: tokenMatches ? (scopesMatch ? 'CLIENT_IDENTITY_MISMATCH' : 'SCOPE_MISMATCH') : 'AUTH_TOKEN_MISMATCH' },
          }));
        return;
      }
      if (message.method === 'system-presence') {
        socket.send(JSON.stringify(options.systemPresenceOk === false
          ? { type: 'res', id: message.id, ok: false, error: { code: 'NOT_READY' } }
          : { type: 'res', id: message.id, ok: true, payload: { state: 'ready' } }));
      }
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('mock gateway did not expose a TCP port');
  try {
    await fn(address.port);
  } finally {
    await closeWebSocketServer(server);
  }
}

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'clawx-vm-evidence-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function withTempDirAsync<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'clawx-vm-evidence-'));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeExecutable(path: string, body: string): void {
  writeFileSync(path, body);
  chmodSync(path, 0o755);
}

function runCollectorInvocation(evidenceDir: string, invocation: string) {
  const runner = join(evidenceDir, 'runner.sh');
  writeFileSync(
    runner,
    `#!/usr/bin/env bash
set -euo pipefail
EVIDENCE_DIR=${shQuote(evidenceDir)}
EVIDENCE_FILES=""
VM_RUN_RESULT="NOT_RUN"
log() { printf 'LOG:%s\\n' "$*"; }
${collectorHelpers()}
${invocation}
`,
  );
  chmodSync(runner, 0o755);
  return spawnSync('bash', [runner], { encoding: 'utf8' });
}

function runVmRunWriterInvocation(evidenceDir: string, evidenceFiles: string) {
  const runner = join(evidenceDir, 'vm-run-writer.sh');
  writeFileSync(
    runner,
    `#!/usr/bin/env bash
set -euo pipefail
VM_RUN_JSON=${shQuote(join(evidenceDir, 'vm-run.json'))}
RUN_TAG="unit-run"
STARTED_AT="2026-09-07T00:00:00.000Z"
COMPLETED_AT=""
VM_RUN_RESULT="NOT_RUN"
VM_RUN_EXIT_CODE=""
EXE="/repo/release/Ministry of Education-test-win-x64.exe"
SHA="${'a'.repeat(64)}"
GUEST_DL="C:\\\\Users\\\\clawxtest\\\\Downloads"
GUEST_SHA="${'a'.repeat(64)}"
GUEST_APP="C:\\\\Users\\\\clawxtest\\\\AppData\\\\Local\\\\Programs\\\\Ministry of Education"
INSTALL_EXIT="0"
RUNNING_APP_VERSION="0.4.3-moe.99"
RUNNING_APP_PATH="C:\\\\Users\\\\clawxtest\\\\AppData\\\\Local\\\\Programs\\\\Ministry of Education\\\\Ministry of Education.exe"
GATEWAY_PORT_READY=true
HOSTAPI_PORT_READY=true
APP_ASAR_SHA="${'b'.repeat(64)}"
EVIDENCE_FILES=${shQuote(evidenceFiles)}
${vmRunWriterHelper()}
true
write_vm_run_json
`,
  );
  chmodSync(runner, 0o755);
  return spawnSync('bash', [runner], { encoding: 'utf8' });
}

describe('vm-verify moe.19 evidence collection contract', () => {
  posixControllerIt('is valid bash after evidence collector changes', () => {
    expect(() => execFileSync('bash', ['-n', scriptPath], { stdio: 'pipe' })).not.toThrow();
  });

  posixControllerIt('captures producer stdout and stderr sidecar bytes and records hashes', () => {
    withTempDir((dir) => {
      const producer = join(dir, 'producer.sh');
      writeExecutable(
        producer,
        `#!/usr/bin/env bash
printf 'alpha\\r\\n'
printf 'warning\\r\\n' >&2
`,
      );

      const result = runCollectorInvocation(
        dir,
        `run_guest_producer "mock producer" "mock.txt" ${shQuote(producer)}
printf '%s' "$EVIDENCE_FILES" > ${shQuote(join(dir, 'evidence-files.txt'))}
`,
      );

      expect(result.status).toBe(0);
      const stdoutPath = join(dir, 'mock.txt');
      const stderrPath = join(dir, 'mock.txt.stderr.txt');
      expect(readFileSync(stdoutPath, 'utf8')).toBe('alpha\n');
      expect(readFileSync(stderrPath, 'utf8')).toBe('warning\n');
      const evidenceFiles = readFileSync(join(dir, 'evidence-files.txt'), 'utf8');
      expect(evidenceFiles).toContain(`mock.txt=${sha256(stdoutPath)}`);
      expect(evidenceFiles).toContain(`mock.txt.stderr.txt=${sha256(stderrPath)}`);
    });
  });

  posixControllerIt('classifies gateway producer prerequisite exits as BLOCKED with captured output', () => {
    withTempDir((dir) => {
      const producer = join(dir, 'gateway-blocked.sh');
      writeExecutable(
        producer,
        `#!/usr/bin/env bash
printf 'STATE:RESULT=PREREQ_MISSING\\r\\n'
printf 'missing node\\r\\n' >&2
exit 2
`,
      );

      const result = runCollectorInvocation(
        dir,
        `run_guest_producer "gateway" "gateway-smoke.txt" ${shQuote(producer)}
`,
      );

      expect(result.status).toBe(3);
      expect(result.stdout).toContain('BLOCKED: gateway prerequisite exited 2');
      expect(readFileSync(join(dir, 'gateway-smoke.txt'), 'utf8')).toBe('STATE:RESULT=PREREQ_MISSING\n');
      expect(readFileSync(join(dir, 'gateway-smoke.txt.stderr.txt'), 'utf8')).toBe('missing node\n');
    });
  });

  posixControllerIt('classifies Electron CDP producer exit 4 as BLOCKED, not product failure', () => {
    withTempDir((dir) => {
      const producer = join(dir, 'electron-blocked.sh');
      writeExecutable(
        producer,
        `#!/usr/bin/env bash
printf '{"result":"blocked"}\\r\\n'
printf 'cdp unavailable\\r\\n' >&2
exit 4
`,
      );

      const result = runCollectorInvocation(
        dir,
        `run_guest_producer "electron" "electron-probe-run.txt" ${shQuote(producer)}
`,
      );

      expect(result.status).toBe(3);
      expect(result.stdout).toContain('BLOCKED: electron prerequisite exited 4');
      expect(readFileSync(join(dir, 'electron-probe-run.txt'), 'utf8')).toBe('{"result":"blocked"}\n');
      expect(readFileSync(join(dir, 'electron-probe-run.txt.stderr.txt'), 'utf8')).toBe('cdp unavailable\n');
    });
  });

  posixControllerIt('does not treat every exit 2 as BLOCKED', () => {
    withTempDir((dir) => {
      const producer = join(dir, 'office-fail.sh');
      writeExecutable(
        producer,
        `#!/usr/bin/env bash
printf 'STATE:RESULT=FAIL\\r\\n'
printf 'assertion failed\\r\\n' >&2
exit 2
`,
      );

      const result = runCollectorInvocation(
        dir,
        `run_guest_producer "office" "office-runtime.txt" ${shQuote(producer)}
`,
      );

      expect(result.status).toBe(1);
      expect(result.stdout).toContain('FAIL: office exited 2');
      expect(readFileSync(join(dir, 'office-runtime.txt.stderr.txt'), 'utf8')).toBe('assertion failed\n');
    });
  });

  posixControllerIt('writes only portable acceptance evidence entries into vm-run metadata', () => {
    withTempDir((dir) => {
      const result = runVmRunWriterInvocation(
        dir,
        [
          `environment.json=${'8'.repeat(64)}`,
          `install-artifacts.json=${'1'.repeat(64)}`,
          `pre-install-backup.txt=${'2'.repeat(64)}`,
          `gateway-smoke.txt.stderr.txt=${'3'.repeat(64)}`,
          `electron-probe-run.txt=${'4'.repeat(64)}`,
          `clawx-electron-probe-2026-09-07T01-04-00-000Z.json=${'5'.repeat(64)}`,
          `clawxapp-task.txt=${'6'.repeat(64)}`,
        ].join('\n'),
      );

      expect(result.status).toBe(0);
      const vmRun = JSON.parse(readFileSync(join(dir, 'vm-run.json'), 'utf8')) as {
        evidenceFiles: Array<{ path: string }>;
      };
      expect(vmRun.evidenceFiles.map((entry) => entry.path)).toEqual([
        'environment.json',
        'install-artifacts.json',
        'electron-probe-run.txt',
        'clawx-electron-probe-2026-09-07T01-04-00-000Z.json',
      ]);
      expect(vmRun).toMatchObject({ environment: { path: 'environment.json' } });
    });
  });

  it('runs the canonical IAP lane probe with isolated probe ports before using the authenticated tunnel', () => {
    const canonicalProbe = indexOfOrThrow('log "canonical IAP lane probe (separate local ports)"');
    const authenticatedProbe = indexOfOrThrow("GUEST_PROBE=$(guest 'echo GUEST_SSH_OK'");
    const environmentProbe = indexOfOrThrow('log "pre-mutation Windows environment profile"');

    expect(canonicalProbe).toBeLessThan(authenticatedProbe);
    expect(authenticatedProbe).toBeLessThan(environmentProbe);
    expect(script).toContain('IAP_PROBE_RDP_PORT="${CLAWX_IAP_PROBE_RDP_PORT:-25389}"');
    expect(script).toContain('IAP_PROBE_SSH_PORT="${CLAWX_IAP_PROBE_SSH_PORT:-25322}"');
    expect(script).toContain('IAP_PROBE_CONTROL_PORT="${CLAWX_IAP_PROBE_CONTROL_PORT:-25399}"');
    expect(script).toContain('CLAWX_RDP_PORT="$IAP_PROBE_RDP_PORT"');
    expect(script).toContain('CLAWX_SSH_PORT="$IAP_PROBE_SSH_PORT"');
    expect(script).toContain('CLAWX_CONTROL_PORT="$IAP_PROBE_CONTROL_PORT"');
    expect(script).toContain('"$REPO_ROOT/windows-pilot/vm-testing/gcp-iap-lane.sh" probe');
    expect(script).not.toContain('localhost 9999');
  });

  it('collects the Windows environment profile before installer copy or preinstall mutation', () => {
    const environmentProbe = indexOfOrThrow('log "pre-mutation Windows environment profile"');
    const installerCopy = indexOfOrThrow('log "copying installer to guest (430MB over IAP — minutes) ..."');
    const preMutationState = indexOfOrThrow('log "pre-mutation guest state snapshot"');
    const backup = indexOfOrThrow('run_guest_producer "pre-install backup of app data and OpenClaw state" "pre-install-backup.txt"');

    expect(environmentProbe).toBeLessThan(installerCopy);
    expect(environmentProbe).toBeLessThan(preMutationState);
    expect(environmentProbe).toBeLessThan(backup);
    expect(script).toContain('$REPO_ROOT/windows-pilot/scripts/pilot-fresh-install-environment.ps1');
    expect(script).toContain('-Mode Probe -JsonOutputPath');
    expect(script).toContain('scp -P "$SSH_PORT" "$GUEST_USER@localhost:Downloads/clawx-environment-$RUN_TAG.json" "$EVIDENCE_DIR/environment.json"');
    expect(script).toContain('record_evidence_file "environment.json"');
  });

  it('backs up existing app data/OpenClaw state and records absent clean-install state without content', () => {
    const backup = script.slice(
      indexOfOrThrow('run_guest_producer "pre-install backup of app data and OpenClaw state" "pre-install-backup.txt"'),
      indexOfOrThrow('# ── Phase 4 — stop app, ENFORCED install'),
    );

    expect(script).toContain('GUEST_BACKUP_DIR="$GUEST_DL\\\\clawx-preinstall-backup-$RUN_TAG"');
    expect(backup).toContain('Test-Path -LiteralPath $source -ErrorAction Stop');
    expect(backup).toContain('Copy-Item -LiteralPath $source -Destination $destination -Recurse -Force -ErrorAction Stop');
    expect(backup).toContain('Write-State "${id}_PRESENT" "False"');
    expect(backup).toContain('Copy-StateDir "APPDATA_MINISTRY" "$env:APPDATA\\Ministry of Education"');
    expect(backup).toContain('Copy-StateDir "OPENCLAW" "$env:USERPROFILE\\.openclaw"');
    expect(backup).toContain('FILE_COUNT');
    expect(backup).toContain('DIR_COUNT');
    expect(backup).toContain('BYTE_COUNT');
    expect(backup).not.toMatch(/Get-Content|cat /i);
  });

  it('runs canonical installed producers in the required order before visible launch', () => {
    const installDone = indexOfOrThrow('log "installed app.asar sha256=$APP_ASAR_SHA"');
    const gatewaySmoke = indexOfOrThrow('pilot-run-installed-gateway-smoke.ps1\\" -Port 18789');
    const officeRuntime = indexOfOrThrow('pilot-office-runtime-check.ps1\\"');
    const officeWrite = indexOfOrThrow('pilot-office-write-smoke.ps1\\"');
    const visibleLaunch = indexOfOrThrow('log "visible relaunch (scheduled task; never Hidden)"');

    expect(installDone).toBeLessThan(gatewaySmoke);
    expect(gatewaySmoke).toBeLessThan(officeRuntime);
    expect(officeRuntime).toBeLessThan(officeWrite);
    expect(officeWrite).toBeLessThan(visibleLaunch);
    for (const producer of [
      'pilot-fresh-install-environment.ps1',
      'pilot-check-install-artifacts.ps1',
      'pilot-run-installed-gateway-smoke.ps1',
      'pilot-office-runtime-check.ps1',
      'pilot-office-write-smoke.ps1',
      'pilot-run-electron-cdp-probe.ps1',
      'pilot-electron-cdp-probe.js',
    ]) {
      expect(script).toContain(`$REPO_ROOT/windows-pilot/scripts/${producer}`);
    }
    expect(script).not.toContain('$REPO_ROOT/skills/laptop/scripts/pilot-office-runtime-check.ps1');
  });

  it('requires a CDP-enabled scheduled task and waits for the launched process before attesting', () => {
    const launch = script.slice(
      indexOfOrThrow('log "visible relaunch (scheduled task; never Hidden)"'),
      indexOfOrThrow('scp -P "$SSH_PORT" "$REPO_ROOT/windows-pilot/scripts/pilot-run-electron-cdp-probe.ps1"'),
    );

    expect(launch).toContain('schtasks /query /tn ClawXApp /fo LIST /v');
    expect(launch).toContain("grep -q -- '--remote-debugging-port=9223'");
    expect(launch).toContain('VM_RUN_RESULT="BLOCKED"');
    expect(launch).toContain('AddSeconds(120)');
    expect(launch).toContain('Get-Process "Ministry of Education"');
    expect(launch).toContain('"9223 electron-cdp"');
    expect(launch).toContain('Electron CDP 9223 did not come up');
    expect(launch).not.toContain('sleep 60');
  });

  it('copies only the current-run safe Electron probe JSON identified by producer output', () => {
    const commandStart = indexOfOrThrow('pilot-run-electron-cdp-probe.ps1\\" -SafeChat -SafeChatMode outlook-open');
    const command = script.slice(commandStart, script.indexOf('\n', commandStart));

    expect(script).toMatch(/PROBE_ARTIFACT_DIR="\$GUEST_DL\\\\clawx-electron-probe-\$RUN_TAG"/);
    expect(script).toContain('PROBE_SUMMARY_PATH=$(node - "$EVIDENCE_DIR/electron-probe-run.txt"');
    expect(script).toContain('data.summaryPath');
    expect(script).toContain('summaryPath did not point at the current run artifact dir');
    expect(script).not.toContain("Get-ChildItem '$PROBE_ARTIFACT_DIR' -Filter 'clawx-electron-probe-*.json'");
    expect(script).toContain('scp -P "$SSH_PORT" "$GUEST_USER@localhost:Downloads/clawx-electron-probe-$RUN_TAG/$PROBE_JSON" "$EVIDENCE_DIR/$PROBE_JSON"');
    expect(command).toContain('-SafeChat -SafeChatMode outlook-open');
    expect(command).not.toContain('-SendEmail');
    expect(command).not.toContain('-SubmitForms');
    expect(command).not.toContain('-OutlookSendMatrix');
    expect(command).not.toContain('-DraftEmail');
  });

  it('uses client identity values allowed by the bundled OpenClaw gateway contract', async () => {
    const { id, mode } = gatewayHelperClientIdentity();
    const contract = await bundledGatewayClientContract();

    expect(id).toBe('gateway-client');
    expect(mode).toBe('backend');
    expect(contract.ids).toContain(id);
    expect(contract.modes).toContain(mode);
  });

  it('uses the bundled least-privilege scope required for system-presence', async () => {
    const scopes = gatewayHelperScopes();
    const bundledScopes = await bundledSystemPresenceScopes();

    expect(scopes).toEqual(['operator.read']);
    expect(scopes).toEqual(bundledScopes);
    expect(scopes).not.toContain('operator.admin');
  });

  it('embedded gateway probe rejects TCP-only readiness without system-presence RPC', async () => {
    await withTempDirAsync(async (dir) => {
      const sockets = new Set<Socket>();
      const server = createServer((socket) => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('TCP test server did not expose a port');
      try {
        const result = runGatewaySystemPresenceProbe(dir, address.port);
        expect(result.status).toBe(1);
        expect(result.stdout).toContain('STATE:SYSTEM_PRESENCE_RPC=false');
        expect(result.stdout).not.toContain('STATE:SYSTEM_PRESENCE_RPC=true');
      } finally {
        for (const socket of sockets) socket.destroy();
        await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      }
    });
  });

  it('embedded gateway probe rejects denied authenticated handshakes', async () => {
    await withTempDirAsync(async (dir) => {
      await withMockGateway({ expectedToken: 'expected-token' }, async (port) => {
        const result = await runGatewaySystemPresenceProbeAsync(dir, port, 'wrong-token');
        expect(result.status).toBe(1);
        expect(result.stdout).toContain('STATE:SYSTEM_PRESENCE_CHALLENGE=true');
        expect(result.stdout).toContain('STATE:SYSTEM_PRESENCE_REASON=connect_denied');
        expect(result.stdout).toContain('STATE:SYSTEM_PRESENCE_RPC=false');
      });
    });
  });

  it('embedded gateway probe passes only after authenticated system-presence RPC succeeds', async () => {
    await withTempDirAsync(async (dir) => {
      await withMockGateway({ expectedToken: 'pilot-smoke-token', systemPresenceOk: true }, async (port) => {
        const result = await runGatewaySystemPresenceProbeAsync(dir, port);
        expect(result.status).toBe(0);
        expect(result.stdout).toContain('STATE:SYSTEM_PRESENCE_CHALLENGE=true');
        expect(result.stdout).toContain('STATE:SYSTEM_PRESENCE_HANDSHAKE=true');
        expect(result.stdout).toContain('STATE:SYSTEM_PRESENCE_RPC=true');
        expect(result.stdout).not.toMatch(/pilot-smoke-token|expected-token|wrong-token/);
      });
    });
  });

  it('invokes gateway safe evidence mode and guards sensitive producer states from portable output', () => {
    expect(script).toContain('-ArtifactRoot \\"$GUEST_DL\\" -EvidenceOnly');
    expect(gatewayProducer).toContain('[switch] $EvidenceOnly');
    expect(gatewayProducer).toContain('Write-State "SAFE_METADATA_ONLY" "true"');
    expect(gatewayProducer).toContain('if (-not $EvidenceOnly) { Write-State "ARGUMENT_LINE" $argumentLine }');
    expect(gatewayProducer).toContain('if (-not $EvidenceOnly) { Write-State "ERROR" $_.Exception.Message }');
    expect(gatewayProducer).toContain('Invoke-SystemPresenceRpc $nodeExe $cwd $artifact $Port $Token');
    expect(gatewayProducer).toContain('if ($systemPresence.Ok)');
    expect(gatewayProducer).toContain('Write-State "GATEWAY_TCP_READY" $tcpReady');
    expect(gatewayProducer).toContain('Write-State "SYSTEM_PRESENCE_RPC" "false"');
    expect(gatewayProducer).toContain('Write-State "RESULT" "FAILED_SYSTEM_PRESENCE_RPC"');
    expect(gatewayProducer).toContain('if (-not $EvidenceOnly) {');
    expect(gatewayProducer).toContain('Write-State "STDOUT" $_');
    expect(gatewayProducer).toContain('Write-State "STDERR" $_');

    const portableGatewayFixture = [
      'STATE:SAFE_METADATA_ONLY=true',
      'STATE:RESULT=COMPLETE',
      'STATE:NODE_EXISTS=true',
      'STATE:ENTRY_EXISTS=true',
      'STATE:CWD_EXISTS=true',
      'STATE:PLAYWRIGHT_CORE_EXISTS=true',
      'STATE:GATEWAY_TCP_READY=true',
      'STATE:SYSTEM_PRESENCE_CHALLENGE=true',
      'STATE:SYSTEM_PRESENCE_HANDSHAKE=true',
      'STATE:SYSTEM_PRESENCE_RPC=true',
      'STATE:GATEWAY_READY=true',
      'STATE:GATEWAY_EXITED=false',
    ].join('\n');
    expect(portableGatewayFixture).not.toMatch(/secret-token-sentinel|teacher@example\.edu|https:\/\/private\.example\.invalid/);
  });

  it('records captured producer outputs and sidecars without teeing raw producer streams', () => {
    expect(script).toContain('tr -d \'\\r\' < "$stdout_tmp" > "$EVIDENCE_DIR/$output"');
    expect(script).toContain('tr -d \'\\r\' < "$stderr_tmp" > "$EVIDENCE_DIR/$stderr_file"');
    expect(script).toContain('record_evidence_file "$output"');
    expect(script).toContain('[ -s "$EVIDENCE_DIR/$stderr_file" ] && record_evidence_file "$stderr_file"');
    expect(script).not.toContain('| tee "$EVIDENCE_DIR/gateway-smoke.txt"');
    expect(script).not.toContain('| tee "$EVIDENCE_DIR/electron-probe-run.txt"');
  });
});
