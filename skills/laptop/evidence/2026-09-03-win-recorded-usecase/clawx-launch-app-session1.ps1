# clawx-launch-app-session1.ps1
# Launch the installed Ministry of Education app INTO the interactive console
# session (session 1) via a scheduled task with an interactive token (/IT), so
# its window renders on the real desktop and can be screen-recorded.
# NEVER -WindowStyle Hidden (IF-4 kills the Gateway). A visible interactive
# task is the opposite of hidden.
param(
    [int]$CdpPort = 9223,
    [int]$StartupTimeoutSeconds = 150
)
$ErrorActionPreference = "Stop"

$appExe = Join-Path $env:LOCALAPPDATA "Programs\Ministry of Education\Ministry of Education.exe"
if (-not (Test-Path $appExe)) { Write-Output "STATE: APP_NOT_FOUND"; exit 30 }

# Stop any prior instance so the CDP flag takes effect.
Get-CimInstance Win32_Process | Where-Object { $_.Name -eq "Ministry of Education.exe" } | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 3

# Register an interactive scheduled task so the app runs in the logged-on
# user's console session (session 1) with a visible window. LogonType
# Interactive uses the logged-on token (no stored password). Register-* handles
# exe+arg quoting cleanly, unlike schtasks /TR with embedded quotes.
$taskName = "ClawXApp"
$argStr = "--remote-debugging-port=$CdpPort --enable-logging"
$action = New-ScheduledTaskAction -Execute $appExe -Argument $argStr
$principal = New-ScheduledTaskPrincipal -UserId "clawxtest" -LogonType Interactive -RunLevel Highest
Register-ScheduledTask -TaskName $taskName -Action $action -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Output "STATE: TASK_LAUNCHED $taskName"

function Test-HttpOk([string]$Url) {
    try { $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop; return ($r.StatusCode -eq 200) } catch { return $false }
}
function Test-Port([int]$Port) { return [bool](Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) }

$deadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
$cdpUp = $false; $gwUp = $false
do {
    Start-Sleep -Seconds 3
    $cdpUp = Test-HttpOk "http://127.0.0.1:$CdpPort/json/version"
    $gwUp  = Test-Port 18789
} while ((-not ($cdpUp -and $gwUp)) -and ((Get-Date) -lt $deadline))

Write-Output "STATE: CDP_READY $cdpUp"
Write-Output "STATE: GATEWAY_READY $gwUp"
Write-Output "STATE: HOSTAPI_READY $(Test-Port 13210)"
$pids = (Get-CimInstance Win32_Process | Where-Object { $_.Name -eq "Ministry of Education.exe" } | Measure-Object).Count
Write-Output "STATE: APP_PROC_COUNT $pids"
if (-not $cdpUp) { exit 32 }
Write-Output "STATE: LAUNCH_OK"
