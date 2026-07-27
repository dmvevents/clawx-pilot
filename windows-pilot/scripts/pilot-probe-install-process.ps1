# pilot-probe-install-process.ps1
#
# Captures installer/app process details without depending on fragile SSH
# quoting around paths that contain spaces.

[CmdletBinding()]
param(
  [string] $NamePattern = "Education|Ministry|setup|nsis"
)

$ErrorActionPreference = "Continue"

function Write-State($name, $value) {
  "STATE:{0}={1}" -f $name, $value
}

Write-State "MODE" "InstallProcessProbe"
Write-State "TIMESTAMP" (Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz")

$processes = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object {
    ($_.Name -match $NamePattern) -or
    ($_.CommandLine -match $NamePattern) -or
    ($_.ExecutablePath -match $NamePattern)
  } |
  Sort-Object ProcessId

Write-State "PROCESS_COUNT" @($processes).Count

foreach ($proc in $processes) {
  $owner = $null
  try {
    $ownerInfo = Invoke-CimMethod -InputObject $proc -MethodName GetOwner -ErrorAction Stop
    if ($ownerInfo.ReturnValue -eq 0) {
      $owner = "{0}\{1}" -f $ownerInfo.Domain, $ownerInfo.User
    }
  } catch {}

  $created = $null
  try {
    $created = [Management.ManagementDateTimeConverter]::ToDateTime($proc.CreationDate)
  } catch {}

  Write-State "PROCESS" ("pid={0}|ppid={1}|name={2}|owner={3}|created={4}|path={5}|cmd={6}" -f
    $proc.ProcessId,
    $proc.ParentProcessId,
    $proc.Name,
    $owner,
    $created,
    $proc.ExecutablePath,
    $proc.CommandLine
  )
}
