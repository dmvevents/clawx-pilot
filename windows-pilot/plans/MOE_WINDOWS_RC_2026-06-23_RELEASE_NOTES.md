# MoE Windows RC 2026-06-23

Windows prerelease refresh for the Ministry of Education principal assistant.

## Release Page

```text
https://github.com/dmvevents/clawx-pilot/releases/tag/moe10-windows-rc-20260623-outlook-reply-fix
```

Use the attached installer asset:

```text
Ministry.of.Education-0.4.3-moe.10-win-x64.exe
```

Do not use the GitHub source code zip or tar.gz files for app testing.

## Assets

- `Ministry.of.Education-0.4.3-moe.10-win-x64.exe`
  - SHA-256: `dbd252612b23c81f0061b8ec16063cee6fda3b94d834e881d4a6c83b503a0ea3`
- `Ministry.of.Education-0.4.3-moe.10-win-x64.exe.blockmap`
  - SHA-256: `9865b8acf84654590d866203346be48d295990e69b0eb437e723434e9db90fd1`
- `MOE_WINDOWS_RC_2026-06-23_USER_INSTRUCTIONS.md`
  - Tester instructions for install, first launch, Microsoft sign-in, Outlook,
    Forms, files, voice input, and support evidence.
- `GA_RELEASE_EVIDENCE_MANIFEST.md`
  - Current release gate evidence and remaining GA gaps.
- `CURRENT_WINDOWS_RC.md`
  - Current installer hash, staging pointer, and GA verdict.

## What Changed Since 2026-06-10

- Outlook reviewed-draft sending now supports the intended confirm-only flow:
  after the principal reviews a draft, the assistant should call send with
  `confirm:true`; optional recipient/subject/body values are assertions, not
  required re-entry.
- Reply and forward actions avoid unsafe global-toolbar fallback when a message
  is open but the expected reading-pane button is not uniquely available. This
  is intended to reduce archive/reply misclick regressions.
- Reply body filling now verifies that text landed in the compose body, rejects
  any draft where reply text appears in recipient fields, and refuses the VLM
  body fallback before typing if Outlook focus is on `To`, `Cc`, `Bcc`, or
  `Subject`.
- The Windows VM smoke harness now includes an Outlook state matrix for Inbox,
  Sent, Drafts, Archive, Search, and opened-message starting states.
- Inbox reads are pinned to the Inbox folder for Microsoft Graph and browser
  paths instead of drifting to Sent Items or other folders.
- The model-facing Outlook guidance no longer tells users to install Chrome
  MCP, enable Chrome remote debugging, or open `chrome://flags`.
- Windows ASR packaging now resolves bundled `ffmpeg.exe` and the native
  `WinSpeechRecognize.exe` helper before falling back to optional developer
  tools.
- Azure Speech seed support is ready for higher-quality ASR builds when release
  secrets are supplied through the package workflow.
- GA process skills and verifier agents were added across Codex, Claude Code,
  and `.agents` surfaces so regression testing is repeatable.
- The Mac laptop watcher no longer treats stale or missing installed app files
  as permission to run hidden silent install automation. It stops with a clear
  assisted-install-required state unless `ALLOW_SILENT_INSTALL=1` is set for an
  explicit diagnostic run.

## Validation

- `pnpm test`
  - Result: 147 files, 1085 passed, 5 skipped.
- `pnpm run typecheck`
  - Passed.
- `pnpm run lint`
  - Exit 0 with known existing warnings.
- Windows package rebuild
  - Passed.
- Refreshed Windows installer rebuild on 2026-06-23
  - Source commit: `ea72db2`.
  - Installer SHA-256: `dbd252612b23c81f0061b8ec16063cee6fda3b94d834e881d4a6c83b503a0ea3`.
  - Blockmap SHA-256: `9865b8acf84654590d866203346be48d295990e69b0eb437e723434e9db90fd1`.
  - App ASAR SHA-256: `86604ddfd338f6baf7a9dd3d2524e84e68fbaa5fb697bb7a5af820965e0eb3a9`.
  - Package inspection after rebuild passed: 13 tests.
  - Focused Outlook/plugin/probe release regression after rebuild passed: 3 files, 92 tests.
  - Full unit suite passed: 147 files, 1085 tests, 5 skipped.
  - Harness CI passed.
  - VM installed-app smoke for this refreshed hash is pending.
- Clean Windows VM install/package smoke
  - Previous installer SHA matched the superseded `2e189dd...` asset.
  - Previous app uninstall exit `0`.
  - Installer exit `0`.
  - Desktop and Start Menu shortcuts present.
  - Packaged `playwright-core`, `ffmpeg.exe`, `WinSpeechRecognize.exe`, cloud
    gateway seed, and Azure Speech example present.
  - Native Windows ASR smoke exit `0`.
  - Office runtime dependency check passed for Excel/Word/PDF libraries.
  - Installed gateway readiness passed on rerun with realistic timeout.
  - Installed Electron app exposed Electron CDP, Host API, and Gateway port.
- Hidden WinRM silent-install automation
  - A separate fresh temp-user VM run against the earlier installer reproduced a
    hidden `/S /currentuser` automation failure: the installer created a large
    partial tree but did not create the app exe or critical runtime helper
    files.
  - Treat hidden silent install as a diagnostic automation path only. Tester
    installs should use the normal assisted Windows installer screens.
  - The Mac watcher regression guard passed: hidden silent install is opt-in
    only, uses the 1800-second diagnostic timeout, and emits diagnostic-only
    state when forced.
- Focused release regression slice after the watcher guard
  - `pnpm exec vitest run tests/unit/windows-pilot-chat-scenarios.test.ts tests/unit/windows-pilot-electron-cdp-probe.test.ts tests/unit/outlook-inbox-windowing.test.ts tests/unit/outlook-actions-safety.test.ts tests/unit/forms-browser-submit-gate.test.ts tests/unit/windows-package-inspection.test.ts`
  - Result: 6 files, 107 tests passed.
- Safety smoke
  - Email send without confirmation refused.
  - Attachment download without confirmation refused.
  - Forms submit without confirmation refused.

## Current Status

Verdict: `YELLOW - prerelease`.

This build is suitable for tester prerelease download from the GitHub release
asset. It is not GA yet.

Remaining GA gaps:

- Signed-in Microsoft tenant proof is still required for live Outlook reply/send
  and Forms preview/fill behavior.
- The clean VM Forms probe reached Microsoft sign-in, which is expected without
  a signed-in tenant profile.
- Unattended hidden WinRM `/S /currentuser` install is not release-supported
  until the NSIS silent path is fixed or replaced by an assisted desktop/RDP
  install proof.
- Real email sends and real Forms submits were not executed during this smoke.
- High-quality Azure Speech ASR requires the release workflow secret seed.
- PowerPoint generated-file checks exist in the package/runtime smoke; full
  PowerPoint creation through installed app chat remains a follow-up gate.
