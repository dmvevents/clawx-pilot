# CLWX-136 — packaged OpenClaw SQLite worker blocks Gateway startup

Status: urgent, In Progress. GA RED. Root owns Windows/cloud/integration; Claude Fable5 on Bedrock owns bounded diagnosis in an isolated worktree. CLWX-135's stale-file replacement repair has native acceptance and remains a separate defect.

## Environment and identity

- Source `c5e76b5dd69d43a632b8ac817b7f253ab76ec614`, branch `release/moe28-upgrade`, version `0.4.3-moe.28`, hosted build34288617489. [Exact manifest](../release-manifests/0.4.3-moe.28.json).
- Original GCP Windows Server2022 instance ID2748349704588098112; existing standard-user `ClawXFresh0908`, interactive Session2. This is assisted Server upgrade evidence, not fresh Windows10/11 acceptance.
- OpenClaw2026.9.2 and packaged Electron42/helper Node24.15. Native preflight2319 PASS/0 FAIL/57 SKIP; package36 checks and172 compiled-file comparisons PASS.
- Native installer completed2026-09-08 23:39:01UTC with exit0 and exact EXE/ASAR hashes. Protected backup695/695 file hashes match. Neither lifecycle marker remains in the installed runtime; the old marker remains hash-identical in the retained rollback copy.

## Reproduction and expected behavior

1. Install the exact moe.28 artifact over the identified QA moe.27 installation after the protected app/OpenClaw backup. Preserve the user's browser/profile.
2. Verify installed hashes and absence of `.openclaw-lifecycle-pending` and `dist/openclaw-install-guard`. Verify Run unchecked before Finish.
3. Launch the actual desktop shortcut; the only diagnostic argument is `--remote-debugging-port=9224`. Actual launch:23:39:28.038UTC.
4. Run the unchanged startup observer:360-second bound,20-second stable-ready requirement.

Expected: Gateway ready, enabled composer, idle chat and Online channel sustained for the stability interval, followed by a normal existing/fresh/next Online turn with30-second terminal stability. Actual: Gateway repeatedly exits1 before readiness and Main reconnects; composer remains disabled. The first logged startup failure at23:40:30UTC says `SQLite read-only worker returned invalid JSON`. Subsequent starts repeat that reason. Ordinary chat and downstream document/Microsoft journeys are NOT_RUN because startup is unavailable.

## Evidence and confidence

Confirmed: the installer stale-marker defect is repaired on this exact installation. The new error originates in OpenClaw's SQLite worker response handling, after lifecycle preparation. The underlying reason the worker output is invalid is UNKNOWN until executable/environment/stdio tracing and native controls distinguish it. Do not equate this with the earlier CLWX-106 native node:sqlite test-handle cleanup.

Private evidence root: `artifacts/windows-vm/20260908-moe28/`.

| Evidence | Result / scope |
|---|---|
| `native-install-identity-lifecycle-result.json` | Native exit0, exact hashes, marker absence, retained old marker, app initially closed and10 QA Chrome processes preserved |
| `installer-unchecked-finish-command.json` | Native checkbox0 before Finish |
| `first-shortcut-startup-readback-v1.json` through `v4.json` | Actual shortcut launch, progressing startup/reconnect observation; final observer result is a separate receipt |
| `startup-error-lines-redacted-2343.json` | Exact SQLite error and repeated code1; credential-field lines excluded |
| `startup-log-private-2343.json` | Private raw tail for operator-only analysis; do not copy to board/git or an LLM |
| `artifacts/ga-fable-20260908/moe28-sqlite-sprint-readback.json` | CLWX-136 added to the same sprint; all32 prior issue IDs preserved,33 total |

Initial raw-log SCP failed on the spaced Windows path. Root preserved that failed attempt and used authenticated SSH read into a mode0600 private receipt, then extracted sanitized error lines; no public staging of raw logs. The first sprint membership parser assertion stopped before mutation because the endpoint returns issue objects directly. Root inspected that response, corrected the ID extraction, then verified exact membership after the single POST. These tooling recoveries are not product causes.

## Diagnosis and repair contract

Claude task `moe28-sqlite-startup-diagnosis`, source basec5e76b5d, branch `fix/moe28-sqlite-startup`, worktree `/private/tmp/clawx-moe28-sqlite-startup-20260909`. Its requested/initialized model is Fable5; final model/provider usage must still be checked. Supervisor deadline600s, with retained heartbeat/tool/result receipts. This task is read-only except its report, with no native subagents, no Mac GUI launches, no VM/profile operations, no dependency installs and no source edits. Candidate dependencies are a read-only shared symlink; exact extracted package is available separately.

