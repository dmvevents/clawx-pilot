; ClawX Custom NSIS Installer/Uninstaller Script
;
; Install: enables long paths, adds resources\cli to user PATH for openclaw CLI.
; Uninstall: removes the PATH entry and optionally deletes user data.

!ifndef nsProcess::FindProcess
  !include "nsProcess.nsh"
!endif

; Exact rollback directory created by the current ClawXPrepareInstallDirectory
; invocation. Empty when no previous installation tree was moved aside.
Var /GLOBAL ClawXStaleInstallDir

; Abort the installation with a nonzero exit code while leaving the previous
; installation tree untouched. Silent installs (auto-update) take the /SD
; default and fail without UI. LogicLib/label-free so it can be inserted
; multiple times.
!macro ClawXFailInstallPrep MESSAGE
  SetDetailsPrint both
  DetailPrint "${MESSAGE}"
  MessageBox MB_OK|MB_ICONSTOP "${MESSAGE}$\r$\n$\r$\nThe existing installation was left in place; nothing was removed." /SD IDOK
  SetErrorLevel 2
  Quit
!macroend

; ClawXPrepareInstallDirectory
;
; Filesystem-only preparation of $INSTDIR immediately before payload
; extraction (no process kills, no registry writes, no user-profile writes).
;
; Contract on normal return:
;   - $INSTDIR exists, is a real directory (not a reparse point) and contains
;     no files, so electron-builder's `CopyFiles /SILENT "$PLUGINSDIR\7z-out\*"`
;     copies the new payload into a clean destination and a finished install
;     cannot retain stale runtime files from the previous version.
;   - $ClawXStaleInstallDir is "" when no previous tree was moved, otherwise
;     the exact sibling directory ("$INSTDIR._stale_<n>") that THIS invocation
;     atomically renamed the old installation into (recoverable rollback).
; On any condition where a clean destination cannot be guaranteed the
; installer aborts with a nonzero exit code and the previous tree is
; preserved (either in place or, post-rename, in $ClawXStaleInstallDir).
;
; Safety rules:
;   - Rejects an empty/root-like $INSTDIR.
;   - Rejects a reparse-point destination (junction/symlink) instead of
;     renaming or writing through it.
;   - Rejects a plain file at $INSTDIR.
;   - Rejects a nonempty directory that carries no recognized ClawX
;     installation anchor (user-selected folders with foreign content are
;     never moved, deleted or overlaid).
;   - Preexisting "._stale_*" siblings from earlier runs are preserved; a
;     fresh unused name is chosen for this invocation's rename.
;   - Never falls back to recursive deletion of the old tree: replacement is
;     rename-or-abort. History (CLWX-135/25): the previous trailing-backslash
;     directory checks (IfFileExists "$INSTDIR\") evaluate ABSENT on native
;     NSIS 3.0.4.1 for an existing installed directory, silently skipping the
;     rename and overlaying stale runtime state; the unchecked `cmd rd`
;     fallback could also partially delete and still report success.
!macro ClawXPrepareInstallDirectory
  StrCpy $ClawXStaleInstallDir ""

  ; Release the installer's own working directory so NSIS cannot hold a lock
  ; on $INSTDIR during the rename (NSIS sets CWD to $INSTDIR in .onInit).
  SetOutPath $TEMP

  ${If} $INSTDIR == ""
    !insertmacro ClawXFailInstallPrep "Installation failed: no installation directory was resolved."
  ${EndIf}

  ; Reject unsafe filesystem roots such as "C:\", "D:" or "\".
  StrLen $0 $INSTDIR
  ${If} $0 < 4
    !insertmacro ClawXFailInstallPrep "Installation failed: refusing to use filesystem root '$INSTDIR' as the installation directory."
  ${EndIf}

  System::Call `kernel32::GetFileAttributes(t "$INSTDIR") i .r0`
  ${If} $0 = -1
    ; Nothing exists at the destination: fresh install.
    ClearErrors
    CreateDirectory "$INSTDIR"
    System::Call `kernel32::GetFileAttributes(t "$INSTDIR") i .r0`
    ${If} $0 = -1
      !insertmacro ClawXFailInstallPrep "Installation failed: could not create the installation directory '$INSTDIR'."
    ${EndIf}
  ${Else}
    ; FILE_ATTRIBUTE_REPARSE_POINT (0x400): junction/symlink destinations are
    ; rejected rather than renamed or written through.
    IntOp $1 $0 & 0x400
    ${If} $1 <> 0
      !insertmacro ClawXFailInstallPrep "Installation failed: '$INSTDIR' is a reparse point (junction or symbolic link). Choose a real directory."
    ${EndIf}
    ; FILE_ATTRIBUTE_DIRECTORY (0x10): a plain file at the destination.
    IntOp $1 $0 & 0x10
    ${If} $1 = 0
      !insertmacro ClawXFailInstallPrep "Installation failed: a file already exists at '$INSTDIR'."
    ${EndIf}

    ; Scan whether the existing directory has any entry ($2 = "1" when nonempty).
    StrCpy $2 "0"
    ClearErrors
    FindFirst $4 $5 "$INSTDIR\*"
    ${DoWhile} $5 != ""
      ${If} $5 != "."
      ${AndIf} $5 != ".."
        StrCpy $2 "1"
        ${ExitDo}
      ${EndIf}
      FindNext $4 $5
    ${Loop}
    FindClose $4
    ClearErrors

    ${If} $2 == "1"
      ; Nonempty destination: only a recognized previous ClawX installation
      ; may be moved aside. Anchors are bounded to the actual app layout —
      ; the launcher, the Electron app payload, or the bundled OpenClaw
      ; runtime left by a partially removed install.
      StrCpy $3 "0"
      ${If} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
        StrCpy $3 "1"
      ${ElseIf} ${FileExists} "$INSTDIR\resources\app.asar"
        StrCpy $3 "1"
      ${ElseIf} ${FileExists} "$INSTDIR\resources\openclaw\*.*"
        StrCpy $3 "1"
      ${EndIf}
      ${If} $3 != "1"
        !insertmacro ClawXFailInstallPrep "Installation failed: '$INSTDIR' already contains files that do not belong to a previous ${PRODUCT_NAME} installation. Choose an empty directory."
      ${EndIf}

      ; Pick the first unused "._stale_<n>" sibling name. Preexisting stale
      ; directories from earlier runs are preserved, never reused or deleted.
      StrCpy $6 0
      ${Do}
        System::Call `kernel32::GetFileAttributes(t "$INSTDIR._stale_$6") i .r0`
        ${If} $0 = -1
          ${ExitDo}
        ${EndIf}
        IntOp $6 $6 + 1
        ${If} $6 > 99
          !insertmacro ClawXFailInstallPrep "Installation failed: too many leftover '$INSTDIR._stale_*' directories. Remove them manually and retry."
        ${EndIf}
      ${Loop}

      ; Atomic same-volume rename of the whole old tree, with bounded retries
      ; for transient locks (antivirus / indexer). On persistent failure the
      ; old installation is preserved in place and the installer aborts —
      ; no unchecked recursive-delete fallback.
      DetailPrint "Moving previous installation to $INSTDIR._stale_$6 ..."
      StrCpy $7 0
      ${Do}
        ClearErrors
        Rename "$INSTDIR" "$INSTDIR._stale_$6"
        ${IfNot} ${Errors}
          StrCpy $ClawXStaleInstallDir "$INSTDIR._stale_$6"
          ${ExitDo}
        ${EndIf}
        IntOp $7 $7 + 1
        ${If} $7 >= 5
          !insertmacro ClawXFailInstallPrep "Installation failed: the previous installation in '$INSTDIR' is still in use and could not be moved aside. It was preserved unchanged. Close programs using it (or reboot) and run the installer again."
        ${EndIf}
        Sleep 2000
      ${Loop}

      ClearErrors
      CreateDirectory "$INSTDIR"

      ; Verify the destination is now a real, empty directory. If not, abort:
      ; the old tree stays recoverable in $ClawXStaleInstallDir.
      System::Call `kernel32::GetFileAttributes(t "$INSTDIR") i .r0`
      ${If} $0 = -1
        !insertmacro ClawXFailInstallPrep "Installation failed: could not recreate '$INSTDIR' after moving the previous installation to '$ClawXStaleInstallDir' (previous files are preserved there)."
      ${EndIf}
      StrCpy $2 "0"
      FindFirst $4 $5 "$INSTDIR\*"
      ${DoWhile} $5 != ""
        ${If} $5 != "."
        ${AndIf} $5 != ".."
          StrCpy $2 "1"
          ${ExitDo}
        ${EndIf}
        FindNext $4 $5
      ${Loop}
      FindClose $4
      ClearErrors
      ${If} $2 == "1"
        !insertmacro ClawXFailInstallPrep "Installation failed: '$INSTDIR' is not empty after preparing it. The previous installation is preserved in '$ClawXStaleInstallDir'."
      ${EndIf}
      DetailPrint "Previous installation moved aside; installing into a clean directory."
    ${EndIf}
  ${EndIf}
!macroend

!macro customHeader
  ; Show install details by default so users can see what stage is running.
  ShowInstDetails show
  ShowUninstDetails show
!macroend

!macro customCheckAppRunning
  ; Make stage logs visible on assisted installers (defaults to hidden).
  SetDetailsPrint both
  DetailPrint "Preparing installation..."
  DetailPrint "Extracting ClawX runtime files. This can take a few minutes on slower disks or while antivirus scanning is active."

  ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0

  ${if} $R0 == 0
    ${if} ${isUpdated}
      # Auto-update: the app is already shutting down (quitAndInstall was called).
      # The before-quit handler needs up to 8s to gracefully stop the Gateway
      # process tree (5s timeout + force-terminate + re-quit).  Wait for the
      # app to exit on its own before resorting to force-kill.
      DetailPrint `Waiting for "${PRODUCT_NAME}" to finish shutting down...`
      Sleep 8000
      ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
      ${if} $R0 != 0
        # App exited cleanly. Still kill long-lived child processes (gateway,
        # uv, python) which may not have followed the app's graceful exit.
        nsExec::ExecToStack 'taskkill /F /IM openclaw-gateway.exe'
        Pop $0
        Pop $1
        Goto done_killing
      ${endIf}
      # App didn't exit in time; fall through to force-kill
    ${endIf}
    ${if} ${isUpdated} ; skip the dialog for auto-updates
    ${else}
      IfSilent doStopProcess
      MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDOK doStopProcess
      Quit
    ${endIf}

    doStopProcess:
    DetailPrint `Closing running "${PRODUCT_NAME}"...`

    # Kill ALL processes whose executable lives inside $INSTDIR.
    # This covers ClawX.exe (multiple Electron processes), openclaw-gateway.exe,
    # python.exe (skills runtime), uv.exe (package manager), and any other
    # child process that might hold file locks in the installation directory.
    #
    # Use PowerShell Get-CimInstance for path-based matching (most reliable),
    # with taskkill name-based fallback for restricted environments.
    # Note: Using backticks ` ` for the NSIS string allows us to use single quotes inside.
    nsExec::ExecToStack `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Get-CimInstance -ClassName Win32_Process | Where-Object { $$_.ExecutablePath -and $$_.ExecutablePath.StartsWith('$INSTDIR', [System.StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`
    Pop $0
    Pop $1

    ${if} $0 != 0
      # PowerShell failed (policy restriction, etc.) — fall back to name-based kill
      nsExec::ExecToStack 'taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}"'
      Pop $0
      Pop $1
    ${endIf}

    # Also kill well-known child processes that may have detached from the
    # Electron process tree or run from outside $INSTDIR (e.g. system python).
    nsExec::ExecToStack 'taskkill /F /IM openclaw-gateway.exe'
    Pop $0
    Pop $1

    # Wait for Windows to fully release file handles after process termination.
    # 5 seconds accommodates slow antivirus scanners and filesystem flush delays.
    Sleep 5000
    DetailPrint "Processes terminated. Continuing installation..."

    done_killing:
      ${nsProcess::Unload}
  ${endIf}

  ; Even if ClawX.exe was not detected as running, orphan child processes
  ; (python.exe, openclaw-gateway.exe, uv.exe, etc.) from a previous crash
  ; or unclean shutdown may still hold file locks inside $INSTDIR.
  ; Unconditionally kill any process whose executable lives in the install dir.
  nsExec::ExecToStack `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Get-CimInstance -ClassName Win32_Process | Where-Object { $$_.ExecutablePath -and $$_.ExecutablePath.StartsWith('$INSTDIR', [System.StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`
  Pop $0
  Pop $1

  ; Always kill known process names as a belt-and-suspenders approach.
  ; PowerShell path-based kill may miss processes if the old ClawX was installed
  ; in a different directory than $INSTDIR (e.g., per-machine -> per-user migration).
  ; taskkill is name-based and catches processes regardless of their install location.
  nsExec::ExecToStack 'taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}"'
  Pop $0
  Pop $1
  nsExec::ExecToStack 'taskkill /F /IM openclaw-gateway.exe'
  Pop $0
  Pop $1
  ; Note: we intentionally do NOT kill uv.exe globally — it is a popular
  ; Python package manager and other users/CI jobs may have uv running.
  ; The PowerShell path-based kill above already handles uv inside $INSTDIR.

  ; Brief wait for handle release (main wait was already done above if app was running)
  Sleep 2000

  ; Prepare a verified clean destination for the 7z extraction `CopyFiles`
  ; step in extractAppPackage.nsh. This replaces the previous unverified
  ; trailing-backslash checks (which native NSIS 3.0.4.1 evaluates ABSENT for
  ; an existing directory, silently skipping the rename and overlaying stale
  ; runtime files) and the unchecked `cmd rd /s /q` fallback. The macro either
  ; leaves $INSTDIR empty and real, or aborts with a nonzero exit preserving
  ; the previous tree. It also removes the now-redundant skills-subtree
  ; deletion: a clean destination cannot retain any stale bundled file.
  !insertmacro ClawXPrepareInstallDirectory

  ; Pre-emptively remove the old uninstall registry entry so that
  ; electron-builder's uninstallOldVersion skips the old uninstaller entirely.
  ;
  ; Why: uninstallOldVersion has a hardcoded 5-retry loop that runs the old
  ; uninstaller repeatedly.  The old uninstaller's atomicRMDir fails on locked
  ; files (antivirus, indexing) causing a blocking "ClawX 无法关闭" dialog.
  ; Deleting UninstallString makes uninstallOldVersion return immediately.
  ; The new installer will overwrite / extract all files on top of the old dir.
  ; registryAddInstallInfo will write the correct new entries afterwards.
  ; Clean both SHELL_CONTEXT and HKCU to cover cross-hive upgrades
  ; (e.g. old install was per-user, new install is per-machine or vice versa).
  DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" UninstallString
  DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" QuietUninstallString
  DeleteRegValue HKCU "${UNINSTALL_REGISTRY_KEY}" UninstallString
  DeleteRegValue HKCU "${UNINSTALL_REGISTRY_KEY}" QuietUninstallString
  !ifdef UNINSTALL_REGISTRY_KEY_2
    DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY_2}" UninstallString
    DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY_2}" QuietUninstallString
    DeleteRegValue HKCU "${UNINSTALL_REGISTRY_KEY_2}" UninstallString
    DeleteRegValue HKCU "${UNINSTALL_REGISTRY_KEY_2}" QuietUninstallString
  !endif
