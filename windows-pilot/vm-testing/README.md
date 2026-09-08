# Windows testing: access, environment and visible outcomes

Start with [the project contract](../../docs/PROJECT_CONTRACT.md), [completion plan](../../docs/COMPLETION_PLAN.md) and [current Windows candidate](../../docs/CURRENT_WINDOWS_RC.md). This is the current testing entrypoint. EC2 and sandbox bootstrap files in this folder are historical alternatives, not prerequisites for the GCP lane.

For a local hypervisor guest on the Mac, use the [local Windows VM runbook](../../docs/testing/WINDOWS_LOCAL_VM_TESTING.md) and `windows-local-vm-testing` skill. September 8 discovery found UTM/QEMU tooling but no usable registered Windows guest; the verified installed test lane below remains the GCP VM.

## How this test environment was established

The Windows machine runs on GCP; the Mac provides the local checkout, authenticated SSH/IAP control and RDP client. A local hypervisor VM was not created for these September tests. Compute metadata records the existing guest's creation as **2026-06-09T16:52:00.210Z**. The [August access report](../../skills/laptop/evidence/2026-08-19-gcp-iap-windows-lane/REPORT.md) documents rediscovering and starting that existing machine, establishing IAP access and retiring the inaccessible EC2 alternative. It does not contain a verified original instance-creation command; do not invent one as execution history.

| Layer | Verified setup / role |
|---|---|
| Cloud guest | `clawx-win-rc-20260609`, `gen-lang-client-0649986230`, `us-central1-a`; Server 2022 build 20348, `e2-standard-4`, 4 vCPUs, 16 GiB RAM, 100 GB persistent boot disk |
| Local operator | macOS repository checkout; Google Cloud CLI for IAP; OpenSSH/SCP for bounded commands/files; FreeRDP for the actual Windows desktop |
| Current controller tunnels, September 8 | Local SSH `35222` → guest `22`; local RDP `35389` → guest `3389`. These are run-specific overrides, not a replacement for the script defaults below |
| Established account | `clawxtest`; persistent Windows development workspace and previous administrator-profile acceptance |
| Standard-user account | `ClawXFresh0908`; created for September 8 first-run testing, normal user/RDP membership; its later moe.23/moe.24 installs are **upgrades of that profile**, not new clean profiles |
| Guest development tools | Portable Git, Node and pinned pnpm plus dependency cache under `C:\Users\clawxtest\ClawXDev`; [setup/build evidence](../../docs/evidence/WINDOWS_VM_DEVELOPMENT_2026-09-07.md) |
| Installed app runtime | `resources\bin\node.exe`, OpenClaw, native document helpers, FFmpeg and recognizer from the identified installer. Operator development tools do not establish that the product needs developer installations |
| Account setup | Private Online provisioning bundle is applied through its actual CMD entrypoint as the standard user. Microsoft sign-in in user Chrome is a separate step; MCP availability does not sign the principal into Outlook |

The reproducible September setup sequence was: verify IAP with protocol/control checks; authenticate to the existing guest; prepare the persistent development checkout; create the standard user and interactive RDP session; bind the installer/source hashes; install through normal screens; run private Online setup; launch the desktop shortcut; collect application and terminal-state evidence. Existing-profile upgrades first preserve both app data and `.openclaw`, with file counts and hashes verified. Credentials, login bundles and signed download URLs remain outside git.

There is one VM and one active root controller for app/Gateway/browser changes. Multiple terminal or RDP connections are not separate compute instances. A pending resize proposal was not executed. Preserve the current lifecycle hold and egress configuration.

[CLWX-125 investigation](../../docs/evidence/WINDOWS_FIRST_RESPONSE_RCA_2026-09-08.md) contains the application flow map, historical working/failing comparisons, hypotheses, exact timing boundaries and first-response test criteria. Its diagnostic CPU instrumentation changes a backed-up runtime entry under an environment guard; it must be restored and hash-checked before release acceptance.

## Access to the existing GCP VM

Target: `clawx-win-rc-20260609`, project `gen-lang-client-0649986230`, zone `us-central1-a`. The VM is Windows Server 2022 Datacenter, four virtual CPUs and approximately 16 GiB RAM. Its disk and user profiles persist across stops.

