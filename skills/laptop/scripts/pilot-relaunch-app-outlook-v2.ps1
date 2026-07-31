# pilot-relaunch-app-outlook-v2.ps1 - restart the installed Ministry app with
# Electron remote debugging for SSH probes. It also sets CLAWX_OUTLOOK_V2=1 as
# a compatibility override for older installed builds; current pilot builds
# default to the Playwright/CDP Outlook manager.
#
# Read-only: NO - closes/restarts the app. Does not delete data and does not
# touch Chrome/CDP.
# Safety: attempts graceful CloseMainWindow first, then terminates leftover app
# helper processes only so the relaunch has a clean environment.

param(
    [int]$WaitSeconds = 45,
    [string]$TaskName = "ClawX Launch App Outlook V2",
    [int]$ElectronDebugPort = 9223,
    [string]$KeepaliveTaskName = "ClawX App Keepalive",
    [switch]$UseKeepalive
)

$ErrorActionPreference = "Stop"

function Test-Port($port) {
    try {
        $conn = Get-NetTCPConnection -State Listen -LocalAddress 127.0.0.1 -LocalPort $port -ErrorAction Stop
        return $null -ne $conn
    } catch { return $false }
}

function Test-CDPHttp($port) {
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:$port/json/version" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        return $response.StatusCode -eq 200
    } catch { return $false }
}

function Repair-KeepaliveDebugPort($port) {
    $keepalivePath = Join-Path $env:USERPROFILE "Downloads\clawx-autonomous\clawx-app-keepalive.ps1"
    if (-not (Test-Path $keepalivePath)) {
        Write-Host "KEEPALIVE_SCRIPT: missing"
        return $false
    }

    $content = Get-Content -LiteralPath $keepalivePath -Raw
    if ($content -match "--remote-debugging-port=$port") {
        Write-Host "KEEPALIVE_SCRIPT: already has debug port $port"
        return $true
    }
    if ($content -notmatch "--remote-debugging-port=18792") {
        Write-Host "KEEPALIVE_SCRIPT: no app debug flag found; will use explicit debug launch"
        return $false
    }

    $backup = "$keepalivePath.bak-$(Get-Date -Format yyyyMMdd-HHmmss)"
    Copy-Item -LiteralPath $keepalivePath -Destination $backup -Force
    $content.Replace("--remote-debugging-port=18792", "--remote-debugging-port=$port") |
        Set-Content -LiteralPath $keepalivePath -Encoding UTF8
    Write-Host "KEEPALIVE_SCRIPT: patched app debug port to $port"
    Write-Host "KEEPALIVE_SCRIPT_BACKUP: $backup"
    return $true
}

function Get-AppDebugCommandLines($exePath) {
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -eq "Ministry of Education.exe" -or $_.ExecutablePath -eq $exePath } |
        Select-Object ProcessId, CommandLine
}

function Restore-KeepaliveTask($taskName, $wasEnabled) {
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if (-not $task) { return }

    if ($wasEnabled) {
        Enable-ScheduledTask -TaskName $taskName | Out-Null
        "Restored keepalive task enabled: $taskName"
    } else {
        Disable-ScheduledTask -TaskName $taskName | Out-Null
        "Restored keepalive task disabled: $taskName"
    }
}

function Escape-ForSingleQuotedPowerShell([string]$value) {
    return $value.Replace("'", "''")
}

$appExe = Join-Path $env:LOCALAPPDATA "Programs\Ministry of Education\Ministry of Education.exe"
if (-not (Test-Path $appExe)) {
    "STATE: APP_NOT_FOUND"
    "Missing: $appExe"
    exit 30
}
$resourcesDir = Join-Path (Split-Path -Parent $appExe) "resources"
if (-not (Test-Path $resourcesDir)) {
    "STATE: RESOURCES_NOT_FOUND"
    "Missing: $resourcesDir"
    exit 31
}

"=== App relaunch: Outlook V2 ==="
"App: $appExe"
"WorkingDirectory: $resourcesDir"
"Electron CDP: 127.0.0.1:$ElectronDebugPort"

