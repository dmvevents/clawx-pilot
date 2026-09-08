; ClawX CLWX-135 / CLWX-25 (moe27) upgrade-preparation behavioral fixture.
;
; Purpose: exercise the ACTUAL production macro
;   !insertmacro ClawXPrepareInstallDirectory
; (zero parameters; consumes $INSTDIR and ${APP_EXECUTABLE_FILENAME}) from the
; reviewed source passed via /DCLAWX_PREPARE_SOURCE, then simulate a new
; payload copy on success. It never inserts customCheckAppRunning (or any
; other installer.nsh macro), so no process/registry mutation can execute.
;
; Interface (production source: /private/tmp/clawx-moe27-upgrade-20260908
; scripts/installer.nsh, commit c5c8590b):
;   - Filesystem-only preparation before payload extraction.
;   - Leaves a clean, real, empty destination directory, or aborts with
;     SetErrorLevel 2 + Quit while preserving the old tree.
;   - Var /GLOBAL ClawXStaleInstallDir records only the exact sibling
;     directory ("$INSTDIR._stale_<n>") moved by this invocation (empty
;     otherwise).
;
; Runtime protocol (consumed by run-upgrade-suite.ps1):
;   - env CLAWX_FIXTURE_RESULT: absolute path of a line-oriented result file
;     this fixture appends key=value / phase=... lines to. Required.
;   - env CLAWX_FIXTURE_TARGET: the exact target directory the runner intended.
;     Required; guards against /D= quoting mistakes silently falling back to
;     the placeholder InstallDir. Compared case-insensitively, trailing "\"
;     trimmed.
;   - /D=<target> sets $INSTDIR (silent NSIS convention; last argument,
;     no quotes, therefore no spaces in the target path).
;   - env CLAWX_FIXTURE_FORCE_ROOT_TARGET (unsafe-root probe ONLY): the NSIS
;     exehead validates the /D= value BEFORE .onInit (Ui.c is_valid_instpath)
;     and reverts an invalid path to the compiled-in InstallDir placeholder.
;     A bare drive root is always invalid there: roots are refused without
;     AllowRootDirInstall, and an unmapped drive's root does not exist
;     (proven natively 2026-09-08 22:33 UTC: /D=Q:\ arrived in .onInit as
;     "$TEMP\clawx-upgrade-fixture-unset", exit 4). So /D= can never deliver
;     the root probe target to the ACTUAL macro. When this variable is set it
;     must byte-match CLAWX_FIXTURE_TARGET, be exactly "<letter>:\" and name
;     an OS-absent (unmapped) root; only then does .onInit bind $INSTDIR to
;     that exact intended path, and the normal target-mismatch guard below
;     still runs against the result. Any guard violation exits 6. Unset (all
;     other scenarios): behavior is unchanged and mismatch protection stands.
;   - env CLAWX_FIXTURE_MODE selects the invocation path. "direct" (default):
;     one direct prep insertion. "hooks": direct prep, then the ACTUAL
;     customUnInstallCheck and customUnInstallCheckCurrentUser hooks (repeated
;     prep; rollback pointer must be retained). "inner-hooks": NO direct prep
;     (UAC inner instance skips customCheckAppRunning), only the two actual
;     hooks before the payload copy. $R0 is set to the harmless flag 1 before
;     each hook (exercises only its DetailPrint/error-report branch).
;
; Exit codes: 0 success; 2 macro rejection/failure path (ClawXFailInstallPrep
;   uses SetErrorLevel 2 + Quit); 3 missing CLAWX_FIXTURE_RESULT;
;   4 CLAWX_FIXTURE_TARGET/$INSTDIR mismatch; 5 simulated payload copy failed
;   after successful preparation; 6 CLAWX_FIXTURE_FORCE_ROOT_TARGET guard
;   violation (not the runner's exact target, not a bare drive root, or the
;   root exists/is mapped).

!ifndef CLAWX_PREPARE_SOURCE
  !error "Pass /DCLAWX_PREPARE_SOURCE=<absolute path to the reviewed .nsh defining ClawXPrepareInstallDirectory> (e.g. scripts/installer.nsh once the author lands the macro, or contract-compile-check.nsh for compile validation only)."
!endif
!ifndef CLAWX_FIXTURE_OUTFILE
  !define CLAWX_FIXTURE_OUTFILE "clawx-upgrade-prepare-fixture.exe"
!endif
!ifndef APP_EXECUTABLE_FILENAME
  !define APP_EXECUTABLE_FILENAME "ClawX.exe"
!endif
!ifndef PRODUCT_NAME
  !define PRODUCT_NAME "ClawX"
!endif

Unicode true
Name "ClawX Upgrade Prepare Fixture (CLWX-135/25)"
OutFile "${CLAWX_FIXTURE_OUTFILE}"
RequestExecutionLevel user
SilentInstall silent
; Placeholder only; the runner always overrides via /D= and the .onInit guard
; refuses to run when the override did not take effect.
InstallDir "$TEMP\clawx-upgrade-fixture-unset"

