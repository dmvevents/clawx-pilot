# GA Release Evidence Manifest

Last updated: 2026-06-23.

## Purpose

This is the handoff packet for Codex, Claude Code, Windows VM/laptop operators, and release reviewers. Update this file whenever a release gate gets fresh evidence. Do not call a build GA unless every release-critical row is `GREEN` or has an explicitly accepted `YELLOW` deferral.

Use `docs/GA_VM_BROWSER_VISUAL_ACCEPTANCE_CRITERIA.md` for human or VLM review of installed Electron, VM, Outlook, and Forms screenshots before recording browser visual evidence here.

## Candidate Snapshot

| Field | Value |
|---|---|
| Branch | `release/moe10-windows-laptop-ready-20260529` |
| Installer source commit | `42787c6243eba88f436b43f84df8d66aa60d5683` |
| GitHub prerelease tag | `moe10-windows-rc-20260623-stable-regression` |
| Installer path | `release/Ministry of Education-0.4.3-moe.10-win-x64.exe` |
| Installer SHA256 | `0ad45db3d1a405c47f8105720099beca220e99fb2e81c69cebb3c45b6622100e` |
| Blockmap SHA256 | `0e2bc93dd063262bc1c371699601a4e8e6447a9a6445b0fca355ee74c0d274ab` |
| App ASAR SHA256 | `d8b439f157527d2bac5d144fcd261e13294cb11a50b3b800b1ab8429a8c9a0cb` |
| `ffmpeg.exe` SHA256 | `228d7a8556258de907fdb55f36850078ebc7680b84ec30d84ea02e99bec1d1eb` |
| `WinSpeechRecognize.exe` SHA256 | `46166290b5d2427dacdf55a7d05676defe356583eec821ca6a927e243ed40ec7` |
| Status note | Rebuilt locally on 2026-06-23 from `42787c6243eba88f436b43f84df8d66aa60d5683`; local package inspection and focused 107-test release regression slice passed. RM/VM download verification matched the refreshed GitHub asset hash, but installed-app smoke is blocked until a normal assisted desktop install updates the stale VM app tree. Mac laptop watcher refuses stale-app hidden silent install by default and labels any explicit opt-in as diagnostic-only. |

## Gate Table

