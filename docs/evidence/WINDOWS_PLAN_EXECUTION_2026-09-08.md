# Windows plan execution, September 8 2026

The owner resumed the accepted improvement plan, then paused new implementation and packaging again for research, repository organization and next-agent handoff. The current freeze is recorded below. This is an evidence record; [COMPLETION_PLAN.md](../COMPLETION_PLAN.md) and [completion-state.json](../completion-state.json) remain the current execution pointers. GA remains RED and ASR remains deferred.

## Source integration and independent review

Integration checkout: `/private/tmp/clawx-plan-execution-20260908`, branch `release/moe26-plan-execution`, based on moe.25 source `8058e9b5b3050463c72a11c8e5da56616206f6e3`. The branch name reserves the workstream; no moe.26 package exists yet.

| Lane | Source result | Validation and remaining scope |
|---|---|---|
| S1 lifecycle/oracles | Final `23a15b81`, independently reviewed; integrated through `da101df5` | Historical chips are ignored only with the same session and unchanged message prefix. Reused IDs/history replacement and real browser-evaluation dependency failures were reproduced and repaired before approval. 167 focused tests and independent capture-wrapper/negative controls pass. The reviewed driver then passes Existing Main on unchanged moe.25. |
| S2 runtime compatibility | `b6a0fe8d` + `eb307b42`, independently reviewed; integrated through `5251ea8d` | OpenClaw 2026.9.2 / Electron 42 / Node 24.15 / Playwright 1.62.1 form the selected source candidate. Real runtime registry proves 15 local tools, 33 HostAPI-enabled tool names and executable PDF reading. The unmatched Windows PTY guard was restored and made a fail-closed bundle check before approval. 133 focused tests pass; 23 version-gated historical tests skip. Exact Windows package/runtime proof remains open. |
| S3 PDF fidelity | `b96a097f`, independently reviewed; integrated as `7a61a964` | Exact bounded source excerpts preserve explicit deadline/submission sections without changing the raw returned text/truncation contract. 80 focused tests, 88 harness tests, typecheck/lint and direct independent parser/bounds probes support source acceptance. Installed ordinary P3 summary remains unproved. |
| S4 Microsoft diagnostics | `9ea0dbd7`, independently reviewed; integrated as `8fa6bc64` | Graph draft no longer requires send permission; send gate remains. 35 focused tests, typecheck/lint, communication replay/compare and baseline failing regression support source acceptance. Live tenant consent/draft and installed acceptance remain unproved. |

## Unmodified moe.25 installed Online checks

Exact package/environment remain those in the [planning baseline](WINDOWS_MOE25_PLANNING_BASELINE_2026-09-08.md): run `34203201042`, standard-user existing-profile upgrade on GCP Windows Server 2022. Installed EXE/ASAR hashes were rechecked and unchanged. Root alone controlled the guest; tests used the real installed renderer through the bundled Node/Playwright driver in interactive session 2. No runtime files, provider settings or browser profiles were replaced for these tests.

Access recheck passed actual RDP protocol, SSH banner, rejected closed guest-port control and authenticated SSH marker. The tunnel uses the known guest host key alias; an initial invocation without that alias failed host-key verification and did not authenticate. No host-key bypass or firewall change was used.

| Scenario | Actual observation | Result / limits |
|---|---|---|
| Existing Main | Sent 09:35:41.558Z; intended cloud assistant completed 09:37:41.685Z. One matching user/token, no model error/abort/timeout; app returned idle at 09:37:41.933Z. | Raw driver verdict `TIMED_OUT_MID_TURN` retained. The sole terminal blocker was a historical error chip; attribution was subsequently repaired and the rerun below passed. This is not evidence of a provider or completion-state failure. |
| Existing Main rerun, reviewed driver | Sent 10:06:43.230Z; model completed 10:06:56.802Z; driver accepted at 26.574s including stability delay; 30-second terminal observation passed at 10:07:40.677Z. Same Main session, 10→12 messages. | PASS with driver `23a15b81`, SHA256 `fb600334bc625de02279f7463574ae5a0cd8c4fc5ee2aba20d600088b7a93577`. Live ASAR/EXE hashes unchanged; one corresponding user and cloud answer, no abort/timeout/fallback. Original failure remains preserved. |
| Fresh conversation | Genuinely new session, zero prior messages; sent 09:43:53.128Z; assistant completed 09:44:43.232Z; driver accepted answer at 62.915s including its text-stability wait; then 30-second terminal observation passed. | PASS for this provisioned existing-profile artifact. Actual send-to-assistant completion: 50.104s. One sample; not fresh-machine provisioning or a latency percentile. |
| Next turn, same fresh session | Sent 09:46:38.420Z; assistant completed 09:46:56.049Z; driver accepted answer at 30.599s including its text-stability wait; then 30-second terminal observation passed. | PASS. Actual send-to-assistant completion: 17.629s. Same session, no duplicate token, error, fallback or late failure. |

