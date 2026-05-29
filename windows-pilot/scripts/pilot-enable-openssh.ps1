# pilot-enable-openssh.ps1
# Enables Windows OpenSSH Server for the pilot laptop.
# Idempotent: yes. Requires Administrator for installing capability/firewall changes.

[CmdletBinding()]
param(
  [switch] $ProbeOnly
)

$ErrorActionPreference = "Stop"

function Write-State($name, $value) {
  Write-Output ("STATE:{0}={1}" -f $name, $value)
}

function Test-IsAdmin {
  $current = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($current)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

Write-State "USER" ([Security.Principal.WindowsIdentity]::GetCurrent().Name)
$adminState = "FALSE"
if (Test-IsAdmin) { $adminState = "TRUE" }
Write-State "ADMIN" $adminState

$cap = Get-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0 -ErrorAction SilentlyContinue
Write-State "OPENSSH_CAPABILITY" ($cap.State)

if (-not $ProbeOnly -and $cap.State -ne "Installed") {
  if (-not (Test-IsAdmin)) {
    Write-State "INSTALL" "BLOCKED_NEEDS_ADMIN"
  } else {
    Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0 | Out-Null
    Write-State "INSTALL" "OK"
  }
}

$svc = Get-Service sshd -ErrorAction SilentlyContinue
$svcExists = "FALSE"
if ($svc) { $svcExists = "TRUE" }
Write-State "SSHD_SERVICE_EXISTS" $svcExists

if ($svc -and -not $ProbeOnly) {
  if ($svc.StartType -ne "Automatic") {
    Set-Service -Name sshd -StartupType Automatic
    Write-State "SSHD_STARTUP" "AUTOMATIC"
  }
  if ($svc.Status -ne "Running") {
    Start-Service sshd
    Write-State "SSHD_STARTED" "TRUE"
  }
}

$svc = Get-Service sshd -ErrorAction SilentlyContinue
if ($svc) {
  Write-State "SSHD_STATUS" $svc.Status
  Write-State "SSHD_START_TYPE" $svc.StartType
}

$rule = Get-NetFirewallRule -Name sshd -ErrorAction SilentlyContinue
$ruleExists = "FALSE"
if ($rule) { $ruleExists = "TRUE" }
Write-State "FIREWALL_RULE_EXISTS" $ruleExists

if (-not $ProbeOnly -and -not $rule) {
  if (-not (Test-IsAdmin)) {
    Write-State "FIREWALL" "BLOCKED_NEEDS_ADMIN"
  } else {
    New-NetFirewallRule -Name sshd -DisplayName "OpenSSH Server (sshd)" -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 | Out-Null
    Write-State "FIREWALL" "CREATED"
  }
} elseif ($rule) {
  Write-State "FIREWALL_ENABLED" $rule.Enabled
}

$listeners = Get-NetTCPConnection -LocalPort 22 -State Listen -ErrorAction SilentlyContinue
$port22Listen = "FALSE"
if ($listeners) { $port22Listen = "TRUE" }
Write-State "PORT22_LISTEN" $port22Listen
Write-State "DONE" "OPENSSH_PROBE_OR_ENABLE"
