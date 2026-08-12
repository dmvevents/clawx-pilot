# pilot-app-event-probe.ps1
#
# Reads recent Windows Application events relevant to ClawX/Electron launch
# failures without relying on fragile SSH quoting.

[CmdletBinding()]
param(
  [int] $Minutes = 30,
  [int] $MaxEvents = 30
)

$ErrorActionPreference = "Continue"

function Write-State($name, $value) {
  "STATE:{0}={1}" -f $name, $value
}

Write-State "MODE" "AppEventProbe"
Write-State "SINCE" (Get-Date).AddMinutes(-1 * $Minutes).ToString("yyyy-MM-dd HH:mm:ss zzz")

$pattern = "Ministry|Education|ClawX|Electron|electron|app\.asar|node|playwright"
$providers = "Application Error|Windows Error Reporting|\.NET Runtime|Electron|Ministry|Education|ClawX"

$events = Get-WinEvent -FilterHashtable @{ LogName = "Application"; StartTime = (Get-Date).AddMinutes(-1 * $Minutes) } -ErrorAction SilentlyContinue |
  Where-Object {
    ($_.ProviderName -match $providers) -or
    ($_.Message -match $pattern)
  } |
  Sort-Object TimeCreated -Descending |
  Select-Object -First $MaxEvents

Write-State "EVENT_COUNT" @($events).Count

foreach ($event in $events) {
  $message = ($event.Message -replace "`r?`n", " " -replace "\s+", " ").Trim()
  if ($message.Length -gt 700) {
    $message = $message.Substring(0, 700) + "..."
  }
  Write-State "EVENT" ("time={0}|provider={1}|id={2}|level={3}|message={4}" -f
    $event.TimeCreated.ToString("yyyy-MM-dd HH:mm:ss"),
    $event.ProviderName,
    $event.Id,
    $event.LevelDisplayName,
    $message
  )
}

Write-State "RESULT" "COMPLETE"