| Gate | Status | Command / evidence | Artifact path | Verifier | Redaction notes | Blocker / accepted risk |
|---|---|---|---|---|---|---|
| Local unit regression matrix | GREEN | `pnpm test` passed: 147 files, 1054 passed, 5 skipped | terminal output | Codex | No secrets printed | MaxListeners warnings observed; no failures |
| TypeScript | GREEN | `pnpm run typecheck` passed | terminal output | Codex | No secrets printed | None |
| Lint | GREEN | `pnpm run lint` exited 0 with known 39 warnings | terminal output | Codex | No secrets printed | Existing warnings remain in forms scripts/snapshot/gateway seed tests |
| Outlook reviewed-draft send | GREEN for unit/source | `tests/unit/outlook-actions-safety.test.ts`, `tests/unit/moe-principal-assistant-plugin.test.ts` | repo tests | Codex + test-engineer sidecar | No email sent | Installed signed-in Outlook proof still required for GA |
| Outlook inbox folder/windowing | GREEN for unit/source | `tests/unit/outlook-inbox-windowing.test.ts` | repo tests | Codex + test-engineer sidecar | No email bodies printed | Installed signed-in Outlook proof still required for GA |
| Reply/forward archive prevention | GREEN for unit/source | `tests/unit/outlook-actions-safety.test.ts` | repo tests | Codex + test-engineer sidecar | No email sent | Installed signed-in Outlook proof still required for GA |
| Chrome/CDP user guidance | GREEN for model-facing guidance | `tests/unit/moe-principal-assistant-plugin.test.ts` forbids manual Chrome debugging guidance | repo tests | Codex | No private browser data printed | Fresh user attached-profile UX still needs installed proof |
| Forms partial-fill safety | GREEN for existing unit/probe checks | `tests/unit/forms-browser-submit-gate.test.ts`, `tests/unit/windows-pilot-electron-cdp-probe.test.ts` | repo tests | Codex + test-engineer sidecar | No private Forms URLs printed | Signed-in Forms preview on Windows still required |
| Office CSV/Excel/Word/PPT matrix | GREEN for source/package, YELLOW for installed chat | Package/runtime checks now validate seeded CSV rows, generated Excel data rows, Word OpenXML, PowerPoint OpenXML slides, and Office analysis summaries | `tests/unit/windows-package-inspection.test.ts`, `windows-pilot/scripts/pilot-seed-demo-documents.ps1`, `windows-pilot/scripts/pilot-office-runtime-check.ps1`, `scripts/demo-office-analysis-e2e.mjs` | Codex + test-engineer sidecar | No document contents printed | Installed app chat proof for the full Office matrix still required before GA |
| ASR ffmpeg/provider/package drift | GREEN for unit/source | ASR focused tests cover packaged ffmpeg resolver, Azure seed, native fallback, and actionable no-Whisper error | repo tests | Codex + test-engineer sidecar | Config/key values not printed | Installed ASR smoke still required; cloud ASR seed required for high-quality GA |
| Windows package artifacts | GREEN for local rebuilt package | `pnpm run build:win` passed; local artifact probe confirmed `playwright-core` 1.59.1, `ffmpeg.exe`, `WinSpeechRecognize.exe`, `node.exe`, and `uv.exe`; `pnpm exec vitest run tests/unit/windows-package-inspection.test.ts --reporter=verbose` passed 11 tests | `release/win-unpacked` | Codex + Build Lead sidecar | `.key` file contents and hashes not printed | Clean VM install proof must be rerun for the refreshed `0ad45db...` installer |
| Clean Windows install / VM smoke | YELLOW for refreshed installer | RM/VM downloaded the refreshed GitHub asset and SHA matched `0ad45db3d1a405c47f8105720099beca220e99fb2e81c69cebb3c45b6622100e`; installed trees remain stale/partial (`app.asar` old `ee749...`; temp-user app exe missing), so installed-app smoke was not run against the refreshed binary | VM `clawx-win-rc-20260609`, evidence root `C:\Users\codexvmtest\Downloads\clawx-rm-refreshed-asset-20260623-034800`; prior green smoke root `C:\Users\clawxtest\Downloads\clawx-vm-smoke-20260622-205920` was for the earlier asset | Codex | No passwords printed; no email sent; no attachment downloaded; no Forms submitted | Requires normal assisted desktop install, then `pilot-managed-cdp-visual-smoke.ps1 -StopExistingApp -StopChrome`; signed-in Microsoft tenant proof remains required for GA |
| Hidden WinRM silent install automation | RED for automation, not the supported user install path | Earlier fresh temp-user VM run as `codexvmtest` downloaded the GitHub prerelease installer, SHA matched the earlier `3a43cdff...` asset, and hidden `/S /currentuser` reached a static partial tree before app exe/runtime helpers existed; 900s run timed out, longer retry was manually stopped after no progress. Follow-up watcher contract test passed and now requires `ALLOW_SILENT_INSTALL=1` before the Mac watcher invokes this diagnostic path. | VM `clawx-win-rc-20260609`; evidence roots `C:\Users\codexvmtest\Downloads\clawx-vm-visual-criteria-20260623\clawx-silent-install-20260623-024708` and `C:\Users\codexvmtest\Downloads\clawx-vm-visual-criteria-20260623-long-install\clawx-silent-install-20260623-030642`; local focused test `pnpm exec vitest run tests/unit/windows-pilot-chat-scenarios.test.ts tests/unit/windows-pilot-electron-cdp-probe.test.ts tests/unit/outlook-inbox-windowing.test.ts tests/unit/outlook-actions-safety.test.ts tests/unit/forms-browser-submit-gate.test.ts tests/unit/windows-package-inspection.test.ts` passed 107 tests | Codex + windows_release_packager/test-engineer sidecars | No passwords, keys, email bodies, private URLs, or token values printed | Do not use hidden WinRM `/S /currentuser` as release proof. Use assisted desktop/RDP install for visual proof or fix the NSIS silent path before claiming unattended install support |
| Online model/Gateway path | GREEN for installed gateway readiness | Initial direct gateway probe timed out with 25s wait; rerun with 180s wait completed, gateway ready in 12.0s, model `custom-moecloud/moe-demo-pro`; installed Electron probe also showed `GATEWAY_PORT_READY=True` | `C:\Users\Public\Downloads\clawx-installed-gateway-smoke-20260623-012219` and `C:\Users\Public\Downloads\clawx-cdp-smoke-20260623-011835` | Codex | Gateway key not printed | Live chat transcript through signed-in tester profile still required before GA |
| Secrets audit | YELLOW | `.gitignore` covers Azure seed/key; package probe reports secret metadata only | repo diff | Codex | No secrets printed | Run final `git grep` before commit/publish |
| Process/agent repeatability | GREEN for source | `ga-e2e-regression` skill mirrored across `.agents`, `.codex`, `.claude`; verifier agents added | repo files | Codex + Release Lead sidecar | No secrets printed | Run process contract test |

