# pilot-temp-user-fresh-install-smoke.ps1
#
# Runs a non-destructive fresh-user install smoke over SSH.
#
# It creates a temporary local Windows user, runs the NSIS installer under that
# user's profile, collects evidence, and removes the user by default. It does
# not uninstall or mutate the active demo user's app/profile.

[CmdletBinding()]
param(
  [string] $UserPrefix = "ClawXFresh",
  [string] $InstallerPath,
  [string] $InstallerPattern = "Ministry.of.Education-*-win-x64.exe",
  [string] $ArtifactRoot = "$env:PUBLIC\Downloads",
  [int] $LaunchWaitSeconds = 25,
  [switch] $KeepUser,
  [switch] $SkipLaunch
)

$ErrorActionPreference = "Continue"

function Write-State($name, $value) {
  $line = "STATE:{0}={1}" -f $name, $value
  Write-Output $line
  if ($script:LogPath) {
    Add-Content -Path $script:LogPath -Value $line -ErrorAction SilentlyContinue
  }
}

function Test-Port($port) {
  try {
    $conn = Get-NetTCPConnection -State Listen -LocalAddress 127.0.0.1 -LocalPort $port -ErrorAction Stop
    return $null -ne $conn
  } catch {
    return $false
  }
}

function ConvertTo-TempUserSecureString {
  # CLWX-83: the password is a RANDOM throwaway for a disposable local
  # smoke-test account (removed by default at the end of the run) - never a
  # real credential. New-LocalUser requires a SecureString built from the
  # generated plaintext. Suppression is scoped to THIS helper so any future
  # ConvertTo-SecureString use elsewhere in the file still gets flagged.
  [Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSAvoidUsingConvertToSecureStringWithPlainText', '')]
  param([string] $PlainPassword)
  return (ConvertTo-SecureString $PlainPassword -AsPlainText -Force)
}

function New-RandomPassword {
  $chars = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@$%*-_"
  $bytes = New-Object byte[] 24
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  -join ($bytes | ForEach-Object { $chars[[int]$_ % $chars.Length] })
}

function Get-InstallerCandidates {
  if ($InstallerPath) {
    $resolved = Resolve-Path -LiteralPath $InstallerPath -ErrorAction SilentlyContinue
    if ($resolved) {
      return @(Get-Item -LiteralPath $resolved.Path -ErrorAction Stop)
    }
    return @()
  }

  $roots = @(
    "$env:USERPROFILE\Downloads",
    "$env:PUBLIC\Downloads",
    "$env:USERPROFILE\Desktop",
    (Get-Location).Path
  ) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique

  $items = @()
  foreach ($root in $roots) {
    $items += Get-ChildItem -LiteralPath $root -Filter $InstallerPattern -File -ErrorAction SilentlyContinue
  }
  return @($items | Sort-Object LastWriteTime -Descending)
}

function Schedule-ProfileCleanupOnStart($userName, $profileDir) {
  $taskName = "ClawXProfileCleanup-$userName"
  $cleanupScript = Join-Path $env:PUBLIC ("Downloads\clawx-profile-cleanup-$userName.ps1")
  $escapedProfileDir = $profileDir.Replace("'", "''")
  $body = @"
`$ErrorActionPreference = "Continue"
`$profileDir = '$escapedProfileDir'
Get-CimInstance Win32_UserProfile | Where-Object { `$_.LocalPath -eq `$profileDir -and -not `$_.Loaded } | ForEach-Object {
  try { Remove-CimInstance -InputObject `$_ -ErrorAction Stop } catch {}
}
if (Test-Path `$profileDir) {
  try { Remove-Item -LiteralPath `$profileDir -Recurse -Force -ErrorAction Stop } catch {}
}
& schtasks.exe /Delete /TN "$taskName" /F | Out-Null
"@
  Set-Content -LiteralPath $cleanupScript -Value $body -Encoding UTF8
  $taskCommand = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$cleanupScript`""
  & schtasks.exe /Create /TN $taskName /TR $taskCommand /SC ONSTART /RU SYSTEM /RL HIGHEST /F 2>&1 |
    ForEach-Object { Write-State "TEMP_PROFILE_CLEANUP_ONSTART_OUTPUT" $_ }
  Write-State "TEMP_PROFILE_CLEANUP_ONSTART_EXIT" $LASTEXITCODE
}

function Remove-TempUser($userName) {
  try {
    Remove-LocalUser -Name $userName -ErrorAction Stop
    Write-State "TEMP_USER_REMOVED" "True"
  } catch {
    Write-State "TEMP_USER_REMOVED" "False"
    Write-State "TEMP_USER_REMOVE_ERROR" $_.Exception.Message
  }

  $profileDir = Join-Path "C:\Users" $userName
  if (Test-Path $profileDir) {
    try {
      Remove-Item -LiteralPath $profileDir -Recurse -Force -ErrorAction Stop
      Write-State "TEMP_PROFILE_DIR_REMOVED" "True"
    } catch {
      Write-State "TEMP_PROFILE_DIR_REMOVED" "False"
      Write-State "TEMP_PROFILE_DIR_REMOVE_ERROR" $_.Exception.Message
      Schedule-ProfileCleanupOnStart $userName $profileDir
    }
  } else {
    Write-State "TEMP_PROFILE_DIR_EXISTS_AFTER_REMOVE" "False"
  }
}

function Invoke-Secedit($label, $arguments) {
  $output = & secedit.exe @arguments 2>&1
  $exitCode = $LASTEXITCODE
  $script:LastSeceditExit = $exitCode
  Write-State ($label + "_EXIT") $exitCode
  if ($output) {
    $output | ForEach-Object { Write-State ($label + "_OUTPUT") $_ }
  }
}

function Grant-BatchLogonRight($userName, $artifactDir) {
  $account = New-Object System.Security.Principal.NTAccount($env:COMPUTERNAME, $userName)
  $sid = $account.Translate([System.Security.Principal.SecurityIdentifier]).Value
  $sidEntry = "*$sid"
  Write-State "TEMP_USER_SID" $sid

  $before = Join-Path $artifactDir "security-policy-before.inf"
  $grant = Join-Path $artifactDir "security-policy-grant.inf"
  $db = Join-Path $artifactDir "security-policy-grant.sdb"
  $script:SecurityPolicyBefore = $before

  Invoke-Secedit "SECEDIT_EXPORT" @("/export", "/cfg", $before, "/areas", "USER_RIGHTS")
  $exportExit = $script:LastSeceditExit
  if ($exportExit -ne 0 -or -not (Test-Path $before)) {
    throw "secedit export failed"
  }

  $content = @(Get-Content -LiteralPath $before -ErrorAction Stop)
  $found = $false
  $updated = for ($i = 0; $i -lt $content.Count; $i++) {
    $line = $content[$i]
    if ($line -match "^\s*SeBatchLogonRight\s*=") {
      $found = $true
      $rights = @(
        ($line -replace "^\s*SeBatchLogonRight\s*=", "").Split(",") |
          ForEach-Object { $_.Trim() } |
          Where-Object { $_ }
      )
      if ($rights -notcontains $sidEntry) {
        $rights += $sidEntry
      }
      "SeBatchLogonRight = " + ($rights -join ",")
    } else {
      $line
    }
  }
  if (-not $found) {
    $updated += "SeBatchLogonRight = $sidEntry"
  }

  Set-Content -LiteralPath $grant -Value $updated -Encoding Unicode
  Invoke-Secedit "SECEDIT_GRANT_BATCH_LOGON" @("/configure", "/db", $db, "/cfg", $grant, "/areas", "USER_RIGHTS")
  $grantExit = $script:LastSeceditExit
  if ($grantExit -ne 0) {
    throw "secedit configure failed while granting SeBatchLogonRight"
  }
  Write-State "TEMP_USER_BATCH_LOGON_GRANTED" "True"
}

function Restore-UserRightsPolicy($artifactDir) {
  if (-not $script:SecurityPolicyBefore -or -not (Test-Path $script:SecurityPolicyBefore)) {
    return
  }
  $restoreDb = Join-Path $artifactDir "security-policy-restore.sdb"
  Invoke-Secedit "SECEDIT_RESTORE_USER_RIGHTS" @("/configure", "/db", $restoreDb, "/cfg", $script:SecurityPolicyBefore, "/areas", "USER_RIGHTS")
  $restoreExit = $script:LastSeceditExit
  if ($restoreExit -eq 0) {
    Write-State "USER_RIGHTS_RESTORED" "True"
  } else {
    Write-State "USER_RIGHTS_RESTORED" "False"
  }
}

function Invoke-ScheduledPowerShellTask {
  # CLWX-83: throwaway random password for the temp smoke account; schtasks
  # /RU + /RP require the plaintext pair, so PSCredential does not fit here.
  # Residual (accepted): /RP puts the password on schtasks.exe's command line
  # for the seconds it runs - visible to a local process-lister. Throwaway
  # account, removed with its tasks by default on every exit path.
  [Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSAvoidUsingUsernameAndPasswordParams', '')]
  [Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSAvoidUsingPlainTextForPassword', '')]
  param($taskName, $userName, $plainPassword, $scriptPath, $timeoutSeconds)
  $taskUser = "$env:COMPUTERNAME\$userName"
  $startAt = (Get-Date).AddMinutes(1).ToString("HH:mm")
  $taskCommand = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`""
  $createArgs = @(
    "/Create",
    "/TN", $taskName,
    "/TR", $taskCommand,
    "/SC", "ONCE",
    "/ST", $startAt,
    "/RU", $taskUser,
    "/RP", $plainPassword,
    "/RL", "LIMITED",
    "/F"
  )
  $createOutput = & schtasks.exe @createArgs 2>&1
  Write-State ($taskName + "_CREATE_EXIT") $LASTEXITCODE
  if ($createOutput) {
    $createOutput | ForEach-Object { Write-State ($taskName + "_CREATE_OUTPUT") $_ }
  }
  if ($LASTEXITCODE -ne 0) {
    throw "schtasks /Create failed for $taskName"
  }

  $startTime = Get-Date
  $runOutput = & schtasks.exe /Run /TN $taskName 2>&1
  Write-State ($taskName + "_RUN_EXIT") $LASTEXITCODE
  if ($runOutput) {
    $runOutput | ForEach-Object { Write-State ($taskName + "_RUN_OUTPUT") $_ }
  }
  if ($LASTEXITCODE -ne 0) {
    throw "schtasks /Run failed for $taskName"
  }

  $deadline = (Get-Date).AddSeconds($timeoutSeconds)
  do {
    Start-Sleep -Seconds 2
    $info = Get-ScheduledTaskInfo -TaskName $taskName -ErrorAction SilentlyContinue
    $state = (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue).State
    $hasRun = $info -and $info.LastRunTime -and $info.LastRunTime -ge $startTime.AddSeconds(-2)
    $hasTerminalResult = $hasRun -and $info.LastTaskResult -ne 267009
    if ($hasRun -and $state -and $state -ne "Running" -and $state -ne "Queued") {
      break
    }
    if ($hasTerminalResult) {
      break
    }
  } while ((Get-Date) -lt $deadline)

  $finalState = (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue).State
  if ($finalState -eq "Running" -or $finalState -eq "Queued") {
    Write-State ($taskName + "_TIMEOUT") "True"
    & schtasks.exe /End /TN $taskName 2>&1 | ForEach-Object { Write-State ($taskName + "_END_OUTPUT") $_ }
    Start-Sleep -Seconds 2
  }

  $info = Get-ScheduledTaskInfo -TaskName $taskName -ErrorAction SilentlyContinue
  if ($info) {
    Write-State ($taskName + "_LAST_TASK_RESULT") $info.LastTaskResult
  }

  try {
    & schtasks.exe /Delete /TN $taskName /F 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
      Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue | Out-Null
    }
  } catch {
    Write-State ($taskName + "_UNREGISTER_ERROR") $_.Exception.Message
  }
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$userName = ("{0}{1}" -f $UserPrefix, (Get-Date -Format "HHmmss"))
$artifact = Join-Path $ArtifactRoot ("clawx-temp-user-smoke-" + $stamp)
New-Item -ItemType Directory -Force -Path $artifact | Out-Null
$script:LogPath = Join-Path $artifact "smoke.log"
"Fresh user install smoke: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')" | Set-Content -Path $script:LogPath

