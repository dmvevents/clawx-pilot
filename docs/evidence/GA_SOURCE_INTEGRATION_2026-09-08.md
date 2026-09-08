# Reviewed moe.26 source and hosted build — September 8, 2026

**Reviewed source PASS; native focused proof PASS; hosted build RUNNING; artifact acceptance NOT_RUN; GA RED.** Current source is clean **`99468423e78d90ef75a49ac5d7b52939caf9e808`**, version `0.4.3-moe.26`, on `release/moe26-plan-execution`. Root verified the same remote SHA and dispatched [run 34255425275](https://github.com/dmvevents/clawx-pilot/actions/runs/34255425275) at 17:09:49 UTC. Profile `keyless-public`, required credential seeds false, publication inputs absent. No installer hash, installation or GA publication is claimed.

## Owned child lifetime repair — 17:09 UTC

Commit `99468423` moves the real registry/PDF checks into a bounded owned Node child. Parent cleanup runs after child exit; success requires exit 0 and a per-invocation nonce proof. Permanent cleanup errors and primary-plus-cleanup failures still surface; F1 falsy throws are normalized at the real catch boundary. Independent Fable/Bedrock review APPROVE: verifier 23 + seed 10 passes, scoped lint and marker/error/real-child controls; root typecheck exit 0. Review receipt: `/private/tmp/clawx-moe26-db-lifetime-review-20260908/artifacts/REVIEW_FINAL.md`.

Root's native proof on auto-d (Server2022, Node24.20.0, locked OpenClaw9.2) binds all changed files plus seed/package/lock hashes. Control A observes the exact temporary SQLite DB cached/open and reproduces rm EPERM. Diagnostic control B closes only that DB (returns true), then rm passes and the temporary root is absent. Product code does not import hashed close APIs. Control C: actual repaired suites PASS **33/33 normal TEMP** (16.22s suite time) and **23/23 short TEMP** (16.35s), each native exit 0. Private command/hash/control receipts: `artifacts/ga-fable-20260908/windows-lab/native-db-root/`.

The author was stopped after an unscoped process-kill command during transfer recovery; its source checkpoint remained clean and independently reviewed. Root reused legacy SCP `-O`, stopped only the exact surviving transfer PID and executed the long script via a transferred file after an encoded-command length failure. These failed attempts and restored original CDP forwards are retained in [CLWX-25](../bugs/CLWX-25-windows-lab-repeatability.md). No new Claude session or repeat dependency installation was needed.

Review N3 corrects an earlier broad inventory claim: pre-existing `assertSameSet` accepts a duplicate name when the expected set is still covered; HostAPI has no additional count guard. This is unchanged by the move and was approved as non-blocking for this delta, but remains recorded on CLWX-106. N2 is a possible POSIX marker-flush false failure (0/300 observed); marker absence fails closed. No false-PASS or native-cleanup finding remains open for this delta.

## Earlier native repair and reviewed retry at 5785e570

Three source-only commits follow `1d745567`: `8fb8bd96`, `409bce89`, then required correction `5785e570`. The final diff touches only the upgrade verifier and its two affected unit suites. The Graph account boundary is mocked while real seed orchestration and three account states remain tested; root found the original hosted log's **15:29:34.603 UTC** stdout explicitly attributes “Downloading Electron binary...” to the timed-out seed case. Exact time inside the synchronous install/download path remains unmeasured. Cleanup now uses bounded recursive-rm retries, surfaces exhausted errors and preserves primary verification errors alongside cleanup failures. The underlying native handle/permission cause remains UNKNOWN.

Independent Fable 5/Bedrock review **APPROVE** at exact `5785e570`: 29 focused tests with explicit exit 0, lint and independent error-path falsifiers. Author also passed six neighboring bundle-fixture tests and typecheck. Reviewer F1 is a minor falsy-throw edge: the current reachable error paths produce Error objects, but a future falsy thrown value could be lost by the truthiness sentinel; retained on CLWX-106, not represented as fixed. Private final receipt: `/private/tmp/clawx-moe26-native-review-20260908/artifacts/REVIEW_FINAL.md`; supervisor `moe26-native-rereview` completed with matching model/provider metadata. Private checkpoint commit `8db5bc5f` is excluded from the product candidate.

The prior author/reviewer sessions timed out and the first detached dependency command did not establish execution. Root inspected state before resuming. A kept-live SSH command then completed the lab dependency install with pnpm 10.33.4, exit 0, in 5m18s; native before/after tests reproduce the remaining failure as detailed below. These operational successes do not substitute for hosted preflight or artifact acceptance. Root integration receipt: `artifacts/ga-fable-20260908/windows-lab/native-integration-receipt.json`.

## First integrated candidate and failed build

Preceding `1d7455673774fd70c086b41b405c8ece868ce302` was dispatched as [run 34244582967](https://github.com/dmvevents/clawx-pilot/actions/runs/34244582967) at 15:24:49 UTC. It failed native preflight: 2,297 passed, two failed, 57 skipped, with no installer. Its source evidence below remains bound to that revision.

## Reviewed integration

The assembly preserves the approved browser `41359e1`, artifact harness `8bf5d32` and installed verifier `8935bc0a` commit ancestry. Independent integration review APPROVE verified all browser/verifier files remain byte-identical to their approved tips; the harness differs only by the three bounded integration deltas below. No additional product/runtime change was hidden in the merges.

- `c4a85343`: correct the evidence row name to the actual fast packaging check, `plugin-registration.full`.
- `44dad46d`: reconcile the harness with the reviewed `browser.open_chrome` registration, raising the exact inventory from 34 to 35.
- `1d745567`: correct the separately stale upgrade-verifier inventory, including existing `outlook.readiness`; retain existing inventory checks (see the later N3 duplicate caveat) and bind the positive check to actual reviewed plugin registration/manifest.

The final independent Claude Fable 5 / Bedrock reviewer passed 104 focused tests across the harness and two verifier suites. Its report is `/private/tmp/clawx-ga-integration-review-20260908/artifacts/REVIEW.md`; provider/model provenance matched. The author receipt is `/private/tmp/clawx-ga-integration-20260908/artifacts/INTEGRATION_RECEIPT.md`. Both are private operational evidence.

## Final source verification

| Check at `1d745567` | Result and scope |
|---|---|
| Full source unit run | 2,327 PASS, 0 FAIL, 29 SKIP; recorded exit 0. Reviewer verified the retained summary. Skips remain unproved platform/environment rows. |
| Typecheck / lint | PASS; lint retains 43 existing warnings. |
| Root PowerShell lint | PASS over 54 files: 0 gating findings; 148 warnings and 14 informational findings retained. |
| Root agent doctor | PASS repository surfaces; existing user-config legacy-profile warnings retained. |
| Root direct document harness | All five deterministic DOCX/PDF/XLSX/image prompts PASS; no Electron, model or installer exercised. |
| Browser/harness communication checks | Prior reviewed byte-identical browser checks and assembled comms replay/compare PASS. Browser-only task-spec validation does not claim unrelated assembled-file coverage. |

The first source run's two manifest failures, baseline reproduction, initially wrong OpenClaw dependency symlink, masked pipeline exit, supervision timeout and intermittent on-device setup-hook timeout remain recorded in [CLWX-106](../bugs/CLWX-106-installed-verifier-identity.md). Final tests used the locked OpenClaw 2026.9.2 install without changing shared dependency content. Earlier harness/verifier author MODEL_MISMATCH receipts are retained; root accepts the reviewed source based on reproducible tests and independent Fable/Bedrock approval, not the requested model label alone.

## Native failure and next evidence

Native failure details and the dedicated VM repair lane are in [CLWX-106](../bugs/CLWX-106-installed-verifier-identity.md). The seed test timed out at 5s; the verifier cleanup threw EPERM after exercising the actual runtime. Mac source passes remain valid in that scope but do not override these Windows failures. The hosted Windows job must pass native preflight, runtime preparation, staged bundle checks and packaging before artifact identity is verified. Extract and compare installer/ASAR/EXE/helpers/source/profile hashes, then run installed acceptance. The [successful assisted moe.25 browser inbox and Forms previews](WINDOWS_REPEATABLE_LAB_2026-09-08.md) remain a prior-artifact baseline. They do not transfer to moe.26. Windows 10/11 standard-user, Graph OAuth, documents/local/recovery/performance, unaided stakeholder and strict release evidence remain required.

## Hosted retry and native reproduction remain red

At 16:41 UTC, `34252050616` failed native preflight with **2,304 PASS / one FAIL / 57 SKIP**. Seed tests now pass. The only failure is actual-9.2 verifier cleanup EPERM after bounded retries; packaging did not run. Source approval established truthful failure handling, not a repaired Windows resource lifetime.

On prepared Server 2022 / Node 24.20.0, original `1d745567` reproduces 21 passes/two failures in 67.8s; corrected `5785e570` gives 28 passes/one failure in 14.8s. Short-TEMP verifier-only control gives 18 passes/one failure in 14.9s. Only shared-state SQLite files remain after cleanup. A fresh same-user process can delete the corrected leftover after the test process exits, while baseline evidence remains preserved. The exact active handle is not captured; source shows cached OpenClaw shared-state SQLite handles. [CLWX-106](../bugs/CLWX-106-installed-verifier-identity.md) records the bounded `moe26-db-lifetime` repair lane and source/native exit criteria. No further retry-only build is scheduled.
