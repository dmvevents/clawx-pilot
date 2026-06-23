# Current Windows RC

Last updated: 2026-06-23.

## Current Candidate

| Field | Value |
|---|---|
| Branch | `release/moe10-windows-laptop-ready-20260529` |
| Installer source commit | `ea72db2` |
| GitHub prerelease tag | `moe10-windows-rc-20260623-outlook-reply-fix` |
| Installer | `release/Ministry of Education-0.4.3-moe.10-win-x64.exe` |
| Installer SHA256 | `dbd252612b23c81f0061b8ec16063cee6fda3b94d834e881d4a6c83b503a0ea3` |
| Blockmap SHA256 | `9865b8acf84654590d866203346be48d295990e69b0eb437e723434e9db90fd1` |
| App ASAR SHA256 | `86604ddfd338f6baf7a9dd3d2524e84e68fbaa5fb697bb7a5af820965e0eb3a9` |
| GCS staging prefix | not used; GitHub release asset is the distribution source |
| Release page | `https://github.com/dmvevents/clawx-pilot/releases/tag/moe10-windows-rc-20260623-outlook-reply-fix` |
| Evidence manifest | `docs/GA_RELEASE_EVIDENCE_MANIFEST.md` |
| GA plan | `docs/GA_RELEASE_PLAN_2026-06-09.md` |
| Current verdict | `YELLOW - prerelease candidate uploaded; Outlook reply/body regressions fixed and local release gates passed, VM installed-app Outlook/Forms smoke must still pass for this exact hash before GA` |

## Staleness Warning

The installer snapshot above was rebuilt and uploaded to the GitHub prerelease on 2026-06-23 after the Outlook reply regressions reported by testers: reply-body text could land in `To:`, reviewed reply sends could fail when Outlook hid the inline reply subject, and reply discovery could click a neighboring destructive command such as Archive. Local package inspection, the focused 92-test Outlook/plugin/probe release slice, full `pnpm test`, typecheck, lint, and harness CI passed after the rebuild. The packaged `app.asar` contains the new reply body verification guard that refuses to claim success when requested reply text is found in recipient fields. VM runner scripts were refreshed with the Outlook state-matrix probe, but the VM installed-app smoke must still be rerun against this exact GitHub asset before GA. This is still a prerelease until signed-in tenant Outlook/Forms flows are proven through the installed app.

## Post-Asset Source Evidence

After the GitHub asset above, a local signed-in Outlook CDP probe was run against the user's Chrome tab at `https://outlook.cloud.microsoft/mail/`. The source browser-manager path returned `open=opened`, `readInbox(5)=ok`, and a widened 12-row Inbox window where the June filter returned 10 rows, the May filter returned 2 rows, and the Raj sender filter returned 2 rows, all with `scan.exhaustive=false`. The same source tree passed the 127-test focused Outlook/plugin/probe slice, full `pnpm test` with 147 files / 1091 passed / 5 skipped, `pnpm run typecheck`, `pnpm run lint`, and `git diff --check`.

This is source/no-install evidence only. The release page still points to the installer snapshot in the table above until a new Windows package is built, uploaded, and installed-app smoked.

## Do Not Call GA Until

- `docs/GA_RELEASE_EVIDENCE_MANIFEST.md` has fresh `GREEN` or accepted `YELLOW` rows for every release-critical gate.
- A clean Windows VM or laptop install launches from the desktop shortcut and proves Gateway, Host API, Electron CDP, packaged runtime artifacts, online model path, and signed-in Microsoft tenant context.
- Outlook read/draft/reviewed-send safety and Forms preview/no-submit safety are proven through the installed app path with signed-in Microsoft context.
- Excel/Word/PDF and any demo PowerPoint workflow have installed-app chat evidence, not only source/package generated-file evidence.
- ASR has either an installed smoke with high-quality Azure Speech seed or a documented best-effort deferral.
- Final secret grep and package probe do not expose key contents, key hashes, provider credentials, Host tokens, private Forms URLs, email bodies, or full recipient lists.

## Release Notes Pointers

- Current GA status baseline: `windows-pilot/plans/MOE_WINDOWS_GA_STATUS_2026-06-10.md`
- Last public prerelease notes: `windows-pilot/plans/MOE_WINDOWS_RC_2026-06-10_RELEASE_NOTES.md`
- User instructions baseline: `windows-pilot/plans/MOE_WINDOWS_RC_2026-06-10_USER_INSTRUCTIONS.md`
- Current prerelease notes: `windows-pilot/plans/MOE_WINDOWS_RC_2026-06-23_RELEASE_NOTES.md`
- Current user instructions: `windows-pilot/plans/MOE_WINDOWS_RC_2026-06-23_USER_INSTRUCTIONS.md`
- New regression process: `.agents/skills/ga-e2e-regression/SKILL.md`
