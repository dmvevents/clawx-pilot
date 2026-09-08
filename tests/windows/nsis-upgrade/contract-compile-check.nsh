; COMPILE-CHECK-ONLY placeholder for the actual CLWX-135/25 interface
; (commit 2841f8c0 of the author worktree's scripts/installer.nsh):
;   !macro ClawXPrepareInstallDirectory   (zero parameters; consumes $INSTDIR
;                                          and ${APP_EXECUTABLE_FILENAME})
;   Var /GLOBAL ClawXStaleInstallDir
;
; It exists so fixture.nsi can be compiled and its plumbing validated BEFORE
; the concurrent author lands the real macro in scripts/installer.nsh.
;
; It deliberately implements NONE of the preparation behavior: it always
; aborts at runtime, so a fixture built against this file can never produce a
; false behavioral pass and never stubs away the real macro's filesystem or
; error semantics. Root must rebuild against the reviewed production source
; (e.g. -DCLAWX_PREPARE_SOURCE=<repo>/scripts/installer.nsh) before any
; Windows behavioral run.
Var /GLOBAL ClawXStaleInstallDir

!macro ClawXPrepareInstallDirectory
  StrCpy $ClawXStaleInstallDir ""
  Abort "ClawXPrepareInstallDirectory: compile-check placeholder linked; rebuild the fixture against the reviewed production macro source"
!macroend
