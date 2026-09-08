# Stakeholder connection failure — September 8, 2026

**OPEN: Karunesh cannot complete an ordinary assistant turn.** This is the current release priority. His report supersedes the earlier dated “no stored reply” observation. Email and document acceptance cannot proceed until this connection works.

## moe.24 installed first turn FAIL; compatibility audit — September 8, 06:22Z

The [moe.24 installation receipt](../../artifacts/windows-vm/20260908-fresh-setup/moe24-install-result.json) confirms standard-user upgrade exit 0 at **06:03:28.105Z**, source `b814f804036fc2f9f32d3326c8694f4ae2ef7805`, run `34189597051`, matching EXE `7cdf1dde10cdd073695d4fceac35068e6bd52e3712f3fa5b2a66432d50ff9c90` and ASAR `656dde43f1a2b3597bd5d35f9bca72dc0ad2527909b0eb499b0f9971d3a56aa5`. All 36 host package checks pass. This remains Server 2022, a standard user with an existing profile; it is not fresh Windows 10/11 proof.

The ordinary Online token prompt was sent at **06:11:28.506Z** through `pilot-run-chat-turn.ps1` / `pilot-chat-turn-driver.js`, with a new session, no relaunch, 180-second turn limit and requested 30-second terminal quiet period. The local model service was stopped. The [driver result](../../artifacts/windows-vm/20260908-fresh-setup/moe24-first-turn-evidence/chat-turn-2026-09-08T06-11-25-019Z.json) is **NO_RESPONSE at 06:14:29.063Z**: no candidate answer, no terminal stability and no quiet-period proof. No fallback notice was observed. The [later UI observation](../../artifacts/windows-vm/20260908-fresh-setup/moe24-first-turn-evidence/moe24-app-observed.json), at 06:16:26Z, shows Online, Gateway ready, enabled composer and all four activity flags false. That later idle state does not convert the failed turn into a PASS.

Strict [transcript correlation](../../artifacts/windows-vm/20260908-fresh-setup/moe24-first-turn-evidence/transcript-review-redacted.json) returned `CURRENT_TURN_NOT_FOUND` within its 125-second binding window. Consequently, there is no correlated provider answer or proven provider-level cause for this test. The [graceful app quit](../../artifacts/windows-vm/20260908-fresh-setup/moe24-first-turn-evidence/post-test-quit.json) completed at 06:20:12Z with no app processes remaining.

The original root-user Ollama server was restored in Session 1. The initial 10-second API probe timed out; a subsequent [read-only verification](../../artifacts/windows-vm/20260908-fresh-setup/moe24-first-turn-evidence/ollama-restoration-verification.json) at **06:27:03Z** confirms the same PID owns port 11434 and `/api/tags` is healthy. No duplicate server was started. The initial failure receipt is retained.

Startup remained slow: [shortcut request](../../artifacts/windows-vm/20260908-fresh-setup/moe24-first-turn-evidence/first-shortcut-launch.json) 06:04:48.021Z; [first Main log](../../artifacts/windows-vm/20260908-fresh-setup/moe24-first-turn-evidence/startup-trace-redacted.json) 06:06:01.047Z; Gateway spawn-to-ready metric 89,781 ms; repeated `system-presence` RPC timeouts. Readiness was observed at 06:10:06Z, not sampled continuously. The [Defender ETW summary](../../artifacts/windows-vm/20260908-fresh-setup/moe24-first-turn-evidence/defender-startup-redacted.json) covers 06:04:24–06:12:25Z: 49,927 real-time scans, including 47,162 triggered by the app, with 329.2118 aggregate app-triggered scan seconds. Individual OpenClaw plugin-SDK files were scanned about 130 times. Aggregate scan time is not additive startup wall time and does not prove sole causality. Security settings were unchanged; raw ETL/report data remain on the guest.

Two verified findings guide the next repair: the pinned OpenClaw history handler waits for the full model catalog solely to infer a missing thinking level; and runtime files are read/scanned repeatedly. History repair `f5875b54d5bfcf9e6b134322f560d18468746975` preserves explicit settings and actual turn resolution, passes an actual-handler baseline-versus-patched regression, and has seven independently repeated focused passes. It is **source-only**, not in moe.24, and is not claimed to fix all startup or response delay.

