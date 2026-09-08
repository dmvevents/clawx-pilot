# CLWX-106 — Installed verifier accepts the wrong artifact identity

## Identity and impact

Reported September 8, 2026, UTC; owner CLWX-106, related CLWX-107/133. Status: corrected source independently approved and integrated in the operations checkout; installed execution NOT_RUN. Severity MEDIUM: a receipt could label the wrong binary as the selected release. No installed or GA evidence has been accepted from this verifier.

Author revision `9bc9221ba3ee473379fb901bbb7186d614d4c200`, parent `7e1f9417`; author tree `/private/tmp/clawx-installed-verifier-repair-20260908`. Independent read-only Claude review ran in `/private/tmp/clawx-installed-verifier-review-20260908`. Synthetic macOS shell fixtures only; Windows execution NOT_RUN.

## Reproduction and expected result

1. Prepare a nonempty synthetic file named `Ministry-of-Education-Setup-0.4.3-moe.30-win-x64.exe`.
2. Run `scripts/vm-verify-moe19.sh --exe <synthetic-file> --version 0.4.3-moe.3 --print-config`. Actual: exit 0 with OK identity. Expected: exit 2, before cloud commands. `--version 0.4.3` also passed.
3. Run either verifier entrypoint with `--exe= --version= --print-config`. Actual: inherits historical moe.19 and reports legacyDefaults true. Expected: explicit empty identity is an error; only the original engine's genuinely absent flags may select legacy defaults.
4. Supply `--expect-file-version .`: actual fixed-string matching becomes effectively vacuous. Expected: reject invalid or contradictory identity.

## Cause and evidence

Selected identity → shell argument parser → filename substring check → guest FileVersion fixed-string grep → receipt. The parser loses the distinction between absent and explicitly empty values; `grep -qF` is literal but still unanchored. A shorter prerelease string is a prefix of another real release. Merely escaping regex metacharacters does not bind an exact version.

Private reviewer report: `artifacts/review-9bc9221b/REVIEW.md` in the review tree; supervisor result at `artifacts/ga-fable-20260908/installed-verifier-review/result.json`. Reviewer reproduced 72 existing tests passing, typecheck/lint and shell syntax passing, then demonstrated the falsifiers above. Confidence HIGH for these source defects. No claim that a wrong installer was deployed.

## Attempts and correction

The first author added neutral entrypoints, paired identity, optional manifest checking and preserved legacy compatibility. Reviewer verdict CHANGES_REQUIRED: F1/F2 MEDIUM, F3 LOW. Optional manifest cross-checks passed their negative controls but did not protect the path where the manifest was omitted.

The author receipt's mixed Fable/Opus Bedrock model metadata remains MODEL_MISMATCH. The independent Fable review is separate evidence; source correctness does not relabel author provenance.

The first correction session reached its supervision deadline after preserving its edits. A bounded finish resumed only to record verification and commit `8935bc0a`. Non-legacy runs now require an agreeing manifest (version/name/SHA256); filename matching uses the delimited version token; FileVersion assertions are anchored; explicit-empty flags are rejected; overrides require a digit. Independent Fable/Bedrock re-review APPROVE reproduced 76 focused passes and the original falsifiers, including `--expect-file-version 0`: its anchored expression refuses ordinary full versions, so it cannot weaken the manifest or falsely match another version. Root integrated the two commits as `25289e4d` and `69f983c0` in the operations checkout. The product candidate remains unchanged.

Private review: `/private/tmp/clawx-installed-verifier-rereview-20260908/artifacts/rereview-8935bc0a/REVIEW.md`; supervisor `artifacts/ga-fable-20260908/installed-verifier-rereview/`. No cloud, installation or GUI action occurred in the reviewer lane.

## Verification and resume

Source exit met: original compatibility tests, wrong-prefix, empty equals-style flags and degenerate override controls pass; independent approval and operations integration recorded. Next: use the reviewed producer with an exact candidate manifest during the authorized installed Windows run, and bind its evidence to that machine and artifact. `--print-config` remains a configuration check, not installed acceptance; CLWX-106/133 remain open.

## Related source-integration verifier inventory failure — September 8

