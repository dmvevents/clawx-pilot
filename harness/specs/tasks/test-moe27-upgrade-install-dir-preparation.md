---
id: test-moe27-upgrade-install-dir-preparation
title: Prove the NSIS install-directory preparation macro's upgrade outcomes with a native bounded fixture harness
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: >-
  Cover CLWX-135/25 (moe27): a real installed upgrade exited 0 with new
  ASAR/EXE hashes yet retained an old lifecycle marker
  (.openclaw-lifecycle-pending) absent from the new package, and shortcut
  startup then failed for 360s; root's native NSIS 3.0.4.1 probe showed
  IfFileExists "$INSTDIR\" erroneously reporting an existing directory as
  absent. The production fix is !macro ClawXPrepareInstallDirectory
  (scripts/installer.nsh, author worktree commit 2841f8c0; zero parameters,
  rename-or-abort, Var /GLOBAL ClawXStaleInstallDir). This task delivers a
  native behavioral harness that exercises the ACTUAL macro — never a
  reimplementation — through a minimal silent fixture installer plus a
  sequential Windows runner, so root can prove upgrade outcomes on real
  Windows before any release claim. The installed Gateway/backend startup
  failure is the user-visible defect; this harness does not change any
  transport path.
touchedAreas:
  - harness/specs/tasks/test-moe27-upgrade-install-dir-preparation.md
  - tests/windows/nsis-upgrade/**
expectedUserBehavior:
  - After an upgrade over an existing installation, the app starts from its shortcut because no stale runtime files (including an old resources/openclaw/.openclaw-lifecycle-pending) survive into the new install directory.
  - A refused upgrade (locked files, foreign directory, reparse point, plain file, root-like target) exits nonzero and leaves the previous installation fully usable; the moved-aside tree from a successful upgrade stays recoverable at the exact recorded ._stale_<n> path.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - completion-evidence
acceptance:
  - fixture.nsi compiles with the pinned electron-builder NSIS 3.0.4.1 (mac makensis, explicit NSISDIR) against the ACTUAL production installer.nsh defining the zero-parameter macro; a compile against a source lacking the macro fails with an explicit !error; the contract-compile-check.nsh stand-in always aborts at runtime and never counts as acceptance.
  - The fixture inserts only ClawXPrepareInstallDirectory (never customCheckAppRunning); the nsProcess include is satisfied by an inert compile-time placeholder so the built fixture has no process-kill capability.
  - run-upgrade-suite.ps1 executes eight sequential scenarios in one newly created, pre-validated fixture root with bounded process waits, native exit codes and per-scenario structured JSON plus a suite summary that survives scenario exceptions; failed cases are never blindly retried and fixture trees are left as evidence.
  - The unsafe/root probe (unmapped drive letter only) runs first and gates the rest of the suite; the locked-old-file scenario proves the Windows rename refusal with an owned negative-control rename (child-file handle, directory-handle fallback, restore on unexpected success) before asserting the macro fails closed.
  - The upgrade scenario proves stale markers absent after the simulated payload copy, preexisting install-dir._stale_0/._stale_1 collision siblings and external .openclaw/AppData sentinels preserved, and the prior tree recoverable at the exact recorded $ClawXStaleInstallDir path; success paths prove the new payload landed and no rollback dir is claimed.
  - Windows execution results are recorded by root as PASS/FAIL/BLOCKED/NOT_RUN per scenario; local compile evidence alone never becomes a Windows pass or GA claim.
docs:
  required: false
---

Native preparation harness for root's Windows verification of the moe27
upgrade replacement. Owned paths: tests/windows/nsis-upgrade/ and this spec
only; no production source edits, no new dependencies, no VM/cloud/GUI
operations from this task. The UAC hook bypass question flagged by the source
author remains owned by the independent source review, not this harness.
Root's private evidence store keeps the run receipts (root-interface-check.json,
first-attempt receipts) outside the repository.
