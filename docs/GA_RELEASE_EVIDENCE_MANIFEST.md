# GA Release Evidence Manifest

Last updated: 2026-06-23.

## Purpose

This is the handoff packet for Codex, Claude Code, Windows VM/laptop operators, and release reviewers. Update this file whenever a release gate gets fresh evidence. Do not call a build GA unless every release-critical row is `GREEN` or has an explicitly accepted `YELLOW` deferral.

## Candidate Snapshot

| Field | Value |
|---|---|
| Branch | `release/moe10-windows-laptop-ready-20260529` |
| Source commit at last local snapshot | Pending GitHub prerelease publication; tag target is authoritative |
| Installer path | `release/Ministry of Education-0.4.3-moe.10-win-x64.exe` |
| Installer SHA256 | `3a43cdff49c758b07ccfd57117a06304152813a7b80d857ba99c03486fe8f4fa` |
| Blockmap SHA256 | `dfeacd98465081df7c0da0494dede0b881f673af916f6da5661439880a68e817` |
| App ASAR SHA256 | `ee749bc6b05e56cc4ffbc6faba6436bf51cd23c02a3d86ed5a87a14d3bac1421` |
| `ffmpeg.exe` SHA256 | `228d7a8556258de907fdb55f36850078ebc7680b84ec30d84ea02e99bec1d1eb` |
| `WinSpeechRecognize.exe` SHA256 | `dd2994e73ca559c5187b998e038bf18ee5b05c17993023a7cc8dab9c4db9f25f` |
| Status note | Rebuilt locally on 2026-06-22 after process/test and Outlook reply-safety changes; clean Windows VM smoke completed on 2026-06-23 with prerelease/YELLOW caveats. |

## Gate Table

| Gate | Status | Command / evidence | Artifact path | Verifier | Redaction notes | Blocker / accepted risk |
|---|---|---|---|---|---|---|
| Local unit regression matrix | GREEN | `pnpm test` passed: 147 files, 1019 passed, 5 skipped | terminal output | Codex | No secrets printed | MaxListeners warnings observed; no failures |
| TypeScript | GREEN | `pnpm run typecheck` passed | terminal output | Codex | No secrets printed | None |
| Lint | GREEN | `pnpm run lint` exited 0 with known 39 warnings | terminal output | Codex | No secrets printed | Existing warnings remain in forms scripts/snapshot/gateway seed tests |
| Outlook reviewed-draft send | GREEN for unit/source | `tests/unit/outlook-actions-safety.test.ts`, `tests/unit/moe-principal-assistant-plugin.test.ts` | repo tests | Codex + test-engineer sidecar | No email sent | Installed signed-in Outlook proof still required for GA |
| Outlook inbox folder/windowing | GREEN for unit/source | `tests/unit/outlook-inbox-windowing.test.ts` | repo tests | Codex + test-engineer sidecar | No email bodies printed | Installed signed-in Outlook proof still required for GA |
| Reply/forward archive prevention | GREEN for unit/source | `tests/unit/outlook-actions-safety.test.ts` | repo tests | Codex + test-engineer sidecar | No email sent | Installed signed-in Outlook proof still required for GA |
| Chrome/CDP user guidance | GREEN for model-facing guidance | `tests/unit/moe-principal-assistant-plugin.test.ts` forbids manual Chrome debugging guidance | repo tests | Codex | No private browser data printed | Fresh user attached-profile UX still needs installed proof |
| Forms partial-fill safety | GREEN for existing unit/probe checks | `tests/unit/forms-browser-submit-gate.test.ts`, `tests/unit/windows-pilot-electron-cdp-probe.test.ts` | repo tests | Codex + test-engineer sidecar | No private Forms URLs printed | Signed-in Forms preview on Windows still required |
| Office CSV/Excel/Word/PPT matrix | YELLOW | Package/runtime checks and file-path extraction tests exist | repo tests | Codex + test-engineer sidecar | No document contents printed | Add generated-file validation for CSV->XLSX and PPTX before GA |
| ASR ffmpeg/provider/package drift | GREEN for unit/source | ASR focused tests cover packaged ffmpeg resolver, Azure seed, native fallback, and actionable no-Whisper error | repo tests | Codex + test-engineer sidecar | Config/key values not printed | Installed ASR smoke still required; cloud ASR seed required for high-quality GA |
| Windows package artifacts | GREEN | Clean VM installed-app probe confirmed app exe, `app.asar`, `playwright-core`, `ffmpeg.exe`, `WinSpeechRecognize.exe`, cloud gateway seed, Azure Speech example, Desktop shortcut, and Start Menu shortcut | `C:\Users\clawxtest\Downloads\clawx-vm-smoke-20260622-205920\install-artifacts.json` | Codex + Build Lead sidecar | `.key` file contents and hashes not printed | Azure Speech real seed not included in local artifact |
| Clean Windows install / VM smoke | GREEN for install/package smoke | Installer SHA matched `3a43cdff49c758b07ccfd57117a06304152813a7b80d857ba99c03486fe8f4fa`; uninstall exit `0`; install exit `0`; artifact probe passed; native ASR smoke exit `0`; Office runtime ready | VM `clawx-win-rc-20260609`, smoke root `C:\Users\clawxtest\Downloads\clawx-vm-smoke-20260622-205920` | Codex | No passwords printed | Signed-in Microsoft tenant proof remains required for GA |
| Online model/Gateway path | GREEN for installed gateway readiness | Initial direct gateway probe timed out with 25s wait; rerun with 180s wait completed, gateway ready in 12.0s, model `custom-moecloud/moe-demo-pro`; installed Electron probe also showed `GATEWAY_PORT_READY=True` | `C:\Users\Public\Downloads\clawx-installed-gateway-smoke-20260623-012219` and `C:\Users\Public\Downloads\clawx-cdp-smoke-20260623-011835` | Codex | Gateway key not printed | Live chat transcript through signed-in tester profile still required before GA |
| Secrets audit | YELLOW | `.gitignore` covers Azure seed/key; package probe reports secret metadata only | repo diff | Codex | No secrets printed | Run final `git grep` before commit/publish |
| Process/agent repeatability | GREEN for source | `ga-e2e-regression` skill mirrored across `.agents`, `.codex`, `.claude`; verifier agents added | repo files | Codex + Release Lead sidecar | No secrets printed | Run process contract test |

## 2026-06-23 Windows VM Smoke Notes

- Fresh install package smoke is suitable for prerelease publication.
- GA remains `YELLOW`, not `GREEN`, because the clean VM has no signed-in Microsoft tenant profile.
- Forms preview reached Microsoft sign-in and returned a clear sign-in-required reason instead of silently failing.
- Outlook no-send/no-download safety gates refused unsafe actions without confirmation.
- No real email send, attachment download, or Forms submit was executed.
- The standalone gateway smoke script default timeout was raised from 25 seconds to 150 seconds after the installed app proved first-start readiness can exceed the old smoke window on a busy VM.

## Evidence Update Rules

- Use exact commands and pass counts.
- Use artifact paths instead of copying logs wholesale.
- Redact or omit provider keys, passwords, Host API tokens, private Forms URLs, email bodies, full recipient lists, and key-file hashes.
- Mark live Microsoft sends/submits as `not run` unless explicitly confirmed in the same session.
- If a test cannot run, record the blocker and the next safe command.
