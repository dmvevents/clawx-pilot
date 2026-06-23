# pilot-managed-cdp-visual-smoke.ps1
#
# VM-friendly visual smoke for the installed Windows app.
# It launches a dedicated Chrome CDP profile and the installed Electron app in
# the same PowerShell lifetime, then runs the existing no-send/no-submit probe.

[CmdletBinding()]
param(
  [int] $ChromeCdpPort = 18792,
  [int] $ElectronCdpPort = 9223,
  [int] $StartupTimeoutSeconds = 180,
  [string] $ArtifactRoot = "$env:USERPROFILE\Downloads",
  [string] $ChromeProfileDir = "$env:LOCALAPPDATA\ClawXChromeCdpProfile",
  [string] $ChromeExe = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  [string] $AppExe = "$env:LOCALAPPDATA\Programs\Ministry of Education\Ministry of Education.exe",
  [switch] $StopExistingApp,
  [switch] $StopChrome,
  [switch] $OutlookOnly
)

$ErrorActionPreference = "Continue"

function Write-State($name, $value) {
  "STATE:{0}={1}" -f $name, $value
}

function Test-Port([int] $port) {
  try {
    $null = Get-NetTCPConnection -State Listen -LocalAddress 127.0.0.1 -LocalPort $port -ErrorAction Stop
    return $true
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

function Wait-HttpOk([string] $url, [int] $seconds) {
  $deadline = (Get-Date).AddSeconds($seconds)
  do {
    if (Test-HttpOk $url) { return $true }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)
  return $false
}

function Wait-Port([int] $port, [int] $seconds) {
  $deadline = (Get-Date).AddSeconds($seconds)
  do {
    if (Test-Port $port) { return $true }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)
  return $false
}

function Get-AppProcesses {
  @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -eq "Ministry of Education.exe" -or
    $_.ExecutablePath -like "*\Ministry of Education\Ministry of Education.exe" -or
    $_.CommandLine -like "*\Ministry of Education\resources\openclaw\openclaw.mjs*"
  })
}

function Stop-ProcessList($processes, [string] $label) {
  $count = @($processes).Count
  Write-State "STOP_${label}_COUNT" $count
  foreach ($proc in $processes) {
    try {
      Stop-Process -Id $proc.ProcessId -Force -ErrorAction Stop
      Write-State "STOPPED_${label}_PROCESS" $proc.ProcessId
    } catch {
      Write-State "STOP_${label}_ERROR" ("pid={0}|{1}" -f $proc.ProcessId, $_.Exception.Message)
    }
  }
}

if (-not (Test-Path $ArtifactRoot)) {
  New-Item -ItemType Directory -Force -Path $ArtifactRoot | Out-Null
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$artifact = Join-Path $ArtifactRoot ("clawx-managed-cdp-visual-smoke-" + $stamp)
New-Item -ItemType Directory -Force -Path $artifact | Out-Null

Write-State "MODE" "ManagedCdpVisualSmoke"
Write-State "ARTIFACT_DIR" $artifact
Write-State "APP_EXE" $AppExe
Write-State "APP_EXE_EXISTS" (Test-Path $AppExe)
Write-State "CHROME_EXE" $ChromeExe
Write-State "CHROME_EXE_EXISTS" (Test-Path $ChromeExe)
Write-State "CHROME_PROFILE_DIR" $ChromeProfileDir

if (-not (Test-Path $AppExe)) {
  Write-State "RESULT" "BLOCKED_APP_MISSING"
  exit 2
}
if (-not (Test-Path $ChromeExe)) {
  Write-State "RESULT" "BLOCKED_CHROME_MISSING"
  exit 3
}

if ($StopExistingApp) {
  Stop-ProcessList (Get-AppProcesses) "APP"
}
if ($StopChrome) {
  Stop-ProcessList @(Get-Process chrome -ErrorAction SilentlyContinue) "CHROME"
}
Start-Sleep -Seconds 2

New-Item -ItemType Directory -Force -Path $ChromeProfileDir | Out-Null
$chromeEndpoint = "http://127.0.0.1:$ChromeCdpPort"
if (-not (Test-HttpOk "$chromeEndpoint/json/version")) {
  $chromeArgs = @(
    "--remote-debugging-port=$ChromeCdpPort",
    "--user-data-dir=$ChromeProfileDir",
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank"
  )
  try {
    Start-Process -FilePath $ChromeExe -ArgumentList $chromeArgs -WindowStyle Normal
    Write-State "CHROME_LAUNCH_METHOD" "StartProcess"
  } catch {
    Write-State "RESULT" "FAILED_CHROME_LAUNCH"
    Write-State "ERROR" $_.Exception.Message
    exit 4
  }
}

$chromeReady = Wait-HttpOk "$chromeEndpoint/json/version" 35
Write-State "CHROME_CDP_READY" $chromeReady
if (-not $chromeReady) {
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -eq "chrome.exe" } |
    Select-Object ProcessId,Name |
    ConvertTo-Json -Compress
  Write-State "RESULT" "FAILED_CHROME_CDP"
  exit 5
}