!macroend

; Override electron-builder's handleUninstallResult to prevent the
; "ClawX 无法关闭" retry dialog when the old uninstaller fails.
;
; During upgrades, electron-builder copies the old uninstaller to a temp dir
; and runs it silently.  The old uninstaller uses atomicRMDir to rename every
; file out of $INSTDIR.  If ANY file is still locked (antivirus scanner,
; Windows Search indexer, delayed kernel handle release after taskkill), it
; aborts with a non-zero exit code.  The default handler retries 5× then shows
; a blocking MessageBox.
;
; This macro clears the error and lets the new installer proceed. This is
; safe only because ClawXPrepareInstallDirectory already ran in
; customCheckAppRunning: $INSTDIR is a verified-empty directory (or the
; installer has aborted), so a failing old uninstaller cannot leave stale
; runtime files inside the new installation. Leftovers of the old tree live
; only in the exact $ClawXStaleInstallDir rollback directory.
!macro customUnInstallCheck
  ${if} $R0 != 0
    DetailPrint "Old uninstaller exited with code $R0. Continuing with overwrite install..."
  ${endIf}
  ClearErrors
!macroend

; Same safety net for the HKEY_CURRENT_USER uninstall path.
; Without this, handleUninstallResult would show a fatal error and Quit.
!macro customUnInstallCheckCurrentUser
  ${if} $R0 != 0
    DetailPrint "Old uninstaller (current user) exited with code $R0. Continuing..."
  ${endIf}
  ClearErrors
