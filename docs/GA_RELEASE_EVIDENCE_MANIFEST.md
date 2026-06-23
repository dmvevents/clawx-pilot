# GA Release Evidence Manifest

Last updated: 2026-06-23.

## Purpose

This is the handoff packet for Codex, Claude Code, Windows VM/laptop operators, and release reviewers. Update this file whenever a release gate gets fresh evidence. Do not call a build GA unless every release-critical row is `GREEN` or has an explicitly accepted `YELLOW` deferral.

Use `docs/GA_VM_BROWSER_VISUAL_ACCEPTANCE_CRITERIA.md` for human or VLM review of installed Electron, VM, Outlook, and Forms screenshots before recording browser visual evidence here.

## Candidate Snapshot

| Field | Value |
|---|---|
| Branch | `release/moe10-windows-laptop-ready-20260529` |
| Installer source commit | `ea72db2` |
| GitHub prerelease tag | `moe10-windows-rc-20260623-outlook-reply-fix` |
| Installer path | `release/Ministry of Education-0.4.3-moe.10-win-x64.exe` |
| Installer SHA256 | `dbd252612b23c81f0061b8ec16063cee6fda3b94d834e881d4a6c83b503a0ea3` |
| Blockmap SHA256 | `9865b8acf84654590d866203346be48d295990e69b0eb437e723434e9db90fd1` |
| App ASAR SHA256 | `86604ddfd338f6baf7a9dd3d2524e84e68fbaa5fb697bb7a5af820965e0eb3a9` |
| `ffmpeg.exe` SHA256 | `228d7a8556258de907fdb55f36850078ebc7680b84ec30d84ea02e99bec1d1eb` |
| `WinSpeechRecognize.exe` SHA256 | `9a8fde8c31fda3d33f7512a9b696d1a872daf2f2b687489797554398a97608a6` |
| Status note | Rebuilt locally on 2026-06-23 at `ea72db2` after Outlook reply/body and archive-adjacent Reply regressions. Local package inspection, focused 92-test Outlook/plugin/probe release slice, full unit suite, typecheck, lint, and harness CI passed. Packaged `app.asar` inspection found the new reply recipient-field/body verification guard. GitHub asset upload and installed-app Outlook/Forms smoke must still run against this exact asset before GA. |

## Gate Table

