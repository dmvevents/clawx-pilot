# GA Claude handoff snapshot — 2026-09-09

**This is a dated handoff snapshot, not a plan.** The current plan is [docs/COMPLETION_PLAN.md](../COMPLETION_PLAN.md); the candidate pointer is [docs/CURRENT_WINDOWS_RC.md](../CURRENT_WINDOWS_RC.md); verification truth is [docs/GA_RELEASE_EVIDENCE_MANIFEST.md](../GA_RELEASE_EVIDENCE_MANIFEST.md). The live Plane board (136 issues / 33 sprint cards, read 2026-09-09 00:10:43 UTC) is authoritative over historical nested doc execution states. Root reconciled the current entrypoints after review. Drafted by the incoming Claude GA lead (claude-fable-5 / Bedrock), then independently reviewed and corrected by root as a documentation audit. No product code, VM or build mutations were made; root posted the completed handoff to Plane and refreshed its repository mirror.

## 1. Target, scope, holds, ownership

- **Target:** Ministry of Education (Trinidad & Tobago) principal desktop assistant. Pilot GA = installed-build acceptance + unaided tester rerun + support/recovery docs + recorded distribution authorization. **GA is RED.** All seven pilot KRs remain incomplete as end-to-end outcomes.
- **Scope now:** owner paused implementation/release for reassessment. This task is analysis/handoff only. Future implementation is HELD pending the reassessment decision.
- **In scope:** offline local model and Graph. **Deferred:** ASR/mic, action journal (CLWX-124). **Separate:** fleet 450-laptop rollout, Whisper.cpp backlog branch, Ministry production identity/backend. No speculative Ollama→llama.cpp migration (CLWX-126 is a conditional benchmark only if native offline acceptance fails).
- **Holds:** Mac Electron GUI/Keychain hold persists (CLWX-102 recurrence; owner desktop launches held). No cloud stop/resize/new infra, no broad process kills. Owner's Sep 7 authorization covers GitHub sync, GA publication *after completed validation*, and stakeholder notification once released — it does not waive acceptance or authorize credential exposure. No send/submit/download approval is implied by the GA request. Only a human closes Done; no Ready/Done promotions from analysis.
- **Ownership:** root = sole cloud/VM/package/release operator and canonical-docs/Plane owner, and was sole operator until this handoff. Successor must **confirm no other operator is active before assuming the role**. Claude Fable5/Bedrock owns bounded implementation/diagnosis/review in isolated worktrees; GPT is brief coordination only. Authors never approve their own code. Build remote is `dmvevents/clawx-pilot` — **never** upstream `ValueCell-ai/ClawX`.

## 2. Exact identities and dirty-file preservation

| Item | Identity |
|---|---|
| Canonical docs | `/Users/antonalexander/Github/moe-tt/ClawX`, branch `fix/doc-tooling-steering`, handoff authoring base `74a91dde`; read `git log -1` for the final root handoff commit |
| Product candidate | `0.4.3-moe.28`, source `c5e76b5dd69d43a632b8ac817b7f253ab76ec614`, branch `release/moe28-upgrade`, clean/pushed, checkout `/private/tmp/clawx-plan-execution-20260908` |
| Hosted build | Run `34288617489`, succeeded 2026-09-08 23:17:20 UTC; 2,319 native tests / 0 fail / 57 skip; 36 package checks; 172 compiled-file matches |
| Installer | 476,771,752 bytes, SHA256 `f74564761651c436141cd6bd0fdfdb25b561a950336f6ce736e400d0ce56994f`; ASAR `730660d9816391b76b0bbb406862bef1764f3b716d8785500d5b042dc30dfa16`; EXE `6055c97a567e95358f430059c5b2443e03b509de59a737b1a94c676901adcbda`. Keyless-public, **unpublished** |
| Private artifact | `gs://clawx-rc-artifacts-622687731621/private-validation/moe28-34288617489/moe28.exe` |
| CLWX-135 repair provenance | Reviewed source `c5c8590b`, harness `08f0aea0`, tested assembly `c1891938`; 11 native scenarios / 93 assertions PASS; two independent APPROVEs. **Do not redo or erase.** |
| VM | `clawx-win-rc-20260609`, ID `2748349704588098112`, project `gen-lang-client-0649986230`, zone `us-central1-a`; SSH `clawxtest@compute.2748349704588098112` via IAP. Lab A/B stopped |
| QA account | `ClawXFresh0908` (limited user, Session 2). Staging `C:\Users\Public\Downloads\moe28-34288617489`; QA receipts `C:\Users\ClawXFresh0908\Downloads\moe28-34288617489` |
| Extracted package | `/private/tmp/clawx-moe28-run-34288617489/extracted-app` |
| Prior working baselines | moe.25 `8058e9b5` run `34203201042` (startup + 3 Online turns PASS); moe.22 `a4efc7e4` run `34180280985` (journey baseline; P3/local failed) |
| Evidence root (private) | `artifacts/windows-vm/20260908-moe28/`; `startup-log-private-2343.json` is **SECRET-BEARING raw log — never open/send to LLM/git/board** |

