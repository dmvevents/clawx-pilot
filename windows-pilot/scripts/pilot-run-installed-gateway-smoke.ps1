# pilot-run-installed-gateway-smoke.ps1
#
# Starts the packaged OpenClaw gateway directly from the installed app resources,
# captures stdout/stderr, checks readiness on 18789, and then stops it.

[CmdletBinding()]
param(
  [int] $Port = 18789,
  [int] $WaitSeconds = 150,
  [string] $Token = "pilot-smoke-token",
  [string] $ArtifactRoot = "$env:PUBLIC\Downloads"
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

Write-State "MODE" "InstalledGatewaySmoke"
Write-State "ARTIFACT_DIR" $artifact

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
  Write-State "ARGUMENT_LINE" $argumentLine
  $proc = Start-Process -FilePath $nodeExe -ArgumentList $argumentLine -WorkingDirectory $cwd -RedirectStandardOutput $stdout -RedirectStandardError $stderr -WindowStyle Hidden -PassThru
  Write-State "GATEWAY_PID" $proc.Id
} catch {
  Write-State "RESULT" "FAILED_START"
  Write-State "ERROR" $_.Exception.Message
  exit 4
}

$deadline = (Get-Date).AddSeconds($WaitSeconds)
$ready = $false
do {
  Start-Sleep -Milliseconds 500
  if (Test-Port $Port) {
    $ready = $true
    break
  }
  $proc.Refresh()
  if ($proc.HasExited) {
    break
  }
} while ((Get-Date) -lt $deadline)

$proc.Refresh()
Write-State "GATEWAY_READY" $ready
Write-State "GATEWAY_EXITED" $proc.HasExited
if ($proc.HasExited) {
  Write-State "GATEWAY_EXIT_CODE" $proc.ExitCode
}

if (Test-Path $stdout) {
  Write-State "STDOUT_SIZE" (Get-Item $stdout).Length
  Get-Content -LiteralPath $stdout -Tail 80 -ErrorAction SilentlyContinue | ForEach-Object { Write-State "STDOUT" $_ }
}
if (Test-Path $stderr) {
  Write-State "STDERR_SIZE" (Get-Item $stderr).Length
  Get-Content -LiteralPath $stderr -Tail 120 -ErrorAction SilentlyContinue | ForEach-Object { Write-State "STDERR" $_ }
}

if (-not $proc.HasExited) {
  try {
    Stop-Process -Id $proc.Id -Force -ErrorAction Stop
    Write-State "GATEWAY_STOPPED" "True"
  } catch {
    Write-State "GATEWAY_STOP_ERROR" $_.Exception.Message
  }
}

if ($ready) {
  Write-State "RESULT" "COMPLETE"
  exit 0
}

Write-State "RESULT" "FAILED_NOT_READY"
exit 5
