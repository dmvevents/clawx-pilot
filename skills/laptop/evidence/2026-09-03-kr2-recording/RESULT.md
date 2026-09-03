# KR2 fresh-install RECORDING — moe.15 on the GCP Windows VM — 2026-09-03

**Verdict per leg:** fresh-state install → gateway ready → composer enabled: **PASS**,
recorded and frame-verified at 1920x1080. Green **on-device** turn:
**BLOCKED(on-device-cpu / tool-cascade)** — captured honestly, NOT faked, and the
channel was NOT switched to cloud to force a pass.

This run adds the RECORDING (and its frame verification) to the timed fresh-state
evidence in `docs/evidence/KR2_FRESH_INSTALL_RUN_2026-09-02.md`. It is a valid,
legible ≥1920x1080 capture of the app — unlike the REJECTED CLWX-57 clip (640x480,
never showed a sent/answered turn).

- **Date:** 2026-09-03 (UTC). VM clock in-frame: 9/3/2026 ~06:48–07:14.
- **Host:** GCP VM `clawx-win-rc-20260609` (us-central1-a, e2-standard-4, 4 vCPU,
  **no GPU**), guest `clawxtest`, console session 1 (autologon armed), over IAP
  (sshd 22 → localhost:12222; control leg localhost:19999 REFUSED — differential
  intact).
- **Build under test:** `Ministry of Education-0.4.3-moe.15-win-x64.exe`
  - installer sha256 `D10DE5809B6888A9DBD4A82FEA41D8DC20D8BD81193B306C68A163DFC6CE18DF`, 390,104,940 bytes
  - runtime UA `MinistryofEducation/0.4.3-moe.15`, Electron 40.8.4, Chrome 144
- **Channel that served the turn:** **on-device** — `ollama-ollamalo/qwen2.5:3b-instruct`
  via `http://127.0.0.1:11434/v1`. Proven from the app log (`Pinned every agent
  model.primary … desired=on-device, applied=on-device`) and the driver
  (`channelBefore = channelAfter = "on-device"`, `channelSwitched=false`).

---

## SAFETY (step 1)
- GCP disk snapshot **`clawx-pre-kr2-recording-20260903`** created from the VM's boot
  disk (`clawx-win-rc-20260609`, guest-flush), reached **READY** (100 GB) before any
  guest mutation. Every step below is reversible to this point.

## DISPLAY (step 2)
- Console was 1024x768 (then 640x480). `Set-DisplayResolution` alone cannot raise a
  headless console (staging gap). Fix: `gcloud compute instances update
  --enable-display-device` (VM stopped → updated → started). After reboot the console
  came up **natively at 1920x1080** (verified in session 1 via
  `Screen.PrimaryScreen.Bounds`). Recorder-v2 ≥1920x1080 precondition met.

