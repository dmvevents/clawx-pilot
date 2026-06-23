# MoE Windows RC 2026-06-23

Windows prerelease refresh for the Ministry of Education principal assistant.

## Release Page

```text
https://github.com/dmvevents/clawx-pilot/releases/tag/moe10-windows-rc-20260623-stable-regression
```

Use the attached installer asset:

```text
Ministry.of.Education-0.4.3-moe.10-win-x64.exe
```

Do not use the GitHub source code zip or tar.gz files for app testing.

## Assets

- `Ministry.of.Education-0.4.3-moe.10-win-x64.exe`
  - SHA-256: `3a43cdff49c758b07ccfd57117a06304152813a7b80d857ba99c03486fe8f4fa`
- `Ministry.of.Education-0.4.3-moe.10-win-x64.exe.blockmap`
  - SHA-256: `dfeacd98465081df7c0da0494dede0b881f673af916f6da5661439880a68e817`
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

## Validation

- `pnpm test`
  - Result: 147 files, 1054 passed, 5 skipped.
- `pnpm run typecheck`
  - Passed.
- `pnpm run lint`
  - Exit 0 with known existing warnings.
- Windows package rebuild
  - Passed.
- Clean Windows VM install/package smoke
  - Installer SHA matched.
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
  - A separate fresh temp-user VM run against the same installer reproduced a
    hidden `/S /currentuser` automation failure: the installer created a large
    partial tree but did not create the app exe or critical runtime helper
    files.
  - Treat hidden silent install as a diagnostic automation path only. Tester
    installs should use the normal assisted Windows installer screens.
- Safety smoke
  - Email send without confirmation refused.
  - Attachment download without confirmation refused.
  - Forms submit without confirmation refused.

## Current Status

Verdict: `YELLOW - prerelease`.

This build is suitable for tester prerelease download. It is not GA yet.

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
