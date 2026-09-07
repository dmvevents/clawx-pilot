# pilot-run-installed-gateway-smoke.ps1
#
# Starts the packaged OpenClaw gateway directly from the installed app resources,
# captures stdout/stderr, checks readiness on 18789, and then stops it.

[CmdletBinding()]
param(
  [int] $Port = 18789,
  [int] $WaitSeconds = 150,
  [string] $Token = "pilot-smoke-token",
  [string] $ArtifactRoot = "$env:PUBLIC\Downloads",
  [switch] $EvidenceOnly
)

$ErrorActionPreference = "Continue"

function Write-State($name, $value) {
  "STATE:{0}={1}" -f $name, $value
}

function Test-Port($port) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $async = $client.BeginConnect("127.0.0.1", $port, $null, $null)
    if (-not $async.AsyncWaitHandle.WaitOne(500, $false)) { return $false }
    $client.EndConnect($async)
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

function Invoke-SystemPresenceRpc($nodeExe, $cwd, $artifact, $port, $token) {
  $probeScript = Join-Path $artifact "system-presence-rpc-smoke.cjs"
  $probeStderr = Join-Path $artifact "system-presence-rpc-smoke.stderr.log"
  $scriptText = @'
const { createRequire } = require('module');
const path = require('path');
const port = Number(process.env.CLAWX_SMOKE_GATEWAY_PORT || '18789');
const token = process.env.CLAWX_SMOKE_GATEWAY_TOKEN || '';
const timeoutMs = Number(process.env.CLAWX_SMOKE_RPC_TIMEOUT_MS || '5000');
const url = `ws://127.0.0.1:${port}/ws`;
let ws;
let WebSocket;
let settled = false;
let challengeSeen = false;
let handshakeComplete = false;

function state(name, value) {
  process.stdout.write(`STATE:${name}=${value}\n`);
}

try {
  const requireFromCwd = createRequire(path.join(process.cwd(), 'openclaw-smoke-probe.cjs'));
  const wsModule = requireFromCwd('ws');
  WebSocket = wsModule.WebSocket || wsModule;
} catch {
  state('SYSTEM_PRESENCE_REASON', 'ws_module_missing');
  state('SYSTEM_PRESENCE_RPC', 'false');
  process.exit(1);
}

function finish(ok, reason) {
  if (settled) return;
  settled = true;
  if (!ok && reason) state('SYSTEM_PRESENCE_REASON', reason);
  state('SYSTEM_PRESENCE_RPC', ok ? 'true' : 'false');
  try {
    if (ws && ws.readyState === WebSocket.OPEN) ws.close();
    else if (ws && typeof ws.terminate === 'function') ws.terminate();
  } catch {
    // ignore cleanup errors
  }
  process.exit(ok ? 0 : 1);
}

const timer = setTimeout(() => {
  finish(false, challengeSeen ? (handshakeComplete ? 'rpc_timeout' : 'handshake_timeout') : 'challenge_timeout');
}, timeoutMs);
timer.unref?.();

try {
  ws = new WebSocket(url);
} catch {
  finish(false, 'websocket_create_failed');
}

ws.on('message', (data) => {
  let message;
  try {
    message = JSON.parse(data.toString());
  } catch {
    return;
  }

  if (!challengeSeen && message?.type === 'event' && message?.event === 'connect.challenge') {
    const nonce = message?.payload?.nonce;
    if (!nonce) {
      finish(false, 'challenge_missing_nonce');
      return;
    }
    challengeSeen = true;
    state('SYSTEM_PRESENCE_CHALLENGE', 'true');
    ws.send(JSON.stringify({
      type: 'req',
      id: 'smoke-connect',
      method: 'connect',
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: 'gateway-client',
          displayName: 'gateway:system-presence',
          version: '0.1.0',
          platform: process.platform,
          mode: 'backend',
        },
        auth: { token },
        caps: [],
        role: 'operator',
        scopes: ['operator.read'],
      },
    }));
    return;
  }

  if (message?.type === 'res' && message?.id === 'smoke-connect') {
    if (message.ok === false || message.error) {
      finish(false, 'connect_denied');
      return;
    }
    handshakeComplete = true;
    state('SYSTEM_PRESENCE_HANDSHAKE', 'true');
    ws.send(JSON.stringify({
      type: 'req',
      id: 'smoke-system-presence',
      method: 'system-presence',
      params: {},
    }));
    return;
  }

  if (message?.type === 'res' && message?.id === 'smoke-system-presence') {
    if (message.ok === false || message.error) {
      finish(false, 'rpc_denied');
      return;
    }
    clearTimeout(timer);
    finish(true);
    return;
  }

  if (message?.jsonrpc === '2.0' && message?.id === 'smoke-system-presence') {
    clearTimeout(timer);
    finish(!message.error, message.error ? 'rpc_denied' : undefined);
  }
});

