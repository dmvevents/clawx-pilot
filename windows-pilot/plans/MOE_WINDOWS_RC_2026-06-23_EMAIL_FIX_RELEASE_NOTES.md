# MoE Windows RC 2026-06-23 Outlook Green

Tag: `moe10-windows-rc-20260623-outlook-green-b38b620`

Source commit: `b38b6208218b2d84d5cade55890fda0f8c5489e9`

GitHub Actions package run: `28034003516`

Installer:

- `Ministry.of.Education-0.4.3-moe.10-win-x64.exe`
- SHA256: `a19a9c62eaacd958df772b432277dd220a38e61e5f0e69b449ee6b66ef00c6ee`
- Size: `300576812` bytes

Blockmap:

- `Ministry.of.Education-0.4.3-moe.10-win-x64.exe.blockmap`
- SHA256: `cadd21e35608817dcc099239141a65ee640b6582e2b154bac40340d7befff6a6`

## What Changed

- Outlook Inbox-scoped actions now return a clear `needs_signin` result if Microsoft redirects to an auth shell while the tool is normalizing back to Inbox.
- Outlook sign-in detection no longer treats ordinary email text that mentions "sign in" as proof that the user is signed out.
- Outlook date filtering now parses Outlook Web display dates such as `Tue 9 Jun`, `Fri 19 Jun`, `Mon 9:32 AM`, `6/10`, and time-only rows using the current/recent year.
- The model-facing bounded-search contract remains intact: browser/CDP search results must not be described as all mailbox mail unless `scan.exhaustive` is true.
- Reply, reply-all, and forward now verify that the requested body text landed in the compose body and not in the To/Cc/Bcc fields, including short replies such as `OK` or `yes`.
- Outlook recipient validation now refuses prose/body text in To/Cc/Bcc and canonicalizes recipient email inputs.
- The send path now refuses success if the reviewed draft remains open or if matching content remains in Drafts after clicking Send.
- The Electron CDP regression harness now recognizes `outlook.cloud.microsoft` pages, cleans only its own ClawX-marked validation drafts, and fails if automated test compose windows remain open.
- The send matrix now requires Host API evidence for compose, reply, reply-all, forward, and reviewed sends, then verifies Sent Items marker presence and Drafts marker absence.

## Validation

- Local signed-in Chrome CDP source smoke: `open=opened`, `readInbox(5)=ok`.
- Local read-only Outlook probe: 12 recent Inbox rows scanned; June filter returned 10 rows; May filter returned 2 rows; Raj sender filter returned 2 rows; all marked `scan.exhaustive=false`.
- Local Electron Host API safe smoke passed with `eventCount=0`.
- Local Electron Host API controlled send matrix passed: compose, reply, reply-all, and forward were sent after review/confirm gates; body text was in compose bodies and not recipient fields; observed Host API paths included read-inbox, reply, forward, draft, and send; markers appeared in Sent Items and did not remain in Drafts.
- Local Electron Host API state matrix passed for Inbox, Sent, Drafts, Archive, Search, and opened-message states.
- Focused Outlook/plugin/probe slice: 139 tests passed.
- Package-owner runtime checks: 70 tests passed.
- Package inspection/probe checks after build: 53 tests passed.
- Full unit suite: 148 files passed, 1133 tests passed, 5 skipped.
- `pnpm run typecheck` passed.
- `pnpm run lint:check` passed with existing warnings only.
- `pnpm run harness:ci` passed.
- `git diff --check` passed.
- GitHub Actions Windows package workflow passed from source commit `b38b6208218b2d84d5cade55890fda0f8c5489e9`.

## Safety

- Controlled test emails were sent only after same-session authorization.
- No attachment was downloaded.
- No Microsoft Forms flow was changed or submitted.

## Remaining Release Proof

This release is a prerelease candidate. Installed-app VM or physical laptop email proof is still required against this exact installer hash. Do not call GA until a signed-in Windows installed-app path proves Outlook open/read/search/compose/send/reply/reply-all/forward safety.