The [workflow matrix](../APP_WORKFLOWS_TEST_MATRIX.md) now labels its moe.15-era green rows historical. The [upstream comparison](../UPSTREAM_MERGE_ASSESSMENT_2026-08-20.md) records upstream 0.5.6 / OpenClaw 2026.7.1-2 versus pilot OpenClaw 2026.4.23, verified backport boundaries and unverified compatibility. No new build was started for that audit. The privately staged moe.24 installer passed a full signed GET/hash check at 06:01:18Z; its URL expires 17:00:41Z, and no handoff or GA publication occurred. The last read-only WhatsApp refresh at 05:53:11Z found no newer incoming message than the original 03:31:46Z log.

The consolidated compatibility checkpoint was posted to **CLWX-22** at 06:27:08Z, comment `cbbd5013-21fe-4c4b-b266-1f690f9ca64f`, with project-scoped detail and list readback verified. Card states were unchanged.

## Diagnostic upgrade installed; repair artifact downloaded — 05:32Z

The [standard-user moe.23 upgrade receipt](../../artifacts/windows-vm/20260908-fresh-setup/moe23-install-result.json) records completion at **05:30:47.760Z**, exit 0, source `2449a9483b7e4937a902e70914a382d05f8e2e58`, matching installed ASAR `748f27f4dbbf61c9183bc4c8c0daf0261c156afaf41f56114c1676fd543ddc0c` and EXE `bac2494c17660f00df0abb74f10a606ec03fd43081b78b0744d1be565f6e0fc0`. The Finish action verified the Run checkbox was clear. The protected profile backup remains intact. This proves installation identity; runtime acceptance is pending.

Moe.24 run `34189597051` has completed successfully. Its [generated manifest](../release-manifests/0.4.3-moe.24.json) binds source `b814f804036fc2f9f32d3326c8694f4ae2ef7805` to installer SHA256 `83af6d00071992b3e34b5430e3e3eb4c848804054cd90d23afbdc3deafc271dd` (394,150,574 bytes). The [guest download receipt](../../artifacts/windows-vm/20260908-fresh-setup/download-34189597051-result.json) verifies the archive digest and installer hash at 05:31:02Z. Full host payload review and installed moe.24 acceptance remain pending. No stakeholder handoff or GA publication occurred.

## Verified package and next candidate — 05:23Z

Moe.23 run `34187805266`, source `2449a9483b7e4937a902e70914a382d05f8e2e58`, completed successfully: 204 native Windows test files / 2,135 tests, 11 skips, and all 17 [host package checks](../../artifacts/windows-vm/20260908-fresh-setup/moe23-host-verification.json). The installer SHA256 is `228983187371d54a60f4018f6ee3ac86bd3e60d4ed2dbe3cd2784d76962f8d25`. Source, archive, installer, EXE, ASAR, manifests and helper checks establish package identity; installed acceptance is still in progress.

The fresh standard-user app was closed normally at 04:58:39Z. A protected, guest-only backup completed at 04:58:49Z with 316 files and matching source/backup hashes. The moe.23 assisted upgrade is extracting into the existing fresh-user installation. A disconnected RDP client was replaced and the same Session 2 reconnected; the installer and profiles were preserved. No VM stop, restart or resize occurred. The [70-sample performance capture](../../artifacts/windows-vm/20260908-fresh-setup/moe23-prelaunch-performance-summary.json) covers installer waiting/extraction, not Gateway startup: maximum CPU 88%, minimum available RAM 10,446 MB, maximum disk queue four, zero counter errors.

