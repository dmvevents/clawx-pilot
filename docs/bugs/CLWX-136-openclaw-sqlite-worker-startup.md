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
