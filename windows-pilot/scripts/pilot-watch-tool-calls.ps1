# pilot-watch-tool-calls.ps1 - tail the gateway log and surface ONLY tool-call lines.
# Read-only: yes
# Use: in one ssh session, run this. In another window/conversation, the principal
# types into the chat composer. Each tool invocation prints a structured line here.
#
# Output format per detected event:
#   [HH:MM:SS] TOOL: <name> | <key=val pairs> | result=<ok|err>
# Plus pass-through of any model/error lines.

param(
    [int]$DurationSec = 600,
    [int]$PollMs = 500
)

$ErrorActionPreference = "Continue"

$logDir = "$env:APPDATA\Ministry of Education\logs"
$log = Get-ChildItem $logDir -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $log) { "NO_LOG"; exit 1 }

"=== Watching $($log.FullName) ==="
"Duration: ${DurationSec}s"
"Filters: outlook.* | forms.* | model | error | gateway"
""

# Start at end of file
$lastSize = $log.Length
$deadline = (Get-Date).AddSeconds($DurationSec)

while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds $PollMs
    # Re-stat (may have rotated)
    $cur = Get-Item $log.FullName -ErrorAction SilentlyContinue
    if (-not $cur) { continue }
    if ($cur.Length -lt $lastSize) {
        # File rotated/truncated
        $lastSize = 0
    }
    if ($cur.Length -eq $lastSize) { continue }

    # Read the new bytes
    $stream = [System.IO.File]::Open($log.FullName, 'Open', 'Read', 'ReadWrite')
    try {
        $stream.Seek($lastSize, 'Begin') | Out-Null
        $reader = New-Object System.IO.StreamReader($stream)
        $newText = $reader.ReadToEnd()
        $reader.Dispose()
    } finally {
        $stream.Dispose()
    }
    $lastSize = $cur.Length

    # Scan lines
    foreach ($line in $newText -split "`n") {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        $ts = if ($line -match "^\[(\d\d\d\d-\d\d-\d\dT(\d\d:\d\d:\d\d))") { $matches[2] } else { (Get-Date -Format HH:mm:ss) }

        # Tool invocations
        if ($line -match "outlook\.\w+|forms\.\w+|moe-principal-assistant") {
            "[$ts] TOOL > $line"
        }
        # Model events
        elseif ($line -match "model|gemini|google/|tokens|completion") {
            if ($line -match "error|failed|FAIL") {
                "[$ts] MODEL-ERR > $line"
            } else {
                "[$ts] MODEL > $line"
            }
        }
        # Errors / warnings
        elseif ($line -match "\[ERROR\]|\[WARN \]|\[FATAL\]|error:|failed:|Error:") {
            "[$ts] ERR > $line"
        }
        # Gateway lifecycle
        elseif ($line -match "Gateway|gateway") {
            "[$ts] GW > $line"
        }
    }
}

"=== Watch complete ==="
