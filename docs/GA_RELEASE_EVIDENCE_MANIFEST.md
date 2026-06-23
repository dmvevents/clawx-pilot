# GA Release Evidence Manifest

Last updated: 2026-06-23.

## Purpose

This is the handoff packet for Codex, Claude Code, Windows VM/laptop operators, and release reviewers. Update this file whenever a release gate gets fresh evidence. Do not call a build GA unless every release-critical row is `GREEN` or has an explicitly accepted `YELLOW` deferral.

Use `docs/GA_VM_BROWSER_VISUAL_ACCEPTANCE_CRITERIA.md` for human or VLM review of installed Electron, VM, Outlook, and Forms screenshots before recording browser visual evidence here.

## Candidate Snapshot

| Field | Value |
|---|---|
| Branch | `release/moe10-windows-laptop-ready-20260529` |
| Installer source commit | `b38b6208218b2d84d5cade55890fda0f8c5489e9` |
| GitHub prerelease tag | `moe10-windows-rc-20260623-outlook-green-b38b620` |
| Installer path | GitHub release asset `Ministry.of.Education-0.4.3-moe.10-win-x64.exe` |
| Installer SHA256 | `a19a9c62eaacd958df772b432277dd220a38e61e5f0e69b449ee6b66ef00c6ee` |
| Blockmap SHA256 | `cadd21e35608817dcc099239141a65ee640b6582e2b154bac40340d7befff6a6` |
| App ASAR SHA256 | Not extracted from GitHub Actions NSIS artifact |
| `ffmpeg.exe` SHA256 | `228d7a8556258de907fdb55f36850078ebc7680b84ec30d84ea02e99bec1d1eb` |
| `WinSpeechRecognize.exe` SHA256 | `6ae4190736ae88c13e7e8da8f13ff047756a8cb27de3797c416af15e5ee67447` |
| Status note | Built by GitHub Actions run `28034003516` on 2026-06-23 after Outlook compose/reply/reply-all/forward/send hardening. Full unit suite, typecheck, lint, harness CI, package-owner runtime checks, local signed-in Electron/Chrome CDP email probes, controlled Outlook send matrix, and package workflow passed. The exact asset still needs clean installed-app Windows proof before GA. |

## Gate Table