!macroend

!macro customInstall
  ; Async cleanup of the EXACT directory moved aside by this invocation of
  ; ClawXPrepareInstallDirectory (never a wildcard over arbitrary siblings —
  ; preexisting ._stale_* directories and other sibling installs are
  ; preserved). Tradeoff: deleting the moved tree after a successful payload
  ; install trades rollback retention for disk space, matching the previous
  ; release behavior; on any aborted install customInstall never runs, so the
  ; moved tree remains recoverable.
  ; Wait 60s before starting deletion to avoid I/O contention with ClawX's
  ; first launch (Windows Defender scan, ASAR mapping, etc.).
  ; ExecShell SW_HIDE is completely detached from NSIS and avoids pipe blocking.
  ${If} $ClawXStaleInstallDir != ""
    ExecShell "" "cmd.exe" `/c ping -n 61 127.0.0.1 >nul & rd /s /q "$ClawXStaleInstallDir"` SW_HIDE
  ${EndIf}
  DetailPrint "Core files extracted. Finalizing system integration..."

  ; Enable Windows long path support (Windows 10 1607+ / Windows 11).
  ; pnpm virtual store paths can exceed the default MAX_PATH limit of 260 chars.
  ; Writing to HKLM requires admin privileges; on per-user installs without
  ; elevation this call silently fails — no crash, just no key written.
  DetailPrint "Enabling long-path support (if permissions allow)..."
  WriteRegDWORD HKLM "SYSTEM\CurrentControlSet\Control\FileSystem" "LongPathsEnabled" 1

  ; Add $INSTDIR to Windows Defender exclusion list so that real-time scanning
  ; doesn't block the first app launch (Defender scans every newly-created file,
  ; causing 10-30s startup delay on a fresh install).  Requires elevation;
  ; silently fails on non-admin per-user installs (no harm done).
  DetailPrint "Configuring Windows Defender exclusion..."
  nsExec::ExecToStack `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Add-MpPreference -ExclusionPath '$INSTDIR' -ErrorAction SilentlyContinue"`
  Pop $0
  Pop $1

  ; Use PowerShell to update the current user's PATH.
  ; This avoids NSIS string-buffer limits and preserves long PATH values.
  DetailPrint "Updating user PATH for the OpenClaw CLI..."
  InitPluginsDir
  ClearErrors
  File "/oname=$PLUGINSDIR\update-user-path.ps1" "${PROJECT_DIR}\resources\cli\win32\update-user-path.ps1"
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\update-user-path.ps1" -Action add -CliDir "$INSTDIR\resources\cli"'
  Pop $0
  Pop $1
  StrCmp $0 "error" 0 +2
    DetailPrint "Warning: Failed to launch PowerShell while updating PATH."
  StrCmp $0 "timeout" 0 +2
    DetailPrint "Warning: PowerShell PATH update timed out."
  StrCmp $0 "0" 0 +2
    Goto _ci_done
  DetailPrint "Warning: PowerShell PATH update exited with code $0."

  _ci_done:
  DetailPrint "Installation steps complete."
