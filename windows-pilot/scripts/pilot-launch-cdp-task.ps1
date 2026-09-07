# pilot-launch-cdp-task.ps1 - launch demo CDP Chrome through Task Scheduler so
# it runs in the logged-in Windows desktop session instead of the SSH session.
#
# Read-only: NO - registers/runs a per-user scheduled task and launches Chrome.
# Idempotent: yes - if CDP is already up, exits without relaunching.
# Safety: uses a separate demo Chrome user-data-dir; never kills normal Chrome.

param(
    [int]$WaitSeconds = 20,
    [string]$TaskName = "ClawX Demo CDP Chrome",
    [string]$DemoDir = "$env:LOCALAPPDATA\Google\Chrome\ClawX CDP Demo Profile"
)

$ErrorActionPreference = "Stop"

function Test-CDP {
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:18792/json/version" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        return ($r.StatusCode -eq 200)
    } catch { return $false }
}

function Find-Chrome {
    $chromePaths = @(
        "C:\Program Files\Google\Chrome\Application\chrome.exe",
        "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
    )
    foreach ($p in $chromePaths) {
        if (Test-Path $p) { return $p }
    }
    return $null
}

"=== CDP scheduled-task launch ==="
if (Test-CDP) {
    "STATE: CDP_ALREADY_UP"
    exit 0
}

$chromeExe = Find-Chrome
if (-not $chromeExe) {
    "STATE: CHROME_NOT_FOUND"
    exit 30
}

if (-not (Test-Path $DemoDir)) {
    New-Item -ItemType Directory -Path $DemoDir -Force | Out-Null
}

$launcher = Join-Path $env:USERPROFILE "pilot-attach-chrome-cdp-demo.ps1"
if (-not (Test-Path $launcher)) {
    "STATE: LAUNCHER_NOT_FOUND"
    "Missing: $launcher"
    exit 31
}

$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$psExe = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$args = "-NoProfile -ExecutionPolicy Bypass -File `"$launcher`" -WaitSeconds $WaitSeconds -DemoDir `"$DemoDir`""

"Task:       $TaskName"
"User:       $user"
"Chrome exe: $chromeExe"
"Demo dir:   $DemoDir"

$action = New-ScheduledTaskAction -Execute $psExe -Argument $args
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
$task = New-ScheduledTask -Action $action -Principal $principal -Settings $settings

Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

"STATE: TASK_STARTED"
"Waiting up to $WaitSeconds s for port 18792 to bind ..."
$deadline = (Get-Date).AddSeconds($WaitSeconds)
while ((Get-Date) -lt $deadline) {
    if (Test-CDP) {
        "STATE: CDP_UP"
        exit 0
    }
    Start-Sleep -Milliseconds 500
}

$info = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue
if ($info) {
    "TASK_LAST_RUN: $($info.LastRunTime)"
    "TASK_LAST_RESULT: $($info.LastTaskResult)"
}
"STATE: CDP_STILL_DOWN"
exit 40