$keepaliveWasEnabled = $false
$keepaliveCanLaunchWithDebug = $false
$keepaliveTask = Get-ScheduledTask -TaskName $KeepaliveTaskName -ErrorAction SilentlyContinue
if ($keepaliveTask) {
    $keepaliveWasEnabled = $keepaliveTask.Settings.Enabled
    if ($keepaliveTask.State -eq "Running") {
        "Stopping keepalive task during controlled relaunch: $KeepaliveTaskName"
        Stop-ScheduledTask -TaskName $KeepaliveTaskName -ErrorAction SilentlyContinue
    }
    if ($keepaliveWasEnabled) {
        "Disabling keepalive task during controlled relaunch: $KeepaliveTaskName"
        Disable-ScheduledTask -TaskName $KeepaliveTaskName | Out-Null
    }
    $keepaliveCanLaunchWithDebug = Repair-KeepaliveDebugPort $ElectronDebugPort
} else {
    "Keepalive task not found: $KeepaliveTaskName"
}

$procs = @(Get-Process "Ministry of Education" -ErrorAction SilentlyContinue)
if ($procs.Count -gt 0) {
    "Closing existing app processes: $($procs.Count)"
    foreach ($p in $procs) {
        if ($p.MainWindowHandle -ne 0) {
            try { [void]$p.CloseMainWindow() } catch {}
        }
    }
    Start-Sleep -Seconds 6
    $left = @(Get-Process "Ministry of Education" -ErrorAction SilentlyContinue)
    if ($left.Count -gt 0) {
        "Stopping leftover helper processes: $($left.Count)"
        $left | Stop-Process -Force -ErrorAction SilentlyContinue
    }
} else {
    "No existing app processes."
}

Start-Sleep -Seconds 2

$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$appArgs = "--remote-debugging-port=$ElectronDebugPort"
[Environment]::SetEnvironmentVariable('CLAWX_OUTLOOK_V2','1','User')

