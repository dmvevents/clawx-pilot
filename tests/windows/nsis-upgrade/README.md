# CLWX-135/25 (moe27) NSIS upgrade-preparation behavioral harness

Native, bounded behavioral tests for the production
`!macro ClawXPrepareInstallDirectory` (zero parameters; consumes `$INSTDIR`
and `${APP_EXECUTABLE_FILENAME}`, records `Var /GLOBAL ClawXStaleInstallDir`)
that replaces the moe27 upgrade path which retained stale runtime files
(e.g. an old `.openclaw-lifecycle-pending`) after an exit-0 installer run.

The fixture compiles the ACTUAL reviewed macro source — never a reimplemented
algorithm — and only inserts that one macro. `customCheckAppRunning` (broad
legacy process kills) is never inserted; `stub-includes/nsProcess.nsh` is an
inert compile-time placeholder so the production include compiles with no
live process capability.

## Files

- `fixture.nsi` — minimal silent installer: guards → `!insertmacro
  ClawXPrepareInstallDirectory` → simulated new-payload copy on success.
  Exit codes: 0 success; 2 macro rejection (`SetErrorLevel 2` + `Quit`);
  3/4 fixture-guard failures; 5 payload-copy failure; 6 rejected
  `CLAWX_FIXTURE_FORCE_ROOT_TARGET` request (unsafe-root probe only).
- `compile-fixture.sh` — macOS compile with the pinned electron-builder
  NSIS 3.0.4.1 (`makensis` reports v3.04) and explicit `NSISDIR`.
- `run-upgrade-suite.ps1` — sequential Windows runner (PowerShell 5.1),
  structured JSON evidence per scenario + suite summary.
- `contract-compile-check.nsh` — compile-check-only macro stand-in that
  ALWAYS aborts at runtime; never acceptance-relevant.

## Compile (macOS, no GUI)

```sh
# against the ACTUAL production source (required for any behavioral run):
tests/windows/nsis-upgrade/compile-fixture.sh \
  /private/tmp/clawx-moe27-upgrade-20260908/scripts/installer.nsh
# output: tests/windows/nsis-upgrade/out/clawx-upgrade-prepare-fixture.exe
```

`NSISDIR` defaults to `~/Library/Caches/electron-builder/nsis/nsis-3.0.4.1`.

## Run (Windows, root-operated)

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\windows\nsis-upgrade\run-upgrade-suite.ps1 `
  -FixtureExe <path>\clawx-upgrade-prepare-fixture.exe `
  [-FixtureRoot C:\clawx-fixtures\run1] [-EvidenceDir <private evidence dir>]
