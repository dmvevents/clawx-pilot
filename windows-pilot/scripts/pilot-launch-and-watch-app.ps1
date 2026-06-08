# pilot-launch-and-watch-app.ps1
#
# Launches the installed app through the logged-in Windows shell and samples
# process/port/log state while it starts.  This is diagnostic only: it does not
# edit app config, launch Chrome, send email, or submit forms.

[CmdletBinding()]
param(
  [int] $WatchSeconds = 60,
  [string] $ArtifactRoot = "$env:PUBLIC\Downloads",
  [string] $AppExe = "$env:LOCALAPPDATA\Programs\Ministry of Education\Ministry of Education.exe",
  [string] $ShortcutPath = "$env:USERPROFILE\Desktop\Ministry of Education.lnk"
)

$ErrorActionPreference = "Continue"

function Write-State($name, $value) {
  "STATE:{0}={1}" -f $name, $value
}

function Redact-Text([string] $value) {
  if ([string]::IsNullOrWhiteSpace($value)) { return $value }
  $redacted = $value -replace '(Bearer\s+)[A-Za-z0-9._\-]+', '$1<redacted>'
  $redacted = $redacted -replace 'sk-[A-Za-z0-9._\-]+', '<redacted-key>'
  $redacted = $redacted -replace '#token=[^&\s"]+', '#token=<redacted>'
  $redacted = $redacted -replace '([?&]token=)[^&\s"]+', '$1<redacted>'
  return $redacted
}

function Test-Port([int] $port) {
  try {
    $conn = Get-NetTCPConnection -State Listen -LocalAddress 127.0.0.1 -LocalPort $port -ErrorAction Stop
    return $null -ne $conn
  } catch {
    return $false
  }
}

function Get-AppProcesses {
  @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -eq "Ministry of Education.exe" -or
    $_.ExecutablePath -like "*\Ministry of Education\Ministry of Education.exe" -or
    $_.CommandLine -like "*\Ministry of Education\resources\openclaw\openclaw.mjs*"
  } | Select-Object ProcessId, ParentProcessId, Name, ExecutablePath, CommandLine)
}

function Write-JsonFile($path, $value) {
  $value |
    ConvertTo-Json -Depth 8 |
    ForEach-Object { Redact-Text $_ } |
    Set-Content -LiteralPath $path -Encoding UTF8
}

if (-not (Test-Path $ArtifactRoot)) {
  New-Item -ItemType Directory -Force -Path $ArtifactRoot | Out-Null
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$artifact = Join-Path $ArtifactRoot ("clawx-app-watch-" + $stamp)
New-Item -ItemType Directory -Force -Path $artifact | Out-Null

Write-State "MODE" "LaunchAndWatchApp"
Write-State "ARTIFACT_DIR" $artifact
Write-State "APP_EXE_EXISTS" (Test-Path $AppExe)
Write-State "SHORTCUT_EXISTS" (Test-Path $ShortcutPath)
Write-State "STARTED_AT" (Get-Date -Format o)

$startedAt = Get-Date
$samples = New-Object System.Collections.Generic.List[object]

try {
  $shell = New-Object -ComObject Shell.Application
  if (Test-Path $ShortcutPath) {
    $shell.ShellExecute($ShortcutPath)
    Write-State "LAUNCH_METHOD" "ShellExecuteShortcut"
  } elseif (Test-Path $AppExe) {
    $shell.ShellExecute($AppExe, "--enable-logging --v=1")
    Write-State "LAUNCH_METHOD" "ShellExecuteExe"
  } else {
    Write-State "RESULT" "BLOCKED_APP_MISSING"
    exit 2
  }
} catch {
  Write-State "RESULT" "FAILED_LAUNCH"
  Write-State "ERROR" $_.Exception.Message
  exit 3
}

for ($i = 0; $i -le $WatchSeconds; $i++) {
  $procs = @(Get-AppProcesses)
  $sample = [ordered]@{
    t = $i
    timestamp = (Get-Date -Format o)
    processCount = $procs.Count
    hostApi13210 = Test-Port 13210
    gateway18789 = Test-Port 18789
    electronCdp9223 = Test-Port 9223
    chromeCdp18792 = Test-Port 18792
    processes = $procs
  }
  $samples.Add($sample) | Out-Null

  if ($i -eq 0 -or $i -eq 5 -or $i -eq 15 -or $i -eq 30 -or $i -eq $WatchSeconds) {
    Write-State ("SAMPLE_{0}" -f $i) ("procs={0}|hostApi={1}|gateway={2}|chromeCdp={3}" -f $sample.processCount, $sample.hostApi13210, $sample.gateway18789, $sample.chromeCdp18792)
  }

  if ($i -lt $WatchSeconds) {
    Start-Sleep -Seconds 1
  }
}

Write-JsonFile (Join-Path $artifact "samples.json") $samples

$logDir = Join-Path $env:APPDATA "Ministry of Education\logs"
Write-State "LOG_DIR_EXISTS" (Test-Path $logDir)
if (Test-Path $logDir) {
  $logs = @(Get-ChildItem -LiteralPath $logDir -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 5)
  Write-JsonFile (Join-Path $artifact "logs-list.json") $logs
  foreach ($log in $logs) {
    $tailPath = Join-Path $artifact ("tail-" + $log.Name)
    Get-Content -LiteralPath $log.FullName -Tail 260 -ErrorAction SilentlyContinue |
      ForEach-Object { Redact-Text $_ } |
      Set-Content -LiteralPath $tailPath -Encoding UTF8
    Write-State "LOG_TAIL" $tailPath
  }
}

try {
  $events = @(Get-WinEvent -FilterHashtable @{ LogName = "Application"; StartTime = $startedAt.AddMinutes(-1) } -ErrorAction Stop |
    Where-Object {
      $_.ProviderName -match "Application Error|Windows Error Reporting|\.NET Runtime|Ministry|Electron"
    } |
    Select-Object TimeCreated, ProviderName, Id, LevelDisplayName, Message)
  Write-JsonFile (Join-Path $artifact "application-events.json") $events
  Write-State "APPLICATION_EVENT_COUNT" $events.Count
} catch {
  Write-State "APPLICATION_EVENT_PROBE_ERROR" $_.Exception.Message
}

$finalProcs = @(Get-AppProcesses)
Write-State "FINAL_PROCESS_COUNT" $finalProcs.Count
Write-State "FINAL_HOSTAPI_13210" (Test-Port 13210)
Write-State "FINAL_GATEWAY_18789" (Test-Port 18789)
Write-State "FINAL_CHROME_CDP_18792" (Test-Port 18792)
Write-State "RESULT" "COMPLETE"
exit 0
