# Completion plan

**Current mode — September 8, 2026: execution resumed through Claude Fable 5 on Amazon Bedrock.** The owner lifted the handoff pause and requested board-led work, independent testing and live CLI monitoring. Root coordinates priorities/integration; substantive planning, implementation and review use Claude to reduce GPT spend. **GA remains RED.** ASR/microphone and the action journal remain outside the current release; the owner has separately started a Whisper.cpp backlog implementation branch.

Start with [PROJECT_CONTRACT.md](PROJECT_CONTRACT.md), this page and [repository navigation](REPOSITORY_GUIDE.md). The [state vector](completion-state.json) records exact evidence and dependencies; the [Plane board](plane-board/CLWX-board.md) and [JSON snapshot](plane-board/CLWX-board-export.json) track work. Current artifact identity belongs in [CURRENT_WINDOWS_RC.md](CURRENT_WINDOWS_RC.md); verification belongs in [GA_RELEASE_EVIDENCE_MANIFEST.md](GA_RELEASE_EVIDENCE_MANIFEST.md).

## Handoff: exact source and artifact

| Layer | Frozen state | Meaning |
|---|---|---|
| Documentation checkout | `fix/doc-tooling-steering`, repository root | Board, research, skills and this handoff. Inspect `git status`; preserve other authors’ changes in `docs/TESTER_QUICKSTART.md` and `docs/build/windows-build-pipeline.md`. |
| Reviewed source candidate | `release/moe26-plan-execution`, `6ec328073f272c538e2e0d653824c1f407b6e6e4`, `/private/tmp/clawx-plan-execution-20260908` | Version reserved as `0.4.3-moe.26`; clean source, not pushed, packaged, installed or published. Includes reviewed S1–S4, native Ollama repair, actual-9.2 policy oracle and read-only Outlook/Graph diagnosis. |
| Held test repair | `24e1cfd3dd1d736d15252f77ef3e305fb5367857`, `/private/tmp/clawx-ondevice-policy-5251ea8d-actual` | Excluded from candidate: actual OpenClaw 2026.9.2 full policy pipeline disagrees with the old literal `canvas` fixture. Source revision alone did not guarantee the author tested the new dependency. |
| Latest installed artifact | moe.25, source `8058e9b5b3050463c72a11c8e5da56616206f6e3`, run `34203201042` | Assisted standard-user existing-profile upgrade on GCP Windows Server 2022. Exact package and installed hashes pass; Existing Main, fresh and next Online turns pass. |
| Earlier journey baseline | moe.22, source `a4efc7e4`, run `34180280985` | Retains broader document/lifecycle observations; P3 deadline fidelity and local-model behavior failed. Results do not transfer automatically to moe.25/moe.26. |

The source branch and commits are durable git references; if the temporary checkout disappears, recreate a clean detached worktree from the full candidate SHA. Keep private root board/evidence documents out of a public source sync.

No usable registered local UTM Windows guest was found. GCP Server is the actual Windows lane; a representative Windows 10/11 client and authenticated Microsoft account remain separate dependencies. The [local VM skill/runbook](testing/WINDOWS_LOCAL_VM_TESTING.md) documents discovery, setup, installation and acceptance without conflating these environments.

## What is proven, and what remains