```

Runner exit: 0 all pass, 1 failures, 3 safety stop. Evidence:
`<FixtureRoot>\evidence\scenario-*.json` + `suite-summary.json` (includes the
fixture SHA-256). Fixture trees are left in place for inspection — no broad
cleanup, no retries.

## Scenarios (sequential, single guest)

1. `unsafe-root-target` — drive-root rejection, run FIRST as safety gate;
   uses only an OS-confirmed UNMAPPED drive letter; suite stops unless it
   passes. `/D=` alone cannot deliver this target: NSIS exehead startup
   validates the `/D=` value before `.onInit` and reverts an invalid bare
   root (unmapped drive; roots are also invalid without
   `AllowRootDirInstall`) to the compiled placeholder `InstallDir` — proven
   natively 2026-09-08 22:33 UTC (`instdirAtInit` was
   `$TEMP\clawx-upgrade-fixture-unset` for `/D=Q:\`, fixture exit 4, macro
   never reached). The runner therefore sets
   `CLAWX_FIXTURE_FORCE_ROOT_TARGET` for this probe only; `.onInit` binds
   `$INSTDIR` to that path only when it byte-matches
   `CLAWX_FIXTURE_TARGET`, is exactly `<letter>:\` and the root is OS-absent
   (a mapped/system root can never be forced — exit 6 otherwise), then the
   normal target-mismatch guard re-checks the bound value. The scenario
   asserts the exact binding (`target-forced`/`forcedTarget`), macro reach
   (`prepare-start`) and the macro's own rejection (exit 2), so a
   target-mismatch exit never counts as a pass.
2. `reparse-target` — junction rejected; decoy destination untouched.
3. `plain-file-target` — file at destination rejected and preserved.
4. `unrecognized-nonempty-target` — foreign nonempty directory preserved.
5. `empty-existing-destination` — existing empty dir accepted; no rename.
6. `fresh-install` — nonexistent destination; payload lands; no stale dir.
7. `upgrade-with-stale-markers` — old install (with `stale-runtime.sentinel`
   and `resources\openclaw\.openclaw-lifecycle-pending`) moved wholesale to a
   fresh `._stale_<n>` name; preexisting `._stale_0`/`._stale_1` collision
   siblings, an `install-dir-old` sibling and external `.openclaw`/`AppData`
   sentinels preserved; old tree recoverable at the exact recorded path.
8. `upgrade-hooks-repeated-prep` — direct prep then the ACTUAL
   `customUnInstallCheck` / `customUnInstallCheckCurrentUser` hooks
   (bc561eb3: filesystem prep/error reporting only; `$R0` set to a harmless
   flag) repeat the prep; the exact rollback pointer must be retained and no
   stale files copied. `customCheckAppRunning`/`customInstall` are never
   inserted.
9. `inner-hook-only-prep` — UAC inner-instance shape: NO direct prep, the two
   actual hooks alone must clean the destination before the payload copy
   (the B1 bypass boundary).
10. `locked-old-file` — rename refusal PROVEN by a negative-control rename
   under an owned no-Delete-share handle (child file first, held directory
   handle fallback; restore on unexpected success) before the fixture runs;
   macro must exit nonzero and preserve the old tree in place.
11. `acl-denied-listing` — the B2 boundary root reproduced as standard user
   ClawXFresh0908 (native FindFirst errors were classified "empty"; exit 0
   overlay retained the stale sentinel): an explicit deny-ListDirectory ACL
   for the current user (no inheritance) is applied to a recognized old tree,
   a managed enumeration control must be DENIED (an unenforced denial — e.g.
   lab admin operator clawxlab — is recorded as FAILED/invalid control, never
   silently passed or downgraded to an ordinary upgrade), the fixture's
   native pre-macro FindFirst diagnostic must report Errors, and the macro
   must exit nonzero with no payload and the old tree retained. The saved
   ACL is restored in `finally`, including an exact owned rollback if an
   unexpected rename occurred. Run the suite as a standard (non-admin) user
   in an owned fixture folder for this control to be enforceable.

## Safety boundaries

- All mutating scenarios stay inside one newly created fixture root that is
  validated BEFORE creation (absolute, no whitespace, not existing, not
  shallow, not under Windows/Program Files/ProgramData, not the profile root).
- Never targets an installed application or user data directory, even in
  negative tests.
- A probe against a real MAPPED drive root is deliberately not implemented:
  if rejection regressed it could mutate a live volume. It requires separate
  static safety review before anyone adds it.
- The runner owns only the fixture process it launches (bounded wait, then
  kill of that PID only) and the lock handles it opens (released in finally).

## Status

Compiled locally against the frozen content of production commit c5c8590b
(source file sha256 168ef803093120d8f77d712e44f6e6e2e7a0bcb8f70f6268582234d83428a167)
with NSIS 3.0.4.1 (v3.04, mac makensis). `compile-fixture.sh` prints the
prepare-source hash so runs are tied to frozen content, not a moving
worktree. Root's 2026-09-08 22:33 UTC run (assembly b8423f22) honestly
stopped in `unsafe-root-target` because NSIS startup discarded `/D=Q:\`;
this revision adds the guarded root binding above, so all eleven Windows
scenarios are again NOT_RUN here; root executes them (as a standard QA user
for the ACL case) and owns the verdict. No GA/Windows-pass claim.
