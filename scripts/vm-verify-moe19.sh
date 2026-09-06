#!/usr/bin/env bash
# vm-verify-moe19.sh — THE single command for the moe.19 Windows VM verify.
#
# Replicates the moe.18 full-matrix method (skills/laptop/evidence/
# 2026-09-03-moe18-verify/RESULT.md) for the moe.19 fix train, plus the
# post-moe.18 checks: CLWX-104 D0/D1/D2 (run-error dedup), CLWX-42 (NSCC
# pack PRESENT + grounded K14), CLWX-105 (in-line error chip), CLWX-99/100
# (cron tz + cosmetics), CLWX-87 (System.Speech WER row), send-gate subject
# fix (unit-verified; in-app send stays sandbox/manual).
#
# HARD RULES: never starts or stops the VM (owner spend call — exits 3 loud
# with the exact command); never publishes the release manifest; never
# touches the running Mac app. Guest launches are VISIBLE scheduled tasks,
# never -WindowStyle Hidden (atlas §16).
#
# Usage: bash scripts/vm-verify-moe19.sh
# Exit: 0 scripted phases green (interactive checklist printed for the
# in-app visual legs); 3 blocked (VM not RUNNING / artifact missing);
# 1 a scripted phase failed.
set -euo pipefail

VM="clawx-win-rc-20260609"
ZONE="us-central1-a"
PROJECT="gen-lang-client-0649986230"
SSH_PORT="${CLAWX_SSH_PORT:-12222}"
GUEST_USER="${CLAWX_VM_USER:-clawxtest}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXE="$REPO_ROOT/release/Ministry of Education-0.4.3-moe.19-win-x64.exe"
GCS_DEST="gs://clawx-rc-artifacts-622687731621/moe19/"
EVIDENCE_DIR="$REPO_ROOT/skills/laptop/evidence/$(date +%F)-moe19-verify"
GUEST_DL='C:\Users\'"$GUEST_USER"'\Downloads'

log() { printf '[vm-verify-moe19 %s] %s\n' "$(date +%H:%M:%S)" "$*"; }
guest() { ssh -o ConnectTimeout=10 -p "$SSH_PORT" "$GUEST_USER@localhost" "$@"; }

# ── Phase 0 — Mac-side artifact + hash + GCS (idempotent) ────────────────────
[ -f "$EXE" ] || { log "BLOCKED: installer not found: $EXE — run: PATH=\"\$HOME/.dotnet:\$PATH\" pnpm build:win"; exit 3; }
SHA=$(shasum -a 256 "$EXE" | awk '{print $1}')
BYTES=$(stat -f%z "$EXE")
log "artifact: $(basename "$EXE") bytes=$BYTES sha256=$SHA"
if ! gsutil ls "${GCS_DEST}$(basename "$EXE" | sed 's/ /%20/g')" >/dev/null 2>&1 \
  && ! gsutil ls "${GCS_DEST}" 2>/dev/null | grep -q "moe.19-win-x64.exe"; then
  log "uploading to $GCS_DEST (idempotent) ..."
  gsutil cp "$EXE" "$GCS_DEST"
fi
log "GCS: $(gsutil ls -l "${GCS_DEST}" 2>/dev/null | grep -c exe || true) exe object(s) present"

# ── Phase 1 — VM status gate (NEVER starts it) ──────────────────────────────
STATUS=$(gcloud compute instances list --project "$PROJECT" --filter="name=$VM" --format='value(status)' 2>/dev/null || true)
if [ "$STATUS" != "RUNNING" ]; then
  log "BLOCKED: VM $VM is '${STATUS:-unknown}'. Starting it is the OWNER's spend call:"
  log "  gcloud compute instances start $VM --zone $ZONE --project $PROJECT"
  log "Then re-run this one command."
  exit 3
fi
log "VM RUNNING"