## FRESH STATE (step 3)
- `%APPDATA%\Ministry of Education` and `%USERPROFILE%\.openclaw` **moved** to
  `C:\Users\clawxtest\state-backup-kr2rec-20260903\` (backup intact, verified).
- NSIS uninstaller ran silent (`/S /CURRENTUSER`, exit 0). Post-check: install dir,
  APPDATA state, and `.openclaw` all **GONE**. Genuinely fresh.

## OLLAMA (step 4)
- `VbatchOllamaServe` was Ready-but-not-serving after the reboot; restarted it.
  `/api/tags` → 200, `qwen2.5:3b-instruct` present (`capabilities:["completion","tools"]`).
- Pre-warmed the model (`/api/generate` keep_alive 45m → 200) so the recorded turn
  measures inference, not cold model load.

## RECORDING + ASSISTED INSTALL + TURN (step 5)
- Recorder: app-bundled-equivalent **`ffmpeg.exe`** (from repo
  `resources/bin/win32-x64/`, 101,457,920 B) via **gdigrab full desktop**, 15 fps,
  libx264, → `kr2-recording.mkv`, launched as an **interactive session-1 scheduled
  task** (never `-WindowStyle Hidden`). Pre-flight one-shot frame confirmed gdigrab
  grabs the real 1920x1080 desktop before committing.
- Assisted GUI install with **zero manual steps**: the `oneClick:false` NSIS UI was
  driven by a clicker task that activated the "Ministry of Education Setup" window and
  sent ENTER every 3 s (I Agree → Install → Finish). Extraction of `app-64.7z` to the
  Programs dir is the slow leg on this VM (~16 min wall).
- App launched **VISIBLE** with `--remote-debugging-port=9223` (interactive task).
  CDP + Gateway(:18789) + Host-API(:13210) up, 6 procs. Composer **ENABLED 10.2 s**
  after the driver attached (moe.13+ slow-ready fix holding).
- Fresh-install default channel came up **On this device** (moe.14 channel-clobber
  fix holding) — no switch needed, no switch made.
- One on-device chat turn driven: *"What are three things you can help a school
  principal with?"* Driver waited 300 s.

## STOP + PULL + FRAME-VERIFY (steps 6–7)
- Recording stopped (`Stop-Process`, safe against MKV), remuxed `-c copy` → MP4.
- `kr2-recording.mp4`: **1920x1080**, H.264, 15 fps, **~26 min** (1561 s), 35,699,249 B,
  sha256 `1ee2e2b91f917900f3924e8a8a03ab54db2bf9a9f09c82069107590ae9d93177`.

### Frame-verification verdict (extracted frames, inspected pixel-by-pixel)
Recording t0 ≈ 06:47:31Z; timeline events map to offsets below.

| Moment | Frame | What the pixels show | Verdict |
|---|---|---|---|
| Install (moe.15 extracting) | `key-01` (t≈750 s) | NSIS "Ministry of Education 0.4.3-moe.15" window, path field + extraction log (`app-64.7z`, output folder), Next/Cancel. Recorder cmd console sits top-left (does not cover the installer). | **App/installer visibly captured, 1920x1080, legible** |
| Gateway ready + composer, agent working | `key-02` (t≈1310 s, ~54 s into turn) | Full app window, unclipped, **no occluding console**. Sent user bubble; "Working / Thinking…"; composer "On this device" + Skills; bottom status **"gateway connected \| port: 18789 \| pid 6920"**. | **App-only, connected, legible, 1920x1080** |
| Turn outcome (honest) | `key-03` (t≈1558 s) | Tool-call cascade rendered — `principal.daily_report_payload`, `principal.suspension_payload` (fabricated "Bob Smith"), `principal.find_school {"query":"Oakwood Elementary"}` then `{"query":""}` — then red banner **"No response received from the model…"**. No final answer. | **App-only, legible; turn did NOT complete green** |

- **≥1920x1080:** YES (ffprobe 1920x1080). The CLWX-57 root cause (640x480, wrong
  window, never-answered) is fixed here.
- **App visibly captured:** YES at all three moments. The reply/turn frames are
  app-only (I minimized the recorder console before the turn).
- **"Disconnected" pill (top-right):** that is the external Chrome/Outlook **CDP**
  status (:18792) — expected on a VM with no Microsoft accounts. The **gateway** reads
  **connected** in the bottom status bar. Same nuance as prior VM runs.
- **Honesty note:** the recorder's own cmd console is visible in the install-phase
  frames (it is not over the installer). It is not present in the connected/turn
  frames. No fabricated "green" — the turn's real outcome (error banner, no answer) is
  what the frames show.

## WHY THE ON-DEVICE TURN DID NOT GO GREEN (root cause, from the app log)
- Session `agent:main:main` `state=processing` for **144 s → 269 s** ("stuck session"
  diagnostics). qwen2.5:3b tool-capable turns on this **4-vCPU, no-GPU** VM exceed
  practical windows — the documented KR2 finding (validated on-device turn evidence
  lives on the **laptop** lane, not this e2 VM).
- The 3B model went into a **tool-call cascade** on a plain question, repeatedly
  calling `principal.find_school` with `{"query":""}`:
  `[tools] principal.find_school failed: query is required` (x3).
- The **retry-breaker fired**: `[retry-breaker] principal.find_school failed 3x with
  identical args — breaking the loop`. This is the moe.15 fix for the moe.14
  ONDEVICE-RETRY-LOOP defect **working live** — but the model still never converged to
  a final text answer, so the UI surfaced "No response received from the model".
- Driver: `verdict=TIMED_OUT_MID_TURN`, `settled=false`, `answerText=""`,
  `runErrorSeen=false`, `degradeNoticeSeen=false`, 19 state samples all
  `still-thinking`.

## Fidelity nit (not a blocker)
- Composer model chip shows **`moe-demo-pro`** (cloud broker alias) while the channel
  toggle reads **On this device** and the **actually pinned/resolved** agent model is
  `ollama-ollamalo/qwen2.5:3b-instruct` (app log). The chip label is a stale display
  value, not the routing. Same class as the `moe-demo-pro`-visible observation in
  `2026-09-03-win-recorded-usecase/RESULT.md`. Worth a UX decision (hide/anonymise the
  model chip in principal builds).

---

## Artifacts (this directory)
- `kr2-recording.mp4` — 1920x1080 / 15 fps / ~26 min screen recording (sha above).
- `key-01-install-moe15-extracting.png`, `key-02-app-connected-working-ondevice.png`,
  `key-03-turn-toolcascade-and-error.png` — the three verified key frames (SHAs below).
- `frames/` — full extracted frame set (5s…1558s).
- `turn-evidence/` — driver JSON (`usecase-…json`), 19 `state-*-still-thinking.png`,
  `final-…png`.
- `install-clicker.log`, `app-launch.log`, `freshstate.log`, `driver.log`,
  `recording-ffmpeg.log`, `remux` output — process logs.
- `kr2-preflight.png`, `kr2-peek2.png` — one-shot gdigrab pre-flights.
- `timeline.log` — the wall-clock milestones.

Key-frame SHAs: `key-01` `d6ddc003…7027d63`, `key-02` `e931ae10…8afb3793`,
`key-03` `c2859ef5…4bd492`.

## Timeline (UTC)
| Event | Wall clock | Video offset |
|---|---|---|
| Recording start | 06:47:31 | 0 s |
| Assisted install start | 06:48:25 | ~54 s |
| App exe present (install done) | 07:04:39 | ~1028 s |
| App launched (visible, CDP) | 07:05:05 | ~1054 s |
| Gateway ready (port + composer 10.2 s later) | 07:06:53 | ~1162 s |
| Turn sent | 07:08:27 | ~1256 s |
| Turn timed out (300 s) | 07:13:47 | ~1576 s |
| Recording stopped | 07:14:20 | end (~1561 s) |

Install wall-time ≈ 16 min (extraction-bound on this VM); gateway-ready and
composer-enable are consistent with moe.13/14 (~50 s + ~10 s).

## STATE LEFT BEHIND (per instruction 8)
- VM **RUNNING**, fresh moe.15 install in place (profile `.openclaw/openclaw.json`
  created; APPDATA state fresh) — this is the moe.16 verify base.
- Pre-KR2 state backup intact at `C:\Users\clawxtest\state-backup-kr2rec-20260903\`.
- Safety snapshot `clawx-pre-kr2-recording-20260903` retained.
- Autologon left armed (console session persists for future GUI legs; disposable VM).
- Display device now **enabled** on the instance (1920x1080) — durable across reboots.

## Bottom line
Fresh-VM assisted GUI install (recorded, zero manual steps) boots the gateway and
enables the composer at 1920x1080 — **PASS**, frame-verified. The on-device green turn
is **BLOCKED** by the qwen2.5:3b tool-cascade / CPU-starvation on this GPU-less e2 VM,
not by the installer or the boot path. Anchor the green on-device turn to the laptop
lane (real persona hardware) or a GPU VM; this VM remains valid for install/boot/cloud
evidence. No sends, no submits, nothing faked.