!include "LogicLib.nsh"
; Inert compile-time placeholders (nsProcess plugin header) so including the
; production installer.nsh succeeds without any live process capability.
!addincludedir "${__FILEDIR__}/stub-includes"
!addincludedir "${__FILEDIR__}\stub-includes"

!include "${CLAWX_PREPARE_SOURCE}"

!ifmacrondef ClawXPrepareInstallDirectory
  !error "CLAWX_PREPARE_SOURCE does not define !macro ClawXPrepareInstallDirectory - refusing to build a fixture that cannot exercise the actual macro."
!endif
; The hook modes insert the ACTUAL post-uninstall hooks (bc561eb3: filesystem
; preparation/error reporting only). customCheckAppRunning / customInstall
; (process kills, registry writes) are NEVER inserted.
!ifmacrondef customUnInstallCheck
  !error "CLAWX_PREPARE_SOURCE does not define !macro customUnInstallCheck (needed for the hook-path scenarios)."
!endif
!ifmacrondef customUnInstallCheckCurrentUser
  !error "CLAWX_PREPARE_SOURCE does not define !macro customUnInstallCheckCurrentUser (needed for the hook-path scenarios)."
!endif

Var FixtureResultPath

!macro ClawXFixtureResultLine TEXT
  Push $9
  ClearErrors
  FileOpen $9 "$FixtureResultPath" a
  FileSeek $9 0 END
  FileWrite $9 `${TEXT}$\r$\n`
  FileClose $9
  Pop $9
!macroend

