# GA Release Evidence Manifest

Last updated: 2026-06-23.

## Purpose

This is the handoff packet for Codex, Claude Code, Windows VM/laptop operators, and release reviewers. Update this file whenever a release gate gets fresh evidence. Do not call a build GA unless every release-critical row is `GREEN` or has an explicitly accepted `YELLOW` deferral.

Use `docs/GA_VM_BROWSER_VISUAL_ACCEPTANCE_CRITERIA.md` for human or VLM review of installed Electron, VM, Outlook, and Forms screenshots before recording browser visual evidence here.

## Candidate Snapshot

| Field | Value |
|---|---|
| Branch | `release/moe10-windows-laptop-ready-20260529` |
| Installer source commit | release tag target |
| GitHub prerelease tag | `moe10-windows-rc-20260623-outlook-reply-fix` |
| Installer path | `release/Ministry of Education-0.4.3-moe.10-win-x64.exe` |
| Installer SHA256 | `2e189dd004995d6ce18e9e240f8228ba5039c2e384fd479a597137458a9046cf` |
| Blockmap SHA256 | `8863ef90aff9a8ab804a9e39c58b20c9a480f67f888b01829d56b3be2e0ea132` |
| App ASAR SHA256 | `a67a1f3f518c2bbeccac1adf306e780762a12a421f07205c8c001b65df2bc7f7` |
| `ffmpeg.exe` SHA256 | `228d7a8556258de907fdb55f36850078ebc7680b84ec30d84ea02e99bec1d1eb` |
| `WinSpeechRecognize.exe` SHA256 | `46166290b5d2427dacdf55a7d05676defe356583eec821ca6a927e243ed40ec7` |
| Status note | Rebuilt locally on 2026-06-23 after Outlook reply/body and archive-adjacent Reply regressions. Local package inspection, focused 101-test Outlook release slice, full unit suite, typecheck, lint, and harness CI passed. VM runner scripts were refreshed; installed-app Outlook/Forms smoke must still run against this exact asset before GA. |

## Gate Table

