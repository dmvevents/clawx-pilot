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
GUEST_USER="${CLAWX_VM_USER:-clawxtest}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXE="$REPO_ROOT/release/Ministry of Education-0.4.3-moe.19-win-x64.exe"
GCS_DEST="gs://clawx-rc-artifacts-622687731621/moe19/"
RUN_TAG="$(date +%Y%m%d-%H%M%S)"
EVIDENCE_DIR="$REPO_ROOT/skills/laptop/evidence/$(date +%F)-moe19-verify"
GUEST_DL='C:\Users\'"$GUEST_USER"'\Downloads'
GUEST_APP='C:\Users\'"$GUEST_USER"'\AppData\Local\Programs\Ministry of Education'
BLOCKED=0

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

# ── Phase 0 — Mac-side artifact + hash + GCS (idempotent) ────────────────────
[ -f "$EXE" ] || { log "BLOCKED: installer not found: $EXE"; exit 3; }
SHA=$(shasum -a 256 "$EXE" | awk '{print $1}')
log "artifact: $(basename "$EXE") bytes=$(stat -f%z "$EXE") sha256=$SHA"
if ! gsutil ls "${GCS_DEST}" 2>/dev/null | grep -q "moe.19-win-x64.exe"; then
  log "uploading to $GCS_DEST ..."
  gsutil cp "$EXE" "$GCS_DEST"
fi

# ── Phase 1 — VM status gate (NEVER starts it) ──────────────────────────────
STATUS=$(gcloud compute instances list --project "$PROJECT" --filter="name=$VM" --format='value(status)' 2>/dev/null || true)
if [ "$STATUS" != "RUNNING" ]; then
  log "BLOCKED: VM $VM is '${STATUS:-unknown}'. Owner spend call:"
  log "  gcloud compute instances start $VM --zone $ZONE --project $PROJECT"
  exit 3
fi
log "VM RUNNING"

# ── Phase 2 — tunnel (PF-3 control leg mandatory) ───────────────────────────
if ! nc -z -w3 localhost "$SSH_PORT" 2>/dev/null; then
  log "opening IAP sshd tunnel -> localhost:$SSH_PORT"
  nohup gcloud compute start-iap-tunnel "$VM" 22 \
    --local-host-port="localhost:$SSH_PORT" --zone "$ZONE" --project "$PROJECT" \
    >/tmp/moe19-tunnel.log 2>&1 & disown
  for i in $(seq 1 20); do nc -z -w2 localhost "$SSH_PORT" 2>/dev/null && break; sleep 2; done
fi
if nc -z -w2 localhost 9999 2>/dev/null; then log "FAIL: control-leg port 9999 unexpectedly open"; exit 1; fi
guest 'echo GUEST_SSH_OK' | grep -q GUEST_SSH_OK || { log "FAIL: guest ssh"; exit 1; }
log "tunnel + guest ssh OK (control leg held)"

# ── Phase 3 — installer to guest + both-hop hash ────────────────────────────
if ! gpwsh "(Get-FileHash '$GUEST_DL\\moe19.exe' -ErrorAction SilentlyContinue).Hash" | tr -d '\r' | grep -qi "$SHA"; then
  log "copying installer to guest (430MB over IAP — minutes) ..."
  scp -P "$SSH_PORT" "$EXE" "$GUEST_USER@localhost:Downloads/moe19.exe"
fi
GUEST_SHA=$(gpwsh "(Get-FileHash '$GUEST_DL\\moe19.exe').Hash" | tr -d '\r' | tr '[:upper:]' '[:lower:]')
[ "$GUEST_SHA" = "$SHA" ] || { log "FAIL: guest sha mismatch ($GUEST_SHA)"; exit 1; }
log "sha256 verified BOTH hops"

