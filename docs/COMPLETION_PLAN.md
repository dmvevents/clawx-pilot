# Completion plan

**Current mode — September 8, 2026: research, repository organization and handoff.** The owner paused new implementation and packaging before the next sprint. Finish the board/docs checkpoint; the receiving agent should resume implementation only under the next execution instruction. **GA remains RED.** ASR/microphone is deferred; whisper.cpp remains its future design direction.

Start with [PROJECT_CONTRACT.md](PROJECT_CONTRACT.md), this page and [repository navigation](REPOSITORY_GUIDE.md). The [state vector](completion-state.json) records exact evidence and dependencies; the [Plane board](plane-board/CLWX-board.md) and [JSON snapshot](plane-board/CLWX-board-export.json) track work. Current artifact identity belongs in [CURRENT_WINDOWS_RC.md](CURRENT_WINDOWS_RC.md); verification belongs in [GA_RELEASE_EVIDENCE_MANIFEST.md](GA_RELEASE_EVIDENCE_MANIFEST.md).

## Handoff: exact source and artifact

| Layer | Frozen state | Meaning |
|---|---|---|
| Documentation checkout | `fix/doc-tooling-steering`, repository root | Board, research, skills and this handoff. Inspect `git status`; preserve other authors’ changes in `docs/TESTER_QUICKSTART.md` and `docs/build/windows-build-pipeline.md`. |
| Reviewed source candidate | `release/moe26-plan-execution`, `f93ac8b3d8039428bfa6d0dde151b5bfe5d119f5`, `/private/tmp/clawx-plan-execution-20260908` | Version reserved as `0.4.3-moe.26`; clean source, not pushed, packaged, installed or published. Includes reviewed S1–S4 and native Ollama repair. |
| Held test repair | `24e1cfd3dd1d736d15252f77ef3e305fb5367857`, `/private/tmp/clawx-ondevice-policy-5251ea8d-actual` | Excluded from candidate: actual OpenClaw 2026.9.2 full policy pipeline disagrees with the old literal `canvas` fixture. Source revision alone did not guarantee the author tested the new dependency. |
| Latest installed artifact | moe.25, source `8058e9b5b3050463c72a11c8e5da56616206f6e3`, run `34203201042` | Assisted standard-user existing-profile upgrade on GCP Windows Server 2022. Exact package and installed hashes pass; Existing Main, fresh and next Online turns pass. |
| Earlier journey baseline | moe.22, source `a4efc7e4`, run `34180280985` | Retains broader document/lifecycle observations; P3 deadline fidelity and local-model behavior failed. Results do not transfer automatically to moe.25/moe.26. |

The source branch and commits are durable git references; if the temporary checkout disappears, recreate a clean detached worktree from the full candidate SHA. Keep private root board/evidence documents out of a public source sync.

No usable registered local UTM Windows guest was found. GCP Server is the actual Windows lane; a representative Windows 10/11 client and authenticated Microsoft account remain separate dependencies. The [local VM skill/runbook](testing/WINDOWS_LOCAL_VM_TESTING.md) documents discovery, setup, installation and acceptance without conflating these environments.

## What is proven, and what remains

| Workstream | Current evidence | Remaining exit criterion / cards |
|---|---|---|
| Online first response | Unchanged moe.25: Existing Main, empty fresh conversation and next turn each produce the intended cloud answer and pass a 30-second terminal observation. | Same-candidate cancellation/fault recovery, clean Windows client setup and Karunesh’s unaided rerun; CLWX-94/95/96/125. |
| Runtime upgrade | Reviewed OpenClaw 2026.9.2, Electron 42, helper Node 24.15, Playwright 1.62.1; real Ministry tool registration/PDF execution and Windows non-PTY bundle guard pass source checks. | Resolve the current tool-policy oracle; full integrated checks, package and installed runtime proof; CLWX-22/106. |
| Native local model | Reviewed repair writes native Ollama route and aligned 32,768 context fields. Direct native API on VM honors allocation and answers. | Ordinary app turn, correct tool use and source-grounded local files with no non-loopback egress; native diagnostic is not app acceptance; CLWX-26/117. |
| Documents | Reviewed PDF source-excerpt fix preserves explicit deadlines and raw extraction contract. Earlier Word/Excel/image/reminder positives retain their artifact scope. | D0 and all five principal prompts, complete P3 obligations, typed spreadsheet values and generated-file reopen; CLWX-24/77. CLWX-115’s meal/shirt association fixture remains separate and open. |
| Microsoft | Reviewed Graph draft permission correction; send confirmation/state gates preserved. Earlier browser attach reaches `cdp_ready`, then `needs_signin`. | Account-holder authentication, correct read/draft/reopen/reply, both Forms previews and separately authorized dispatch proof; CLWX-40/61/63/73/123. |
| Installer/client | Moe.25 package and assisted Server upgrade identities pass; no manual Node/Python/WSL needed for shipped document helpers. | Fresh Windows 10/11 standard-user install, actionable unprovisioned state and supported model provisioning; CLWX-25. Ollama/model availability remains an explicit local prerequisite. |
| Performance/rehearsal | Measured cold startup and individual Online/native-local timings, with preparation/load separated. | Matched repeated workloads, sample size, p50/p90 and explicit product-budget disposition; continuous three-moment rehearsal with fallback assets; CLWX-43/107. |
| Stakeholder acceptance | Read-only WhatsApp refresh: no new inbound Karunesh response; last owner messages say to wait for the fix. | Tested download and unaided connection/email rerun on the accepted artifact; CLWX-125. Cohort rollout/schedule belongs to CLWX-110. |
| Publication | No new installer, GA tag or completion notice from this checkpoint. | Same-source/profile/artifact strict gate, declared pilot criteria and downloaded-byte verification; CLWX-22/106. |
| Deferred/separate | ASR/whisper.cpp and CLWX-124 action journal deferred. Ministry production identity/backend and fleet rollout remain separate. | Package helper/keyless checks stay mandatory. Pilot proof does not authorize a 450-laptop rollout. |

