# Current Windows RC

**September 8 execution resumed: GA RED.** The owner has started supervised Claude Fable 5/Bedrock worktrees for source repairs, CLI monitoring, history/skills review and a separate Whisper.cpp backlog branch. [COMPLETION_PLAN.md](COMPLETION_PLAN.md) owns execution and dependencies; [execution evidence](evidence/WINDOWS_PLAN_EXECUTION_2026-09-08.md) owns the scoped product proofs. ASR remains outside this release; helper/keyless integrity remains required. The latest packaged and installed artifact is moe.26 below; moe.25 retains the preceding completed startup/Online baseline.


**Local UI acceptance hold:** the owner reproduced the macOS Keychain dialog after the narrow fixture test passed. The resumed suite was stopped; desktop launches remain held. [CLWX-102](bugs/CLWX-102-macos-test-keychain.md) is unresolved; no local desktop test is running. This does not change the installed Windows artifact.
## Current source candidate — moe.27, reviewed retry building

Clean source `4c023f7ea3d16f4da0205308e93839ac08be26b9` on `release/moe27-lifecycle`, active checkout `/private/tmp/clawx-plan-execution-20260908`, version `0.4.3-moe.27`. Its tree exactly matches independently approved fixture correction `8bdbf91a`; the production lifecycle repair is unchanged. Native Windows before/after moves14 passed/two failed to16 passed/zero failed/zero skipped; independent PDF and guard falsifiers pass.

