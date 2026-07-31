# pilot-fresh-install-environment.ps1
#
# Creates a safe fresh-install test surface for the Windows laptop.
#
# Read-only: yes for -Mode Probe.
# Read-only: no for -Mode CreateSandbox because it writes an artifact folder and
# optional .wsb launcher under Downloads. It does not uninstall, delete, or
# mutate the real app/user profile.
# Idempotent: yes - every run writes a timestamped artifact folder.

[CmdletBinding()]
param(
  [ValidateSet("Probe", "CreateSandbox")]
  [string] $Mode = "Probe",
  [string] $ArtifactRoot = "$env:USERPROFILE\Downloads",
  [string] $InstallerPattern = "Ministry.of.Education-*-win-x64.exe",
  [switch] $OpenSandbox
)

$ErrorActionPreference = "Continue"

function Write-State($name, $value) {
  Write-Output ("STATE:{0}={1}" -f $name, $value)
}

function Test-IsAdmin {
  try {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
  } catch {
    return $false
  }
}

function Get-SandboxFeatureState {
  try {
    $feature = Get-WindowsOptionalFeature -Online -FeatureName Containers-DisposableClientVM -ErrorAction Stop
    if ($null -eq $feature) {
      return "UNAVAILABLE"
    }
    if ([string]::IsNullOrWhiteSpace([string] $feature.State)) {
      return "UNKNOWN"
    }
    return $feature.State
  } catch {
    return "UNAVAILABLE"
  }
}

function Get-InstallerCandidates {
  $roots = @(
    "$env:USERPROFILE\Downloads",
    "$env:USERPROFILE\Desktop",
    (Get-Location).Path
  ) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique

  $items = @()
  foreach ($root in $roots) {
    $items += Get-ChildItem -LiteralPath $root -Filter $InstallerPattern -File -ErrorAction SilentlyContinue
  }
  return @($items | Sort-Object LastWriteTime -Descending)
}

function Test-Port($port) {
  try {
    $conn = Get-NetTCPConnection -State Listen -LocalAddress 127.0.0.1 -LocalPort $port -ErrorAction Stop
    return $null -ne $conn
  } catch {
    return $false
  }
}