ws.on('error', () => {
  finish(false, challengeSeen ? 'websocket_error_after_challenge' : 'websocket_error');
});

ws.on('close', () => {
  finish(false, handshakeComplete ? 'websocket_closed_after_handshake' : 'websocket_closed_before_handshake');
});
'@

  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($probeScript, $scriptText, $utf8NoBom)

  $previousToken = $env:CLAWX_SMOKE_GATEWAY_TOKEN
  $previousPort = $env:CLAWX_SMOKE_GATEWAY_PORT
  $previousTimeout = $env:CLAWX_SMOKE_RPC_TIMEOUT_MS
  try {
    $env:CLAWX_SMOKE_GATEWAY_TOKEN = $token
    $env:CLAWX_SMOKE_GATEWAY_PORT = [string] $port
    $env:CLAWX_SMOKE_RPC_TIMEOUT_MS = "5000"
    Push-Location $cwd
    try {
      $lines = & $nodeExe $probeScript 2> $probeStderr
      $exitCode = $LASTEXITCODE
    } finally {
      Pop-Location
    }
  } finally {
    $env:CLAWX_SMOKE_GATEWAY_TOKEN = $previousToken
    $env:CLAWX_SMOKE_GATEWAY_PORT = $previousPort
    $env:CLAWX_SMOKE_RPC_TIMEOUT_MS = $previousTimeout
  }

  $states = @()
  foreach ($line in @($lines)) {
    if ([string] $line -like 'STATE:*') {
      $states += [string] $line
    }
  }
  return @{ Ok = ($exitCode -eq 0); States = $states }
}

