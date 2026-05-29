# pilot-launch-form.ps1 - open the test.fac Suspensions form in the CDP-attached Chrome.
# Read-only: no (mutates Chrome tab state - opens a new tab)
# Idempotent: yes (always opens a fresh tab; multiple runs = multiple tabs, but harmless)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$formUrlPath = Join-Path $repoRoot "extensions\moe-principal-assistant\forms\suspensions-test-fac-url.txt"
$formUrl = $env:CLAWX_SUSPENSIONS_FORM_URL
if ([string]::IsNullOrWhiteSpace($formUrl)) {
    if (-not (Test-Path $formUrlPath)) {
        "ABORT: configured form URL file is missing."
        exit 1
    }
    $formUrl = (Get-Content -Raw -Path $formUrlPath).Trim()
}

if ($formUrl -notmatch "^https://forms\.office\.com/") {
    "ABORT: configured form URL is not a Microsoft Forms response URL."
    exit 1
}

"=== Verifying CDP up ==="
try {
    $null = Invoke-WebRequest -Uri "http://127.0.0.1:18792/json/version" -UseBasicParsing -TimeoutSec 3
    "CDP_UP: yes"
} catch {
    "CDP_UP: no"
    "ABORT: cannot open form tab without CDP. Run pilot-attach-chrome-cdp.ps1 first."
    exit 1
}

"`n=== Opening form tab via CDP ==="
try {
    $resp = Invoke-WebRequest -Uri "http://127.0.0.1:18792/json/new?$formUrl" -Method Put -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
    "RESULT: $($resp.StatusCode)"
    ($resp.Content | ConvertFrom-Json) | Select-Object id, title | Format-List | Out-String
} catch {
    # PUT failed (Chrome 111+ deprecated this for security). Use GET with the URL on the path.
    try {
        $resp = Invoke-WebRequest -Uri "http://127.0.0.1:18792/json/new?$formUrl" -Method Get -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
        "RESULT (GET fallback): $($resp.StatusCode)"
        ($resp.Content | ConvertFrom-Json) | Select-Object id, title | Format-List | Out-String
    } catch {
        "TAB_OPEN_FAIL: Chrome CDP did not open the configured form URL."
        "DETAIL: $($_.Exception.GetType().Name)"
        "MANUAL: ask the human to paste the configured form URL from suspensions-test-fac-url.txt into Chrome."
        exit 1
    }
}

"`n=== Verifying form tab landed ==="
Start-Sleep -Seconds 2
$tabs = (Invoke-WebRequest -Uri "http://127.0.0.1:18792/json" -UseBasicParsing -TimeoutSec 3).Content | ConvertFrom-Json
$formTab = $tabs | Where-Object { $_.url -match "forms\.office\.com" -and $_.type -eq "page" } | Select-Object -First 1
if ($formTab) {
    "FORM_TAB:"
    "  Title: $($formTab.title)"
    if ($formTab.title -match "Suspension|Term 3|Primary School") {
        "STATE: FORM_LOADED"
    } else {
        "STATE: FORM_LOADING (title hasn't resolved yet - wait 3-5s and re-verify)"
    }
} else {
    "STATE: FORM_NOT_FOUND_IN_TABS (open it manually)"
    exit 1
}
