# Current Windows RC

Last updated: 2026-06-23.

## Current Candidate

| Field | Value |
|---|---|
| Branch | `release/moe10-windows-laptop-ready-20260529` |
| Installer source commit | `42787c6243eba88f436b43f84df8d66aa60d5683` |
| GitHub prerelease tag | `moe10-windows-rc-20260623-stable-regression` |
| Installer | `release/Ministry of Education-0.4.3-moe.10-win-x64.exe` |
| Installer SHA256 | `0ad45db3d1a405c47f8105720099beca220e99fb2e81c69cebb3c45b6622100e` |
| Blockmap SHA256 | `0e2bc93dd063262bc1c371699601a4e8e6447a9a6445b0fca355ee74c0d274ab` |
| App ASAR SHA256 | `d8b439f157527d2bac5d144fcd261e13294cb11a50b3b800b1ab8429a8c9a0cb` |
| GCS staging prefix | superseded by GitHub release asset for this refresh |
| Release page | `https://github.com/dmvevents/clawx-pilot/releases/tag/moe10-windows-rc-20260623-stable-regression` |
| Evidence manifest | `docs/GA_RELEASE_EVIDENCE_MANIFEST.md` |
| GA plan | `docs/GA_RELEASE_PLAN_2026-06-09.md` |
| Current verdict | `YELLOW - prerelease candidate; refreshed installer package/regression checks passed locally, clean VM smoke must be rerun for this exact hash, hidden WinRM silent install is red, signed-in tenant Outlook/Forms proof still required before GA` |

## Staleness Warning

The installer snapshot above was rebuilt on 2026-06-23 from `42787c6243eba88f436b43f84df8d66aa60d5683` and supersedes the earlier `3a43cdff49c758b07ccfd57117a06304152813a7b80d857ba99c03486fe8f4fa` GitHub asset. Local package inspection and the focused 107-test release regression slice passed after the rebuild. RM/VM download verification passed for this exact GitHub asset, but the VM installed tree is still stale or partial; clean installed-app smoke must be rerun after a normal assisted desktop install. The Mac laptop watcher now refuses hidden silent install by default when the installed app is stale or missing. This is still a prerelease until signed-in tenant Outlook/Forms flows are proven through the installed app.

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
