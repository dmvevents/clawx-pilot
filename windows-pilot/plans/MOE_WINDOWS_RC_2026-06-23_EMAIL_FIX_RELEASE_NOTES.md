# MoE Windows RC 2026-06-23 Email Draft Fix

Tag: `moe10-windows-rc-20260623-email-draft-fix`

Source commit: GitHub release tag target commit

Installer:

- `Ministry.of.Education-0.4.3-moe.10-win-x64.exe`
- SHA256: `e35ee6cda63a942a585b0638831487562d66a0901b006cf2ccadfe81b0e6f182`
- Size: `390068457` bytes

Blockmap:

- `Ministry.of.Education-0.4.3-moe.10-win-x64.exe.blockmap`
- SHA256: `9ac78ae72aa6fd671ac044351f8b796dbc3d263d78f7bde5a39d4946c858f2b2`

## What Changed

- Outlook Inbox-scoped actions now return a clear `needs_signin` result if Microsoft redirects to an auth shell while the tool is normalizing back to Inbox.
- Outlook sign-in detection no longer treats ordinary email text that mentions "sign in" as proof that the user is signed out.
- Outlook date filtering now parses Outlook Web display dates such as `Tue 9 Jun`, `Fri 19 Jun`, `Mon 9:32 AM`, `6/10`, and time-only rows using the current/recent year.
- The model-facing bounded-search contract remains intact: browser/CDP search results must not be described as all mailbox mail unless `scan.exhaustive` is true.
- Reply, reply-all, and forward now verify that the requested body text landed in the compose body and not in the To/Cc/Bcc fields, including short replies such as `OK` or `yes`.
- The Electron CDP regression harness now recognizes `outlook.cloud.microsoft` pages and cleans only its own ClawX-marked no-send validation drafts. It no longer reports success while leaving automated test compose windows open.
- The reply matrix now requires Host API evidence for read-inbox, reply, reply-all, and forward, and fails if a send route is observed during no-send validation.

## Validation

- Local signed-in Chrome CDP source smoke: `open=opened`, `readInbox(5)=ok`.
- Local read-only Outlook probe: 12 recent Inbox rows scanned; June filter returned 10 rows; May filter returned 2 rows; Raj sender filter returned 2 rows; all marked `scan.exhaustive=false`.
- Local Electron Host API no-send matrix: compose, reply, reply-all, and forward passed; body text was in compose bodies and not recipient fields; observed Host API paths included read-inbox, reply, reply-all, and forward; no send route was observed.
- Post-run draft hygiene: `openCompose=0`; the visible Drafts count stayed `[8]`, so the validation run did not add open compose drafts.
- Focused Outlook/plugin/probe slice: 139 tests passed.
- Package-owner runtime checks: 70 tests passed.
- Package inspection/probe checks after build: 53 tests passed.
- Full unit suite: 148 files passed, 1115 tests passed, 5 skipped.
- `pnpm run typecheck` passed.
- `pnpm run lint:check` passed with existing warnings only.
- `pnpm run harness:ci` passed.
- `git diff --check` passed.
- Windows package build passed with the Windows runtime dependency `playwright-core`, Office parsers, Windows Node/uv/ffmpeg, `WinSpeechRecognize.exe`, MoE extension, Microsoft Graph extension, cloud gateway seed files, and no `app-update.yml`.

## Safety

- No email was sent.
- No reply or forward was sent.
- No attachment was downloaded.
- No Microsoft Forms flow was changed or submitted.

## Remaining Release Proof

This release is a prerelease candidate. Installed-app VM or physical laptop email proof is still required against this exact installer hash. Do not call GA until a signed-in Windows installed-app path proves Outlook open/read/search/reply-draft/no-send safety.
