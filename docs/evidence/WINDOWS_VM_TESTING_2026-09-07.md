# Windows VM testing evidence — 2026-09-07

This is actual installed **moe.19** observation plus testing-infrastructure validation. It is **not GA acceptance**, a new installation, a clean-image result or proof that the current source is packaged. Procedure: [Windows testing](../../windows-pilot/vm-testing/README.md). Current work: [completion plan](../COMPLETION_PLAN.md).

## Access and artifact

Owner GCP reauthentication cleared the earlier access blocker. The existing `clawx-win-rc-20260609` VM in `gen-lang-client-0649986230`, `us-central1-a`, was initially confirmed terminated and then started for the authorized test. No firewall/egress configuration was changed. The VM remains running under the recorded shutdown hold.

The hardened IAP probe passed on 2026-09-07 06:30:56–06:31:39Z: real RDP X.224 confirmation, real SSH banner, and provider rejection `4003 / failed to connect to backend / port 9999` for a closed **guest** control port. Authenticated SSH separately returned the requested marker. The probe ran an immutable script snapshot with a 45-second timeout; the provider's control rejection took over 30 seconds, so the default is now 45 seconds. Local listeners alone are not acceptance.

| Artifact | Observed identity |
|---|---|
| Installed app | Log version `0.4.3-moe.19`; Windows executable metadata `0.4.3.0` |
| Installed `app.asar` SHA256 | `4efd6002165711a1d4268a36156aed8dd809f518c72fdef0024ee45ed068ba1b` |
| Local installer SHA256, rehashed this run | `3a533a0fa1733fac6243fba19e4f1bc21d70c57eb498e1121a969b025bc48888` |
| Local installer size | 433,622,791 bytes |
| Source | Not recorded for this historical artifact. Current source at `58d04eb0` plus working changes is later; matching version labels do not bind it |

The installed ASAR matches the recorded moe.19 manifest. No package/build, installer execution or publication occurred in this continuation.

## Environment fidelity

| Observation | Consequence for coverage |
|---|---|
| Windows Server 2022 Datacenter 10.0.20348, build 20348, 64-bit, GCE, four logical processors, approximately 16 GiB RAM | Real Windows Server runtime proof; Windows 10/11 principal deployment needs separate coverage |
| Reused installed app, app data, `.openclaw` and Chrome user-data folders | Existing-profile run, not clean installation |
| Administrator account; elevated SSH/App task and a separately observed unelevated interactive token | Unelevated token is not proof of a standard-user account or standard-user installation |
| SSH Session 0 reports 1024×768; interactive Session 1 is 1920×1080 | Visual evidence must come from the interactive session, not SSH screen metadata |
| Microsoft Basic Display Adapter; zero sound devices; Azure Speech seed absent | No physical microphone, GPU or speech-quality acceptance |
| No Node, Python, ffmpeg or ffprobe on PATH; packaged Node, Playwright, ffmpeg and speech helper exist | Exercises packaged dependencies without developer Node; guest ffprobe absence requires host verification |
| Chrome installed; tenant sign-in not verified | No Outlook/Forms tenant claim |

The first profile was collected before app launch. The enhanced probe was rerun later to distinguish administrator membership from token elevation; later observations are not backdated as pre-state. State backups copied 802 app-data files and 938 OpenClaw files before launch. Keys, raw configuration, message bodies and account identifiers were excluded from portable observations. Raw local evidence stays in ignored `artifacts/windows-vm/20260907-environment/`.

## Installed runtime observations

- Packaged Office runtime check: `OFFICE_RUNTIME_READY`.
- Word and Excel write/read-back smoke: four PASS results, `JS_RESULT:OK`, `OFFICE_WRITE_OK`.
- Default Electron CDP probe: validation true, no reasons. This run did **not** enable `SafeChat`, Outlook or Forms flags, so it establishes bridge access only.
- The first real screenshot showed **Reconnecting** and a disabled composer. A later observation showed the composer enabled. A listening Gateway port did not prove readiness in between.

One startup sample, from the guest app log:

| UTC | Event |
|---|---|
| 06:28:19.514 | App session begins |
| 06:28:20.535 / .863 | Cloud/local provider writes schedule Gateway reloads |
| 06:28:20.977 | First Gateway start requested |
| 06:28:22.978 | Reload deferred while startup is settling |
| 06:29:51.170 | First startup reports ready/connect after 90,122 ms |
| 06:29:51.171 | Deferred reload executes; Windows restarts the freshly connected Gateway |
| 06:30:29.360 | Second startup connects after 37,867 ms |
| 06:30:35.862–06:33:08.889 | Repeated `system-presence` RPC timeouts |
| 06:33:38.892 | RPC readiness succeeds, approximately 318 seconds after first start request |

**High-confidence causal finding:** pre-start configuration convergence invokes live Gateway refresh scheduling. The deferred reload becomes a Windows restart immediately after initial startup. Source anchors: [boot order](../../electron/main/index.ts), [provider refresh](../../electron/services/providers/provider-runtime-sync.ts), [Windows reload behavior](../../electron/gateway/manager.ts), [deferred restart](../../electron/gateway/restart-controller.ts). This is one observed sample, not a p50/p90 performance distribution.