| Gate | Status | Command / evidence | Artifact path | Verifier | Redaction notes | Blocker / accepted risk |
|---|---|---|---|---|---|---|
| Local unit regression matrix | GREEN | `pnpm test` passed: 148 files, 1133 passed, 5 skipped | terminal output | Codex verifier lane | No secrets printed | MaxListeners warnings observed; no failures |
| TypeScript | GREEN | `pnpm run typecheck` passed | terminal output | Codex | No secrets printed | None |
| Lint | GREEN | `pnpm run lint:check` exited 0 with known 39 warnings | terminal output | Codex | No secrets printed | Existing warnings remain in forms scripts/snapshot/gateway seed tests |
| Outlook reviewed-draft send | GREEN for source/local app | `tests/unit/outlook-actions-safety.test.ts`, `tests/unit/moe-principal-assistant-plugin.test.ts`; focused Outlook/plugin/probe suite passed; controlled Electron/Chrome send matrix sent compose, reply, reply-all, and forward through Host API with review/confirm gates | repo tests; `/tmp/clawx-email-send-matrix-20260623102302/clawx-electron-probe-2026-06-23T14-26-13-166Z.json` | Codex + verifier lane | Controlled test emails were sent with same-session authorization; no attachment downloaded; no Forms submitted | Clean installed Windows proof still required for GA |
| Outlook inbox folder/windowing | GREEN for unit/source | `tests/unit/outlook-inbox-windowing.test.ts`; Inbox/Sent/Drafts/Archive/Search state transitions covered | repo tests | Codex + test-engineer sidecar | No email bodies printed | Browser scan is still a bounded recent Inbox window; Graph/server-side search remains the exhaustive path |
| Local signed-in Outlook CDP manager smoke | GREEN for local source/package | Local Chrome at `outlook.cloud.microsoft` on CDP `18792`: safe smoke had `eventCount=0`; send matrix passed compose/reply/replyAll/forward with Sent Items marker proof and no Drafts marker residue; state matrix passed Inbox, Sent, Drafts, Archive, Search, and opened-message states | `/tmp/clawx-email-safe-smoke-20260623102232/clawx-electron-probe-2026-06-23T14-22-35-501Z.json`; `/tmp/clawx-email-send-matrix-20260623102302/clawx-electron-probe-2026-06-23T14-26-13-166Z.json`; `/tmp/clawx-email-state-matrix-20260623102700/clawx-electron-probe-2026-06-23T14-27-58-671Z.json` | Codex | No email bodies, passwords, tokens, attachment downloads, or Forms submits recorded in artifacts | Installed-app VM proof is still required |
| Reply/forward archive prevention | GREEN for unit/source | `tests/unit/outlook-actions-safety.test.ts` covers shortcut-first Reply, Archive/Delete exclusion, icon-only Reply, and menu fallback | repo tests | Codex + test-engineer sidecar | No email sent | Installed signed-in Outlook proof still required for GA |
| Reply body field targeting | GREEN for unit/package | `tests/unit/outlook-actions-safety.test.ts` verifies labelled body fill, rejects recipient-field body text including short replies, refuses VLM fallback before typing when focus lands in `To:`, and rejects a reply draft if the post-compose probe finds requested body text in recipients; Electron/Chrome matrix confirmed body text landed in compose body and not recipients for reply, reply-all, forward, and compose | repo tests; `/tmp/clawx-email-live-20260623-fresh-main/clawx-electron-probe-2026-06-23T08-07-01-396Z.json` | Codex | No email body printed | Installed signed-in Outlook proof still required for GA |
| Chrome/CDP user guidance | GREEN for model-facing guidance | `tests/unit/moe-principal-assistant-plugin.test.ts` forbids manual Chrome debugging guidance | repo tests | Codex | No private browser data printed | Fresh user attached-profile UX still needs installed proof |
| Forms partial-fill safety | GREEN for existing unit/probe checks | `tests/unit/forms-browser-submit-gate.test.ts`, `tests/unit/windows-pilot-electron-cdp-probe.test.ts` | repo tests | Codex + test-engineer sidecar | No private Forms URLs printed | Signed-in Forms preview on Windows still required |
| Office CSV/Excel/Word/PPT matrix | GREEN for source/package, YELLOW for installed chat | Package/runtime checks now validate seeded CSV rows, generated Excel data rows, Word OpenXML, PowerPoint OpenXML slides, and Office analysis summaries | `tests/unit/windows-package-inspection.test.ts`, `windows-pilot/scripts/pilot-seed-demo-documents.ps1`, `windows-pilot/scripts/pilot-office-runtime-check.ps1`, `scripts/demo-office-analysis-e2e.mjs` | Codex + test-engineer sidecar | No document contents printed | Installed app chat proof for the full Office matrix still required before GA |
| ASR ffmpeg/provider/package drift | GREEN for unit/source | ASR focused tests cover packaged ffmpeg resolver, Azure seed, native fallback, and actionable no-Whisper error | repo tests | Codex + test-engineer sidecar | Config/key values not printed | Installed ASR smoke still required; cloud ASR seed required for high-quality GA |
| Windows package artifacts | GREEN for GitHub prerelease | GitHub Actions run `28034003516` completed successfully from commit `b38b6208218b2d84d5cade55890fda0f8c5489e9` and uploaded x64 installer plus blockmap; installer SHA256 `a19a9c62...`, blockmap SHA256 `cadd21e3...` | GitHub prerelease `moe10-windows-rc-20260623-outlook-green-b38b620`; local download `/tmp/moe-win-28034003516-b38b620` | Codex | Release notes include hashes only; no key contents printed | Clean VM installed-app email proof remains required; hidden WinRM install is diagnostic-only |
| Clean Windows install / VM smoke | YELLOW pending | Current `a19a9c62...` installer has source, GitHub package, and local Electron/Chrome email proof but has not yet been proven through a clean installed Windows desktop shortcut path. Earlier hidden WinRM `/S` attempts against older June 23 assets were stopped after failing to produce a usable app tree; that path is diagnostic-only. | VM `clawx-win-rc-20260609`; pending assisted install proof | Codex | Test credentials handled through environment variables only; no passwords printed; no attachment downloaded; no Forms submitted | Use normal assisted desktop/RDP install for release proof, or fix the NSIS silent path before claiming unattended install support. Do not call GA from hidden install alone |
| Hidden WinRM silent install automation | RED for automation, not the supported user install path | The exact `2e189dd...` installer reproduced the hidden `/S /currentuser` failure under `codexvmtest`: after several minutes, `Ministry of Education.exe` was absent, `playwright-core`, bundled `ffmpeg.exe`, and `WinSpeechRecognize.exe` were absent, and the partial tree had 116595 files / 1012260898 bytes. Earlier fresh temp-user VM runs showed the same class of failure. | Current evidence root `C:\Users\Public\Downloads\clawx-silent-install-20260623-045251`; prior evidence roots `C:\Users\codexvmtest\Downloads\clawx-vm-visual-criteria-20260623\clawx-silent-install-20260623-024708` and `C:\Users\codexvmtest\Downloads\clawx-vm-visual-criteria-20260623-long-install\clawx-silent-install-20260623-030642` | Codex + windows_release_packager/test-engineer sidecars | No passwords, keys, email bodies, private URLs, or token values printed | Do not use hidden WinRM `/S /currentuser` as release proof. Use assisted desktop/RDP install for visual proof or fix the NSIS silent path before claiming unattended install support |
| Online model/Gateway path | GREEN for installed gateway readiness | Initial direct gateway probe timed out with 25s wait; rerun with 180s wait completed, gateway ready in 12.0s, model `custom-moecloud/moe-demo-pro`; installed Electron probe also showed `GATEWAY_PORT_READY=True` | `C:\Users\Public\Downloads\clawx-installed-gateway-smoke-20260623-012219` and `C:\Users\Public\Downloads\clawx-cdp-smoke-20260623-011835` | Codex | Gateway key not printed | Live chat transcript through signed-in tester profile still required before GA |
| Secrets audit | YELLOW | `.gitignore` covers Azure seed/key; package probe reports secret metadata only | repo diff | Codex | No secrets printed | Run final `git grep` before commit/publish |
| Process/agent repeatability | GREEN for source | `ga-e2e-regression` skill mirrored across `.agents`, `.codex`, `.claude`; verifier agents added | repo files | Codex + Release Lead sidecar | No secrets printed | Run process contract test |

