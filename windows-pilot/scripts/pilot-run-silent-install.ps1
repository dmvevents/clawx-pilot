# pilot-run-silent-install.ps1
#
# Runs a ClawX/MoE NSIS installer silently with bounded timeout and structured
# state output. Intended for production install/overwrite smoke tests over SSH.

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string] $InstallerPath,

  [int] $TimeoutSeconds = 1800,

  [string] $EvidenceRoot = "$env:PUBLIC\Downloads",

  [string[]] $InstallerArgs = @("/S", "/currentuser"),

  [switch] $StopRunningApp
)

$ErrorActionPreference = "Continue"

function Write-State($name, $value) {
  "STATE:{0}={1}" -f $name, $value
}

function Write-FileEvidence([string] $prefix, [string] $path) {
  Write-State "${prefix}_EXISTS" (Test-Path -LiteralPath $path)
  if (Test-Path -LiteralPath $path) {
    $item = Get-Item -LiteralPath $path
    Write-State "${prefix}_PATH" $item.FullName
    Write-State "${prefix}_SIZE" $item.Length
    Write-State "${prefix}_MODIFIED" $item.LastWriteTime
    try {
      $hash = Get-FileHash -LiteralPath $path -Algorithm SHA256
      Write-State "${prefix}_SHA256" $hash.Hash
    } catch {
      Write-State "${prefix}_HASH_ERROR" $_.Exception.Message
    }
  }
}

function Capture-ProcessSnapshot([string] $label) {
  if (-not $script:EvidenceDir) { return }
  $safeLabel = $label -replace '[^a-zA-Z0-9._-]+', '-'
  $path = Join-Path $script:EvidenceDir ("processes-" + $safeLabel + ".json")
  $items = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -match "Ministry|Education|setup|nsis|installer|powershell|cmd|7z" -or
    $_.CommandLine -match "Ministry|Education|setup|nsis|installer|openclaw|update-user-path|appasar|7z"
  } | Sort-Object ProcessId | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine,CreationDate)
  $items | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $path -Encoding UTF8
  Write-State ("PROCESS_SNAPSHOT_" + $safeLabel) $path
  Write-State ("PROCESS_SNAPSHOT_" + $safeLabel + "_COUNT") $items.Count
}

function Stop-ProcessTree([int] $rootPid) {
  $all = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
  $childrenByParent = @{}
  foreach ($proc in $all) {
    $key = [int]$proc.ParentProcessId
    if (-not $childrenByParent.ContainsKey($key)) {
      $childrenByParent[$key] = New-Object System.Collections.Generic.List[object]
    }
    $childrenByParent[$key].Add($proc)
  }

  $toStop = New-Object System.Collections.Generic.List[int]
  $stack = New-Object System.Collections.Generic.Stack[int]
  $stack.Push($rootPid)
  while ($stack.Count -gt 0) {
    $processId = $stack.Pop()
    if ($toStop.Contains($processId)) { continue }
    $toStop.Add($processId)
    if ($childrenByParent.ContainsKey($processId)) {
      foreach ($child in $childrenByParent[$processId]) {
        $stack.Push([int]$child.ProcessId)
      }
    }
  }

  foreach ($processId in @($toStop | Sort-Object -Descending)) {
    try {
      Stop-Process -Id $processId -Force -ErrorAction Stop
      Write-State "INSTALL_TREE_STOPPED" $processId
    } catch {
      Write-State "INSTALL_TREE_STOP_ERROR" ("{0}|{1}" -f $processId, $_.Exception.Message)
    }
  }
}

function Capture-InstallTreeSummary([string] $label) {
  if (-not $script:EvidenceDir) { return }
  $safeLabel = $label -replace '[^a-zA-Z0-9._-]+', '-'
  $path = Join-Path $script:EvidenceDir ("install-tree-" + $safeLabel + ".json")
  $installDir = Join-Path $env:LOCALAPPDATA "Programs\Ministry of Education"
  $importantRelative = @(
    "Ministry of Education.exe",
    "resources\app.asar",
    "resources\openclaw\node_modules\playwright-core\package.json",
    "resources\bin\ffmpeg.exe",
    "resources\bin\WinSpeechRecognize.exe"
  )

  $summary = [ordered]@{
    Label = $label
    InstallDir = $installDir
    InstallDirExists = (Test-Path -LiteralPath $installDir)
    ImportantFiles = @()
    InstallFileCount = 0
    InstallTotalBytes = 0
    TempNsuDirs = @()
  }

  foreach ($relative in $importantRelative) {
    $candidate = Join-Path $installDir $relative
    $summary.ImportantFiles += [ordered]@{
      RelativePath = $relative
      Exists = (Test-Path -LiteralPath $candidate)
    }
  }

  if (Test-Path -LiteralPath $installDir) {
    $files = @(Get-ChildItem -LiteralPath $installDir -Recurse -File -Force -ErrorAction SilentlyContinue)
    $summary.InstallFileCount = $files.Count
    $summary.InstallTotalBytes = ($files | Measure-Object -Property Length -Sum).Sum
    $summary.TopFiles = @($files | Sort-Object Length -Descending | Select-Object -First 20 FullName, Length)
  }

  $tempDirs = @(Get-ChildItem -LiteralPath $env:TEMP -Directory -Filter "nsu*.tmp" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 5)
  foreach ($tempDir in $tempDirs) {
    $tempFiles = @(Get-ChildItem -LiteralPath $tempDir.FullName -Recurse -File -Force -ErrorAction SilentlyContinue)
    $summary.TempNsuDirs += [ordered]@{
      FullName = $tempDir.FullName
      LastWriteTime = $tempDir.LastWriteTime
      FileCount = $tempFiles.Count
      TotalBytes = ($tempFiles | Measure-Object -Property Length -Sum).Sum
      TopFiles = @($tempFiles | Sort-Object Length -Descending | Select-Object -First 10 FullName, Length)
    }
  }

  $summary | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $path -Encoding UTF8
  Write-State ("INSTALL_TREE_SUMMARY_" + $safeLabel) $path
}