; Strip one trailing backslash from the string in $0 (used for tolerant
; target comparison, e.g. "Q:\" vs "Q:").
Function TrimTrailingBackslash
  Push $1
  StrCpy $1 "$0" 1 -1
  StrCmp $1 "\" 0 +2
    StrCpy $0 "$0" -1
  Pop $1
FunctionEnd

Function .onInit
  ReadEnvStr $0 "CLAWX_FIXTURE_RESULT"
  StrCmp $0 "" 0 haveResult
    SetErrorLevel 3
    Quit
  haveResult:
  StrCpy $FixtureResultPath $0

  ReadEnvStr $2 "CLAWX_FIXTURE_TARGET"
  StrCmp $2 "" badTarget

  ; Test-only unmapped-root binding (unsafe-root probe only; see header).
  ; Real NSIS startup already replaced an invalid /D= root with the compiled
  ; placeholder, so bind $INSTDIR to the runner's exact intended path — but
  ; only under ALL of these guards; anything else refuses with exit 6:
  ;   1. byte-identical (case-sensitive) to CLAWX_FIXTURE_TARGET;
  ;   2. exactly a bare drive root "<letter>:\" (length 3);
  ;   3. that root does not exist for this process (unmapped drive), so a
  ;      mapped/system drive root can never be forced.
  ; The ordinary mismatch guard below still verifies the bound value.
  ReadEnvStr $3 "CLAWX_FIXTURE_FORCE_ROOT_TARGET"
  StrCmp $3 "" noForce
    !insertmacro ClawXFixtureResultLine "instdirBeforeForce=$INSTDIR"
    StrCmpS $3 $2 0 badForce             ; guard 1: runner's exact intent
    StrLen $4 $3
    IntCmp $4 3 0 badForce badForce      ; guard 2: exactly "X:\"
    StrCpy $4 $3 2 1
    StrCmpS $4 ":\" 0 badForce
    StrCpy $4 $3 1                       ; guard 2: leading char is a letter
    StrCpy $5 "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
    StrCpy $6 0
    forceLetterLoop:
      StrCpy $7 $5 1 $6
      StrCmp $7 "" badForce
      StrCmpS $7 $4 forceLetterOk
      IntOp $6 $6 + 1
      Goto forceLetterLoop
    forceLetterOk:
    IfFileExists "$3*.*" badForce        ; guard 3: root must be OS-absent
    StrCpy $INSTDIR $3
    !insertmacro ClawXFixtureResultLine "phase=target-forced"
    !insertmacro ClawXFixtureResultLine "forcedTarget=$3"
    Goto noForce
  badForce:
    !insertmacro ClawXFixtureResultLine "phase=force-guard-rejected"
    !insertmacro ClawXFixtureResultLine "forceRequested=$3"
    !insertmacro ClawXFixtureResultLine "instdirAtInit=$INSTDIR"
    SetErrorLevel 6
    Quit
  noForce:

  StrCpy $0 $2
  Call TrimTrailingBackslash
  Push $0
  StrCpy $0 "$INSTDIR"
  Call TrimTrailingBackslash
  Pop $1
  ; StrCmp is case-insensitive.
  StrCmp $0 $1 targetOk
  badTarget:
    !insertmacro ClawXFixtureResultLine "phase=target-mismatch"
    !insertmacro ClawXFixtureResultLine "instdirAtInit=$INSTDIR"
    SetErrorLevel 4
    Quit
  targetOk:
FunctionEnd

Section "PrepareAndSimulateUpgrade"
  !insertmacro ClawXFixtureResultLine "fixtureVersion=3"
  !insertmacro ClawXFixtureResultLine "prepareSource=${CLAWX_PREPARE_SOURCE}"
  !insertmacro ClawXFixtureResultLine "instdir=$INSTDIR"

  ; Native pre-macro diagnostic: does FindFirst on the destination report an
  ; error? Recorded for every run; the ACL-denied-listing scenario requires
  ; "1" here to prove the denial was actually enforced for this process (the
  ; B2 boundary: enumeration failure must never be classified as empty).
  ClearErrors
  FindFirst $R4 $R5 "$INSTDIR\*"
  ${If} ${Errors}
    !insertmacro ClawXFixtureResultLine "diagFindFirstErrors=1"
  ${Else}
    !insertmacro ClawXFixtureResultLine "diagFindFirstErrors=0"
  ${EndIf}
  FindClose $R4
  ClearErrors

  ReadEnvStr $R2 "CLAWX_FIXTURE_MODE"
  StrCmp $R2 "" 0 +2
    StrCpy $R2 "direct"
  !insertmacro ClawXFixtureResultLine "mode=$R2"
  !insertmacro ClawXFixtureResultLine "phase=prepare-start"

  ; THE actual macro/hooks under test (zero parameters; read $INSTDIR and
  ; ${APP_EXECUTABLE_FILENAME}). On failure they quit this installer with
  ; SetErrorLevel 2; nothing after the dispatch runs on the failure path, so
  ; no simulated payload copy or success marker can appear.
  ${If} $R2 == "inner-hooks"
    ; UAC inner instance: customCheckAppRunning (and its direct prep) is
    ; skipped by the template; the actual post-uninstall hooks are the only
    ; preparation before extraction.
    StrCpy $R0 1
    !insertmacro customUnInstallCheck
    !insertmacro ClawXFixtureResultLine "phase=hook-uninstall-success"
    !insertmacro ClawXFixtureResultLine "staleAfterHook1=$ClawXStaleInstallDir"
    StrCpy $R0 1
    !insertmacro customUnInstallCheckCurrentUser
    !insertmacro ClawXFixtureResultLine "phase=hook-currentuser-success"
    !insertmacro ClawXFixtureResultLine "staleAfterHook2=$ClawXStaleInstallDir"
  ${ElseIf} $R2 == "hooks"
    ; Non-elevated instance: direct prep first (customCheckAppRunning's
    ; invocation), then both actual hooks re-run the prep; the rollback
    ; pointer set by the invocation that moved the tree must be retained.
    !insertmacro ClawXPrepareInstallDirectory
    !insertmacro ClawXFixtureResultLine "phase=direct-prep-success"
    !insertmacro ClawXFixtureResultLine "staleAfterDirect=$ClawXStaleInstallDir"
    StrCpy $R0 1
    !insertmacro customUnInstallCheck
    !insertmacro ClawXFixtureResultLine "phase=hook-uninstall-success"
    !insertmacro ClawXFixtureResultLine "staleAfterHook1=$ClawXStaleInstallDir"
    StrCpy $R0 1
    !insertmacro customUnInstallCheckCurrentUser
    !insertmacro ClawXFixtureResultLine "phase=hook-currentuser-success"
    !insertmacro ClawXFixtureResultLine "staleAfterHook2=$ClawXStaleInstallDir"
  ${Else}
    !insertmacro ClawXPrepareInstallDirectory
  ${EndIf}

  !insertmacro ClawXFixtureResultLine "phase=prepare-success"
  !insertmacro ClawXFixtureResultLine "staleInstallDir=$ClawXStaleInstallDir"

  ; Simulate the new payload copy the real installer performs after
  ; preparation (electron-builder File extraction stand-in).
  ClearErrors
  CreateDirectory "$INSTDIR"
  CreateDirectory "$INSTDIR\resources"
  FileOpen $1 "$INSTDIR\${APP_EXECUTABLE_FILENAME}" w
  FileWrite $1 "clawx-fixture-new-payload-executable"
  FileClose $1
  FileOpen $1 "$INSTDIR\resources\app.asar" w
  FileWrite $1 "clawx-fixture-new-payload-asar"
  FileClose $1
  ${If} ${Errors}
    !insertmacro ClawXFixtureResultLine "phase=payload-copy-error"
    SetErrorLevel 5
    Quit
  ${EndIf}
  !insertmacro ClawXFixtureResultLine "phase=payload-copied"
SectionEnd
