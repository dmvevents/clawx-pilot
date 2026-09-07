# Current Windows RC

Reconciled: 2026-09-07. Current readiness and finish order: [COMPLETION_PLAN.md](COMPLETION_PLAN.md).

## Latest recorded candidate

| Field | Value |
|---|---|
| Version | `0.4.3-moe.21` |
| Manifest | Run9 build-provenance artifact contains `docs/release-manifests/0.4.3-moe.21.json`; checked-in manifest update is pending |
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
| Readiness | **RED for GA/unrestricted pilot**; moe.21 cannot be accepted or sent to testers because the fresh package is missing required `ffmpeg.exe`. Public candidate source `aeb54555bb7b242930463f5277b83cf69fb23ec6` on `release/moe22-package-complete` repairs helper packaging and current-turn graph-reader capture; package review approved the source repair, 180 focused package tests/typecheck/lint passed, 29 graph-reader tests passed, and an isolated native FFmpeg downloader/functional diagnostic passed in 16 seconds. This is not a released candidate: no moe.22 hosted build, installer hash or installed evidence exists yet, and document title discovery plus image grounding repair remain in progress. Microsoft account-holder sign-in, five journeys, full cancellation/fault recovery, on-device/offline, warm latency, representative client/microphone lane and release gate remain incomplete. |

The historical moe.20 and moe.19 installer/app/manifest records were preserved locally. Their [failed Online observation](evidence/WINDOWS_VM_TESTING_2026-09-07.md) remains baseline evidence; it does not describe the new candidate. Match exact hashes, not version labels. Source context records build inputs and does not establish a reproducible build.

The fourth native moe.21 [build attempt](https://github.com/dmvevents/clawx-pilot/actions/runs/34123550898), source `8d477e9ea27eafeb8bf78ceee49c532858209762`, passed all 201 native test files (2,011 tests, 11 platform skips), preflight, compilation and native bundle verification. Seven artifact-runtime rows passed. The remaining `gateway-transport.no-hostapi` row timed out at 120 seconds in the overbroad all-plugin CLI diagnostics path. No moe.21 installer was created. The scoped real-loader correction now passes both focused Windows diagnostics under the unchanged 120-second limit. Current lifecycle/retry source passes 117 focused tests, six Electron interactions and independent review. A complete package and installed-candidate acceptance are still required; see the [completion state vector](completion-state.json).

The fifth [native attempt](https://github.com/dmvevents/clawx-pilot/actions/runs/34130171081) passed 2,048 tests with 11 skips and failed two new Windows fixture assumptions before packaging. Both files then passed all 75 focused checks on the Server VM with a forced short TEMP alias and exact hash readback. The sixth [native attempt](https://github.com/dmvevents/clawx-pilot/actions/runs/34131398263), source `afd7a94d246639563880a3f7fc3cc13167606401`, passed 203 files / 2,050 tests with 11 skips, plus compile, bundle verification and seven artifact rows. It then failed before installer creation because a real transport row completed in 2,821ms but the assertion compared an 8.3 short TEMP staged path with the native long path. The source now canonicalizes the stage before deriving roots while keeping source equality strict. Private Windows proof records 77 focused tests with short TEMP, five file-hash matches, and two pinned OpenClaw 2026.4.23 rows passing in 83s and 5s under the unchanged 120s limit. The seventh [native attempt](https://github.com/dmvevents/clawx-pilot/actions/runs/34133768880) failed at checkout in 14 seconds because the dispatch used abbreviated ref `18bd7d7a`; it ran no source/build test. The eighth [native attempt](https://github.com/dmvevents/clawx-pilot/actions/runs/34133858590) failed source preflight after 202 files / 2,049 tests passed, 3 diagnostics-routes tests failed, 11 skipped and all 72 artifact tests passed; the failures were test-only unmocked external Chrome/OS probes. The ninth [native attempt](https://github.com/dmvevents/clawx-pilot/actions/runs/34134725489) succeeded packaging from full clean source `34e951dc9d986ce82ef44396d440e9a02bc35242` in 13m14s. Preflight passed 203 files / 2,053 tests with 11 skips; keyless-public staged seed scan passed; GitHub uploaded x64 installer, blockmap and build-provenance artifacts. Private artifact verification passed for the x64 installer, source/profile/compiled receipts, release manifest, extracted ASAR and packaged EXE. Direct VM artifact download verified the GitHub archive digest and matching installer hash in about 32 seconds. Blockmap structural validation passed: 347,786 bytes, SHA256 `44ac9fa6deebf3b600cc86252a2d45bd3fdd50210c0de9673d0dd5dc7db75111`, 17,319 chunks, covers the installer; no differential update execution was run. Installed package acceptance then failed: the artifact and second clean application-directory install do not include required `resources/bin/ffmpeg.exe`, so video/recording is blocked. The first assisted upgrade was masked by a legacy helper in the old application directory. Fresh ordinary Online v2 and observable cancel-next passed before later overlapping attempts; overlapping document/on-device attempts are excluded. Later document and reminder probes refined the scope: P2/P4 output parseback and retained-history reminder visibility passed, P3 and P5 content acceptance failed. Product code and strict artifact checks remain unchanged by the fixture/diagnostic repairs. This is not GA acceptance: moe.21 cannot be accepted or sent to testers. Public source `aeb54555bb7b242930463f5277b83cf69fb23ec6` starts the moe.22 repair, but there is no moe.22 build/hash yet.

## Next candidate source, not yet built

`release/moe22-package-complete` at `aeb54555bb7b242930463f5277b83cf69fb23ec6` contains two public commits after the moe.21 source: `93c00bb4` makes runtime-helper packaging require bundled FFmpeg, and `aeb54555` hardens current-turn graph-reader capture. The repair passed package review, 180 focused package tests/typecheck/lint and 29 graph-reader tests. On the Windows VM, the isolated FFmpeg downloader/functional diagnostic passed from 2026-09-07T16:33:48Z to 16:34:04Z with downloader SHA256 `11b9f0acaf1a3426df92705bd95dddca3ef225ec081662368089a2ca4726f8a9` and exactly four output files: `ffmpeg.exe`, `FFMPEG_LICENSE.txt`, `FFMPEG_PROVENANCE.json` and `THIRD_PARTY_FFMPEG.txt`. This proves the helper preparation path in isolation; it does not prove a packaged installer or installed app.

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
