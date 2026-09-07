#!/usr/bin/env bash
# vm-verify-moe19.sh — THE single command for the moe.19 Windows VM verify.
#
# v2 (Codex-hardened + VLM-desktop directive, 2026-09-06):
#  - HIGH fix: installer exit is ENFORCED (Start-Process -Wait -PassThru);
#    the app is stopped pre-install and the RUNNING process binary is
#    attested post-launch (path + FileVersion of the live process, not the
#    disk label) — a rerun over an existing install can no longer false-
#    green a failed install/launch.
#  - MED fix: the ASR chain fails LOUDLY (no || true), transcripts use a
#    unique per-run filename (stale JSON cannot regrade), and missing
#    prerequisites mark the run BLOCKED (exit 3), never green.
#  - NEW: install-artifact + no-excluded-packages proof
#    (pilot-check-install-artifacts.ps1 + EXTRA_BUNDLED_PACKAGES presence),
#    and VLM grading of the REAL desktop screen (~2000px — Bedrock caps
#    images near 2000px; larger frames grade falsely) via
#    pilot-desktop-screenshot.ps1 + scripts/clwx-vlm-grade-screens.mjs.
#
# HARD RULES: never starts/stops the VM (exit 3 with the owner command);
# never runs release:manifest:publish; never touches the running Mac app;
# guest launches are VISIBLE scheduled tasks, never Hidden (atlas §16).
#
# Usage: bash scripts/vm-verify-moe19.sh
# Exit: 0 scripted phases green; 3 BLOCKED (VM/artifact/prereq); 1 FAIL.
set -euo pipefail

VM="clawx-win-rc-20260609"
ZONE="us-central1-a"
PROJECT="gen-lang-client-0649986230"
SSH_PORT="${CLAWX_SSH_PORT:-12222}"
IAP_PROBE_RDP_PORT="${CLAWX_IAP_PROBE_RDP_PORT:-25389}"
IAP_PROBE_SSH_PORT="${CLAWX_IAP_PROBE_SSH_PORT:-25322}"
IAP_PROBE_CONTROL_PORT="${CLAWX_IAP_PROBE_CONTROL_PORT:-25399}"
GUEST_USER="${CLAWX_VM_USER:-clawxtest}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXE="$REPO_ROOT/release/Ministry of Education-0.4.3-moe.19-win-x64.exe"
GCS_DEST="gs://clawx-rc-artifacts-622687731621/moe19/"
RUN_TAG="$(date +%Y%m%d-%H%M%S)"
EVIDENCE_DIR="$REPO_ROOT/skills/laptop/evidence/$(date +%F)-moe19-verify-$RUN_TAG"
VM_RUN_JSON="$EVIDENCE_DIR/vm-run.json"
GUEST_DL='C:\Users\'"$GUEST_USER"'\Downloads'
GUEST_APP='C:\Users\'"$GUEST_USER"'\AppData\Local\Programs\Ministry of Education'
BLOCKED=0
STARTED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
COMPLETED_AT=""
VM_RUN_RESULT="NOT_RUN"
VM_RUN_EXIT_CODE=""
INSTALL_EXIT=""
SHA=""
GUEST_SHA=""
RUNNING_APP_VERSION=""
RUNNING_APP_PATH=""
GATEWAY_PORT_READY=false
HOSTAPI_PORT_READY=false
APP_ASAR_SHA=""
EVIDENCE_FILES=""
GUEST_BACKUP_DIR="$GUEST_DL\\clawx-preinstall-backup-$RUN_TAG"

log() { printf '[vm-verify-moe19 %s] %s\n' "$(date +%H:%M:%S)" "$*"; }
guest() { ssh -o ConnectTimeout=10 -p "$SSH_PORT" "$GUEST_USER@localhost" "$@"; }
# PowerShell via -EncodedCommand: the bash -> ssh -> Windows-OpenSSH -> cmd
# quoting stack eats `$` variables in inline -Command strings (live failure
# 2026-09-06: `$p = Start-Process ...` arrived as `= Start-Process`).
# Base64 UTF-16LE is immune to every layer.
gpwsh() {
  local b64
  b64=$(printf '%s' "$1" | iconv -f utf-8 -t utf-16le | base64 | tr -d '\n')
  guest "powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand $b64"
}

mkdir -p "$EVIDENCE_DIR"

record_evidence_file() {
  local rel="$1"
  local full="$EVIDENCE_DIR/$rel"
  [ -f "$full" ] || return 0
  local file_sha
  file_sha=$(shasum -a 256 "$full" | awk '{print $1}')
  EVIDENCE_FILES="${EVIDENCE_FILES}${rel}=${file_sha}"$'\n'
}

