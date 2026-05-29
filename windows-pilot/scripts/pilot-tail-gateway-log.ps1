# pilot-tail-gateway-log.ps1 - print the latest gateway log tail.
# Read-only: yes
# Usage: scp + ssh pilot 'powershell ... -File pilot-tail-gateway-log.ps1 -Lines 100 -Filter outlook'
# (PowerShell 5.1 doesn't have a clean named-arg path via -Command, so we read $args.)

param(
    [int]$Lines = 80,
    [string]$Filter = ""
)

$ErrorActionPreference = "Continue"

$logDir = "$env:APPDATA\Ministry of Education\logs"
if (-not (Test-Path $logDir)) {
    "NO_LOG_DIR: $logDir"
    exit 1
}

$log = Get-ChildItem $logDir -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $log) {
    "NO_LOG_FILES: $logDir"
    exit 1
}

"=== TAILING $($log.FullName) ==="
"Size: $([math]::Round($log.Length/1KB,1)) KB | LastWrite: $($log.LastWriteTime)"
""

$tail = Get-Content $log.FullName -Tail $Lines -ErrorAction SilentlyContinue
if ($Filter) {
    $tail = $tail | Where-Object { $_ -match $Filter }
}
$tail | Out-String