```sh
export CLAWX_GCP_PROJECT=gen-lang-client-0649986230
windows-pilot/vm-testing/gcp-iap-lane.sh probe
# Start the existing test VM when authorized testing requires it:
windows-pilot/vm-testing/gcp-iap-lane.sh start
windows-pilot/vm-testing/gcp-iap-lane.sh tunnel
```

Default tunnels expose RDP at `localhost:13389` and SSH at `localhost:12222`. The probe creates temporary tunnels, so use free override ports when working tunnels already exist:

```sh
CLAWX_RDP_PORT=25289 CLAWX_SSH_PORT=25222 CLAWX_CONTROL_PORT=25299 CLAWX_IAP_READY_TIMEOUT_SECONDS=45 windows-pilot/vm-testing/gcp-iap-lane.sh probe
ssh -o BatchMode=yes -o ConnectTimeout=15 -p 12222 clawxtest@localhost 'echo CLAWX_VM_ACCESS_OK'
```

An authenticated SSH marker proves guest command access. The probe separately requires an RDP protocol response, an SSH banner, and the IAP backend rejection for guest port `9999`. A local listening socket alone proves neither guest reachability nor login. Occupied selected ports, failed authentication/status queries, a stopped VM or an unproven control cause non-success. Select free local ports instead of killing unrelated tunnels.

Interactive GCP reauthentication requires the account holder's `gcloud auth login`. After authentication, recheck actual VM status. Keep the VM's egress configuration intact: IAP forwards inbound connections and does not supply outbound Internet access. VM shutdown remains subject to the current recorded owner hold; the script's `stop` command is not automatic authorization.

## What this environment can prove

| Acceptance environment | Required evidence | Limits |
|---|---|---|
| Existing Server 2022 VM | Exact installer/app hashes, environment snapshot, installed runtime and app journey | Report reused state, administrator membership, server graphics/audio and cloud network |
| Fresh Windows 10/11 principal profile | Standard-user normal installer screens, desktop shortcut, first-run journey without developer dependencies | Server VM smoke cannot establish this result |
| Existing-profile upgrade | State backup, controlled upgrade, preserved settings/history and successful next turn | An upgrade is not a clean-install test |
| Physical audio and Microsoft account | Real microphone workflow and signed-in user Chrome/tenant checks | Bundled helper presence or a VM audio fixture does not prove microphone quality or sign-in |

Identify Server-instance and laptop deployment coverage separately. `COLLECTED`, bridge readiness, file creation and `CAPTURE_ONLY_VERIFIED` are narrower than a successful user journey.

## Capture environment before changing it