# ── Phase 2 — tunnel (PF-3: control leg mandatory) ──────────────────────────
if ! nc -z -w3 localhost "$SSH_PORT" 2>/dev/null; then
  log "opening IAP sshd tunnel -> localhost:$SSH_PORT (background)"
  nohup gcloud compute start-iap-tunnel "$VM" 22 \
    --local-host-port="localhost:$SSH_PORT" --zone "$ZONE" --project "$PROJECT" \
    >/tmp/moe19-tunnel.log 2>&1 & disown
  for i in $(seq 1 20); do nc -z -w2 localhost "$SSH_PORT" 2>/dev/null && break; sleep 2; done
fi
# Control leg: a port that MUST fail — a listener that answers everything is a lie.
if nc -z -w2 localhost 9999 2>/dev/null; then log "FAIL: control leg port 9999 unexpectedly open"; exit 1; fi
guest 'echo GUEST_SSH_OK' | grep -q GUEST_SSH_OK || { log "FAIL: guest ssh banner"; exit 1; }
log "tunnel + guest ssh OK (control leg held)"

# ── Phase 3 — installer to guest + both-hop hash ────────────────────────────
if ! guest "powershell -NoProfile -c \"(Get-FileHash '$GUEST_DL\\moe19.exe' -ErrorAction SilentlyContinue).Hash\"" | grep -qi "$SHA"; then
  log "copying installer to guest (430MB over IAP — minutes) ..."
  scp -P "$SSH_PORT" "$EXE" "$GUEST_USER@localhost:Downloads/moe19.exe"
fi
GUEST_SHA=$(guest "powershell -NoProfile -c \"(Get-FileHash '$GUEST_DL\\moe19.exe').Hash\"" | tr -d '\r' | tr '[:upper:]' '[:lower:]')
[ "$GUEST_SHA" = "$SHA" ] || { log "FAIL: guest sha mismatch ($GUEST_SHA)"; exit 1; }
log "sha256 verified BOTH hops"

# ── Phase 4 — pre-state, silent install, visible relaunch, port probes ──────
mkdir -p "$EVIDENCE_DIR"
guest "powershell -NoProfile -c \"(Get-Item 'C:\\Users\\$GUEST_USER\\AppData\\Local\\Programs\\Ministry of Education\\Ministry of Education.exe' -ErrorAction SilentlyContinue).VersionInfo.FileVersion\"" | tr -d '\r' | tee "$EVIDENCE_DIR/pre-version.txt"
log "silent install /S /CURRENTUSER (state preserved by design) ..."
guest "cmd /c \"$GUEST_DL\\moe19.exe\" /S /CURRENTUSER" || true
sleep 20
POST_V=$(guest "powershell -NoProfile -c \"(Get-Item 'C:\\Users\\$GUEST_USER\\AppData\\Local\\Programs\\Ministry of Education\\Ministry of Education.exe').VersionInfo.FileVersion\"" | tr -d '\r')
echo "$POST_V" | tee "$EVIDENCE_DIR/post-version.txt"
echo "$POST_V" | grep -q "moe.19" || { log "FAIL: FileVersion after install = $POST_V"; exit 1; }
log "visible relaunch via scheduled task (never Hidden — atlas §16)"
guest "schtasks /run /tn ClawXApp" || guest "powershell -NoProfile -File \"$GUEST_DL\\clawx-e2e-runner\\pilot-launch-and-run-cdp-smoke.ps1\"" || true
sleep 45
for probe in "18789 gateway" "13210 hostapi"; do
  set -- $probe
  guest "powershell -NoProfile -c \"(Test-NetConnection -ComputerName localhost -Port $1 -WarningAction SilentlyContinue).TcpTestSucceeded\"" | tr -d '\r' | grep -qi true \
    && log "port $2($1): UP" || { log "FAIL: port $2($1) not up after relaunch"; exit 1; }
done

