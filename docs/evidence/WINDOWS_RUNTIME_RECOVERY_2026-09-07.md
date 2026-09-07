# Windows runtime recovery — September 7, 2026

Status: `0.4.3-moe.20` installed and hash-verified on the VM. The deferred startup restart did not recur; the first chat exposed a late recovery replay after a successful cloud answer. **GA remains RED.** The [moe.19 observation](WINDOWS_VM_TESTING_2026-09-07.md) is the prior baseline, not proof for this candidate.

## Failure and repair boundary

The installed moe.19 log showed provider reload scheduling before first Gateway start, a deferred restart immediately after the first ready/connect, and repeated RPC readiness timeouts. One observed launch took about 318 seconds before RPC readiness. A later 120-second Online recording showed reconnection and a disabled composer; the driver did not send its prompt. This is one launch/attempt, not a latency distribution.

The repair makes the boot cloud/local seeds and channel preflight converge configuration without requesting refresh. The first process reads the resulting files directly. Running settings changes and later Graph user-ID refresh retain live refresh behavior; no global restart or retry policy was removed.

Startup no longer deletes the bundled browser entry. ACP/ACPX defaults are disabled only if both the ACP policy and ACPX entry are absent; any existing entry, even an empty object, remains operator-owned. The observed guest had neither. Principal tools register natively and use Host API, so they do not require an ACP coding-agent adapter.

