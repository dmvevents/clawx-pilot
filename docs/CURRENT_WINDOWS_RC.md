# Current Windows RC

Last updated: 2026-06-23.

## Current Candidate

| Field | Value |
|---|---|
| Branch | `release/moe10-windows-laptop-ready-20260529` |
| Installer source commit | release tag target |
| GitHub prerelease tag | `moe10-windows-rc-20260623-outlook-reply-fix` |
| Installer | `release/Ministry of Education-0.4.3-moe.10-win-x64.exe` |
| Installer SHA256 | `2e189dd004995d6ce18e9e240f8228ba5039c2e384fd479a597137458a9046cf` |
| Blockmap SHA256 | `8863ef90aff9a8ab804a9e39c58b20c9a480f67f888b01829d56b3be2e0ea132` |
| App ASAR SHA256 | `a67a1f3f518c2bbeccac1adf306e780762a12a421f07205c8c001b65df2bc7f7` |
| GCS staging prefix | not used; GitHub release asset is the distribution source |
| Release page | `https://github.com/dmvevents/clawx-pilot/releases/tag/moe10-windows-rc-20260623-outlook-reply-fix` |
| Evidence manifest | `docs/GA_RELEASE_EVIDENCE_MANIFEST.md` |
| GA plan | `docs/GA_RELEASE_PLAN_2026-06-09.md` |
| Current verdict | `YELLOW - prerelease candidate; Outlook reply/body regressions fixed and local release gates passed, VM installed-app Outlook/Forms smoke must still pass for this exact hash before GA` |

## Staleness Warning

The installer snapshot above was rebuilt on 2026-06-23 after the Outlook reply regressions reported by testers: reply-body text could land in `To:` and reply discovery could click a neighboring destructive command such as Archive. Local package inspection, the focused 101-test Outlook release slice, full `pnpm test`, typecheck, lint, and harness CI passed after the rebuild. VM runner scripts were refreshed with the Outlook state-matrix probe, but the VM installed-app smoke must still be rerun against this exact GitHub asset before GA. This is still a prerelease until signed-in tenant Outlook/Forms flows are proven through the installed app.

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
