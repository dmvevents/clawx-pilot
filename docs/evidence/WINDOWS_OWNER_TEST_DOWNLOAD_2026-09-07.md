# Windows owner test download — September 7, 2026

The owner requested an immediate Windows download for personal testing and the same Google Storage route previously used with Karunesh. This is a diagnostic distribution of the existing moe.21 artifact. GA remains RED; this does not establish external tester acceptance or a published GitHub release.

## Artifact

- Source: `34e951dc9d986ce82ef44396d440e9a02bc35242`, keyless-public.
- Native build: [34134725489](https://github.com/dmvevents/clawx-pilot/actions/runs/34134725489).
- File: `Ministry of Education-0.4.3-moe.21-win-x64.exe`, 359,123,558 bytes.
- SHA256: `d0da3062156e2faaac1df5967f03710736693f8fc7571adfccf254865579b00f`.
- GCS: `gs://clawx-rc-artifacts-622687731621/moe21-owner-test-20260907/Ministry of Education-0.4.3-moe.21-win-x64.exe`.
- Download verification at `2026-09-07T17:28:21Z`: anonymous signed GET returned HTTP 200; all 359,123,558 bytes matched the SHA256 above and the PE `MZ` signature. Link expiry: `2026-09-08T04:27:21Z` (08:27 Dubai). Private machine report: `/tmp/clawx-owner-test-20260907/verification.json`.
- Existing private bucket permissions retained. An 11-hour signed GET URL was generated; the URL is private and is not stored in git.
- Known limits: missing FFmpeg, installed on-device failure, rejected PDF-title/image journeys, and unproved Microsoft tenant flows. Ordinary Online chat passed on the configured VM; a new machine still needs separately supplied Online provisioning or a prepared local model runtime.

## Karunesh intake

Read at approximately 17:26 UTC on September 7 through the configured WhatsApp bridge's SQLite databases opened with `mode=ro`; no callable WhatsApp MCP is exposed in this Codex session. Contact identity was checked against `whatsmeow_contacts` and `whatsmeow_lid_map`, then the resolved privacy thread was read. The message store's latest timestamp was 17:16:22 UTC; this does not prove complete contact synchronization.

- September 7, 09:31:29 Trinidad time / 13:31:29 UTC: Karunesh asked whether the email connection issue had been fixed. Locator: message `3EB0D0A83A9849F00D2618`.
- September 7, 09:46:46 Trinidad time: the owner said a download would follow shortly; Karunesh agreed to the timing at 09:47:18. Locators: `3AB347B8A3ED27B27BB6`, `3EB0D0A1E30155710968DD`.
- September 7, 12:55:53 Trinidad time / 16:55:53 UTC: the owner's latest outbound said the download was about to be sent. Locator: `3B404FE21AB177C90726`. No subsequent download message was present in this read.
- September 4 remains the latest detailed defect report: Chrome/Outlook automation still failed after installing the Chrome MCP. September 3 file-interaction feedback was positive for what Karunesh tested. This is scoped historical feedback, not moe.21 acceptance.
- The previous handoff used an impersonated 11-hour Google Storage signed URL. No new stakeholder message, media download, email send or form submission occurred in this continuation.

The active defect remains CLWX-73; the immediate handoff belongs to CLWX-107. The new September 7 inbound supersedes the earlier completion-plan statement that relevant tester activity ended September 4.

## moe.22 build repair

[Run 34146007001](https://github.com/dmvevents/clawx-pilot/actions/runs/34146007001) from public source `94b38aa81ba256b432537fe111ac3191cc98f1ed` failed preflight on September 7 at 17:08:59 UTC. 203 test files / 2,096 tests passed, one test failed and 11 skipped. No installer was produced. The archive-success FFmpeg fixture attempted to execute inert bytes on Windows; production helper validation was not the failure.

The fixture correction is preserved in the existing moe.22 worktree, authored by a bounded Windows build agent and reviewed by root. It explicitly covers darwin/linux/win32 process boundaries and asserts that setup rejects a failed native functional check. `pnpm exec vitest run tests/unit/download-bundled-ffmpeg.test.ts` passed 14 tests on macOS; scoped ESLint and diff checks passed. Production downloader/workflow are unchanged. The subsequent VM development loop reproduced the original failure and passed all 14 corrected tests on Windows. The correction is committed and pushed as `fd678bd6`; a fresh hosted build remains outstanding. See [native development evidence](WINDOWS_VM_DEVELOPMENT_2026-09-07.md). Private patch backup: `/tmp/clawx-owner-test-20260907/ffmpeg-native-fixture.patch`.

## Authorized stakeholder follow-up — 17:31 UTC

After the owner explicitly instructed "You send a message", the verified signed download link was sent to the contact-mapped Karunesh privacy thread. The message identified moe.21 as a test build, included the Trinidad-time expiry, known voice/video and on-device issues, Online setup requirements, and requested email-access/draft and file retests without a real send/submit.

The configured WhatsApp bridge returned HTTP 200 and `success:true` at `2026-09-07T17:31:43Z`. Local thread readback and recipient delivery/read receipt were unavailable; no duplicate send was attempted. The bridge send implementation waits for WhatsApp SendMessage but does not explicitly persist the outgoing message in the local message table. This is send-acceptance evidence, not external tester acceptance or proof that the email issue is fixed.

Private receipt: `/tmp/clawx-owner-test-20260907/karunesh-send.json`. Redacted sent record: `~/openclaw-agent/outbound-sent/2026-09-07-karunesh-moe21-test-download-SENT.md`. No signed URL is committed.
