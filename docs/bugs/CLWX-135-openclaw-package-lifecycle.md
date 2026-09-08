# CLWX-135 — moe.26 OpenClaw lifecycle blocks Gateway startup

Status: confirmed installed regression; urgent release blocker. Owner: Claude Fable 5/Bedrock author in `/private/tmp/clawx-moe26-lifecycle-20260908`, branch `fix/moe26-lifecycle-gate`, base `8bb7a77907faf35fb8fc4136073ce340ea9a9aaa`. Root owns Windows/cloud operations, integration and Plane. Related: CLWX-106/107 package verification, CLWX-125 startup, CLWX-133 release receipt. Independent review and corrected installed result pending.

## Reproduction and impact

On September 8, 2026, install the exact moe.26 artifact from hosted run 34256868050 over the original GCP Server 2022 standard-user QA profile. The normal assisted installer completes; installed ASAR `a81d7dd0cf030df2ab934068aaacf8d5d9edcb70d984c2a07dce72854b7c62bd` and EXE `44ff6a6f90fc5872b38626f544e7f19166185ecf2e5bb607f66dc3ddf386f902` match the verified manifest. Launch the installed Desktop shortcut at 18:45:23.501UTC. CDP 9224 and renderer become available, but Gateway never becomes ready and the chat composer stays disabled through the 360-second observer.

Expected: prepared packaged backend reaches stable readiness and an ordinary Online prompt completes. Actual: Gateway repeatedly exits with code 1; the app retries and remains unavailable. `first-startup-readiness.json` finishes `NOT_READY`; observer native result 1, last sample 359885ms. This result is distinct from the installer observer's missing native exit, documented on CLWX-25.

The first root observation treated the delay as still unresolved startup, comparable to the previous slow build. Subsequent Host API error and stderr establish a real runtime failure. No chat, Outlook or Forms turn was dispatched on the failed candidate. Root requested a graceful app quit from the verified idle QA renderer to end repeated retries; no broad process kill or marker deletion was used.

## Confirmed evidence versus hypotheses

Gateway stderr repeatedly states:

> OpenClaw package postinstall did not complete its lifecycle marker

Immediate cause is HIGH confidence: `openclaw.mjs` checks `.openclaw-lifecycle-pending` or the legacy install guard before normal CLI startup; `completePendingPackageLifecycle` runs pre/postinstall then throws if a marker remains. Native Windows and the immutable extracted package both retain `.openclaw-lifecycle-pending` (SHA256 `52d26753462488ad21852bc6718e21b84835f53765304d0a1e1b89d05a2a71b1`); the legacy guard is absent. Native postinstall source hash `7e1f81b571636d0f0102ff7120b5de54973a12e1ece8044fe6f608efaf49f061` matches the extracted source.

Artifact comparison explains the changed backend boundary: working moe.25's extracted package is OpenClaw 2026.4.23 with neither marker; moe.26 is OpenClaw 2026.9.2 with the pending marker. Their launcher and postinstall hashes differ. This is not evidence of a Microsoft login or cloud-model credential failure. Why the lifecycle invocation returned without clearing the marker remains UNKNOWN until reproduced; no disabled-postinstall environment override was found in the inspected app source. Direct invocation detection, Electron child execution semantics and package preparation are investigation paths, not established causes.

Native build 2309 tests and all 9 artifact harness rows passed. Their pass did not establish the actual installed launcher lifecycle. The corrective gate must exercise that boundary and reject a pending/incomplete artifact; do not weaken the upstream guard or delete a marker on the installed machine and relabel moe.26 as accepted.

## Repair and acceptance

1. Preserve immutable moe.26 payload and runtime evidence. Reproduce using an isolated fixture copy; do not execute mutating lifecycle scripts against the evidence package or shared node_modules.
2. Trace bundle preparation and actual launcher/child environment against the working artifact. Add the required backend communication task spec before changing owned packaging/runtime code.
3. Complete required lifecycle during package preparation and verify the resulting package, with a pending-marker negative control and actual launcher execution. Repair the narrow owning boundary; no user-side dependency installation workaround.
4. Focused regression checks and applicable lint/typecheck/harness, then independent review. Record source versus native evidence separately.
5. Build one corrected candidate with exact source and hashes. Repeat standard-user shortcut readiness and ordinary chat, then required Microsoft/document/local/recovery/client/stakeholder acceptance. Original moe.26 remains a failed release candidate.

## Evidence and next action

Private root receipts: `artifacts/windows-vm/20260908-moe26/`, especially `gateway-failure-redacted.log`, `gateway-failure-private-tail.json`, `startup-terminal-and-lifecycle-markers.json`, `first-startup-readiness.json`, and quit request/readback. Original payload: `/private/tmp/clawx-moe26-run-34256868050/extracted-app/resources/openclaw`; comparison: `/private/tmp/clawx-moe25-run-34203201042/extracted-app/resources/openclaw`. Raw logs may contain secrets; use only the redacted excerpt for author/reviewer input.

Active supervised task: `moe26-lifecycle-author`, receipt directory `artifacts/ga-fable-20260908/moe26-lifecycle-author`. The independent durable-controller review is a separate operations lane and cannot satisfy this product blocker. GA remains RED.


Native read-only diagnostic (18:59:15UTC) used the installed Electron42 binary as Node with explicit `ELECTRON_RUN_AS_NODE=1`: native exit0, Node24.15.0, environment flag retained, and upstream postinstall's direct-invocation predicate returns true for its exact file path. It did not invoke the product launcher or package cleanup. This rules out a blanket claim that this Electron binary always drops that flag or cannot recognize the postinstall path; it does not explain the actual lifecycle child failure. The author worktree retains `ROOT_NATIVE_OBSERVATIONS.json` privately. Graceful quit readback at18:56:45UTC found no app processes or13210/18789/9224 listeners; QA Chrome PID2748, Session2 remains.
