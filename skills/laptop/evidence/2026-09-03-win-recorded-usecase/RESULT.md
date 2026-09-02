# Screen-recorded real use case — Ministry of Education app on the GCP Windows VM

**Verdict: PASS** — a real, in-app chat turn was driven and screen-recorded on the
installed app, on a genuine interactive console session, with the anti-stuck
15s state-polling in force.

- **Date:** 2026-09-02 (UTC; VM clock showed 9/2/2026 ~23:20)
- **Host:** GCP Windows VM `clawx-win-rc-20260609` (us-central1-a, e2-standard-4,
  4 vCPU, no GPU), over IAP TCP forwarding (sshd 22 -> localhost:12222), guest
  `clawxtest`.
- **Build under test:** installed `Ministry of Education` **0.4.3-moe.15**
  (UA `MinistryofEducation/0.4.3-moe.15`, Electron 40.8.4, Chrome 144).
- **Channel that served the turn:** **Online / cloud** — `custom-moecloud/moe-demo-pro`
  (the LiteLLM broker). `data-channel="online"` read directly off the composer
  toggle; no switch was needed (it was already Online).

---

## FACTS

### Session establishment (the blocker this run solved)
Previous VM runs had **no interactive session** (`quser` empty), so the Electron
GUI could not render and nothing was screen-recordable. This run established a
real console session:

1. `gcloud compute reset-windows-password clawx-win-rc-20260609 --zone us-central1-a --user clawxtest --quiet`
   minted a fresh password (captured to a `umask 077` temp file, never echoed to
   a log, deleted after use).
2. Uploaded a cred file + `setup-autologon.ps1`; the script wrote the Winlogon
   AutoAdminLogon keys **reading the password from the file** (so the value never
   hit a command line or an operator log), then deleted the cred file:
   - `HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon`
     `DefaultUserName=clawxtest`, `DefaultDomainName=<computer>`,
     `DefaultPassword=<set>`, `AutoAdminLogon=1`
   - `HKLM:\...\Policies\System` `DisableCAD=1`
3. Aborted the pending 8h auto-shutdown (`shutdown /a`) and rebooted
   (`shutdown /r`).
4. After reboot, `quser` showed **`clawxtest  console  1  Active`** — a real
   interactive session. Verified before proceeding.

### App + gateway readiness
- App launched **into session 1** (visible, recordable) via an **interactive
  scheduled task** (`Register-ScheduledTask` with
  `New-ScheduledTaskPrincipal -LogonType Interactive`). This is the session-1
  equivalent of the IF-4 rule "launch visible, never `-WindowStyle Hidden`" —
  launching from the SSH session (session 0) would render off the recordable
  desktop.
- CDP :9223 up, **Gateway :18789 up**, Host API :13210 up, 5-6 Electron procs.
- IF-5 honored: driver waited for the **composer ENABLED** (not just port bound).
  Composer was enabled **239 ms** after the driver attached (gateway was already
  warm from an earlier launch; cold-boot ready-fallback loop had resolved at
  23:15:28 — see log tail).

### The recorded use case
- Prompt typed into the chat composer:
  *"Draft a short letter to parents about the Term 1 parent-teacher meeting on Friday"*
- **Verdict `ANSWERED`, `settled=true`**, no degrade notice, no run-error banner.
- Assistant reply (genuine cloud persona turn, not canned):
  *"Of course. To make sure the letter has all the necessary details, could you
  please provide the date and time for the meeting this Friday?"*
  The persona correctly engaged the drafting task and asked for the missing
  detail before writing — a real principal-assistant interaction.
- **Turn timing:** send -> assistant message present after the 51s state sample;
  driver confirmed a stable, non-placeholder answer by ~66s wall-clock
  (startedAt 23:19:42.98Z, finishedAt 23:20:48.59Z). Faster than the ~103s VM
  cloud-turn median in `LATENCY_BASELINE_2026-09-02.md`.

### Anti-stuck 15s state polling (owner directive)
The driver captured a server-side screenshot every 15s and classified each:
`state-01..04` all `still-thinking`; the turn then settled to a rendered reply.
No `ERROR-BANNER` occurred, so no early abort fired — but the abort path is
implemented and would have written the banner screenshot and exited immediately
(`verdict=ABORTED_ERROR_BANNER`) rather than waiting out the 240s timeout.

### Screen recording
- Captured with the **app-bundled `resources\bin\ffmpeg.exe`** via `gdigrab`
  (`-i desktop`), running as an interactive scheduled task in session 1 so it
  grabbed the real console desktop (proven first with a one-shot frame showing
  the live desktop + taskbar).
