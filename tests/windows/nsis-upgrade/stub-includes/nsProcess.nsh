; Inert COMPILE-TIME placeholder for the nsProcess plugin header (nsProcess.nsh).
;
; scripts/installer.nsh performs a top-level `!include "nsProcess.nsh"`. The
; upgrade-preparation fixture only ever inserts ClawXPrepareInstallDirectory;
; it never inserts customCheckAppRunning / customUnInstallCheck*, so none of
; these symbols can reach a runtime instruction. They exist solely so the
; include compiles without the real plugin, guaranteeing the fixture has no
; live process-enumeration/kill capability at all.
;
; If a future fixture change accidentally inserts a macro that expands one of
; these, the build still ships no plugin and the inserted stub aborts loudly
; at runtime instead of touching any process.
!ifndef nsProcess::FindProcess
!define nsProcess::FindProcess `!insertmacro ClawXFixtureNsProcessInert1`
!define nsProcess::FindProcessOld `!insertmacro ClawXFixtureNsProcessInert1`
!define nsProcess::KillProcess `!insertmacro ClawXFixtureNsProcessInert1`
!define nsProcess::KillProcessOld `!insertmacro ClawXFixtureNsProcessInert1`
!define nsProcess::CloseProcess `!insertmacro ClawXFixtureNsProcessInert1`
!define nsProcess::Unload `!insertmacro ClawXFixtureNsProcessInert0`

!macro ClawXFixtureNsProcessInert1 _PROC _ERR
  Abort "nsProcess placeholder invoked at runtime; the upgrade fixture forbids process operations"
!macroend

!macro ClawXFixtureNsProcessInert0
  Abort "nsProcess placeholder invoked at runtime; the upgrade fixture forbids process operations"
!macroend
!endif
