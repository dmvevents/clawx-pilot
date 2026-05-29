# pilot-attach-chrome-cdp-demo.ps1 - launch a SECOND Chrome instance with its own
# user-data-dir for the demo, on port 18792. Lossless against the principal's
# existing Chrome session.
#
# Read-only: NO - launches Chrome.
# Idempotent: yes - if CDP already up, no-op.
# Best launched from the Windows desktop shortcut. SSH-launched Chrome can bind
# 18792 briefly and then exit when the remote process context closes.
#
# Hard rules honored:
#   - Uses system Chrome (NOT bundled Chromium / not managed).
#   - Separate profile dir = no conflict with the user's regular Chrome.
#   - The principal must sign into test.fac in this new window before automation works.
#
# Exit codes:
#   0   CDP up (fresh launch OR was already up)
#   30  Chrome executable not found
#   40  port bind timed out

param(
    [int]$WaitSeconds = 15,
    [string]$DemoDir = "$env:LOCALAPPDATA\Google\Chrome\ClawX CDP Demo Profile"
)

$ErrorActionPreference = "Stop"

function Test-CDP {
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:18792/json/version" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        return ($r.StatusCode -eq 200)
    } catch { return $false }
}

function Redact-Text([string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value)) { return $Value }
    $redacted = $Value -replace '#token=[^&\s"]+', '#token=<redacted>'
    $redacted = $redacted -replace '([?&]token=)[^&\s"]+', '$1<redacted>'
    $redacted = $redacted -replace 'https://forms\.office\.com/Pages/ResponsePage\.aspx\?id=[^&\s"]+', 'https://forms.office.com/Pages/ResponsePage.aspx?id=<redacted>'
    return $redacted
}

function Truncate-Text([string]$Value, [int]$MaxLength) {
    if ([string]::IsNullOrEmpty($Value) -or $Value.Length -le $MaxLength) { return $Value }
    return $Value.Substring(0, $MaxLength) + "..."
}

"=== CDP probe ==="
if (Test-CDP) {
    "STATE: CDP_ALREADY_UP"
    exit 0
}
"CDP down; will launch a fresh Chrome with demo profile dir."

# Locate Chrome
$chromePaths = @(
    "C:\Program Files\Google\Chrome\Application\chrome.exe",
    "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$chromeExe = $null
foreach ($p in $chromePaths) { if (Test-Path $p) { $chromeExe = $p; break } }
if (-not $chromeExe) {
    "STATE: CHROME_NOT_FOUND"
    exit 30
}
"Chrome exe:    $chromeExe"
"Demo data dir: $DemoDir"

# Ensure dir exists
if (-not (Test-Path $DemoDir)) {
    New-Item -ItemType Directory -Path $DemoDir -Force | Out-Null
    "Created demo dir."
} else {
    "Demo dir already exists (re-using)."
}

# Launch flags - opens to outlook.office.com so principal signs in once
$launchUrl = "https://outlook.office.com/mail/inbox"
$args = @(
    "--remote-debugging-port=18792",
    "--user-data-dir=`"$DemoDir`"",
    "--no-first-run",
    "--no-default-browser-check",
    "--no-pings",
    $launchUrl
)
"Launch args: $($args -join ' ')"

try {
    $proc = Start-Process -FilePath $chromeExe -ArgumentList $args -WindowStyle Normal -PassThru
    "Chrome PID: $($proc.Id)"
} catch {
    "STATE: CHROME_LAUNCH_FAIL"
    "ERROR: $($_.Exception.Message)"
    exit 1
}

# Wait for port bind
"Waiting up to $WaitSeconds s for port 18792 to bind ..."
$deadline = (Get-Date).AddSeconds($WaitSeconds)
$bound = $false
while ((Get-Date) -lt $deadline) {
    if (Test-CDP) { $bound = $true; break }
    Start-Sleep -Milliseconds 500
}

if ($bound) {
    "STATE: CDP_UP"
    Start-Sleep -Seconds 2
    try {
        $tabs = (Invoke-WebRequest -Uri "http://127.0.0.1:18792/json" -UseBasicParsing -TimeoutSec 3).Content | ConvertFrom-Json
        $pages = $tabs | Where-Object { $_.type -eq "page" }
        "TAB_COUNT: $($pages.Count)"
        $pages | Select-Object @{N='URL';E={Truncate-Text (Redact-Text $_.url) 120}}, @{N='Title';E={Truncate-Text $_.title 60}} | Format-Table -Wrap | Out-String
    } catch { }
    "NEXT_STEP: human signs into Outlook in the new Chrome window as test.fac@fac.edu.tt"
    exit 0
} else {
    "STATE: PORT_BIND_TIMEOUT"
    exit 40
}
