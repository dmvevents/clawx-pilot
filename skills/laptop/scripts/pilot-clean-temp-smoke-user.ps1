# pilot-clean-temp-smoke-user.ps1
#
# Cleans up a temporary user created by pilot-temp-user-fresh-install-smoke.ps1
# and restores the saved user-rights policy when the smoke wrapper is
# interrupted before its normal finally path.

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string] $UserName,

  [string] $ArtifactDir,

  [switch] $SkipProcessStop
)

$ErrorActionPreference = "Continue"

function Write-State($name, $value) {
  "STATE:{0}={1}" -f $name, $value
}

Write-State "MODE" "CleanTempSmokeUser"
Write-State "USER" $UserName

if (-not $SkipProcessStop) {
  $userProcesses = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $owner = $null
    try {
      $ownerInfo = Invoke-CimMethod -InputObject $_ -MethodName GetOwner -ErrorAction Stop
      if ($ownerInfo.ReturnValue -eq 0) {
        $owner = $ownerInfo.User
      }
    } catch {}
    $owner -eq $UserName
  }

  foreach ($proc in $userProcesses) {
    try {
      Stop-Process -Id $proc.ProcessId -Force -ErrorAction Stop
      Write-State "PROCESS_STOPPED" ("{0}|{1}" -f $proc.ProcessId, $proc.Name)
    } catch {
      Write-State "PROCESS_STOP_ERROR" ("{0}|{1}|{2}" -f $proc.ProcessId, $proc.Name, $_.Exception.Message)
    }
  }
}

if ($ArtifactDir) {
  $before = Join-Path $ArtifactDir "security-policy-before.inf"
  if (Test-Path $before) {
    $restoreDb = Join-Path $ArtifactDir "security-policy-restore.sdb"
    $output = & secedit.exe /configure /db $restoreDb /cfg $before /areas USER_RIGHTS 2>&1
    Write-State "SECEDIT_RESTORE_EXIT" $LASTEXITCODE
    if ($output) {
      $output | ForEach-Object { Write-State "SECEDIT_RESTORE_OUTPUT" $_ }
    }
  } else {
    Write-State "SECEDIT_RESTORE_SKIPPED" "MissingPolicyBackup"
  }
} else {
  Write-State "SECEDIT_RESTORE_SKIPPED" "NoArtifactDir"
}

$taskNames = @(
  "ClawXFreshInstall-*",
  "ClawXFreshLaunch-*",
  "ClawXProfileCleanup-$UserName"
)

foreach ($taskPattern in $taskNames) {
  Get-ScheduledTask -TaskName $taskPattern -ErrorAction SilentlyContinue | ForEach-Object {
    try {
      Unregister-ScheduledTask -TaskName $_.TaskName -Confirm:$false -ErrorAction Stop | Out-Null
      Write-State "TASK_REMOVED" $_.TaskName
    } catch {
      Write-State "TASK_REMOVE_ERROR" ("{0}|{1}" -f $_.TaskName, $_.Exception.Message)
    }
  }
}

try {
  Remove-LocalUser -Name $UserName -ErrorAction Stop
  Write-State "TEMP_USER_REMOVED" "True"
} catch {
  if (Get-LocalUser -Name $UserName -ErrorAction SilentlyContinue) {
    Write-State "TEMP_USER_REMOVED" "False"
    Write-State "TEMP_USER_REMOVE_ERROR" $_.Exception.Message
  } else {
    Write-State "TEMP_USER_REMOVED" "AlreadyAbsent"
  }
}

$profileDir = Join-Path "C:\Users" $UserName
if (Test-Path $profileDir) {
  try {
    Remove-Item -LiteralPath $profileDir -Recurse -Force -ErrorAction Stop
    Write-State "TEMP_PROFILE_REMOVED" "True"
  } catch {
    Write-State "TEMP_PROFILE_REMOVED" "False"
    Write-State "TEMP_PROFILE_REMOVE_ERROR" $_.Exception.Message
  }
} else {
  Write-State "TEMP_PROFILE_REMOVED" "AlreadyAbsent"
}

Write-State "RESULT" "COMPLETE"
