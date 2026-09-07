# pilot-window-process-probe.ps1
#
# Capture matching processes plus their visible top-level windows. Useful for
# diagnosing NSIS installers that appear stuck with no child process.

[CmdletBinding()]
param(
  [string] $NamePattern = "Education|Ministry|setup|nsis|installer"
)

$ErrorActionPreference = "Continue"

Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class PilotWin32 {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);

  [DllImport("user32.dll", SetLastError = true)]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
}
"@

function Get-WindowMap {
  $map = @{}
  $callback = [PilotWin32+EnumWindowsProc]{
    param([IntPtr] $hWnd, [IntPtr] $lParam)
    if (-not [PilotWin32]::IsWindowVisible($hWnd)) {
      return $true
    }
    $processId = [uint32]0
    [void][PilotWin32]::GetWindowThreadProcessId($hWnd, [ref]$processId)
    if ($processId -eq 0) {
      return $true
    }
    $buffer = New-Object System.Text.StringBuilder 512
    [void][PilotWin32]::GetWindowText($hWnd, $buffer, $buffer.Capacity)
    $title = $buffer.ToString()
    if (-not $map.ContainsKey([int]$processId)) {
      $map[[int]$processId] = New-Object System.Collections.Generic.List[object]
    }
    $map[[int]$processId].Add([pscustomobject]@{
      Handle = ("0x{0:X}" -f $hWnd.ToInt64())
      Title = $title
    })
    return $true
  }
  [void][PilotWin32]::EnumWindows($callback, [IntPtr]::Zero)
  return $map
}

$windowMap = Get-WindowMap
$processes = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
  ($_.Name -match $NamePattern) -or
  ($_.CommandLine -match $NamePattern) -or
  ($_.ExecutablePath -match $NamePattern)
} | Sort-Object ProcessId)

$rows = foreach ($proc in $processes) {
  $windows = @()
  if ($windowMap.ContainsKey([int]$proc.ProcessId)) {
    $windows = @($windowMap[[int]$proc.ProcessId])
  }
  $gp = Get-Process -Id $proc.ProcessId -ErrorAction SilentlyContinue
  [pscustomobject]@{
    ProcessId = $proc.ProcessId
    ParentProcessId = $proc.ParentProcessId
    Name = $proc.Name
    ExecutablePath = $proc.ExecutablePath
    CommandLine = $proc.CommandLine
    MainWindowTitle = $gp.MainWindowTitle
    MainWindowHandle = if ($gp) { ("0x{0:X}" -f $gp.MainWindowHandle.ToInt64()) } else { $null }
    Responding = if ($gp) { $gp.Responding } else { $null }
    Windows = $windows
  }
}

$rows | ConvertTo-Json -Depth 6