run_guest_producer() {
  local label="$1"
  local output="$2"
  shift 2
  local stdout_tmp stderr_tmp stderr_file code
  stdout_tmp="$(mktemp)"
  stderr_tmp="$(mktemp)"
  stderr_file="$output.stderr.txt"
  log "$label"
  if "$@" >"$stdout_tmp" 2>"$stderr_tmp"; then
    tr -d '\r' < "$stdout_tmp" > "$EVIDENCE_DIR/$output"
    tr -d '\r' < "$stderr_tmp" > "$EVIDENCE_DIR/$stderr_file"
    rm -f "$stdout_tmp" "$stderr_tmp"
    record_evidence_file "$output"
    [ -s "$EVIDENCE_DIR/$stderr_file" ] && record_evidence_file "$stderr_file"
  else
    code=$?
    tr -d '\r' < "$stdout_tmp" > "$EVIDENCE_DIR/$output"
    tr -d '\r' < "$stderr_tmp" > "$EVIDENCE_DIR/$stderr_file"
    rm -f "$stdout_tmp" "$stderr_tmp"
    record_evidence_file "$output"
    [ -s "$EVIDENCE_DIR/$stderr_file" ] && record_evidence_file "$stderr_file"
    case "$output:$code" in
      gateway-smoke.txt:2|gateway-smoke.txt:3|electron-probe-run.txt:2|electron-probe-run.txt:3|electron-probe-run.txt:4)
        VM_RUN_RESULT="BLOCKED"
        log "BLOCKED: $label prerequisite exited $code (captured $output and stderr sidecar)"
        exit 3
        ;;
    esac
    log "FAIL: $label exited $code (captured $output)"
    exit 1
  fi
}

write_vm_run_json() {
  local exit_code=$?
  VM_RUN_EXIT_CODE="$exit_code"
  COMPLETED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  case "$exit_code" in
    0) [ "$VM_RUN_RESULT" = "NOT_RUN" ] && VM_RUN_RESULT="COMPLETE" ;;
    3) [ "$VM_RUN_RESULT" = "NOT_RUN" ] && VM_RUN_RESULT="BLOCKED" ;;
    *) [ "$VM_RUN_RESULT" = "NOT_RUN" ] && VM_RUN_RESULT="FAIL" ;;
  esac
  export VM_RUN_JSON RUN_TAG STARTED_AT COMPLETED_AT VM_RUN_RESULT VM_RUN_EXIT_CODE
  export EXE SHA GUEST_DL GUEST_SHA GUEST_APP INSTALL_EXIT RUNNING_APP_VERSION RUNNING_APP_PATH
  export GATEWAY_PORT_READY HOSTAPI_PORT_READY APP_ASAR_SHA
  export EVIDENCE_FILES
  node <<'NODE'
const fs = require('node:fs');
const env = process.env;
const intOrNull = (value) => /^-?\d+$/.test(String(value || '')) ? Number(value) : null;
const boolValue = (value) => String(value).toLowerCase() === 'true';
const portableNames = new Set([
  'environment.json',
  'install-artifacts.json',
  'packages-nscc-presence.txt',
  'gateway-smoke.txt',
  'electron-probe-run.txt',
  'office-runtime.txt',
  'office-write.txt',
]);
const isPortableEvidence = (name) => portableNames.has(name) || /^clawx-electron-probe-.*\.json$/.test(name);
const evidenceFiles = String(env.EVIDENCE_FILES || '')
  .split(/\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => {
    const idx = line.lastIndexOf('=');
    return { path: line.slice(0, idx), sha256: line.slice(idx + 1) };
  })
  .filter((entry) => isPortableEvidence(entry.path));
const data = {
  schemaVersion: 1,
  runId: env.RUN_TAG,
  platform: 'win32',
  startedAt: env.STARTED_AT,
  completedAt: env.COMPLETED_AT,
  result: env.VM_RUN_RESULT,
  exitCode: intOrNull(env.VM_RUN_EXIT_CODE),
  installer: {
    name: env.EXE ? require('node:path').basename(env.EXE) : null,
    sha256: env.SHA || null,
    localPath: env.EXE || null,
    guestPath: env.GUEST_DL ? `${env.GUEST_DL}\\moe19.exe` : null,
    guestSha256: env.GUEST_SHA || null,
  },
  install: {
    exitCode: intOrNull(env.INSTALL_EXIT),
  },
  runningApp: {
    path: env.RUNNING_APP_PATH || null,
    version: env.RUNNING_APP_VERSION || null,
  },
  ports: {
    gateway: boolValue(env.GATEWAY_PORT_READY),
    hostapi: boolValue(env.HOSTAPI_PORT_READY),
  },
  appAsar: {
    path: env.GUEST_APP ? `${env.GUEST_APP}\\resources\\app.asar` : null,
    sha256: env.APP_ASAR_SHA || null,
  },
  environment: {
    path: 'environment.json',
  },
  evidenceFiles,
};
fs.writeFileSync(env.VM_RUN_JSON, `${JSON.stringify(data, null, 2)}\n`);
NODE
}
trap write_vm_run_json EXIT

