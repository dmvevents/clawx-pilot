# GA Release Evidence Manifest

Last updated: 2026-06-23.

## Purpose

This is the handoff packet for Codex, Claude Code, Windows VM/laptop operators, and release reviewers. Update this file whenever a release gate gets fresh evidence. Do not call a build GA unless every release-critical row is `GREEN` or has an explicitly accepted `YELLOW` deferral.

Use `docs/GA_VM_BROWSER_VISUAL_ACCEPTANCE_CRITERIA.md` for human or VLM review of installed Electron, VM, Outlook, and Forms screenshots before recording browser visual evidence here.

## Candidate Snapshot

| Field | Value |
|---|---|
| Branch | `release/moe10-windows-laptop-ready-20260529` |
| Installer source commit | GitHub release tag target commit |
| GitHub prerelease tag | `moe10-windows-rc-20260623-email-draft-fix` |
| Installer path | `release/Ministry of Education-0.4.3-moe.10-win-x64.exe` |
| Installer SHA256 | `e35ee6cda63a942a585b0638831487562d66a0901b006cf2ccadfe81b0e6f182` |
| Blockmap SHA256 | `9ac78ae72aa6fd671ac044351f8b796dbc3d263d78f7bde5a39d4946c858f2b2` |
| App ASAR SHA256 | `9f8c9b0c90d4ff8a3a3a0a59e244504531247d8425a19f30d109d4250a8e3f96` |
| `ffmpeg.exe` SHA256 | `228d7a8556258de907fdb55f36850078ebc7680b84ec30d84ea02e99bec1d1eb` |
| `WinSpeechRecognize.exe` SHA256 | `6ae4190736ae88c13e7e8da8f13ff047756a8cb27de3797c416af15e5ee67447` |
| Status note | Rebuilt locally on 2026-06-23 after Outlook reply/reply-all/forward field-targeting and ClawX-marker-scoped draft cleanup. Local package inspection, full unit suite, typecheck, lint, harness CI, package-owner runtime checks, and local signed-in Electron/Chrome CDP email probes passed. The exact asset still needs installed-app Windows proof before GA. |

## Gate Table