$usedKeepaliveLaunch = $false
if ($UseKeepalive -and $keepaliveTask -and $keepaliveCanLaunchWithDebug) {
    Enable-ScheduledTask -TaskName $KeepaliveTaskName | Out-Null
    Start-ScheduledTask -TaskName $KeepaliveTaskName
    $usedKeepaliveLaunch = $true
    "STATE: KEEPALIVE_TASK_STARTED"
} else {
    if ($keepaliveTask -and -not $UseKeepalive) {
        "STATE: KEEPALIVE_SKIPPED_BY_DEFAULT"
    } elseif ($keepaliveTask -and -not $keepaliveCanLaunchWithDebug) {
        "STATE: KEEPALIVE_SKIPPED_FOR_DEBUG_LAUNCH"
    }
    $psExe = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
    $launcherDir = Join-Path $env:PUBLIC "Downloads"
    if (-not (Test-Path $launcherDir)) {
        New-Item -ItemType Directory -Force -Path $launcherDir | Out-Null
    }
    $launcherPath = Join-Path $launcherDir "clawx-app-debug-launcher.ps1"
    $launcherLog = Join-Path $launcherDir "clawx-app-debug-launcher.log"
    $escapedAppExe = Escape-ForSingleQuotedPowerShell $appExe
    $escapedResourcesDir = Escape-ForSingleQuotedPowerShell $resourcesDir
    $escapedAppArgs = Escape-ForSingleQuotedPowerShell $appArgs
    $escapedLauncherLog = Escape-ForSingleQuotedPowerShell $launcherLog
    $launcherBody = @"
`$ErrorActionPreference = "Continue"
function Write-LaunchLog([string]`$message) {
  Add-Content -LiteralPath '$escapedLauncherLog' -Value ("[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), `$message)
}
Write-LaunchLog "launcher start user=`$env:USERNAME"
`$env:CLAWX_OUTLOOK_V2 = '1'
[Environment]::SetEnvironmentVariable('CLAWX_OUTLOOK_V2', '1', 'User')
Write-LaunchLog "app=$escapedAppExe"
Write-LaunchLog "args=$escapedAppArgs"
Write-LaunchLog "cwd=$escapedResourcesDir"
try {
  `$proc = Start-Process -FilePath '$escapedAppExe' -ArgumentList '$escapedAppArgs' -WorkingDirectory '$escapedResourcesDir' -PassThru
  Write-LaunchLog "started pid=`$(`$proc.Id)"
} catch {
  Write-LaunchLog "start error=`$(`$_.Exception.Message)"
  exit 1
}
"@
    Set-Content -LiteralPath $launcherPath -Value $launcherBody -Encoding UTF8
    if (Test-Path $launcherLog) {
        Remove-Item -LiteralPath $launcherLog -Force -ErrorAction SilentlyContinue
    }
    "LAUNCHER_SCRIPT: $launcherPath"
    "LAUNCHER_LOG: $launcherLog"
    $args = "-NoProfile -ExecutionPolicy Bypass -File `"$launcherPath`""
    $action = New-ScheduledTaskAction -Execute $psExe -Argument $args
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 3)
    $task = New-ScheduledTask -Action $action -Principal $principal -Settings $settings

    Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force | Out-Null
    $runOutput = & schtasks.exe "/Run" "/TN" $TaskName 2>&1
    "SCHTASKS_RUN_EXIT: $LASTEXITCODE"
    if ($runOutput) {
        $runOutput | ForEach-Object { "SCHTASKS_RUN_OUTPUT: $_" }
    }
    if ($LASTEXITCODE -ne 0) {
        Start-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        "STATE: TASK_STARTED_FALLBACK_START_SCHEDULED_TASK"
    } else {
        "STATE: TASK_STARTED"
    }
}

$deadline = (Get-Date).AddSeconds($WaitSeconds)
while ((Get-Date) -lt $deadline) {
    $gateway = Test-Port 18789
    $hostApi = Test-Port 13210
    $electronCdp = Test-CDPHttp $ElectronDebugPort
    if ($gateway -and $hostApi -and $electronCdp) {
        $debugLines = @(Get-AppDebugCommandLines $appExe | Where-Object { $_.CommandLine -match "--remote-debugging-port=$ElectronDebugPort" })
        if ($debugLines.Count -eq 0) {
            "STATE: APP_RELAUNCHED_CDP_UP_BUT_FLAG_NOT_FOUND"
            Get-AppDebugCommandLines $appExe | ForEach-Object { "APP_CMD[$($_.ProcessId)]: $($_.CommandLine)" }
            if ($usedKeepaliveLaunch) {
                Restore-KeepaliveTask $KeepaliveTaskName $keepaliveWasEnabled
            }
            exit 41
        }
        if ($usedKeepaliveLaunch) {
            Restore-KeepaliveTask $KeepaliveTaskName $keepaliveWasEnabled
        } elseif ($keepaliveTask) {
            Restore-KeepaliveTask $KeepaliveTaskName $keepaliveWasEnabled
        }
        "STATE: APP_V2_RELAUNCHED"
        exit 0
    }
    Start-Sleep -Milliseconds 750
}

$info = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue
if ($info) {
    "TASK_LAST_RUN: $($info.LastRunTime)"
    "TASK_LAST_RESULT: $($info.LastTaskResult)"
}
$launcherLog = Join-Path $env:PUBLIC "Downloads\clawx-app-debug-launcher.log"
if (Test-Path $launcherLog) {
    "=== LAUNCHER LOG ==="
    Get-Content -LiteralPath $launcherLog -Tail 80 -ErrorAction SilentlyContinue
}
Get-AppDebugCommandLines $appExe | ForEach-Object { "APP_CMD[$($_.ProcessId)]: $($_.CommandLine)" }
if ($usedKeepaliveLaunch) {
    Restore-KeepaliveTask $KeepaliveTaskName $keepaliveWasEnabled
} elseif ($keepaliveTask -and $keepaliveWasEnabled) {
    Restore-KeepaliveTask $KeepaliveTaskName $keepaliveWasEnabled
}
"STATE: APP_RELAUNCH_TIMEOUT"
exit 40