# ── Phase 0 — Mac-side artifact + hash + GCS (idempotent) ────────────────────
[ -f "$EXE" ] || { log "BLOCKED: installer not found: $EXE"; exit 3; }
SHA=$(shasum -a 256 "$EXE" | awk '{print $1}')
log "artifact: $(basename "$EXE") bytes=$(stat -f%z "$EXE") sha256=$SHA"

# ── Phase 0b — credential gate (before ANY cloud call that costs time) ───────
# Credentials are proven before the VM status is believed and before the 430MB
# upload is attempted. An expired refresh token makes the status query print
# nothing, and swallowing its stderr made the old code read that silence as
# "the VM is not running" and hand the owner `instances start` — the wrong, and
# billable, remedy for a credential problem. Live 2026-09-06:
# "Reauthentication failed. cannot prompt during non-interactive execution."
GC_ERR="$(mktemp)"
STATUS=$(gcloud compute instances list --project "$PROJECT" --filter="name=$VM" --format='value(status)' 2>"$GC_ERR" || true)
if grep -qiE 'reauthentication|invalid_grant|refreshing your current auth|do(es)? not have any valid credentials' "$GC_ERR"; then
  log "BLOCKED: gcloud credentials expired — a credential gate, NOT a stopped VM."
  log "  $(head -1 "$GC_ERR")"
  log "  Owner (interactive, cannot be done from here):"
  log "    gcloud auth login"
  rm -f "$GC_ERR"
  exit 3
fi
rm -f "$GC_ERR"

if ! gsutil ls "${GCS_DEST}" 2>/dev/null | grep -q "moe.19-win-x64.exe"; then
  log "uploading to $GCS_DEST ..."
  gsutil cp "$EXE" "$GCS_DEST"
fi

# ── Phase 1 — VM status gate (NEVER starts it) ──────────────────────────────
if [ "$STATUS" != "RUNNING" ]; then
  log "BLOCKED: VM $VM is '${STATUS:-unknown}'. Owner spend call:"
  log "  gcloud compute instances start $VM --zone $ZONE --project $PROJECT"
  exit 3
fi
log "VM RUNNING"

# ── Phase 2 — tunnel (PF-3 control leg mandatory) ───────────────────────────
log "canonical IAP lane probe (separate local ports)"
CLAWX_GCP_PROJECT="$PROJECT" \
CLAWX_RDP_PORT="$IAP_PROBE_RDP_PORT" \
CLAWX_SSH_PORT="$IAP_PROBE_SSH_PORT" \
CLAWX_CONTROL_PORT="$IAP_PROBE_CONTROL_PORT" \
CLAWX_IAP_READY_TIMEOUT_SECONDS="${CLAWX_IAP_READY_TIMEOUT_SECONDS:-45}" \
  "$REPO_ROOT/windows-pilot/vm-testing/gcp-iap-lane.sh" probe || {
    log "BLOCKED: canonical IAP lane probe failed; VM access is not representative"
    exit 3
  }

if ! nc -z -w3 localhost "$SSH_PORT" 2>/dev/null; then
  log "opening IAP sshd tunnel -> localhost:$SSH_PORT"
  nohup gcloud compute start-iap-tunnel "$VM" 22 \
    --local-host-port="localhost:$SSH_PORT" --zone "$ZONE" --project "$PROJECT" \
    >/tmp/moe19-tunnel.log 2>&1 & disown
  for i in $(seq 1 20); do nc -z -w2 localhost "$SSH_PORT" 2>/dev/null && break; sleep 2; done
fi
# nc only proves the LOCAL listener is bound. A tunnel whose credentials have
# died keeps that listener up and resets every connection
# ("kex_exchange_identification: read: Connection reset by peer"), so nc
# false-POSITIVES here — the inverse of the known Windows-Firewall false
# negative. Classify that as BLOCKED (an environment gate the owner clears),
# never as a product FAIL.
GUEST_PROBE=$(guest 'echo GUEST_SSH_OK' 2>&1 || true)
if ! printf '%s' "$GUEST_PROBE" | grep -q GUEST_SSH_OK; then
  log "BLOCKED: port $SSH_PORT is bound but the guest ssh handshake failed."
  log "  probe: $(printf '%s' "$GUEST_PROBE" | head -1)"
  log "  Most likely the tunnel is alive with dead credentials. Owner (interactive):"
  log "    gcloud auth login    # then re-run: the tunnel is rebuilt automatically"
  log "  If auth is already good: pkill -f start-iap-tunnel && re-run."
  exit 3