All three accepted turns correlate to `custom-moecloud/moe-demo-pro`, with one corresponding user message and one non-error assistant answer. The deployed-source provenance below resolves that alias to Vertex Gemini 2.5 Pro. Model identity alone does not prove quality on principal tasks.

### Why the first test verdict was misleading

The driver inspected any `[data-testid="chat-message-error-chip"]` in Main history. Its pre-send message IDs were 0–7. The four chips belonged to message containers 3, 4, 5 and 6; the current answer was container 9. A bounded DOM ownership probe at 09:42:45.798Z confirmed all chips belonged to pre-send history, none to the last answer, with `sending=false` and `errorPresent=false`. The screenshot agrees. Preserve that history and the original raw failure; correct the measurement rather than removing error evidence or extending a product timeout.

Existing Main also retains queued synthetic diagnostic text from the older failed attempt. It is not a fresh-session control. The new-conversation test and next turn provide independent clean-conversation evidence.

Local raw receipts are under `artifacts/windows-vm/20260908-moe25/`: `existing-task-result.json`, `existing-correlation.json`, `existing-renderer-timeline.jsonl`, `existing-chip-ownership.json`, the corresponding `fresh-*` and `warm-*` files, the `existing-v2-*` rerun receipts, and per-turn driver JSON/screenshots. They contain synthetic test content and remain outside git.

## Latency and environment evidence

At 09:38:03Z, a single VM snapshot showed four logical CPUs, 2% processor load, 11,206 MiB free of 16,380 MiB RAM and about 26.4 GB disk free. This does not establish the cause of earlier delays; it does not support a resize on its own. Existing-Main preparation took about 79 seconds before the model request; the fresh conversation took about 16 seconds; the next turn about 10.5 seconds. These are distinct phases and single observations, not benchmark percentiles.

The separate read-only cloud inspection records the deployed broker revision `clawx-model-broker-00001-jss`, forwarding `moe-demo-pro` unchanged. Eleven successful chat request logs in the inspected interval had median 33.134s and maximum 40.680s; these are mixed historical requests, not a controlled same-task benchmark. No new model requests were issued by that inspection.

The broker's configured upstream matches the owned Cloud Run LiteLLM service, revision `clawx-litellm-gateway-00002-k7b` at 100% traffic. Its regional Cloud Build `4ed21702-c71b-423d-89f5-ee81e5e21f0d` source archive maps `moe-demo` to `vertex_ai/gemini-2.5-flash` and `moe-demo-pro` to `vertex_ai/gemini-2.5-pro`. The archive SHA256 is `ffaaf6433f0a7bf96978d1b60006c32b0536cb0d83f7eb3d66f9030a4d0d6dfe`; extracted configuration SHA256 is `fac451ab68a0a15cb7e7b140f192a74345eda54359815ec6816e736cf0548951`. The Dockerfile copies this configuration into the deployed image. This establishes deployed build-source provenance; direct image-content extraction timed out, so no byte-level container attestation is claimed. The redacted receipt is `artifacts/windows-vm/20260908-moe25/cloud-model-provenance.json`.

## Local VM skill and remaining acceptance environments

