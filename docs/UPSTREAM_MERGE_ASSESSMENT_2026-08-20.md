# Upstream merge assessment

## Later research direction — September 8, 2026

The owner paused builds and requested a [source-backed OpenClaw/Outlook/VoltAgent/AionUi improvement study](research/OPENCLAW_WINDOWS_IMPROVEMENT_STUDY_2026-09-08.md). It evaluates OpenClaw `2026.9.2` separately from the ClawX upstream snapshot below; no upgrade or broad merge is accepted. Moe.25 is now the latest installed diagnostic baseline, with model-turn acceptance paused.

## Earlier comparison — September 8, 2026

Read-only `git fetch --no-tags origin main` confirmed upstream `6a938757dbe47b74687ec1bf131a674e03ea9e79`. Compare it with the installed pilot candidate `b814f804036fc2f9f32d3326c8694f4ae2ef7805` (moe.24), not with an unbuilt development checkout.

| Surface | Current upstream | Installed pilot | Assessment |
|---|---|---|---|
| App version | `0.5.6` | `0.4.3-moe.24` | Deliberate fork; version numbers do not establish feature parity |
| OpenClaw runtime | `2026.7.1-2` | `2026.4.23` | Runtime/plugin migration and compatibility have not been accepted |
| Electron | `40.10.6` | Lockfile/package artifact resolves `40.8.4` (`^40.6.0` declaration) | Patch-version drift; no upgrade is implied by this audit |
| Windows plugin cleanup safety | `safeRmSync` | Present in the candidate at all six cleanup call sites | Backported behavior verified in source despite different commit ancestry |
| Gateway liveness/recovery controller | Upstream controller/refactor exists | Upstream controller absent; pilot has its own recovery changes | Integration still deferred; full pilot recovery acceptance remains open |
| NSIS upgrade/rollback refactor | Standalone template patches | Pilot retains its own packaging path | Current assisted install PASS does not establish failed-upgrade rollback behavior |
| IPC / Host API layout | `shared/host-api` refactor | Pilot Main/Host API boundaries | Architectural divergence; not a drop-in merge |
| Upstream custom-provider timeout removal (`2ab8610a`) | Removed upstream-added timeout injection | No corresponding `requestTimeout`/`timeoutMs` injection in pilot `openclaw-auth.ts` | Do not count a missing commit as a missing fix without checking behavior |

The histories differ by 198 upstream-only and 114 pilot-only commits from their merge base, and their trees differ across 1,625 files including documentation and tests. **These are divergence measurements, not counts of missing features or defects.** Squashed/copied backports make ancestry alone insufficient; the cleanup-safety check above demonstrates this.

The Ministry fork adds its own Outlook/Forms tools and action gates, document handling, Online provisioning/broker integration, Windows helpers and pilot UX. Upstream's tests cannot validate those additions. Conversely, not every observed runtime issue was introduced by Ministry changes: both launchers currently pipe Gateway stdout without consuming it. That is a documented risk, not a proven cause of the measured startup delay.

Current evidence establishes a blocking catalog dependency in the pinned OpenClaw `chat.history` path. Repair `f5875b54d5bfcf9e6b134322f560d18468746975` has a baseline-versus-patched regression using the actual pinned handler and thinking resolver; root independently repeated all seven focused tests. The repair is **source-verified only**, not in moe.24. It does not prove that all startup latency is removed.

This is a bounded version/source comparison, not a full compatibility audit of all 198 upstream-only commits. Use the [workflow matrix](APP_WORKFLOWS_TEST_MATRIX.md) and [completion plan](COMPLETION_PLAN.md) for actual product acceptance. No merge, runtime upgrade or new package build was performed for this comparison.

## Historical assessment — August 20, 2026

Fork: `dmvevents/clawx-pilot` (Ministry of Education). Upstream: `ValueCell-ai/ClawX`
(`origin`). We are ~102 commits behind (v0.4.15 → v0.5.2). This pass audited the
five candidates that looked relevant to the Windows pilot and merged what could
land safely mid-pilot. Working branch: `fix/doc-tooling-steering`.

The standing rule is audit-then-cherry-pick, never rebase mid-pilot. That rule
earned its keep here: four of the five candidates turned out to be entangled
with upstream refactors our fork deliberately diverged from.

## Result

