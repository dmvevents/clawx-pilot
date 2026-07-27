# pilot-launch-and-run-cdp-smoke.ps1
#
# Production-style autonomous smoke:
# 1. Launch the installed Electron app with a temporary Electron CDP port.
# 2. Wait for renderer CDP, Host API, and Gateway ports.
# 3. Run the existing Electron CDP probe through renderer IPC/Host API.
#
# Safe by default: Outlook smoke reads a small inbox sample and checks refusal
# gates; Forms smoke previews sample forms and checks submit refusal. It does
# not send email or submit forms unless the underlying probe is invoked with
# explicit side-effect flags, which this wrapper does not expose.

[CmdletBinding()]
param(
  [int] $ElectronCdpPort = 9223,
  [int] $StartupTimeoutSeconds = 240,
  [string] $ArtifactRoot = "$env:PUBLIC\Downloads",
  [string] $AppExe = "$env:LOCALAPPDATA\Programs\Ministry of Education\Ministry of Education.exe",
  [switch] $OutlookOnly,
  [switch] $StopExisting
)

$ErrorActionPreference = "Continue"

function Write-State($name, $value) {
  "STATE:{0}={1}" -f $name, $value
}

function Test-Port([int] $port) {
  try {
    $conn = Get-NetTCPConnection -State Listen -LocalAddress 127.0.0.1 -LocalPort $port -ErrorAction Stop
    return $null -ne $conn
  } catch {
    return $false
  }
}

function Test-HttpOk([string] $url) {
  try {
    $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Get-AppProcesses {
  @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -eq "Ministry of Education.exe" -or
    $_.ExecutablePath -like "*\Ministry of Education\Ministry of Education.exe" -or
    $_.CommandLine -like "*\Ministry of Education\resources\openclaw\openclaw.mjs*"
  })
}

if (-not (Test-Path $ArtifactRoot)) {
  New-Item -ItemType Directory -Force -Path $ArtifactRoot | Out-Null
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$artifact = Join-Path $ArtifactRoot ("clawx-cdp-smoke-" + $stamp)
New-Item -ItemType Directory -Force -Path $artifact | Out-Null

Write-State "MODE" "LaunchAndRunCdpSmoke"
Write-State "ARTIFACT_DIR" $artifact
Write-State "APP_EXE" $AppExe
Write-State "APP_EXE_EXISTS" (Test-Path $AppExe)

if (-not (Test-Path $AppExe)) {
  Write-State "RESULT" "BLOCKED_APP_MISSING"
  exit 2
}

if ($StopExisting) {
  $existing = @(Get-AppProcesses)
  Write-State "STOP_EXISTING_COUNT" $existing.Count
  foreach ($proc in $existing) {
    try {
      Stop-Process -Id $proc.ProcessId -Force -ErrorAction Stop
      Write-State "STOPPED_PROCESS" $proc.ProcessId
    } catch {
      Write-State "STOP_PROCESS_ERROR" ("pid={0}|{1}" -f $proc.ProcessId, $_.Exception.Message)
    }
  }
  Start-Sleep -Seconds 2
}

$argsLine = "--remote-debugging-port=$ElectronCdpPort --enable-logging --v=1"
try {
  $shell = New-Object -ComObject Shell.Application
  $shell.ShellExecute($AppExe, $argsLine)
  Write-State "LAUNCH_METHOD" "ShellExecuteExe"
  Write-State "LAUNCH_ARGS" $argsLine
} catch {
  Write-State "RESULT" "FAILED_LAUNCH"
  Write-State "ERROR" $_.Exception.Message
  exit 3
}

$endpoint = "http://127.0.0.1:$ElectronCdpPort"
$deadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
$electronCdpReady = $false
$hostApiReady = $false
$gatewayReady = $false
do {
  Start-Sleep -Seconds 1
  $electronCdpReady = Test-HttpOk "$endpoint/json/version"
  $hostApiReady = Test-Port 13210
  $gatewayReady = Test-Port 18789
  if ($electronCdpReady -and $hostApiReady -and $gatewayReady) { break }
} while ((Get-Date) -lt $deadline)

Write-State "ELECTRON_CDP_READY" $electronCdpReady
Write-State "HOSTAPI_READY" $hostApiReady
Write-State "GATEWAY_PORT_READY" $gatewayReady
Write-State "APP_PROCESS_COUNT" (@(Get-AppProcesses)).Count

if (-not $electronCdpReady) {
  Write-State "RESULT" "FAILED_ELECTRON_CDP_DOWN"
  exit 4
}
if (-not $hostApiReady) {
  Write-State "RESULT" "FAILED_HOSTAPI_DOWN"
  exit 5
}
if (-not $gatewayReady) {
  Write-State "RESULT" "FAILED_GATEWAY_DOWN"
  exit 6
}

$runner = Join-Path $PSScriptRoot "pilot-run-electron-cdp-probe.ps1"
if (-not (Test-Path $runner)) {
  $runner = Join-Path $env:PUBLIC "Downloads\pilot-run-electron-cdp-probe.ps1"
}
$probeScript = Join-Path $PSScriptRoot "pilot-electron-cdp-probe.js"
if (-not (Test-Path $runner) -or -not (Test-Path $probeScript)) {
  Write-State "RUNNER_EXISTS" (Test-Path $runner)
  Write-State "PROBE_JS_EXISTS" (Test-Path $probeScript)
  Write-State "RESULT" "BLOCKED_PROBE_FILES_MISSING"
  exit 7
}

$probeLog = Join-Path $artifact "electron-cdp-probe.out.txt"
$probeArgs = @(
  "-NoProfile",
  "-ExecutionPolicy", "Bypass",
  "-File", $runner,
  "-Endpoint", $endpoint,
  "-OutlookSmoke",
  "-WaitMs", "1000",
  "-ArtifactDir", $artifact
)
if (-not $OutlookOnly) {
  $probeArgs += "-FormsSmoke"
}

& powershell.exe @probeArgs *> $probeLog
$probeExit = $LASTEXITCODE
Write-State "PROBE_EXIT_CODE" $probeExit
Write-State "PROBE_LOG" $probeLog
Write-State "POST_PROBE_ELECTRON_CDP_READY" (Test-HttpOk "$endpoint/json/version")
Write-State "POST_PROBE_HOSTAPI_READY" (Test-Port 13210)
Write-State "POST_PROBE_GATEWAY_PORT_READY" (Test-Port 18789)
Write-State "POST_PROBE_CHROME_CDP_READY" (Test-HttpOk "http://127.0.0.1:18792/json/version")
Write-State "POST_PROBE_APP_PROCESS_COUNT" (@(Get-AppProcesses)).Count

Get-Content -LiteralPath $probeLog -Tail 120 -ErrorAction SilentlyContinue | ForEach-Object {
  "PROBE:$_"
}

if ($probeExit -eq 0) {
  Write-State "RESULT" "COMPLETE"
  exit 0
}

Write-State "RESULT" "FAILED_PROBE"
exit $probeExit
