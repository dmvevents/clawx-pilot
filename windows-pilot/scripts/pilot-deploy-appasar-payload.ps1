# pilot-deploy-appasar-payload.ps1
#
# Patch the installed Windows app with a rebuilt app.asar for fast production
# diagnosis before running the full installer path. This does not uninstall the
# app and does not touch user data.

[CmdletBinding()]
param(
  [string] $Payload = "$env:PUBLIC\Downloads\app.asar",
  [string] $InstallDir = "$env:LOCALAPPDATA\Programs\Ministry of Education",
  [string] $BackupRoot = "$env:PUBLIC\Downloads\clawx-appasar-backups"
)

$ErrorActionPreference = "Stop"

function Write-State([string] $name, $value) {
  "STATE:{0}={1}" -f $name, $value
}

function Get-AppProcesses {
  @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -eq "Ministry of Education.exe" -or
    $_.ExecutablePath -like "*\Ministry of Education\Ministry of Education.exe" -or
    $_.CommandLine -like "*\Ministry of Education\resources\openclaw\openclaw.mjs*"
  })
}

function Write-FileEvidence([string] $prefix, [string] $path) {
  Write-State "${prefix}_EXISTS" (Test-Path -LiteralPath $path)
  if (Test-Path -LiteralPath $path) {
    $item = Get-Item -LiteralPath $path
    $hash = Get-FileHash -LiteralPath $path -Algorithm SHA256
    Write-State "${prefix}_PATH" $item.FullName
    Write-State "${prefix}_SIZE" $item.Length
    Write-State "${prefix}_SHA256" $hash.Hash
    Write-State "${prefix}_MODIFIED" $item.LastWriteTime.ToString("o")
  }
}

$resourcesDir = Join-Path $InstallDir "resources"
$target = Join-Path $resourcesDir "app.asar"

Write-State "MODE" "DeployAppAsarPayload"
Write-State "PAYLOAD" $Payload
Write-State "INSTALL_DIR" $InstallDir
Write-State "RESOURCES_DIR_EXISTS" (Test-Path -LiteralPath $resourcesDir)

if (-not (Test-Path -LiteralPath $Payload)) {
  Write-State "RESULT" "BLOCKED_PAYLOAD_MISSING"
  exit 2
}
if (-not (Test-Path -LiteralPath $resourcesDir)) {
  Write-State "RESULT" "BLOCKED_RESOURCES_MISSING"
  exit 3
}

Write-FileEvidence "PAYLOAD" $Payload
Write-FileEvidence "TARGET_BEFORE" $target

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

New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null
if (Test-Path -LiteralPath $target) {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $backup = Join-Path $BackupRoot "app.asar.$stamp.bak"
  Copy-Item -LiteralPath $target -Destination $backup -Force
  Write-FileEvidence "BACKUP" $backup
}

Copy-Item -LiteralPath $Payload -Destination $target -Force
Write-FileEvidence "TARGET_AFTER" $target
Write-State "RESULT" "COMPLETE"