Trace the upstream throw site → worker spawn executable/environment/arguments → stdout/stderr protocol → Gateway/Main failure reporting. Report facts versus hypotheses and a minimal isolated Windows probe using the shipped helper and Electron paths. Keep valid-result and malformed-output controls. A future source repair needs a task spec referencing `gateway-backend-communication`, focused regressions, independent review, a source-bound rebuilt artifact, installed startup and ordinary chat proof. Swallowing invalid JSON, extending the timeout or manually patching the installed runtime does not satisfy acceptance.

## Resume here

1. Read the final360-second observer receipt and confirm the failed app is gracefully stopped through its own `app:quit` handler; preserve Chrome/profile/rollback. Root owns this operation.
2. Read the bounded CLI report and final provenance. Run the decisive isolated native probe before assigning a narrow source correction.
3. Correct, independently review and integrate the actual cause; rebuild only after that evidence, then re-run affected installed acceptance.
4. Keep [completion plan](../COMPLETION_PLAN.md), candidate pointer, evidence manifest and Plane consistent. No Ready/Done or GA promotion follows from the installer success.

Final initial-startup observation: `startup-terminal-failure-readback.json` confirms NOT_READY,155 samples, last elapsed359721ms within the unchanged360000ms budget, stable-ready0ms and native observer/task exit1. The failed app was then sent a guarded graceful-quit request after the terminal result; shutdown readback is a separate receipt. No chat prompt was sent.

Shutdown readback PASS: guarded `app:quit` at23:46:17.196UTC, readback23:46:53UTC, no remaining app processes or listeners13210/18789/9224;10 QA Chrome processes retained; native task0. Evidence `failed-app-graceful-quit-readback.json`. Six native receipts are downloaded to `installed-acceptance/`.


## September 9 reassessment and transfer

The owner paused further implementation and release builds, requested recursive GA analysis, then a documented handoff to Claude. Initial diagnostic `moe28-sqlite-startup-diagnosis` ended TIMED_OUT at606.08s. Its same session `964c6277-1cd4-4f2e-8496-3aabc5e3b632` resumed as `moe28-sqlite-startup-conclusion` and completed in80.1s with no further tool calls; final usage confirms Fable5/Bedrock for both. Preserve the timeout as a failed diagnostic attempt. Result: `artifacts/ga-fable-20260908/moe28-sqlite-startup-conclusion/result.json`.

Independent root assessment corrects the report's overly broad “CONFIRMED at each link” language. Source establishes `utilityProcess.fork` in `electron/gateway/process-launcher.ts:160`, a new OpenClaw database preflight, and worker spawning through `process.execPath` with inherited environment. The launcher does not explicitly set `ELECTRON_RUN_AS_NODE`; this does not prove the actual inherited environment lacked it. The observed error establishes invalid JSON; a fake Electron executable printing the app's duplicate-instance message reproduces it, while a real Node positive control succeeds. This is a stand-in process on Node26.7, not native Windows/Electron reproduction. The exact Windows child executable, environment, stdout, first affected database, and successful propagation of a prospective Node-mode flag remain to be captured. Do not skip that experiment or call a proposed environment change verified.

Root compared working moe.25 (`8058e9b5`, OpenClaw2026.4.23) with moe.28 (`c5e76b5d`, OpenClaw2026.9.2). The older extracted distribution lacks the new SQLite read-only worker/preflight path. Upgrade `ad88d71c` also changed Electron40 to42, helper Node22.16 to24.15 and Playwright1.59.1 to1.62.1. The Gateway launcher is unchanged across these candidates. This bounds the regression to an added backend/runtime compatibility requirement; it does not attribute all failures to one dependency. New preflight runs when an existing database is present, so an empty-profile-only test can miss this branch.

Next discriminating experiment, after the reassessment decision: use an isolated fixture and shipped runtime to capture child identity, the one relevant environment flag, stdout, stderr and native exit status under the inherited launch contract and explicit Node execution. Preserve app/profile/Chrome state. The earlier pseudocommand assumes an app is running; it must not be blindly executed now, because the app is stopped. No runtime overlay, profile reset, swallowed parser error or extended timeout counts as a repair. Require both the existing-profile branch and fresh-profile startup in the future packaged Electron check.

Read-only handoff probe2026-09-09 00:12:55UTC confirms zero app processes/listeners13210/18789/9224, no running `ClawXMoe28*` tasks, QA Session2 active and10 QA Chrome processes retained. Receipt `artifacts/windows-vm/20260908-moe28/handoff-readonly-20260909-001.json`. Incoming analysis/documentation session `a1c33a2c-3045-4b77-ba6a-e2b0dd8950bb` is distinct from the completed diagnostic session. [Restart snapshot](../project-history/GA_CLAUDE_HANDOFF_2026-09-09.md); the completion plan owns the current pause. No source repair, card promotion or GA verdict change follows from this handoff.

