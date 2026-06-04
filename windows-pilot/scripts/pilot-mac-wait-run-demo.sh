#!/usr/bin/env bash
# Wait from macOS for the Windows pilot laptop to expose SSH, then run the
# safe Electron-path demo harness once. This script never sends email,
# downloads attachments, or submits Microsoft Forms.

set -u

SSH_HOST="${SSH_HOST:-pilot}"
DEADLINE_SECONDS="${DEADLINE_SECONDS:-28800}"
SLEEP_SECONDS="${SLEEP_SECONDS:-60}"
REPO_WIN="${REPO_WIN:-C:\\Users\\VYONIX\\Github\\ClawX-release-moe10}"
EVIDENCE_ROOT_WIN="${EVIDENCE_ROOT_WIN:-C:\\Users\\VYONIX\\Downloads}"
LOG_ROOT="${LOG_ROOT:-$HOME/Library/Logs/clawx}"
STAMP="$(date +%Y%m%d-%H%M%S)"
LOG_FILE="${LOG_FILE:-$LOG_ROOT/pilot-mac-wait-run-demo-$STAMP.log}"

mkdir -p "$LOG_ROOT"

SSH_OPTS=(
  -o ControlMaster=no
  -o ControlPath=none
  -o ConnectTimeout=12
)

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG_FILE"
}

encode_powershell() {
  printf '%s' "$1" | iconv -f UTF-8 -t UTF-16LE | base64 | tr -d '\n'
}

ssh_ps() {
  local script="$1"
  local encoded
  encoded="$(encode_powershell "$script")"
  ssh "${SSH_OPTS[@]}" "$SSH_HOST" "powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand $encoded"
}

connectivity_script='hostname; Get-Date -Format o'

read -r -d '' remote_run_script <<PS || true
\$ErrorActionPreference = 'Stop'
\$Repo = '${REPO_WIN}'
\$EvidenceRoot = '${EVIDENCE_ROOT_WIN}'

Write-Output '=== ClawX Windows laptop demo run ==='
Write-Output ('Repo=' + \$Repo)
Write-Output ('EvidenceRoot=' + \$EvidenceRoot)
Write-Output ('Started=' + (Get-Date -Format o))

Set-Location -LiteralPath \$Repo
git status --short --branch
git pull --ff-only
git rev-parse --short HEAD

node --check .\\windows-pilot\\scripts\\pilot-electron-cdp-probe.js
node -e "JSON.parse(require('fs').readFileSync('windows-pilot/scenarios/demo-chat-procedures.json','utf8')); console.log('SCENARIO_JSON_OK')"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\\windows-pilot\\scripts\\pilot-run-chat-procedures.ps1 -Repo \$Repo -EvidenceRoot \$EvidenceRoot -DownloadsPath \$EvidenceRoot -RunPreflight -Relaunch
if (\$LASTEXITCODE -ne 0) {
  throw "chat procedures failed with exit code \$LASTEXITCODE"
}

powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\\windows-pilot\\scripts\\pilot-run-demo-acceptance.ps1 -Repo \$Repo -EvidenceRoot \$EvidenceRoot
if (\$LASTEXITCODE -ne 0) {
  throw "demo acceptance failed with exit code \$LASTEXITCODE"
}

powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\\windows-pilot\\scripts\\pilot-start-claude-chat-loop.ps1 -Repo \$Repo -LogRoot \$EvidenceRoot -WaitSeconds 25

\$ChatDir = Get-ChildItem -Path \$EvidenceRoot -Directory -Filter 'clawx-chat-procedures-*' -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
\$DemoDir = Get-ChildItem -Path \$EvidenceRoot -Directory -Filter 'clawx-demo-evidence-*' -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (\$ChatDir) {
  Write-Output ('LATEST_CHAT_EVIDENCE=' + \$ChatDir.FullName)
  \$ChatReport = Join-Path \$ChatDir.FullName 'final-report.md'
  if (Test-Path \$ChatReport) {
    Write-Output '=== Latest chat final-report.md ==='
    Get-Content -LiteralPath \$ChatReport -Tail 220
  }
}
if (\$DemoDir) {
  Write-Output ('LATEST_DEMO_EVIDENCE=' + \$DemoDir.FullName)
  \$DemoReport = Join-Path \$DemoDir.FullName 'final-report.md'
  if (Test-Path \$DemoReport) {
    Write-Output '=== Latest demo final-report.md ==='
    Get-Content -LiteralPath \$DemoReport -Tail 220
  }
}

Write-Output ('Finished=' + (Get-Date -Format o))
PS

deadline=$((SECONDS + DEADLINE_SECONDS))
log "Waiting for SSH host '$SSH_HOST' for up to ${DEADLINE_SECONDS}s"
log "Log file: $LOG_FILE"

while (( SECONDS < deadline )); do
  if ssh_ps "$connectivity_script" >>"$LOG_FILE" 2>&1; then
    log "SSH reachable; running Windows demo harness once"
    if ssh_ps "$remote_run_script" >>"$LOG_FILE" 2>&1; then
      log "Windows demo harness completed successfully"
      exit 0
    fi
    status=$?
    log "Windows demo harness failed with exit code $status"
    exit "$status"
  fi
  log "SSH not reachable yet; sleeping ${SLEEP_SECONDS}s"
  sleep "$SLEEP_SECONDS"
done

log "Timed out waiting for SSH host '$SSH_HOST'"
exit 124
