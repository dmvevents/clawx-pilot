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
    [int]$ElectronDebugPort = 9223
)

$ErrorActionPreference = "Stop"

function Test-Port($port) {
    try {
        $conn = Get-NetTCPConnection -State Listen -LocalAddress 127.0.0.1 -LocalPort $port -ErrorAction Stop
        return $null -ne $conn
    } catch { return $false }
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
$psExe = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$appArgs = "--remote-debugging-port=$ElectronDebugPort"
$launch = "`$env:CLAWX_OUTLOOK_V2='1'; [Environment]::SetEnvironmentVariable('CLAWX_OUTLOOK_V2','1','User'); Start-Process -FilePath '$appExe' -ArgumentList '$appArgs' -WorkingDirectory '$resourcesDir'"
$args = "-NoProfile -ExecutionPolicy Bypass -Command `"$launch`""

$action = New-ScheduledTaskAction -Execute $psExe -Argument $args
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 3)
$task = New-ScheduledTask -Action $action -Principal $principal -Settings $settings

Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName
"STATE: TASK_STARTED"

$deadline = (Get-Date).AddSeconds($WaitSeconds)
while ((Get-Date) -lt $deadline) {
    $gateway = Test-Port 18789
    $hostApi = Test-Port 13210
    $electronCdp = Test-Port $ElectronDebugPort
    if ($gateway -and $hostApi -and $electronCdp) {
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
"STATE: APP_RELAUNCH_TIMEOUT"
exit 40