At assembled `44dad46d`, full units reported 2,323 passes, two failures and 29 skips. `clwx92-bundle-fixture` and `openclaw-2026-9-upgrade-verifier` failed the exact manifest contract: `MOE_HOSTAPI_TOOLS` omitted `outlook.readiness` (also reproducible at baseline `7e1f9417`) and the merged `browser.open_chrome`. Earlier two collector failures were separately traced to the worktree dependency symlink selecting OpenClaw 2026.4.23 instead of locked 2026.9.2; the symlink was corrected without changing shared dependency content. Neither failure was suppressed.

Claude correction `1d745567` updates the verifier inventory to the reviewed 35-tool registration, checks coherence with the harness contract and retains missing/extra/duplicate negative controls. Commands on exact locked 2026.9.2: the two focused suites PASS 21/21; `pnpm typecheck` and `pnpm lint:check` exit 0; final `pnpm exec vitest run` PASS 2,327, FAIL 0, SKIP 29 (exit 0). The earlier pipeline-masked exit, supervision timeout and intermittent on-device setup-hook timeout remain in the integration receipt. Final independent integration review APPROVE with 104 focused passes; staged bundle and installed verifier execution remain NOT_RUN. Root froze/pushed `1d745567` and started hosted Windows build `34244582967`.

Resume at `/private/tmp/clawx-ga-integration-20260908/artifacts/INTEGRATION_RECEIPT.md`; full source log is its `artifacts/ga-fable-20260908/ga-source-integration/full-unit-1d745567.log`. Root must retain review approval, freeze the candidate and test the resulting bundle/artifact. A source inventory pass does not prove a shipped bundle.

## Native hosted preflight failure — build 34244582967

The first moe.26 hosted build failed **before packaging** at 15:31 UTC. Native Windows units: 2,297 PASS, 2 FAIL, 57 SKIP. The source SHA remains `1d7455673774fd70c086b41b405c8ece868ce302`; no installer was produced. These are distinct from the repaired inventory failures:

1. `tests/unit/cloud-gateway-provider-seed.test.ts:144`: the env-configured cloud seed/default-channel case exceeded its 5,000 ms test budget. Underlying slow boundary is UNKNOWN; a broad timeout increase is not yet justified.
2. `tests/unit/openclaw-2026-9-upgrade-verifier.test.ts:182`: the actual 2026.9.2 runtime check reached `assertMoePluginToolRegistration` cleanup; `fs.rmSync(tempRoot, {recursive:true,force:true})` at verifier line 273 threw `EPERM` for the owned short-TEMP directory. Assertion failure was not reported; the lock/permission cause remains to be isolated.

