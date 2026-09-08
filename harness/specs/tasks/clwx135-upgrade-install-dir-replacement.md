---
id: clwx135-upgrade-install-dir-replacement
title: Verified install-directory replacement for Windows overwrite upgrades
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Guarantee that a successfully finished Windows (NSIS) upgrade cannot retain stale application-owned runtime files in the installed payload, and that a replacement that cannot complete aborts with a nonzero installer exit while preserving the previous installation tree.
touchedAreas:
  - harness/specs/tasks/clwx135-upgrade-install-dir-replacement.md
  - scripts/installer.nsh
expectedUserBehavior:
  - A principal upgrading ClawX (assisted, silent, or auto-update) gets an installation directory containing only the new payload; application-owned runtime leftovers such as resources\openclaw\.openclaw-lifecycle-pending from the prior version cannot survive into the new install and later block gateway readiness.
  - When the previous installation cannot be moved aside (locked files), the installer fails with a nonzero exit code and the previous installation, user AppData, ~/.openclaw and Chrome profile remain untouched and usable; it never reports success after a partial cleanup.
  - A user-selected nonempty folder that is not a previous ClawX installation, a reparse-point destination, or a filesystem root is rejected instead of being moved, deleted or overlaid; preexisting sibling and ._stale_* directories are preserved.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - completion-evidence
requiredTests:
  - pnpm harness validate --spec harness/specs/tasks/clwx135-upgrade-install-dir-replacement.md
  - "NSIS compile validation of scripts/installer.nsh with the shipped compiler: NSISDIR=~/Library/Caches/electron-builder/nsis/nsis-3.0.4.1 ~/Library/Caches/electron-builder/nsis/nsis-3.0.4.1/mac/makensis -V2 <stub wrapper including scripts/installer.nsh>; exit 0"
acceptance:
  - scripts/installer.nsh defines `!macro ClawXPrepareInstallDirectory` and exposes `Var /GLOBAL ClawXStaleInstallDir` (empty when no previous tree was moved; otherwise the exact rollback directory created by this invocation) as the shared interface for the independent native test harness.
  - The macro performs filesystem replacement/path checks only (no process kills, registry writes or user-profile writes) and executes on EVERY enabled install path before SetOutPath $INSTDIR + installApplicationFiles - early in customCheckAppRunning on non-elevated instances, and unconditionally via customUnInstallCheck (handleUninstallResult SHELL_CONTEXT) plus customUnInstallCheckCurrentUser, which also cover UAC inner-instance elevated all-users installs and re-verify the destination after the old per-user uninstaller runs (review B1).
  - Repeated invocation in one installer process is safe - the zero-argument macro never resets $ClawXStaleInstallDir, so a later invocation finding the destination already clean retains the exact rollback pointer from the invocation that moved the old tree; a destination modified between invocations is fully re-checked and re-prepared rather than blindly skipped (review B1).
  - Directory enumeration failure is never classified as empty. FindFirst errors on an existing directory abort with a nonzero exit in both the pre-rename scan and the post-rename verification; normal FindNext end-of-enumeration is distinguished from errors (review B2).
  - CreateDirectory failures are honored and both creation sites re-verify real directory / non-reparse attribute bits before proceeding; post-rename failure text states that previous files are preserved in the exact $ClawXStaleInstallDir rollback directory rather than left in place (review N1/B2).
  - Directory presence is decided with GetFileAttributes/FindFirst instead of the trailing-backslash IfFileExists idiom that native NSIS 3.0.4.1 evaluates ABSENT for an existing installed directory (root evidence artifacts/windows-vm/20260908-moe27/native-nsis-directory-pattern-result.json), which was the confirmed cause of the retained moe.26 lifecycle marker after the moe.27 overwrite install.
  - Replacement is rename-or-abort. The unchecked `cmd rd /s /q "$INSTDIR"` fallback and the partial skills-subtree deletion are removed; on persistent rename failure the installer aborts with SetErrorLevel 2 + Quit and the old tree stays recoverable (in place, or in $ClawXStaleInstallDir after a completed rename).
  - Post-install deferred cleanup in customInstall is scoped to the exact $ClawXStaleInstallDir moved by this invocation; no wildcard deletion of arbitrary ._stale_* or sibling directories.
  - Nonempty destinations are moved aside only when they carry a bounded ClawX ownership anchor (${APP_EXECUTABLE_FILENAME}, resources\app.asar, or resources\openclaw); roots, reparse points, plain-file destinations and unrecognized nonempty folders are rejected; a missing or empty destination proceeds as a fresh install.
  - Native behavioral acceptance (baseline stale-file reproduction, replacement with sibling/profile preservation, locked-path abort, repeated-hook invocation from the customUnInstallCheck position, and enumeration-rejection coverage) is executed by the independent test author's harness that includes this exact macro, and remains root-owned; this spec does not claim installed-app proof. Root has natively proven the locked-child rename precondition (FileShare.ReadWrite without Delete blocks parent rename, AccessDenied), not yet a macro pass.
docs:
  required: false
---

Root evidence for the clean moe.27 native upgrade (installer exit 0, installed ASAR/EXE hashes matching the extracted package) showed the installed tree still carrying the application-owned `.openclaw-lifecycle-pending` runtime marker created under moe.26, with HostAPI stuck reconnecting (gatewayReady=false) after 360s. Native NSIS 3.0.4.1 probing confirmed `IfFileExists "$INSTDIR\"` evaluates ABSENT for the existing installed directory while `"$INSTDIR"` and `"$INSTDIR\*.*"` evaluate present, so the previous rename-aside block never ran and the upgrade overlaid stale runtime state; its `cmd rd` fallback was also unchecked and could report success after partial deletion.

This task replaces that block with the verified `ClawXPrepareInstallDirectory` macro described above. The gateway-backend-communication scenario is referenced because the user-visible failure is gateway readiness on the installed app; this change owns only the installer-side guarantee that the shipped runtime payload is exactly the packaged one. The bounded native NSIS harness that exercises the exact macro (baseline reproduction, replacement, locked-path abort, sentinel preservation) is authored independently and executed by root on Windows.