fi
log "tunnel + guest ssh OK (control leg held)"

log "pre-mutation Windows environment profile"
scp -P "$SSH_PORT" "$REPO_ROOT/windows-pilot/scripts/pilot-fresh-install-environment.ps1" "$GUEST_USER@localhost:Downloads/" >/dev/null
ENVIRONMENT_GUEST_JSON="$GUEST_DL\\clawx-environment-$RUN_TAG.json"
gpwsh "& '$GUEST_DL\\pilot-fresh-install-environment.ps1' -Mode Probe -JsonOutputPath '$ENVIRONMENT_GUEST_JSON'"
scp -P "$SSH_PORT" "$GUEST_USER@localhost:Downloads/clawx-environment-$RUN_TAG.json" "$EVIDENCE_DIR/environment.json" >/dev/null
record_evidence_file "environment.json"

# ── Phase 3 — installer to guest + both-hop hash ────────────────────────────
if ! gpwsh "(Get-FileHash '$GUEST_DL\\moe19.exe' -ErrorAction SilentlyContinue).Hash" | tr -d '\r' | grep -qi "$SHA"; then
  log "copying installer to guest (430MB over IAP — minutes) ..."
  scp -P "$SSH_PORT" "$EXE" "$GUEST_USER@localhost:Downloads/moe19.exe"
fi
GUEST_SHA=$(gpwsh "(Get-FileHash '$GUEST_DL\\moe19.exe').Hash" | tr -d '\r' | tr '[:upper:]' '[:lower:]')
[ "$GUEST_SHA" = "$SHA" ] || { log "FAIL: guest sha mismatch ($GUEST_SHA)"; exit 1; }
log "sha256 verified BOTH hops"

log "pre-mutation guest state snapshot"
gpwsh '$p = Get-Process "Ministry of Education" -ErrorAction SilentlyContinue | Select-Object -First 1; $gateway = (Test-NetConnection -ComputerName localhost -Port 18789 -WarningAction SilentlyContinue).TcpTestSucceeded; $hostapi = (Test-NetConnection -ComputerName localhost -Port 13210 -WarningAction SilentlyContinue).TcpTestSucceeded; if ($p) { "RUNNING_APP_BEFORE=" + $p.Path } else { "RUNNING_APP_BEFORE=none" }; "PORT_18789_BEFORE=" + $gateway; "PORT_13210_BEFORE=" + $hostapi' | tr -d '\r' | tee "$EVIDENCE_DIR/pre-mutation-state.txt" >/dev/null
record_evidence_file "pre-mutation-state.txt"
run_guest_producer "pre-install backup of app data and OpenClaw state" "pre-install-backup.txt" gpwsh '
$ErrorActionPreference = "Stop"
function Write-State($name, $value) { "STATE:{0}={1}" -f $name, $value }
function Copy-StateDir($id, $source, $destination) {
  Write-State "${id}_SOURCE" $source
  Write-State "${id}_DESTINATION" $destination
  if (-not (Test-Path -LiteralPath $source -ErrorAction Stop)) {
    Write-State "${id}_PRESENT" "False"
    Write-State "${id}_FILE_COUNT" 0
    Write-State "${id}_DIR_COUNT" 0
    Write-State "${id}_BYTE_COUNT" 0
    return
  }
  Copy-Item -LiteralPath $source -Destination $destination -Recurse -Force -ErrorAction Stop
  $files = @(Get-ChildItem -LiteralPath $destination -Recurse -File -Force -ErrorAction Stop)
  $dirs = @(Get-ChildItem -LiteralPath $destination -Recurse -Directory -Force -ErrorAction Stop)
  $bytes = ($files | Measure-Object -Property Length -Sum).Sum
  if ($null -eq $bytes) { $bytes = 0 }
  Write-State "${id}_PRESENT" "True"
  Write-State "${id}_FILE_COUNT" $files.Count
  Write-State "${id}_DIR_COUNT" $dirs.Count
  Write-State "${id}_BYTE_COUNT" ([int64]$bytes)
}
$backupRoot = "'"$GUEST_BACKUP_DIR"'"
New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
Write-State "BACKUP_ROOT" $backupRoot
Copy-StateDir "APPDATA_MINISTRY" "$env:APPDATA\Ministry of Education" (Join-Path $backupRoot "APPDATA-Ministry of Education")
Copy-StateDir "OPENCLAW" "$env:USERPROFILE\.openclaw" (Join-Path $backupRoot "USERPROFILE-.openclaw")
Write-State "RESULT" "COMPLETE"
'

