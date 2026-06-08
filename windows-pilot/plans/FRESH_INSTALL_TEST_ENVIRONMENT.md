# Fresh Install Test Environment

Date: 2026-06-05
Last updated: 2026-06-06

## Goal

Reproduce what a new Windows user sees after downloading the installer without
uninstalling, deleting, or corrupting the current laptop user profile.

## Strategy

Use three layers:

1. **Probe current laptop state** with `pilot-fresh-install-environment.ps1
   -Mode Probe`. This is read-only.
2. **Run a clean Windows Sandbox install** with `-Mode CreateSandbox`. This
   creates a `.wsb` launcher and an inside-sandbox bootstrap script. The
   sandbox gets a clean user profile and can install the same downloaded
   installer without touching the host user's `%APPDATA%`, `%LOCALAPPDATA%`,
   Outlook login, or Chrome profile.
3. **Use the existing clean Chrome profile harness** for browser automation
   edge cases: `pilot-clean-slate-cdp-harness.ps1 -Scenario ready` and
   `-Scenario profileLock`.
4. **Use the SSH temp-user smoke only as a host-safety probe**:
   `pilot-temp-user-fresh-install-smoke.ps1`. On Windows Home it can prove that
   SSH, installer discovery, temp-account creation, Task Scheduler, and cleanup
   work. It cannot be treated as the final installer acceptance test for this
   assisted per-user NSIS installer because there is no interactive desktop for
   the new user.

## Commands On The Laptop

From the repo on Windows:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\windows-pilot\scripts\pilot-fresh-install-environment.ps1 -Mode Probe
```

Create the sandbox package:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\windows-pilot\scripts\pilot-fresh-install-environment.ps1 -Mode CreateSandbox
```

Create and open the sandbox package:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\windows-pilot\scripts\pilot-fresh-install-environment.ps1 -Mode CreateSandbox -OpenSandbox
```

Inside the sandbox, the bootstrap script writes evidence into the mapped
artifact folder on the host. Expected evidence:

- installer found
- installer silent exit code
- installed app executable present
- app launch attempted
- relevant ports checked
- latest app log copied if present

## Interpreting Results

| State | Meaning | Action |
|---|---|---|
| `STATE:SANDBOX_FEATURE=ENABLED` | Windows Sandbox can run now | Use `-Mode CreateSandbox -OpenSandbox` |
| `STATE:SANDBOX_FEATURE=DISABLED` | Feature exists but is off | Enable from Windows Features or admin PowerShell, reboot if required |
| `STATE:SANDBOX_FEATURE=UNAVAILABLE` | Windows edition does not support Sandbox | Use a VM or a temporary local Windows user |
| `STATE:INSTALLER_COUNT=0` | No installer found in Downloads | Copy the latest `.exe` into Downloads and rerun |
| `STATE:SANDBOX_PACKAGE_READY=...` | `.wsb` file generated | Double-click it or rerun with `-OpenSandbox` |

## Constraints

- Do not run the NSIS uninstaller or delete `%APPDATA%\Ministry of Education`
  in the real user profile for this test.
- Do not copy tokens, passwords, cookies, or Outlook content into the sandbox.
- The sandbox is expected to start without Chrome and without Microsoft sign-in.
  Browser automation should therefore report a clean setup state such as
  Chrome missing or sign-in required, not silently hang.
- Real Outlook/Forms account tests still happen in the main laptop profile or a
  dedicated test profile after the install smoke passes.

## Current Pilot Laptop Evidence

The 2026-06-05 probe over `ssh pilot` found:

- OS: Windows 11 Home build 26200.
- Windows Sandbox feature: unavailable on this edition.
- Current user is admin.
- Installer found in Downloads:
  `Ministry.of.Education-0.4.3-win-x64.exe`.
- Installed app, app data, and `.openclaw` state already exist.
- Gateway `18789`, Host API `13210`, and Chrome CDP `18792` were listening.
- Sandbox package generated at
  `C:\Users\VYONIX\Downloads\clawx-fresh-install-sandbox-20260605-195026\ClawXFreshInstall.wsb`,
  but it must be run on a Sandbox-capable Windows Pro/Enterprise machine or VM.

For this Windows Home laptop, use a temporary local Windows user or an external
VM to test a true clean first-run profile.

### 2026-06-06 SSH Temp-User Smoke Evidence

Command run from macOS against `ssh pilot`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\vyonix\pilot-temp-user-fresh-install-smoke.ps1 -LaunchWaitSeconds 25
```

Results:

- `Start-Process -Credential` created the temp profile but the installer exited
  with `-1073741502`; no app executable was created.
- `Register-ScheduledTask` initially registered a task that never ran
  (`LastRunTime=30/11/1999`, `LastTaskResult=267011`).
- `schtasks.exe` required `SeBatchLogonRight`; the harness now grants that
  right to the temporary SID via `secedit`, then restores the previous
  user-rights policy.
- After the grant, the task ran as `VYONIX\ClawXFresh104129` with profile
  `C:\Users\ClawXFresh104129`, invoked the installer copy, and returned task
  result `0`.
- Even with direct `/S` invocation from that scheduled task, the installer did
  not create
  `C:\Users\<temp>\AppData\Local\Programs\Ministry of Education\Ministry of Education.exe`,
  app data, or `.openclaw`.
- The harness restored user-rights policy and removed the local temp users.
  Windows kept two temp profile hives loaded; a one-time startup cleanup task
  `ClawXFreshProfileCleanupOnStart` is scheduled to remove only
  `C:\Users\ClawXFresh*` after the next reboot.

Conclusion: the SSH-only path is useful for probing and cleanup validation, but
it is not sufficient to certify the assisted per-user NSIS installer. The real
fresh-install acceptance test must run in an interactive temporary Windows user
session, a Windows Pro/Enterprise Sandbox, or a VM. Do not stop the existing
`vyonix` demo app/gateway just to force this SSH test; the live ports
`18789`, `13210`, and `18792` are part of the current working demo state.

## Windows Home Fallback: Temporary Local User

Do this interactively on the laptop, not over SSH. The installer is configured
as `oneClick: false`, `perMachine: false`, and
`allowToChangeInstallationDirectory: true`, so it needs the same kind of
desktop session a real user has.

```powershell
$pw = Read-Host "Temporary ClawXFreshTest password" -AsSecureString
New-LocalUser -Name "ClawXFreshTest" -Password $pw -FullName "ClawX Fresh Install Test"
Add-LocalGroupMember -Group "Users" -Member "ClawXFreshTest"
```

Then:

1. Sign out of `vyonix`.
2. Sign into `ClawXFreshTest`.
3. Copy or download the installer into that user's Downloads folder.
4. Run the installer normally.
5. Open the app and capture:
   - first-launch time
   - Gateway readiness
   - provider default
   - `browser.diagnose` result
   - whether the app gives a clear Chrome/sign-in recovery state
6. Sign back into `vyonix`.
7. Remove the temporary account after evidence is collected:

```powershell
Remove-LocalUser -Name "ClawXFreshTest"
```

Do not add this temporary user to Administrators for the first acceptance pass.
If normal-user install fails interactively, run a second pass with an admin temp
user and record the difference.