The [local Windows VM runbook](../testing/WINDOWS_LOCAL_VM_TESTING.md) and mirrored `windows-local-vm-testing` skills were created and validated. UTM/QEMU tools exist, but bounded `utmctl list` returned no registered guests; no usable local Windows VM was available or tested. Three skill copies are identical and validated. The Mac source harness, local hypervisor capability and actual GCP Windows guest are explicitly distinguished.

A single bounded physical-pilot SSH probe could not connect. This leaves representative native Windows client acceptance open. No new VM was provisioned, no existing VM was stopped/resized, and no tenant credentials were automated. Microsoft account-holder authentication and the unaided stakeholder rerun remain separate release requirements.

## Combined source checks and offline hold

The integration at `5251ea8d` passes 302 tests across 11 affected suites. This is source evidence, separate from the unchanged moe.25 installed results above. Full integration/package and changed-runtime Windows acceptance remain pending.

The earlier local-context-only branch was held outside integration. Its metadata correction and OpenAI-compatible `options.num_ctx` injection do not establish a runtime fix: existing Ollama v0.32.14 evidence shows that compatibility route drops the option. A read-only VM metadata probe at 09:58:30Z found native Qwen context 32,768, no model resident, and no explicit `num_ctx` parameter. At 10:12:56–10:13:24Z, a direct native `/api/chat` diagnostic returned its one synthetic answer and `/api/ps` reported allocated context 32,768. Wall time was 27.396s, including 23.331s cold model load, 2.348s prompt evaluation and 1.473s decoding. The model used 3,368,466,512 bytes with no VRAM. This proves native API allocation on the guest, not app-routed offline acceptance; no app files or provider settings changed. Receipt: `artifacts/windows-vm/20260908-moe25/native-context-diagnostic.json`.

A read-only app-policy capture at 10:15:35Z confirms the managed `ollama-ollamalo` row still uses `openai-completions` and has no context metadata. Global tools use the full profile with the existing local deny list. Source `4f5895ff` switches the managed loopback account to the native contract; it passed independent actual-9.2 review and was integrated as `0b46e833`; full app prompt size and offline document performance remain unproved. Receipt: `artifacts/windows-vm/20260908-moe25/local-provider-policy.json`.

Plane execution notices and five comments are readback-verified; the 125-card export preserves original acceptance descriptions and has no enrichment regression. CLWX-115 moved Backlog→In Progress for active fidelity validation; no card was promoted to Ready or Done in this pass. Receipts: `artifacts/plane/20260908-execution/verified-summary.json`.

## Frozen source and exact preflight gap

The reviewed candidate is `f93ac8b3d8039428bfa6d0dde151b5bfe5d119f5` on `release/moe26-plan-execution`, version reserved `0.4.3-moe.26`. The isolated checkout is clean. It has not been pushed, packaged, installed or published. In addition to S1–S4 it includes native Ollama `0b46e833`, reviewed test repairs `42265f97` and version/Node prerequisite metadata `f93ac8b3`. The temporary checkout is recoverable from the branch/full commit; root private board/evidence documents are not the public candidate payload.

One full `pnpm run preflight` at `5251ea8d` reported **2,180 passed, 5 failed, 29 skipped** (200 passing, four failing, three skipped files). The failure list was stale Graph refusal wording, obsolete minified tool-policy export lookup, a five-second real-plugin verifier timeout and two obsolete Gateway export lookups in VM evidence tests. Independent review approved `42265f97`: Graph still requires the operation-specific send permission and dispatch gates; Gateway tests still require backend/operator.read and reject admin; the real registry/PDF integration test uses its existing scoped transport budget. **35 tests in those three repaired suites pass.** Typecheck/lint at the earlier integration passed with 49 existing warnings. There is no full-suite pass claim at frozen `f93ac8b3`.

Held test-only commit `24e1cfd3dd1d736d15252f77ef3e305fb5367857` remains excluded in `/private/tmp/clawx-ondevice-policy-5251ea8d-actual`. The author initially used a linked older dependency tree. Independent review explicitly selected the candidate's OpenClaw 2026.9.2 with `CLAWX_OPENCLAW_RUNTIME_ROOT` and reproduced a full-pipeline failure: literal `canvas` survived. Tagged upstream source maps the `canvas` policy family to promoted core tool `show_widget`, while retaining a Canvas plugin catalog entry. The old artificial tool catalog may therefore be the wrong oracle; this is not proof of a live unsafe tool exposure. The next executor must print/assert the actual dependency version, bind tests to the enabled runtime catalog and preserve denial semantics. No further implementation is part of this handoff.