| Gate | Status | Command / evidence | Artifact path | Verifier | Redaction notes | Blocker / accepted risk |
|---|---|---|---|---|---|---|
| Local unit regression matrix | GREEN | `pnpm test` passed: 148 files, 1115 passed, 5 skipped | terminal output | Codex | No secrets printed | MaxListeners warnings observed; no failures |
| TypeScript | GREEN | `pnpm run typecheck` passed | terminal output | Codex | No secrets printed | None |
| Lint | GREEN | `pnpm run lint:check` exited 0 with known 39 warnings | terminal output | Codex | No secrets printed | Existing warnings remain in forms scripts/snapshot/gateway seed tests |
| Outlook reviewed-draft send | GREEN for unit/source | `tests/unit/outlook-actions-safety.test.ts`, `tests/unit/moe-principal-assistant-plugin.test.ts`; focused Outlook/plugin/probe suite passed 139 tests; Electron/Chrome reply matrix observed no send call | repo tests; `/tmp/clawx-email-live-20260623-fresh-main/clawx-electron-probe-2026-06-23T08-07-01-396Z.json` | Codex + test-engineer sidecar | No email sent | Installed signed-in Outlook proof still required for GA |
| Outlook inbox folder/windowing | GREEN for unit/source | `tests/unit/outlook-inbox-windowing.test.ts`; Inbox/Sent/Drafts/Archive/Search state transitions covered | repo tests | Codex + test-engineer sidecar | No email bodies printed | Browser scan is still a bounded recent Inbox window; Graph/server-side search remains the exhaustive path |
| Local signed-in Outlook CDP manager smoke | GREEN for local source/package | Local Chrome at `outlook.cloud.microsoft` on CDP `18792`: source manager returned `open=opened`, `readInbox(5)=ok`; read-only probe returned `readInbox(50)=12`, June filter `10`, May filter `2`, Raj filter `2`, all with `scan.exhaustive=false`; Electron Host API no-send matrix passed compose/reply/replyAll/forward and ended with `openCompose=0`; packaged into installer SHA256 `e35ee6...` | terminal output; `/tmp/clawx-email-live-20260623-fresh-main/clawx-electron-probe-2026-06-23T08-07-01-396Z.json` | Codex | No email bodies, recipients, passwords, tokens, sends, downloads, or Forms submits | Installed-app VM proof is still required |
| Reply/forward archive prevention | GREEN for unit/source | `tests/unit/outlook-actions-safety.test.ts` covers shortcut-first Reply, Archive/Delete exclusion, icon-only Reply, and menu fallback | repo tests | Codex + test-engineer sidecar | No email sent | Installed signed-in Outlook proof still required for GA |
| Reply body field targeting | GREEN for unit/package | `tests/unit/outlook-actions-safety.test.ts` verifies labelled body fill, rejects recipient-field body text including short replies, refuses VLM fallback before typing when focus lands in `To:`, and rejects a reply draft if the post-compose probe finds requested body text in recipients; Electron/Chrome matrix confirmed body text landed in compose body and not recipients for reply, reply-all, forward, and compose | repo tests; `/tmp/clawx-email-live-20260623-fresh-main/clawx-electron-probe-2026-06-23T08-07-01-396Z.json` | Codex | No email body printed | Installed signed-in Outlook proof still required for GA |
| Chrome/CDP user guidance | GREEN for model-facing guidance | `tests/unit/moe-principal-assistant-plugin.test.ts` forbids manual Chrome debugging guidance | repo tests | Codex | No private browser data printed | Fresh user attached-profile UX still needs installed proof |
| Forms partial-fill safety | GREEN for existing unit/probe checks | `tests/unit/forms-browser-submit-gate.test.ts`, `tests/unit/windows-pilot-electron-cdp-probe.test.ts` | repo tests | Codex + test-engineer sidecar | No private Forms URLs printed | Signed-in Forms preview on Windows still required |
| Office CSV/Excel/Word/PPT matrix | GREEN for source/package, YELLOW for installed chat | Package/runtime checks now validate seeded CSV rows, generated Excel data rows, Word OpenXML, PowerPoint OpenXML slides, and Office analysis summaries | `tests/unit/windows-package-inspection.test.ts`, `windows-pilot/scripts/pilot-seed-demo-documents.ps1`, `windows-pilot/scripts/pilot-office-runtime-check.ps1`, `scripts/demo-office-analysis-e2e.mjs` | Codex + test-engineer sidecar | No document contents printed | Installed app chat proof for the full Office matrix still required before GA |
| ASR ffmpeg/provider/package drift | GREEN for unit/source | ASR focused tests cover packaged ffmpeg resolver, Azure seed, native fallback, and actionable no-Whisper error | repo tests | Codex + test-engineer sidecar | Config/key values not printed | Installed ASR smoke still required; cloud ASR seed required for high-quality GA |
| Windows package artifacts | GREEN for local rebuilt package | `PATH="$HOME/.dotnet:$PATH" pnpm run build:win` passed; local artifact probe confirmed `playwright-core`, Office parser packages, packaged Gateway seed under `resources/resources/cloud-gateway.*`, `ffmpeg.exe`, `WinSpeechRecognize.exe`, `node.exe`, `uv.exe`, MoE and Microsoft Graph extensions, and no `app-update.yml`; package probe tests passed 53 tests; installer SHA256 `e35ee6...` | `release/win-unpacked`, pending GitHub prerelease `moe10-windows-rc-20260623-email-draft-fix` | Codex | `.key` file contents and hashes not printed | Clean VM installed-app email proof remains required; hidden WinRM install is diagnostic-only |
| Clean Windows install / VM smoke | YELLOW pending | Current `e35ee6...` installer has local package and Electron/Chrome email proof but has not yet been proven through a clean installed Windows desktop shortcut path. Earlier hidden WinRM `/S` attempts against older June 23 assets were stopped after failing to produce a usable app tree; that path is diagnostic-only. | VM `clawx-win-rc-20260609`; pending assisted install proof | Codex | Test credentials handled through environment variables only; no passwords printed; no email sent; no attachment downloaded; no Forms submitted | Use normal assisted desktop/RDP install for release proof, or fix the NSIS silent path before claiming unattended install support. Do not call GA from hidden install alone |
| Hidden WinRM silent install automation | RED for automation, not the supported user install path | The exact `2e189dd...` installer reproduced the hidden `/S /currentuser` failure under `codexvmtest`: after several minutes, `Ministry of Education.exe` was absent, `playwright-core`, bundled `ffmpeg.exe`, and `WinSpeechRecognize.exe` were absent, and the partial tree had 116595 files / 1012260898 bytes. Earlier fresh temp-user VM runs showed the same class of failure. | Current evidence root `C:\Users\Public\Downloads\clawx-silent-install-20260623-045251`; prior evidence roots `C:\Users\codexvmtest\Downloads\clawx-vm-visual-criteria-20260623\clawx-silent-install-20260623-024708` and `C:\Users\codexvmtest\Downloads\clawx-vm-visual-criteria-20260623-long-install\clawx-silent-install-20260623-030642` | Codex + windows_release_packager/test-engineer sidecars | No passwords, keys, email bodies, private URLs, or token values printed | Do not use hidden WinRM `/S /currentuser` as release proof. Use assisted desktop/RDP install for visual proof or fix the NSIS silent path before claiming unattended install support |
| Online model/Gateway path | GREEN for installed gateway readiness | Initial direct gateway probe timed out with 25s wait; rerun with 180s wait completed, gateway ready in 12.0s, model `custom-moecloud/moe-demo-pro`; installed Electron probe also showed `GATEWAY_PORT_READY=True` | `C:\Users\Public\Downloads\clawx-installed-gateway-smoke-20260623-012219` and `C:\Users\Public\Downloads\clawx-cdp-smoke-20260623-011835` | Codex | Gateway key not printed | Live chat transcript through signed-in tester profile still required before GA |
| Secrets audit | YELLOW | `.gitignore` covers Azure seed/key; package probe reports secret metadata only | repo diff | Codex | No secrets printed | Run final `git grep` before commit/publish |
| Process/agent repeatability | GREEN for source | `ga-e2e-regression` skill mirrored across `.agents`, `.codex`, `.claude`; verifier agents added | repo files | Codex + Release Lead sidecar | No secrets printed | Run process contract test |

