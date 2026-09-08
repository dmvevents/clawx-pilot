# Completion plan

**Current mode — September 8, 2026: execution resumed through Claude Fable 5 on Amazon Bedrock.** The owner lifted the handoff pause and requested board-led work, independent testing and live CLI monitoring. Root coordinates priorities/integration; substantive planning, implementation and review use Claude to reduce GPT spend. **GA remains RED.** ASR/microphone and the action journal remain outside the current release; the owner has separately started a Whisper.cpp backlog implementation branch.

## Active GA closure sprint

[Plane sprint](http://localhost:8090/issues-agent/projects/81a2ea23-e060-49b4-a344-1ab0339f46d5/cycles/9a7b9c92-101e-4fd9-bfb7-07bdbdd49b5a) contains **31 cards: 29 existing owners plus CLWX-133 (release-run receipt) and CLWX-134 (unaided stakeholder acceptance)**. The September 8–15 UTC window is a planning target, not a promised GA date. Exact membership, acceptance slices, dependencies, ownership and external gates are mirrored in [the sprint snapshot](plane-board/CLWX-ga-sprint.json). All prior card criteria/history are retained; shared proof for CLWX-73/85/113 and policy/reminder checks stays explicit without duplicate runs.

Latest checkpoint: browser `41359e1`, harness `8bf5d32` and corrected verifier `8935bc0a` have independent approval. Claude assembled them at clean **`1d745567`** and repaired the integration's stale tool inventories. Final full unit run: **2,327 passed, zero failed, 29 skipped**; typecheck and lint pass. Independent review of the three integration-authored deltas is APPROVE (104 focused tests). The initial two baseline-reproducible failures, wrong dependency target and supervision timeout remain recorded. Root froze/pushed `release/moe26-plan-execution` at this revision; [hosted build 34244582967](https://github.com/dmvevents/clawx-pilot/actions/runs/34244582967) is running. No installer exists yet. Earlier Bedrock model-provenance exceptions are retained.

Windows testing now has [a verified recreation procedure](testing/WINDOWS_REPEATABLE_LAB.md): two manual fresh baselines and one actual corrected-launcher VM pass authenticated access, protocol/control and activation checks; each has 8 vCPUs/32 GiB. The first launcher failure and first-boot retries are retained. Idle A/B machines are stopped. **The owner released the original RDP hold; root may operate that Windows desktop. The Mac Electron/Keychain hold remains.**

On installed moe.25, root corrected a foreign-session Chrome endpoint, verified the standard user's Chrome profile, signed in the QA account and confirmed its visible account/inbox. The installed app opened Outlook in 5.4s and read three messages via Host API in 8.7s. A fresh ordinary Online chat answered the expected counts and remained stable, but took 95s; the actual Gateway session confirms `outlook.read_inbox` tool use. Both installed Forms previews also pass (Daily Report 55 filled; Suspensions 29 filled; zero errors, no submission). Graph remains unconfigured/unsigned in. This is assisted Server evidence, not final-candidate or unaided acceptance. [End-user instructions](USER_GUIDE.md) use each principal's **own** Microsoft account; CLWX-134 now requires following them unaided. [Evidence and remaining scope](evidence/WINDOWS_REPEATABLE_LAB_2026-09-08.md).

One continuous execution loop: bounded Claude/Bedrock fixes → focused checks → independent review → root integration/preflight → identified keyless Windows installer → installed/client/Microsoft/document/offline/recovery/performance acceptance → verified candidate download and unaided tester rerun → strict final verdict → GA publication and final hash check. A failure returns to its owning card and resumes the earliest affected stage in this same sprint. New source means a new identified candidate and affected downstream retests; source success never substitutes for installed proof.

Graph CLWX-39/40, document-search CLWX-114 and tab-preservation CLWX-118 remain included. Recovery CLWX-96 already has 145 focused source passes and policy CLWX-117 is already repaired; their remaining work is acceptance evidence, not duplicate implementation. CLWX-102 desktop testing remains held after recurrence. Authenticated browser evidence now exists for the QA account on moe.25; final-candidate Microsoft, client and isolated-GUI evidence remain pending. Only human card closure is reserved; root can record an evidence-backed verdict and perform already authorized release actions.

Start with [PROJECT_CONTRACT.md](PROJECT_CONTRACT.md), this page and [repository navigation](REPOSITORY_GUIDE.md). The [state vector](completion-state.json) records exact evidence and dependencies; the [Plane board](plane-board/CLWX-board.md) and [JSON snapshot](plane-board/CLWX-board-export.json) track work. Current artifact identity belongs in [CURRENT_WINDOWS_RC.md](CURRENT_WINDOWS_RC.md); verification belongs in [GA_RELEASE_EVIDENCE_MANIFEST.md](GA_RELEASE_EVIDENCE_MANIFEST.md).

## Handoff: exact source and artifact

| Layer | Frozen state | Meaning |
|---|---|---|
| Documentation checkout | `fix/doc-tooling-steering`, repository root | Board, research, skills and this handoff. Inspect `git status`; preserve other authors’ changes in `docs/TESTER_QUICKSTART.md` and `docs/build/windows-build-pipeline.md`. |
| Reviewed source candidate | `release/moe26-plan-execution`, `1d7455673774fd70c086b41b405c8ece868ce302`, `/private/tmp/clawx-plan-execution-20260908` | Version `0.4.3-moe.26`; clean, independently approved and pushed. Hosted build `34244582967` in progress. Includes browser ownership, artifact harness and installed verifier fixes. No installer or installed acceptance yet. |
| Held test repair | `24e1cfd3dd1d736d15252f77ef3e305fb5367857`, `/private/tmp/clawx-ondevice-policy-5251ea8d-actual` | Excluded from candidate: actual OpenClaw 2026.9.2 full policy pipeline disagrees with the old literal `canvas` fixture. Source revision alone did not guarantee the author tested the new dependency. |
| Latest installed artifact | moe.25, source `8058e9b5b3050463c72a11c8e5da56616206f6e3`, run `34203201042` | Assisted standard-user existing-profile upgrade on GCP Windows Server 2022. Exact package and installed hashes pass; Existing Main, fresh and next Online turns pass. |
| Earlier journey baseline | moe.22, source `a4efc7e4`, run `34180280985` | Retains broader document/lifecycle observations; P3 deadline fidelity and local-model behavior failed. Results do not transfer automatically to moe.25/moe.26. |

The source branch and commits are durable git references; if the temporary checkout disappears, recreate a clean detached worktree from the full candidate SHA. Keep private root board/evidence documents out of a public source sync.

No usable registered local UTM Windows guest was found. GCP Server is the actual Windows lane. QA browser authentication now passes there; a representative Windows 10/11 client, Graph authentication and unaided account-owner flow remain separate dependencies. The [local VM skill/runbook](testing/WINDOWS_LOCAL_VM_TESTING.md) documents discovery, setup, installation and acceptance without conflating these environments.

## What is proven, and what remains

| Workstream | Current evidence | Remaining exit criterion / cards |
|---|---|---|
| Online first response | Unchanged moe.25: Existing Main, empty fresh conversation and next turn each produce the intended cloud answer and pass a 30-second terminal observation. | Same-candidate cancellation/fault recovery, clean Windows client setup and Karunesh’s unaided rerun; CLWX-94/95/96/125. |
| Runtime upgrade | Reviewed OpenClaw 2026.9.2, Electron 42, helper Node 24.15, Playwright 1.62.1; real Ministry tool registration/PDF execution and Windows non-PTY bundle guard pass source checks. | Policy oracle repaired and independently approved (22 focused tests); final integrated checks, package and installed runtime proof; CLWX-22/106. |
| Native local model | Reviewed repair writes native Ollama route and aligned 32,768 context fields. Direct native API on VM honors allocation and answers. | Ordinary app turn, correct tool use and source-grounded local files with no non-loopback egress; native diagnostic is not app acceptance; CLWX-26/117. |
| Documents | Reviewed PDF source-excerpt fix preserves explicit deadlines and raw extraction contract. Earlier Word/Excel/image/reminder positives retain their artifact scope. | D0 and all five principal prompts, complete P3 obligations, typed spreadsheet values and generated-file reopen; CLWX-24/77. CLWX-115’s meal/shirt association fixture remains separate and open. |
| Microsoft | Reviewed Graph draft permission correction; send confirmation/state gates preserved. Assisted moe.25 standard-user Chrome sign-in, installed inbox read and an ordinary model-driven inbox turn now pass; one chat took 95s. | Final-candidate authenticated read/draft/reopen/reply, Graph OAuth, both Forms previews and separately authorized dispatch proof; CLWX-40/61/63/73/123. |
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

The history/FreeRDP script, report and skills are checkpointed at `2b4a3e81`, with 44 synthetic tests and three skill validations passing; independent review now APPROVE, including a synthetic forward-use test with zero critic calls. Root operations integration is `4993cb2e`; it is separate from the product candidate. CLWX-129 records a redaction defect and the limits on reconstructing historical exposure. Whisper.cpp source `ec97e27b` has independent approval for its opt-in development scope and 38 focused tests; a cancellation race remains on CLWX-87. Both are separate from the moe.26 release candidate.

## Source verification checkpoint

The initial combined preflight at `5251ea8d` reported **2,180 passed, 5 failed, 29 skipped**, across 207 files. Four of those failures were repaired and independently reviewed in `42265f97`: stale Gateway export lookups, obsolete Graph refusal wording and the five-second budget on a real plugin-loading test. All 35 tests in those three repaired suites pass. Native-provider source `4f5895ff` (integrated `0b46e833`) passes 30 focused tests and independent actual-9.2 schema/request review; communication replay/compare pass.

That policy-oracle blocker is repaired: independently approved `babc1bdc` is integrated as `1c387821`, bound to actual OpenClaw 2026.9.2. Held `24e1cfd3` remains excluded; its literal `canvas` fixture did not represent runtime family expansion to `show_widget`. Read-only Graph diagnosis `73b77d0c` is approved and integrated as `6ec32807`. Root reran their six combined focused suites on that candidate: **105 passed**. Final integrated preflight, packaging and installed acceptance remain pending.

Detailed source/review/VM receipts: [execution evidence](evidence/WINDOWS_PLAN_EXECUTION_2026-09-08.md). Raw VM/tenant artifacts remain private under `artifacts/`; board exports and redacted summaries are versioned.

## Fresh owner feedback and bug handoff

[CLWX-130](bugs/CLWX-130-windows-chrome-start.md) records the Chrome-start timeout and Mac recovery hint. Read-only observation found the Gateway in Windows Session 2, Chrome CDP 18792 in Session 1 and managed CDP 18800 in Session 2; later reachability does not prove incident-time readiness. [CLWX-131](bugs/CLWX-131-graph-readiness-diagnosis.md) records the fictional Outlook config lookup: installed Graph status exists but is unconfigured and unsigned in. Its source fix is independently approved and integrated, with 83 focused tests passing; installed acceptance is still open.

The owner requires a [thorough bug handoff](bugs/README.md) for every defect. Both agent entrypoints and the shared contract now require reproduction, artifact identity, evidence, cause confidence, failed attempts, validation and the next action. Independent-review defects in the fidelity checker, CLI supervisor and history sanitizer are retained there too. The owner has released the Windows RDP hold; root is the sole desktop operator. The Mac GUI hold remains.

## Execution: parallel work, sequential decisions

| Lane | Owner responsibility | Dependency and stop condition |
|---|---|---|
| M0 — supervision (CLWX-128) | Completed operational source, integrated in root as `d1605abf`; independent APPROVE and 17 tests pass. | No active author; separate from product source. |
| W1 — runtime oracle (CLWX-106/117) | Approved `babc1bdc`, integrated `1c387821`; 22 focused tests pass against actual 9.2. | Final combined preflight pending. |
| W2 — fidelity (CLWX-115/106) | Correction `6ed95e82` independently approved and integrated as `488ebe29`; 60 tests and 12 fixture rows pass. | Exact with/despite controls fail as required while faithful text passes. The checker covers curated regressions; general semantic limits and installed fidelity remain open. |
| BROWSER — Chrome opening (CLWX-130) | Source `a091a968` committed; 113 focused tests, typecheck, focused lint, harness and comms pass. | Independent review REQUEST_CHANGES: readiness can kill an unverified owned launch; profile/session guidance conflated; actual driver attach bypasses checks. Fix ownership boundary before integration. Stock timeout cause UNKNOWN. |
| GRAPH-SETUP — recovery (CLWX-39/40) | `7a129570` independently APPROVED; 18 new + 45 existing Graph tests pass. | Integrated as `f520d2cc`. Isolated Electron 42 UI proof now PASS on original `7a129570`; final integrated/installed/tenant evidence remains open. |
| GRAPH-DIAG — readiness (CLWX-131) | Approved and integrated at `6ec32807`; 83 focused tests pass. | Installed assistant rerun must prove actual diagnosis replaces the fictional config lookup. |
| FORMS-FILES — study (CLWX-63/71) | Study `a57e6bd7` received REQUEST_CHANGES for unsupported product-route, Forms-store/submission and tenant-access claims. | Verify local tools versus cloud file/Form capabilities; no unsupported Forms API or tenant-access claims. |
| W3/W4 — acceptance preparation | Root uses the existing sprint test specification for artifact/client/Microsoft/recovery testing after source review. | Root may operate the released Windows RDP session; account-specific consent and dispatch gates remain. |
| TEST → integration | Independent Claude reviewers verify diffs; root integrates approved commits. | Authors do not approve their work. One full integrated preflight before packaging. |
| OP — package → Windows → release | Single operator builds and verifies the installed matrix; independent review of receipts. | Windows client, tenant, latency/rehearsal and unaided stakeholder criteria precede strict release verdict. |

At most five author CLIs run concurrently, with independent reviewers following completed checkpoints. The latest dispatch has three authors and two read-only acceptance auditors; Graph setup, fidelity and history source reviews are complete. Whisper.cpp is independently approved only for its separate development backlog scope. Earlier explicit spending caps stopped several sessions; root inspected retained edits and tests before dispatching only the missing work. New sessions have no spending cap under the owner's latest instruction. The engine comparison remains on CLWX-126 as a bounded diagnostic if native offline acceptance fails; it is not a speculative migration dependency. CLI transcripts, progress and final results are private under `artifacts/ga-fable-20260908/`; board comments record meaningful deltas rather than every polling tick.

### Acceptance review: useful parallel work

The September 8 board audit checked the 131-card index, selected full acceptance/history and current source. The preliminary 19-card tally is not an exhaustive GA count: CLWX-102/119/120/121/122 need current-source verification or closure evidence; CLWX-118 adds a Ready regression to final-artifact acceptance. CLWX-113 duplicates CLWX-26's offline proof, and CLWX-114 shares D0/discovery evidence with CLWX-24/77. Do not schedule one agent per card or infer new coding work from an open state.

**Five useful GA lanes can run in parallel before packaging**, each with one owner and independent review. This dependency map informed the dispatch below. The audit itself performed no implementation.

| Lane | Cards and acceptance | Exclusive write scope / dependency |
|---|---|---|
| Browser and draft ownership | CLWX-130/121; retain 73/118 controls. Correct ownership before attach, preserve principal tabs, distinguish wrong session/profile, bind compose subject to owned tab before narrowing draft detection. | Chrome service and Outlook/Forms driver boundaries plus their focused tests. One owner for this coupled change; do not split CLWX-121's two guards. |
| Microsoft journeys and eval reliability | CLWX-39/40/61/63/119/120/123. Reuse reviewed Graph setup; verify existing typed-refusal/eval fixes, complete forward/attachment/metadata test coverage and Forms preview inputs. | Graph/services or eval scripts/fixtures as specifically assigned; no browser-driver edits owned by lane 1. Tenant sign-in and live dispatch acceptance remain later gates. |
| Document, local and lifecycle evidence | CLWX-24/26/77/95/96/115/117/125; reuse 113/114 evidence. D0/P1–P5, exact fidelity, generated-file reopen, no-egress and cancellation/next-turn criteria. | Existing artifact harness, fixtures and acceptance drivers. Prepare/review now; run current installer on Windows later. No shared dependency edits or simultaneous inference benchmarks. |
| UI regression and recovery wording | CLWX-102/122. Verify current English-only E2E expectations and principal-readable errors; remove port/PID from principal-facing output while retaining diagnostics. | Specific renderer components and E2E specs; coordinate the Graph Settings spec rather than changing it concurrently. Reuse the isolated Electron 42 binary already verified by the Graph UI lane. |
| Release evidence and client readiness | CLWX-25/43/106/107/125, release portion of 110. Exact artifact/hash criteria, fresh Windows client protocol, matched latency budget, rehearsal and unaided download test. | Read-only evidence review and test/runbook preparation; root owns current pointers, gate wiring, packaging and VM mutations. External account/client/tester inputs can be arranged while source work runs. |

Sequential path: remaining source corrections and independent approvals → root integration and one full preflight → one identified installer/hash chain → installed identity and ordinary Windows journeys → exclusive-CPU latency samples/rehearsal → verified download and unaided stakeholder acceptance → strict release verdict. One operator controls the current Windows VM/profile. Distinct future machines can validate independently, but three RDP sessions on one VM are not three isolated test environments.

Avoid duplicate work: the NSCC pack and lookup already exist (CLWX-42 also has installed moe.19 presence evidence); Mac reminder fire/defer and earlier Windows fire already have receipts (CLWX-67); `pnpm harness:artifact` already exists. Revalidate their required behavior on the final artifact, rather than rebuilding those features. CLWX-119/120 have September 7 correction evidence despite open board states: check the current source/acceptance delta before assigning another fix. MCP-71 is optional for the existing app journeys; history/skills, Whisper.cpp and fleet backend work do not block this pilot critical path.

The external Claude audit is advisory. Root rejected its proposed NSCC reimplementation, repeated Mac reminder run and new artifact-harness scaffold after checking current code and dated comments, and corrected its treatment of Ready card 118 as an additional open card. Card-state changes require their own complete evidence; no extra card was closed by this audit.

### Earlier dispatch checkpoint (13:01 UTC)

September 8, 13:01 UTC: five Claude CLI processes were verified live with fresh heartbeats and Fable 5 initialization. Final usage metadata still determines provider/model provenance; a running CLI is not an acceptance pass. Reviewed candidate `64ae2dc6` differs from product commit `488ebe29` only by Graph UI evidence documentation.

| Task | Work and scope | Current exit criterion |
|---|---|---|
| `browser-ownership-repair` | CLWX-130/121; Chrome service plus Outlook/Forms attach and compose ownership. Base `736ffe9e` merges the candidate with held browser source. | Reproduce review defects, correct the coupled boundary, focused tests/harness/comms and independent approval. |
| `ui-release-acceptance` | CLWX-122/102; principal-readable footer and current fork E2E baseline at `488ebe29`. | Focused rendered-app evidence using isolated Electron 42, no blanket skips; independent approval. |
| `eval-acceptance-audit` | Read-only CLWX-119/120/61/123 current-source and historical-evidence reconciliation at `488ebe29`. | Identify actual grading/forward/attachment coverage gaps; do not rerun live email or rebuild existing fixes. |
| `artifact-acceptance-audit` | Read-only CLWX-77/D0/P1–P5/local/lifecycle coverage and installed protocol at `488ebe29`. | Map existing artifact harness/fixtures to missing exact-build evidence; no package or VM mutation. |
| `forms-files-correction` | CLWX-63/71; bounded corrections to the reviewed study `a57e6bd7`. | Remove unsupported Forms store/submission and tenant-access claims; preserve existing document.* routes. |

Each task has its own worktree, prompt, status/event/result receipts and 30-minute supervision deadline. The deadline is a liveness control, not a completion estimate. Root integrates reviewed changes, writes Plane and current pointers, then runs the combined preflight. Windows remains observation-only during the owner's RDP test. CLWX-128's monitor and CLWX-129's reviewed history/skills are integrated in the operations checkout; neither is product acceptance.

Latest UI interruption: **REOPENED** after the owner reported the same Keychain dialog at 17:27–17:28 Dubai, with repeated test app windows. The previously approved fixture change `7e1f9417` passed a narrow two-launch synthetic test but did not resolve the full suite. Root stopped `ui-release-resume` and its eight identified descendants; no owned Electron process remained afterward. All desktop UI launches on the owner Mac are held. [CLWX-102 handoff](bugs/CLWX-102-macos-test-keychain.md) preserves both attempts, screenshots, containment, uncertain cause and the read-only Claude investigation. The UI component edits remain preserved and unapproved.

Current source-only Claude dispatch adds `artifact-matrix-repair` (CLWX-77, typed XLSX/JPEG/generated-file reopen coverage), `installed-verifier-repair` (CLWX-106/107, selected-version evidence producer) and `recovery-acceptance-trace` (CLWX-96, verify whether recovery criteria actually need more code). Each has an isolated worktree based on `7e1f9417`. `keychain-recurrence-analysis` inspects the recurrence without launching apps. `browser-repair-finish` intentionally resumes retained browser work after its supervision deadline; completed checks should be reused. None may mutate the Windows owner session or launch desktop tests.

Cost discipline: Claude CLI on Bedrock performs bounded implementation, investigation and independent review; GPT coordinates acceptance, integrates and reports concise deltas. No new GPT subagents, duplicate whole-repo audits or repeated full suites. The email audit verified existing CLWX-119/120 source fixes; do not assign a duplicate repair. Confirmed attachment-download evidence still needs a seeded, authenticated test path. [Acceptance audit disposition](evidence/GA_ACCEPTANCE_AUDIT_2026-09-08.md) records the concrete gaps and assigned exits.

### Sprint exit and epic completion

The active closure sprint exits after the same identified candidate satisfies the required source, installer, installed/client/tenant, performance, unaided tester and final release checks. A verified installer is an intermediate checkpoint. CLWX-133 owns the release-run receipt and CLWX-134 binds the unaided result to its exact bytes; neither bypasses CLWX-22 acceptance.

The earlier 19-card tally and two-sprint estimate are superseded by this explicit 31-card closure cycle. Membership is not a count of new bugs: several cards already have reviewed source and share installed acceptance runs. Fleet portions of shared cards remain open outside the pilot slice.

Sequential release path: reviewed source → full preflight → one build with verified hashes → installed Windows journey matrix → Windows 10/11 standard-user and authenticated Microsoft proof → matched performance/recovery rehearsal → verified download and Karunesh's unaided rerun → strict release verdict. The seven pilot acceptance rows on CLWX-22 cover installation/setup, reliable execution, document fidelity, Microsoft journeys, local/policy/reminder behavior, performance/recovery, and release/stakeholder outcome. Each required row needs artifact-specific evidence. Production/fleet identity, backend durability, metering and rollout decisions retain their separate milestone.

The canonical release command is `GA_GATE_RELEASE=1 node scripts/ga-gate.mjs --release`. It is side-effectful with live/send lanes enabled: use [the release workflow](../.github/workflows/release-evidence-manual.yml) and [project contract](PROJECT_CONTRACT.md), not a blind copied command. Required missing, skipped or blocked rows prevent publication. The historical `scripts/vm-verify-moe19.sh` has fixed moe.19 paths; adapt the current evidence producer to the selected artifact rather than running it unchanged.

## History and durable references

- [Source research and engine comparison](research/OPENCLAW_WINDOWS_IMPROVEMENT_STUDY_2026-09-08.md), [communication map](architecture/OPENCLAW_WINDOWS_COMMUNICATION_MAP.md), [future ASR design](research/WHISPER_CPP_WINDOWS_ASR_PLAN_2026-09-08.md).
- [Stakeholder connection failure](evidence/WINDOWS_STAKEHOLDER_CONNECTION_2026-09-08.md), [first-response RCA and working commits](evidence/WINDOWS_FIRST_RESPONSE_RCA_2026-09-08.md), [moe.25 baseline](evidence/WINDOWS_MOE25_PLANNING_BASELINE_2026-09-08.md).
- [Earlier Windows journey tests](evidence/WINDOWS_VM_TESTING_2026-09-08.md), [build procedure/retrospective](build/windows-build-pipeline.md), [provisioning boundary](RELEASE_PROVISIONING_PLAN.md), [skills and agents](AGENT_SKILL_INTEROPERABILITY.md), [Plane API contract](PLANE_BOARD_API.md).

The handoff checkpoint is complete in `bb729688`: current pointers, source recovery, guidance and independent review pass. The full 127-card board snapshot is verified; CLWX-127 is Ready and CLWX-126 remains Backlog for the engine experiment. All original acceptance/history is retained. GA remains RED. The owner has now resumed execution; that newer instruction supersedes the handoff pause.

Current sprint membership is readback-verified as 31 exact issue IDs. CLWX-133/134 were created through the canonical writer; the other 29 cards retain their original history. The board export and sprint snapshot record the verified totals. CLWX-132 remains a separate open defect whose exposure must be assessed against final supported setup routes.