$electronEndpoint = "http://127.0.0.1:$ElectronCdpPort"
$appArgs = "--remote-debugging-port=$ElectronCdpPort --enable-logging --v=1"
try {
  $shell = New-Object -ComObject Shell.Application
  $shell.ShellExecute($AppExe, $appArgs)
  Write-State "APP_LAUNCH_METHOD" "ShellExecuteExe"
  Write-State "APP_LAUNCH_ARGS" $appArgs
} catch {
  Write-State "RESULT" "FAILED_APP_LAUNCH"
  Write-State "ERROR" $_.Exception.Message
  exit 6
}

$electronReady = Wait-HttpOk "$electronEndpoint/json/version" $StartupTimeoutSeconds
$hostReady = Wait-Port 13210 $StartupTimeoutSeconds
$gatewayReady = Wait-Port 18789 $StartupTimeoutSeconds

Write-State "ELECTRON_CDP_READY" $electronReady
Write-State "HOSTAPI_READY" $hostReady
Write-State "GATEWAY_PORT_READY" $gatewayReady
Write-State "APP_PROCESS_COUNT" (@(Get-AppProcesses)).Count

if (-not $electronReady) {
  Write-State "RESULT" "FAILED_ELECTRON_CDP_DOWN"
  exit 7
}
if (-not $hostReady) {
  Write-State "RESULT" "FAILED_HOSTAPI_DOWN"
  exit 8
}
if (-not $gatewayReady) {
  Write-State "RESULT" "FAILED_GATEWAY_DOWN"
  exit 9
}

$runner = Join-Path $PSScriptRoot "pilot-run-electron-cdp-probe.ps1"
$probeScript = Join-Path $PSScriptRoot "pilot-electron-cdp-probe.js"
if (-not (Test-Path $runner) -or -not (Test-Path $probeScript)) {
  Write-State "RUNNER_EXISTS" (Test-Path $runner)
  Write-State "PROBE_JS_EXISTS" (Test-Path $probeScript)
  Write-State "RESULT" "BLOCKED_PROBE_FILES_MISSING"
  exit 10
}

$probeLog = Join-Path $artifact "electron-cdp-probe.out.txt"
$probeArgs = @(
  "-NoProfile",
  "-ExecutionPolicy", "Bypass",
  "-File", $runner,
  "-Endpoint", $electronEndpoint,
  "-OutlookSmoke",
  "-VisualAcceptance",
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
Write-State "POST_PROBE_CHROME_CDP_READY" (Test-HttpOk "$chromeEndpoint/json/version")
Write-State "POST_PROBE_ELECTRON_CDP_READY" (Test-HttpOk "$electronEndpoint/json/version")
Write-State "POST_PROBE_HOSTAPI_READY" (Test-Port 13210)
Write-State "POST_PROBE_GATEWAY_PORT_READY" (Test-Port 18789)

Get-Content -LiteralPath $probeLog -Tail 160 -ErrorAction SilentlyContinue | ForEach-Object {
  "PROBE:$_"
}

if ($probeExit -eq 0) {
  Write-State "RESULT" "COMPLETE"
  exit 0
}

Write-State "RESULT" "FAILED_PROBE"
exit $probeExit