# ── Phase 5 — scripted fix-train probes (guest) ─────────────────────────────
log "NSCC pack present in installed tree (CLWX-42 — moe.18 probe expected NONE, moe.19 expects PRESENT)"
guest "powershell -NoProfile -c \"Get-ChildItem -Recurse 'C:\\Users\\$GUEST_USER\\AppData\\Local\\Programs\\Ministry of Education\\resources\\extensions' -Filter '*nscc*' | Select-Object -ExpandProperty FullName\"" | tr -d '\r' | tee "$EVIDENCE_DIR/nscc-probe.txt"
grep -qi "nscc-2026.txt" "$EVIDENCE_DIR/nscc-probe.txt" || { log "FAIL: nscc-2026.txt ABSENT from installed tree"; exit 1; }
log "System.Speech WER row (CLWX-87) — needs the repo scripts dir on guest"
if guest "powershell -NoProfile -c \"Test-Path '$GUEST_DL\\clawx-pilot\\windows-pilot\\scripts\\pilot-asr-wer.ps1'\"" | tr -d '\r' | grep -qi true; then
  guest "powershell -NoProfile -ExecutionPolicy Bypass -File \"$GUEST_DL\\clawx-pilot\\windows-pilot\\scripts\\pilot-asr-wer.ps1\" -ManifestPath \"$GUEST_DL\\clawx-pilot\\eval\\fixtures\\clwx87-asr-manifest.json\" -OutPath \"$GUEST_DL\\clwx87-sysspeech-transcripts.json\"" | tee "$EVIDENCE_DIR/asr-wer-run.log" || true
  scp -P "$SSH_PORT" "$GUEST_USER@localhost:Downloads/clwx87-sysspeech-transcripts.json" "$EVIDENCE_DIR/" 2>/dev/null \
    && node "$REPO_ROOT/scripts/clwx87-wer-bench.mjs" --engine transcripts --file "$EVIDENCE_DIR/clwx87-sysspeech-transcripts.json" --report "$REPO_ROOT/docs/evidence/CLWX87_WER_2026-09-06.md" | tee "$EVIDENCE_DIR/asr-wer-grade.log" || true
else
  log "SKIP (loud): repo checkout not on guest — clone/copy windows-pilot+eval to $GUEST_DL\\clawx-pilot for the WER row"
fi

# ── Phase 6 — interactive checklist (the in-app visual legs) ────────────────
cat <<CHECKLIST | tee "$EVIDENCE_DIR/INTERACTIVE_CHECKLIST.md"
# moe.19 interactive verify checklist (RDP session; the scripted phases above are green)
Authoritative acceptance criteria: docs/STAKEHOLDER_GAP_ANALYSIS_2026-09-06.md §4.
- [ ] K10 pdf: fresh session, drag/attach a pdf, real summary, read_pdf toolCall, no workerSrc errors
- [ ] K13 dir1+dir2 degrade: correct anonymised notice; CLWX-104 bar — NO stacked run-error banners, NO stale banner across new chats/restart, NO raw "Connection error." anywhere incl. expanders
- [ ] CLWX-105: after an induced error turn, re-open the session — the in-line error chip renders on the error-stopped message (anonymised line; raw only in collapsed expander)
- [ ] K14 NSCC five prompts: answers GROUNDED in the Code with NSCC citations (pack verified present above)
- [ ] K12 badge: kill gateway -> Reconnecting pill + disabled composer -> reconnected; no stale connected
- [ ] CLWX-99/100 cron: reminder fires at the PRINCIPAL's wall clock; no [cron:uuid] plumbing in the user bubble
- [ ] Trust sweep on every frame: no model IDs, no cost, no raw HTTP
- [ ] CLWX-77 Windows lane: from the guest repo checkout run: node scripts/harness-artifact.mjs --fast --node-bin <packaged node.exe>
NOT closable on this VM (owners noted): K11 cloud path, send-gate in-app send (sandbox/manual), KR2 assisted recording acceptance.
CHECKLIST
log "DONE: scripted phases green. Evidence: $EVIDENCE_DIR — work the interactive checklist over RDP, then write RESULT.md (moe.18 conventions)."