[Build 34272395270](https://github.com/dmvevents/clawx-pilot/actions/runs/34272395270) began20:01:49UTC, keyless-public with no publication inputs. Full native preflight and packaging are pending. No moe.27 installer hash, installation or release is claimed.

Previous attempt34270069669 at d343f23d failed before packaging:2,317 passed/two failed/57 skipped, missing helper/launcher setup in the isolated PDF-verifier fixture. That failed run and the installed moe26 regression remain preserved in [CLWX-135](bugs/CLWX-135-openclaw-package-lifecycle.md).

## Latest packaged and installed candidate — moe.26, startup FAIL

`release/moe26-plan-execution` at **`8bb7a77907faf35fb8fc4136073ce340ea9a9aaa`**, retained source reference, version `0.4.3-moe.26`. One copy-list entry repairs the isolated bundle test's missing registry child. Root's six tests/lint pass; independent Fable/Bedrock APPROVE reproduces six passes and checks adjacent copy lists. [Hosted build 34256868050](https://github.com/dmvevents/clawx-pilot/actions/runs/34256868050) started at **17:24:08 UTC**, `keyless-public`, no required credential seeds or publication inputs. Full Windows preflight PASS at17:29:19UTC, runtime preparation PASS at17:30:06UTC and compilation/bundling PASS at17:33:49UTC. Installer packaging completed successfully at17:41UTC. Native units:2,309 PASS/zero FAIL/57 SKIP in210 passed files/three skipped; nine artifact harness rows PASS. GitHub artifact10068872044 downloaded and matched its archive digest/length. All36 extracted package checks and172 compiled ASAR file comparisons pass; clean source/profile and OpenClaw9.2 are verified. Moe.26 assisted GUI completion and installed identity now pass; native install exit was not captured after observer termination. Installed startup FAIL: Gateway repeatedly exits1 with incomplete package lifecycle; chat stays disabled through360s. CLWX-135 repair is active; publication false.

Native SQLite lifetime proof remains bound to parent99468423: normal TEMP33/33 and short TEMP23/23 pass, plus exact cached-handle/targeted-close control. The attempted full VM unit run at8bb7a779 did not start because transfer authentication failed; that access failure is historical and fresh authenticated IAP SSH/RDP now pass. Hosted native validation supplies the completed full-run proof.

Preserved failures:34255425275 at99468423 (2,308 PASS/one FAIL/57 SKIP, missing child in isolated fixture);34252050616 at5785e570 (2,304/one/57, cleanup EPERM);34244582967 at1d745567 (2,297/two/57). Full Mac2,327-test evidence belongs to1d745567. [Source/build evidence](evidence/GA_SOURCE_INTEGRATION_2026-09-08.md) keeps these scopes separate. Held24e1cfd3 and private8db5bc5f remain excluded.

### Verified moe.26 package identity

| Field | Verified value |
|---|---|
| Manifest | [0.4.3-moe.26](release-manifests/0.4.3-moe.26.json) |
| Installer bytes / SHA256 | `476768641` / `5de74d6d1ce40b5c4c5d963f66bc74dd6c880c4972a6dbf82cd88c1ac5beb620` |
| ASAR SHA256 | `a81d7dd0cf030df2ab934068aaacf8d5d9edcb70d984c2a07dce72854b7c62bd` |
| Packaged EXE SHA256 | `44ff6a6f90fc5872b38626f544e7f19166185ecf2e5bb607f66dc3ddf386f902` |
| Scope | Host package/source proof PASS; normal assisted Windows completion screen and installed ASAR/EXE match; native exit UNKNOWN; startup FAIL; journeys BLOCKED_CLWX135 |
| Next | Repair CLWX-135, independently review and build a newly identified candidate; preserve failedmoe26 and observer exit gap |

## Preceding installed diagnostic — moe.25

| Field | Verified value |
|---|---|
| Source / hosted run | `8058e9b5b3050463c72a11c8e5da56616206f6e3` / [34203201042](https://github.com/dmvevents/clawx-pilot/actions/runs/34203201042) |
| Installer SHA256 | `f8ac20f96f4f4dbfab6498144a989dbf83d61dd98c16459682db8a86460db0b2` |
| Installed ASAR SHA256 | `ca7e5009a70de5c68f971465b7db34dff88afc6218e674481d11ce47e80ff6d3` |
| Installed EXE SHA256 | `5dde7d5e8921cc8a92f71332a48cfdb158d01f7779ade2f886483c8419772704` |
| Environment | GCP Windows Server 2022; standard-user assisted existing-profile upgrade |
| Package / startup | 36 host package checks; matching installed identity; ready 258.279s after shortcut, stable-ready verdict 280.083s |
| Installed Online | Existing Main, genuinely fresh conversation and next turn PASS; each has actual cloud correlation and a 30-second terminal observation |
| Limits | Current document/Microsoft, offline app, recovery/rehearsal, fresh Windows 10/11 and unaided stakeholder acceptance remain incomplete |
| Distribution | No new moe.25 download handoff or GA publication in this checkpoint |

[Exact baseline](evidence/WINDOWS_MOE25_PLANNING_BASELINE_2026-09-08.md) and [resumed installed tests](evidence/WINDOWS_PLAN_EXECUTION_2026-09-08.md) preserve the original failed driver receipt and its independently reviewed rerun. Direct native Ollama allocation/answer is diagnostic evidence only; it does not change the installed app’s offline verdict.

## Prior diagnostic candidates

Moe.24, source `b814f804036fc2f9f32d3326c8694f4ae2ef7805`, [run 34189597051](https://github.com/dmvevents/clawx-pilot/actions/runs/34189597051), was the preceding installed diagnostic candidate. The [installer manifest](release-manifests/0.4.3-moe.24.json), all 36 host package checks and installed EXE/ASAR hashes agree. The assisted standard-user upgrade exited 0 at 06:03:28Z. **Ordinary Online first-turn acceptance FAILS (`NO_RESPONSE`, 06:14:29Z).** Source fallback repair `7f4b06d3` is included; no fallback notice appeared in this test and the subsequent idle UI remained Online, but no successful answer or quiet terminal window was obtained. History repair `f5875b54` is reviewed source only and is not in this artifact. The privately staged installer passes a full signed GET/hash check; its URL expires at 17:00:41Z and has not been handed off.

Moe.23, source `2449a9483b7e4937a902e70914a382d05f8e2e58`, run `34187805266`, is an intermediate diagnostic build: all 17 host package checks pass, and its standard-user assisted upgrade completed at 05:30:47Z with exit 0 and matching EXE/ASAR hashes. Runtime testing is pending. It includes the earlier startup repair but excludes `7f4b06d3`. Moe.22 below is the last baseline with journey results; moe.23 now has installed identity proof, and moe.24 now has installed identity proof and a failed first-turn result.

## Prior installed baseline with journey results — moe.22 build 34180280985

| Field | Value |
|---|---|
| Version / source | `0.4.3-moe.22` / `a4efc7e4a4311d7865bf0c74ab2320289fdadd48`; clean keyless-public source |
| Manifest | [Generated artifact manifest](release-manifests/0.4.3-moe.22.json) |
| Installer | `Ministry of Education-0.4.3-moe.22-win-x64.exe`, 394,149,483 bytes |
| Installer SHA256 | `eed3d9ec87902d1babcf7906122009ac3a0ec708871db175de52871dc3e5938f` |
| ASAR SHA256 | `ccec2df6a9ed21fe1882cad0f71b29dd9ee60f358fb0d2786b3e85f1bbef1170` |
| App EXE SHA256 | `41ccabad0822cb5312b6bd0ebaa1c255671ba26f026824c44a44ade02bedec1a` |
| Build / package | 204 native files / 2,114 tests passed, 11 skipped. Source/profile/compiled receipts, five manifest entries, eight helpers, keyless scans and blockmap checks pass. Host and VM installer hashes agree. |
| Installed acceptance | PARTIAL: visible install exit 0 at 03:08:57Z; EXE/ASAR/eight helpers and both shortcuts match. Cold readiness 105,745 ms; P5 content PASS with one recovered tool error; P3 deadline coverage FAIL. |
| Publication | `published:false`; private GCS diagnostic copy downloaded and hash-verified at 03:28:39Z; no new stakeholder installer handoff or GA release |

## Prior installed baseline — moe.22 build 34171848832

| Field | Value |
|---|---|
| Version | `0.4.3-moe.22` |
| Manifest | [Prior build manifest](release-manifests/0.4.3-moe.22-build34171848832.json) |
| Publication | `published:false`; GitHub Actions artifact; no GA tag, GCS handoff or stakeholder completion notice for this candidate |
| Installer | `Ministry of Education-0.4.3-moe.22-win-x64.exe`, 394,149,221 bytes |
| Installer SHA256 | `ca36f71709919f5d8bfa4ea3e2b490e09a88c9104e47e8ab39a90939b2d4bc13` |
| App ASAR SHA256 | `6137fd8d2c6bb8ff61b4dd9a48d6bafbd9607410d2d477e645ce30681ec7a733` |
| Packaged EXE SHA256 | `319ce13ac0ae399f38a1044344b15917d8401488f09494ab44e2296054d07ae5` |
| Source | `258d3ac079e7cbaa8a9c80c574066923f8ef988c`; branch `release/moe22-package-complete`; keyless-public; clean source |
| Build proof | [Run 34171848832](https://github.com/dmvevents/clawx-pilot/actions/runs/34171848832) PASS; 204 native files / 2,106 tests passed, 11 skipped; zero failures |
| Package proof | All five manifest entries match extracted payload. All eight helper/notice files, pinned FFmpeg and runtime Playwright are present. No blocked seed or smoke files in loose payload or ASAR. Root independently rehashed the installer. |
| Blockmap | Structural PASS: 385,778 bytes, SHA256 `d30e51bde19e160aa1360ac91ecf84bd5604abd7321391f8939ecaae93433791`, 19,031 chunks covering the installer; differential update NOT_RUN |
| Installed proof | **PARTIAL**: visible install exit 0; exact EXE/ASAR/eight helpers and both shortcuts pass. Desktop shortcut startup, Online and observable cancel-next pass with slow first launch/first turn. P3 discovery/reader pass; summary content fails. See [September 8 VM evidence](evidence/WINDOWS_VM_TESTING_2026-09-08.md). |
| Evidence | Local redacted reports: `artifacts/windows-vm/20260908-moe22/hosted-package-34171848832/`; complete blocker map: [September 8 record](evidence/GA_BLOCKER_RESOLUTION_2026-09-08.md) |
| Readiness | **RED** pending exact-candidate installed journeys, supported first-run provisioning, Microsoft sign-in, representative Windows client (ASR deferred) and external acceptance, and strict release gate |

## Previous installed baseline — moe.21 (September 7)

| Field | Value |
|---|---|
| Version | `0.4.3-moe.21` |
| Manifest | Retained in the verified run9 build-provenance artifact as `docs/release-manifests/0.4.3-moe.21.json`; this is the previous candidate |
| Publication | `published:false`; GitHub Actions artifact only, not a release asset |
| Installer | `Ministry of Education-0.4.3-moe.21-win-x64.exe`, 359,123,558 bytes |
| Installer SHA256 | `d0da3062156e2faaac1df5967f03710736693f8fc7571adfccf254865579b00f` |
| App ASAR SHA256 | `8905aef127a3f1e443069b484a54481e76caa8a152902b85da3d778079f2cc94` |
| Packaged EXE SHA256 | `b60a4000d657085d4940f0f97ccc05132b04061b88891e2d4b6c34842a0c3bbe` |
| Source | Clean public source `34e951dc9d986ce82ef44396d440e9a02bc35242`; keyless-public profile; `gitDirty:false` |
| Build proof | Native run [34134725489](https://github.com/dmvevents/clawx-pilot/actions/runs/34134725489) succeeded in 13m14s; preflight passed 203 files / 2,053 tests with 11 skips; source/profile/compiled receipts, release manifest, x64 installer, extracted ASAR and packaged EXE verified by private artifact report |
| Installed proof | **FAIL / not accepted**. First assisted upgrade completed 2026-09-07T15:14:29Z with exit 0 and hash-matched EXE/ASAR, but a legacy `ffmpeg.exe` in the old application directory masked a package gap. Second clean application-directory install completed 2026-09-07T16:04:02Z with exit 0, EXE/ASAR still matched, existing profile was retained, cloud/Azure credential seed rows were absent and cold readiness reached 86,838ms with 20,176ms quiet / 11 stable samples; required `resources/bin/ffmpeg.exe` was absent and video/recording was blocked. Second clean install Office imports and Word/Excel write-readback passed, and controlled forms.list passed but is not Forms preview evidence. Fresh ordinary Online v2 chat and observable cancel-next passed before later overlapping attempts. On-device remains a current installed failure: a fresh uncontaminated rerun with local model `qwen2.5:3b-instruct` present produced `NO_RESPONSE`, `degradeNoticeTrue` and no terminal answer. Document evidence is scoped, not accepted: D0/P1/P2/P4 passed, P2/P4 parser readback passed with unchanged source hashes, P3 PDF title prompt failed with no tool call, and P5 image prompt failed content review after the correct PNG reader returned truncated JSON text rather than a native image block. Natural reminder evidence now proves the second owned one-shot fired, persisted in in-app history, cleaned up the exact job and was visible when opened by exact job ID at 2026-09-07T16:48:05Z; it does not prove desktop notification, manual run or ordinary chat creation. These scoped positives do not promote moe.21. |
| Blockmap | Downloaded and structurally validated: 347,786 bytes, SHA256 `44ac9fa6deebf3b600cc86252a2d45bd3fdd50210c0de9673d0dd5dc7db75111`, 17,319 chunks, covers installer; no differential update execution |
| Mac | No current Mac candidate established; stale moe.10 trees excluded |
| Readiness | **RED for GA/unrestricted pilot**. This moe.21 baseline fails package completeness, on-device and P3/P5 document acceptance. Reviewed moe.22 source repairs and the selected build are listed below. Exact-candidate installed retests, signed-in Microsoft journeys, full fault/cancellation recovery, offline proof, representative Windows client evidence (microphone/ASR now deferred) and external acceptance remain open. |

The historical moe.20 and moe.19 installer/app/manifest records were preserved locally. Their [failed Online observation](evidence/WINDOWS_VM_TESTING_2026-09-07.md) remains baseline evidence; it does not describe the new candidate. Match exact hashes, not version labels. Source context records build inputs and does not establish a reproducible build.

The fourth native moe.21 [build attempt](https://github.com/dmvevents/clawx-pilot/actions/runs/34123550898), source `8d477e9ea27eafeb8bf78ceee49c532858209762`, passed all 201 native test files (2,011 tests, 11 platform skips), preflight, compilation and native bundle verification. Seven artifact-runtime rows passed. The remaining `gateway-transport.no-hostapi` row timed out at 120 seconds in the overbroad all-plugin CLI diagnostics path. No moe.21 installer was created. The scoped real-loader correction now passes both focused Windows diagnostics under the unchanged 120-second limit. Current lifecycle/retry source passes 117 focused tests, six Electron interactions and independent review. A complete package and installed-candidate acceptance are still required; see the [completion state vector](completion-state.json).

The fifth [native attempt](https://github.com/dmvevents/clawx-pilot/actions/runs/34130171081) passed 2,048 tests with 11 skips and failed two new Windows fixture assumptions before packaging. Both files then passed all 75 focused checks on the Server VM with a forced short TEMP alias and exact hash readback. The sixth [native attempt](https://github.com/dmvevents/clawx-pilot/actions/runs/34131398263), source `afd7a94d246639563880a3f7fc3cc13167606401`, passed 203 files / 2,050 tests with 11 skips, plus compile, bundle verification and seven artifact rows. It then failed before installer creation because a real transport row completed in 2,821ms but the assertion compared an 8.3 short TEMP staged path with the native long path. The source now canonicalizes the stage before deriving roots while keeping source equality strict. Private Windows proof records 77 focused tests with short TEMP, five file-hash matches, and two pinned OpenClaw 2026.4.23 rows passing in 83s and 5s under the unchanged 120s limit. The seventh [native attempt](https://github.com/dmvevents/clawx-pilot/actions/runs/34133768880) failed at checkout in 14 seconds because the dispatch used abbreviated ref `18bd7d7a`; it ran no source/build test. The eighth [native attempt](https://github.com/dmvevents/clawx-pilot/actions/runs/34133858590) failed source preflight after 202 files / 2,049 tests passed, 3 diagnostics-routes tests failed, 11 skipped and all 72 artifact tests passed; the failures were test-only unmocked external Chrome/OS probes. The ninth [native attempt](https://github.com/dmvevents/clawx-pilot/actions/runs/34134725489) succeeded packaging from full clean source `34e951dc9d986ce82ef44396d440e9a02bc35242` in 13m14s. Preflight passed 203 files / 2,053 tests with 11 skips; keyless-public staged seed scan passed; GitHub uploaded x64 installer, blockmap and build-provenance artifacts. Private artifact verification passed for the x64 installer, source/profile/compiled receipts, release manifest, extracted ASAR and packaged EXE. Direct VM artifact download verified the GitHub archive digest and matching installer hash in about 32 seconds. Blockmap structural validation passed: 347,786 bytes, SHA256 `44ac9fa6deebf3b600cc86252a2d45bd3fdd50210c0de9673d0dd5dc7db75111`, 17,319 chunks, covers the installer; no differential update execution was run. Installed package acceptance then failed: the artifact and second clean application-directory install do not include required `resources/bin/ffmpeg.exe`, so video/recording is blocked. The first assisted upgrade was masked by a legacy helper in the old application directory. Fresh ordinary Online v2 and observable cancel-next passed before later overlapping attempts; overlapping document/on-device attempts are excluded. Later document and reminder probes refined the scope: P2/P4 output parseback and retained-history reminder visibility passed, P3 and P5 content acceptance failed. Product code and strict artifact checks remain unchanged by the fixture/diagnostic repairs. This is not GA acceptance: moe.21 is not accepted for pilot release; its authorized owner diagnostic handoff is recorded separately. That checkpoint began the moe.22 repair. The selected September 8 artifact above supersedes its package/source status; installed acceptance still requires retesting.

## Installed moe.22 baseline source and build

Baseline source `a4efc7e4a4311d7865bf0c74ab2320289fdadd48` / [run 34180280985](https://github.com/dmvevents/clawx-pilot/actions/runs/34180280985) builds and packages successfully. It adds PDF obligation-preserving guidance (`1f2b405e`) and managed vision metadata (`a4efc7e4`) to the previous `258d3ac0` baseline. Exact installed identity, payload, native helper execution and cold startup pass. Independent content review confirms P5 fixed and P3 still missing the final Head Office deadline.

The superseded `fd678bd6` run `34170721777` succeeded, including pinned Windows helper preparation. It cannot prove the three newer product fixes. Run `34171404814` at `f1d88039` failed preflight after 203 files / 2,105 tests passed, one fixture test failed and 11 tests skipped. The synthetic-home path alias prevented that test from reaching its budget assertions; the one-line test-only correction is reviewed with 30 local document tests passing. The first `94b38aa8` run `34146007001` also failed before an installer; its separately reproduced FFmpeg fixture defect is repaired.

See the [September 8 blocker record](evidence/GA_BLOCKER_RESOLUTION_2026-09-08.md) for before/after regressions, independent reviews and current Plane cards. The moe.22 baseline has installed payload proof; its stable fresh-user Online turn failed. Runtime/content acceptance is partial; see [September 8 VM evidence](evidence/WINDOWS_VM_TESTING_2026-09-08.md). Authenticated Microsoft and representative Windows client journeys remain open; microphone/ASR is deferred.

The following June record is retained for history; it is not the current candidate.

Historical June snapshot, retained for artifact traceability.

## June 23 candidate (historical)

| Field | Value |
|---|---|
| Branch | `release/moe10-windows-laptop-ready-20260529` |
| Installer source commit | `b38b6208218b2d84d5cade55890fda0f8c5489e9` |
| GitHub prerelease tag | `moe10-windows-rc-20260623-outlook-green-b38b620` |
| Installer | `Ministry.of.Education-0.4.3-moe.10-win-x64.exe` |
| Installer SHA256 | `a19a9c62eaacd958df772b432277dd220a38e61e5f0e69b449ee6b66ef00c6ee` |
| Blockmap SHA256 | `cadd21e35608817dcc099239141a65ee640b6582e2b154bac40340d7befff6a6` |
| App ASAR SHA256 | Not extracted from GitHub Actions NSIS artifact |
| GCS staging prefix | Not staged |
| Release page | `https://github.com/dmvevents/clawx-pilot/releases/tag/moe10-windows-rc-20260623-outlook-green-b38b620` |
| Evidence manifest | `docs/GA_RELEASE_EVIDENCE_MANIFEST.md` |
| GA plan | `docs/GA_RELEASE_PLAN_2026-06-09.md` |
| June 23 verdict | `YELLOW - Outlook Green prerelease is published from GitHub Actions; source, full unit suite, local Electron/Chrome email send matrix, and package workflow are green, but clean installed Windows proof is still pending` |

## Staleness Warning

The installer snapshot above was built by GitHub Actions run `28034003516` on 2026-06-23 after the Outlook compose/reply/reply-all/forward/send hardening pass. It includes the earlier inbox/date/sign-in hardening, archive-adjacent Reply guard, bounded Inbox search contract, recipient-field validation, body-editor readiness checks, post-send Drafts residue verification, and ClawX-marker-scoped cleanup proof. Full `pnpm test`, typecheck, lint, harness CI, package-owner runtime tests, local signed-in Electron/Chrome CDP email probes, and the GitHub package workflow passed. VM installed-app proof remains pending for this exact asset. Hidden WinRM silent install is a diagnostic-only path and must not be used as GA proof.

## Post-Asset Source Evidence

Before rebuilding the candidate above, a local signed-in Outlook CDP probe was run against the user's Chrome tab at `https://outlook.cloud.microsoft/mail/`. The source browser-manager path returned `open=opened`, `readInbox(5)=ok`, and a widened 12-row Inbox window where the June filter returned 10 rows, the May filter returned 2 rows, and the Raj sender filter returned 2 rows, all with `scan.exhaustive=false`.

The June 23 Electron/Chrome send matrix was run through the app Host API against signed-in Outlook and passed compose, reply, reply-all, and forward. The probe observed `/api/outlook/read-inbox`, two `/api/outlook/reply` calls, `/api/outlook/forward`, `/api/outlook/draft`, and four `/api/outlook/send` calls; every draft body was in the compose body, not the recipient fields; each controlled marker appeared in Sent Items; no matching marker remained in Drafts; and no matching compose remained open. Evidence path: `/tmp/clawx-email-send-matrix-20260623102302/clawx-electron-probe-2026-06-23T14-26-13-166Z.json`.

This June 23 work was packaged in the historical `outlook-green` installer above. Installed-app VM proof was still required at that checkpoint. The June blocker was the unsupported hidden WinRM silent installer path; the September status and observed Gateway/chat failure are documented at the top of this file.

## Historical release checklist

- `docs/GA_RELEASE_EVIDENCE_MANIFEST.md` has fresh `GREEN` or accepted `YELLOW` rows for every release-critical gate.
- A clean Windows VM or laptop install launches from the desktop shortcut and proves Gateway, Host API, Electron CDP, packaged runtime artifacts, online model path, and signed-in Microsoft tenant context.
- Outlook read/draft/reviewed-send safety and Forms preview/no-submit safety are proven through the installed app path with signed-in Microsoft context.
- Excel/Word/PDF and any demo PowerPoint workflow have installed-app chat evidence, not only source/package generated-file evidence.
- ASR has either an installed smoke with high-quality Azure Speech seed or a documented best-effort deferral.
- Final secret grep and package probe do not expose key contents, key hashes, provider credentials, Host tokens, private Forms URLs, email bodies, or full recipient lists.

## Release Notes Pointers

- June 10 GA status snapshot: `windows-pilot/plans/MOE_WINDOWS_GA_STATUS_2026-06-10.md`
- Last public prerelease notes: `windows-pilot/plans/MOE_WINDOWS_RC_2026-06-10_RELEASE_NOTES.md`
- June 10 user instructions: `windows-pilot/plans/MOE_WINDOWS_RC_2026-06-10_USER_INSTRUCTIONS.md`
- June 23 prerelease notes: `windows-pilot/plans/MOE_WINDOWS_RC_2026-06-23_EMAIL_FIX_RELEASE_NOTES.md`
- June 23 user instructions: `windows-pilot/plans/MOE_WINDOWS_RC_2026-06-23_EMAIL_FIX_USER_INSTRUCTIONS.md`
- New regression process: `.agents/skills/ga-e2e-regression/SKILL.md`