**Preserve in the docs root, do not commit or alter:** modified `docs/TESTER_QUICKSTART.md`, `docs/build/windows-build-pipeline.md`; untracked `docs/bugs/CLWX-132-retired-gemini-model-default.md`. These belong to other authors.

If `/private/tmp` checkouts disappear, recreate a clean detached worktree from the full candidate SHA — branch/commits are durable git references.

## 3. Bounded chronology: known-good → regressions → verified fixes

1. **moe.22** (`a4efc7e4`): last broad journey baseline. D0/P1/P2/P4 PASS-class results; P3 deadline fidelity and local-model behavior FAIL.
2. **moe.25** (`8058e9b5`): **last known-good installed startup.** Assisted Server 2022 standard-user upgrade; 36 package checks + installed hashes PASS; stable startup and Existing Main / fresh / next Online turns PASS; a separate assisted inbox chat took 95s; installed Outlook inbox read and both Forms previews PASS (no submission). Graph unconfigured.
3. **moe.26** (`8bb7a779`): build/package PASS; **installed startup FAIL** — Gateway exits 1, incomplete packaged OpenClaw lifecycle → CLWX-135.
4. **moe.27** (`4c023f7e`): build PASS (after one preflight failure at `d343f23d` from an isolated fixture omission, corrected); native install exit 0 with exact hashes; **upgrade startup FAIL** — installed dir retained the stale hash-identical moe.26 lifecycle marker.
5. **CLWX-135 installer repair (verified):** 11 native standard-user scenarios / 93 assertions PASS at 22:58:52–22:59:06 UTC; two independent reviews APPROVE; integrated into moe.28.
6. **moe.28** (`c5e76b5d`): build + package + download-hash PASS; **standard-user upgrade PASS** 23:39:01 UTC (exit 0, exact hashes, both lifecycle markers absent, original marker hash-identical in `Ministry of Education._stale_0` rollback, 695/695 protected-backup hashes PASS). **Shortcut startup FAIL** 23:39:28 UTC: unchanged 360s observer, 155 samples, last 359,721 ms, 0 ms stable, disabled composer, native exit 1. First logged failure 23:40:30 UTC: `SQLite read-only worker returned invalid JSON` → **CLWX-136** (urgent, separate from 135). Ordinary chat NOT_RUN. Guarded `app:quit` 23:46:17; readback 23:46:53: zero app/listeners on 13210/18789/9224; 10 QA Chrome processes preserved. **App remains stopped.**

Pattern: **three fatal boundaries appeared serially** (unfinished lifecycle → stale runtime leftover → SQLite worker), each only visible on real installed Windows startup. The checks run before those installed attempts did not expose these boundaries. Later repair tests add coverage; they do not erase the original escapes.

## 4. Ranked recursive gap matrix

Proof classes: **SRC** (source/tests), **INST** (installed exact artifact), **EXT** (live account / external tester). SRC never transfers to INST. "Acceptance-not-run" ≠ defect.