| Workstream | Current evidence | Remaining exit criterion / cards |
|---|---|---|
| Online first response | Unchanged moe.25: Existing Main, empty fresh conversation and next turn each produce the intended cloud answer and pass a 30-second terminal observation. | Same-candidate cancellation/fault recovery, clean Windows client setup and Karunesh’s unaided rerun; CLWX-94/95/96/125. |
| Runtime upgrade | Reviewed OpenClaw 2026.9.2, Electron 42, helper Node 24.15, Playwright 1.62.1; real Ministry tool registration/PDF execution and Windows non-PTY bundle guard pass source checks. | Policy oracle repaired and independently approved (22 focused tests); final integrated checks, package and installed runtime proof; CLWX-22/106. |
| Native local model | Reviewed repair writes native Ollama route and aligned 32,768 context fields. Direct native API on VM honors allocation and answers. | Ordinary app turn, correct tool use and source-grounded local files with no non-loopback egress; native diagnostic is not app acceptance; CLWX-26/117. |
| Documents | Reviewed PDF source-excerpt fix preserves explicit deadlines and raw extraction contract. Earlier Word/Excel/image/reminder positives retain their artifact scope. | D0 and all five principal prompts, complete P3 obligations, typed spreadsheet values and generated-file reopen; CLWX-24/77. CLWX-115’s meal/shirt association fixture remains separate and open. |
| Microsoft | Reviewed Graph draft permission correction; send confirmation/state gates preserved. Earlier browser attach reaches `cdp_ready`, then `needs_signin`. | Account-holder authentication, correct read/draft/reopen/reply, both Forms previews and separately authorized dispatch proof; CLWX-40/61/63/73/123. |
| Installer/client | Moe.25 package and assisted Server upgrade identities pass; no manual Node/Python/WSL needed for shipped document helpers. | Fresh Windows 10/11 standard-user install, actionable unprovisioned state and supported model provisioning; CLWX-25. Ollama/model availability remains an explicit local prerequisite. |
| Performance/rehearsal | Measured cold startup and individual Online/native-local timings, with preparation/load separated. | Matched repeated workloads, sample size, p50/p90 and explicit product-budget disposition; continuous three-moment rehearsal with fallback assets; CLWX-43/107. |
| Stakeholder acceptance | Read-only WhatsApp refresh: no new inbound Karunesh response; last owner messages say to wait for the fix. | Tested download and unaided connection/email rerun on the accepted artifact; CLWX-125. Cohort rollout/schedule belongs to CLWX-110. |
| Publication | No new installer, GA tag or completion notice from this checkpoint. | Same-source/profile/artifact strict gate, declared pilot criteria and downloaded-byte verification; CLWX-22/106. |
| Deferred/separate | ASR/whisper.cpp and CLWX-124 action journal deferred. Ministry production identity/backend and fleet rollout remain separate. | Package helper/keyless checks stay mandatory. Pilot proof does not authorize a 450-laptop rollout. |

All seven pilot KRs remain incomplete as end-to-end outcomes. This does not erase the scoped passes above. Source-test or board percentages are not release-completion percentages.

## Claude execution checkpoint

The Fable 5 planner and independent plan review completed; ownership, dependency and evidence-class corrections were applied. The sprint PRD and test specification are `.omx/plans/prd-ga-fable-20260908.md` and `.omx/plans/test-spec-ga-fable-20260908.md`. This page owns current execution state; the initial dispatch documents retain their dated baseline. **CLWX-22 is the GA epic/OKR anchor.** Private streams and receipts are under `artifacts/ga-fable-20260908/`.

At September 8, 12:27 UTC, no Claude author/reviewer process remained active. The Chrome author had reached its explicit spending cap, preserving edits and focused-test receipts; other sessions had completed or checkpointed. Root then launched three bounded lanes: Chrome validation/commit, Graph source review and the remaining fidelity-negation correction. Fresh process/heartbeat and Fable 5 initialization were verified. Running is not acceptance; exit criteria follow below.

The initial planner attempt failed because an ambient Bedrock bearer token had expired. The successful invocation removed that override for the child process and used the authenticated `bedrock` AWS profile in `us-east-2`; global credentials were not changed. Runs explicitly select `claude-fable-5`. No model fallback is configured.

The owner clarified there is no spending limit and instructed execution of the worktrees. New supervised sessions run without a CLI spending cap; bounded ownership, independent review, liveness monitoring and explicit task deadlines remain. Completed runs retain their original receipts.

Each execution session must retain its session ID, isolated write scope, event stream, process/heartbeat status, budget/deadline and final result. A quiet interval produces a warning; it does not establish a hang. A successful CLI result does not establish test or release acceptance. Independent tests and review remain mandatory. No automatic replay of interrupted writes. The sole VM/package operator starts after reviewed source integration; client, tenant and unaided stakeholder evidence remain separate release dependencies.

The history/FreeRDP script, report and skills are checkpointed at `2b4a3e81`, with 44 synthetic tests and three skill validations passing; independent review is pending. CLWX-129 records a redaction defect and the limits on reconstructing historical exposure. Whisper.cpp source `ec97e27b` has independent approval for its opt-in development scope and 38 focused tests; a cancellation race remains on CLWX-87. Both are separate from the moe.26 release candidate.

## Source verification checkpoint