Write-State "MODE" "RunSilentInstall"
Write-State "TIMESTAMP" (Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz")
Write-State "USER" $env:USERNAME

if (-not (Test-Path -LiteralPath $EvidenceRoot)) {
  New-Item -ItemType Directory -Force -Path $EvidenceRoot | Out-Null
}
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$script:EvidenceDir = Join-Path $EvidenceRoot ("clawx-silent-install-" + $stamp)
New-Item -ItemType Directory -Force -Path $script:EvidenceDir | Out-Null
Write-State "EVIDENCE_DIR" $script:EvidenceDir

$resolved = Resolve-Path -LiteralPath $InstallerPath -ErrorAction SilentlyContinue
if (-not $resolved) {
  Write-State "RESULT" "BLOCKED_INSTALLER_NOT_FOUND"
  Write-State "INSTALLER" $InstallerPath
  exit 2
}

$installer = Get-Item -LiteralPath $resolved.Path
Write-State "INSTALLER" $installer.FullName
Write-State "INSTALLER_SIZE_MB" ([math]::Round($installer.Length / 1MB, 1))
Write-State "INSTALLER_MODIFIED" $installer.LastWriteTime
Write-FileEvidence "INSTALLER" $installer.FullName
Capture-ProcessSnapshot "before"

if ($StopRunningApp) {
  $stopped = 0
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    ($_.Name -eq "Ministry of Education.exe") -or
    ($_.ExecutablePath -like "*\Ministry of Education\*")
  } | ForEach-Object {
    try {
      Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop
      $stopped += 1
      Write-State "PROCESS_STOPPED" ("{0}|{1}" -f $_.ProcessId, $_.Name)
    } catch {
      Write-State "PROCESS_STOP_ERROR" ("{0}|{1}|{2}" -f $_.ProcessId, $_.Name, $_.Exception.Message)
    }
  }
  Write-State "PROCESS_STOPPED_COUNT" $stopped
}

$startedAt = Get-Date
try {
  Write-State "INSTALLER_ARGS" ($InstallerArgs -join " ")
  $proc = Start-Process -FilePath $installer.FullName -ArgumentList $InstallerArgs -PassThru -WindowStyle Hidden
  Write-State "INSTALL_PID" $proc.Id
} catch {
  Write-State "RESULT" "FAILED_START"
  Write-State "ERROR" $_.Exception.Message
  exit 3
}

$exited = $false
try {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $sample = 0
  while ((Get-Date) -lt $deadline) {
    if ($proc.HasExited) {
      $exited = $true
      break
    }
    if (($sample % 4) -eq 0) {
      Capture-ProcessSnapshot ("running-" + $sample)
    }
    Start-Sleep -Seconds 5
    $sample += 1
  }
  if (-not $exited -and $proc.HasExited) {
    $exited = $true
  }
} catch {
  Write-State "WAIT_ERROR" $_.Exception.Message
}

if (-not $exited) {
  Write-State "INSTALL_TIMEOUT" "True"
  Capture-ProcessSnapshot "timeout"
  Capture-InstallTreeSummary "timeout"
  Stop-ProcessTree $proc.Id
  Write-State "RESULT" "FAILED_TIMEOUT"
  exit 4
}

$proc.Refresh()
Write-State "INSTALL_EXIT_CODE" $proc.ExitCode
Write-State "INSTALL_DURATION_SECONDS" ([math]::Round(((Get-Date) - $startedAt).TotalSeconds, 1))
Capture-ProcessSnapshot "after"
Capture-InstallTreeSummary "after"

$appExe = Join-Path $env:LOCALAPPDATA "Programs\Ministry of Education\Ministry of Education.exe"
$appAsar = Join-Path $env:LOCALAPPDATA "Programs\Ministry of Education\resources\app.asar"
$playwrightCore = Join-Path $env:LOCALAPPDATA "Programs\Ministry of Education\resources\openclaw\node_modules\playwright-core\package.json"

Write-State "APP_EXE_EXISTS" (Test-Path $appExe)
Write-FileEvidence "APP_EXE" $appExe
Write-State "APP_ASAR_EXISTS" (Test-Path $appAsar)
Write-FileEvidence "APP_ASAR" $appAsar
Write-State "PLAYWRIGHT_CORE_PACKAGE_EXISTS" (Test-Path $playwrightCore)
if (Test-Path $playwrightCore) {
  try {
    $pkg = Get-Content -LiteralPath $playwrightCore -Raw | ConvertFrom-Json
    Write-State "PLAYWRIGHT_CORE_VERSION" $pkg.version
  } catch {}
}

if ($proc.ExitCode -eq 0) {
  Write-State "RESULT" "COMPLETE"
  exit 0
}

Write-State "RESULT" "FAILED_EXIT_CODE"
exit 5
