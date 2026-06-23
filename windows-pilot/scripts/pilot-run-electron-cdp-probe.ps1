# Run the Electron CDP probe against the installed Windows app.
#
# Read-only against user data except screenshots/JSON artifacts in Downloads.
# Safe app calls only: outlook.open, forms.list, optional safe chat prompt that
# instructs the model not to send, draft, reply, forward, read inbox, or submit.
# Explicit -SendEmail and -SubmitForms flags perform real side effects.
# -DraftEmail drafts only and leaves the compose pane open for inspection.
# -OutlookReplyMatrix drafts reply/reply-all/forward only and never sends.

param(
    [string]$Endpoint = "http://127.0.0.1:9223",
    [switch]$SafeChat,
    [ValidateSet("outlook-open", "forms-list", "custom")]
    [string]$SafeChatMode = "outlook-open",
    [string]$SafeChatPrompt,
    [switch]$OutlookSmoke,
    [switch]$OutlookStateMatrix,
    [switch]$OutlookReplyMatrix,
    [string]$ChromeEndpoint = "http://127.0.0.1:18792",
    [switch]$FormsSmoke,
    [switch]$DraftEmail,
    [switch]$SendEmail,
    [string]$EmailTo,
    [string]$EmailSubject,
    [string]$EmailBody,
    [switch]$SubmitForms,
    [switch]$VisualAcceptance,
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
"SafeChatCustom:$([bool]$SafeChatPrompt)"
"OutlookSmoke:$($OutlookSmoke.IsPresent)"
"OutlookStateMatrix:$($OutlookStateMatrix.IsPresent)"
"OutlookReplyMatrix:$($OutlookReplyMatrix.IsPresent)"
"ChromeEndpoint:$ChromeEndpoint"
"FormsSmoke:  $($FormsSmoke.IsPresent)"
"DraftEmail:  $($DraftEmail.IsPresent)"
"SendEmail:   $($SendEmail.IsPresent)"
"SubmitForms: $($SubmitForms.IsPresent)"
"VisualAcceptance:$($VisualAcceptance.IsPresent)"

$argsList = @(
    $scriptPath,
    "--endpoint", $Endpoint,
    "--chrome-endpoint", $ChromeEndpoint,
    "--artifact-dir", $ArtifactDir,
    "--wait-ms", "$WaitMs"
)
if ($SafeChat) {
    $argsList += "--safe-chat"
    $argsList += "--safe-chat-mode"
    $argsList += $SafeChatMode
}
if ($SafeChatPrompt) {
    $argsList += "--safe-chat-prompt"
    $argsList += $SafeChatPrompt
}
if ($OutlookSmoke) {
    $argsList += "--outlook-smoke"
}
if ($OutlookStateMatrix) {
    $argsList += "--outlook-state-matrix"
}
if ($OutlookReplyMatrix) {
    $argsList += "--outlook-reply-matrix"
}
if ($FormsSmoke) {
    $argsList += "--forms-smoke"
}
if ($DraftEmail) {
    if (-not $EmailTo) {
        "STATE: EMAIL_TO_REQUIRED"
        exit 5
    }
    $argsList += "--draft-email"
    $argsList += "--email-to"
    $argsList += $EmailTo
    if ($EmailSubject) {
        $argsList += "--email-subject"
        $argsList += $EmailSubject
    }
    if ($EmailBody) {
        $argsList += "--email-body"
        $argsList += $EmailBody
    }
}
if ($SendEmail) {
    if (-not $EmailTo) {
        "STATE: EMAIL_TO_REQUIRED"
        exit 5
    }
    $argsList += "--send-email"
    $argsList += "--email-to"
    $argsList += $EmailTo
    if ($EmailSubject) {
        $argsList += "--email-subject"
        $argsList += $EmailSubject
    }
    if ($EmailBody) {
        $argsList += "--email-body"
        $argsList += $EmailBody
    }
}
if ($SubmitForms) {
    $argsList += "--submit-forms"
}
if ($VisualAcceptance) {
    $argsList += "--visual-acceptance"
}

& $node @argsList
exit $LASTEXITCODE