| Gate | Status | Command / evidence | Artifact path | Verifier | Redaction notes | Blocker / accepted risk |
|---|---|---|---|---|---|---|
| Local unit regression matrix | GREEN | `pnpm test` passed: 147 files, 1085 passed, 5 skipped | terminal output | Codex | No secrets printed | MaxListeners warnings observed; no failures |
| TypeScript | GREEN | `pnpm run typecheck` passed | terminal output | Codex | No secrets printed | None |
| Lint | GREEN | `pnpm run lint` exited 0 with known 39 warnings | terminal output | Codex | No secrets printed | Existing warnings remain in forms scripts/snapshot/gateway seed tests |
| Outlook reviewed-draft send | GREEN for unit/source | `tests/unit/outlook-actions-safety.test.ts`, `tests/unit/moe-principal-assistant-plugin.test.ts`; focused Outlook/plugin/probe suite passed 92 tests | repo tests | Codex + test-engineer sidecar | No email sent | Installed signed-in Outlook proof still required for GA |
| Outlook inbox folder/windowing | GREEN for unit/source | `tests/unit/outlook-inbox-windowing.test.ts`; Inbox/Sent/Drafts/Archive/Search state transitions covered | repo tests | Codex + test-engineer sidecar | No email bodies printed | Browser scan is still a bounded recent Inbox window; Graph/server-side search remains the exhaustive path |
| Reply/forward archive prevention | GREEN for unit/source | `tests/unit/outlook-actions-safety.test.ts` covers shortcut-first Reply, Archive/Delete exclusion, icon-only Reply, and menu fallback | repo tests | Codex + test-engineer sidecar | No email sent | Installed signed-in Outlook proof still required for GA |
| Reply body field targeting | GREEN for unit/package | `tests/unit/outlook-actions-safety.test.ts` verifies labelled body fill, rejects recipient-field body text, refuses VLM fallback before typing when focus lands in `To:`, and rejects a reply draft if the post-compose probe finds requested body text in recipients; packaged `app.asar` contains the same refusal message | repo tests plus `strings release/win-unpacked/resources/app.asar` inspection | Codex | No email body printed | Installed signed-in Outlook proof still required for GA |
| Chrome/CDP user guidance | GREEN for model-facing guidance | `tests/unit/moe-principal-assistant-plugin.test.ts` forbids manual Chrome debugging guidance | repo tests | Codex | No private browser data printed | Fresh user attached-profile UX still needs installed proof |
| Forms partial-fill safety | GREEN for existing unit/probe checks | `tests/unit/forms-browser-submit-gate.test.ts`, `tests/unit/windows-pilot-electron-cdp-probe.test.ts` | repo tests | Codex + test-engineer sidecar | No private Forms URLs printed | Signed-in Forms preview on Windows still required |
| Office CSV/Excel/Word/PPT matrix | GREEN for source/package, YELLOW for installed chat | Package/runtime checks now validate seeded CSV rows, generated Excel data rows, Word OpenXML, PowerPoint OpenXML slides, and Office analysis summaries | `tests/unit/windows-package-inspection.test.ts`, `windows-pilot/scripts/pilot-seed-demo-documents.ps1`, `windows-pilot/scripts/pilot-office-runtime-check.ps1`, `scripts/demo-office-analysis-e2e.mjs` | Codex + test-engineer sidecar | No document contents printed | Installed app chat proof for the full Office matrix still required before GA |
| ASR ffmpeg/provider/package drift | GREEN for unit/source | ASR focused tests cover packaged ffmpeg resolver, Azure seed, native fallback, and actionable no-Whisper error | repo tests | Codex + test-engineer sidecar | Config/key values not printed | Installed ASR smoke still required; cloud ASR seed required for high-quality GA |
| Windows package artifacts | GREEN for local rebuilt package | `pnpm run build:win` passed; local artifact probe confirmed `playwright-core`, `ffmpeg.exe`, `WinSpeechRecognize.exe`, cloud gateway seed files, `node.exe`, and `uv.exe`; `pnpm exec vitest run tests/unit/windows-package-inspection.test.ts --reporter=verbose` passed 13 tests | `release/win-unpacked` | Codex + Build Lead sidecar | `.key` file contents and hashes not printed | Clean VM install proof must be rerun for the refreshed `dbd252...` installer |
| Clean Windows install / VM smoke | YELLOW pending assisted install | VM is reachable over WinRM/IAP. Previous VM evidence belongs to the superseded `2e189dd...` GitHub asset. The refreshed local `dbd252...` installer has not yet been uploaded to GitHub or installed in the VM, so installed-app Outlook/Forms smoke remains pending for this exact build. | VM `clawx-win-rc-20260609`; runner path `C:\Users\codexvmtest\Downloads\clawx-e2e-runner` | Codex | Test credentials handled through environment variables only; no passwords printed; no email sent; no attachment downloaded; no Forms submitted | Upload/refetch the `dbd252...` asset, perform normal assisted desktop/RDP install, then run test-account Microsoft sign-in and `pilot-managed-cdp-visual-smoke.ps1 -OutlookStateMatrix` with Forms no-submit smoke |
| Hidden WinRM silent install automation | RED for automation, not the supported user install path | The exact `2e189dd...` installer reproduced the hidden `/S /currentuser` failure under `codexvmtest`: after several minutes, `Ministry of Education.exe` was absent, `playwright-core`, bundled `ffmpeg.exe`, and `WinSpeechRecognize.exe` were absent, and the partial tree had 116595 files / 1012260898 bytes. Earlier fresh temp-user VM runs showed the same class of failure. | Current evidence root `C:\Users\Public\Downloads\clawx-silent-install-20260623-045251`; prior evidence roots `C:\Users\codexvmtest\Downloads\clawx-vm-visual-criteria-20260623\clawx-silent-install-20260623-024708` and `C:\Users\codexvmtest\Downloads\clawx-vm-visual-criteria-20260623-long-install\clawx-silent-install-20260623-030642` | Codex + windows_release_packager/test-engineer sidecars | No passwords, keys, email bodies, private URLs, or token values printed | Do not use hidden WinRM `/S /currentuser` as release proof. Use assisted desktop/RDP install for visual proof or fix the NSIS silent path before claiming unattended install support |
| Online model/Gateway path | GREEN for installed gateway readiness | Initial direct gateway probe timed out with 25s wait; rerun with 180s wait completed, gateway ready in 12.0s, model `custom-moecloud/moe-demo-pro`; installed Electron probe also showed `GATEWAY_PORT_READY=True` | `C:\Users\Public\Downloads\clawx-installed-gateway-smoke-20260623-012219` and `C:\Users\Public\Downloads\clawx-cdp-smoke-20260623-011835` | Codex | Gateway key not printed | Live chat transcript through signed-in tester profile still required before GA |
| Secrets audit | YELLOW | `.gitignore` covers Azure seed/key; package probe reports secret metadata only | repo diff | Codex | No secrets printed | Run final `git grep` before commit/publish |
| Process/agent repeatability | GREEN for source | `ga-e2e-regression` skill mirrored across `.agents`, `.codex`, `.claude`; verifier agents added | repo files | Codex + Release Lead sidecar | No secrets printed | Run process contract test |

## 2026-06-23 Windows VM Smoke Notes

- Fresh install package smoke is suitable for prerelease publication only after the GitHub asset is refreshed to the local `dbd252...` installer and the VM refetches that exact file.
- GA remains `YELLOW`, not `GREEN`, because the refreshed local installer still needs a signed-in Microsoft tenant profile installed-app smoke.
- Previous VM smoke evidence belongs to the superseded GitHub installer asset: `C:\Users\codexvmtest\Downloads\clawx-e2e-runner\Ministry.of.Education-0.4.3-moe.10-win-x64.outlook-reply-fix.exe` had size `390061316` and SHA256 `2e189dd004995d6ce18e9e240f8228ba5039c2e384fd479a597137458a9046cf`.
- Refreshed installed-app smoke is pending for the local `dbd252...` asset. VM state before assisted install: `codexvmtest` had no app installed, while an older app existed under the `clawxtest` profile.
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