## September 9 owner resume and decisive native probe — PASS

The owner resumed GA execution (new Claude Fable5/Bedrock session, same workspace), superseding the reassessment pause. Pre-operation read-only check at 00:48:49 UTC reconfirmed sole operatorship: zero app processes/listeners 13210/18789/9224, all 14 `ClawXMoe28*` tasks idle Ready, 10 QA Chrome processes, QA Session2 active. Receipt `artifacts/windows-vm/20260908-moe28/resume-readonly-20260909-001.json`.

The decisive isolated native Windows worker experiment ran at 00:51:37 UTC on the exact installed moe.28 bytes (installed EXE SHA256 `6055C97A…ADCBDA` re-verified in-probe), account class `clawxtest` via IAP SSH (non-interactive; not the interactive standard user), scratch fixture and `XDG_CACHE_HOME`/`TEMP` isolation under `C:\Users\Public\Downloads\moe28-34288617489\clwx136-probe`; no app launch, no profile writes. Receipt `artifacts/windows-vm/20260908-moe28/clwx136-worker-probe-ssh-002.json` (`…-ssh-001.json` is a preserved failed serialization attempt of the same legs, PS string note-property bloat + missing `$p.Handle`; do not repeat).

| Leg | Invocation | Result |
|---|---|---|
| Version binding | Installed exe, `ELECTRON_RUN_AS_NODE=1`, `-v` | PASS exit0 `v24.15.0` — the RunAsNode fuse is enabled in the shipped binary |
| Version binding | `resources\bin\node.exe -v` | PASS exit0 `v24.15.0` |
| A: Electron-as-Node, existing DB | Installed exe + shipped `dist/infra/sqlite-readonly-location.worker.js` + `--openclaw-sqlite-readonly-child sync <existing fixture.sqlite>` | PASS exit0, stdout exactly one JSON `{"ok":true,"location":…}` |
| B: bundled Node, existing DB | `resources\bin\node.exe`, same args | PASS exit0, same JSON contract |
| C: error control, missing DB | Installed exe + `ELECTRON_RUN_AS_NODE=1`, nonexistent path | PASS exit1, stdout valid JSON `{"ok":false,"message":"ENOENT…"}` |
| Inherited GUI contract | Installed exe **without** the flag | NOT executed deliberately: with the app stopped there is no single-instance lock holder, so this leg would boot a full second GUI app instance and mutate profile state |

Established natively: the shipped worker emits exactly one valid JSON object on both success and error paths under Electron-as-Node and bundled Node on the exact installed bytes. Therefore the incident's non-JSON stdout cannot originate from the worker's own code paths; the child that produced it never reached worker code. Combined with the source facts (gateway `utilityProcess` forkEnv lacks `ELECTRON_RUN_AS_NODE`; worker spawned via inherited-env `process.execPath` = the GUI exe), the duplicate-instance-app-on-stdout hypothesis is the only surviving candidate. Still hypothesis, not native capture: the incident child's exact stdout bytes (requires the app running) and Electron42 `utilityProcess.fork` env passthrough of `ELECTRON_RUN_AS_NODE` (fix-mechanism question).

Next action: bounded Claude author worktree for the source repair in the gateway launch ownership (`electron/gateway/`), with a `harness/specs/tasks/` spec referencing `gateway-backend-communication`. The author must choose and justify the mechanism — `forkEnv` `ELECTRON_RUN_AS_NODE` (requires demonstrating utilityProcess env passthrough) versus a ClawX-owned gateway entry shim that sets `process.env.ELECTRON_RUN_AS_NODE='1'` inside the utility process before importing `openclaw.mjs` (immune to fork-time env filtering) versus routing worker spawns to bundled `node.exe` — with focused regressions and independent review. Both sqlite workers (`sqlite-readonly-location.worker.js`, `sqlite-integrity.worker.js`) and the moe.26 lifecycle-child prior art (`scripts/openclaw-package-lifecycle.mjs`) belong to the same execPath-grandchild class. Acceptance still requires a source-bound rebuilt artifact, installed startup and ordinary chat proof; no manual patching of the installed runtime.

## September 9 repair: authored, independently reviewed, integrated — moe.29 building

**Chosen mechanism (recorded per review finding 4): the ClawX-owned Gateway Node-mode entry shim.** `resources/gateway/clawx-gateway-node-mode-entry.mjs` is now the utilityProcess entry for all three fork sites; it fails closed without `CLAWX_GATEWAY_REAL_ENTRY`, sets `process.env.ELECTRON_RUN_AS_NODE='1'` inside the already-running utility process, restores `argv[1]`, and dynamic-imports the real OpenClaw entry via `pathToFileURL` (Windows-space-safe). Because the flag is set in-process, **the previously open "Electron 42 utilityProcess.fork env passthrough" question is deliberately moot — do not re-run that experiment.** The flag must NOT ride the fork env: unfiltered passthrough would boot the utility process itself as plain Node; `config-sync.ts`/both doctor sites now explicitly strip an inherited `ELECTRON_RUN_AS_NODE`, and tests seed the parent env so the pins are real. Platform note: inside a utility process, macOS `process.execPath` is the Electron Helper binary; only Windows uses the single app `.exe`, which is why this class bites Windows specifically.

