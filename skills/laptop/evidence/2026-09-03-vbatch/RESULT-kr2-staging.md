# STAGE 3a — KR2 recording staging check (vbatch)

**Verdict: STAGED (with one noted precondition gap).** All agent-preparable recording
prerequisites exist on the VM. The assisted-GUI recording itself is an **owner leg**
(GA_FINISH_SPRINT item 13 "KR2 acceptance"); nothing was recorded in this stage.

- **Date:** 2026-09-03 04:11 UTC (VM clock)
- **Host:** GCP VM `clawx-win-rc-20260609` (us-central1-a), guest `clawxtest`, over the
  still-open IAP tunnel (sshd 22 -> localhost:12222; control leg localhost:19999 REFUSED
  at probe time — differential intact)
- **Raw log:** `vbatch3-kr2-staging.log` in this directory (probe script
  `vbatch3-kr2-staging.ps1`, read-only, scp'd + `-ExecutionPolicy Bypass -File`)

## FACTS — prerequisite table

| Prerequisite | Status | Evidence |
|---|---|---|
| L2 snapshot (fresh-state restore point) | **READY** — `clawx-l2-moe12-kr1pass-20260902`, 100 GB, created 2026-09-01T21:24:42-07:00, sourceDisk = this VM's disk | `gcloud compute snapshots describe` exit 0 |
| Console GUI session | **Active** — `clawxtest console 1 Active` (autologon armed: `AutoAdminLogon=1`, DefaultPassword present — value not printed) | log lines 5–6, 62 |
| Recording driver scripts on guest (`C:\Users\clawxtest\`) | **ALL PRESENT** — `clawx-recorded-usecase-driver.js` (9,316 B), `clawx-run-driver.ps1`, `clawx-run-interactive.ps1`, `clawx-foreground-app.ps1`, `clawx-launch-app-session1.ps1`, `setup-autologon.ps1`, `vbatch-degrade-driver.js`; plus `clawx-set-res.ps1` (resolution helper) | log lines 8–14, 22 |
| Recorder binary | **PRESENT** — bundled `resources\bin\ffmpeg.exe` (101,457,920 B), `gdigrab` device **SUPPORTED** (Recorder v2 window-title capture per `VIDEO_CAPTURE_OKR_2026-09-03.md` §8 is possible) | log lines 57–58 |
| Recording target live | app 0.4.3-moe.15 up (5 procs), Gateway :18789 / Host API :13210 / CDP :9223 all listening | log lines 64–67 |
| Fresh-install recording input | installers on guest in `Downloads\`: **moe.15** (390,104,940 B) + moe.12/13/14 | log lines 69–72 |

## Precondition gap (for the owner sitting — the one thing NOT staged)

- **Display resolution is 1024x768** (primary screen at probe time; prior recorded clip
  was 640x480). Recorder v2 / KR3 requires **>=1920x1080** with the app maximized.
  `2026-09-03-win-recorded-usecase/RESULT.md` records that `Set-DisplayResolution`
  could not raise the headless console res without a virtual-monitor driver. The owner
  sitting should either RDP in at >=1920x1080 (RDP sets the session resolution, and the
  tunnel lane already forwards RDP -> :13389) or accept window-title capture at the
  app-window's true pixel size with the window sized as large as the desktop allows.

## Notes

- No mutation: probe was read-only; one probe script added under `C:\Users\clawxtest\`.
- Prior clip `2026-09-03-win-recorded-usecase/usecase.mp4` is **REJECTED** evidence
  (failed frame verification) — the KR2 recording must be a fresh take through the
  Recorder v2 state machine (`VIDEO_CAPTURE_OKR_2026-09-03.md` §7) and, for the
  fresh-install variant, from a disk restored off the L2 snapshot named above.
- VM left RUNNING, tunnel left open, per batch instruction (conductor decides shutdown).
