# pilot-relaunch-app-outlook-v2.ps1 - restart the installed Ministry app with
# CLAWX_OUTLOOK_V2=1 and Electron remote debugging so Outlook tools use the
# Playwright/CDP manager and SSH probes can attach to the installed app.
#
# Read-only: NO - closes/restarts the app. Does not delete data and does not
# touch Chrome/CDP.
# Safety: attempts graceful CloseMainWindow first, then terminates leftover app
# helper processes only so the relaunch has a clean environment.

param(
    [int]$WaitSeconds = 45,
    [string]$TaskName = "ClawX Launch App Outlook V2",
    [int]$ElectronDebugPort = 9223,
    [string]$KeepaliveTaskName = "ClawX App Keepalive"
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
        "KEEPALIVE_SCRIPT: missing"
        return
    }

    $content = Get-Content -LiteralPath $keepalivePath -Raw
    if ($content -notmatch "--remote-debugging-port=18792") {
        "KEEPALIVE_SCRIPT: no 18792 app debug flag found"
        return
    }

    $backup = "$keepalivePath.bak-$(Get-Date -Format yyyyMMdd-HHmmss)"
    Copy-Item -LiteralPath $keepalivePath -Destination $backup -Force
    $content.Replace("--remote-debugging-port=18792", "--remote-debugging-port=$port") |
        Set-Content -LiteralPath $keepalivePath -Encoding UTF8
    "KEEPALIVE_SCRIPT: patched app debug port to $port"
    "KEEPALIVE_SCRIPT_BACKUP: $backup"
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
    Repair-KeepaliveDebugPort $ElectronDebugPort
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
if ($keepaliveTask) {
    Enable-ScheduledTask -TaskName $KeepaliveTaskName | Out-Null
    Start-ScheduledTask -TaskName $KeepaliveTaskName
    $usedKeepaliveLaunch = $true
    "STATE: KEEPALIVE_TASK_STARTED"
} else {
    $psExe = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
    $launch = "`$env:CLAWX_OUTLOOK_V2='1'; [Environment]::SetEnvironmentVariable('CLAWX_OUTLOOK_V2','1','User'); Start-Process -FilePath '$appExe' -ArgumentList '$appArgs' -WorkingDirectory '$resourcesDir'"
    $args = "-NoProfile -ExecutionPolicy Bypass -Command `"$launch`""
    $action = New-ScheduledTaskAction -Execute $psExe -Argument $args
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 3)
    $task = New-ScheduledTask -Action $action -Principal $principal -Settings $settings

    Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force | Out-Null
    Start-ScheduledTask -TaskName $TaskName
    "STATE: TASK_STARTED"
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
Get-AppDebugCommandLines $appExe | ForEach-Object { "APP_CMD[$($_.ProcessId)]: $($_.CommandLine)" }
if ($usedKeepaliveLaunch) {
    Restore-KeepaliveTask $KeepaliveTaskName $keepaliveWasEnabled
} elseif ($keepaliveTask -and $keepaliveWasEnabled) {
    Restore-KeepaliveTask $KeepaliveTaskName $keepaliveWasEnabled
}
"STATE: APP_RELAUNCH_TIMEOUT"
exit 40