Canonical private failed log: `artifacts/ga-fable-20260908/windows-lab/moe26-native-preflight-failure.log`; public [failed run](https://github.com/dmvevents/clawx-pilot/actions/runs/34244582967). Root assigned Claude lane `moe26-native-preflight-repair`, worktree `/private/tmp/clawx-moe26-native-preflight-20260908`, ownership limited to these tests/verifier plus private receipts. It may establish a portable native dev workspace on isolated lab `clawx-lab-auto-d-20260908` (instance ID `4908385059495321872`), then reproduce/fix/retest the two suites. The original stakeholder VM stays root-owned. No new source fix, native retest or replacement build is yet claimed. Next: bounded root-cause repair, focused native proof, independent review, new source identity and hosted retry.

## Native repair checkpoint and interrupted review — 16:22 UTC

Claude committed proposed fixes `8fb8bd96` (owned-temp cleanup) and `409bce89` (Graph-account test boundary). The hosted log records an Electron binary download during the seed case; the unmocked Graph account store reaches the Electron import. Isolating that dependency leaves production seed logic and the five-second budget unchanged, with absent-account, signed-in-account and rejected-store controls. Independent reviewer ran both suites: **28 PASS** on Mac Node 26.7.0 with locked OpenClaw 2026.9.2. Its stream was interrupted by an API response error before a review verdict. Passing tests do not establish approval or native proof.

Root requested correction of `8fb8bd96`: it catches exhausted EPERM and other rm retry codes, warns, and returns success. Those codes alone do not establish transient contention. Required behavior is bounded owned-temp retries followed by surfaced failure, preserving primary assertion errors if cleanup also fails. The exact Windows lock/permission cause remains UNKNOWN; antivirus/lazy handle release are hypotheses only. These proposed commits remain outside the candidate pending correction and independent review.

Both supervised tasks ended `TIMED_OUT`; author had no final result, reviewer had `error_during_execution`. Original transcripts and partial checks remain under `artifacts/ga-fable-20260908/moe26-native-{preflight-repair,review}/`. Root inspected source and remote state before intentionally resuming author session as `moe26-native-preflight-resume`: no blind replay, full-suite rerun or second build. The author must checkpoint corrected source first, then perform bounded native validation. [CLWX-25](CLWX-25-windows-lab-repeatability.md) records the incomplete dependency setup. GA remains RED.

## Reviewed correction and hosted retry — 16:36 UTC

Correction `5785e570` removes exhausted-error warn/pass behavior, uses bounded recursive rm retries, and retains primary plus cleanup failures through AggregateError. Independent Fable/Bedrock review APPROVE: 29 focused passes with explicit exit 0, lint and error-path falsifiers. Author also passed six neighboring tests and typecheck. Root verified exact three-file fast-forward, excluded private checkpoint `8db5bc5f`, pushed the reviewed SHA and dispatched hosted `34252050616`. Native/package outcome remains pending; no installer exists yet. Root independently located the original log's 15:29:34.603 UTC stdout naming the failed seed test immediately before “Downloading Electron binary...”; exact synchronous install/download duration is UNKNOWN.

Reviewer F1 remains a minor uncorrected edge at verifier caller/finalizer: a future falsy thrown value (`null`, `undefined`, empty string, zero or false) can be mistaken for the no-error sentinel. All current reachable throw paths produce Error objects according to review, so it is non-blocking for this source acceptance. An eventual fix must cover **all** falsy values; the reviewer's suggested nullish-only fallback would not cover zero/false/empty string. Keep this finding open rather than claim the finalizer handles every JavaScript thrown value. Receipt: `/private/tmp/clawx-moe26-native-review-20260908/artifacts/REVIEW_FINAL.md`.

## Native reproduction identifies process-lifetime boundary — 16:41–16:45 UTC

Hosted retry `34252050616` at `5785e570` failed before packaging: **2,304 PASS, one FAIL, 57 SKIP**. Seed suite passes; only actual-9.2 verifier cleanup EPERM remains after bounded retries. Private failed log: `artifacts/ga-fable-20260908/windows-lab/moe26-native-retry-failure.log`. No installer.

Prepared auto-d independently reproduces both original failures on exact `1d745567`: **21 PASS / two FAIL**, native exit 1, 67.8s. Electron dist absent before the baseline becomes present afterward, alongside the seed-case timeout. Hash-bound `5785e570`: **28 PASS / one FAIL**, exit 1, 14.8s. Verifier-only run with short TEMP `C:\ct`: **18 PASS / one FAIL**, exit 1, 14.9s. The short path does not remove EPERM. Raw commands/results are preserved in `artifacts/ga-fable-20260908/moe26-native-preflight-resume/stream.jsonl`; each native exit is explicit despite outer SSH exit 0.

After failed cleanup, only `state-no-hostapi/state/openclaw.sqlite` and, in some cases, its WAL/SHM files remain. A fresh same-user PowerShell process successfully removed corrected leftover `ZIEKyW` after the test process ended. Baseline `Leac3q` and short-path `aEZxZk` are preserved. This strongly supports a process-lifetime handle problem over permanent permissions; exact active handle identity is not directly captured. Source trace finds cached shared-state SQLite handles in OpenClaw 9.2's plugin loader/database cache; the stable sqlite-runtime SDK does not expose the examined shared-state close operation. Do not introduce a brittle hashed-chunk/export lookup or close unrelated databases.

The native author hit its deadline after this useful reproduction, without a final receipt. Root assigned fresh bounded lane `moe26-db-lifetime`, worktree `/private/tmp/clawx-moe26-db-lifetime-20260908`, base `5785e570`, to the verifier, its tests and a narrowly necessary child helper if required. It is sole auto-d mutator and reuses installed dependencies. Verify the database-lifetime mechanism with native controls, then use a supported targeted disposer or owned bounded child-process lifetime before parent cleanup. Preserve real registry/PDF checks, all inventory/error controls, and fix F1 while touching failure capture. No next build before reviewed repair and relevant native proof; no further retry-count-only experiment.

## Confirmed SQLite cause and reviewed native fix — 17:09 UTC

Source `99468423e78d90ef75a49ac5d7b52939caf9e808` has independent Fable/Bedrock APPROVE: 33 focused passes, lint and adversarial marker/error controls; root typecheck passes. Root's actual Windows control observes the exact temp-scoped database open, reproduces in-process rm EPERM, then closes only that DB through a diagnostic-only cache probe (true) and removes the root successfully. This establishes the cached handle as the cause in the reproduced case. No hashed API import was added to product code. The fix runs the actual registry/PDF checks in an owned child; parent cleanup follows child exit and requires a matching nonce marker plus exit 0. F1 is fixed at the catch/cleanup boundary.

After source SHA256 binding on auto-d, normal TEMP: 33/33 tests PASS, 16.22s; short TEMP: 23/23 PASS, 16.35s. Native exits 0. Root fast-forwarded only the three reviewed source files, pushed the exact SHA, and dispatched hosted `34255425275` at 17:09:49 UTC. Full preflight/package and installed acceptance remain pending. Private evidence: `artifacts/ga-fable-20260908/windows-lab/native-db-root/`; independent receipt in `/private/tmp/clawx-moe26-db-lifetime-review-20260908/artifacts/REVIEW_FINAL.md`. Author containment and transfer recovery are in CLWX-25.

Review N3, preserved as a pre-existing non-blocking finding for this delta: `assertSameSet` uses set semantics, so actual `[a,b,a]` with expected `[a,b]` passes. Extra/missing names still refuse; no-HostAPI has a factory-count guard, HostAPI lacks a duplicate count guard. This corrects prior blanket duplicate-rejection claims. Future hardening should reject duplicate tool names explicitly with a meaningful regression. Review N2 is a possible POSIX stdout marker-flush false failure; 0/300 losses observed and missing proof always fails closed. These notes do not replace the required full native/package and installed evidence.

## Adjacent checkout fixture omission — hosted34255425275, 17:14 UTC

The third hosted attempt failed preflight: **2,308 PASS / one FAIL / 57 SKIP**. The actual9.2 verifier and seed suites pass. The remaining failure is `tests/unit/clwx92-bundle-fixture.test.ts`, “runs the full bundle verifier from a fresh checkout copy”: its explicit `copyVerifierCheckoutFiles` list copied the parent verifier but omitted newly introduced `scripts/openclaw-2026-9-moe-registry-child.mjs`. The isolated checkout therefore fails MODULE_NOT_FOUND for that helper. This is a dependency-copy regression from the child split, not recurrence of SQLite EPERM. No installer was produced. Private failed log: `artifacts/ga-fable-20260908/windows-lab/moe26-db-fixed-preflight-failure.log`.

Root reproduced the same missing module on Mac at99468423 (five PASS/one FAIL), then added exactly one copy-list entry at `8bb7a77907faf35fb8fc4136073ce340ea9a9aaa`, isolated tree `/private/tmp/clawx-moe26-fixture-copy-20260908`. All six existing tests pass and scoped lint exits0; full bundle/PDF and missing-fixture refusal assertions are unchanged. Root's earlier two-suite selection omitted this affected neighbor, and the source review also missed that copy boundary. New helpers require checking isolated checkout/staging manifests, not just direct callers. The correction has bounded independent Claude review and a full native unit run on prepared auto-d in progress before any next build. Current candidate remains99468423 until those checks finish.

Fixture correction8bb7a779 now has independent Fable/Bedrock APPROVE: six tests/native local exit0, complete child import/copy closure and no other matching copy allowlist. Root integrated and pushed exactSHA and dispatched hosted34256868050 at17:24:08UTC. The attempted full VM unit run did not start: SCP authentication failed before the script/test call. Root switches that full validation to hosted Windows while account-holder GCP reauthentication is pending. No VM full-suite pass or installer is claimed.

## Full native build and extracted candidate proof — 17:50 UTC

Exact8bb7a779 hosted34256868050 completed SUCCESS:2,309 units PASS/zero FAIL/57 SKIP;210 passed files/three skipped; nine artifact harness rows PASS. This verifies the repaired seed, SQLite lifetime and isolated-checkout paths together on Windows. Root then verified all36 extracted package checks, canonical keyless source/profile agreement and172 ASAR compiled files against the native receipt. The generated moe.26 manifest is checked in. No installed verdict is inferred; this card retains the installed verifier/client/strict-release criteria. Prior failed builds, interrupted drivers and N3 remain preserved. See [source/artifact evidence](../evidence/GA_SOURCE_INTEGRATION_2026-09-08.md).