# ── Phase 4 — stop app, ENFORCED install, fresh launch, RUNNING-binary attest ─
gpwsh "(Get-Item '$GUEST_APP\\Ministry of Education.exe' -ErrorAction SilentlyContinue).VersionInfo.FileVersion" | tr -d '\r' | tee "$EVIDENCE_DIR/pre-version.txt" || true
record_evidence_file "pre-version.txt"
log "stopping app + gateway processes for a genuinely fresh install/launch"
gpwsh 'Get-Process | Where-Object { $_.ProcessName -match "Ministry|openclaw" } | Stop-Process -Force -ErrorAction SilentlyContinue; "stopped"' | tr -d '\r'
sleep 5
log "silent install /S /CURRENTUSER — exit code ENFORCED (Codex HIGH)"
INSTALL_EXIT=$(gpwsh '$p = Start-Process -FilePath "C:\Users\'"$GUEST_USER"'\Downloads\moe19.exe" -ArgumentList "/S","/CURRENTUSER" -Wait -PassThru; $p.ExitCode' | tr -d '\r' | tail -1)
[ "$INSTALL_EXIT" = "0" ] || { log "FAIL: installer exit=$INSTALL_EXIT"; exit 1; }
log "installer exit 0"
gpwsh "(Get-Item '$GUEST_APP\\Ministry of Education.exe').VersionInfo.FileVersion" | tr -d '\r' | tee "$EVIDENCE_DIR/post-version.txt" | grep -q "moe.19" || { log "FAIL: on-disk FileVersion not moe.19"; exit 1; }
record_evidence_file "post-version.txt"
APP_ASAR_SHA=$(gpwsh "(Get-FileHash '$GUEST_APP\\resources\\app.asar').Hash" | tr -d '\r' | tr '[:upper:]' '[:lower:]' | tail -1)
log "installed app.asar sha256=$APP_ASAR_SHA"

# ── Phase 5 — install completeness: artifacts + NO excluded packages ────────
log "install-artifact evidence (pilot-check-install-artifacts.ps1)"
scp -P "$SSH_PORT" "$REPO_ROOT/windows-pilot/scripts/pilot-check-install-artifacts.ps1" "$GUEST_USER@localhost:Downloads/" >/dev/null
guest "powershell -NoProfile -ExecutionPolicy Bypass -File \"$GUEST_DL\\pilot-check-install-artifacts.ps1\"" | tr -d '\r' | tee "$EVIDENCE_DIR/install-artifacts.json"
record_evidence_file "install-artifacts.json"
log "no-excluded-packages proof: every EXTRA_BUNDLED_PACKAGES entry present in the installed bundle"
# Import the list; never regex-scrape it. Two reasons, both found live:
# the constant is DEFINED in openclaw-bundle-config.mjs and only imported by
# verify-openclaw-bundle.mjs, so scraping the latter matched nothing and this
# whole phase silently checked zero packages and logged a pass; and the
# apostrophes in the config file's comments ("OpenClaw's own") make a
# quoted-string regex return comment fragments as package names.
PKGS=$(node -e "import('node:url').then(async (u) => {
  const mod = await import(u.pathToFileURL('$REPO_ROOT/scripts/openclaw-bundle-config.mjs').href);
  const pkgs = mod.EXTRA_BUNDLED_PACKAGES;
  if (!Array.isArray(pkgs) || pkgs.length === 0) process.exit(1);
  console.log(pkgs.join(' '));
}).catch(() => process.exit(1))")
# An empty list must fail the phase, not pass it vacuously.
[ -n "$PKGS" ] || { log "FAIL: could not read EXTRA_BUNDLED_PACKAGES — refusing to report a pass on zero packages"; exit 1; }
# Write the per-package readout as a reviewable artifact, not just a summary
# line. A one-line "all present (N checked)" cannot be audited after the fact,
# and it is what hid the zero-package pass above.
PRESENCE="$EVIDENCE_DIR/packages-nscc-presence.txt"
: > "$PRESENCE"
MISSING=""
for pkg in $PKGS; do
  if gpwsh "Test-Path '$GUEST_APP\\resources\\openclaw\\node_modules\\$(echo "$pkg" | sed 's|/|\\\\|g')'" | tr -d '\r' | grep -qi true; then
    echo "$pkg=True" >> "$PRESENCE"
  else
    echo "$pkg=False" >> "$PRESENCE"
    MISSING="$MISSING $pkg"
  fi