| Gate | Status | Command / evidence | Artifact path | Verifier | Redaction notes | Blocker / accepted risk |
|---|---|---|---|---|---|---|
| Local unit regression matrix | GREEN | `pnpm test` passed: 147 files, 1076 passed, 5 skipped | terminal output | Codex | No secrets printed | MaxListeners warnings observed; no failures |
| TypeScript | GREEN | `pnpm run typecheck` passed | terminal output | Codex | No secrets printed | None |
| Lint | GREEN | `pnpm run lint` exited 0 with known 39 warnings | terminal output | Codex | No secrets printed | Existing warnings remain in forms scripts/snapshot/gateway seed tests |
| Outlook reviewed-draft send | GREEN for unit/source | `tests/unit/outlook-actions-safety.test.ts`, `tests/unit/moe-principal-assistant-plugin.test.ts`; focused Outlook suite passed 101 tests | repo tests | Codex + test-engineer sidecar | No email sent | Installed signed-in Outlook proof still required for GA |
| Outlook inbox folder/windowing | GREEN for unit/source | `tests/unit/outlook-inbox-windowing.test.ts`; Inbox/Sent/Drafts/Archive/Search state transitions covered | repo tests | Codex + test-engineer sidecar | No email bodies printed | Browser scan is still a bounded recent Inbox window; Graph/server-side search remains the exhaustive path |
| Reply/forward archive prevention | GREEN for unit/source | `tests/unit/outlook-actions-safety.test.ts` covers shortcut-first Reply, Archive/Delete exclusion, icon-only Reply, and menu fallback | repo tests | Codex + test-engineer sidecar | No email sent | Installed signed-in Outlook proof still required for GA |
| Reply body field targeting | GREEN for unit/source | `tests/unit/outlook-actions-safety.test.ts` verifies labelled body fill, rejects recipient-field body text, and refuses VLM fallback before typing when focus lands in `To:` | repo tests | Codex | No email body printed | Installed signed-in Outlook proof still required for GA |
| Chrome/CDP user guidance | GREEN for model-facing guidance | `tests/unit/moe-principal-assistant-plugin.test.ts` forbids manual Chrome debugging guidance | repo tests | Codex | No private browser data printed | Fresh user attached-profile UX still needs installed proof |
| Forms partial-fill safety | GREEN for existing unit/probe checks | `tests/unit/forms-browser-submit-gate.test.ts`, `tests/unit/windows-pilot-electron-cdp-probe.test.ts` | repo tests | Codex + test-engineer sidecar | No private Forms URLs printed | Signed-in Forms preview on Windows still required |
| Office CSV/Excel/Word/PPT matrix | GREEN for source/package, YELLOW for installed chat | Package/runtime checks now validate seeded CSV rows, generated Excel data rows, Word OpenXML, PowerPoint OpenXML slides, and Office analysis summaries | `tests/unit/windows-package-inspection.test.ts`, `windows-pilot/scripts/pilot-seed-demo-documents.ps1`, `windows-pilot/scripts/pilot-office-runtime-check.ps1`, `scripts/demo-office-analysis-e2e.mjs` | Codex + test-engineer sidecar | No document contents printed | Installed app chat proof for the full Office matrix still required before GA |
| ASR ffmpeg/provider/package drift | GREEN for unit/source | ASR focused tests cover packaged ffmpeg resolver, Azure seed, native fallback, and actionable no-Whisper error | repo tests | Codex + test-engineer sidecar | Config/key values not printed | Installed ASR smoke still required; cloud ASR seed required for high-quality GA |
| Windows package artifacts | GREEN for local rebuilt package | `pnpm run build:win` passed; local artifact probe confirmed `playwright-core`, `ffmpeg.exe`, `WinSpeechRecognize.exe`, cloud gateway seed files, `node.exe`, and `uv.exe`; `pnpm exec vitest run tests/unit/windows-package-inspection.test.ts --reporter=verbose` passed 13 tests | `release/win-unpacked` | Codex + Build Lead sidecar | `.key` file contents and hashes not printed | Clean VM install proof must be rerun for the refreshed `2e189dd...` installer |
| Clean Windows install / VM smoke | YELLOW pending rerun | VM is reachable over WinRM/IAP and runner scripts were refreshed with the Outlook state matrix. The WinRM user had no installed app before this release; an older app existed under a different Windows profile. | VM `clawx-win-rc-20260609`; runner path `C:\Users\codexvmtest\Downloads\clawx-e2e-runner` | Codex | Test credentials handled through environment variables only; no passwords printed; no email sent; no attachment downloaded; no Forms submitted | After publishing the new prerelease asset, VM must download/install this exact SHA, sign in with the authorized test account, then run `pilot-managed-cdp-visual-smoke.ps1 -OutlookStateMatrix` with Forms no-submit smoke |
| Hidden WinRM silent install automation | RED for automation, not the supported user install path | Earlier fresh temp-user VM run as `codexvmtest` downloaded the GitHub prerelease installer, SHA matched the earlier `3a43cdff...` asset, and hidden `/S /currentuser` reached a static partial tree before app exe/runtime helpers existed; 900s run timed out, longer retry was manually stopped after no progress. Follow-up watcher contract test passed and now requires `ALLOW_SILENT_INSTALL=1` before the Mac watcher invokes this diagnostic path. | VM `clawx-win-rc-20260609`; evidence roots `C:\Users\codexvmtest\Downloads\clawx-vm-visual-criteria-20260623\clawx-silent-install-20260623-024708` and `C:\Users\codexvmtest\Downloads\clawx-vm-visual-criteria-20260623-long-install\clawx-silent-install-20260623-030642`; local focused test `pnpm exec vitest run tests/unit/windows-pilot-chat-scenarios.test.ts tests/unit/windows-pilot-electron-cdp-probe.test.ts tests/unit/outlook-inbox-windowing.test.ts tests/unit/outlook-actions-safety.test.ts tests/unit/forms-browser-submit-gate.test.ts tests/unit/windows-package-inspection.test.ts` passed 107 tests | Codex + windows_release_packager/test-engineer sidecars | No passwords, keys, email bodies, private URLs, or token values printed | Do not use hidden WinRM `/S /currentuser` as release proof. Use assisted desktop/RDP install for visual proof or fix the NSIS silent path before claiming unattended install support |
| Online model/Gateway path | GREEN for installed gateway readiness | Initial direct gateway probe timed out with 25s wait; rerun with 180s wait completed, gateway ready in 12.0s, model `custom-moecloud/moe-demo-pro`; installed Electron probe also showed `GATEWAY_PORT_READY=True` | `C:\Users\Public\Downloads\clawx-installed-gateway-smoke-20260623-012219` and `C:\Users\Public\Downloads\clawx-cdp-smoke-20260623-011835` | Codex | Gateway key not printed | Live chat transcript through signed-in tester profile still required before GA |
| Secrets audit | YELLOW | `.gitignore` covers Azure seed/key; package probe reports secret metadata only | repo diff | Codex | No secrets printed | Run final `git grep` before commit/publish |
| Process/agent repeatability | GREEN for source | `ga-e2e-regression` skill mirrored across `.agents`, `.codex`, `.claude`; verifier agents added | repo files | Codex + Release Lead sidecar | No secrets printed | Run process contract test |

## 2026-06-23 Windows VM Smoke Notes

- Fresh install package smoke is suitable for prerelease publication.
- GA remains `YELLOW`, not `GREEN`, because the clean VM has no signed-in Microsoft tenant profile.
- The current refreshed GitHub installer asset is expected to have size `390061316` and SHA256 `2e189dd004995d6ce18e9e240f8228ba5039c2e384fd479a597137458a9046cf`.
- Refreshed installed-app smoke is pending for this exact asset. VM state before release upload: `codexvmtest` had no app installed, while an older app existed under the `clawxtest` profile.
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