Moe.24 [run 34189597051](https://github.com/dmvevents/clawx-pilot/actions/runs/34189597051), source `b814f804036fc2f9f32d3326c8694f4ae2ef7805`, includes reviewed fallback repair `7f4b06d3b943fc15ff6655dd057c3336aa62e31b` and is packaging after native preflight. Its installed acceptance remains NOT_RUN. The repair prevents silent runs from triggering automatic local replay and refuses unavailable local targets; it retains the existing timeout and deliberately ignores a late final after that timeout. It is not a response-latency fix.

Private VM and stakeholder setup bundles have been rebuilt with tested helper `9d46832f` / SHA256 `10b122f0f66b32f736c865a677b4908fd07dab724f28964be01ea6376a919728`. Their distinct client credentials remain private. The [preparation receipt](../../artifacts/windows-vm/20260908-fresh-setup/setup-bundle-preparation.json) records five files per bundle, no publication and no send. The VM iteration skill and repository navigation are committed as `ef637e16`, with independently approved mirrored CMD/fallback lessons in `2d5502ff`.

## Received evidence

The project-relevant Karunesh Ramdass thread was resolved through the configured WhatsApp bridge's contact/privacy mapping and read-only SQLite storage. No callable WhatsApp MCP was exposed in this Codex session. Actual attachments were downloaded through the configured IPv6 loopback bridge. This establishes receipt of the inspected messages, not complete account synchronization.

| UTC time, September 8 | Received evidence |
|---|---|
| 03:28:38–03:29:45 | Cannot connect with the new build; repeated assistant-unreachable errors prevent testing any functionality. |
| 03:28:41 and 03:29:21 | Two screenshots: Gateway connected, repeated failures after a greeting, conflicting Online/on-device indicators, and inherited local Qwen model on Main Agent. |
| 03:31:46 | Actual application log, 18,746 bytes; SHA256 `e5c2587fb034812a488306a00c828f35bdd771159357539fd659e92d88f8a2ec`. |

The raw messages, contact identifiers, screenshots and application log remain in private local storage. Only redacted findings and source locators belong in this repository or Plane.

## Diagnosis and uncertainty

| Evidence | Finding |
|---|---|
| Log line 3 | Running `0.4.3-moe.21`, the diagnostic build actually sent earlier. The stakeholder did not select the wrong offered build. |
| Line 12 | No complete cloud bootstrap configuration was found. This alone does **not** prove that a persisted cloud provider key is absent or invalid. |
| Lines 21–23, 61–80 | Startup cannot map the existing cloud runtime account, then seeds local Qwen as default and pins the agents to it. |
| Line 87 | The persisted cloud provider is imported after startup channel selection. |
| Lines 157–161 | The local model request fails with network/connection errors. Gateway startup itself succeeded. |
| Source inspection at `a4efc7e4` | Local seeding does not probe Ollama; startup preflight reads the account cache before the later OpenClaw provider import. Gateway readiness alone enables the composer. |

The demonstrated failure is assistant model connection/setup before any email tool can execute. It differs from the VM's separate local-model context/latency failure, where Ollama is reachable. Increasing a chat timeout or treating this as an Outlook attach defect would not address the reported cause.

Current `moe.22` source `a4efc7e4a4311d7865bf0c74ab2320289fdadd48`, build `34180280985`, does not yet repair this startup/provisioning gap. Its installed VM and image-reader passes do not establish a fix on Karunesh's machine.

## Repair and exit criteria

1. Import persisted providers before automatic startup selection; verify local endpoint/model availability before using it as an automatic fallback. Preserve explicit user channel intent.
2. Show actionable model setup guidance when no usable model route exists. A running Gateway must not imply that an ordinary greeting can succeed.
3. Prepare a separate client Online connection through the existing broker code, with upstream credentials kept on the server. Initial discovery found the existing LiteLLM gateway healthy but no deployed model-broker or independent client-key secret. The additive broker now passes the API checks below; Windows application acceptance remains pending.
4. Prove the missing-setup case and an ordinary first response on Windows, then provide the tested repair/setup and collect Karunesh's unaided rerun. Source checks, VM proof and stakeholder acceptance remain separate.

The missing usage-meter import was repaired in the broker container. Independent review, an actual container start, and the deployed revision confirm removal of that deployment blocker. The existing gateway and held key-rotation/visibility actions were preserved.

## Source repair and upgrade preparation — 05:09Z

The independently reviewed transient-fallback repair is committed as `7f4b06d3b943fc15ff6655dd057c3336aa62e31b`. Its two new regression cases fail against the prior source and pass after the change. The focused suite passes 107 tests, with an independent repeat; two Electron tests, typecheck, lint, harness and communication checks also pass. The existing watchdog still ends a stale run and ignores its late final; this is **not** a latency or late-answer recovery fix. Actual provider-error recovery remains available, and Main rejects an unavailable local target before runtime mutation. Installed acceptance is pending.

Diagnostic moe.23 [run 34187805266](https://github.com/dmvevents/clawx-pilot/actions/runs/34187805266) has completed successfully from `2449a948`. Its 394,148,098-byte x64 installer has SHA256 `228983187371d54a60f4018f6ee3ac86bd3e60d4ed2dbe3cd2784d76962f8d25`. The guest downloaded and verified it at 05:00:43Z. A slow host GitHub download was bypassed using the already verified guest archive; the IAP transfer completed in 71 seconds with the same archive digest. Host payload verification and the standard-user upgrade are pending. This artifact predates the new fallback repair.

The fresh test app quit normally at 04:58:39Z. A protected backup of 59 app-data files and 257 OpenClaw files completed at 04:58:49Z; all 316 copied file hashes match. Profile data remains private on the VM. [Backup receipt](../../artifacts/windows-vm/20260908-fresh-setup/pre-upgrade-backup.json). The recorded VM shutdown hold remains in force; no resize has occurred.

## Provisioning repaired; first Online turn fails — 04:54Z

Helper `9d46832f2fce4036f1943c853a0f88049762e07f` fixes default-path resolution inside the running script. **20/20 native PowerShell 5.1 checks pass** at 04:37:02Z, including real fresh-process CMD execution from a directory containing spaces, JSON/idempotence and explicit-path override. The actual private setup CMD then passes at **04:39:32Z**, exit 0, under the fresh standard user without elevation. The saved key has protected, user-only access and verified ownership; no inline credential remains. This supersedes the failed entrypoint result below. Evidence: [native result](../../artifacts/windows-vm/20260908-fresh-setup/native-setup-contract-20.json), [native test output](../../artifacts/windows-vm/20260908-fresh-setup/native-setup-contract-20.log), [actual provisioning receipt](../../artifacts/windows-vm/20260908-fresh-setup/fresh-first-turn-evidence/actual-online-setup.json).

The existing moe.22 first launch began at 04:40:05Z with no running local-model service. Gateway prelaunch work took 332 ms; process startup/transport took 102,360 ms, then base RPC readiness repeatedly timed out until 04:44:57Z. The UI was ready/Online at 04:45:36Z. The cold-start recorder missed its 45-second window deadline; that attempt is not recording proof. A later 180-second native app-window recording passes host capture checks and independent visual inspection identifies the defects below.

| Fresh first-turn evidence | Result |
|---|---|
| One driver prompt sent at 04:46:10.933Z | The original user message was recorded at 04:48:05.214Z. |
| Online transcript answer at 04:49:01.613Z | Correct token exactly once, `custom-moecloud/moe-demo-pro`, `openai-completions`, stop reason `stop`; 170,680 ms after driver send. This derived interval is not the driver's measured answer latency. |
| Automatic fallback prepared at 04:47:50.956Z | The renderer treated silence as an unreachable provider, before the Online answer arrived. It selected a configured local model without testing availability. |
| Recording near the end | The real Online answer appears with a false device-origin notice; the composer says On this device while the top status says Online. |
| Driver verdict at 04:49:12Z | **FAIL — TIMED_OUT_MID_TURN**, unsettled, no terminal quiet-window proof. |
| Idle JSON observation at 04:50:47Z | Run flags are idle and the channel remains on-device. |
| Later screenshot, exact timestamp/run unbound | A repeated prompt and three reachability errors are visible. This is separate visual evidence and is not assigned the idle JSON timestamp or the original turn. |

Evidence: [driver](../../artifacts/windows-vm/20260908-fresh-setup/fresh-first-turn-evidence/online-first-turn/chat-turn-2026-09-08T04-46-06-965Z.json), [correlated transcript](../../artifacts/windows-vm/20260908-fresh-setup/fresh-first-turn-evidence/fresh-first-turn-transcript.json), [timing metrics](../../artifacts/windows-vm/20260908-fresh-setup/startup-metric-values-redacted.txt), [capture verification](../../artifacts/windows-vm/20260908-fresh-setup/fresh-first-turn-evidence/fresh-online-turn/host-verification/host-verification.json), [independent visual review](../../artifacts/windows-vm/20260908-fresh-setup/fresh-first-turn-evidence/fresh-online-turn/visual-review.json).

Read-only source diagnosis confirms that startup repair `11db8196` does not cover transient fallback. The bounded repair now targets silent-run eligibility and local readiness before any session pin/replay, preserving actual provider-error recovery. No timeout increase or successful handoff is claimed. Diagnostic moe.23 [run 34187805266](https://github.com/dmvevents/clawx-pilot/actions/runs/34187805266), source `2449a9483b7e4937a902e70914a382d05f8e2e58`, has passed preflight and is packaging; it does not contain the newly identified fallback repair.

At 04:52:18Z the idle VM measured 1% CPU, 10.27 GB free RAM and zero local-model service processes. The earlier installation sample was 79% CPU. Neither observation establishes that more CPU will resolve the RPC delay. The VM remains at 4 vCPUs/16 GB; the stop/start hold exception is pending. A fresh read-only WhatsApp check at 04:53:27Z found no new messages since the prior check. No repaired installer, new login or setup bundle has been sent.

## Actual entrypoint and hosted build — 04:31Z (superseded entrypoint failure)

The actual CMD setup launch on the fresh account failed before the helper body: the default parameter tried to use an empty `$PSScriptRoot` in a fresh PowerShell 5.1 process. The 17 passing dot-sourced native tests did not exercise that entrypoint. No Online seed was installed by the failed launch. Resolve the default path inside script execution and test the real default CMD path with a synthetic bundle before repeating actual provisioning.

The first diagnostic moe.23 hosted run [34186790366](https://github.com/dmvevents/clawx-pilot/actions/runs/34186790366), source `cad3ab65b7c7440976daceca56c8a73cb74e30fe`, failed before packaging: `document.find` global-budget fixture timed out at 5 seconds during Windows preflight. The run reports 2,134 passing tests, one failure and 11 skips; no installer artifact exists for it. A bounded fixture diagnosis is in progress. The supported setup entrypoint and failed native build must both be repaired before a new handoff.

## Repair checkpoint — 04:26Z

The startup repair is independently approved and committed as `11db81963be6fd913f8d5f757746aa9ca86ae7c3`: persisted provider import order, exact provider/model identity, selected-route readiness and explicit channel intent are corrected. All six initial independent reproductions and the subsequent out-of-order readiness race pass; 80 focused tests, one Electron interaction, typecheck, lint and communication replay/compare pass. This is source proof pending a newly built and installed candidate.

Setup helper `a8a9b0d518335047f77abc43230e48b25ed9b63a` passed **17/17 native Windows PowerShell 5.1 tests**, exit 0, at **04:19:24Z**, in fresh standard-user RDP Session 2. The actual Windows test exposed and removed two defects: rewriting ownership unnecessarily required a missing privilege, and PowerShell's null conversion broke atomic file replacement. The repair changes permissions while preserving verified ownership and supplies an explicit null string to .NET. A test fixture now waits for its owned process to exit before the next case. The passing suite covers save/idempotence/backup/ACL, invalid input, busy application, concurrent execution and partial-write rollback. Earlier failed runs are retained in the [native evidence bundle](../../artifacts/windows-vm/20260908-fresh-setup/native-setup-evidence.zip).

The ordinary assisted installation of existing `moe.22` build `34180280985` completed at **04:26:05Z**, exit 0, under that fresh standard account. Installer, EXE and ASAR hashes match the selected manifest. The finish screen was captured and its automatic launch option cleared, preserving a separately observable first launch. This is fresh **Server 2022 standard-user** installation proof; Windows 10/11 client acceptance and actual provisioned Online first turn remain separate.

The next diagnostic `moe.23` source is being integrated from the three reviewed broker, startup and setup commits. No new candidate installer or stakeholder handoff is claimed yet. The requested VM resize is prepared from 4 vCPUs/16 GB to 8 vCPUs/32 GB; a sample during installation showed 79% CPU and 10.58 GB free RAM. One disconnected controller-owned RDP client was closed, preserving the one active connection. Machine-type changes require stop/start, so the earlier owner shutdown hold must be resolved before that action. More compute does not repair provider routing or prove a cloud-response latency improvement.

## Repair checkpoint — 04:12Z

Broker source `44ea379ac69b59fae834d77655c1bc55515c9faa` was independently approved for the scoped pilot relay and deployed as `clawx-model-broker-00001-jss` in `us-central1`. Separate VM and stakeholder client credentials were created; neither is the upstream credential. The existing LiteLLM service and its credentials remain unchanged. Private connection details and credential files are excluded from this record.

The [redacted live verification](../../artifacts/windows-vm/20260908-fresh-setup/broker-live-verification.json) records eight passing checks at 04:08:20Z: unauthenticated and invalid credentials rejected; each valid client sees only the two supported aliases; unsupported model refused; stakeholder client produces a real answer; VM client produces a function call and completes the streamed tool-result response. These are API results, not installed Windows or stakeholder acceptance. An initial output fixture exhausted its 64-token budget; its failed result is retained, and the corrected 1,024-token fixture completed.

A fresh standard Windows user is active in RDP Session 2, with no prior Ministry/OpenClaw profile. The existing user's app and identified local-model service were paused for the missing-local-service test; their files and models were preserved. The native Windows PowerShell 5.1 setup contract failed at 04:08:23Z (5 passed, 12 failed, including dependent cases after the initial save failure). The helper is under diagnosis and has not been handed to the stakeholder. The corrected startup source passes 79 focused tests and one Electron interaction; independent review and packaged Windows proof remain pending.

A read-only thread refresh at approximately 04:11Z found no incoming message after the 03:31:46 log. The owner's later outbound message asks the tester to wait for a fix and suggests stale application data. That suggestion is not a demonstrated root cause and does not justify deleting the tester's profile.

## Communication and distribution

The owner-authorized acknowledgment was accepted by the WhatsApp bridge at **03:39:18Z** (`SEND_ACCEPTED`). It confirms receipt, explains the model connection failure, and asks Karunesh to hold functionality tests until a tested fix/setup is ready. Delivery/read status is unverified. No new installer or completion notice was sent.

A private GCS diagnostic copy of build `34180280985` passed an anonymous full download at **03:28:39Z**: HTTP 200, 394,149,483 bytes, SHA256 `eed3d9ec87902d1babcf7906122009ac3a0ec708871db175de52871dc3e5938f`. Its signed URL is private and expires at **14:26:49Z**. This is an available diagnostic artifact, not a stakeholder handoff or GA publication.

## Separate VM checkpoint

A temporary provider-policy experiment on the installed `a4efc7e4` artifact timed out on a fresh local turn. Original policy was restored at **03:35:08Z**. Online then remained ready for 20 seconds and answered a fresh ordinary token prompt at **03:38:15Z**, with a 30-second terminal observation window. Read-only transcript correlation at **03:44:22Z** confirms `custom-moecloud/moe-demo-pro`, one token occurrence and zero tool errors. This proves restoration of the existing VM connection, not the stakeholder repair.

Evidence: `artifacts/windows-vm/20260908-moe22/installed-acceptance-34180280985/policy-experiment-receipts/`; live Plane comment receipts: `artifacts/plane/20260908-ga/stakeholder-0339-write-receipts.txt`.

**GA remains RED.** Existing owning cards: CLWX-107 (stakeholder), CLWX-25 (installation/setup), CLWX-73 (email acceptance blocked upstream), CLWX-117 (model route), CLWX-115 (functionality acceptance), CLWX-106 and CLWX-22 (release gates). See the [blocker record](GA_BLOCKER_RESOLUTION_2026-09-08.md) for readback-verified Plane updates.
