# V-batch synthesis — 2026-09-03 (GA finish sprint item 11)

One VM window on GCP `clawx-win-rc-20260609` (us-central1-a, IAP sshd 22 ->
localhost:12222, control leg :9999/:19999 REFUSED — differential verified), guest
`clawxtest`, installed build **0.4.3-moe.15** (per-user), console session 1 Active,
app up with Gateway :18789 / Host API :13210 / CDP :9223 throughout. No sends, no
submits, no Forms/Outlook actions in any stage.

## Surface → status → evidence

| Stage | Surface | Status | Key fact | Evidence (this dir) |
|---|---|---|---|---|
| 1 | Tunnel + moe.15 install-tree + pdf-parse verdict | **DONE (defect pinned)** | pdf-parse 2.4.5 IS on disk; real defect = `@napi-rs/canvas-win32-x64-msvc` native binding missing from bundle -> `DOMMatrix is not defined`; `loadDep()` catch-all masks it as "module not found" | `RESULT-probe.md` (+ `vbatch-probe-out.log`, `vbatch-repro-out.log`, `vbatch-canvas-out.log`) |
| 2a | Gap C — Windows ASR smoke (W8) | **PASS** | `STATE: ASR_SMOKE_OK` first run; bundled WinSpeechRecognize + ffmpeg transcode; transcript verbatim match | `RESULT-asr.md` (+ `vbatch2-asr-out.log`) |
| 2b | Gap D — cron/agentTurn live fire (W5) | **PASS** | `FIRED_OK`; job fired +21 ms of schedule, real cloud agentTurn produced the daily-report reminder; `delivered=false / not-requested`; job deleted after | `RESULT-cron.md` (+ `vbatch2-cron-*.log`) |
| 2c | W10 — cloud->on-device degrade under cloud-unreachable | **FAIL (root cause pinned)** | Error visible ("Model call failed Connection error.") but NO failover despite warm ollama/qwen2.5:3b; `classifyFailure` = `other` because `/connection error/i` missing from `UNREACHABLE_PATTERNS` in `src/lib/channel-degrade.ts`; hosts file restored + verified | `RESULT-degrade.md` (+ `vbatch2-hosts-*.log`, `vbatch2-ollama-*.log`, `degrade-artifacts/`) |
| 2d | Gap b2 — live in-app `document.write_docx` turn (W6 Windows leg) | **PASS** | One real chat turn wrote + read back `vbatch-b2.docx` (8,620 B); proven at UI, disk (mammoth read-back exact), and session-transcript toolCall layers; doubles as post-2c cloud-recovery control | `RESULT-b2.md` (+ `vbatch2-b2-*.log`, `b2-artifacts/`) |
| 3a | KR2 recording staging (assisted-GUI recording = owner leg) | **STAGED** (one precondition gap) | Driver scripts ALL present on guest; ffmpeg gdigrab SUPPORTED; console session Active (autologon armed); moe.15 installer in `Downloads\`; L2 snapshot `clawx-l2-moe12-kr1pass-20260902` READY in GCP. Gap: display is 1024x768 vs Recorder v2 >=1920x1080 — owner sitting should RDP at full res (tunnel lane forwards RDP :13389) | `RESULT-kr2-staging.md` (+ `vbatch3-kr2-staging.log`) |

## Defects surfaced by this batch (for the conductor / defect registrar)

1. **Packaging:** `@napi-rs/canvas-win32-x64-msvc` (optionalDependency native binding)
   dropped from the gateway bundle -> `read_pdf` dead on Windows despite pdf-parse
   present. Plus `loadDep()` (extensions/moe-principal-assistant/doc-tools.mjs:118-129)
   masks load-time throws as "not found" — error is untruthful.
2. **Degrade classifier:** `UNREACHABLE_PATTERNS` in `src/lib/channel-degrade.ts` does
   not match "Connection error." (the openai-SDK APIConnectionError string this stack
   emits on Windows TCP-refuse) -> fail-closed, no on-device failover. Fix direction:
   add `/connection error/i` ordered after NEVER_DEGRADE.

## Residual state on guest (intentional, documented)

- `vbatch-b2.docx` in `media\outbound` (evidence); cron run log jsonl (historical).
- Ollama RUNNING (scheduled task `VbatchOllamaServe`); hosts file RESTORED (backup at
  `C:\Users\clawxtest\hosts.vbatch-backup`); AutoAdminLogon ARMED (disarm recipe in
  `2026-09-03-win-recorded-usecase/RESULT.md`).
- vbatch probe/driver scripts under `C:\Users\clawxtest\`.
- **VM left RUNNING, IAP tunnel left open** — per batch instruction; conductor decides
  shutdown (`windows-pilot/vm-testing/gcp-iap-lane.sh stop`; June startup script
  re-arms an 8h auto-shutdown on boot).
