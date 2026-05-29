# pilot-probe-state.ps1 - read-only audit of the pilot.
# Reports app procs/ports, Chrome procs (with cmdline plus live CDP detection),
# installed app version, openclaw.json model defaults, latest log timestamp.
# Read-only: yes
# Safe to run anytime; never mutates state.

$ErrorActionPreference = "Continue"

function Test-CDPHttp {
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:18792/json/version" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        return ($r.StatusCode -eq 200)
    } catch {
        return $false
    }
}

function Redact-Text([string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value)) { return $Value }
    $redacted = $Value -replace '#token=[^&\s"]+', '#token=<redacted>'
    $redacted = $redacted -replace '([?&]token=)[^&\s"]+', '$1<redacted>'
    $redacted = $redacted -replace 'https://forms\.(office\.com|cloud\.microsoft)/Pages/ResponsePage\.aspx\?id=[^&\s"]+', 'https://forms.$1/Pages/ResponsePage.aspx?id=<redacted>'
    return $redacted
}

function Truncate-Text([string]$Value, [int]$MaxLength) {
    if ([string]::IsNullOrEmpty($Value) -or $Value.Length -le $MaxLength) { return $Value }
    return $Value.Substring(0, $MaxLength) + "..."
}

"=== TIMESTAMP ==="
Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz"

"`n=== APP PROCESSES ==="
$app = Get-Process | Where-Object { $_.ProcessName -match "Ministry|Education|ClawX|openclaw" } |
    Select-Object Name, Id, StartTime, @{N="MemMB";E={[math]::Round($_.WorkingSet64/1MB,1)}}
if ($app) { $app | Format-Table -AutoSize | Out-String } else { "  (no app procs)" }

"`n=== LISTENING PORTS (relevant) ==="
$ports = Get-NetTCPConnection -State Listen -LocalPort 18789,18791,13210,18792,11434 -ErrorAction SilentlyContinue |
    Select-Object LocalPort, OwningProcess, @{N="Proc";E={(Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).ProcessName}}
if ($ports) { $ports | Format-Table -AutoSize | Out-String } else { "  (no listening ports on 18789/18791/13210/18792/11434)" }

$cdpHttpUp = Test-CDPHttp
"CDP_HTTP_UP: $cdpHttpUp"

"`n=== CHROME PROCS + CDP FLAG SCAN ==="
$chrome = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" -ErrorAction SilentlyContinue
if ($chrome) {
    $cdpFlag = $chrome | Where-Object { $_.CommandLine -match "remote-debugging-port" }
    if ($cdpFlag) {
        "CDP_FLAG_PRESENT: yes"
        $cdpFlag | Select-Object ProcessId, @{N="CMD";E={ Truncate-Text (Redact-Text $_.CommandLine) 180 }} | Format-Table -AutoSize | Out-String
        if (-not $cdpHttpUp) {
            "CDP_FLAG_BUT_NO_HTTP: yes"
            "  Chrome 136+ can ignore remote debugging on the default user-data-dir."
            "  Use the separate demo profile launcher/shortcut for Forms and Outlook v2."
        }
    } else {
        "CDP_FLAG_PRESENT: no"
        "  $($chrome.Count) chrome procs running, none have --remote-debugging-port"
        "  (run the CDP Chrome desktop shortcut or pilot-attach-chrome-cdp-demo.ps1 to fix)"
    }
} else {
    "  (no chrome.exe procs)"
}

"`n=== INSTALLED APP VERSION ==="
$exe = "$env:LOCALAPPDATA\Programs\Ministry of Education\Ministry of Education.exe"
if (Test-Path $exe) {
    $info = Get-Item $exe
    $vi = $info.VersionInfo
    "Path:           $exe"
    "FileVersion:    $($vi.FileVersion)"
    "ProductVersion: $($vi.ProductVersion)"
    "Size:           $([math]::Round($info.Length/1MB,1)) MB"
    "Modified:       $($info.LastWriteTime)"
} else {
    "INSTALLED: NO ($exe missing)"
}

"`n=== OPENCLAW CONFIG ==="
$cfg = "$env:USERPROFILE\.openclaw\openclaw.json"
if (Test-Path $cfg) {
    "Path:     $cfg"
    "Modified: $((Get-Item $cfg).LastWriteTime)"
    try {
        $j = Get-Content $cfg -Raw | ConvertFrom-Json
        "agents.defaults.model.primary: $($j.agents.defaults.model.primary)"
        "agents.list count:             $($j.agents.list.Count)"
        if ($j.agents.list.Count -gt 0) {
            $j.agents.list | ForEach-Object { "  agent[$($_.name)].model.primary = $($_.model.primary)" }
        }
        "moe-principal-assistant enabled: $($j.plugins.entries.'moe-principal-assistant'.enabled)"
        "microsoft-graph enabled:        $($j.plugins.entries.'microsoft-graph'.enabled)"
        "browser plugin enabled:         $($j.plugins.entries.browser.enabled)"
    } catch {
        "  (parse error: $($_.Exception.Message))"
    }
} else {
    "  (no openclaw.json - first-run not completed)"
}

"`n=== LATEST GATEWAY LOG ==="
$logDir = "$env:APPDATA\Ministry of Education\logs"
if (Test-Path $logDir) {
    $log = Get-ChildItem $logDir -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($log) {
        "Path:     $($log.FullName)"
        "Size:     $([math]::Round($log.Length/1KB,1)) KB"
        "Modified: $($log.LastWriteTime)"
    } else {
        "  (no log files)"
    }
} else {
    "  (no log dir)"
}

"`n=== STATE LINE ==="
$gatewayUp = ($ports | Where-Object { $_.LocalPort -eq 18789 }) -ne $null
$apiUp = ($ports | Where-Object { $_.LocalPort -eq 13210 }) -ne $null
$cdpUp = $cdpHttpUp
$installed = Test-Path $exe
$state = @()
if ($installed) { $state += "INSTALLED" } else { $state += "NOT_INSTALLED" }
if ($gatewayUp) { $state += "GATEWAY_UP" } else { $state += "GATEWAY_DOWN" }
if ($apiUp) { $state += "API_UP" } else { $state += "API_DOWN" }
if ($cdpUp) { $state += "CDP_UP" } else { $state += "CDP_DOWN" }
"STATE: $($state -join ' | ')"
