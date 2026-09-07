# pilot-shell-launch-shortcut.ps1
#
# Uses the logged-in Windows shell to open a shortcut. This can launch GUI apps
# into the console session more reliably than Start-Process over SSH.

[CmdletBinding()]
param(
  [string] $ShortcutPath = "$env:USERPROFILE\Desktop\Ministry of Education.lnk",
  [int] $WaitSeconds = 10
)

$ErrorActionPreference = "Continue"

function Write-State($name, $value) {
  "STATE:{0}={1}" -f $name, $value
}

Write-State "MODE" "ShellLaunchShortcut"
Write-State "TIMESTAMP" (Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz")
Write-State "USER" $env:USERNAME
Write-State "SHORTCUT" $ShortcutPath
Write-State "SHORTCUT_EXISTS" (Test-Path $ShortcutPath)

if (-not (Test-Path $ShortcutPath)) {
  Write-State "RESULT" "BLOCKED_SHORTCUT_MISSING"
  exit 2
}

try {
  $shell = New-Object -ComObject Shell.Application
  $shell.ShellExecute($ShortcutPath)
  Write-State "SHELL_EXECUTE" "True"
} catch {
  Write-State "SHELL_EXECUTE" "False"
  Write-State "ERROR" $_.Exception.Message
  Write-State "RESULT" "FAILED"
  exit 1
}

Start-Sleep -Seconds $WaitSeconds

$procs = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
  $_.Name -eq "Ministry of Education.exe" -or $_.ExecutablePath -like "*\Ministry of Education\Ministry of Education.exe"
})
Write-State "APP_PROCESS_COUNT" $procs.Count
foreach ($proc in $procs) {
  Write-State "APP_PROCESS" ("pid={0}|path={1}" -f $proc.ProcessId, $proc.ExecutablePath)
}

Write-State "RESULT" "COMPLETE"
