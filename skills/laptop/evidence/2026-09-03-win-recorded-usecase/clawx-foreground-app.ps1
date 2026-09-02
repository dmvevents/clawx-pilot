# clawx-foreground-app.ps1 (runs INSIDE session 1 as an interactive task)
# Dismiss any stray Windows dialog, then bring the Ministry of Education main
# window to the foreground and maximize it so the screen recording shows the app.
$ErrorActionPreference = "SilentlyContinue"
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
}
"@
# Give any first-run OS dialog (e.g. Networks) a moment, then send Esc to dismiss.
$wsh = New-Object -ComObject WScript.Shell
Start-Sleep -Milliseconds 500
$wsh.SendKeys("{ESC}")
Start-Sleep -Milliseconds 500

$SW_RESTORE = 9; $SW_MAXIMIZE = 3
# Target the Electron app PROCESS (name), not any window whose *title* happens to
# contain the install path (e.g. the ffmpeg console). Only the browser process
# owns a real MainWindowHandle.
$procs = Get-Process -Name "Ministry of Education" -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne 0 }
foreach ($p in $procs) {
    [Win32]::ShowWindow($p.MainWindowHandle, $SW_RESTORE) | Out-Null
    [Win32]::ShowWindow($p.MainWindowHandle, $SW_MAXIMIZE) | Out-Null
    [Win32]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
    Write-Output ("FOREGROUNDED pid={0} title={1}" -f $p.Id, $p.MainWindowTitle)
}
if (-not $procs) { Write-Output "NO_APP_WINDOW_WITH_TITLE" }