Candidate-private logs: `.tmp/ga-execution-20260908/preflight.log`, `preflight-repairs.log`, `runtime-verifier.log`. The real registry verifier also passes standalone; the full harness orchestrator had a working-directory `ext:bridge` resolution failure, so root equivalents were run explicitly. The native provider change passes 30 focused tests, actual-9.2 schema/request review, communication replay/compare and task-spec validation/dry run. A first local author oracle accidentally reached localhost inference before being corrected to stop before transport; this source-check history is not described as wholly inference-free.

## Research and stakeholder checkpoint

[The engine study](../research/OPENCLAW_WINDOWS_IMPROVEMENT_STUDY_2026-09-08.md) records native Ollama versus llama.cpp under CLWX-126. The measured cold native load accounts for 85.2% of the 27.396s wall sample; allocation is 3.137 GiB. The historical failed app payload contains 33,177 system characters and 33,102 tool-schema characters across 47 tools. Character counts are not tokens; tiny direct API timing cannot predict full app-tool performance. No matched llama.cpp experiment exists. Retain the reviewed native route as a candidate and decide replacement only from a matched Windows/tool/installation comparison.

The read-only local WhatsApp bridge refresh found no inbound Karunesh message after 03:39Z. Latest messages in the thread at 03:59:11Z and 03:59:26Z are owner outbound questions/wait instructions, not stakeholder acceptance. The database was refreshed through 10:21:32Z; there is no callable WhatsApp MCP in this session and sync freshness is not proof every remote message is present. Redacted receipt: `artifacts/windows-vm/20260908-moe25/stakeholder-whatsapp-refresh-20260908-redacted.json`. No message was sent by this refresh.

## Handoff and board correction

CLWX-126 owns the prospective engine comparison; CLWX-127 owns repository guidance, board snapshot and handoff. Existing acceptance is retained on release cards. CLWX-26 is reopened from Ready because current offline behavior is unproved/previously failed; CLWX-87 returns to Backlog under the owner's explicit ASR deferral. The earlier Graph execution text on ASR CLWX-87 was a card-mapping error: the current summary corrects it and points to CLWX-40, while retaining the older dated comment. CLWX-115's original meal-preference/shirt-size association fixture remains separate from P3 PDF evidence on CLWX-77.

The current description marker is `CLWX-HANDOFF-CURRENT-20260908`. Verified API receipts stay in `artifacts/plane/20260908-handoff/`; the complete redacted board snapshot is versioned in `docs/plane-board/`. [Repository navigation](../REPOSITORY_GUIDE.md) and [agent/skill mapping](../AGENT_SKILL_INTEROPERABILITY.md) provide entrypoints, ownership, mirrored workflows and validation scope.

The initial handoff export contains 127 issues and six states, with all prior comments retained and all 13 changed current descriptions read back with original acceptance history preserved. Seven new evidence comments pass detail/list/export readback. CLWX-127 remains In Progress until the repository checkpoint is committed. Independent handoff review found no blocking defects. Eleven guidance/evidence documents have 115 valid local links; seven native agent TOMLs parse, five critical skill-mirror pairs agree and both new skill mirrors pass the skill validator. The nine-node work-package graph has no cycles. These are documentation checks, not a new product-suite or installed pass.

## Next evidence after the owner resumes execution

Resolve the actual-9.2 policy oracle, independently review it and run applicable integrated checks before selecting one package. Parallel research, test-input preparation and documentation can proceed without competing VM changes. One operator owns installation and runtime acceptance. PDF fidelity, on-device/offline behavior, authenticated Microsoft workflows, recovery, representative Windows client, repeated latency and external acceptance remain open. Source, installer, account and stakeholder evidence cannot substitute for one another.
