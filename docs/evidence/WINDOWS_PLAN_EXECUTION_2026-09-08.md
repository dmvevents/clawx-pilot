# Windows plan execution, September 8 2026

The owner resumed the accepted improvement plan after the research pause. This is an evidence record; [COMPLETION_PLAN.md](../COMPLETION_PLAN.md) and [completion-state.json](../completion-state.json) remain the current execution pointers. GA remains RED and ASR remains deferred.

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

The local-context branch is held outside integration. Its metadata correction and OpenAI-compatible `options.num_ctx` injection do not establish a runtime fix: existing Ollama v0.32.14 evidence shows that compatibility route drops the option. A read-only VM metadata probe at 09:58:30Z found native Qwen context 32,768, no model resident, and no explicit `num_ctx` parameter. At 10:12:56–10:13:24Z, a direct native `/api/chat` diagnostic returned its one synthetic answer and `/api/ps` reported allocated context 32,768. Wall time was 27.396s, including 23.331s cold model load, 2.348s prompt evaluation and 1.473s decoding. The model used 3,368,466,512 bytes with no VRAM. This proves native API allocation on the guest, not app-routed offline acceptance; no app files or provider settings changed. Receipt: `artifacts/windows-vm/20260908-moe25/native-context-diagnostic.json`.

A read-only app-policy capture at 10:15:35Z confirms the managed `ollama-ollamalo` row still uses `openai-completions` and has no context metadata. Global tools use the full profile with the existing local deny list. Source `4f5895ff` switches the managed loopback account to the native contract and is under independent review; full app prompt size and offline document performance remain unproved. Receipt: `artifacts/windows-vm/20260908-moe25/local-provider-policy.json`.

Plane execution notices and five comments are readback-verified; the 125-card export preserves original acceptance descriptions and has no enrichment regression. CLWX-115 moved Backlog→In Progress for active fidelity validation; no card was promoted to Ready or Done in this pass. Receipts: `artifacts/plane/20260908-execution/verified-summary.json`.

## Next evidence

Finish the scoped source repairs and independent review, select the coherent backend candidate, run integrated checks, then build one exact package and validate the affected Windows journeys. PDF fidelity, on-device/offline behavior, authenticated Microsoft workflows, recovery, representative Windows client, repeated latency and external acceptance remain open. Source, installer, account and stakeholder evidence cannot substitute for one another.
