# pilot-start-claude-chat-loop.ps1
# Starts a detached Claude Code run from the Windows chat-procedure loop prompt.
#
# Safe by default:
# - uses the committed prompt with explicit no-send/no-download/no-submit rules
# - writes stdout/debug logs under Downloads
# - can reuse an already-running scheduled task instead of interrupting it

[CmdletBinding()]
param(
  [string] $Repo = "$env:USERPROFILE\Github\ClawX-release-moe10",
  [string] $PromptPath,
  [string] $LogRoot = "$env:USERPROFILE\Downloads",
  [string] $PermissionMode = "default",
  [string] $Effort = "high",
  [string] $AllowedTools = "Bash(powershell.exe *),Bash(git *),Bash(node *),Bash(pnpm *),Bash(npm *),Bash(npx *),Read,Edit,Write,Glob,Grep",
  [string] $TaskName = "ClawX Claude Chat Loop",
  [switch] $ReuseIfRunning,
  [int] $WaitSeconds = 12,
  [int] $ExecutionHours = 9
)

$ErrorActionPreference = "Stop"

function Write-State($name, $value) {
  Write-Output ("STATE:{0}={1}" -f $name, $value)
}

function ConvertTo-PowerShellSingleQuotedLiteral([string] $value) {
  return "'" + ($value -replace "'", "''") + "'"
}

if (-not (Test-Path $Repo)) {
  throw "Repo missing: $Repo"
}

if (-not $PromptPath) {
  $PromptPath = Join-Path $Repo "windows-pilot\plans\CLAUDE_WINDOWS_CHAT_PROCEDURE_LOOP_PROMPT_2026-06-03.md"
}

if (-not (Test-Path $PromptPath)) {
  throw "Prompt file missing: $PromptPath"
}

$claudeCommand = Get-Command "claude" -ErrorAction SilentlyContinue
if (-not $claudeCommand) {
  throw "Claude Code command is not on PATH."
}
$claudePath = if ($claudeCommand.Path) { $claudeCommand.Path } else { $claudeCommand.Source }
if (-not $claudePath) {
  throw "Claude Code command path could not be resolved."
}

