# pilot-stop-probe-processes.ps1
#
# Stop only pilot harness processes that can be left behind by SSH/CDP test
# runs. This intentionally does not stop the installed app itself.

[CmdletBinding()]
param()

$ErrorActionPreference = "Continue"

function Write-State([string] $name, $value) {
  "STATE:{0}={1}" -f $name, $value
}

$matches = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
  $_.CommandLine -like "*pilot-electron-cdp-probe.js*" -or
  $_.CommandLine -like "*pilot-launch-and-run-cdp-smoke.ps1*" -or
  $_.CommandLine -like "*pilot-run-electron-cdp-probe.ps1*"
})

Write-State "MATCH_COUNT" $matches.Count
foreach ($proc in $matches) {
  Write-State "MATCH" ("{0}|{1}" -f $proc.ProcessId, $proc.Name)
  try {
    Stop-Process -Id $proc.ProcessId -Force -ErrorAction Stop
    Write-State "STOPPED_PROCESS" $proc.ProcessId
  } catch {
    Write-State "STOP_PROCESS_ERROR" ("pid={0}|{1}" -f $proc.ProcessId, $_.Exception.Message)
  }
}
Write-State "RESULT" "COMPLETE"
