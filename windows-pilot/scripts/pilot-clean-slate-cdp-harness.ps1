# pilot-clean-slate-cdp-harness.ps1
#
# Non-destructive Chrome CDP clean-slate harness. Uses a temporary Chrome
# profile and an alternate debug port by default so we can reproduce a new-user
# browser automation setup without uninstalling ClawX or touching the
# principal's real Chrome profile.
#
# Scenarios:
#   ready        Launch temp-profile Chrome with CDP and verify /json/version.
#   profileLock  Launch temp-profile Chrome without CDP to simulate "Chrome is
#                open but the profile is locked"; useful for manual app tests.

param(
    [ValidateSet("ready", "profileLock")]
    [string]$Scenario = "ready",
    [int]$Port = 18793,
    [switch]$LeaveOpen = $false
)

$ErrorActionPreference = "Stop"

function Find-Chrome {
    $paths = @(
        "C:\Program Files\Google\Chrome\Application\chrome.exe",
        "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
    )
    foreach ($p in $paths) {
        if (Test-Path $p) { return $p }
    }
    throw "Chrome executable not found. Tried: $($paths -join ', ')"
}

function Test-Cdp([int]$CdpPort) {
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:$CdpPort/json/version" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        return $response.StatusCode -eq 200
    } catch {
        return $false
    }
}

function Wait-Cdp([int]$CdpPort, [int]$Seconds = 12) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-Cdp $CdpPort) { return $true }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

$chrome = Find-Chrome
$profileDir = Join-Path $env:TEMP ("clawx-cdp-clean-slate-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $profileDir | Out-Null
$proc = $null

"CHROME_EXE: $chrome"
"TEMP_PROFILE: $profileDir"
"PORT: $Port"
"SCENARIO: $Scenario"
"APP_ENV:"
"  CLAWX_CHROME_EXECUTABLE=$chrome"
"  CLAWX_CHROME_USER_DATA_DIR=$profileDir"
"  CLAWX_CHROME_DEBUG_PORT=$Port"
"  CLAWX_CHROME_CDP_ENDPOINT=http://127.0.0.1:$Port"

try {
    if ($Scenario -eq "ready") {
        $args = @(
            "--remote-debugging-port=$Port",
            "--user-data-dir=`"$profileDir`"",
            "--no-first-run",
            "--no-default-browser-check"
        )
        $proc = Start-Process -FilePath $chrome -ArgumentList $args -WindowStyle Normal -PassThru
        if (Wait-Cdp $Port) {
            "STATE: CLEAN_SLATE_CDP_READY"
            $version = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/json/version" -UseBasicParsing -TimeoutSec 2
            ($version.Content | ConvertFrom-Json) | Select-Object Browser, "Protocol-Version", "User-Agent" | Format-List | Out-String
        } else {
            "STATE: CLEAN_SLATE_CDP_TIMEOUT"
            exit 40
        }
    } else {
        $args = @(
            "--user-data-dir=`"$profileDir`"",
            "--no-first-run",
            "--no-default-browser-check"
        )
        $proc = Start-Process -FilePath $chrome -ArgumentList $args -WindowStyle Normal -PassThru
        Start-Sleep -Seconds 3
        if (Test-Cdp $Port) {
            "STATE: UNEXPECTED_CDP_UP"
            exit 41
        }
        "STATE: PROFILE_LOCK_SIMULATED"
        "Run ClawX with the APP_ENV values above and call browser.diagnose; expected app state: profile_locked_close_chrome."
    }
} finally {
    if (-not $LeaveOpen) {
        if ($proc -and -not $proc.HasExited) {
            Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        }
        Start-Sleep -Milliseconds 500
        Remove-Item -LiteralPath $profileDir -Recurse -Force -ErrorAction SilentlyContinue
    } else {
        "LEFT_OPEN: true"
        "Close Chrome PID $($proc.Id) and delete $profileDir when finished."
    }
}