## 2026-06-23 Windows VM Smoke Notes

- GitHub Actions package run `28034003516` produced the current `a19a9c62...` installer and it has been published as prerelease tag `moe10-windows-rc-20260623-outlook-green-b38b620`.
- Electron/Chrome Host API matrix evidence for the current source passed compose, reply, reply-all, and forward with controlled same-session test sends. Each marker appeared in Sent Items, no matching marker remained in Drafts, and no matching compose remained open.
- Local Outlook CDP evidence is now included in the listed asset: with the user's local Chrome already open at `https://outlook.cloud.microsoft/mail/`, the v2 browser manager opened the signed-in mailbox and read the Inbox successfully. The widened date-search probe split the 12-row bounded recent Inbox window into 10 June rows and 2 May rows, which directly validates the no-year Outlook date parser fix for the "missing older June emails" regression.
- GA remains `YELLOW`, not `GREEN`, because the refreshed local installer still needs a signed-in Microsoft tenant profile installed-app email smoke.
- Current release asset: `Ministry.of.Education-0.4.3-moe.10-win-x64.exe`, size `300576812`, SHA256 `a19a9c62eaacd958df772b432277dd220a38e61e5f0e69b449ee6b66ef00c6ee`; blockmap SHA256 `cadd21e35608817dcc099239141a65ee640b6582e2b154bac40340d7befff6a6`.
- Hidden WinRM `/S` install against older June 23 assets was stopped after it failed to create `Ministry of Education.exe` or `playwright-core`; keep this path diagnostic-only until a future explicit silent-install proof passes.
- Previous VM smoke evidence belongs to the superseded GitHub installer asset: `C:\Users\codexvmtest\Downloads\clawx-e2e-runner\Ministry.of.Education-0.4.3-moe.10-win-x64.outlook-reply-fix.exe` had size `390061316` and SHA256 `2e189dd004995d6ce18e9e240f8228ba5039c2e384fd479a597137458a9046cf`.
- Refreshed installed-app smoke is pending for the release `a19a9c62...` asset. VM state from the earlier assisted-install attempt had `codexvmtest` with no app installed, while an older app existed under the `clawxtest` profile.
- Forms preview reached Microsoft sign-in and returned a clear sign-in-required reason instead of silently failing.
- Outlook no-download and no-submit safety gates refused unsafe actions without confirmation.
- Controlled test emails were sent only after same-session authorization. No attachment download or Forms submit was executed.
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