## 2026-06-23 Windows VM Smoke Notes

- Fresh install package smoke is suitable for prerelease publication.
- GA remains `YELLOW`, not `GREEN`, because the clean VM has no signed-in Microsoft tenant profile.
- The refreshed GitHub installer asset was verified on the RM/VM: `C:\Users\codexvmtest\Downloads\clawx-e2e-runner\Ministry.of.Education-0.4.3-moe.10-win-x64.refreshed.exe` had size `390060450` and SHA256 `0ad45db3d1a405c47f8105720099beca220e99fb2e81c69cebb3c45b6622100e`.
- Refreshed installed-app smoke is blocked on the VM until a normal assisted desktop install runs. Existing installed trees still have old `app.asar` hash `ee749bc6b05e56cc4ffbc6faba6436bf51cd23c02a3d86ed5a87a14d3bac1421`, and the temp-user tree is missing `Ministry of Education.exe`.
- Forms preview reached Microsoft sign-in and returned a clear sign-in-required reason instead of silently failing.
- Outlook no-send/no-download safety gates refused unsafe actions without confirmation.
- No real email send, attachment download, or Forms submit was executed.
- The standalone gateway smoke script default timeout was raised from 25 seconds to 150 seconds after the installed app proved first-start readiness can exceed the old smoke window on a busy VM.
- Additional clean temp-user VM testing on `codexvmtest` reproduced a hidden WinRM `/S /currentuser` automation failure against the earlier `3a43cdff49c758b07ccfd57117a06304152813a7b80d857ba99c03486fe8f4fa` installer: the installer copied a large partial tree but did not create `Ministry of Education.exe`, `playwright-core`, bundled `ffmpeg.exe`, or `WinSpeechRecognize.exe`. Treat this as a `RED` automation path and not as a supported end-user install flow. The release instructions must continue to require the normal assisted Windows installer screens.
- `windows-pilot/scripts/pilot-run-silent-install.ps1` now uses a 30-minute default timeout and records an install-tree JSON summary on timeout or exit so future failures identify which critical runtime files are missing.
- `windows-pilot/scripts/pilot-mac-wait-run-demo.sh` now refuses to run hidden silent install by default when the installed `app.asar` is stale or missing. It emits `STATE:STALE_APP_REQUIRES_ASSISTED_INSTALL`; only an explicit `ALLOW_SILENT_INSTALL=1` run can enter the diagnostic path, and that path emits `STATE:DIAGNOSTIC_SILENT_INSTALL_ONLY`.

## Evidence Update Rules

- Use exact commands and pass counts.
- Use artifact paths instead of copying logs wholesale.
- Redact or omit provider keys, passwords, Host API tokens, private Forms URLs, email bodies, full recipient lists, and key-file hashes.
- Mark live Microsoft sends/submits as `not run` unless explicitly confirmed in the same session.
- If a test cannot run, record the blocker and the next safe command.