# ── Phase 4 — stop app, ENFORCED install, fresh launch, RUNNING-binary attest ─
gpwsh "(Get-Item '$GUEST_APP\\Ministry of Education.exe' -ErrorAction SilentlyContinue).VersionInfo.FileVersion" | tr -d '\r' | tee "$EVIDENCE_DIR/pre-version.txt" || true
log "stopping app + gateway processes for a genuinely fresh install/launch"
gpwsh 'Get-Process | Where-Object { $_.ProcessName -match "Ministry|openclaw" } | Stop-Process -Force -ErrorAction SilentlyContinue; "stopped"' | tr -d '\r'
sleep 5
log "silent install /S /CURRENTUSER — exit code ENFORCED (Codex HIGH)"
INSTALL_EXIT=$(gpwsh '$p = Start-Process -FilePath "C:\Users\'"$GUEST_USER"'\Downloads\moe19.exe" -ArgumentList "/S","/CURRENTUSER" -Wait -PassThru; $p.ExitCode' | tr -d '\r' | tail -1)
[ "$INSTALL_EXIT" = "0" ] || { log "FAIL: installer exit=$INSTALL_EXIT"; exit 1; }
log "installer exit 0"
gpwsh "(Get-Item '$GUEST_APP\\Ministry of Education.exe').VersionInfo.FileVersion" | tr -d '\r' | tee "$EVIDENCE_DIR/post-version.txt" | grep -q "moe.19" || { log "FAIL: on-disk FileVersion not moe.19"; exit 1; }

log "visible relaunch (scheduled task; never Hidden)"
guest "schtasks /run /tn ClawXApp" || { log "FAIL: ClawXApp scheduled task could not run (create it per WINDOWS_INSTALL_RUNBOOK)"; exit 1; }
# Gateway boot takes minutes on the CPU-bound VM (moe.18 measured 51s+ on
# fresh state; live failure 2026-09-06 at a fixed 45s): retry loop, not a
# fixed sleep.
# Attest the RUNNING process binary, not the disk label (Codex HIGH).
RUN_ATTEST=$(gpwsh '$p = Get-Process "Ministry of Education" -ErrorAction SilentlyContinue | Select-Object -First 1; if ($p) { (Get-Item $p.Path).VersionInfo.FileVersion + "|" + $p.Path } else { "NOT_RUNNING" }' | tr -d '\r' | tail -1)
echo "$RUN_ATTEST" | tee "$EVIDENCE_DIR/running-binary-attest.txt"
echo "$RUN_ATTEST" | grep -q "moe.19" || { log "FAIL: running binary attest = $RUN_ATTEST"; exit 1; }
for probe in "18789 gateway" "13210 hostapi"; do
  set -- $probe
  PORT_UP=0
  for i in $(seq 1 24); do
    if gpwsh "(Test-NetConnection -ComputerName localhost -Port $1 -WarningAction SilentlyContinue).TcpTestSucceeded" | tr -d '\r' | grep -qi true; then PORT_UP=1; break; fi
    sleep 10
  done
  [ "$PORT_UP" = "1" ] && log "port $2($1): UP" || { log "FAIL: port $2($1) not up after 240s"; exit 1; }
done

# ── Phase 5 — install completeness: artifacts + NO excluded packages ────────
log "install-artifact evidence (pilot-check-install-artifacts.ps1)"
scp -P "$SSH_PORT" "$REPO_ROOT/skills/laptop/scripts/pilot-check-install-artifacts.ps1" "$GUEST_USER@localhost:Downloads/" >/dev/null
guest "powershell -NoProfile -ExecutionPolicy Bypass -File \"$GUEST_DL\\pilot-check-install-artifacts.ps1\"" | tr -d '\r' | tee "$EVIDENCE_DIR/install-artifacts.txt"
log "no-excluded-packages proof: every EXTRA_BUNDLED_PACKAGES entry present in the installed bundle"
PKGS=$(node -e "const s=require('fs').readFileSync('$REPO_ROOT/scripts/verify-openclaw-bundle.mjs','utf8');const m=s.match(/EXTRA_BUNDLED_PACKAGES\s*=\s*\[([^\]]*)\]/s);if(!m)process.exit(1);console.log([...m[1].matchAll(/'([^']+)'/g)].map(x=>x[1]).join(' '))")
MISSING=""
for pkg in $PKGS; do
  gpwsh "Test-Path '$GUEST_APP\\resources\\openclaw\\node_modules\\$(echo "$pkg" | sed 's|/|\\\\|g')'" | tr -d '\r' | grep -qi true || MISSING="$MISSING $pkg"
done
if [ -n "$MISSING" ]; then log "FAIL: excluded/missing bundled packages:$MISSING"; exit 1; fi
log "bundled packages all present ($(echo "$PKGS" | wc -w | tr -d ' ') checked)"
log "NSCC pack present (CLWX-42 — moe.18 probed NONE, moe.19 must be PRESENT)"
gpwsh "Test-Path '$GUEST_APP\\resources\\extensions\\moe-principal-assistant\\data\\nscc-2026.txt'" | tr -d '\r' | grep -qi true || { log "FAIL: nscc-2026.txt ABSENT"; exit 1; }

# ── Phase 6 — REAL desktop screenshots + VLM grading (owner directive) ──────
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

# ── Phase 7 — System.Speech WER row (CLWX-87) — fail-loud, unique output ────
if guest "powershell -NoProfile -c \"Test-Path '$GUEST_DL\\clawx-pilot\\windows-pilot\\scripts\\pilot-asr-wer.ps1'\"" | tr -d '\r' | grep -qi true; then
  TRANS="clwx87-sysspeech-$RUN_TAG.json"
  guest "powershell -NoProfile -ExecutionPolicy Bypass -File \"$GUEST_DL\\clawx-pilot\\windows-pilot\\scripts\\pilot-asr-wer.ps1\" -ManifestPath \"$GUEST_DL\\clawx-pilot\\eval\\fixtures\\clwx87-asr-manifest.json\" -OutPath \"$GUEST_DL\\$TRANS\"" | tee "$EVIDENCE_DIR/asr-wer-run.log" | grep -q "STATE: WER_TRANSCRIPTS_OK" || { log "FAIL: System.Speech transcript generation"; exit 1; }
  scp -P "$SSH_PORT" "$GUEST_USER@localhost:Downloads/$TRANS" "$EVIDENCE_DIR/" || { log "FAIL: transcript pull-back"; exit 1; }
  node "$REPO_ROOT/scripts/clwx87-wer-bench.mjs" --engine transcripts --file "$EVIDENCE_DIR/$TRANS" --report "$REPO_ROOT/docs/evidence/CLWX87_WER_2026-09-06.md" | tee "$EVIDENCE_DIR/asr-wer-grade.log" || { log "FAIL: WER grading"; exit 1; }
else
  log "BLOCKED: repo checkout not on guest ($GUEST_DL\\clawx-pilot) — the CLWX-87 System.Speech row needs windows-pilot/scripts + eval/fixtures there."
  BLOCKED=1
fi

# ── Phase 8 — interactive checklist for the in-app visual legs ──────────────
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

if [ "$BLOCKED" = "1" ]; then log "DONE WITH BLOCKS: scripted phases green EXCEPT the loudly-marked BLOCKED items above. Evidence: $EVIDENCE_DIR"; exit 3; fi
log "DONE: all scripted phases green. Evidence: $EVIDENCE_DIR — work the interactive checklist, then RESULT.md (moe.18 conventions)."
