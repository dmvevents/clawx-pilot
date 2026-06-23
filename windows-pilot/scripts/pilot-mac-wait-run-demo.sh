#!/usr/bin/env bash
# Wait from macOS for the Windows pilot laptop to expose SSH, then run the
# safe Electron-path demo harness once. This script never sends email,
# downloads attachments, or submits Microsoft Forms.

set -u

# launchctl submits jobs with a minimal PATH, which hides Homebrew tools such as
# nmap. Keep discovery self-contained so the laptop watcher works from launchd.
PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export PATH

SSH_HOST="${SSH_HOST:-pilot}"
SSH_HOSTS="${SSH_HOSTS:-$SSH_HOST}"
SSH_USER="${SSH_USER:-vyonix}"
EXPECTED_HOSTNAME="${EXPECTED_HOSTNAME:-VYONIX}"
DISCOVER_CIDRS="${DISCOVER_CIDRS:-}"
DISCOVER_ARP="${DISCOVER_ARP:-1}"
DISCOVER_INTERVAL_SECONDS="${DISCOVER_INTERVAL_SECONDS:-300}"
AUTO_DISCOVER_CIDRS="${AUTO_DISCOVER_CIDRS:-1}"
AUTO_DISCOVER_MIN_PREFIX="${AUTO_DISCOVER_MIN_PREFIX:-24}"
ARP_SCAN_LIMIT="${ARP_SCAN_LIMIT:-64}"
DEADLINE_SECONDS="${DEADLINE_SECONDS:-28800}"
SLEEP_SECONDS="${SLEEP_SECONDS:-60}"
REPO_WIN="${REPO_WIN:-C:\\Users\\VYONIX\\Github\\ClawX-release-moe10}"
EVIDENCE_ROOT_WIN="${EVIDENCE_ROOT_WIN:-C:\\Users\\VYONIX\\Downloads}"
RELEASE_TAG="${RELEASE_TAG:-moe10-windows-rc-20260623-stable-regression}"
RELEASE_INSTALLER_NAME="${RELEASE_INSTALLER_NAME:-Ministry.of.Education-0.4.3-moe.10-win-x64.exe}"
RELEASE_INSTALLER_SHA256="${RELEASE_INSTALLER_SHA256:-3a43cdff49c758b07ccfd57117a06304152813a7b80d857ba99c03486fe8f4fa}"
RELEASE_APP_ASAR_SHA256="${RELEASE_APP_ASAR_SHA256:-ee749bc6b05e56cc4ffbc6faba6436bf51cd23c02a3d86ed5a87a14d3bac1421}"
ALLOW_SILENT_INSTALL="${ALLOW_SILENT_INSTALL:-0}"
LOG_ROOT="${LOG_ROOT:-$HOME/Library/Logs/clawx}"
STAMP="$(date +%Y%m%d-%H%M%S)"
LOG_FILE="${LOG_FILE:-$LOG_ROOT/pilot-mac-wait-run-demo-$STAMP.log}"
TRUNCATE_LOG_ON_START="${TRUNCATE_LOG_ON_START:-0}"
RUN_ID="${RUN_ID:-$STAMP-$$}"

case "$ALLOW_SILENT_INSTALL" in
  1|true|TRUE|yes|YES)
    ALLOW_SILENT_INSTALL=1
    ;;
  *)
    ALLOW_SILENT_INSTALL=0
    ;;
esac

mkdir -p "$LOG_ROOT"
if [[ "$TRUNCATE_LOG_ON_START" == "1" ]]; then
  : >"$LOG_FILE"
fi

SSH_OPTS=(
  -o ControlMaster=no
  -o ControlPath=none
  -o ConnectTimeout=12
  -o StrictHostKeyChecking=accept-new
)

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG_FILE"
}

encode_powershell() {
  printf '%s' "$1" | iconv -f UTF-8 -t UTF-16LE | base64 | tr -d '\n'
}

ssh_ps_target() {
  local target="$1"
  local script="$2"
  local encoded
  encoded="$(encode_powershell "$script")"
  ssh "${SSH_OPTS[@]}" "$target" "powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand $encoded"
}

ssh_ps() {
  ssh_ps_target "$CURRENT_SSH_TARGET" "$1"
}

target_for_host() {
  local host="$1"
  if [[ "$host" == *@* || "$host" == "pilot" ]]; then
    printf '%s\n' "$host"
  else
    printf '%s@%s\n' "$SSH_USER" "$host"
  fi
}

cidr_prefix_from_netmask() {
  local mask="$1"
  local prefix=0
  local octet bit
  IFS=. read -r o1 o2 o3 o4 <<<"$mask"
  for octet in "$o1" "$o2" "$o3" "$o4"; do
    [[ "$octet" =~ ^[0-9]+$ ]] || return 1
    for bit in 128 64 32 16 8 4 2 1; do
      if (( (octet & bit) != 0 )); then
        prefix=$((prefix + 1))
      fi
    done
  done
  printf '%s\n' "$prefix"
}