The initial combined preflight at `5251ea8d` reported **2,180 passed, 5 failed, 29 skipped**, across 207 files. Four of those failures were repaired and independently reviewed in `42265f97`: stale Gateway export lookups, obsolete Graph refusal wording and the five-second budget on a real plugin-loading test. All 35 tests in those three repaired suites pass. Native-provider source `4f5895ff` (integrated `0b46e833`) passes 30 focused tests and independent actual-9.2 schema/request review; communication replay/compare pass.

That policy-oracle blocker is repaired: independently approved `babc1bdc` is integrated as `1c387821`, bound to actual OpenClaw 2026.9.2. Held `24e1cfd3` remains excluded; its literal `canvas` fixture did not represent runtime family expansion to `show_widget`. Read-only Graph diagnosis `73b77d0c` is approved and integrated as `6ec32807`. Root reran their six combined focused suites on that candidate: **105 passed**. Final integrated preflight, packaging and installed acceptance remain pending.

Detailed source/review/VM receipts: [execution evidence](evidence/WINDOWS_PLAN_EXECUTION_2026-09-08.md). Raw VM/tenant artifacts remain private under `artifacts/`; board exports and redacted summaries are versioned.

## Fresh owner feedback and bug handoff

[CLWX-130](bugs/CLWX-130-windows-chrome-start.md) records the Chrome-start timeout and Mac recovery hint. Read-only observation found the Gateway in Windows Session 2, Chrome CDP 18792 in Session 1 and managed CDP 18800 in Session 2; later reachability does not prove incident-time readiness. [CLWX-131](bugs/CLWX-131-graph-readiness-diagnosis.md) records the fictional Outlook config lookup: installed Graph status exists but is unconfigured and unsigned in. Its source fix is independently approved and integrated, with 83 focused tests passing; installed acceptance is still open.

The owner requires a [thorough bug handoff](bugs/README.md) for every defect. Both agent entrypoints and the shared contract now require reproduction, artifact identity, evidence, cause confidence, failed attempts, validation and the next action. Independent-review defects in the fidelity checker, CLI supervisor and history sanitizer are retained there too. The current VM remains observation-only while the owner tests.

## Execution: parallel work, sequential decisions

| Lane | Owner responsibility | Dependency and stop condition |
|---|---|---|
| M0 — supervision (CLWX-128) | Completed operational source, integrated in root as `d1605abf`; independent APPROVE and 17 tests pass. | No active author; separate from product source. |
| W1 — runtime oracle (CLWX-106/117) | Approved `babc1bdc`, integrated `1c387821`; 22 focused tests pass against actual 9.2. | Final combined preflight pending. |
| W2 — fidelity (CLWX-115/106) | Correction `6ed95e82` is committed; 60 tests and 12 fixture rows pass; independent delta review running. | Exact with/despite controls now fail as required while faithful text passes. Independent delta approval precedes integration; installed fidelity remains open. |
| BROWSER — Chrome opening (CLWX-130) | Source `a091a968` committed; 113 focused tests, typecheck, focused lint, harness and comms pass. | Independent source review running. Exact stock timeout cause UNKNOWN; installed rerun required. |
| GRAPH-SETUP — recovery (CLWX-39/40) | `7a129570` independently APPROVED; 18 new + 45 existing Graph tests pass. | Integration and Electron UI proof remain; the UI test is BLOCKED by missing Electron 42 binary. Real tenant proof absent. |
| GRAPH-DIAG — readiness (CLWX-131) | Approved and integrated at `6ec32807`; 83 focused tests pass. | Installed assistant rerun must prove actual diagnosis replaces the fictional config lookup. |
| FORMS-FILES — study (CLWX-63/71) | Study committed at `a57e6bd7`; independent factual review queued. | Verify local tools versus cloud file/Form capabilities; no unsupported Forms API or tenant-access claims. |
| W3/W4 — acceptance preparation | Root uses the existing sprint test specification for artifact/client/Microsoft/recovery testing after source review. | Account-holder and action-specific gates remain; VM observation only while owner tests. |
| TEST → integration | Independent Claude reviewers verify diffs; root integrates approved commits. | Authors do not approve their work. One full integrated preflight before packaging. |
| OP — package → Windows → release | Single operator builds and verifies the installed matrix; independent review of receipts. | Windows client, tenant, latency/rehearsal and unaided stakeholder criteria precede strict release verdict. |

