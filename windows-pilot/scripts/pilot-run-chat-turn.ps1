# pilot-run-chat-turn.ps1 - launch the installed app with an Electron CDP port
# (if not already up) and drive one chat turn via pilot-chat-turn-driver.js.
#
# Read-only: NO - launches the app and sends one chat prompt.
# Launch method: Invoke-CimMethod Win32_Process Create, so the app is parented
# to WMI and survives SSH session teardown (see WINDOWS_PROBLEMS_ATLAS - a
# ShellExecute child dies with the SSH session; -WindowStyle Hidden kills the
# Gateway). Never launch hidden.

param(
    [Parameter(Mandatory = $true)][string]$Prompt,
    [int]$CdpPort = 9223,
    [int]$StartupTimeoutSeconds = 120,
    [int]$TurnTimeoutSeconds = 180,
    [ValidateSet("online", "on-device", "")][string]$ExpectedChannel = "",
    [int]$TerminalQuietSeconds = 30,
    [string]$OutDir = "$env:USERPROFILE\Downloads\clawx-chat-turn-evidence",
    # Start the turn in a FRESH chat session. Mandatory in practice for any
    # document/tool leg: a session holding a previous failure makes the model
    # echo its own refusal without calling the tool.
    [switch]$NewSession,
    # Refuse to relaunch the app. The WMI relaunch below lands the app in the
    # CALLER's session, so an SSH-driven relaunch takes it off the interactive
    # desktop and breaks real-desktop screenshot grading. Use this when the app
    # must stay in the interactive session (relaunch it there via a
    # `schtasks /it` task carrying --remote-debugging-port instead).
    [switch]$NoRelaunch
)

$ErrorActionPreference = "Stop"

function Test-HttpOk([string]$Url) {
    try {
        $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
        return ($r.StatusCode -eq 200)
    } catch { return $false }
}
function Test-Port([int]$Port) {
    return [bool](Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
}

$appExe = Join-Path $env:LOCALAPPDATA "Programs\Ministry of Education\Ministry of Education.exe"
if (-not (Test-Path $appExe)) {
    "STATE: APP_NOT_FOUND $appExe"
    exit 30
}

$cdpUp = Test-HttpOk "http://127.0.0.1:$CdpPort/json/version"
if ((-not $cdpUp) -and $NoRelaunch) {
    "STATE: CDP_DOWN_NO_RELAUNCH port=$CdpPort"
    exit 33
}
if (-not $cdpUp) {
    # A running app without the CDP flag cannot be attached to; restart it.
    $existing = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq "Ministry of Education.exe" }
    foreach ($proc in $existing) {
        Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 3
    $cmd = ('"{0}" --remote-debugging-port={1} --enable-logging' -f $appExe, $CdpPort)
    $launch = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $cmd }
    "STATE: LAUNCH_RETURN $($launch.ReturnValue) PID $($launch.ProcessId)"
    if ($launch.ReturnValue -ne 0) { exit 31 }
}

$deadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
do {
    Start-Sleep -Seconds 2
    $cdpUp = Test-HttpOk "http://127.0.0.1:$CdpPort/json/version"
    $gatewayUp = Test-Port 18789
} while ((-not ($cdpUp -and $gatewayUp)) -and ((Get-Date) -lt $deadline))
"STATE: CDP_READY $cdpUp"
"STATE: GATEWAY_READY $gatewayUp"
"STATE: HOSTAPI_READY $(Test-Port 13210)"
if (-not $cdpUp) { exit 32 }

$node = @(
    (Join-Path $env:LOCALAPPDATA "Programs\Ministry of Education\resources\bin\win32-x64\node.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\Ministry of Education\resources\bin\node.exe"),
    "node.exe"
) | Where-Object { ($_ -eq "node.exe") -or (Test-Path $_) } | Select-Object -First 1
"STATE: NODE $node"

$driver = Join-Path $PSScriptRoot "pilot-chat-turn-driver.js"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$driverArgs = @(
    '--prompt', $Prompt,
    '--port', $CdpPort,
    '--turn-timeout', $TurnTimeoutSeconds,
    '--terminal-quiet', $TerminalQuietSeconds,
    '--outdir', $OutDir
)
if ($ExpectedChannel) { $driverArgs += @('--expected-channel', $ExpectedChannel) }
if ($NewSession) { $driverArgs += '--new-session' }
& $node $driver @driverArgs
exit $LASTEXITCODE
