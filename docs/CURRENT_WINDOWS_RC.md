# Current Windows RC

Last updated: 2026-06-23.

## Current Candidate

| Field | Value |
|---|---|
| Branch | `release/moe10-windows-laptop-ready-20260529` |
| Installer source commit | GitHub release tag target commit |
| GitHub prerelease tag | `moe10-windows-rc-20260623-email-draft-fix` |
| Installer | `release/Ministry of Education-0.4.3-moe.10-win-x64.exe` |
| Installer SHA256 | `e35ee6cda63a942a585b0638831487562d66a0901b006cf2ccadfe81b0e6f182` |
| Blockmap SHA256 | `9ac78ae72aa6fd671ac044351f8b796dbc3d263d78f7bde5a39d4946c858f2b2` |
| App ASAR SHA256 | `9f8c9b0c90d4ff8a3a3a0a59e244504531247d8425a19f30d109d4250a8e3f96` |
| GCS staging prefix | Not staged |
| Release page | `https://github.com/dmvevents/clawx-pilot/releases/tag/moe10-windows-rc-20260623-email-draft-fix` |
| Evidence manifest | `docs/GA_RELEASE_EVIDENCE_MANIFEST.md` |
| GA plan | `docs/GA_RELEASE_PLAN_2026-06-09.md` |
| Current verdict | `YELLOW - email draft/reply prerelease candidate rebuilt locally; local Electron/Chrome email regression gates passed and the installer is ready for upload, but installed-app Windows proof is still pending` |

## Staleness Warning

The installer snapshot above was rebuilt locally on 2026-06-23 after the Outlook reply/reply-all/forward field-targeting and draft-cleanup pass. It includes the earlier inbox/date/sign-in hardening, archive-adjacent Reply guard, bounded Inbox search contract, and the new ClawX-marker-scoped cleanup proof so automated no-send tests do not keep leaving open compose drafts. Local package inspection, full `pnpm test`, typecheck, lint, harness CI, package-owner runtime tests, and local signed-in Electron/Chrome CDP email probes passed. VM installed-app proof remains pending for this exact asset. Hidden WinRM silent install is a diagnostic-only path and must not be used as GA proof.

## Post-Asset Source Evidence

Before rebuilding the candidate above, a local signed-in Outlook CDP probe was run against the user's Chrome tab at `https://outlook.cloud.microsoft/mail/`. The source browser-manager path returned `open=opened`, `readInbox(5)=ok`, and a widened 12-row Inbox window where the June filter returned 10 rows, the May filter returned 2 rows, and the Raj sender filter returned 2 rows, all with `scan.exhaustive=false`.

The current Electron/Chrome no-send matrix was then run through the app Host API against signed-in Outlook and passed compose, reply, reply-all, and forward: the probe observed `/api/outlook/read-inbox`, two `/api/outlook/reply` calls, and `/api/outlook/forward`; every draft body was in the compose body, not the recipient fields; no `/api/outlook/send` call was made; and the ClawX test draft cleanup closed its own test drafts. Evidence path: `/tmp/clawx-email-live-20260623-fresh-main/clawx-electron-probe-2026-06-23T08-07-01-396Z.json`. A post-run hygiene check found `openCompose=0`; the visible Drafts count stayed at `[8]`, meaning the validation run did not add open compose drafts.

This is now packaged in the `email-draft-fix` installer above. Installed-app VM proof is still required before the email gate can move from local/package proof to Windows proof. The current blocker is the unsupported hidden WinRM silent installer path, not a failing Outlook regression test.

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
- Current prerelease notes: `windows-pilot/plans/MOE_WINDOWS_RC_2026-06-23_EMAIL_FIX_RELEASE_NOTES.md`
- Current user instructions: `windows-pilot/plans/MOE_WINDOWS_RC_2026-06-23_EMAIL_FIX_USER_INSTRUCTIONS.md`
- New regression process: `.agents/skills/ga-e2e-regression/SKILL.md`