At most five author CLIs run concurrently, with independent reviewers following completed checkpoints. Current author work covers Chrome opening/ownership, Graph setup, fidelity corrections and the history sanitizer. Whisper.cpp is committed on its separate backlog branch and under independent review. Explicit spending caps stopped several sessions; root inspected the retained edits and tests before committing or dispatching only the missing work. The engine comparison remains on CLWX-126 as a bounded diagnostic if native offline acceptance fails; it is not a speculative migration dependency. CLI transcripts, progress and final results are private under `artifacts/ga-fable-20260908/`; board comments record meaningful deltas rather than every polling tick.

### Sprint exit and epic completion

The current sprint exits when browser, Graph setup and fidelity corrections are independently accepted, the integrated candidate passes full preflight, and one identified moe.26 installer is ready for installed acceptance. Source integration alone does not complete CLWX-22.

Release-work tally at this checkpoint: **19 open cards plus CLWX-22**, with five related Ready cards requiring final-artifact revalidation. Open: CLWX-25/26/39/40/43/61/63/77/95/96/106/107/110/115/117/123/125/130/131. Ready: CLWX-24/42/67/73/94. This counts only pilot-release portions of shared cards; broader CLWX-110 cohort rollout is excluded. Plan for the rest of the current stabilization sprint plus one acceptance/release sprint, with a contingency sprint if acceptance exposes defects. This is a planning estimate, not a calendar ETA or completion percentage.

Sequential release path: reviewed source → full preflight → one build with verified hashes → installed Windows journey matrix → Windows 10/11 standard-user and authenticated Microsoft proof → matched performance/recovery rehearsal → verified download and Karunesh's unaided rerun → strict release verdict. The seven pilot acceptance rows on CLWX-22 cover installation/setup, reliable execution, document fidelity, Microsoft journeys, local/policy/reminder behavior, performance/recovery, and release/stakeholder outcome. Each required row needs artifact-specific evidence. Production/fleet identity, backend durability, metering and rollout decisions retain their separate milestone.

The canonical release command is `GA_GATE_RELEASE=1 node scripts/ga-gate.mjs --release`. It is side-effectful with live/send lanes enabled: use [the release workflow](../.github/workflows/release-evidence-manual.yml) and [project contract](PROJECT_CONTRACT.md), not a blind copied command. Required missing, skipped or blocked rows prevent publication. The historical `scripts/vm-verify-moe19.sh` has fixed moe.19 paths; adapt the current evidence producer to the selected artifact rather than running it unchanged.

## History and durable references

- [Source research and engine comparison](research/OPENCLAW_WINDOWS_IMPROVEMENT_STUDY_2026-09-08.md), [communication map](architecture/OPENCLAW_WINDOWS_COMMUNICATION_MAP.md), [future ASR design](research/WHISPER_CPP_WINDOWS_ASR_PLAN_2026-09-08.md).
- [Stakeholder connection failure](evidence/WINDOWS_STAKEHOLDER_CONNECTION_2026-09-08.md), [first-response RCA and working commits](evidence/WINDOWS_FIRST_RESPONSE_RCA_2026-09-08.md), [moe.25 baseline](evidence/WINDOWS_MOE25_PLANNING_BASELINE_2026-09-08.md).
- [Earlier Windows journey tests](evidence/WINDOWS_VM_TESTING_2026-09-08.md), [build procedure/retrospective](build/windows-build-pipeline.md), [provisioning boundary](RELEASE_PROVISIONING_PLAN.md), [skills and agents](AGENT_SKILL_INTEROPERABILITY.md), [Plane API contract](PLANE_BOARD_API.md).

The handoff checkpoint is complete in `bb729688`: current pointers, source recovery, guidance and independent review pass. The full 127-card board snapshot is verified; CLWX-127 is Ready and CLWX-126 remains Backlog for the engine experiment. All original acceptance/history is retained. GA remains RED. The owner has now resumed execution; that newer instruction supersedes the handoff pause.

Current board checkpoint: 131 cards and six states exported with all prior descriptions/comments retained. The seven detailed bug dossiers are linked from their owning cards; CLWX-128 is Ready after independent operational review. Later dated status supersedes historical running/hold statements.