The inspected bundle is OpenClaw `2026.4.23`, ACPX plugin `2026.4.20`, ACPX runtime `0.5.3`. Its default probe resolves Codex through `npx`, which is absent from this guest's PATH. Current [OpenClaw ACP setup documentation](https://docs.openclaw.ai/tools/acp-agents-setup) describes that external-adapter route. Bundled schemas and code remain authoritative for this candidate: current documentation's allowed-agent fallback and agent `args` examples differ from this bundle. The [plugin configuration contract](https://docs.openclaw.ai/tools/plugin) supports explicit per-plugin disablement; the [bundled browser is a default plugin](https://docs.openclaw.ai/cli/plugins).

## Source verification

Regression-first checks reproduced browser entry deletion for both enabled and disabled settings, and the absent implicit ACP policy. Focused tests pass after repair. Independent architecture review approved the boot/provider boundary and the plugin policy, including preservation of existing settings. Communication replay/compare passed. Full build preflight and installed results are recorded below when available.

The ordinary non-static gate also now fails blocked required T1 coverage. The explicit send-request/missing-tab regression proves no send script runs and the gate exits nonzero. Static-only exclusions and unset action opt-ins stay explicit; strict release evidence remains mandatory for publication. This addresses a separate CLWX-106 acceptance gap discovered while reading the live card.

## Candidate and environment

The historical moe.19 installer, blockmap, app.asar and manifest were preserved under the private local `release/preserved/moe19-20260907-0910/` directory. The new version avoids reusing their identity. Build source is the working diff over `58d04eb0490d77271e67ff0c711e9d4ec011eef6`; a dirty local candidate is staging evidence and cannot pass the clean-source release requirement.

Target: existing GCP Windows Server 2022 VM, four vCPUs, 16 GiB RAM, reused administrator profile, interactive desktop. September 7 09:02–09:06Z checks confirmed RUNNING, authenticated SSH access, and the existing app in Session 1. This lane does not establish fresh client Windows, standard-user, tenant or microphone coverage. The owner subsequently authorized GitHub synchronization, GA publication after validation, and stakeholder notification once released; Mac installation, CLWX-18/19 and VM shutdown holds remain.

## Board scope

Live CLWX-95 and CLWX-106 are In Progress; CLWX-25 remains In Progress. Comments on CLWX-22/25/95/96/106 record the observed baseline and source/evidence gaps. Existing CLWX-95 mid-turn recovery acceptance, CLWX-96 recovery behavior and CLWX-25 clean installer flow remain broader than this startup repair. No card is promoted on source tests alone. API details are in [PLANE_BOARD_API.md](../PLANE_BOARD_API.md).

## Build checkpoint

The preflight passed 198 test files / 1,932 tests (6 skipped), typecheck, lint (0 errors / 52 existing warnings), PowerShell analysis and agent-surface checks. The initial `build:win` stopped at the speech-helper phase because `dotnet` was absent from PATH. Existing SDK 8.0.424 under the user-local `.dotnet` directory was selected; no SDK install or helper-skip override was needed. The remaining helper → package → builder sequence exited 0. The staged artifact fast harness passed all 8 selected checks; communication replay/compare and harness CI passed (the eval portion still has 9 documented skips).

Installer SHA256: `18a8ad0ab6fe7a4fca2dc0704912dc9a07305f1247c3060da2cd7ec14da946f6`, 433,625,081 bytes. App ASAR SHA256: `b0ff2022a30733b0c8d2b3cb816191c81d9a300da7f9f783ecafb037e8c05f6e`. The [manifest](../release-manifests/0.4.3-moe.20.json) records the dirty source status hash and 09:14:03Z build-source timestamp. The wrapper verified source and compiled bytes before/after packaging. Raw local logs are under `artifacts/windows-vm/20260907-runtime/`.

Before upgrade, all OpenClaw files and app-data files except an active cookie database were copied. The app then quit through its normal IPC quit action. A new complete backup copied 805 app-data files and 940 OpenClaw files with successful robocopy exit 1. The pre-install environment JSON and both backup phases remain private evidence.

## Installed observations — 09:43–09:54Z

The visible `/CURRENTUSER` installer completed with exit 0 at 09:43:41Z. The observed license, destination and completion screens identified the correct app. Installed app.asar and executable hashes matched the candidate; FileVersion was `0.4.3-moe.20`. Authenticode reported **NotSigned**. The installer controller ran from 09:26:29Z to completion, including operator observation time; that interval is not a pure extraction benchmark.

The existing interactive app task launched at 09:44:25.664Z. Gateway PID 3992 stayed constant. Prelaunch preparation took 317 ms; child process to handshake took 66.3 seconds. First observed RPC readiness plus enabled composer was 09:48:19.293Z, **233.6 seconds after launch**, followed by 20 seconds of stable readiness. This is one sample versus the prior roughly 318-second sample, not a p50/p90 comparison. The guest config showed ACP and ACPX disabled and the browser entry retained. No startup deferred restart was observed.

The empty Online chat received: “Give me a five-item agenda for a primary-school staff meeting.” The current driver returned `ANSWERED`/exit 0 at 09:51:31Z. **The journey is FAIL:** transcript metadata proves a cloud `principal.draft_memo` tool result and cloud terminal answer at 09:51:16Z, followed by a duplicate user prompt at 09:51:40Z and four local-model connection errors through 09:52:00Z. The UI claimed the cloud answer came from the device. A pending degradation transaction had outlived the successful original turn. The driver’s early success is retained as a reproduced oracle defect; it is not accepted as Online chat proof.

Both Office helper scripts exited 0. DOCX and XLSX were written through packaged libraries and parsed back successfully (four assertions). This proves packaged helper functionality, not model-driven Office acceptance.

Two native app-window recordings were pulled and host-verified: each is 120 seconds, 1280×800, with ten extracted frames and matching guest/video hash. Startup clip SHA256: `4d42246e6ed9d0b629eea9eb70e7fc4e31746c786b022c4da4169d568bb9f1a1`; chat clip: `b0992bb90067d8fb2cc1f056513f86d8fb3c4318e758fdf37dfc7fb3b164bf56`. They are capture evidence only; the chat clip ends before the late replay, which is established by the subsequent screenshot and transcript. Raw screenshots, transcripts, logs and clips stay private under `artifacts/windows-vm/20260907-runtime/`.

## Publication preparation

The pilot GitHub repository is public. Its available cloud seed secrets would be embedded by the previous package workflow even when `requireCloudGatewaySeed=false`; that flag only tolerated missing secrets. No seeded artifact was uploaded in this continuation. Hosted packaging now has a reviewed explicit keyless public profile and source-bound provenance. Publication also requires report, required execution and installed observation timestamps within 24 hours; source tests and negative controls passed. No hosted build has run yet. Post-install provisioning, clean-source acceptance, representative Windows coverage and held credential rotation remain release dependencies.

## Warm startup and Microsoft session observations

A normal quit and relaunch at 10:02:35.201Z reached first RPC-ready/enabled-composer at 10:05:46.291Z: **191.1 seconds**, then remained ready for 20 seconds. The single Gateway child used about 204.75 CPU seconds and read 1.606 GB in 397,196 operations. This separate warm sample rules out treating the delay as installation-only overhead. Built-in plugin profiling is the next diagnostic; no timeout or feature policy was changed to make this sample pass.

Through the actual installed Electron Host API, Forms listing returned two configured forms. Outlook opened Chrome successfully, then read-inbox returned `needs_signin` at 09:59:15Z. This establishes the current authentication dependency. It does not establish inbox, draft or form-preview acceptance; no email or form was sent.

The first revised standalone RPC helper completed the WebSocket handshake but was denied `system-presence`. The corrected helper uses the bundled server's local backend identity and least-required `operator.read` scope. Root copied that exact embedded helper and ran it with bundled Node against the existing stable installed Gateway: challenge, handshake and RPC all passed, exit 0. Full standalone producer startup remains a separate next-candidate check.

The chat acceptance driver now requires exact renderer lifecycle signals, blocks missing signals and late errors, and supports an explicit expected channel. Unit regressions and the Electron visualizer E2E passed. These source changes are newer than the moe.20 installer; rerunning the stricter driver on that older binary must block missing signals rather than certify it.


## Startup CPU diagnosis — 10:39–10:44Z

Built-in startup trace isolated the gap: initial plugin bootstrap took about 3.7 seconds, and sidecars completed in 328 ms. The Gateway declared ready while inexpensive RPCs still timed out. A temporary CPU profile of the actual installed Gateway recorded 218 seconds, including about **143 seconds in the pricing-cache refresh path**: it canonicalizes every model in the external OpenRouter catalog through provider plugin resolution. Repeated plugin discovery and filesystem operations occupy the Gateway event loop. This measured stack supersedes the earlier sidecar and renderer-ingress hypotheses.

The exact original runtime entry was backed up, the app quit normally before instrumentation, and the entry was restored after collection with matching SHA256. The temporary task was removed. The VM remains running; the app is stopped pending the next candidate. The instrumented run is diagnostic evidence only. Raw CPU data and restoration receipts remain private.

The next candidate already skips Windows shell-completion generation, which is unused on that platform. The pricing-refresh defect requires a separate bounded repair and fresh installed timing. Neither longer readiness timeouts nor a broad plugin allowlist establishes a fix.

The upstream project has reports of the same pricing-bootstrap class ([Windows stall](https://github.com/openclaw/openclaw/issues/72971), [boot-time pricing dependency](https://github.com/openclaw/openclaw/issues/73329)). Our CPU profile identifies plugin normalization as the measured cost in this installation; those reports are corroborating context, not our timing evidence. Current [OpenClaw cost documentation](https://docs.openclaw.ai/reference/token-use) describes a newer hosted-catalog path and `models.catalogRefresh.enabled`. The pinned April bundle lacks that switch, so setting it alone would not repair this candidate.


## Pricing repair diagnostic — September 7, 11:04 UTC

The pinned OpenClaw pricing patch now gates plugin-aware remote model normalization to the providers and normalized IDs needed by configured references. Provider-only alias canonicalization uses the existing pure provider normalizer. Exact OpenRouter match priority, configured aliases, nested wrapper references and LiteLLM fallback remain covered by tests. Packaging checks the pinned version and the complete patch snippets, including helper definitions, and fails on partial application. Independent review cleared this bounded repair; the actual local bundle verifier passed.

For an isolated Windows comparison, the existing moe.20 app was stopped and its pricing chunk backed up before replacing only that chunk. The original chunk SHA-256 is `b92dbf549865378867da5205940aa256a77acf1b99137f262d1f158ac42ef69e`; the diagnostic patch is `27e3c6369067b204a59a3488038a4c5243a5da4e91e83d0809260b8f28f3b663`. The CPU-profiler entry instrumentation from the preceding investigation was already restored.

The first diagnostic's observer started late, so its first-ready sample establishes an 84.2-second upper bound from launch. A repeated warm launch at **11:02:43.302Z**, with the observer running from launch, first observed Gateway ready and enabled Online composer at **11:04:07.473Z**: **84.171 seconds**, versus **191.090 seconds** for the preceding unpatched warm run. Gateway CPU time was 82.3 seconds at 11:04:19Z. This reduces observed warm startup by 55.9%, with one comparable repeat and no statistical latency claim.

This comparison is diagnostic evidence on a reused Server 2022/admin installation. The moe.20 app still includes the Windows shell-completion child and predates the session lifecycle/strict terminal-driver changes. It is not the next release artifact or proof of an acceptable first-user experience. Rebuild, exact installer identity and full installed acceptance remain required.

At **11:05:10.369Z**, the app was quit normally and the diagnostic pricing chunk was restored. The restored hash matches the original hash above. The VM remains running under the existing shutdown hold; the installed app is stopped.


## Source freeze validation — September 7

The completed lifecycle repair separates the user’s global channel choice, an acknowledged session model pin and pending recovery operations. A cloud final cancels stale fallback replay. Clearing an obsolete pin requires the bundled Gateway’s actual acknowledgement and preserves newer pin/notice ownership. Pending recovery remains visible when a new turn replaces its notice. Independent pricing and lifecycle reviews are clear.

Final source checks passed: **201 test files, 1,989 tests passed and 6 skipped**; typecheck passed; lint has **0 errors and 52 existing warnings**. Communication replay and comparison passed with no baseline regression. Harness CI passed its 16 harness, 5 direct Office and 61 eval checks; 9 eval skips remain explicit. Task validation and selected-flow dry run passed against the task-start commit. The frontend build and focused Electron test for held clear followed by a new send passed. The actual local OpenClaw bundle verifier passed, including the synthetic PDF and pricing patch guards.

These results freeze the source for the next Windows build. They do not establish GA readiness: no moe.21 installer exists at this checkpoint, and installed chat, representative Windows, tenant and full release acceptance remain outstanding.

## Native Windows preflight — September 7

The reviewed public source snapshot `7cfad9bde5692f84f25b9d441ed83952ef5d835f` was pushed to `release/moe21-reviewed`. Private project history, recordings and tenant evidence were excluded from that snapshot. The [native Windows run](https://github.com/dmvevents/clawx-pilot/actions/runs/34115779033) used the explicit keyless profile and stopped during preflight: 16 files failed, 185 passed; 92 tests failed, 1,756 passed and 5 skipped. No installer was produced.

The dominant failure is reproducible with the pinned Vitest loader: an LF shebang module imports successfully, while the identical CRLF module throws `SyntaxError: Invalid or unexpected token`. This matches the documented [Vite CRLF shebang defect](https://github.com/vitejs/vite/issues/23034). The repository now specifies LF source checkouts, preserves native `.cmd`/`.bat` endings and treats PDFs as binary. A real Git checkout with `core.autocrlf=true` preserved the checked executable module, PowerShell and shell source bytes and the PDF SHA-256; its command-script control used CRLF.

The remaining process fixtures now invoke the real Node CLI instead of a POSIX package launcher, and use a Node argv recorder through the actual PowerShell helper. Only the Bash controller executions are scoped to POSIX hosts; Windows PowerShell and embedded Gateway probes stay enabled. Five focused test files passed all 55 tests locally. Native Windows preflight and installed acceptance remain required; these repairs do not establish a candidate or release verdict.

The [second native run](https://github.com/dmvevents/clawx-pilot/actions/runs/34117459118), source `6c2834cbf666754e3fa8bdb936ceb45e7712c493`, cleared those import and process-execution failures: 199 files and 1,982 tests passed, with 11 explicitly skipped tests. Two integration cases exceeded Vitest's five-second default. Cold PDF initialization took 17.328 seconds; subsequent corrupt/valid PDF calls took 132/31 ms. That first real-parser test now has a 30-second bound with unchanged refusal assertions. The GCP mock-controller tests now have a 12-second subprocess limit inside a 15-second test limit; their closed-port negative control stays active. These are test execution limits, not a change to product timeouts or an accepted application latency budget. Both focused files passed all 34 checks locally. Packaging still produced no installer; another native run is required.