hex_netmask_to_dotted() {
  local hex="${1#0x}"
  local value
  [[ "$hex" =~ ^[0-9a-fA-F]{8}$ ]] || return 1
  value=$((16#$hex))
  printf '%s.%s.%s.%s\n' \
    "$(((value >> 24) & 255))" \
    "$(((value >> 16) & 255))" \
    "$(((value >> 8) & 255))" \
    "$((value & 255))"
}

network_cidr_from_ip_mask() {
  local ip="$1"
  local mask="$2"
  local prefix
  IFS=. read -r i1 i2 i3 i4 <<<"$ip"
  IFS=. read -r m1 m2 m3 m4 <<<"$mask"
  prefix="$(cidr_prefix_from_netmask "$mask")" || return 1
  if (( i1 == 127 || (i1 == 169 && i2 == 254) || prefix < 20 )); then
    return 1
  fi
  if (( prefix < AUTO_DISCOVER_MIN_PREFIX )); then
    if (( AUTO_DISCOVER_MIN_PREFIX == 24 )); then
      printf '%s.%s.%s.0/24\n' "$i1" "$i2" "$i3"
    fi
    return 0
  fi
  printf '%s.%s.%s.%s/%s\n' \
    "$((i1 & m1))" \
    "$((i2 & m2))" \
    "$((i3 & m3))" \
    "$((i4 & m4))" \
    "$prefix"
}

auto_candidate_cidrs() {
  [[ "$AUTO_DISCOVER_CIDRS" == "1" ]] || return 0
  command -v ifconfig >/dev/null 2>&1 || return 0

  ifconfig 2>/dev/null |
    awk '
      /^[a-zA-Z0-9_.-]+: / { iface=$1; sub(/:$/, "", iface) }
      /status: active/ { active[iface]=1 }
      /inet / && iface !~ /^lo/ {
        ip=$2
        mask=$4
        if (ip && mask && mask ~ /^0x/) print iface, ip, mask
      }
      END {
        for (iface in active) {
          # active[] is used above only to force awk to keep the table in POSIX awk.
        }
      }
    ' |
    while read -r iface ip hexmask; do
      if ! ifconfig "$iface" 2>/dev/null | grep -q 'status: active'; then
        continue
      fi
      mask="$(hex_netmask_to_dotted "$hexmask")" || continue
      network_cidr_from_ip_mask "$ip" "$mask" || true
    done
}

effective_discover_cidrs() {
  { printf '%s\n' $DISCOVER_CIDRS; configured_link_local_cidrs; auto_candidate_cidrs; } |
    awk 'NF && !seen[$0]++ { print }' |
    tr '\n' ' '
}

configured_link_local_cidrs() {
  if ! ifconfig 2>/dev/null | awk '/inet 169\.254\./ { found=1 } END { exit found ? 0 : 1 }'; then
    return 0
  fi

  local host ip
  for host in $SSH_HOSTS $SSH_HOST; do
    ip="${host#*@}"
    ip="${ip%%:*}"
    if [[ "$ip" =~ ^169\.254\.([0-9]{1,3})\.([0-9]{1,3})$ ]]; then
      printf '169.254.%s.0/24\n' "${BASH_REMATCH[1]}"
    fi
  done
}

try_target() {
  local target="$1"
  local output
  local normalized
  if ! output="$(ssh_ps_target "$target" "$connectivity_script" 2>&1)"; then
    printf '%s\n' "$output" >>"$LOG_FILE"
    return 1
  fi
  normalized="$(printf '%s\n' "$output" | tr -d '\r')"
  if [[ -n "$EXPECTED_HOSTNAME" ]] && ! grep -qi "^${EXPECTED_HOSTNAME}$" <<<"$normalized"; then
    log "SSH target '$target' responded but hostname did not match '$EXPECTED_HOSTNAME'"
    printf '%s\n' "$normalized" >>"$LOG_FILE"
    return 1
  fi
  printf '%s\n' "$normalized" >>"$LOG_FILE"
  CURRENT_SSH_TARGET="$target"
  return 0
}

candidate_hosts_from_arp() {
  if [[ "$DISCOVER_ARP" != "1" ]]; then
    return 0
  fi
  local ips
  ips="$(
    arp -an 2>/dev/null |
    awk '/\([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+\)/ && $0 !~ /incomplete/ { gsub(/[()]/, "", $2); print $2 }' |
    sort -u |
    head -n "$ARP_SCAN_LIMIT" |
    tr '\n' ' '
  )"
  [[ -n "$ips" ]] || return 0
  if [[ -n "$(command -v nmap || true)" ]]; then
    nmap -n -Pn -p 22 --open --max-retries 0 --host-timeout 2s --min-rate 2000 $ips 2>/dev/null |
      awk '/Nmap scan report for / { print $NF }'
    return 0
  fi
  local ip
  for ip in $ips; do
    if nc -G 1 -z "$ip" 22 >/dev/null 2>&1; then
      printf '%s\n' "$ip"
    fi
  done
}

candidate_hosts_from_cidrs() {
  local cidrs
  cidrs="$(effective_discover_cidrs)"
  if [[ -z "$cidrs" || -z "$(command -v nmap || true)" ]]; then
    return 0
  fi
  # Port 22 only; hostname validation happens before any discovered target is accepted.
  log "Scanning SSH CIDRs: $cidrs" >&2
  nmap -n -Pn -p 22 --open --max-retries 0 --host-timeout 1s --max-rtt-timeout 500ms --initial-rtt-timeout 200ms --min-parallelism 64 --min-rate 5000 $cidrs 2>/dev/null |
    awk '/Nmap scan report for / { print $NF }'
}

discover_target() {
  local now="$SECONDS"
  if (( now - LAST_DISCOVERY_SECONDS < DISCOVER_INTERVAL_SECONDS )); then
    return 1
  fi
  LAST_DISCOVERY_SECONDS="$now"

  log "Running bounded SSH discovery"
  local host target
  while read -r host; do
    [[ -z "$host" ]] && continue
    target="$(target_for_host "$host")"
    if try_target "$target"; then
      log "Discovered Windows laptop SSH target '$target'"
      return 0
    fi
  done < <({ candidate_hosts_from_arp; candidate_hosts_from_cidrs; } | sort -u)

  log "No matching Windows SSH target discovered"
  return 1
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
\$GeneratedHelper = Join-Path \$Repo 'summarize_excel.py'
if (Test-Path -LiteralPath \$GeneratedHelper) {
  Remove-Item -LiteralPath \$GeneratedHelper -Force
  Write-Output 'Removed generated helper: summarize_excel.py'
}
git status --short --branch
git pull --ff-only
git rev-parse --short HEAD

\$ReleaseTag = '${RELEASE_TAG}'
\$InstallerName = '${RELEASE_INSTALLER_NAME}'
\$ExpectedInstallerSha = '${RELEASE_INSTALLER_SHA256}'.ToUpperInvariant()
\$ExpectedAppAsarSha = '${RELEASE_APP_ASAR_SHA256}'.ToUpperInvariant()
\$InstallRoot = Join-Path \$env:LOCALAPPDATA 'Programs\Ministry of Education'
\$AppAsar = Join-Path \$InstallRoot 'resources\app.asar'
\$InstallerPath = Join-Path \$EvidenceRoot \$InstallerName
\$ReleaseUrl = 'https://github.com/dmvevents/clawx-pilot/releases/download/' + \$ReleaseTag + '/' + \$InstallerName
\$AllowSilentInstall = '${ALLOW_SILENT_INSTALL}' -eq '1'

Write-Output ('ReleaseTag=' + \$ReleaseTag)
Write-Output ('ExpectedAppAsarSha=' + \$ExpectedAppAsarSha)
Write-Output ('AllowSilentInstall=' + \$AllowSilentInstall)
\$InstalledAppAsarSha = \$null
if (Test-Path -LiteralPath \$AppAsar) {
  \$InstalledAppAsarSha = (Get-FileHash -LiteralPath \$AppAsar -Algorithm SHA256).Hash.ToUpperInvariant()
}
\$InstalledAppAsarShaLabel = if (\$InstalledAppAsarSha) { \$InstalledAppAsarSha } else { 'missing' }
Write-Output ('InstalledAppAsarSha=' + \$InstalledAppAsarShaLabel)

if (\$InstalledAppAsarSha -ne \$ExpectedAppAsarSha) {
  if (-not \$AllowSilentInstall) {
    Write-Output 'Installed app is stale or missing; hidden silent install is disabled by default.'
    Write-Output 'Set ALLOW_SILENT_INSTALL=1 only for an explicit automation install diagnostic. Use assisted desktop/RDP install for release proof.'
    Write-Output 'STATE:STALE_APP_REQUIRES_ASSISTED_INSTALL'
    throw 'installed app.asar does not match expected release; assisted install required'
  }

  Write-Output 'Installed app is stale or missing; ALLOW_SILENT_INSTALL=1 so preparing release installer.'
  Write-Output 'STATE:DIAGNOSTIC_SILENT_INSTALL_ONLY'
  if (-not (Test-Path -LiteralPath \$InstallerPath) -or ((Get-FileHash -LiteralPath \$InstallerPath -Algorithm SHA256).Hash.ToUpperInvariant() -ne \$ExpectedInstallerSha)) {
    Write-Output ('Downloading installer: ' + \$ReleaseUrl)
    Invoke-WebRequest -Uri \$ReleaseUrl -OutFile \$InstallerPath -UseBasicParsing
  }
  \$InstallerSha = (Get-FileHash -LiteralPath \$InstallerPath -Algorithm SHA256).Hash.ToUpperInvariant()
  Write-Output ('InstallerSha=' + \$InstallerSha)
  if (\$InstallerSha -ne \$ExpectedInstallerSha) {
    throw ('installer SHA mismatch: ' + \$InstallerSha)
  }

  \$BackupStamp = Get-Date -Format yyyyMMdd-HHmmss
  \$OpenClawSrc = Join-Path \$env:USERPROFILE '.openclaw'
  \$OpenClawBackup = Join-Path \$EvidenceRoot ('.openclaw.backup-before-rc-' + \$BackupStamp)
  if (Test-Path -LiteralPath \$OpenClawSrc) {
    Copy-Item -LiteralPath \$OpenClawSrc -Destination \$OpenClawBackup -Recurse -Force -ErrorAction SilentlyContinue
    Write-Output ('OPENCLAW_BACKUP=' + \$OpenClawBackup)
  }
  \$AppDataSrc = Join-Path \$env:APPDATA 'Ministry of Education'
  \$AppDataBackup = Join-Path \$EvidenceRoot ('MinistryAppData.backup-before-rc-' + \$BackupStamp)
  if (Test-Path -LiteralPath \$AppDataSrc) {
    Copy-Item -LiteralPath \$AppDataSrc -Destination \$AppDataBackup -Recurse -Force -ErrorAction SilentlyContinue
    Write-Output ('APPDATA_BACKUP=' + \$AppDataBackup)
  }

  powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\windows-pilot\scripts\pilot-run-silent-install.ps1 -InstallerPath \$InstallerPath -TimeoutSeconds 1800 -EvidenceRoot \$EvidenceRoot -StopRunningApp
  if (\$LASTEXITCODE -ne 0) {
    throw "silent install failed with exit code \$LASTEXITCODE"
  }
  \$InstalledAppAsarSha = (Get-FileHash -LiteralPath \$AppAsar -Algorithm SHA256).Hash.ToUpperInvariant()
  Write-Output ('InstalledAppAsarShaAfterInstall=' + \$InstalledAppAsarSha)
  if (\$InstalledAppAsarSha -ne \$ExpectedAppAsarSha) {
    throw ('installed app.asar SHA mismatch after install: ' + \$InstalledAppAsarSha)
  }
} else {
  Write-Output 'Installed app already matches expected release app.asar.'
}

powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\windows-pilot\scripts\pilot-check-install-artifacts.ps1

node --check .\\windows-pilot\\scripts\\pilot-electron-cdp-probe.js
node -e "JSON.parse(require('fs').readFileSync('windows-pilot/scenarios/demo-chat-procedures.json','utf8')); console.log('SCENARIO_JSON_OK')"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\\windows-pilot\\scripts\\pilot-run-chat-procedures.ps1 -Repo \$Repo -EvidenceRoot \$EvidenceRoot -DownloadsPath \$EvidenceRoot -RunPreflight -Relaunch -SeedDemoDocuments
if (\$LASTEXITCODE -ne 0) {
  throw "chat procedures failed with exit code \$LASTEXITCODE"
}

powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\\windows-pilot\\scripts\\pilot-run-demo-acceptance.ps1 -Repo \$Repo -EvidenceRoot \$EvidenceRoot
if (\$LASTEXITCODE -ne 0) {
  throw "demo acceptance failed with exit code \$LASTEXITCODE"
}

powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\\windows-pilot\\scripts\\pilot-start-claude-chat-loop.ps1 -Repo \$Repo -LogRoot \$EvidenceRoot -WaitSeconds 25 -ReuseIfRunning

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
CURRENT_SSH_TARGET="$SSH_HOST"
LAST_DISCOVERY_SECONDS=-999999
log "Waiting for SSH host(s) '$SSH_HOSTS' for up to ${DEADLINE_SECONDS}s"
log "Log file: $LOG_FILE"
log "Run id: $RUN_ID"
log "Allow silent install: $ALLOW_SILENT_INSTALL"
log "Repo commit: $(git -C "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)" rev-parse --short HEAD 2>/dev/null || printf 'unknown')"

while (( SECONDS < deadline )); do
  connected=0
  for host in $SSH_HOSTS; do
    if try_target "$(target_for_host "$host")"; then
      connected=1
      break
    fi
  done
  if [[ "$connected" -ne 1 ]]; then
    if discover_target; then
      connected=1
    fi
  fi

  if [[ "$connected" -eq 1 ]]; then
    log "SSH reachable at '$CURRENT_SSH_TARGET'; running Windows demo harness once"
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
