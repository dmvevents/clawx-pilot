# Windows VM evidence — September 8, 2026

Status: **PARTIAL; GA remains RED.** Current selected and installed artifact is `a4efc7e4a4311d7865bf0c74ab2320289fdadd48` / [build 34180280985](https://github.com/dmvevents/clawx-pilot/actions/runs/34180280985). Its exact identities are in the [candidate pointer](../CURRENT_WINDOWS_RC.md) and [generated manifest](../release-manifests/0.4.3-moe.22.json). Earlier baseline evidence is preserved below.

## Selected build 34180280985 — installed retests, 03:23 UTC

Evidence root: `artifacts/windows-vm/20260908-moe22/installed-acceptance-34180280985/` (local, ignored). Same Server 2022, 4 vCPU / 16 GB, reused administrator profile and interactive session 1; no microphone. These observations do not establish fresh Windows client or standard-user acceptance.

| Check | Result and evidence |
|---|---|
| Build and artifact | PASS: 204 native files / 2,114 tests, 11 skipped; full source/profile/provenance and artifact verification. Installer 394,149,483 bytes, SHA256 `eed3d9ec87902d1babcf7906122009ac3a0ec708871db175de52871dc3e5938f`. Host and guest agree. |
| State preservation and assisted install | PASS: graceful quit; 807 AppData + 1,013 OpenClaw files backed up with matching counts; prior application directory preserved. License, location, install and completion screens observed; Run unchecked before Finish. Exit 0 at 03:08:57.518Z. |
| Installed payload | PASS: exact selected EXE/ASAR, eight helpers, Playwright, desktop and Start Menu shortcuts. Keyless seed files absent as intended. `install-result.json`, `installed-payload-verification.json`. |
| Cold startup | PASS with latency finding: actual desktop shortcut at 03:09:36.210Z; first Gateway/composer/idle readiness 03:11:21.956Z = 105,745 ms, followed by 20,164 ms continuous readiness. One sample. `cold-launch.json`, `cold-startup-readiness.json`, `startup-content-review.json`. |
| Startup video | Capture hash and 12 nonblank frames verified: 300.067 seconds, 1280 × 800, SHA256 `b30c054c955e9242455dd72b0f2c039931f4df74bec7d18c288b0c65b9cb1c9a`. Independent rendering/Online transition review passes. Retained historical chat is excluded from current-turn acceptance. `recordings/startup/host-verified/host-verification.json`, `startup-visual-review.json`. |
| P3 PDF | Content FAIL: correct unique folder-scoped `document.find` and `document.read_pdf`, complete 835-character source, no tool error. Answer preserves July 30, August 4–15, forms, route and explanation, but omits the August 29 consolidated Head Office deadline. Driver latency 101,252 ms; stable for 30 seconds. Independent `p3-content-review.json`, transcript and grounding reviews. |
| P5 image | Content PASS: all 11 fields, eight exact values and three blanks. Correct unique scoped PNG and native image block; live managed cloud catalog declares text + image. One generic `image` call rejected the local media path, followed by successful `document.read_image`; zero-error sequence remains FAIL. Driver latency 46,712 ms; stable for 30 seconds. Independent `p5-content-review.json`, transcript and grounding reviews. |
| Native helper execution | PASS: seven rows bind exact new helper hashes and exercise FFmpeg version/configuration/PCM generation plus native recognizer missing-file and synthetic-tone contracts. No microphone, speech quality or app ASR routing claim. `native-helper-summary.json`. |

Original P3/P5 natural prompts and existing synthetic folder context were unchanged. Both final answers correlate to fresh sessions on `custom-moecloud/moe-demo-pro`; no Microsoft send or Forms submit occurred. New PDF guidance improved coverage but did not close P3. The managed image-capability repair now has installed content proof.

A separately labeled temporary local-provider policy experiment began at 03:27:54Z after the app was verified idle. It reduces generic tool schemas while retaining all MoE plugin tools. The installer/ASAR remains unchanged; this is diagnostic configuration, not accepted release behavior. Backup, exact restoration and ordinary-turn results must be recorded before any claim of a local fix.

## Prior installed baseline — build 34171848832

Status at the earlier checkpoint: **PARTIAL; GA remains RED.** `0.4.3-moe.22`, source `258d3ac079e7cbaa8a9c80c574066923f8ef988c`, GitHub run `34171848832`.

Installer SHA256: `ca36f71709919f5d8bfa4ea3e2b490e09a88c9104e47e8ab39a90939b2d4bc13`.
ASAR SHA256: `6137fd8d2c6bb8ff61b4dd9a48d6bafbd9607410d2d477e645ce30681ec7a733`.
EXE SHA256: `319ce13ac0ae399f38a1044344b15917d8401488f09494ab44e2296054d07ae5`.

Evidence root: `artifacts/windows-vm/20260908-moe22/installed-acceptance-34171848832/` (local, ignored). See [current candidate](../CURRENT_WINDOWS_RC.md), [completion plan](../COMPLETION_PLAN.md), and [blocker record](GA_BLOCKER_RESOLUTION_2026-09-08.md).

## Environment and access

Google Cloud reauthentication succeeded. The IAP probe passed RDP protocol, SSH banner and rejection of closed guest port 9999 at 01:38:58Z; an authenticated SSH marker also passed. VM: `clawx-win-rc-20260609`, project `gen-lang-client-0649986230`, zone `us-central1-a`. No VM shutdown.

Windows Server 2022 Datacenter, build 20348, 4 vCPU / 16 GB, reused administrator profile; actual interactive session 1 at 1920 × 1080. No sound device/microphone. This is not fresh Windows 10/11 standard-user or unaided tester acceptance.

## Installation and startup

- PASS: transferred 394,149,221-byte installer hash matched. Windows PowerShell preparation scripts parsed without errors.
- PASS: app quit gracefully; app/runtime stopped before backup. 806 AppData files and 999 OpenClaw files copied with matching counts. Prior application directory was moved intact, so no legacy helper could mask package omissions. Chrome/profile state retained.
- PASS: visible License→Install→Finish screens; Run unchecked before Finish. Installer exit 0 at 01:49:36.031Z. Installed EXE/ASAR and all eight helper/notice identities match; desktop and Start Menu shortcuts target the correct app. Keyless credential seed files absent as intended.
- PASS with latency finding: actual desktop shortcut launch in interactive session 1 with Limited token and diagnostic CDP argument at 01:50:04.705Z; first Gateway/composer ready at 01:53:30.678Z = 205,972 ms. Eleven stable samples over 20,166 ms. No restart or manual configuration fix.
- Capture proof: installed FFmpeg produced a 300.067-second, 1280 × 800 app-window video. Host verifier bound manifest/video hashes and ten nonblank frames. Independent visual review confirms visible Reconnecting→Online, retained historical chat, and current synthetic prompt still Thinking at final frame; some middle frames are blurry. Video does not prove the later completed chat reply.

Receipts: `environment.json`, `interactive-environment.json`, `backup-result.json`, `transfer-verification.json`, `install-result.json`, `installed-payload-verification.json`, `package-directory-preservation.json`, `cold-launch.json`, `cold-start.json`, `startup-verified/host-verification.json`, `startup-verified/startup-visual-review.json`.

## Ordinary chat and document checks

| Check | Result | Evidence and limits |
|---|---|---|
| Ordinary Online | PASS, latency unresolved | Fresh chat; intended `custom-moecloud/moe-demo-pro`; token once; zero tools/errors/degrade; all final idle flags false and 30 seconds quiet. Visible answer 99,184 ms; send→user transcript 79,870 ms; model final 5,703 ms later. `online-content-review.json`, `online-transcript-review.json`, `clwx-ordinary-online-20260908-015439/turn/`. |
| Stop→next message | PASS observable behavior | Stop while sending, next response in same chat, correct token once, stable terminal/no errors. `cancel-next-20260908T0158Z/cancel-and-next-summary.json`. Exact runtime abort ID and transport-fault/duplicate-write guarantees remain unproved. |
| P3 PDF title discovery/read | PASS | Original natural prompt plus existing synthetic folder context called `document.find` then `document.read_pdf` on hash-verified PDF. Complete 835-character reader payload contains all three deadlines. |
| P3 summary content | FAIL | Summary retained July 30 inventory deadline and ICT-1/ICT-2 fields but omitted August 4–15 district visits, August 29 consolidated report deadline, and district-office submission route. Producer ANSWERED / terminal PASS does not override content failure. `p3-transcript-review.json`, `p3-reader-shape.json`, `document-journeys-2026-09-08T02-00-34-757Z/`. |
| P5 image transport from reader | PASS at tool-result boundary | `document.find` and `document.read_image` returned the correct synthetic PNG and a native image block (73,964 base64 characters), with no tool error. Root visually reviewed the hash-matched fixture. Provider request image transport remains under investigation. |
| P5 image answer | FAIL | Answer invented student, school, class, dates, concerns and signature, and falsely reported every field filled. The fixture contains 11 fields, eight populated values and three blanks. `p5-content-review.json`, `p5-transcript-review.json`, `document-journeys-2026-09-08T02-04-25-483Z/`. |
| On-device ordinary chat | FAIL | Fresh chat timed out after 300 seconds with a degradation notice and no answer. The Gateway logged an embedded `ollama-ollamalo/qwen2.5:3b-instruct` assistant timeout at 02:13:07Z. No main-agent user transcript persisted by 02:18:51Z; this does not establish that no submission occurred. No tool-policy execution is proved. By 02:18:10Z the app was idle and ready. Original failure remains preserved; Online restored normally afterward. `ondevice-content-review.json`. |
| Native helpers | PASS, file execution only | Exact installed FFmpeg and speech helper hashes; FFmpeg version/build configuration and valid PCM16 mono 16 kHz WAV generation pass. Windows speech helper runs on that synthetic tone and returns valid JSON. No microphone, speech accuracy or app routing proof. |
| Office helpers | PASS | Five installed modules load. Word and Excel each produce valid OpenXML and pass content readback: four assertions, no failures. These are deterministic helper checks, not complete model journeys. |
| Microsoft readiness | PARTIAL / account blocked | Gateway, Host API and Chrome CDP pass; Outlook opens. The actual bounded inbox request returns `needs_signin`; no message was read. Both Forms configurations are available. No email sent or form submitted. `browser-20260908T0222Z/browser-readiness-summary.json`. |
| Normal second shortcut launch | PASS with latency finding | Same installed ASAR/profile after graceful quit, no forced process kill: first readiness 72,527 ms, stable for 20,109 ms. Fourteen process samples collected. Gateway consumed about 53 CPU seconds by first readiness. One warm sample; no latency-distribution claim. `warm-start-check/warm-content-review.json`. |

## Reviewed follow-up source

`1f2b405e` adds actionable-summary obligations to the actual model-facing PDF tool description; independent review and 41 existing tests pass. A disconnected persona-only proposal was rejected. `a4efc7e4` registers image input for the two managed cloud aliases across all provider/model sync paths, preserving generic-provider behavior and existing pricing. Independent review, 62 focused tests, typecheck, lint, harness validation and a real bundled image-transform negative/positive diagnostic pass.

The live cloud catalog had no input property in OpenClaw config and explicit text-only input in agent model metadata. The actual native PNG was resized but visually correct; the adapter omits images for a text-only model. The new build subsequently completed and was installed; its original P3/P5 retests are recorded above. P5 content passes and P3 remains incomplete.

## Open gates

P3 summary repair; P5 recovered generic-tool error; local-model timeout diagnosis and further latency measurements; Microsoft account-holder sign-in; representative client/microphone; supported keyless first-run provisioning; full offline/recovery/policy/reminder scope; unaided stakeholder acceptance and strict release gate. No moe.22 publication or new stakeholder message has been sent.

No credentials, private signed links, email bodies, recipient lists or raw image/audio payloads are included here. Private runtime logs remain local; no email was sent and no Forms response submitted.

## Local-model context diagnostic — 02:39 UTC

Baseline artifact remained unchanged and the app was idle Online during sequential direct Ollama diagnostics. Qwen produced first content in 9,218 ms from unloaded state (7,136 ms model loading), then 694 ms warm. A synthetic 32,283-character request using the same 8,192-token context and eight-token output limit produced no content before the 120,215 ms abort. This isolates a context-processing concern; direct API responses are not app acceptance.

Read-only metadata for the failed app session records 33,177 system characters, 33,102 schema characters and 47 tools, including 7,721 characters of skill descriptions. The selected managed OpenAI-compatible row advertises a 200,000-token context; native Ollama metadata reports 32,768. Official Ollama v0.32.14 source shows that `/v1/chat/completions` drops top-level `options.num_ctx`; therefore the incorrect 200,000 catalog value does not prove a 200,000-token allocation. It still misstates OpenClaw budgeting. Native `/api/chat` honors that option. No tool capability was removed and no installed code/configuration was changed for these diagnostics.

Evidence: `installed-acceptance-34171848832/ollama-latency-20260908T0232Z/ollama-latency-summary.json`, `prompt-size-report-20260908T0237Z.json`, and `ondevice-context-metadata-20260908T0240Z.json` under the existing private artifact root. Reports contain counts and model metadata, not message bodies or credentials.

Primary transport reference: [Ollama v0.32.14 OpenAI request conversion](https://github.com/ollama/ollama/blob/v0.32.14/openai/openai.go). The native context diagnostic and actual app payload use different API routes; no allocation claim is inferred from catalog metadata.