!macroend

!macro customUnInstall
  ; Remove Windows Defender exclusion added during install
  nsExec::ExecToStack `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Remove-MpPreference -ExclusionPath '$INSTDIR' -ErrorAction SilentlyContinue"`
  Pop $0
  Pop $1

  ; Remove resources\cli from user PATH via PowerShell so long PATH values are handled safely
  InitPluginsDir
  ClearErrors
  File "/oname=$PLUGINSDIR\update-user-path.ps1" "${PROJECT_DIR}\resources\cli\win32\update-user-path.ps1"
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\update-user-path.ps1" -Action remove -CliDir "$INSTDIR\resources\cli"'
  Pop $0
  Pop $1
  StrCmp $0 "error" 0 +2
    DetailPrint "Warning: Failed to launch PowerShell while removing PATH entry."
  StrCmp $0 "timeout" 0 +2
    DetailPrint "Warning: PowerShell PATH removal timed out."
  StrCmp $0 "0" 0 +2
    Goto _cu_pathDone
  DetailPrint "Warning: PowerShell PATH removal exited with code $0."

  _cu_pathDone:

  ; Ask user if they want to remove AppData (preserves .openclaw)
  IfSilent _cu_skipRemove
  MessageBox MB_YESNO|MB_ICONQUESTION \
    "Do you want to remove ClawX application data?$\r$\n$\r$\nThis will delete:$\r$\n  • AppData\Local\clawx (local app data)$\r$\n  • AppData\Roaming\clawx (roaming app data)$\r$\n$\r$\nYour .openclaw folder (configuration & skills) will be preserved.$\r$\nSelect 'No' to keep all data for future reinstallation." \
    /SD IDNO IDYES _cu_removeData IDNO _cu_skipRemove

  _cu_removeData:
    ; Kill any lingering ClawX processes (and their child process trees) to
    ; release file locks on electron-store JSON files, Gateway sockets, etc.
    ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
    ${if} $R0 == 0
      nsExec::ExecToStack 'taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}"'
      Pop $0
      Pop $1
    ${endIf}
    ${nsProcess::Unload}

    ; Wait for processes to fully exit and release file handles
    Sleep 2000

    ; --- Always remove current user's AppData first ---
    ; NOTE: .openclaw directory is intentionally preserved (user configuration & skills)
    ; NOTE: clears BOTH "clawx" (legacy) and "Ministry of Education" (current MoE
    ; pilot productName). Without the productName entry, Electron's userData
    ; (Local Storage, Cache, providers config, gateway tokens) survives a
    ; reinstall and can carry stale state into the fresh build.
    RMDir /r "$LOCALAPPDATA\clawx"
    RMDir /r "$APPDATA\clawx"
    RMDir /r "$LOCALAPPDATA\Ministry of Education"
    RMDir /r "$APPDATA\Ministry of Education"

    ; --- Retry: if directories still exist (locked files), wait and try again ---

    ; Check AppData\Local\clawx
    IfFileExists "$LOCALAPPDATA\clawx\*.*" 0 _cu_localDone
      Sleep 3000
      RMDir /r "$LOCALAPPDATA\clawx"
      IfFileExists "$LOCALAPPDATA\clawx\*.*" 0 _cu_localDone
        nsExec::ExecToStack 'cmd.exe /c rd /s /q "$LOCALAPPDATA\clawx"'
        Pop $0
        Pop $1
    _cu_localDone:

    ; Check AppData\Roaming\clawx
    IfFileExists "$APPDATA\clawx\*.*" 0 _cu_roamingDone
      Sleep 3000
      RMDir /r "$APPDATA\clawx"
      IfFileExists "$APPDATA\clawx\*.*" 0 _cu_roamingDone
        nsExec::ExecToStack 'cmd.exe /c rd /s /q "$APPDATA\clawx"'
        Pop $0
        Pop $1
    _cu_roamingDone:

    ; Check AppData\Local\Ministry of Education
    IfFileExists "$LOCALAPPDATA\Ministry of Education\*.*" 0 _cu_moeLocalDone
      Sleep 3000
      RMDir /r "$LOCALAPPDATA\Ministry of Education"
      IfFileExists "$LOCALAPPDATA\Ministry of Education\*.*" 0 _cu_moeLocalDone
        nsExec::ExecToStack 'cmd.exe /c rd /s /q "$LOCALAPPDATA\Ministry of Education"'
        Pop $0
        Pop $1
    _cu_moeLocalDone:

    ; Check AppData\Roaming\Ministry of Education
    IfFileExists "$APPDATA\Ministry of Education\*.*" 0 _cu_moeRoamingDone
      Sleep 3000
      RMDir /r "$APPDATA\Ministry of Education"
      IfFileExists "$APPDATA\Ministry of Education\*.*" 0 _cu_moeRoamingDone
        nsExec::ExecToStack 'cmd.exe /c rd /s /q "$APPDATA\Ministry of Education"'
        Pop $0
        Pop $1
    _cu_moeRoamingDone:

    ; --- Final check: warn user if any directories could not be removed ---
    StrCpy $R3 ""
    IfFileExists "$LOCALAPPDATA\clawx\*.*" 0 +2
      StrCpy $R3 "$R3$\r$\n  • $LOCALAPPDATA\clawx"
    IfFileExists "$APPDATA\clawx\*.*" 0 +2
      StrCpy $R3 "$R3$\r$\n  • $APPDATA\clawx"
    IfFileExists "$LOCALAPPDATA\Ministry of Education\*.*" 0 +2
      StrCpy $R3 "$R3$\r$\n  • $LOCALAPPDATA\Ministry of Education"
    IfFileExists "$APPDATA\Ministry of Education\*.*" 0 +2
      StrCpy $R3 "$R3$\r$\n  • $APPDATA\Ministry of Education"
    StrCmp $R3 "" _cu_cleanupOk
      MessageBox MB_OK|MB_ICONEXCLAMATION \
        "Some data directories could not be removed (files may be in use):$\r$\n$R3$\r$\n$\r$\nPlease delete them manually after restarting your computer."
    _cu_cleanupOk:

    ; --- For per-machine (all users) installs, enumerate all user profiles ---
    StrCpy $R0 0

  _cu_enumLoop:
    EnumRegKey $R1 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList" $R0
    StrCmp $R1 "" _cu_enumDone

    ReadRegStr $R2 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\$R1" "ProfileImagePath"
    StrCmp $R2 "" _cu_enumNext

    ; ExpandEnvStrings requires distinct src and dest registers
    ExpandEnvStrings $R3 $R2
    StrCmp $R3 $PROFILE _cu_enumNext

    ; NOTE: .openclaw directory is intentionally preserved for all users
    ; Clear both legacy clawx and current Ministry of Education paths
    RMDir /r "$R3\AppData\Local\clawx"
    RMDir /r "$R3\AppData\Roaming\clawx"
    RMDir /r "$R3\AppData\Local\Ministry of Education"
    RMDir /r "$R3\AppData\Roaming\Ministry of Education"

  _cu_enumNext:
    IntOp $R0 $R0 + 1
    Goto _cu_enumLoop

  _cu_enumDone:
  _cu_skipRemove:
!macroend