| # | Domain | Cards | Type | Current proof | Exit criterion | Depends on / owner |
|---|---|---|---|---|---|---|
| 1 | Runtime/package startup: SQLite read-only worker invalid JSON | **136** (urgent) | **Defect**, cause UNCONFIRMED | INST FAIL on moe.28; diagnosis hypothesis only (§6) | Decisive isolated native probe → reviewed fix → new identified candidate → installed startup + ordinary chat PASS | Blocks nearly everything; Claude author + root probe/integration |
| 2 | Package/test oracles: packaged-Electron startup untested pre-install | 106, 135(closed-scope), 77 | Defect class | 3 serial escapes prove gap | Native proof using the staged runtime and actual packaged Electron execution contract before committing to another full installer cycle; existing-profile and fresh-profile branches; ga:gate skip-fail semantics retained. Staged chat controllers are a later acceptance step, not this missing oracle | Root + Claude; partially parallel to #1 |
| 3 | Online chat journeys on final candidate | 94, 95, 96, **125** (urgent) | Acceptance-not-run + open hardening | moe.25 Online PASS (does not transfer); 96 has 145 source passes | Existing/fresh/next turns, cancel during prep+generation, fault-once-recover, no silent replay; cold/warm timestamps | #1; vm-operator |
| 4 | Release gate + publication | **133** (urgent), 22, 118 | Acceptance-not-run | Build, identity and upgrade components have scoped passes; full release acceptance is incomplete | One continuous run: integrate reviewed source → preflight → keyless build → installed/client/Microsoft/document/offline/lifecycle/perf on exact bytes → tester download → strict verdict | #1–#3; root |
| 5 | Unaided stakeholder acceptance | **134**, 110, 125 | Acceptance-not-run + external | Owner told Karunesh to wait for fix; no new inbound | Karunesh unaided same-artifact rerun per USER_GUIDE (own Microsoft account, expired/wrong-account recovery) | #4 + external availability |
| 6 | Windows client/provisioning: fresh Win10/11 | 25 | Acceptance-not-run + **external** | Only existing-profile Server 2022 proof — explicitly not Win10/11 proof | Fresh standard-user install, actionable unprovisioned state, supported model provisioning | External availability; not repairable with more LLM calls |
| 7 | Microsoft/Graph/eval | 39, 40, **61**, **63**, 73, **123**, 119, 120, 121, 131 | Mixed | 39/40: `7a129570` approved, integrated `f520d2cc`, isolated Electron 42 UI PASS — needs installed/tenant. 123 recipient read-back has a source/local repair (99 focused tests and a signed-in synthetic draft); installed saved/reopened draft and true-mismatch refusal remain unproven. 61 live forward/download/attachment-metadata criteria remain open. 119: source byte-identical, PASS_SOURCE; remaining is root evidence promotion + ≥2 final-artifact eval runs. 120: review sign-off + final-artifact W3.2 alongside 119. 131 integrated, installed rerun open | Final-candidate authenticated read/draft/reopen/reply; forward and attachment metadata; actual download only with its action authorization; Graph OAuth and Chrome-less Graph eval; source document → extraction → Forms prefill (standalone previews do not prove that chain); separately authorized reviewed dispatch | #1/#4; keyless onboarding/tenant provisioning **external** |
| 8 | Documents | 24, 77, 114, 115 | Mixed | PDF source-excerpt fix reviewed (SRC); moe.22 D0/P1-P5 partial; 115 fixture separate/open | D0 + all five prompts, complete P3 obligations, typed spreadsheet values, generated-file reopen on final candidate | #1/#4 |
| 9 | Offline local model + policy/reminders | 26, 113(dup of 26), **117**; policy/reminder criteria on22/42/67 | Acceptance-not-run (117 repaired SRC) | Native Ollama route reviewed; direct native API answers (diagnostic only); policy oracle `1c387821` 22 tests | Ordinary installed on-device answer/document grounding with no non-loopback egress; correct policy/NSCC answers and visible reminders under their own criteria on the final candidate | #1/#4; Ollama model availability is a local prerequisite |
| 10 | Performance/latency | **43**, 107 | Acceptance-not-run + missing input | Heterogeneous single observations (13.6/50.1/17.6s on moe.25); no p50/p90 | ≥5 matched cold + ≥5 warm samples, p50/p90 vs an **explicit recorded owner budget disposition** (budget may be missing — check card 43 with owner) | #3; vm-operator + owner input |
| 11 | Recovery/UI polish | 96, **102**, **122** | 102 defect (recurrence), 122 defect | 102 REOPENED after owner Keychain popup recurrence; 122 edits preserved, paused | 102: safe isolated GUI lane plus full required renderer-suite dispositions and passing evidence; cause analysis alone does not close the card. 122: tested/reviewed principal-readable footer, no port/pid; preserve owner-Mac hold | 122→102; Claude analyst |
| 12 | Retired model default | 132 (not in sprint) | Real defect, narrow | Bug doc untracked in root (preserve); `tests/unit/providers.test.ts:132,150` currently protects the defect | Deliberate replacement (browser-oauth uses `gemini-2.5-flash`); do NOT record as the Gemini 404-storm cause (four attributions refuted) | Outside the current sprint; assess relevance to supported Google OAuth before selecting work; not established as the Online startup cause |

