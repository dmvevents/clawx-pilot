# Run the Electron CDP probe against the installed Windows app.
#
# Read-only against user data except screenshots/JSON artifacts in Downloads.
# Safe app calls only: outlook.open, forms.list, optional safe chat prompt that
# instructs the model not to send, draft, reply, forward, read inbox, or submit.

param(
    [string]$Endpoint = "http://127.0.0.1:9223",
    [switch]$SafeChat,
    [ValidateSet("outlook-open", "forms-list")]
    [string]$SafeChatMode = "outlook-open",
    [switch]$OutlookSmoke,
    [switch]$FormsSmoke,
    [int]$WaitMs = 5000,
    [string]$ArtifactDir = "$env:USERPROFILE\Downloads"
)

$ErrorActionPreference = "Stop"

function Find-Node {
    $candidates = @(
        "$env:LOCALAPPDATA\Programs\Ministry of Education\resources\bin\node.exe",
        "$env:LOCALAPPDATA\Programs\Ministry of Education\resources\bin\win32-x64\node.exe",
        "$env:LOCALAPPDATA\Programs\Ministry of Education\resources\openclaw\node.exe",
        "node.exe"
    )
    foreach ($candidate in $candidates) {
        $cmd = Get-Command $candidate -ErrorAction SilentlyContinue
        if ($cmd) { return $cmd.Source }
        if (Test-Path $candidate) { return $candidate }
    }
    return $null
}

function Test-Endpoint {
    param([string]$Url)
    try {
        $version = Invoke-WebRequest -Uri "$Url/json/version" -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
        return ($version.StatusCode -eq 200)
    } catch {
        return $false
    }
}

$scriptPath = Join-Path $PSScriptRoot "pilot-electron-cdp-probe.js"
if (-not (Test-Path $scriptPath)) {
    $scriptPath = Join-Path $env:USERPROFILE "pilot-electron-cdp-probe.js"
}
if (-not (Test-Path $scriptPath)) {
    "STATE: PROBE_SCRIPT_NOT_FOUND"
    "Missing pilot-electron-cdp-probe.js next to this script or in USERPROFILE"
    exit 2
}

$node = Find-Node
if (-not $node) {
    "STATE: NODE_NOT_FOUND"
    exit 3
}

if (-not (Test-Endpoint -Url $Endpoint)) {
    "STATE: ELECTRON_CDP_DOWN"
    "Endpoint: $Endpoint"
    "Relaunch the app with --remote-debugging-port=9223 before running this probe."
    exit 4
}

"=== Electron CDP probe ==="
"Endpoint:    $Endpoint"
"Node:        $node"
"Script:      $scriptPath"
"ArtifactDir: $ArtifactDir"
"SafeChat:    $($SafeChat.IsPresent)"
"SafeChatMode:$SafeChatMode"
"OutlookSmoke:$($OutlookSmoke.IsPresent)"
"FormsSmoke:  $($FormsSmoke.IsPresent)"

$argsList = @(
    $scriptPath,
    "--endpoint", $Endpoint,
    "--artifact-dir", $ArtifactDir,
    "--wait-ms", "$WaitMs"
)
if ($SafeChat) {
    $argsList += "--safe-chat"
    $argsList += "--safe-chat-mode"
    $argsList += $SafeChatMode
}
if ($OutlookSmoke) {
    $argsList += "--outlook-smoke"
}
if ($FormsSmoke) {
    $argsList += "--forms-smoke"
}

& $node @argsList
exit $LASTEXITCODE