Write-State "MODE" "TempUserFreshInstallSmoke"
Write-State "TIMESTAMP" (Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz")
Write-State "RUNNING_AS" $env:USERNAME
Write-State "ARTIFACT_DIR" $artifact
Write-State "TEMP_USER" $userName
Write-State "PRE_PORT_18789_GATEWAY" (Test-Port 18789)
Write-State "PRE_PORT_13210_HOSTAPI" (Test-Port 13210)
Write-State "PRE_PORT_18792_CHROME_CDP" (Test-Port 18792)

$installers = @(Get-InstallerCandidates)
Write-State "INSTALLER_COUNT" $installers.Count
if ($installers.Count -eq 0) {
  Write-State "RESULT" "BLOCKED_NO_INSTALLER"
  exit 2
}

$installer = $installers[0]
$installerCopy = Join-Path $artifact $installer.Name
Copy-Item -LiteralPath $installer.FullName -Destination $installerCopy -Force
Write-State "INSTALLER" ("{0}|{1:n1}MB|{2}" -f $installer.FullName, ($installer.Length / 1MB), $installer.LastWriteTime)
Write-State "INSTALLER_COPY" $installerCopy

$plainPassword = New-RandomPassword
$securePassword = ConvertTo-TempUserSecureString $plainPassword

try {
  New-LocalUser -Name $userName -Password $securePassword -FullName "ClawX Fresh Install Smoke" -Description "Temporary ClawX fresh install smoke account" -ErrorAction Stop | Out-Null
  Add-LocalGroupMember -Group "Users" -Member $userName -ErrorAction Stop
  Write-State "TEMP_USER_CREATED" "True"
  Grant-BatchLogonRight $userName $artifact

  $installTaskLog = Join-Path $artifact "installer-task.log"
  $installProcessLog = Join-Path $artifact "installer-process-output.log"
  $installRunner = Join-Path $artifact "run-installer-task.ps1"
  $installRunnerBody = @"
`$ErrorActionPreference = "Continue"
function Write-TaskState(`$name, `$value) {
  Add-Content -Path "$installTaskLog" -Value ("STATE:{0}={1}" -f `$name, `$value)
}
Write-TaskState "TASK_RUNNING_AS" ([Security.Principal.WindowsIdentity]::GetCurrent().Name)
Write-TaskState "TASK_PROFILE" `$env:USERPROFILE
Write-TaskState "TASK_INSTALLER" "$installerCopy"
Write-TaskState "TASK_INSTALL_START" (Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz")
& "$installerCopy" /S *> "$installProcessLog"
Write-TaskState "TASK_INSTALL_EXIT" `$LASTEXITCODE
Write-TaskState "TASK_FINISHED_AT" (Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz")
"@
  Set-Content -Path $installRunner -Value $installRunnerBody -Encoding UTF8

  Write-State "INSTALL_START" "True"
  $installTaskName = "ClawXFreshInstall-$stamp"
  Invoke-ScheduledPowerShellTask $installTaskName $userName $plainPassword $installRunner 240
  if (Test-Path $installTaskLog) {
    Get-Content -LiteralPath $installTaskLog -ErrorAction SilentlyContinue | ForEach-Object { Write-Output $_; Add-Content -Path $script:LogPath -Value $_ -ErrorAction SilentlyContinue }
  } else {
    Write-State "INSTALL_TASK_LOG_EXISTS" "False"
  }

  $profileDir = Join-Path "C:\Users" $userName
  $appExe = Join-Path $profileDir "AppData\Local\Programs\Ministry of Education\Ministry of Education.exe"
  $appData = Join-Path $profileDir "AppData\Roaming\Ministry of Education"
  $openclaw = Join-Path $profileDir ".openclaw"
  Write-State "PROFILE_DIR_EXISTS" (Test-Path $profileDir)
  Write-State "APP_EXE_EXISTS" (Test-Path $appExe)
  if (Test-Path $appExe) {
    $info = Get-Item $appExe
    Write-State "APP_EXE_SIZE_MB" ([math]::Round($info.Length / 1MB, 1))
  }
  Write-State "APPDATA_EXISTS" (Test-Path $appData)
  Write-State "OPENCLAW_EXISTS" (Test-Path $openclaw)

  if (-not (Test-Path $appExe)) {
    Restore-UserRightsPolicy $artifact
    if (-not $KeepUser) {
      Remove-TempUser $userName
    } else {
      Write-State "TEMP_USER_KEPT" "True"
    }
    Write-State "RESULT" "FAILED_INSTALL_NO_APP_EXE"
    exit 3
  }

  if (-not $SkipLaunch -and (Test-Path $appExe)) {
    Write-State "APP_LAUNCH_START" "True"
    try {
      $launchTaskLog = Join-Path $artifact "launch-task.log"
      $launchRunner = Join-Path $artifact "run-launch-task.ps1"
      $launchRunnerBody = @"
`$ErrorActionPreference = "Continue"
function Write-TaskState(`$name, `$value) {
  Add-Content -Path "$launchTaskLog" -Value ("STATE:{0}={1}" -f `$name, `$value)
}
Write-TaskState "TASK_RUNNING_AS" ([Security.Principal.WindowsIdentity]::GetCurrent().Name)
Write-TaskState "TASK_APP_EXE" "$appExe"
`$proc = Start-Process -FilePath "$appExe" -PassThru -WindowStyle Minimized
Write-TaskState "TASK_APP_PID" `$proc.Id
Start-Sleep -Seconds $LaunchWaitSeconds
try {
  if (`$proc -and -not `$proc.HasExited) {
    Stop-Process -Id `$proc.Id -Force -ErrorAction SilentlyContinue
    Write-TaskState "TASK_APP_STOPPED" "True"
  }
} catch {
  Write-TaskState "TASK_APP_STOP_ERROR" `$_.Exception.Message
}
Write-TaskState "TASK_FINISHED_AT" (Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz")
"@
      Set-Content -Path $launchRunner -Value $launchRunnerBody -Encoding UTF8
      $launchTaskName = "ClawXFreshLaunch-$stamp"
      Invoke-ScheduledPowerShellTask $launchTaskName $userName $plainPassword $launchRunner ([math]::Max(60, $LaunchWaitSeconds + 30))
      if (Test-Path $launchTaskLog) {
        Get-Content -LiteralPath $launchTaskLog -ErrorAction SilentlyContinue | ForEach-Object { Write-Output $_; Add-Content -Path $script:LogPath -Value $_ -ErrorAction SilentlyContinue }
      } else {
        Write-State "APP_LAUNCH_TASK_LOG_EXISTS" "False"
      }
      Start-Sleep -Seconds $LaunchWaitSeconds
      Write-State "POST_PORT_18789_GATEWAY" (Test-Port 18789)
      Write-State "POST_PORT_13210_HOSTAPI" (Test-Port 13210)
      Write-State "POST_PORT_18792_CHROME_CDP" (Test-Port 18792)
    } catch {
      Write-State "APP_LAUNCH_ERROR" $_.Exception.Message
    }
  } elseif ($SkipLaunch) {
    Write-State "APP_LAUNCH_SKIPPED" "True"
  }

  $logDir = Join-Path $appData "logs"
  Write-State "LOG_DIR_EXISTS" (Test-Path $logDir)
  if (Test-Path $logDir) {
    $latest = Get-ChildItem -LiteralPath $logDir -File -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 1
    if ($latest) {
      Write-State "LATEST_LOG" $latest.FullName
      Copy-Item -LiteralPath $latest.FullName -Destination (Join-Path $artifact ("latest-" + $latest.Name)) -Force -ErrorAction SilentlyContinue
    }
  }

  if ($KeepUser) {
    Restore-UserRightsPolicy $artifact
    Write-State "TEMP_USER_KEPT" "True"
  } else {
    Restore-UserRightsPolicy $artifact
    Remove-TempUser $userName
  }

  Write-State "RESULT" "COMPLETE"
} catch {
  Write-State "RESULT" "FAILED"
  Write-State "ERROR" $_.Exception.Message
  Restore-UserRightsPolicy $artifact
  if (-not $KeepUser) {
    Remove-TempUser $userName
  }
  exit 1
} finally {
  $plainPassword = $null
  $securePassword = $null
}