done
if [ -n "$MISSING" ]; then log "FAIL: excluded/missing bundled packages:$MISSING"; exit 1; fi
log "bundled packages all present ($(echo "$PKGS" | wc -w | tr -d ' ') checked -> $PRESENCE)"
log "NSCC pack present (CLWX-42 — moe.18 probed NONE, moe.19 must be PRESENT)"
if gpwsh "Test-Path '$GUEST_APP\\resources\\extensions\\moe-principal-assistant\\data\\nscc-2026.txt'" | tr -d '\r' | grep -qi true; then
  echo "nscc-2026.txt=True" >> "$PRESENCE"
else
  echo "nscc-2026.txt=False" >> "$PRESENCE"
  log "FAIL: nscc-2026.txt ABSENT"; exit 1
fi
record_evidence_file "packages-nscc-presence.txt"

# ── Phase 6 — raw producer evidence required by installed-release-evidence ──
# Run the standalone packaged-gateway smoke before the visible app launch: the
# producer itself requires port 18789 to be free and records
# STATE:GATEWAY_EXITED=false before stopping its direct gateway child.
scp -P "$SSH_PORT" "$REPO_ROOT/windows-pilot/scripts/pilot-run-installed-gateway-smoke.ps1" "$GUEST_USER@localhost:Downloads/" >/dev/null
run_guest_producer "installed gateway smoke (port 18789 must be free)" "gateway-smoke.txt" \
  guest "powershell -NoProfile -ExecutionPolicy Bypass -File \"$GUEST_DL\\pilot-run-installed-gateway-smoke.ps1\" -Port 18789 -WaitSeconds 180 -ArtifactRoot \"$GUEST_DL\" -EvidenceOnly"

scp -P "$SSH_PORT" "$REPO_ROOT/windows-pilot/scripts/pilot-office-runtime-check.ps1" "$GUEST_USER@localhost:Downloads/" >/dev/null
run_guest_producer "Office runtime module/readiness smoke" "office-runtime.txt" \
  guest "powershell -NoProfile -ExecutionPolicy Bypass -File \"$GUEST_DL\\pilot-office-runtime-check.ps1\""

scp -P "$SSH_PORT" "$REPO_ROOT/windows-pilot/scripts/pilot-office-write-smoke.ps1" "$GUEST_USER@localhost:Downloads/" >/dev/null
run_guest_producer "Office generated document write/readback smoke" "office-write.txt" \
  guest "powershell -NoProfile -ExecutionPolicy Bypass -File \"$GUEST_DL\\pilot-office-write-smoke.ps1\""

log "visible relaunch (scheduled task; never Hidden)"
TASK_QUERY=$(guest "schtasks /query /tn ClawXApp /fo LIST /v" 2>&1 | tr -d '\r' || true)
printf '%s\n' "$TASK_QUERY" > "$EVIDENCE_DIR/clawxapp-task.txt"
record_evidence_file "clawxapp-task.txt"
if ! printf '%s' "$TASK_QUERY" | grep -q -- '--remote-debugging-port=9223'; then
  VM_RUN_RESULT="BLOCKED"
  log "BLOCKED: ClawXApp scheduled task does not expose Electron CDP 9223; cannot run installed Electron probe."
  exit 3
fi
guest "schtasks /run /tn ClawXApp" || { log "FAIL: ClawXApp scheduled task could not run (create it per WINDOWS_INSTALL_RUNBOOK)"; exit 1; }
# Gateway boot takes minutes on the CPU-bound VM (moe.18 measured 51s+ on
# fresh state; live failure 2026-09-06 at a fixed 45s): retry loop, not a
# fixed sleep.
# Attest the RUNNING process binary, not the disk label (Codex HIGH). The
# scheduled task returns before Electron is necessarily created, so wait for
# the actual process instead of racing the launch.
if ! RUN_ATTEST=$(gpwsh '$deadline = (Get-Date).AddSeconds(120); do { $p = Get-Process "Ministry of Education" -ErrorAction SilentlyContinue | Select-Object -First 1; if ($p) { (Get-Item $p.Path).VersionInfo.FileVersion + "|" + $p.Path; exit 0 }; Start-Sleep -Seconds 2 } while ((Get-Date) -lt $deadline); "NOT_RUNNING"; exit 1' | tr -d '\r' | tail -1); then
  log "FAIL: running binary did not appear after ClawXApp launch"
  exit 1