function Write-Probe {
  Write-State "MODE" "Probe"
  Write-State "TIMESTAMP" (Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz")
  Write-State "USER" $env:USERNAME
  Write-State "IS_ADMIN" (Test-IsAdmin)
  $featureState = Get-SandboxFeatureState
  Write-State "SANDBOX_FEATURE" $featureState
  Write-State "WINDOWS_SANDBOX_EXE" ([bool](Get-Command WindowsSandbox.exe -ErrorAction SilentlyContinue))

  $installers = @(Get-InstallerCandidates)
  Write-State "INSTALLER_COUNT" $installers.Count
  foreach ($installer in $installers | Select-Object -First 5) {
    Write-State "INSTALLER" ("{0}|{1:n1}MB|{2}" -f $installer.FullName, ($installer.Length / 1MB), $installer.LastWriteTime)
  }

  $installDir = Join-Path $env:LOCALAPPDATA "Programs\Ministry of Education"
  $appExe = Join-Path $installDir "Ministry of Education.exe"
  $appData = Join-Path $env:APPDATA "Ministry of Education"
  $openclaw = Join-Path $env:USERPROFILE ".openclaw"
  Write-State "REAL_INSTALL_DIR_EXISTS" (Test-Path $installDir)
  Write-State "REAL_APP_EXE_EXISTS" (Test-Path $appExe)
  Write-State "REAL_APPDATA_EXISTS" (Test-Path $appData)
  Write-State "REAL_OPENCLAW_EXISTS" (Test-Path $openclaw)
  Write-State "PORT_18789_GATEWAY" (Test-Port 18789)
  Write-State "PORT_13210_HOSTAPI" (Test-Port 13210)
  Write-State "PORT_18792_CHROME_CDP" (Test-Port 18792)
  Write-State "CHROME_EXE_PROGRAMFILES" (Test-Path "C:\Program Files\Google\Chrome\Application\chrome.exe")
}

function Escape-Xml($value) {
  return [System.Security.SecurityElement]::Escape([string] $value)
}

function New-SandboxPackage {
  $installers = @(Get-InstallerCandidates)
  if ($installers.Count -eq 0) {
    Write-State "SANDBOX_PACKAGE" "BLOCKED_NO_INSTALLER"
    Write-State "EXPECTED_INSTALLER_PATTERN" $InstallerPattern
    return
  }

  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $artifact = Join-Path $ArtifactRoot ("clawx-fresh-install-sandbox-" + $stamp)
  New-Item -ItemType Directory -Force -Path $artifact | Out-Null

  $installer = $installers[0]
  $installerTarget = Join-Path $artifact $installer.Name
  Copy-Item -LiteralPath $installer.FullName -Destination $installerTarget -Force

  $insideScript = Join-Path $artifact "run-inside-sandbox.ps1"
  $insideScriptContent = @'
$ErrorActionPreference = "Continue"

function Write-State($name, $value) {
  $line = "STATE:{0}={1}" -f $name, $value
  Write-Output $line
  Add-Content -Path $script:LogPath -Value $line
}

function Test-Port($port) {
  try {
    $conn = Get-NetTCPConnection -State Listen -LocalAddress 127.0.0.1 -LocalPort $port -ErrorAction Stop
    return $null -ne $conn
  } catch {
    return $false
  }
}

$script:Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$script:LogPath = Join-Path $script:Root "sandbox-run.log"
"Fresh install sandbox run: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')" | Set-Content -Path $script:LogPath

Write-State "SANDBOX_USER" $env:USERNAME
Write-State "SANDBOX_ROOT" $script:Root
Write-State "LOCALAPPDATA" $env:LOCALAPPDATA
Write-State "APPDATA" $env:APPDATA

$installer = Get-ChildItem -LiteralPath $script:Root -Filter "Ministry.of.Education-*-win-x64.exe" -File -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $installer) {
  Write-State "INSTALLER" "MISSING"
  exit 2
}

Write-State "INSTALLER" $installer.FullName
Write-State "INSTALL_START" "YES"
$installStdoutLog = Join-Path $script:Root "installer-stdout.log"
$installStderrLog = Join-Path $script:Root "installer-stderr.log"
$proc = Start-Process -FilePath $installer.FullName -ArgumentList "/S" -Wait -PassThru -RedirectStandardOutput $installStdoutLog -RedirectStandardError $installStderrLog
Write-State "INSTALL_EXIT" $proc.ExitCode

$appExe = Join-Path $env:LOCALAPPDATA "Programs\Ministry of Education\Ministry of Education.exe"
Write-State "APP_EXE_EXISTS" (Test-Path $appExe)
if (Test-Path $appExe) {
  $info = Get-Item $appExe
  Write-State "APP_EXE_SIZE_MB" ([math]::Round($info.Length / 1MB, 1))
  Write-State "APP_LAUNCH_START" "YES"
  Start-Process -FilePath $appExe -ArgumentList "--remote-debugging-port=9223" -WorkingDirectory (Split-Path -Parent $appExe)
  Start-Sleep -Seconds 20
  Write-State "PORT_18789_GATEWAY" (Test-Port 18789)
  Write-State "PORT_13210_HOSTAPI" (Test-Port 13210)
  Write-State "PORT_9223_ELECTRON_CDP" (Test-Port 9223)
}

$logDir = Join-Path $env:APPDATA "Ministry of Education\logs"
Write-State "LOG_DIR_EXISTS" (Test-Path $logDir)
if (Test-Path $logDir) {
  $latest = Get-ChildItem -LiteralPath $logDir -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if ($latest) {
    Write-State "LATEST_LOG" $latest.FullName
    Copy-Item -LiteralPath $latest.FullName -Destination (Join-Path $script:Root ("latest-" + $latest.Name)) -Force -ErrorAction SilentlyContinue
  }
}

Write-State "SANDBOX_DONE" "YES"
Read-Host "Fresh install smoke complete. Press Enter to close this PowerShell window"
'@
  Set-Content -LiteralPath $insideScript -Value $insideScriptContent -Encoding UTF8

  $folderName = Split-Path -Leaf $artifact
  $insideMappedScript = "C:\Users\WDAGUtilityAccount\Desktop\$folderName\run-inside-sandbox.ps1"
  $wsbPath = Join-Path $artifact "ClawXFreshInstall.wsb"
  $wsb = @"
<Configuration>
  <MappedFolders>
    <MappedFolder>
      <HostFolder>$(Escape-Xml $artifact)</HostFolder>
      <ReadOnly>false</ReadOnly>
    </MappedFolder>
  </MappedFolders>
  <LogonCommand>
    <Command>powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(Escape-Xml $insideMappedScript)"</Command>
  </LogonCommand>
</Configuration>
"@
  Set-Content -LiteralPath $wsbPath -Value $wsb -Encoding UTF8

  Write-State "SANDBOX_ARTIFACT_DIR" $artifact
  Write-State "SANDBOX_INSTALLER" $installerTarget
  Write-State "SANDBOX_SCRIPT" $insideScript
  Write-State "SANDBOX_WSB" $wsbPath
  Write-State "SANDBOX_FEATURE" (Get-SandboxFeatureState)
  Write-State "SANDBOX_PACKAGE_READY" $wsbPath

  if ($OpenSandbox) {
    if (-not (Get-Command WindowsSandbox.exe -ErrorAction SilentlyContinue)) {
      Write-State "OPEN_SANDBOX" "BLOCKED_WINDOWS_SANDBOX_EXE_MISSING"
      return
    }
    Write-State "OPEN_SANDBOX" "START"
    Start-Process -FilePath "WindowsSandbox.exe" -ArgumentList "`"$wsbPath`""
  }
}

if (-not (Test-Path $ArtifactRoot)) {
  New-Item -ItemType Directory -Force -Path $ArtifactRoot | Out-Null
}

if ($Mode -eq "Probe") {
  Write-Probe
} elseif ($Mode -eq "CreateSandbox") {
  Write-Probe
  New-SandboxPackage
}