| Upstream | Date | Size | Verdict |
|---|---|---|---|
| `3a241cf0` prevent plugin cleanup deleting bundled OpenClaw runtime (#1197) | 2026-07-28 | 6 files, +257 −10 | **MERGED** as `204303b2` |
| `1830bbe7` skip legacy NSIS uninstall on Windows overwrite upgrades (#1072) | 2026-05-27 | 11 files, +645 −46 | **DEFERRED** — needs prerequisite `b4588c5a` |
| `68705d96` disable internal control-plane and goal tools by default (#1235) | 2026-08-11 | 10 files, +134 −12 | **SKIPPED** — no-op against our pinned OpenClaw |
| `7f8e50ab` harden gateway liveness recovery (#1250) | 2026-08-20 | 40 files, +1500 −286 | **DEFERRED** — 33 conflicts |
| `581981f2` IPC refactor | — | 285 files, +12177 −14371 | **DEFERRED** — post-pilot |

Verification after the merge, all on `fix/doc-tooling-steering`:

```
pnpm typecheck                                  exit 0
pnpm test                                       154 files / 1172 passed / 6 skipped
pnpm exec vitest run tests/unit/safe-fs.test.ts 4 passed / 1 skipped
pnpm eval:ci                                    56 passed, 9 skipped, 0 failed
pnpm harness:ci                                 green (eval gate included)
replay-raj-prompts.mjs                          7/7
```

Test count moved 153 files / 1168 tests → 154 / 1172. The delta is exactly
upstream's `tests/unit/safe-fs.test.ts`. Nothing else changed.

## `3a241cf0` — merged

**What it fixes.** `rmSync(dir, { recursive: true, force: true })` follows NTFS
directory junctions on Windows. Plugin mirrors under
`~/.openclaw/extensions/<plugin>/node_modules/openclaw` are junctions pointing at
the *bundled* OpenClaw runtime. So a routine plugin cleanup could walk out of the
plugin tree and delete the runtime the app needs to boot.

Upstream adds `electron/utils/safe-fs.ts` exporting `safeRmSync()`, which
`lstat`s every entry, unlinks links instead of descending them, `realpath`s each
directory before recursing, and throws rather than falling back to `fs.rmSync`
when resolution fails. Fail-closed: a fallback would reintroduce exactly the
traversal it exists to prevent.

**Why it matters to us.** Our pilot has three of the four call sites this
patches, and the failure mode is one we would misdiagnose. It presents as "the
app stopped booting after a plugin change" — which reads as a Gateway crash-loop,
not as filesystem damage. `docs/WINDOWS_PROBLEMS_ATLAS.md` has no entry for it.

**Call sites converted** (6 total):
- `electron/gateway/config-sync.ts` — `cleanupStaleBuiltInExtensions`,
  `ensureConfiguredPluginsUpgraded`, `cleanupUnconfiguredChannelPlugins`
- `electron/utils/plugin-install.ts` — `copyPluginFromNodeModules`,
  `ensurePluginInstalled` (2 sites: install + pre-retry cleanup)

Note `repairPluginOpenClawPeerLink` is in upstream's diff but not in our tree —
that function arrived with a later upstream commit we have not taken.

**Conflicts resolved** (3, all import-line drift, no logic):
1. `config-sync.ts` imports — upstream's side carried five symbols
   (`buildCandidateSources`, `repairTrustedOfficialPluginInstallRecords`, …) and
   two modules (`openclaw-image-relay-constants`, `openclaw-upgrade-snapshot`)
   that belong to *other* upstream commits. Kept our import list, added only
   `safeRmSync`.
2. `plugin-install.ts` imports — same shape. Upstream's side added `lstatSync`,
   `symlinkSync`, `unlinkSync`, `getOpenClawResolvedDir`, and a
   `plugin-install-index` module we do not have. Kept ours, added `safeRmSync`,
   dropped the now-unused `rmSync`.
3. `plugin-install.ts` body, ~345 lines — upstream's
   `TRUSTED_OFFICIAL_EXTENSION_PLUGINS` machinery (SQLite install records, OpenClaw
   2026.6+/2026.7.1 trust checks). Entirely unrelated to this fix; resolved to
   our side.

**CI hook, adapted.** Upstream appended `safe-fs.test.ts` to a Windows job step
named "Test Windows attachment open-with bridge". We have neither of those
attachment test files. Since `safeRmSync` exists specifically to handle NTFS
junction semantics, running it only in the Linux `test` job would miss the
platform it was written for — so `.github/workflows/check.yml` gets its own step,
"Test Windows-safe recursive removal", on the existing `windows-latest` job.

## `1830bbe7` — deferred, blocked on a prerequisite

Upstream extracted its NSIS template patching into standalone modules
(`scripts/patch-nsis-extract.mjs` and friends) in `b4588c5a`, 2026-05-20. Our
fork never took that commit; we patch `extractAppPackage.nsh` *inline* inside
`scripts/after-pack.cjs` (step 6, the `ClawX-patched-v2` direct-`Nsis7z::Extract`
patch). `1830bbe7` imports `patchNsisInstallSectionTemplate` and
`patchNsisUninstallTemplate` from modules that do not exist here, so it cannot
apply without first taking `b4588c5a` — which would rewrite the extract patch our
Windows installer currently depends on.

Our `scripts/installer.nsh` has also diverged 43 insertions / 11 deletions from
upstream's parent, including MoE-specific work that must not be lost:
`Ministry of Education` AppData cleanup (both `$LOCALAPPDATA` and `$APPDATA`,
with a locked-file retry), `IfSilent` guards so silent `/S` installs do not block
on MessageBoxes, and the `isUpdated` app-running dialog.

Upstream's actual change is worth having eventually — it defers opposite-hive
registry cleanup from `customCheckAppRunning` to `customInstall` so a *failed*
update can still roll back to the old app with its uninstall entries intact, and
it fails closed when `ClawX.exe` survives the kill attempts rather than
false-succeeding with old files in place. But it is a two-commit installer
rework, and the installer is the one component the Ministry has already accepted
(moe.11, sha256 `b01bb6c3`, silent `/S` verified). Not mid-pilot.

**To revisit post-pilot:** take `b4588c5a` and `1830bbe7` together, port our
`installer.nsh` divergences onto the result, and re-run the
`windows-installer-e2e` workflow before anything ships.

## `68705d96` — skipped, would be a no-op

Adds five entries to `tools.deny` and `gateway.tools.deny`: `gateway`, `nodes`,
`create_goal`, `get_goal`, `update_goal`.

Interesting because it converges independently on the same seam our HOLD branch
`fix/tool-catalog-trim` (7add864b) uses — upstream writes the global
`tools.deny`, we write the provider-scoped `tools.byProvider[key].deny`. That is
corroboration that the seam is the right one.

But it does not apply and would not do anything:

- **The tools do not exist in our runtime.** We pin `openclaw@2026.4.23`.
  Grepping `node_modules/openclaw` for `create_goal`, `get_goal`, `update_goal`,
  `gateway`-as-tool, and `nodes`-as-tool finds none of them. They are 2026.7+
  additions. Denying absent tools changes nothing.
- **Our `sanitizeOpenClawConfig` has none of the scaffolding.** Upstream's diff
  extends `SKILL_WORKSHOP_TOOL_DENY_ENTRY` / `WEB_SEARCH_TOOL_DENY_ENTRY`,
  `normalizeToolDenyList()`, `ensureToolDenyIncludes()`, and a
  `gateway.tools.deny` block. Our `openclaw-auth.ts` is 2801 lines against
  upstream's 3823 and has none of those. It would be a rewrite of the sanitizer,
  not a cherry-pick.
- **Cherry-pick surface:** 9 conflicts, including all four README locales.

Take it when we take the OpenClaw 2026.7.x bump, not before. Our own on-device
trim already denies the tools that actually cascade on this build (`tts`,
`process`, `subagents`, `sessions_list`, `sessions_spawn`, `web_search`,
`web_fetch`, `image`, `canvas`).

## `7f8e50ab` — deferred, 33 conflicts

Upstream's three-minute gateway liveness recovery: a new
`electron/gateway/recovery-controller.ts`, +144 −0 in `gateway/manager.ts`,
changes to `connection-monitor.ts`, `recovery-budget.ts`, `gateway-health.ts`,
the `shared/host-api/contract.ts` surface, and the Channels page.

Three independent reasons to hold:

1. **33 conflicts**, concentrated in `gateway/manager.ts` — the highest-risk file
   in the fork and the one `docs/WINDOWS_PROBLEMS_ATLAS.md` warns about most.
2. **Path divergence.** Upstream moved to `shared/host-api/` and
   `shared/i18n/locales/`; ours are `electron/api/routes/` and
   `src/i18n/locales/`. The cherry-pick recreates upstream's paths as new
   directories, and would have re-introduced `ja`/`ru`/`zh` locale files that
   our English-only hard rule requires stay deleted.
3. **It lands on the boot path we just stabilised.** `fc435c6b`
   (`ensureBootableAgentsConfig`, BUG-012) and the moe.11 install evidence are
   both fresh. Rewriting gateway recovery on top of that trades a known-good
   state for an unverified one, with no Windows box currently free to smoke it.

Revisit when the Windows lane is free and `fc435c6b` has more field time.

## Not assessed

`581981f2` (285-file IPC refactor, +12177 −14371) and the OpenClaw
2026.4.23 → 2026.7.1-2 bump. Both are post-pilot by size alone. The OpenClaw bump
is the natural carrier for `68705d96`.

## Untouched

`fix/tool-catalog-trim` (7add864b) remains under HOLD and was not modified,
pushed, or merged. Nothing was pushed to `origin` (ValueCell-ai upstream).