$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existingTask -and $existingTask.State -eq "Running" -and $ReuseIfRunning) {
  $taskInfo = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue
  Write-State "STARTED" "CLAUDE_CHAT_LOOP_REUSED"
  Write-State "TASK_NAME" $TaskName
  Write-State "TASK_USER" $user
  Write-State "TASK_STATE" $existingTask.State
  Write-State "TASK_LAST_RESULT" $(if ($taskInfo) { $taskInfo.LastTaskResult } else { "unknown" })
  Write-State "REUSE_IF_RUNNING" $true
  exit 0
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$logDir = Join-Path $LogRoot ("clawx-claude-loop-" + $stamp)
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$stdoutPath = Join-Path $logDir "claude-stdout.txt"
$debugPath = Join-Path $logDir "claude-debug.log"
$runnerPath = Join-Path $logDir "run-claude-loop.ps1"

$repoLiteral = ConvertTo-PowerShellSingleQuotedLiteral $Repo
$promptLiteral = ConvertTo-PowerShellSingleQuotedLiteral $PromptPath
$stdoutLiteral = ConvertTo-PowerShellSingleQuotedLiteral $stdoutPath
$debugLiteral = ConvertTo-PowerShellSingleQuotedLiteral $debugPath
$claudeLiteral = ConvertTo-PowerShellSingleQuotedLiteral $claudePath
$permissionLiteral = ConvertTo-PowerShellSingleQuotedLiteral $PermissionMode
$effortLiteral = ConvertTo-PowerShellSingleQuotedLiteral $Effort
$allowedToolsLiteral = ConvertTo-PowerShellSingleQuotedLiteral $AllowedTools

$runner = @"
`$ErrorActionPreference = "Continue"
`$RepoPath = $repoLiteral
`$PromptFile = $promptLiteral
`$StdoutFile = $stdoutLiteral
`$DebugFile = $debugLiteral
`$ClaudeExe = $claudeLiteral
`$AllowedToolsValue = $allowedToolsLiteral
Set-Location -LiteralPath `$RepoPath
`$rawPrompt = Get-Content -Raw -LiteralPath `$PromptFile
`$promptLines = `$rawPrompt -split "`r?`n"
`$fenceStart = -1
`$fenceEnd = -1
for (`$i = 0; `$i -lt `$promptLines.Count; `$i++) {
  if (`$promptLines[`$i].Trim().StartsWith("```")) {
    if (`$fenceStart -lt 0) {
      `$fenceStart = `$i
    } else {
      `$fenceEnd = `$i
      break
    }
  }
}
if (`$fenceStart -ge 0 -and `$fenceEnd -gt `$fenceStart + 1) {
  `$bodyLines = `$promptLines[(`$fenceStart + 1)..(`$fenceEnd - 1)]
  `$promptBody = `$bodyLines -join "`r`n"
} elseif (`$rawPrompt.Trim().Length -gt 0) {
  `$promptBody = `$rawPrompt
} else {
  throw "Prompt file was empty: `$PromptFile"
}
if (`$promptBody.Trim().Length -lt 200) {
  throw "Prompt body extraction produced an unexpectedly short prompt (`$(`$promptBody.Trim().Length) chars): `$PromptFile"
}
`$prompt = "Execute the following instructions now from this Windows laptop session. Do not summarize the instructions, ask which option, or wait for a human unless a hard blocker or safety rule requires it. Start by running the First command and proceed through the recursive improvement loop.`r`n`r`n" + `$promptBody
`$started = Get-Date -Format o
"STARTED=`$started" | Set-Content -LiteralPath `$StdoutFile -Encoding UTF8
`$claudeArgs = @(
  "-p",
  "--permission-mode", $permissionLiteral,
  "--effort", $effortLiteral,
  "--debug-file", `$DebugFile,
  "--allowedTools", `$AllowedToolsValue
)
`$prompt | & `$ClaudeExe @claudeArgs *>> `$StdoutFile
`$exitCode = `$LASTEXITCODE
`$ended = Get-Date -Format o
"ENDED=`$ended" | Add-Content -LiteralPath `$StdoutFile
"EXIT_CODE=`$exitCode" | Add-Content -LiteralPath `$StdoutFile
exit `$exitCode
"@

$runner | Set-Content -Path $runnerPath -Encoding UTF8

$psExe = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$taskArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$runnerPath`""

$existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existingTask -and $existingTask.State -eq "Running") {
  Stop-ScheduledTask -TaskName $TaskName
  $stopDeadline = (Get-Date).AddSeconds(10)
  do {
    Start-Sleep -Milliseconds 500
    $existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  } while ($existingTask -and $existingTask.State -eq "Running" -and (Get-Date) -lt $stopDeadline)
}

$action = New-ScheduledTaskAction -Execute $psExe -Argument $taskArgs
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours $ExecutionHours)
$task = New-ScheduledTask -Action $action -Principal $principal -Settings $settings

Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

$runnerStarted = $false
$deadline = (Get-Date).AddSeconds($WaitSeconds)
while ((Get-Date) -lt $deadline) {
  if (Test-Path $stdoutPath) {
    $runnerStarted = $true
    break
  }
  Start-Sleep -Milliseconds 500
}

$taskInfo = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue
$taskState = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

Write-State "STARTED" "CLAUDE_CHAT_LOOP"
Write-State "TASK_NAME" $TaskName
Write-State "TASK_USER" $user
Write-State "TASK_STATE" $(if ($taskState) { $taskState.State } else { "unknown" })
Write-State "TASK_LAST_RESULT" $(if ($taskInfo) { $taskInfo.LastTaskResult } else { "unknown" })
Write-State "RUNNER_STARTED" $runnerStarted
Write-State "LOG_DIR" $logDir
Write-State "STDOUT" $stdoutPath
Write-State "DEBUG_LOG" $debugPath
Write-State "RUNNER" $runnerPath