fi
echo "$RUN_ATTEST" | tee "$EVIDENCE_DIR/running-binary-attest.txt"
record_evidence_file "running-binary-attest.txt"
echo "$RUN_ATTEST" | grep -q "moe.19" || { log "FAIL: running binary attest = $RUN_ATTEST"; exit 1; }
RUNNING_APP_VERSION="${RUN_ATTEST%%|*}"
RUNNING_APP_PATH="${RUN_ATTEST#*|}"
for probe in "9223 electron-cdp" "18789 gateway" "13210 hostapi"; do
  set -- $probe
  PORT_UP=0
  for i in $(seq 1 30); do
    if gpwsh "(Test-NetConnection -ComputerName localhost -Port $1 -WarningAction SilentlyContinue).TcpTestSucceeded" | tr -d '\r' | grep -qi true; then PORT_UP=1; break; fi
    sleep 10
  done
  if [ "$PORT_UP" = "1" ]; then
    case "$2" in
      electron-cdp) : ;;
      gateway) GATEWAY_PORT_READY=true ;;
      hostapi) HOSTAPI_PORT_READY=true ;;
    esac
    log "port $2($1): UP"
  elif [ "$2" = "electron-cdp" ]; then
    VM_RUN_RESULT="BLOCKED"
    log "BLOCKED: Electron CDP 9223 did not come up; ClawXApp task must launch with --remote-debugging-port=9223 for installed proof."
    exit 3
  else
    log "FAIL: port $2($1) not up after 300s"; exit 1
  fi
done

scp -P "$SSH_PORT" "$REPO_ROOT/windows-pilot/scripts/pilot-run-electron-cdp-probe.ps1" "$GUEST_USER@localhost:Downloads/" >/dev/null
scp -P "$SSH_PORT" "$REPO_ROOT/windows-pilot/scripts/pilot-electron-cdp-probe.js" "$GUEST_USER@localhost:Downloads/" >/dev/null
PROBE_ARTIFACT_DIR="$GUEST_DL\\clawx-electron-probe-$RUN_TAG"
run_guest_producer "Electron CDP safe-chat + read-only Outlook/Forms Host API probe" "electron-probe-run.txt" \
  guest "powershell -NoProfile -ExecutionPolicy Bypass -File \"$GUEST_DL\\pilot-run-electron-cdp-probe.ps1\" -SafeChat -SafeChatMode outlook-open -ArtifactDir \"$PROBE_ARTIFACT_DIR\""
if ! PROBE_SUMMARY_PATH=$(node - "$EVIDENCE_DIR/electron-probe-run.txt" <<'NODE'
const fs = require('node:fs');
const text = fs.readFileSync(process.argv[2], 'utf8');
const start = text.indexOf('{');
if (start < 0) process.exit(2);
const data = JSON.parse(text.slice(start));
if (typeof data.summaryPath !== 'string' || !data.summaryPath) process.exit(3);
console.log(data.summaryPath);
NODE
); then
  log "FAIL: could not parse Electron probe summaryPath from producer output"
  exit 1
fi
if ! printf '%s' "$PROBE_SUMMARY_PATH" | grep -Fq "clawx-electron-probe-$RUN_TAG"; then
  log "FAIL: Electron probe summaryPath did not point at the current run artifact dir"
  exit 1
fi
PROBE_JSON=$(printf '%s\n' "$PROBE_SUMMARY_PATH" | sed 's|.*[\\/]||')
case "$PROBE_JSON" in
  clawx-electron-probe-*.json) ;;
  *) log "FAIL: Electron probe summaryPath was not a successful probe JSON"; exit 1 ;;
esac
scp -P "$SSH_PORT" "$GUEST_USER@localhost:Downloads/clawx-electron-probe-$RUN_TAG/$PROBE_JSON" "$EVIDENCE_DIR/$PROBE_JSON" >/dev/null
record_evidence_file "$PROBE_JSON"

# ── Phase 7 — REAL desktop screenshots + VLM grading (owner directive) ──────
log "desktop capture (interactive session; ~2000px — Bedrock cap)"
scp -P "$SSH_PORT" "$REPO_ROOT/windows-pilot/scripts/pilot-desktop-screenshot.ps1" "$GUEST_USER@localhost:Downloads/" >/dev/null
SHOT="$GUEST_DL\\moe19-desktop-$RUN_TAG.png"
if guest "schtasks /create /f /tn ClawXShot /sc once /st 23:59 /it /tr \"powershell -NoProfile -ExecutionPolicy Bypass -File $GUEST_DL\\pilot-desktop-screenshot.ps1 -OutPath $SHOT\"" >/dev/null 2>&1 \
  && guest "schtasks /run /tn ClawXShot" >/dev/null 2>&1; then
  sleep 15
  if gpwsh "Test-Path '$SHOT'" | tr -d '\r' | grep -qi true; then
    scp -P "$SSH_PORT" "$GUEST_USER@localhost:Downloads/moe19-desktop-$RUN_TAG.png" "$EVIDENCE_DIR/"
    cat > "$EVIDENCE_DIR/vlm-shots.json" <<SHOTS
{ "shots": [ { "id": "post-install-desktop", "imagePath": "$EVIDENCE_DIR/moe19-desktop-$RUN_TAG.png", "check": "The Ministry of Education desktop app is visible on the Windows desktop as a stakeholder would see it: real app shell (sidebar + chat composer), NOT a setup wizard, NOT a blank/white window, no crash or error dialog anywhere on the desktop; the header/channel pill reads Online or On this device (never a raw model id); overall the machine looks like a working pilot laptop." } ] }
SHOTS
    node "$REPO_ROOT/scripts/clwx-vlm-grade-screens.mjs" --manifest "$EVIDENCE_DIR/vlm-shots.json" --report "$EVIDENCE_DIR/vlm-grading.md" || { log "FAIL: VLM desktop grading failed"; exit 1; }
  else
    log "BLOCKED: desktop shot did not appear — is an interactive (RDP) session logged in? Capture needs the interactive desktop."
    BLOCKED=1
  fi
