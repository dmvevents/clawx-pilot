# pilot-attach-chrome-cdp.ps1 - ensure Chrome is on --remote-debugging-port=18792
# with the principal's user profile (NOT managed Chromium).
#
# Read-only: NO - may launch a Chrome process. Will NEVER kill an existing
# Chrome unless -AllowKill is passed AND the human explicitly approves.
# Idempotent: yes - running twice = the second is a no-op when CDP is already up.
#
# Hard rules honored:
#   - Always uses C:\Program Files\Google\Chrome\Application\chrome.exe (system Chrome).
#   - Never uses Playwright bundled Chromium (Conditional Access blocks it).
#   - Always points at the user's existing profile dir.
#   - Refuses to force-kill a running Chrome unless -AllowKill is passed.
#
# Exit codes:
#   0   success - CDP is up on 18792
#   10  CDP already up (no-op)
#   20  profile-locked (existing Chrome holds the user-data-dir)
#   30  Chrome executable not found
#   40  port bind timed out

param(
    [switch]$AllowKill = $false,
    [int]$WaitSeconds = 12
)

$ErrorActionPreference = "Stop"

function Test-CDP {
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:18792/json/version" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        return ($r.StatusCode -eq 200)
    } catch { return $false }
}

# === Phase 1: probe ===
"=== CDP probe ==="
if (Test-CDP) {
    "STATE: CDP_ALREADY_UP"
    exit 0
}
"CDP not up; will launch Chrome with --remote-debugging-port=18792"

# === Phase 2: locate Chrome ===
$chromePaths = @(
    "C:\Program Files\Google\Chrome\Application\chrome.exe",
    "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$chromeExe = $null
foreach ($p in $chromePaths) { if (Test-Path $p) { $chromeExe = $p; break } }
if (-not $chromeExe) {
    "STATE: CHROME_NOT_FOUND"
    "Tried: $($chromePaths -join ', ')"
    exit 30
}
"Chrome exe: $chromeExe"

$userDataDir = "$env:LOCALAPPDATA\Google\Chrome\User Data"
"User-data-dir: $userDataDir"

# === Phase 3: existing Chrome inventory ===
$existing = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" -ErrorAction SilentlyContinue
$existingCount = ($existing | Measure-Object).Count
"Existing chrome procs: $existingCount"

# Look for whether ANY existing proc is using the same user-data-dir.
# Chrome's main proc has --user-data-dir in its cmdline, OR no flag (defaults to that dir).
$mainProcs = $existing | Where-Object {
    $_.CommandLine -and (
        $_.CommandLine -match [regex]::Escape($userDataDir) -or
        ($_.CommandLine -notmatch "user-data-dir" -and $_.CommandLine -notmatch "--type=")
    )
}
$mainCount = ($mainProcs | Measure-Object).Count
"Procs using target profile dir: $mainCount"

if ($mainCount -gt 0 -and -not $AllowKill) {
    "STATE: PROFILE_LOCKED"
    "Existing Chrome instance has the user-data-dir locked."
    "Chromium will refuse a second instance against the same profile."
    "Options:"
    "  1. Ask the human to close Chrome cleanly (preserves session), then re-run this script."
    "  2. Re-run with -AllowKill switch to force-close all Chrome procs (LOSES UNSAVED WORK)."
    exit 20
}

if ($mainCount -gt 0 -and $AllowKill) {
    "Killing $mainCount existing Chrome procs (AllowKill=true) ..."
    $existing | ForEach-Object {
        try {
            Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        } catch { }
    }
    Start-Sleep -Seconds 2
}

# === Phase 4: launch ===
$args = @(
    "--remote-debugging-port=18792",
    "--user-data-dir=`"$userDataDir`"",
    "--no-first-run",
    "--no-default-browser-check",
    "--restore-last-session"
)
"Launch args: $($args -join ' ')"

try {
    Start-Process -FilePath $chromeExe -ArgumentList $args -WindowStyle Normal
} catch {
    "STATE: CHROME_LAUNCH_FAIL"
    "ERROR: $($_.Exception.Message)"
    exit 1
}

# === Phase 5: wait for port bind ===
"Waiting up to $WaitSeconds s for port 18792 to bind ..."
$deadline = (Get-Date).AddSeconds($WaitSeconds)
$bound = $false
while ((Get-Date) -lt $deadline) {
    if (Test-CDP) { $bound = $true; break }
    Start-Sleep -Milliseconds 500
}

if ($bound) {
    "STATE: CDP_UP"
    # Verify with a quick tab list
    try {
        $tabs = (Invoke-WebRequest -Uri "http://127.0.0.1:18792/json" -UseBasicParsing -TimeoutSec 3).Content | ConvertFrom-Json
        "TAB_COUNT: $(($tabs | Where-Object { $_.type -eq 'page' }).Count)"
    } catch { }
    exit 0
} else {
    "STATE: PORT_BIND_TIMEOUT"
    "Chrome was launched but port 18792 did not bind within $WaitSeconds s."
    "Possible causes: profile lock, antivirus, missing executable permissions."
    exit 40
}
