import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const scriptPath = join(process.cwd(), 'windows-pilot', 'vm-testing', 'gcp-iap-lane.sh');
// Three protocol/control legs start real mock processes. Bound the child below
// the test budget so native Windows startup cannot outlive the assertion window.
const PROBE_PROCESS_TIMEOUT_MS = 12_000;
const PROBE_TEST_TIMEOUT_MS = 15_000;
let tempDir: string;
let binDir: string;
let callsPath: string;

function writeExecutable(name: string, content: string): void {
  const target = join(binDir, name);
  writeFileSync(target, content);
  chmodSync(target, 0o755);
}


function localPortOpen(port: number): boolean {
  const result = spawnSync('python3', ['-c', `
import socket
import sys
try:
    with socket.create_connection(('127.0.0.1', int(sys.argv[1])), timeout=0.2):
        raise SystemExit(0)
except OSError:
    raise SystemExit(1)
`, String(port)]);
  return result.status === 0;
}

function runProbe(extraEnv: Record<string, string | undefined> = {}) {
  return spawnSync('bash', [scriptPath, 'probe'], {
    encoding: 'utf8',
    timeout: PROBE_PROCESS_TIMEOUT_MS,
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ''}`,
      CLAWX_GCP_PROJECT: 'clawx-test-project',
      CLAWX_IAP_READY_TIMEOUT_SECONDS: '3',
      CLAWX_IAP_READY_POLL_SECONDS: '0.05',
      CLAWX_RDP_PORT: '31089',
      CLAWX_SSH_PORT: '31022',
      CLAWX_CONTROL_PORT: '31999',
      MOCK_VM_STATUS: 'RUNNING',
      MOCK_RDP: 'pass',
      MOCK_SSH: 'pass',
      MOCK_CONTROL: 'provider-reject',
      MOCK_OCCUPIED_PORTS: '',
      MOCK_CALLS: callsPath,
      ...extraEnv,
    },
  });
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'clwx-iap-lane-'));
  binDir = join(tempDir, 'bin');
  mkdirSync(binDir);
  callsPath = join(tempDir, 'calls.log');

  writeExecutable('gcloud', `#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"${callsPath}"
if [[ "$*" == *"config get-value project"* ]]; then
  printf '%s\n' "${'${MOCK_CONFIG_PROJECT:-clawx-test-project}'}"
  exit 0
fi
if [[ "$*" == *"compute instances describe"* ]]; then
  if [[ "${'${MOCK_DESCRIBE_FAIL:-0}'}" == "1" ]]; then
    echo "auth failure" >&2
    exit 1
  fi
  printf '%s %s %s\n' "${'${MOCK_VM_STATUS:-RUNNING}'}" "10.1.2.3" "34.1.2.3"
  exit 0
fi
if [[ "$*" == *"compute firewall-rules list"* ]]; then
  printf '%s\n' "clawx-allow-rdp-iap 35.235.240.0/20 3389"
  printf '%s\n' "clawx-allow-ssh-iap 35.235.240.0/20 22"
  exit 0
fi
if [[ "$*" == *"compute start-iap-tunnel"* ]]; then
  remote_port=""
  local_port=""
  for ((i=1; i<=$#; i++)); do
    arg="${'${!i}'}"
    if [[ "$arg" =~ ^[0-9]+$ && -z "$remote_port" ]]; then
      remote_port="$arg"
    fi
    case "$arg" in
      --local-host-port=localhost:*) local_port="${'${arg##*:}'}" ;;
    esac
  done
  if [[ "$remote_port" == "9999" && "${'${MOCK_CONTROL:-provider-reject}'}" == "provider-reject" ]]; then
    default_control_line="ERROR: (gcloud.compute.start-iap-tunnel) While checking if a connection can be made: Error while connecting [4003: 'failed to connect to backend']. (Failed to connect to port 9999)."
    echo "${'${MOCK_CONTROL_LINE:-$default_control_line}'}" >&2
    exit 1
  fi
  if [[ "$remote_port" == "9999" && "${'${MOCK_CONTROL:-provider-reject}'}" == "generic-fail" ]]; then
    echo "ERROR: (gcloud.compute.start-iap-tunnel) Reauthentication required" >&2
    exit 1
  fi
  mode="generic"
  if [[ "$remote_port" == "3389" ]]; then mode="rdp-${'${MOCK_RDP:-pass}'}"; fi
  if [[ "$remote_port" == "22" ]]; then mode="ssh-${'${MOCK_SSH:-pass}'}"; fi
  if [[ "$remote_port" == "9999" ]]; then mode="control-open"; fi
  exec python3 -u - "$local_port" "$mode" <<'PY'
import socket
import sys

port = int(sys.argv[1])
mode = sys.argv[2]
with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as server:
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(('127.0.0.1', port))
    server.listen(20)
    while True:
        conn, _ = server.accept()
        with conn:
            if mode == 'ssh-pass':
                conn.sendall(bytes.fromhex('5353482d322e302d4f70656e5353485f666f725f57696e646f77730d0a'))
            elif mode == 'rdp-pass':
                conn.recv(64)
                conn.sendall(bytes.fromhex('030000130ed0000012345678'))
            elif mode == 'rdp-tpkt-only':
                conn.recv(64)
                conn.sendall(bytes.fromhex('030000130e00000012345678'))
            elif mode == 'control-open':
                conn.sendall(b'open')
            else:
                conn.close()
PY
fi
if [[ "$*" == *"compute instances start"* || "$*" == *"compute instances stop"* ]]; then
  echo "done"
  exit 0
fi
echo "unexpected gcloud args: $*" >&2
exit 2
`);

  writeExecutable('nc', `#!/usr/bin/env bash
set -euo pipefail
port="${'${@: -1}'}"
case ",${'${MOCK_OCCUPIED_PORTS:-}'}," in
  *,"${'${port}'}",*) exit 0 ;;
esac
python3 - "$port" <<'PY'
import socket
import sys
try:
    with socket.create_connection(('127.0.0.1', int(sys.argv[1])), timeout=0.2):
        raise SystemExit(0)
except OSError:
    raise SystemExit(1)
PY
`);
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('gcp-iap-lane probe', () => {
  it('fails closed when the VM is stopped or unknown', () => {
    const result = runProbe({ MOCK_VM_STATUS: 'TERMINATED' });

    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('VM is TERMINATED');
    expect(readFileSync(callsPath, 'utf8')).not.toContain('start-iap-tunnel');
  }, PROBE_TEST_TIMEOUT_MS);

  it('fails closed when the closed guest-port control opens a listener', () => {
    const result = runProbe({ MOCK_CONTROL: 'open' });

    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('expected provider backend rejection for closed guest :9999');
  }, PROBE_TEST_TIMEOUT_MS);

  it('accepts the live gcloud backend-connectivity rejection for closed guest port 9999', () => {
    const result = runProbe();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('OK    control guest :9999 rejected by IAP backend connectivity check');
    const calls = readFileSync(callsPath, 'utf8');
    expect(calls).toContain('compute start-iap-tunnel clawx-win-rc-20260609 9999');
  }, PROBE_TEST_TIMEOUT_MS);



  it('rejects generic control tunnel failures that are not backend-connectivity rejections', () => {
    const result = runProbe({ MOCK_CONTROL: 'generic-fail' });

    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('exited without the expected backend/port 9999 rejection');
  }, PROBE_TEST_TIMEOUT_MS);



  it('accepts the exact live provider 4003 backend rejection line for port 9999', () => {
    const result = runProbe({
      MOCK_CONTROL_LINE: "ERROR: (gcloud.compute.start-iap-tunnel) While checking if a connection can be made: Error while connecting [4003: 'failed to connect to backend']. (Failed to connect to port 9999).",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('OK    control guest :9999 rejected by IAP backend connectivity check');
  }, PROBE_TEST_TIMEOUT_MS);

  it('rejects provider 4003 backend failures that do not name port 9999', () => {
    const result = runProbe({
      MOCK_CONTROL_LINE: "ERROR: (gcloud.compute.start-iap-tunnel) While checking if a connection can be made: Error while connecting [4003: 'failed to connect to backend'].",
    });

    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('exited without the expected backend/port 9999 rejection');
  }, PROBE_TEST_TIMEOUT_MS);

  it('does not rely on a gcloud Listening log line before protocol probes', () => {
    const result = runProbe();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('PASS  RDP protocol response');
    expect(result.stdout).toContain('PASS  SSH banner verified (not authenticated)');
  }, PROBE_TEST_TIMEOUT_MS);

  it('rejects an RDP TPKT response without the X.224 confirm byte', () => {
    const result = runProbe({ MOCK_RDP: 'tpkt-only' });

    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('FAIL  RDP protocol response');
  }, PROBE_TEST_TIMEOUT_MS);



  it('cleans up owned tunnel listener processes after the probe exits', () => {
    const result = runProbe({ CLAWX_RDP_PORT: '31189', CLAWX_SSH_PORT: '31122', CLAWX_CONTROL_PORT: '31899' });

    expect(result.status).toBe(0);
    expect(localPortOpen(31189)).toBe(false);
    expect(localPortOpen(31122)).toBe(false);
  }, PROBE_TEST_TIMEOUT_MS);

  it('refuses occupied local ports before starting tunnels', () => {
    const result = runProbe({ MOCK_OCCUPIED_PORTS: '31089' });

    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('local port 31089 is already occupied');
    expect(readFileSync(callsPath, 'utf8')).not.toContain('start-iap-tunnel');
  }, PROBE_TEST_TIMEOUT_MS);

  it('requires an explicit or configured project before probing', () => {
    const result = runProbe({ CLAWX_GCP_PROJECT: undefined, GOOGLE_CLOUD_PROJECT: undefined, MOCK_CONFIG_PROJECT: '(unset)' });

    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('GCP project is not set');
    expect(readFileSync(callsPath, 'utf8')).not.toContain('start-iap-tunnel');
  }, PROBE_TEST_TIMEOUT_MS);

  it('proves RDP protocol, SSH banner, and a dedicated closed guest control through IAP tunnels', () => {
    const result = runProbe();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('PASS  RDP protocol response');
    expect(result.stdout).toContain('PASS  SSH banner verified (not authenticated)');
    expect(result.stdout).toContain('OK    control guest :9999 rejected by IAP backend connectivity check');
    const calls = readFileSync(callsPath, 'utf8');
    expect(calls).toContain('--project=clawx-test-project compute instances describe');
    expect(calls).toContain('compute start-iap-tunnel clawx-win-rc-20260609 3389');
    expect(calls).toContain('compute start-iap-tunnel clawx-win-rc-20260609 22');
    expect(calls).toContain('compute start-iap-tunnel clawx-win-rc-20260609 9999');
  }, PROBE_TEST_TIMEOUT_MS);
});