## 2026-06-23 Windows VM Smoke Notes

- Fresh local package smoke is suitable for prerelease publication; the candidate has been refreshed to the `e35ee6...` installer and still needs GitHub upload plus installed Windows proof.
- Electron/Chrome Host API matrix evidence for the current source passed compose, reply, reply-all, and forward without sending. Cleanup is marker-scoped to ClawX validation drafts and left `openCompose=0`; the visible Drafts count stayed at `[8]`, so the validation run did not add open compose drafts.
- Local Outlook CDP evidence is now included in the listed asset: with the user's local Chrome already open at `https://outlook.cloud.microsoft/mail/`, the v2 browser manager opened the signed-in mailbox and read the Inbox successfully. The widened date-search probe split the 12-row bounded recent Inbox window into 10 June rows and 2 May rows, which directly validates the no-year Outlook date parser fix for the "missing older June emails" regression.
- GA remains `YELLOW`, not `GREEN`, because the refreshed local installer still needs a signed-in Microsoft tenant profile installed-app email smoke.
- Current local asset: `release/Ministry of Education-0.4.3-moe.10-win-x64.exe`, size `390068457`, SHA256 `e35ee6cda63a942a585b0638831487562d66a0901b006cf2ccadfe81b0e6f182`; blockmap SHA256 `9ac78ae72aa6fd671ac044351f8b796dbc3d263d78f7bde5a39d4946c858f2b2`.
- Hidden WinRM `/S` install against older June 23 assets was stopped after it failed to create `Ministry of Education.exe` or `playwright-core`; keep this path diagnostic-only until a future explicit silent-install proof passes.
- Previous VM smoke evidence belongs to the superseded GitHub installer asset: `C:\Users\codexvmtest\Downloads\clawx-e2e-runner\Ministry.of.Education-0.4.3-moe.10-win-x64.outlook-reply-fix.exe` had size `390061316` and SHA256 `2e189dd004995d6ce18e9e240f8228ba5039c2e384fd479a597137458a9046cf`.
- Refreshed installed-app smoke is pending for the local `e35ee6...` asset. VM state from the earlier assisted-install attempt had `codexvmtest` with no app installed, while an older app existed under the `clawxtest` profile.
- Forms preview reached Microsoft sign-in and returned a clear sign-in-required reason instead of silently failing.
- Outlook no-send/no-download safety gates refused unsafe actions without confirmation.
- No real email send, attachment download, or Forms submit was executed.
- The standalone gateway smoke script default timeout was raised from 25 seconds to 150 seconds after the installed app proved first-start readiness can exceed the old smoke window on a busy VM.
- Hidden WinRM `/S /currentuser` automation reproduced the same failure against the superseded `2e189dd004995d6ce18e9e240f8228ba5039c2e384fd479a597137458a9046cf` installer: the installer copied a large partial tree but did not create `Ministry of Education.exe`, `playwright-core`, bundled `ffmpeg.exe`, or `WinSpeechRecognize.exe`. Treat this as a `RED` automation path and not as a supported end-user install flow. The release instructions must continue to require the normal assisted Windows installer screens.
- `windows-pilot/scripts/pilot-run-silent-install.ps1` now uses a 30-minute default timeout and records an install-tree JSON summary on timeout or exit so future failures identify which critical runtime files are missing.
- `windows-pilot/scripts/pilot-mac-wait-run-demo.sh` now refuses to run hidden silent install by default when the installed `app.asar` is stale or missing. It emits `STATE:STALE_APP_REQUIRES_ASSISTED_INSTALL`; only an explicit `ALLOW_SILENT_INSTALL=1` run can enter the diagnostic path, and that path emits `STATE:DIAGNOSTIC_SILENT_INSTALL_ONLY`.

## Evidence Update Rules

- Use exact commands and pass counts.
- Use artifact paths instead of copying logs wholesale.
- Redact or omit provider keys, passwords, Host API tokens, private Forms URLs, email bodies, full recipient lists, and key-file hashes.
- Mark live Microsoft sends/submits as `not run` unless explicitly confirmed in the same session.
- If a test cannot run, record the blocker and the next safe command.