All seven pilot KRs remain incomplete as end-to-end outcomes. This does not erase the scoped passes above. Source-test or board percentages are not release-completion percentages.

## Source verification checkpoint

The initial combined preflight at `5251ea8d` reported **2,180 passed, 5 failed, 29 skipped**, across 207 files. Four of those failures were repaired and independently reviewed in `42265f97`: stale Gateway export lookups, obsolete Graph refusal wording and the five-second budget on a real plugin-loading test. All 35 tests in those three repaired suites pass. Native-provider source `4f5895ff` (integrated `0b46e833`) passes 30 focused tests and independent actual-9.2 schema/request review; communication replay/compare pass.

The remaining policy-oracle work is **not green**. `24e1cfd3` repairs the minified matcher lookup, but its full-pipeline test fails against explicitly selected OpenClaw 2026.9.2: `canvas` is expanded as a plugin-family alias while the historical fixture includes a literal tool named `canvas`. Tagged 9.2 source maps the `canvas` policy family to promoted core `show_widget`; a Canvas plugin surface also exists. Bind the next oracle to the actual installed/enabled catalog before changing fixture or policy. Do not infer correctness from a 4.23 dependency tree or suppress this assertion. No full preflight rerun or build is claimed for frozen `f93ac8b3`.

Detailed source/review/VM receipts: [execution evidence](evidence/WINDOWS_PLAN_EXECUTION_2026-09-08.md). Raw VM/tenant artifacts remain private under `artifacts/`; board exports and redacted summaries are versioned.

## Next sprint: parallel work, sequential decisions

| Lane | Owner responsibility | Dependency and stop condition |
|---|---|---|
| A — runtime contract | One executor verifies actual 9.2 tool names/policy expansion and repairs the bounded oracle or demonstrated runtime mismatch. | Start from frozen candidate plus held diff. Stop at focused regression and independent approval; do not change product timeouts to mask a test problem. |
| B — local engine research | Dependency researcher designs native Ollama versus llama.cpp comparison using identical model weights, quantization, prompt/tool budget, threads and context. | Read the [source study](research/OPENCLAW_WINDOWS_IMPROVEMENT_STUDY_2026-09-08.md). CLWX-126 owns this experiment. No migration until tool fidelity, memory, latency and vanilla installation meet the same criteria. |
| C — Microsoft/client preparation | Verifier prepares account-holder/client access and exact no-send/no-submit test inputs. | Can proceed independently of source review. Authentication and actual dispatch need their existing action-specific authority. |
| D — docs/tester packet | Writer maintains source/artifact/evidence pointers, test criteria and handoff material. | No readiness promotion without matching evidence. Research completion is distinct from engine adoption; CLWX-127 owns this checkpoint. |
| Integration → package | Root integrates approved changes, runs focused/full applicable gates, selects a clean source and keyless public build. | One exact candidate; preserve source/profile/compiled receipts and manifest. Build only after the owner resumes execution. |
| Windows acceptance → release | One VM operator backs up state, installs visibly and tests the entire changed journey matrix; independent reviewer checks evidence. | Then client/tenant/external/rehearsal and strict release gate; no parallel VM mutations or replay of uncertain writes. |

The canonical release command is `GA_GATE_RELEASE=1 node scripts/ga-gate.mjs --release`. It is side-effectful with live/send lanes enabled: use [the release workflow](../.github/workflows/release-evidence-manual.yml) and [project contract](PROJECT_CONTRACT.md), not a blind copied command. Required missing, skipped or blocked rows prevent publication. The historical `scripts/vm-verify-moe19.sh` has fixed moe.19 paths; adapt the current evidence producer to the selected artifact rather than running it unchanged.

## History and durable references

- [Source research and engine comparison](research/OPENCLAW_WINDOWS_IMPROVEMENT_STUDY_2026-09-08.md), [communication map](architecture/OPENCLAW_WINDOWS_COMMUNICATION_MAP.md), [future ASR design](research/WHISPER_CPP_WINDOWS_ASR_PLAN_2026-09-08.md).
- [Stakeholder connection failure](evidence/WINDOWS_STAKEHOLDER_CONNECTION_2026-09-08.md), [first-response RCA and working commits](evidence/WINDOWS_FIRST_RESPONSE_RCA_2026-09-08.md), [moe.25 baseline](evidence/WINDOWS_MOE25_PLANNING_BASELINE_2026-09-08.md).
- [Earlier Windows journey tests](evidence/WINDOWS_VM_TESTING_2026-09-08.md), [build procedure/retrospective](build/windows-build-pipeline.md), [provisioning boundary](RELEASE_PROVISIONING_PLAN.md), [skills and agents](AGENT_SKILL_INTEROPERABILITY.md), [Plane API contract](PLANE_BOARD_API.md).

The handoff is complete when current pointers agree, every active release blocker has an owner and falsifiable exit, board changes are read back and exported, guidance links/mirrors validate, and the reviewed source plus held work is recoverable. It does not require claiming GA or starting the next sprint.