Copy canonical scripts from `windows-pilot/scripts/` into the test user's Downloads directory. Run the existing environment probe with a unique JSON destination:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\pilot-fresh-install-environment.ps1 -Mode Probe -JsonOutputPath "$env:USERPROFILE\Downloads\<run-id>\environment.json"
```

It records OS/build, CPU/RAM/disk, graphics/audio presence, token elevation and administrator membership, prior app/OpenClaw/Chrome state, installed app hash, ports, Chrome version and seed presence. It never exports seed contents, keys, account names, message bodies or Chrome command lines. Display metadata belongs to the **calling session**. SSH Session 0 can report 1024×768 while the actual interactive session is 1920×1080; collect another snapshot there and inspect a real desktop screenshot before claiming visual coverage. An active session alone does not prove an unlocked visible app.

Back up both `%APPDATA%\Ministry of Education` and `%USERPROFILE%\.openclaw` before installation, restart or configuration repair. Record copy success and inventory counts. An absent state directory is an observation, not a clean-image attestation.

## Develop and iterate on the VM

The September 7 development workspace is `C:\Users\clawxtest\ClawXDev\source`. Its portable tools and dependency cache persist across tests. See the [development evidence](../../docs/evidence/WINDOWS_VM_DEVELOPMENT_2026-09-07.md) for the exact source, environment and validation.

```powershell
. C:\Users\clawxtest\ClawXDev\enter-dev.ps1
pnpm exec vitest run tests/unit/chrome-cdp.test.ts --maxWorkers=2
```

An agent can edit source and run these commands over authenticated SSH. Keep one controller responsible for app, Gateway and browser process changes. Use `git diff` to return reviewed fixes to the release checkout. Before a full app development launch, back up user state and stop the installed app and its owned Gateway; the source directory does not isolate `.openclaw`. Run the UI in the interactive desktop. `start-dev.ps1` checks these process/session prerequisites; Electron CDP inspection instead uses `pnpm run build:vite` followed by `pnpm exec electron . --remote-debugging-port=9223` after the same controlled handoff. Source tests and dev compilation do not replace installed-artifact acceptance.

For stakeholder-reported connection/setup failures, use the `windows-vm-iteration` skill in `.agents/skills/windows-vm-iteration` or `.codex/skills/windows-vm-iteration`. It keeps the loop scoped from exact artifact diagnosis through a single VM mutator, fresh standard-user retest, redacted Plane/evidence updates and stakeholder handoff. Do not promote unreviewed setup-helper experiments into this runbook until the scripts land in `windows-pilot/scripts/` and pass review.

## Installed app checks

Use `pilot-check-install-artifacts.ps1`, `pilot-office-runtime-check.ps1`, `pilot-office-write-smoke.ps1`, and `pilot-run-electron-cdp-probe.ps1`. Launch the actual installed app in the interactive user session; the test launch may expose Electron CDP on loopback port `9223`. Run plain Electron/Host API inspection before model-driven journeys. A probe without `-SafeChat` can validate the bridge while Gateway is disconnected, so do not promote its verdict to chat readiness.

`scripts/vm-verify-moe19.sh` collects the version-specific installed-smoke bundle and can start or stop a standalone Gateway. It still targets moe.19; do not run it against a later candidate or an active app without adapting the selected artifact and isolating its process lifecycle. Its silent installer phase is an automation diagnostic; normal assisted installer screens and desktop-shortcut launch need separate principal-facing proof. The [install runbook](../../docs/WINDOWS_INSTALL_RUNBOOK.md) retains historical commands: select the current candidate's exact filename/hash, never the newest file or a June version copied from an example.

## Record and inspect an app journey

Run `pilot-record-app-window.ps1` through an interactive scheduled task/RDP session, alongside the existing `pilot-chat-turn-driver.js`. Start with a realistic account-free prompt. For Online acceptance, pass `-ExpectedChannel online` to `pilot-run-chat-turn.ps1`. The driver requires exact send/run/recovery/error lifecycle signals from the current renderer; missing signals, unintended degradation or late errors fail. Answer latency and terminal verification time are reported separately. Corroborate model provenance and absence of replay from the private installed transcript; the channel pill alone cannot prove which provider answered. The driver does not authorize downstream email sends or form submissions. Keep clips and screenshots private under `artifacts/windows-vm/` or guest Downloads. Do not record unrelated windows or confidential tenant content for external grading.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\pilot-record-app-window.ps1 -WindowTitle 'Ministry of Education' -OutDir "$env:USERPROFILE\Downloads\<run-id>\recordings" -DurationSeconds 120 -FrameCount 10
```

Choose a duration that covers the complete turn and recovery observation; a 120-second clip that ends before the answer is partial evidence. The recorder requires the actual interactive app window and native legible dimensions; it does not upscale a small capture into proof. Run the observer with privileges that can inspect the app executable: a normal-privilege observer may correctly refuse an elevated app. Record that privilege context; an elevated capture is not standard-user acceptance. Without guest `ffprobe`, it records `HOST_VERIFY_REQUIRED`. Pull back the clip and guest manifest and verify using existing host tools:

```sh
node scripts/verify-app-window-recording.mjs --video <run>/app-window.mp4 --manifest <run>/manifest.json --out-dir <run>/host-verification --min-duration 118 --frame-count 10
```

The verifier checks guest hash binding, duration, dimensions and extracted frames. This establishes capture mechanics only. Inspect first, last and intermediate frames with the available vision model; `scripts/clwx-vlm-grade-screens.mjs` can grade approved non-sensitive frames through Bedrock. Check the interaction arc—click/type/send, visible work, correct result and artifact readback—against [the video acceptance criteria](../../docs/VIDEO_CAPTURE_OKR_2026-09-03.md). A frozen reconnecting screen is a recorded failure even when encoding succeeds. Sampled frames supplement continuous review; they cannot prove an error never appeared between samples.

Record source/artifact identity, Windows environment, command, timestamps, outcome, video hash and missing coverage in [the evidence index](../../docs/GA_RELEASE_EVIDENCE_MANIFEST.md). Never report GA or deployment readiness from access, an unchecked video, or source tests.
