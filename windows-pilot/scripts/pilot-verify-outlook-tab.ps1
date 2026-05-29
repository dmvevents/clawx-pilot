# pilot-verify-outlook-tab.ps1 - confirm Outlook is signed-in via CDP /json.
# Read-only: yes
# Requires: CDP up on port 18792 (run pilot-attach-chrome-cdp.ps1 first if not).

$ErrorActionPreference = "Continue"

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

"=== CDP VERSION ==="
try {
    $ver = Invoke-WebRequest -Uri "http://127.0.0.1:18792/json/version" -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
    "CDP_UP: yes"
    ($ver.Content | ConvertFrom-Json) | Select-Object Browser, "Protocol-Version", "User-Agent" | Format-List | Out-String
} catch {
    "CDP_UP: no"
    "ERROR: $($_.Exception.Message)"
    "STATE: CDP_DOWN"
    exit 1
}

"`n=== ALL TABS ==="
try {
    $tabs = (Invoke-WebRequest -Uri "http://127.0.0.1:18792/json" -UseBasicParsing -TimeoutSec 3).Content | ConvertFrom-Json
    $pages = $tabs | Where-Object { $_.type -eq "page" }
    "TAB_COUNT: $($pages.Count)"
    $pages | Select-Object @{N="URL";E={ Truncate-Text (Redact-Text $_.url) 120 }}, @{N="Title";E={ Truncate-Text $_.title 60 }} | Format-Table -Wrap | Out-String
} catch {
    "TAB_LIST_FAIL: $($_.Exception.Message)"
    exit 1
}

"`n=== OUTLOOK TAB DETECTION ==="
$outlookPattern = "outlook\.(office\.com|cloud\.microsoft|office365\.com|live\.com)"
$outlook = $pages | Where-Object { $_.url -match $outlookPattern }
if ($outlook) {
    $first = $outlook[0]
    "OUTLOOK_TAB_FOUND: yes"
    "URL:   $(Truncate-Text (Redact-Text $first.url) 160)"
    "Title: $($first.title)"
    if ($first.url -match "/login|/signin|loginerror|wreply=") {
        "SIGNED_IN: NO (login redirect detected)"
        "STATE: OUTLOOK_LOGIN_REQUIRED"
    } elseif ($first.url -match "/mail/|/owa/|/inbox") {
        "SIGNED_IN: yes"
        "STATE: OUTLOOK_READY"
    } else {
        "SIGNED_IN: ambiguous (URL doesn't match login OR inbox patterns)"
        "STATE: OUTLOOK_AMBIGUOUS"
    }
} else {
    "OUTLOOK_TAB_FOUND: no"
    "STATE: NO_OUTLOOK_TAB"
}

"`n=== FORMS TAB DETECTION ==="
$forms = $pages | Where-Object { $_.url -match "forms\.office\.com" }
if ($forms) {
    $f = $forms[0]
    "FORMS_TAB_FOUND: yes"
    "URL:   $(Truncate-Text (Redact-Text $f.url) 160)"
    "Title: $($f.title)"
} else {
    "FORMS_TAB_FOUND: no (acceptable until forms turn)"
}
