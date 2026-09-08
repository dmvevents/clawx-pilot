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
; scripts/installer.nsh, commit 2841f8c0):
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
;   after successful preparation.

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

  ReadEnvStr $0 "CLAWX_FIXTURE_TARGET"
  StrCmp $0 "" badTarget
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
  !insertmacro ClawXFixtureResultLine "fixtureVersion=2"
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