Do not equate 33 sprint cards with 33 fixes or compute GA% from card counts. CLWX-113 duplicates 26; 114 shares evidence with 24/77; 119/120 are mostly review/evidence-hygiene, not new code.

## 5. Critical path and parallel work

**Sequential critical path (single VM lane; same-VM mutations sequential):**
CLWX-136 decisive native probe → confirmed cause → bounded reviewed source fix → root integration + one integrated preflight → one newly identified candidate build (version not yet selected) → hash check → standard-user upgrade + **fresh-client** install → startup + first/next Online (125/94/95/96) → documents D0/P1–P5, fidelity, generated reopen (24/77/115) → Microsoft preview/draft/recovery (61/63/123/40) → offline + policy/reminders (26/117) → uncontended cold/warm latency (43) → unaided Karunesh same artifact (134) → strict fail-closed GA verdict → authorized publication (133).

**Genuinely parallel (read-only / source-independent, before packaging):**
- 119/120 review sign-off + root evidence promotion (source already landed).
- 102 keychain-recurrence analysis (no GUI launches).
- 132 applicability review only; do not expand the sprint automatically or attribute this separate Google OAuth defect to the current Online/SQLite failure.
- Pre-package packaged-Electron startup oracle design (#2) — highest-leverage prevention work.
- Board/doc reconciliation of stale nested execution states (root, after this doc).
Do not spawn one agent per card. No new build is justified until the 136 cause is tested.

## 6. Precise initial diagnostic state (CLWX-136) — hypothesis limits

- **Known fact:** installed moe.28 Gateway fails startup with `SQLite read-only worker returned invalid JSON`. Invalid JSON is confirmed; **exact cause is UNCONFIRMED.**
- **Strong hypothesis (not proof):** ClawX starts OpenClaw in `utilityProcess`; OpenClaw 2026.9.2 separately spawns the read-only worker via `process.execPath`; in packaged app that execPath is Electron, not Node; the child emits app text on stdout → JSON parse failure.
- **Diagnosis run provenance:** task `moe28-sqlite-startup-diagnosis` TIMED_OUT 606s; same session `964c6277-1cd4-4f2e-8496-3aabc5e3b632` resumed as `moe28-sqlite-startup-conclusion`, CLI_SUCCEEDED 80.1s, verified Fable5/Bedrock. Report: `artifacts/ga-fable-20260908/moe28-sqlite-startup-conclusion/result.json`. **Independent root review: the report overstates CONFIRMED at each link.**
- **Hard limits — do not call the fake proof native:** (a) native worker stdout was never captured; (b) actual inherited `ELECTRON_RUN_AS_NODE` in the utility child was never captured; (c) the reproduction used Node 26.7 plus a **FAKE Electron** printing a duplicate-instance message — not real Windows/Electron; (d) the prior 18:59:15 UTC moe.26 `ELECTRON_RUN_AS_NODE=1` native probe passed Node 24.15 invocation but does not prove utility-child env passthrough. Positive control: real Node worked.
- **Differential (root's independent comparison):** working moe.25 dist (OpenClaw 2026.4.23) **lacks** the sqlite-readonly worker/preflight entirely; moe.28 (2026.9.2) adds it. Upgrade `ad88d71c` also moved Electron 40→42, helper Node 22.16→24.15, Playwright 1.59.1→1.62.1. Gateway launcher unchanged across baselines. The worker **preflights when a DB exists** — a fresh-empty profile alone may not reproduce it.
- **No fixes have been made for 136.** Not the same as CLWX-106 node:sqlite test-handle cleanup. Swallowing invalid JSON, extending timeouts, or patching the installed runtime does not satisfy acceptance.
- **App state:** the failed app was gracefully stopped (verified readback, §3). **Do not relaunch the app from a pseudo-command or as a first action.** Recheck RDP Session 2 liveness read-only before any future VM operation.
- **Next decisive step (held):** isolated native Windows probe with shipped helper + Electron paths capturing worker executable/env/stdout, with valid-result and malformed-output controls, against an isolated existing-database fixture, without operating on the real profile.

## 7. End-to-end safe workflow (linked runbooks)

Scoped owner card → failing reproducer → bounded Claude author worktree → focused test → independent review → root exact integration → **native boundary proof before expensive package** → one identified build → hash check → standard-user upgrade + fresh client → first/next Online → documents/D0/P1–P5/fidelity/generated reopen/Microsoft preview/draft/recovery/offline/policy/reminders → uncontended cold/warm latency → unaided Karunesh same artifact → strict fail-closed verdict → authorized distribution. Required fail/skip/block/missing is never green.

- **CLI supervision:** `docs/ops/CLAUDE_CLI_MONITORING.md`. Model `claude-fable-5` via authenticated `bedrock` AWS profile (`us-east-2`); remove stale ambient Bedrock bearer tokens for the child process (expired-token failure already seen — do not repeat). Retain session ID, isolated write scope, event stream, heartbeat, budget/deadline, final result. Quiet ≠ hang; CLI success ≠ acceptance.
- **Build:** `docs/build/windows-build-pipeline.md` (+ `.claude/skills/windows-build-pipeline/SKILL.md`). Full-SHA dispatch only (abbreviated-ref checkout failed run `34133768880`). Preserve source identity of any candidate in acceptance.
- **Windows lab:** `docs/testing/WINDOWS_REPEATABLE_LAB.md` and `docs/CLAUDE_CODE_BEDROCK_WINDOWS_RUNBOOK.md`. Helper `artifacts/ga-fable-20260908/windows-lab/owner-moe28-ops.py`: before future calls run the py then `n['OPTS'][:0]=['-F','/dev/null']`; PS writes immutable mode-0600 receipts; refuses existing labels; stage large PS scripts; never print auth/raw logs to stdout; **read `-File` scripts before execution**. Limited-interactive tasks: 15-min probes / 40-min installer; verify budget first; StartRequested ≠ completion. Staged chat controllers are hash-bound but **NOT_RUN** (no change assertions/timeouts yet).
- **RDP:** reconnect the **same Session 2** with a current certificate pin verified through trusted SSH (full last-seen pin is in private operator receipts); stdin credential only (private operator file, never doc content), SDL dummy headless, no Mac GUI. Historical identifiers (pid 96390, loopback 127.0.0.1:36389, tunnel 31095) are not live claims. Disconnected session made UI capture fail ("handle is invalid") — reconnect, don't restart.
- **Failed attempts — do not repeat:** SCP of spaced Windows path (use SSH read → mode-0600 receipt → sanitized extraction); fake-Electron repro presented as native; sprint-membership parser assumption (endpoint returns issue objects directly); moe.27 first build's isolated-fixture omission.
- **Evidence/Plane:** each result names criterion, source revision, artifact hash, environment/account class, command, timestamp, result, redacted receipt; PASS/FAIL/BLOCKED/NOT_RUN. Bug handoffs per `docs/bugs/TEMPLATE.md`. Board write + readback, refresh repo snapshot; if board unavailable, retain exact pending payload locally. No secrets/private URLs/full recipient lists in committed material.

## 8. First-session checklist (resume with receipts)

1. Read the latest reassessment decision and verify **no other operator is active** from owned process/task receipts; the initial transfer is documented below. Verify holds unchanged (Mac GUI, owner desktop, publication-after-validation).
2. `git status --short --branch` in docs root: confirm `fix/doc-tooling-steering`, preserve the two modified files + untracked CLWX-132 report. Confirm `/private/tmp/clawx-plan-execution-20260908` still clean at `c5e76b5d` (recreate from SHA if gone).
3. Re-read COMPLETION_PLAN / CURRENT_WINDOWS_RC / evidence-manifest tops + live board; reconcile only deltas since this snapshot (board read 2026-09-09 00:10:43 UTC).
4. Verify VM state read-only (instance, Session 2 liveness, app still stopped, 10 QA Chrome processes) **before** any operation. No relaunch as a first act.
5. Read `artifacts/ga-fable-20260908/moe28-sqlite-startup-conclusion/result.json` **with** root's overstatement caveat (§6). Never open `startup-log-private-2343.json` into an LLM.
6. If implementation resumes: design the decisive isolated native worker probe (existing-DB profile, shipped Electron paths, stdout/env capture, positive+negative controls) as the first act; task spec referencing `gateway-backend-communication` for any source fix; independent review; then one identified rebuild.
7. Check existing card decisions, client-image availability and tester arrangements first. Request only genuinely missing budget, account-holder or scheduling input; do not repeat answered questions.

## 9. Unresolved external inputs and honest completion estimate

**External inputs (not repairable with more LLM calls):** fresh Windows 10/11 client availability (CLWX-25); keyless onboarding/tenant provisioning; Graph OAuth requires the account holder interactively; Karunesh's availability for the unaided rerun (CLWX-134) — he was told to wait for the fix; explicit owner latency-budget disposition (CLWX-43); owner reassessment decision to resume implementation. Distribution remains covered by the existing conditional authorization; no repeated permission request is needed once its acceptance conditions are met.

**Completion estimate:** no defensible calendar date or percentage is available. The minimum remaining work is a native causal experiment, any resulting repair/review, a newly identified artifact, complete installed/client/tenant/performance acceptance and an unaided tester rerun. Runtime, local-model and UI unknowns plus external client/account/tester inputs determine duration. The author's one-day repair / 2–4-day testing / approximately-one-week estimate was removed during review because no measured work estimate or confirmed external schedule supported it. Prior serial failures justify checking adjacent runtime boundaries, not assuming another failure must occur.

---
*Snapshot author: incoming Claude GA lead, claude-fable-5/Bedrock, isolated worktree `/private/tmp/clawx-claude-ga-handoff-20260909` (branch `docs/claude-ga-handoff-20260909`). Sources: operator context + board brief packets (2026-09-09), live-board read 00:10:43 UTC, COMPLETION_PLAN/CURRENT_WINDOWS_RC/evidence-manifest tops at docs commit `74a91dde`, CLWX-136 bug report. No raw session/VM logs were opened.*


## 10. Accepted transfer and exact restart

**Recipient readback PASS:** the same Claude session read this corrected canonical snapshot in task `ga-claude-handoff-ack-20260909`, completed in 30.08s with verified Fable5/Bedrock usage, and acknowledged candidate identity, GA RED, causal uncertainty, remaining proof classes and the pause. Both supervised tasks are finished; the session is idle and resumable.

The incoming agent's initial audit completed as `CLI_SUCCEEDED` in 280.39s. Final usage confirms **claude-fable-5 on Bedrock**, with no model/provider mismatch. It wrote one documentation file; no product tests, build, VM mutation or release ran. Root independently checked current Plane criteria, selected source/gate code, and the author's claims. The draft is preserved in its worktree/CLI receipts; this canonical copy includes corrections to source-versus-installed status, Graph/document-to-form scope, unsupported timing estimates and existing distribution authority.

- Session: `a1c33a2c-3045-4b77-ba6a-e2b0dd8950bb`.
- Initial task: `ga-claude-takeover-20260909`; receipt directory: `artifacts/ga-fable-20260908/ga-claude-takeover-20260909/`.
- Handoff worktree: `/private/tmp/clawx-claude-ga-handoff-20260909`, branch `docs/claude-ga-handoff-20260909`, source of the author's draft. **The root canonical document supersedes that draft.**
- Fresh read-only Windows receipt at 2026-09-09 00:12:55UTC: zero app processes, zero app listeners 13210/18789/9224, zero running owned `ClawXMoe28*` tasks, 10 QA Chrome processes, QA RDP Session2 active. Root has finished native operations for this handoff. Successor must check for newer activity before assuming sole-operator ownership.
- Private session metadata, root review, live-board snapshot, and credential **locators only**: `artifacts/ga-fable-20260908/ga-recursive-audit-20260909/`. Credential values and raw history never belong in the handoff or LLM prompts. This is a same-workspace transfer; private files, local Claude history, active credentials and `/private/tmp` paths are not portable to another computer. Recreate worktrees from git refs and re-establish authorized authentication there; never export raw secret-bearing history as a shortcut.

After the supervised handoff/acknowledgement tasks finish, restart interactively from the same workspace:

```sh
sh /Users/antonalexander/Github/moe-tt/ClawX/artifacts/ga-fable-20260908/ga-recursive-audit-20260909/resume-claude.sh
```

The script checks recorded liveness, uses the existing session in its worktree, pins Fable5/Bedrock, removes conflicting bearer/API-token environment overrides for that child only, and tells the agent to read the latest root AGENTS/CLAUDE/contract/current plan and this corrected snapshot. It does not grant an implementation or release permission override. Its syntax and required local paths were checked; a second interactive session was not launched during handoff.

For a fresh agent if local session history is unavailable: read root `AGENTS.md`, `CLAUDE.md`, `docs/PROJECT_CONTRACT.md`, `docs/COMPLETION_PLAN.md`, this snapshot and the CLWX-136 report, then inspect source/worktree identity and the private receipt inventory. The public docs contain the restart reasoning; private logs are not startup reading. `--bare` skips automatic CLAUDE.md discovery, so those explicit reads are necessary. Use the existing supervised runner for bounded resumed work and retain the final provenance receipt.

## 11. Release gate coverage and board transfer

Source inspection confirms `scripts/ga-gate-verdict.mjs` declares 17 required release criteria, including renderer E2E, Outlook eval, both Forms dry gates, **reviewed send proof**, NSCC Q&A and installed Windows evidence. The strict mode fails closed for absent or non-PASS required rows. Do not run `ga:gate` blindly: it can start live workflows; arrange actual action authorization for send/download/submit criteria before executing those rows. The existence of source guards or a historical authorized send does not prove this candidate's dispatch path. The user has already conditionally authorized publication after validation; action-specific Microsoft tests remain separate.

A green script result alone does not establish every board requirement. Trace each pilot criterion to its evidence, including fresh Windows client, Graph transport, offline grounding, document fidelity, cancellation/recovery, approved latency disposition and unaided tester acceptance; do not infer these from a generic installed-evidence row. Root read the gate sources, not a live gate execution, during this handoff.

Plane source: workspace `issues-agent`, project `81a2ea23-e060-49b4-a344-1ab0339f46d5`, sprint `9a7b9c92-101e-4fd9-bfb7-07bdbdd49b5a`. Follow `docs/PLANE_BOARD_API.md`: verify project identity, preserve descriptions/criteria, use canonical comment writer, read back detail/list, then export the board. The credential file's generic project variable can point elsewhere; the verified CLWX project ID must be explicit. No card is closed because this handoff completed.

**Final board readback:** handoff comments posted once to CLWX-22, CLWX-127, CLWX-133 and CLWX-136 at 00:21:45–00:21:47 UTC. Canonical writer verified comment detail and list; the refreshed export contains all four markers, 136 issues, and unchanged descriptions and states. The 33-card sprint membership is retained. Private receipt: `artifacts/ga-fable-20260908/ga-recursive-audit-20260909/plane-final-readback.json`. No readiness promotion occurred.