Two secondary issues need separate fixes and validation: the packaged ACPX probe requests unavailable `npx`, and the Ministry plugin seeder prunes `browser` despite the bundled plugin manifest declaring it enabled by default. Neither is proven to be the sole cause of the full RPC delay. The recovered UI initially selected on-device while Ollama port 11434 was closed; an Online test uses the normal visible channel control and records that intervention.

## Visual and chat evidence

The real installed app was captured in interactive Session 1 from **06:41:52.520Z to 06:43:53.820Z**. MP4 duration is **120 seconds**, native **1280×800**, 15 fps, 552,636 bytes. SHA256: `e64723e25fa4242bc37511ffa87a83fc7118b7ea3d5afbf3667625628c30b525`. Guest `ffprobe` was absent; host verification matched the guest manifest/video hash and extracted ten nonblank frames spanning 0–119.8 seconds.

The initial normal-privilege capture correctly refused to identify the elevated app executable. The successful capture used the same elevated privilege as the existing app task; this is explicitly administrator-context evidence. A PowerShell 5 UTF-8 BOM interoperability issue was corrected before the successful run; the actual guest manifest is BOM-less.

**Capture mechanics: verified. User journey: blocked.** Native image inspection reviewed frames at 0, 13.311, 66.556 and 119.8 seconds. Frame 0 shows historical chat and is not a result from this test. The later reviewed frames show the fresh empty session, Online selected, **Reconnecting**, and **Gateway not connected** in the disabled composer through the final sample. App chrome and text are legible; there is no new assistant result. This was sampled frame inspection, not a claim of uninterrupted video review.

The normal UI path created an empty chat and selected Online at **06:42:02.728Z**. The driver attempted an account-free staff-meeting prompt at **06:42:03.751Z**; the Gateway restarted around the channel change and the composer became disabled between its readiness check and fill. `locator.fill` timed out after 30 seconds. Driver verdict: `INCOMPLETE`, process exit **1**, zero starting messages, no completed turn. **The prompt was not sent.** This is evidence of a failed journey, not a cloud-model answer or a provider test.

Private local artifacts:

- `artifacts/windows-vm/20260907-environment/online-chat-observation/app-window.mp4`
- `.../online-chat-observation/manifest.json`
- `.../online-chat-observation/host-verification/host-verification.json`
- `.../online-chat-observation/host-verification/visual-review.json`
- `.../chat-online/chat-turn-2026-09-07T06-42-03-750Z.json`
- `.../chat-controller.stderr.txt`, environment JSON snapshots, Office/bridge output and initial screenshots

The normal UI channel change and new empty test session are retained with the evidence; pre-run state is backed up. No Outlook send, Forms submit or external stakeholder message occurred.

## Testing changes and verification

- IAP probing now fails on unavailable/stopped VM, occupied selected ports, protocol failure or an unproven negative control; owned probe processes are cleaned up.
- The installed evidence producer captures `environment.json` before installation/mutation and binds it to the exact portable inventory. The adapter rejects missing, malformed or out-of-window environment evidence and reports environment scope without promoting it to deployment acceptance.
- The app-window recorder binds the installed executable directory, current interactive session and native window dimensions. It refuses sibling installations, Session 0, absent/undersized windows and overwrite. Host verification binds the guest video hash and checks duration, dimensions, timeline frames and blank captures. Capture mechanics retain `NOT_RUN` visual/product verdicts until separately reviewed.
- PowerShell 5's UTF-8 BOM behavior was addressed in both the producer and the host parser.
- Windows testing guidance, Codex/Claude smoke skills and all three README development sections point to the same procedure.

- `pnpm test`: **197 files passed, 1,915 tests passed, 6 skipped**. Two pre-existing EventEmitter listener warnings were reported; process exit 0.
- `pnpm typecheck`: passed.
- `pnpm lint:check`: passed, 0 errors and 52 existing warnings.
- `pnpm lint:ps`: passed across 53 files, 0 gating findings and 158 advisories. The recorder and environment probe also executed on the actual Windows PowerShell guest.
- `pnpm harness:ci`: passed, including 16 harness tests, five Office checks and 61 eval checks; nine eval skips remain explicitly outside live acceptance.
- Task validation and selected-flow dry run passed against the real diff from `58d04eb0`.
- Separate independent reviews approved the IAP/recorder correction and the environment producer/adapter contract. The later BOM fix has its own fixture regression and actual Windows/host execution proof.
- `git diff --check`: passed. No product runtime code changed in this testing continuation.

## Next acceptance work

1. Add a cross-module regression proving pre-start cloud/local seed and channel convergence write config without queuing a reload; preserve legitimate running-settings refresh. Fix this lifecycle boundary before increasing timeouts.
2. Preserve bundled core-plugin entries during seeding and resolve the packaged ACPX command contract without relying on developer Node/npm.
3. Build a source-bound integrated candidate and repeat installed startup, model route, chat/Office and recovery checks. The current historical artifact cannot validate these source changes.
4. Run normal assisted install/desktop-shortcut and upgrade checks on the deployment Windows edition and privilege level. Keep Server-instance and principal-laptop acceptance separate.
5. Complete tenant-authorized Outlook/Forms and physical microphone scenarios, exact-artifact rehearsal and independent tester acceptance before a release claim.