- Recorded to **MKV** (survives an ungraceful stop, unlike MP4's trailing moov),
  then remuxed `-c copy` to MP4.
- `usecase.mp4`: **785,604 bytes**, **Duration 00:00:52.20**, H.264
  (Constrained Baseline). Verified locally as `ISO Media, MP4 Base Media v1`.

### Redaction
No keys, key values, passwords, email bodies, or recipients are in any saved
artifact. The app log line for the gateway shows `--token [redacted]` (the app
self-redacts) and `providerKeys=1` (a count). JSON and screenshots contain only
the public prompt + the assistant's clarifying question.

---

## Artifacts (in this directory)
- `usecase.mp4` — 52.2s screen recording of the desktop during the turn (640x480).
- `usecase-2026-09-02T23-19-42-963Z.json` — driver result (verdict, channel,
  timings, state samples).
- `final-2026-09-02T23-19-42-963Z.png` — final CDP screenshot: reply rendered,
  "Online" toggle, gateway "connected | port: 18789 | pid: 7708".
- `state-01..04-still-thinking.png` — the 15s anti-stuck state samples.
- `app-log-tail.txt` — newest app log tail (gateway ready-fallback recovery).

---

## ANALYSIS
- The **only** thing that had blocked recorded GUI evidence on this VM was the
  missing interactive session. AutoAdminLogon closes it deterministically and
  survives reboots, so future GUI legs (assisted-install recording, managed-CDP
  visual smoke, on-device turn attempts) no longer need a human at a screen for
  the *session*, only for genuinely interactive steps.
- Launching **both** the app and ffmpeg via interactive scheduled tasks
  (`LogonType Interactive`) is the reliable way to place a process on the
  session-1 desktop from an SSH (session-0) context. A one-shot gdigrab frame is
  a cheap pre-flight that proves the capture surface is the real desktop before
  committing to a full recording.
- Recording to MKV then remuxing to MP4 removes the "how do I send `q` to a
  headless ffmpeg" problem entirely: `Stop-Process` is safe against MKV.
- The turn ran Online because the persisted `~/.openclaw/openclaw.json` default
  model is `custom-moecloud/moe-demo-pro`. On-device (`qwen2.5:3b`) turns are
  known not to complete on this CPU-only e2 VM (KR2 evidence); Online was the
  correct choice and the driver confirmed the composer was already Online.

## OPEN QUESTIONS / NOTES
- **AutoAdminLogon is left ARMED** (plaintext `DefaultPassword` in the registry)
  so the console session persists across reboots for continued GUI work — the
  task explicitly allowed this on this disposable VM. **To DISARM** (run in
  session 1 or over SSH):
  ```powershell
  $k="HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon"
  Set-ItemProperty $k -Name AutoAdminLogon -Value "0"
  Remove-ItemProperty $k -Name DefaultPassword -ErrorAction SilentlyContinue
  ```
  Disarming means the next reboot will NOT auto-create a console session (back to
  the original blocker). The minted password can also be invalidated by another
  `reset-windows-password` or by disabling the `clawxtest` account.
- **Model-alias visibility (fidelity nit):** the composer's model selector shows
  the raw broker alias **`moe-demo-pro`** next to the anonymised "Online" toggle.
  The hard rule anonymises *vendor* model IDs to "Online"/"On this device";
  `moe-demo-pro` is an internal broker alias, not a vendor id, but it is still a
  raw identifier surfaced in a chat-facing control. Worth a UX decision on
  whether the model dropdown should be hidden in principal builds. (Observation,
  not a blocker.)
- The top-right **"Disconnected"** pill is the external Chrome (Outlook/Forms
  CDP :18792) status — expected on the VM, which has no Microsoft accounts. The
  **gateway** shows connected on 18789 (bottom status bar).
- Desktop resolution on the headless console is capped at **640x480**
  (`Set-DisplayResolution` cannot raise it without a virtual-monitor driver), so
  the MP4 is 640x480. The crisp UI evidence is the CDP screenshots (renderer
  viewport), which are unaffected by the desktop resolution.
- **VM left RUNNING** per the task (owner decides shutdown). ~$0.13/hr while
  RUNNING; `windows-pilot/vm-testing/gcp-iap-lane.sh stop` to halt (disk
  retained). Note the June startup script re-arms an 8h auto-shutdown on boot.

---

## Re-run steps
```bash
# 1. VM + tunnel (control-leg discipline: 9999 must FAIL, 22 must PASS)
gcloud compute instances describe clawx-win-rc-20260609 --zone us-central1-a --format='value(status)'   # expect RUNNING
nohup gcloud compute start-iap-tunnel clawx-win-rc-20260609 22 --local-host-port=localhost:12222 --zone us-central1-a >/tmp/iap22.log 2>&1 & disown
# 2. If quser is empty, establish a session (see FACTS step 1-4); else skip.
# 3. Launch app into session 1, wait for composer:
scp -P 12222 /tmp/clawx-launch-app-session1.ps1 clawxtest@localhost:'C:\Users\clawxtest\'
ssh -p 12222 clawxtest@localhost 'powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\clawxtest\clawx-launch-app-session1.ps1'
# 4. Start ffmpeg (session-1 interactive task) -> capture.mkv, foreground app, run driver, stop ffmpeg, remux.
#    Helper scripts: clawx-run-interactive.ps1, clawx-foreground-app.ps1,
#    clawx-recorded-usecase-driver.js, clawx-run-driver.ps1  (all in /tmp this session; also on the guest under C:\Users\clawxtest\).
```
