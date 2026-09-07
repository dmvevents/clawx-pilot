# Current Windows RC

Reconciled: 2026-09-07. Current readiness and finish order: [COMPLETION_PLAN.md](COMPLETION_PLAN.md).

## Latest recorded candidate

| Field | Value |
|---|---|
| Version | `0.4.3-moe.20` |
| Manifest | [0.4.3-moe.20.json](release-manifests/0.4.3-moe.20.json) |
| Publication | `published:false`; local staging build |
| Installer | `Ministry of Education-0.4.3-moe.20-win-x64.exe`, 433,625,081 bytes |
| Installer SHA256 | `18a8ad0ab6fe7a4fca2dc0704912dc9a07305f1247c3060da2cd7ec14da946f6` |
| App ASAR SHA256 | `b0ff2022a30733b0c8d2b3cb816191c81d9a300da7f9f783ecafb037e8c05f6e` |
| Source | `58d04eb0490d77271e67ff0c711e9d4ec011eef6` plus recorded working diff; `gitDirty:true`, status hash `3c06086e3ac0c0c1d27695dd9139add14cdc75033c30dcec9e7f33ba89da8ac1` |
| Build proof | Source/compiled receipts verified by the builder wrapper; 1,932 unit tests passed, typecheck/lint passed, staged runtime harness passed |
| Installed proof | Interactive Server/admin upgrade exit 0; installed hashes match; 233.6-second first-ready observation without deferred restart; Office helpers pass. Chat FAIL: late duplicate recovery after a cloud answer. See [runtime recovery report](evidence/WINDOWS_RUNTIME_RECOVERY_2026-09-07.md) |
| Mac | No current Mac candidate established; stale moe.10 trees excluded |
| Readiness | **RED for GA/unrestricted pilot**; dirty local staging, reproduced chat recovery defect and incomplete representative/live acceptance |

The historical moe.19 installer/app/manifest were preserved locally. Its [failed Online observation](evidence/WINDOWS_VM_TESTING_2026-09-07.md) remains baseline evidence; it does not describe the new candidate. Match exact hashes, not version labels. Source context records build inputs and does not establish a reproducible build.

The fourth native moe.21 [build attempt](https://github.com/dmvevents/clawx-pilot/actions/runs/34123550898), source `8d477e9ea27eafeb8bf78ceee49c532858209762`, passed all 201 native test files (2,011 tests, 11 platform skips), preflight, compilation and native bundle verification. Seven artifact-runtime rows passed. The remaining `gateway-transport.no-hostapi` row timed out at 120 seconds in the overbroad all-plugin CLI diagnostics path. No moe.21 installer was created. The scoped real-loader correction now passes both focused Windows diagnostics under the unchanged 120-second limit. Current lifecycle/retry source passes 117 focused tests, six Electron interactions and independent review. A complete package and installed-candidate acceptance are still required; see the [completion state vector](completion-state.json).

The following June record is retained for history; it is not the current candidate.

Historical June snapshot, retained for artifact traceability.

## June 23 candidate (historical)

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
| June 23 verdict | `YELLOW - Outlook Green prerelease is published from GitHub Actions; source, full unit suite, local Electron/Chrome email send matrix, and package workflow are green, but clean installed Windows proof is still pending` |

## Staleness Warning

The installer snapshot above was built by GitHub Actions run `28034003516` on 2026-06-23 after the Outlook compose/reply/reply-all/forward/send hardening pass. It includes the earlier inbox/date/sign-in hardening, archive-adjacent Reply guard, bounded Inbox search contract, recipient-field validation, body-editor readiness checks, post-send Drafts residue verification, and ClawX-marker-scoped cleanup proof. Full `pnpm test`, typecheck, lint, harness CI, package-owner runtime tests, local signed-in Electron/Chrome CDP email probes, and the GitHub package workflow passed. VM installed-app proof remains pending for this exact asset. Hidden WinRM silent install is a diagnostic-only path and must not be used as GA proof.

## Post-Asset Source Evidence

Before rebuilding the candidate above, a local signed-in Outlook CDP probe was run against the user's Chrome tab at `https://outlook.cloud.microsoft/mail/`. The source browser-manager path returned `open=opened`, `readInbox(5)=ok`, and a widened 12-row Inbox window where the June filter returned 10 rows, the May filter returned 2 rows, and the Raj sender filter returned 2 rows, all with `scan.exhaustive=false`.

The June 23 Electron/Chrome send matrix was run through the app Host API against signed-in Outlook and passed compose, reply, reply-all, and forward. The probe observed `/api/outlook/read-inbox`, two `/api/outlook/reply` calls, `/api/outlook/forward`, `/api/outlook/draft`, and four `/api/outlook/send` calls; every draft body was in the compose body, not the recipient fields; each controlled marker appeared in Sent Items; no matching marker remained in Drafts; and no matching compose remained open. Evidence path: `/tmp/clawx-email-send-matrix-20260623102302/clawx-electron-probe-2026-06-23T14-26-13-166Z.json`.

This June 23 work was packaged in the historical `outlook-green` installer above. Installed-app VM proof was still required at that checkpoint. The June blocker was the unsupported hidden WinRM silent installer path; the September status and observed Gateway/chat failure are documented at the top of this file.

## Historical release checklist

- `docs/GA_RELEASE_EVIDENCE_MANIFEST.md` has fresh `GREEN` or accepted `YELLOW` rows for every release-critical gate.
- A clean Windows VM or laptop install launches from the desktop shortcut and proves Gateway, Host API, Electron CDP, packaged runtime artifacts, online model path, and signed-in Microsoft tenant context.
- Outlook read/draft/reviewed-send safety and Forms preview/no-submit safety are proven through the installed app path with signed-in Microsoft context.
- Excel/Word/PDF and any demo PowerPoint workflow have installed-app chat evidence, not only source/package generated-file evidence.
- ASR has either an installed smoke with high-quality Azure Speech seed or a documented best-effort deferral.
- Final secret grep and package probe do not expose key contents, key hashes, provider credentials, Host tokens, private Forms URLs, email bodies, or full recipient lists.

## Release Notes Pointers

- June 10 GA status snapshot: `windows-pilot/plans/MOE_WINDOWS_GA_STATUS_2026-06-10.md`
- Last public prerelease notes: `windows-pilot/plans/MOE_WINDOWS_RC_2026-06-10_RELEASE_NOTES.md`
- June 10 user instructions: `windows-pilot/plans/MOE_WINDOWS_RC_2026-06-10_USER_INSTRUCTIONS.md`
- June 23 prerelease notes: `windows-pilot/plans/MOE_WINDOWS_RC_2026-06-23_EMAIL_FIX_RELEASE_NOTES.md`
- June 23 user instructions: `windows-pilot/plans/MOE_WINDOWS_RC_2026-06-23_EMAIL_FIX_USER_INSTRUCTIONS.md`
- New regression process: `.agents/skills/ga-e2e-regression/SKILL.md`
