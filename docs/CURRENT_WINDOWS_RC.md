# Current Windows RC

Last updated: 2026-06-23.

## Current Candidate

| Field | Value |
|---|---|
| Branch | `release/moe10-windows-laptop-ready-20260529` |
| Installer source commit | `b38b6208218b2d84d5cade55890fda0f8c5489e9` |
| GitHub prerelease tag | `moe10-windows-rc-20260623-outlook-green-b38b620` |
| Installer | `Ministry.of.Education-0.4.3-moe.10-win-x64.exe` |
| Installer SHA256 | `a19a9c62eaacd958df772b432277dd220a38e61e5f0e69b449ee6b66ef00c6ee` |
| Blockmap SHA256 | `cadd21e35608817dcc099239141a65ee640b6582e2b154bac40340d7befff6a6` |
| App ASAR SHA256 | Not extracted from GitHub Actions NSIS artifact |
| GCS staging prefix | Not staged |
| Release page | `https://github.com/dmvevents/clawx-pilot/releases/tag/moe10-windows-rc-20260623-outlook-green-b38b620` |
| Evidence manifest | `docs/GA_RELEASE_EVIDENCE_MANIFEST.md` |
| GA plan | `docs/GA_RELEASE_PLAN_2026-06-09.md` |
| Current verdict | `YELLOW - Outlook Green prerelease is published from GitHub Actions; source, full unit suite, local Electron/Chrome email send matrix, and package workflow are green, but clean installed Windows proof is still pending` |

## Staleness Warning

The installer snapshot above was built by GitHub Actions run `28034003516` on 2026-06-23 after the Outlook compose/reply/reply-all/forward/send hardening pass. It includes the earlier inbox/date/sign-in hardening, archive-adjacent Reply guard, bounded Inbox search contract, recipient-field validation, body-editor readiness checks, post-send Drafts residue verification, and ClawX-marker-scoped cleanup proof. Full `pnpm test`, typecheck, lint, harness CI, package-owner runtime tests, local signed-in Electron/Chrome CDP email probes, and the GitHub package workflow passed. VM installed-app proof remains pending for this exact asset. Hidden WinRM silent install is a diagnostic-only path and must not be used as GA proof.

## Post-Asset Source Evidence

Before rebuilding the candidate above, a local signed-in Outlook CDP probe was run against the user's Chrome tab at `https://outlook.cloud.microsoft/mail/`. The source browser-manager path returned `open=opened`, `readInbox(5)=ok`, and a widened 12-row Inbox window where the June filter returned 10 rows, the May filter returned 2 rows, and the Raj sender filter returned 2 rows, all with `scan.exhaustive=false`.

The current Electron/Chrome send matrix was run through the app Host API against signed-in Outlook and passed compose, reply, reply-all, and forward. The probe observed `/api/outlook/read-inbox`, two `/api/outlook/reply` calls, `/api/outlook/forward`, `/api/outlook/draft`, and four `/api/outlook/send` calls; every draft body was in the compose body, not the recipient fields; each controlled marker appeared in Sent Items; no matching marker remained in Drafts; and no matching compose remained open. Evidence path: `/tmp/clawx-email-send-matrix-20260623102302/clawx-electron-probe-2026-06-23T14-26-13-166Z.json`.

This is now packaged in the `outlook-green` installer above. Installed-app VM proof is still required before the email gate can move from local/package proof to Windows proof. The current blocker is the unsupported hidden WinRM silent installer path, not a failing Outlook regression test.

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
