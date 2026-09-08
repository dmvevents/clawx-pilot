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