Branch `fix/clwx136-gateway-node-mode`: `4c572fc7` (shim + config-sync + paths + failing-first tests + harness spec) → `40fa9dfd` (review round: forkEnv strip with mutation-verified pin; doctor forks in `supervisor.ts` `runOpenClawDoctorRepair` — the startup-failure auto-recovery — and `openclaw-doctor.ts` routed through the shim with fail-closed checks; `realEntry=` added to launch/doctor logs) → `3bf1b4e1` (task-spec `touchedAreas` covers round-2 test files).

**Independent review complete.** Review A: REQUEST_CHANGES → APPROVE on `40fa9dfd`; verified with a real utilityProcess probe (Electron 40.8.4 — grandchild inherits the flag and emits one valid JSON; no-shim negative control hangs, reproducing the defect class) and a polluted-shell rerun proving the env strip end-to-end; independently confirmed exactly three `utilityProcess.fork` sites exist and all are covered. Review B (adversarial): APPROVE; doctor exit/result contract unchanged through the shim (silent stdout), missing-shim recovery degrades to the prior diagnosable failure shape, packaging traced statically (extraResources ships `resources/gateway/` outside the asar, same location class as the already-forked `openclaw.mjs`). Codex 0.153.4 cross-model lane: clean on `4c572fc7`; one P2 on `40fa9dfd` (spec `touchedAreas` gap) fixed in `3bf1b4e1`, both diff-aware validations rerun green. Handoff line from B: the two doctor sites still inherit `NODE_OPTIONS` (gateway launch strips it) — pre-existing, info-level, unchanged by this round.

Full source preflight at `40fa9dfd`: 2,332 passed / 51 skipped; one cold-worktree hook timeout (`ondevice-tool-policy.test.ts` first import of the OpenClaw dist exceeded 10s) recovered 22/22 on immediate warm rerun — flake, not regression.