function Quote-ProcessArgument($value) {
  $s = [string] $value
  if ($s.Length -eq 0) { return '""' }
  if ($s -notmatch '[\s"]') { return $s }

  # Windows CreateProcess receives one command line string.  Start-Process
  # joins -ArgumentList arrays in Windows PowerShell 5, so quote paths with
  # spaces before passing the command line through.
  $escaped = $s -replace '"', '\"'
  return '"' + $escaped + '"'
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$artifact = Join-Path $ArtifactRoot ("clawx-installed-gateway-smoke-" + $stamp)
New-Item -ItemType Directory -Force -Path $artifact | Out-Null

if ($EvidenceOnly) {
  Write-State "SAFE_METADATA_ONLY" "true"
} else {
  Write-State "MODE" "InstalledGatewaySmoke"
  Write-State "ARTIFACT_DIR" $artifact
}

$installRoot = Join-Path $env:LOCALAPPDATA "Programs\Ministry of Education"
$resources = Join-Path $installRoot "resources"
$nodeExe = Join-Path $resources "bin\node.exe"
$entry = Join-Path $resources "openclaw\openclaw.mjs"
$cwd = Join-Path $resources "openclaw"
$stdout = Join-Path $artifact "gateway.stdout.log"
$stderr = Join-Path $artifact "gateway.stderr.log"

Write-State "NODE_EXISTS" (Test-Path $nodeExe)
Write-State "ENTRY_EXISTS" (Test-Path $entry)
Write-State "CWD_EXISTS" (Test-Path $cwd)
Write-State "PLAYWRIGHT_CORE_EXISTS" (Test-Path (Join-Path $cwd "node_modules\playwright-core\package.json"))

if (-not (Test-Path $nodeExe) -or -not (Test-Path $entry) -or -not (Test-Path $cwd)) {
  Write-State "RESULT" "BLOCKED_MISSING_RUNTIME"
  exit 2
}

if (Test-Port $Port) {
  Write-State "PORT_ALREADY_UP" "True"
  Write-State "RESULT" "BLOCKED_PORT_IN_USE"
  exit 3
}

$gatewayArgs = @($entry, "gateway", "--port", "$Port", "--token", $Token, "--allow-unconfigured")
$argumentLine = ($gatewayArgs | ForEach-Object { Quote-ProcessArgument $_ }) -join " "
try {
  if (-not $EvidenceOnly) { Write-State "ARGUMENT_LINE" $argumentLine }
  $proc = Start-Process -FilePath $nodeExe -ArgumentList $argumentLine -WorkingDirectory $cwd -RedirectStandardOutput $stdout -RedirectStandardError $stderr -WindowStyle Hidden -PassThru
  if (-not $EvidenceOnly) { Write-State "GATEWAY_PID" $proc.Id }
} catch {
  Write-State "RESULT" "FAILED_START"
  if (-not $EvidenceOnly) { Write-State "ERROR" $_.Exception.Message }
  exit 4
}

$deadline = (Get-Date).AddSeconds($WaitSeconds)
$tcpReady = $false
$ready = $false
$systemPresenceStates = @()
do {
  Start-Sleep -Milliseconds 500
  $proc.Refresh()
  if ($proc.HasExited) {
    break
  }
  if (Test-Port $Port) {
    $tcpReady = $true
    $systemPresence = Invoke-SystemPresenceRpc $nodeExe $cwd $artifact $Port $Token
    $systemPresenceStates = @($systemPresence.States)
    if ($systemPresence.Ok) {
      $ready = $true
      break
    }
  }
} while ((Get-Date) -lt $deadline)

$proc.Refresh()
Write-State "GATEWAY_TCP_READY" $tcpReady
foreach ($stateLine in $systemPresenceStates) {
  $match = [regex]::Match([string] $stateLine, '^STATE:([^=]+)=(.*)$')
  if ($match.Success) {
    Write-State $match.Groups[1].Value $match.Groups[2].Value
  }
}
if (-not ($systemPresenceStates | Where-Object { $_ -eq 'STATE:SYSTEM_PRESENCE_RPC=true' -or $_ -eq 'STATE:SYSTEM_PRESENCE_RPC=false' })) {
  Write-State "SYSTEM_PRESENCE_RPC" "false"
  if ($tcpReady) {
    Write-State "SYSTEM_PRESENCE_REASON" "no_rpc_result"
  }
}
Write-State "GATEWAY_READY" $ready
Write-State "GATEWAY_EXITED" $proc.HasExited
if ($proc.HasExited) {
  Write-State "GATEWAY_EXIT_CODE" $proc.ExitCode
}

if (-not $EvidenceOnly) {
  if (Test-Path $stdout) {
    Write-State "STDOUT_SIZE" (Get-Item $stdout).Length
    Get-Content -LiteralPath $stdout -Tail 80 -ErrorAction SilentlyContinue | ForEach-Object { Write-State "STDOUT" $_ }
  }
  if (Test-Path $stderr) {
    Write-State "STDERR_SIZE" (Get-Item $stderr).Length
    Get-Content -LiteralPath $stderr -Tail 120 -ErrorAction SilentlyContinue | ForEach-Object { Write-State "STDERR" $_ }
  }
}

if (-not $proc.HasExited) {
  try {
    Stop-Process -Id $proc.Id -Force -ErrorAction Stop
    if (-not $EvidenceOnly) { Write-State "GATEWAY_STOPPED" "True" }
  } catch {
    if (-not $EvidenceOnly) { Write-State "GATEWAY_STOP_ERROR" $_.Exception.Message }
  }
}

if ($ready) {
  Write-State "RESULT" "COMPLETE"
  exit 0
}

if ($tcpReady) {
  Write-State "RESULT" "FAILED_SYSTEM_PRESENCE_RPC"
  exit 5
}

Write-State "RESULT" "FAILED_NOT_READY"
exit 5
