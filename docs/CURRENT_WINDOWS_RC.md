# Current Windows RC

Last updated: 2026-06-23.

## Current Candidate

| Field | Value |
|---|---|
| Branch | `release/moe10-windows-laptop-ready-20260529` |
| Source commit at last local artifact snapshot | Pending GitHub prerelease publication; tag target is authoritative |
| Installer | `release/Ministry of Education-0.4.3-moe.10-win-x64.exe` |
| Installer SHA256 | `3a43cdff49c758b07ccfd57117a06304152813a7b80d857ba99c03486fe8f4fa` |
| Blockmap SHA256 | `dfeacd98465081df7c0da0494dede0b881f673af916f6da5661439880a68e817` |
| App ASAR SHA256 | `ee749bc6b05e56cc4ffbc6faba6436bf51cd23c02a3d86ed5a87a14d3bac1421` |
| GCS staging prefix | `gs://clawx-rc-artifacts-622687731621/rc-local-20260622-stable-regression-candidate/` |
| Planned GitHub prerelease tag | `moe10-windows-rc-20260623-stable-regression` |
| Evidence manifest | `docs/GA_RELEASE_EVIDENCE_MANIFEST.md` |
| GA plan | `docs/GA_RELEASE_PLAN_2026-06-09.md` |
| Current verdict | `YELLOW - prerelease candidate; assisted clean Windows install/package smoke passed, hidden WinRM silent install is red, signed-in tenant Outlook/Forms proof still required before GA` |

## Staleness Warning

The local installer snapshot above includes the latest process/test, ASR package, and Outlook reply-safety edits. The clean Windows VM package smoke passed on 2026-06-23, and the Mac laptop watcher now refuses hidden silent install by default when the installed app is stale or missing. This is still a prerelease until signed-in tenant Outlook/Forms flows are proven through the installed app.

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