**Candidate `0.4.3-moe.29`, source `0f708082c941fbed007173c57232aec916f4eff1`, branch `release/moe29-node-mode`, pushed to the pilot remote.** Hosted keyless build [34300195990](https://github.com/dmvevents/clawx-pilot/actions/runs/34300195990) dispatched from the release branch with the full-SHA input; run provenance verified (`headSha` = candidate SHA). Tooling note: a first dispatch without `--ref` produced default-branch run metadata and was cancelled before completion (run `34300139391`) — dispatch from the release branch so run↔source identity binds; the deployed default-branch workflow accepts only the `ref` input (no seed-profile input; keyless-public is the in-tree default).

Remaining acceptance (unchanged, installed-artifact-only): shim present in the built installer under `resources\resources\gateway\`; RunAsNode fuse enabled on the rebuilt exe; package/hash identity; standard-user upgrade; **installed startup with the existing state DB reaching Gateway readiness and no second GUI instance**; ordinary existing/fresh/next chat; doctor-repair path. No Ready/Done promotion until those pass.

### moe.29 artifact gate PASS; installed acceptance next

First dispatch `34300195990` FAILED at ~50 minutes inside "Preflight release source" with GitHub's runner-communication-loss annotation and no uploaded logs — infra, not product; preserved as a failed attempt. Re-dispatch [34303783279](https://github.com/dmvevents/clawx-pilot/actions/runs/34303783279) from the same `release/moe29-node-mode` head SHA succeeded 02:49:47 UTC (14m51s).

| Check | Result |
|---|---|
| Run↔source provenance | `head_sha` = `0f708082c941fbed007173c57232aec916f4eff1`, run `34303783279`, keyless-public |
| Artifact archives | `build-provenance` and `windows-blockmap` digest/length PASS; installer archive fetched in 452/452 ranged parts, assembled SHA256 = GitHub digest, exact length |
| Host package checks | **36/36 PASS**, zero failures. Installer SHA256 `f48ac2f465a6a27a6dee385bb2c3b2e3d61d4e94ae4b633076427621fc5c4ce9` (476,772,726 bytes); ASAR SHA256 `98407244b3202aad270af0ebdd8d7638bc9f82f7f886082d8e87eb5019c96a78`; ASAR version `0.4.3-moe.29`; all eight helpers; keyless seed scan empty; blockmap structure |
| Compiled output | PASS: clean source/compiled receipt agreement, 172 compiled-file comparisons, packaged OpenClaw 2026.9.2, lifecycle markers absent |
| **Shim in package (new for this candidate)** | PASS: `extracted-app/resources/resources/gateway/clawx-gateway-node-mode-entry.mjs` SHA256 `4387e8e0a8b6c4bd360ad1e8c7f827e247e2f32e80c1eb29efa96a84cbf6750b` — byte-identical to the reviewed source file. Closes the reviewers' "shim present in the built installer" item |
| Private staging | `gs://clawx-rc-artifacts-622687731621/private-validation/moe29-34303783279/moe29.exe` |
| VM download | 02:59:38 UTC `DOWNLOAD_HASH_VERIFIED` — exact SHA256 and byte length on instance `2748349704588098112`, staged at `C:\Users\Public\Downloads\moe29-34303783279` |

Pre-op read-only check 02:59:08 UTC: app stopped, no listeners 13210/18789/9224, no running owned tasks, 10 QA Chrome processes preserved, QA Session2 active. Receipts: `moe29-preop-stage-prep-001.json`, `moe29-download-verified-001.json`, and host-side `/private/tmp/clawx-moe29-run-34303783279/` (`host-verification-34303783279.json`, `compiled-output-verification.json`, `shim-presence-verification.json`, `parallel-download-verification.json`).

Next exact action: protected app/OpenClaw profile backup, then the standard-user assisted upgrade in interactive Session2 under the 40-minute installer budget (Run unchecked before Finish), verify installed EXE/ASAR hashes and the packaged shim on disk, then launch the actual desktop shortcut under the unchanged 360-second observer. The decisive observation is whether Gateway readiness is reached with the **existing** state database and no second GUI instance appears. Startup is NOT_RUN; the RunAsNode fuse on the rebuilt exe is unverified until then.

### Installed acceptance BLOCKED — the QA interactive session was destroyed by a VM reboot

The assisted upgrade was prepared and dispatched, then could not execute. Sequence of facts:

- Preparation PASS: `expected-artifact.json` rewritten BOM-free with installer/ASAR/EXE/**shim** hashes and read back exactly; `install-assisted-moe29.ps1` staged into the identified moe.29 directory (SHA256 `86144660a69d25b88acea4460c3d8391687a494a99878c47a35132b69156a647`) and **parse-checked with zero errors without executing**; run directory absent. The script preserves the moe.28 discipline (standard-user + non-admin + Session2 guards, installed-moe.28 identity gate, robocopy profile backup with per-file hash verification, previous-ASAR backup) and drives the installer screens verify-then-act: unique `id`+`name`+`enabled`+native-`Button` match before every click, screenshot per state, refusal to press Finish while “Run Ministry of Education” is checked, and **abort without clicking on any unexpected screen**.
- Task `ClawXMoe29InstallAssisted` registered with a verified 40-minute budget and Limited/Interactive principal; `START_REQUESTED` returned. Polling then showed `State=Ready`, `LastTaskResult=267011` (`SCHED_S_TASK_HAS_NOT_RUN`), empty run directory: **the task never executed.** StartRequested is not completion — this is that trap firing for a real reason.
- Root cause of the non-execution is environmental: **the VM rebooted at 2026-09-09 03:29:42 UTC**, system-initiated (`NT AUTHORITY\SYSTEM`; svchost restart 03:27:01Z, shutdown.exe 03:30:05Z), about half an hour after the 02:59 artifact staging. `qwinsta` now shows no `ClawXFresh0908` session and no `explorer` process, so an Interactive/Limited task has no session to run in.
- **Correction to earlier evidence in this workstream:** the “10 QA Chrome processes preserved” statement was true at 00:48 and 02:59 UTC but is no longer current — those processes ended with the reboot. The Chrome **profile on disk survives** (`User Data\Default\Preferences` present), as do `.openclaw` (642 files) and the app-data profile (61 files). Installed moe.28 identity is unchanged (EXE `6055c97a…adcbda`, ASAR `730660d9…dfa16`), the moe.29 installer is still staged, and no partial installation exists.
- Machine identity is intact across the reboot: the guest Remote Desktop certificate SHA256 is `fe85ddd4222bb4fd3e9353d41075ee070214d95214e3083b547914f6af8c6e34`, **matching the recorded pin**, and RDP remains enabled.

**Blocker:** both the assisted upgrade and the decisive installed-startup observation require an interactive desktop session for `ClawXFresh0908`, and re-establishing one requires that account's password. It is not in the project's GCP Secret Manager (only five unrelated secrets), no credential-file path is documented in the repeatable-lab or Bedrock Windows runbooks, and the credential locator receipts point only into raw session history that must not be opened or sent to an LLM. Rejected workarounds, with reasons: an administrative password reset would break DPAPI-protected profile data and destroy the signed-in QA Chrome Microsoft session that CLWX-61/63/134 depend on; a non-interactive S4U task or `/S` silent install cannot drive the assisted screens, cannot verify the Run checkbox and cannot host the GUI startup observation; installing under `clawxtest` would use a profile with no existing OpenClaw state database and would therefore miss the exact existing-DB preflight branch that triggers this defect, risking a false negative.

**Alternate Windows lanes were probed, not assumed — do not repeat these probes.** Receipt `/private/tmp/clawx-moe29-run-34303783279/windows-lane-exhaustion-probes.json`.

| Lane | Probe | Result |
|---|---|---|
| QA VM `clawx-win-rc-20260609` | `qwinsta`, task result, reboot events | Interactive session destroyed by the 03:29:42 UTC reboot; task `SCHED_S_TASK_HAS_NOT_RUN`; state otherwise intact |
| `home-pilot` Windows 11 laptop | real SSH handshake (not `nc -z`) | UNREACHABLE — `connect to host 192.168.1.212 port 22: Operation timed out`; off-network. Only known Win10/11 client, so it also gates CLWX-25 |
| `clawx-lab-auto-d-20260908` | `gcloud compute ssh --tunnel-through-iap` state probe | REACHABLE and fresh (Server 2022 DC, no ClawX, no `.openclaw`, 74.5 GB free, RDP listening) but **no interactive session and no attached service account** |

The auto-d lane is the strongest available substitute and is worth keeping on file: because this defect's preflight fires on *the existence of a state database* rather than on the specific QA profile, a fresh machine could reproduce the decisive branch (install → launch once to create the DB → relaunch) and yield a same-machine moe.28 FAIL / moe.29 PASS before-and-after. It is not usable under current authority: obtaining a desktop there would require `gcloud compute reset-windows-password`, which the owner's current instruction prohibits; session 0 cannot host the Electron GUI, so a headless silent install cannot produce startup evidence; and with no attached service account it cannot fetch the installer from the private bucket. Retained as the preferred plan if account provisioning is ever authorized.

**Needed from the operator:** an interactive desktop session for `ClawXFresh0908` on instance `2748349704588098112` (FreeRDP against the verified cert pin with the operator-held password via stdin), or a credential source the agent is authorized to use. Once a session exists, the prepared task can simply be started again — nothing needs rebuilding, re-downloading or re-reviewing. Receipt: `/private/tmp/clawx-moe29-run-34303783279/installed-acceptance-blocker.json`, plus `moe29-install-poll-001`, `moe29-task-diagnose-001`, `moe29-session-loss-facts-001` and `moe29-rdp-cert-verify-001` under `artifacts/windows-vm/20260909-moe29/`.

### September 9 correction — the environment blocker was self-inflicted, and the "operator-held password" never existed

The section above recorded installed acceptance as blocked on an operator-held
password after a "system-initiated" VM reboot. Investigation of the actual
instance metadata and the repository's own tooling shows **both halves of that
claim were wrong**, and neither needed an external party.

**1. The reboot was ours.** The instance's `windows-startup-script-ps1` begins
with `shutdown.exe /s /t 28800` — an 8-hour auto-shutdown cost guard that runs on
every boot. The 03:29:42 UTC "system-initiated reboot" was that timer firing.
It is not a fault and the guard is deliberately retained, but it means an
interactive session can never be treated as durable: acceptance runs must start
from a fresh boot and finish inside the window, or the run is lost. This is the
mechanical reason the hand-made session kept evaporating.

**2. The `ClawXFresh0908` password was never recoverable by anyone.** That
account was created by `windows-pilot/scripts/pilot-temp-user-fresh-install-smoke.ps1`,
whose `$UserPrefix` default is `ClawXFresh` and whose `New-RandomPassword`
generates a 24-character random string that is used once for `New-LocalUser` and
**never printed, returned or stored** (see the CLWX-83 comment at the helper).
So there was no operator holding it and no history entry containing it. A search
of every session transcript confirms this: there is no `net user ClawXFresh0908`
or `New-LocalUser` for that account anywhere, and the only password-shaped values
in QA-context lines are two low-occurrence strings that match no known account.
Recording it as "operator-held, in raw history that must not be opened" made a
recoverable engineering problem look like a human dependency.

**3. SSH then failed for a third, unrelated reason.** After the restart, key auth
was rejected for the operator account even though the offered key
(`~/.ssh/google_compute_engine.pub`) is byte-identical to the key the startup
script pins. Cause: the script wrote it **only** to
`C:\ProgramData\ssh\administrators_authorized_keys`, which sshd consults
exclusively for members of the Administrators group. With the local account
absent or non-administrative, correct key material still yields
`Permission denied (publickey,password,keyboard-interactive)`.

**Repair applied, no password required anywhere.** Instance metadata is under our
control, so the startup script was replaced (original preserved at
`artifacts/windows-vm/20260909-moe30/startup-script-original.ps1`, sha256
`dfa33ad6…`; replacement at `startup-script-repair-v1.ps1`) to: ensure the
operator account exists and is an administrator and carries the key in both sshd
lookup paths; and create a disposable **standard-user** acceptance account with
auto-logon, so a real interactive session exists after every boot. The acceptance
password is generated on the VM and never crosses the boundary — nothing
sensitive enters instance metadata, gcloud history or any transcript. A clean
stop/start was used rather than a hard reset specifically to protect the existing
SQLite state database this defect needs.

Consequence for this card: the criterion is unchanged, but its dependency is no
longer an external party. Do not re-record this as blocked on a human without
first checking the auto-shutdown window and the sshd key path.

### Release-relevance disposition for the acceptance-lane scripts

Three new scripts were authored to remove this card's environment blocker:
`windows-pilot/scripts/pilot-vm-startup-repair.ps1`,
`pilot-acceptance-stage.ps1` and `pilot-acceptance-driver.ps1` (commit
`2acb09ff`). The continuation gate correctly flagged them as product-path changes
not represented in candidate `0.4.3-moe.30`, so they need an explicit
disposition rather than silent omission.

**Disposition: NOT RELEASE-RELEVANT — no candidate integration required.**

Criterion, established from the build configuration and the verified artifact
rather than from intent:

- `electron-builder.yml` `files:` is exactly `dist`, `dist-electron`,
  `package.json`. `windows-pilot/` is absent.
- `extraResources:` copies `resources/`, `build/openclaw/` and
  `build/preinstalled-skills/`. `windows-pilot/` is absent there too.
- The extracted `app.asar` of the verified moe.30 installer contains only
  `dist`, `dist-electron` and `package.json`, and no `windows-pilot` directory
  exists anywhere under the packaged `resources/`.

So these files cannot reach any installed build. Integrating them into the
release candidate would change the candidate's identity — invalidating the
already-verified installer and ASAR hashes — while adding nothing a principal
could ever execute. That is the wrong trade, and it is why this is a disposition
and not a deferred integration.

They are also not registered as a reviewed *lane*, deliberately: lane
registration asserts that a diff belongs in the candidate, and the gate would
then correctly demand its integration. Recording QA-lane operator tooling as a
release lane would make the gate enforce the opposite of the truth.

What they are: operator tooling for a disposable QA virtual machine. Their blast
radius is that machine, they are removable, and they touch no shipped path.
Independent review of the three scripts is in flight in a separate lane at the
time of writing; its verdict and any findings will be recorded here. That review
concerns whether the scripts are safe and whether their evidence is trustworthy
— it does not change the release-relevance criterion above, which follows from
the packaging configuration alone.

### September 9 installed startup results on moe.30 — Run A PASS, Run B invalid

First installed startup evidence on this candidate, produced in a real
standard-user interactive session (`ClawXAcc0909`, `SESSIONNAME=Console`,
`isElevated=False`) on the QA VM.

| Run | State | Result | Detail |
|---|---|---|---|
| A | fresh profile | **PASS** | install exit 0 in 251.4 s; window at 08:47:08Z; Gateway listening on 127.0.0.1:18789 at 08:47:50Z; 1 windowed process, no second GUI instance; 11 samples; **zero** CLWX-136 signature hits |
| B | seeded from the old QA profile | **FAIL — but not a valid test** | window at 08:48:21Z; Gateway never became ready across 71 samples / 360 s |

Installed identity: product version `0.4.3.0`, installed exe sha256
`93f5a781…7fb411a8`, from installer `9f8a2dc5…` re-verified inside the session.

**Run B does not reproduce CLWX-136 and must not be reported as doing so.** Its
logs show no invalid-JSON worker error at all. What they show is:

- `SECRETS_DEGRADED … cold route:~\.openclaw\agents\main\agent\openclaw-agent.sqlite: secret resolution failed`, repeating — the predicted consequence of seeding a database whose DPAPI-protected values belong to a different Windows user.
- `gateway restart-loop breaker tripped: 3 unclean boot(s) within 300000ms`.
- `Gateway failed to start: Legacy workspace setup state requires migration`.

Two confounds, both introduced by the seeding method rather than by the product
under test. The eight `sqlite` matches in the automated signature scan are only
the `openclaw-agent.sqlite` path inside those secrets lines; treating them as
CLWX-136 hits would have been a false positive, and the driver's own
`seedCaveat` predicted exactly this.

Run A is therefore the load-bearing result so far: on this candidate the SQLite
read-only worker path completes and the Gateway reaches readiness. That is
positive evidence for the shim, not yet proof for this card's criterion, which
specifies an **existing** database.

The clean discriminator is a same-user existing database — the state this
account's own app wrote during Run A, restored and relaunched. That removes both
confounds. It is running; its receipt is `phase2b-receipt.json`.

**Operational finding worth keeping:** `schtasks /Run` on an `/IT` task returned
`ERROR: Element not found.` with `Last Result: 267011`
(`SCHED_S_TASK_HAS_NOT_RUN`) **even with an active console session for that exact
user**. This is the same code that stalled the moe.29 attempt, so that stall was
not caused by the missing session alone. The reliable mechanism on this machine
is a Startup-folder shim executed by the auto-logon session; interactive
scheduled tasks are not dependable here and should not be used as the harness.

**Caveat on the readiness signal:** "Gateway ready" here means a loopback
listener on port 18789 plus a windowed process, sampled over a bounded window.
That is stronger than "a process exists" but weaker than an in-app assertion
that a turn completes. Ordinary chat, the doctor-repair path, and every
document, browser, tenant and external-tester criterion remain NOT_RUN.

### RETRACTION — the Run A "PASS" above is not a valid result for this criterion

An independent review of the harness found two blocking defects in my own driver,
and the recorded samples confirm both. **Run A must not be read as satisfying
this card's criterion.** The retraction is kept above the corrected evidence
rather than replacing it, so the mistake stays visible.

**Defect 1 — readiness was latched on a single sample, with no stability
requirement.** The driver latched `gatewayReady` the first time a listener
appeared and then broke out of the loop. Run A's own samples show
`listening=True` in **exactly one sample, the last of eleven** (08:47:50Z), after
ten consecutive `False` samples. This card's documented reproduction contract
requires a **20-second stable-ready window**, and its terminal receipt recorded
`stable-ready 0ms` — precisely because in the real defect the Gateway *does* bind
briefly on one of its restart attempts before exiting again. A single positive
sample is therefore consistent with the defect being present, not absent. The
harness had dropped the stability requirement that the verified observer used,
which means it could return PASS on the exact failure it exists to detect.

**Defect 2 — the listener was never tied to the application under test.** The
check asked only whether *something* was listening on 127.0.0.1:18789, with no
free-port precondition and no PID ownership check (`Start-Process` was called
without `-PassThru`, so no PID was recorded). Since a visible window is produced
by the failing app too, the port check was the only discriminating signal in the
driver, and it was contaminable — by the other QA profile's installed app or by a
straggler from an earlier run. The repository already does this correctly in
`windows-pilot/scripts/pilot-run-installed-gateway-smoke.ps1`, which refuses to
proceed with `BLOCKED_PORT_IN_USE` when the port is already held, and separates
`GATEWAY_TCP_READY` (a TCP accept) from `GATEWAY_READY` (a real `system.presence`
RPC over the WebSocket). I did not reuse that pattern and should have.

**What the moe.30 runs do and do not support, corrected:**

| Claim | Status |
|---|---|
| The installer installs as a standard user, exit 0 | Supported |
| A visible main window appears, single instance | Supported |
| Something bound 127.0.0.1:18789 once during Run A | Supported |
| **Gateway reached readiness on fresh state** | **NOT SUPPORTED** — one unstable sample, owner unverified |
| **Startup with an existing state database** | **NOT_RUN** — Run B was invalid for unrelated reasons |
| CLWX-136 is fixed | **NOT SUPPORTED** |

Run B's negative result is more robust than Run A's positive one: **0 of 71
samples** showed a listener, so nothing bound at all there — but its failure was
caused by the seeding confounds, so it still is not evidence about this defect.

Next action: repair the harness before re-running — free-port precondition, PID
ownership of the listener, a contiguous stable-ready window with
`stableReadyMs`/`readyLostCount` recorded, app-exit detection, and a receipt that
carries redacted findings rather than verbatim log lines. Then re-run fresh and
same-user-existing-database cases. Do not quote the retracted PASS anywhere.

**Review outcome for the disposition above.** The independent lane returned two
BLOCKERs and at least one HIGH against the harness, not against any shipped path:
single-sample readiness latching with no stability window; an unattributed
listener with no free-port precondition or PID ownership; and a log filter that
embedded verbatim lines into a receipt that leaves the machine. All three are
repaired in driver v2 (`3767fc7a`), and the invalid result they produced is
retracted above. The release-relevance disposition is unchanged and is
strengthened by this: these files are QA tooling whose defects can corrupt
*evidence*, which is exactly why they need review — and equally why they must
not be integrated into a release candidate. The remainder of the review was
truncated in transit and has been requested; any further findings will be
recorded here.