else
  log "BLOCKED: interactive scheduled task could not be created/run (no logged-in session?) — open an RDP session and re-run."
  BLOCKED=1
fi

# ── Phase 8 — System.Speech WER row (CLWX-87) — fail-loud, unique output ────
if guest "powershell -NoProfile -c \"Test-Path '$GUEST_DL\\clawx-pilot\\windows-pilot\\scripts\\pilot-asr-wer.ps1'\"" | tr -d '\r' | grep -qi true; then
  TRANS="clwx87-sysspeech-$RUN_TAG.json"
  guest "powershell -NoProfile -ExecutionPolicy Bypass -File \"$GUEST_DL\\clawx-pilot\\windows-pilot\\scripts\\pilot-asr-wer.ps1\" -ManifestPath \"$GUEST_DL\\clawx-pilot\\eval\\fixtures\\clwx87-asr-manifest.json\" -OutPath \"$GUEST_DL\\$TRANS\"" | tee "$EVIDENCE_DIR/asr-wer-run.log" | grep -q "STATE: WER_TRANSCRIPTS_OK" || { log "FAIL: System.Speech transcript generation"; exit 1; }
  scp -P "$SSH_PORT" "$GUEST_USER@localhost:Downloads/$TRANS" "$EVIDENCE_DIR/" || { log "FAIL: transcript pull-back"; exit 1; }
  node "$REPO_ROOT/scripts/clwx87-wer-bench.mjs" --engine transcripts --file "$EVIDENCE_DIR/$TRANS" --report "$REPO_ROOT/docs/evidence/CLWX87_WER_2026-09-06.md" | tee "$EVIDENCE_DIR/asr-wer-grade.log" || { log "FAIL: WER grading"; exit 1; }
else
  log "BLOCKED: repo checkout not on guest ($GUEST_DL\\clawx-pilot) — the CLWX-87 System.Speech row needs windows-pilot/scripts + eval/fixtures there."
  BLOCKED=1
fi

# ── Phase 9 — interactive checklist for the in-app visual legs ──────────────
cat <<CHECKLIST | tee "$EVIDENCE_DIR/INTERACTIVE_CHECKLIST.md"
# moe.19 interactive verify checklist (scripted phases above must be green first)
Acceptance criteria source: docs/STAKEHOLDER_GAP_ANALYSIS_2026-09-06.md §4.
- [ ] K10 pdf: fresh session, attach a pdf, real summary, read_pdf toolCall, no workerSrc errors
- [ ] K13 dir1+dir2 degrade: anonymised notice; CLWX-104 bar — no stacked/stale banners, no raw "Connection error." incl. expanders
- [ ] CLWX-105 chip: induce an error turn, re-open the session — in-line chip on the error-stopped message; tense-neutral wording; NO chip+banner double-surface on the active turn
- [ ] K14 NSCC five prompts: GROUNDED answers citing the Code (pack presence proven scripted)
- [ ] K12 badge lifecycle; CLWX-99/100 cron wall-clock + clean bubble
- [ ] Trust sweep every frame: no model IDs / cost / raw HTTP
- [ ] CLWX-77 Windows lane: node scripts/harness-artifact.mjs --fast --node-bin <packaged node.exe> from the guest checkout
NOT closable here: K11 cloud path, in-app confirmed send (sandbox/manual), KR2 recording acceptance.
CHECKLIST

if [ "$BLOCKED" = "1" ]; then VM_RUN_RESULT="BLOCKED"; log "DONE WITH BLOCKS: scripted phases green EXCEPT the loudly-marked BLOCKED items above. Evidence: $EVIDENCE_DIR"; exit 3; fi
VM_RUN_RESULT="COMPLETE"
log "DONE: all scripted phases green. Evidence: $EVIDENCE_DIR — work the interactive checklist, then RESULT.md (moe.18 conventions)."
