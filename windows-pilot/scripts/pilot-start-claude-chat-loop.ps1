# pilot-start-claude-chat-loop.ps1
# Starts a detached Claude Code run from the Windows chat-procedure loop prompt.
#
# Safe by default:
# - uses the committed prompt with explicit no-send/no-download/no-submit rules
# - writes stdout/debug logs under Downloads
# - does not mutate app state by itself; Claude decides from prompt + repo evidence

[CmdletBinding()]
param(
  [string] $Repo = "$env:USERPROFILE\Github\ClawX-release-moe10",
  [string] $PromptPath,
  [string] $LogRoot = "$env:USERPROFILE\Downloads",
  [string] $PermissionMode = "auto",
  [string] $Effort = "high"
)

$ErrorActionPreference = "Stop"

function Write-State($name, $value) {
  Write-Output ("STATE:{0}={1}" -f $name, $value)
}

function Test-Command($name) {
  return [bool](Get-Command $name -ErrorAction SilentlyContinue)
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

if (-not (Test-Command "claude")) {
  throw "Claude Code command is not on PATH."
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$logDir = Join-Path $LogRoot ("clawx-claude-loop-" + $stamp)
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$stdoutPath = Join-Path $logDir "claude-stdout.txt"
$debugPath = Join-Path $logDir "claude-debug.log"
$runnerPath = Join-Path $logDir "run-claude-loop.ps1"

$runner = @"
`$ErrorActionPreference = "Continue"
Set-Location -LiteralPath '$Repo'
`$prompt = Get-Content -Raw -LiteralPath '$PromptPath'
`$started = Get-Date -Format o
"STARTED=`$started" | Set-Content -Path '$stdoutPath' -Encoding UTF8
& claude -p --permission-mode '$PermissionMode' --effort '$Effort' --debug-file '$debugPath' `$prompt *>> '$stdoutPath'
`$exitCode = `$LASTEXITCODE
`$ended = Get-Date -Format o
"ENDED=`$ended" | Add-Content -Path '$stdoutPath'
"EXIT_CODE=`$exitCode" | Add-Content -Path '$stdoutPath'
exit `$exitCode
"@

$runner | Set-Content -Path $runnerPath -Encoding UTF8

$process = Start-Process -FilePath "powershell.exe" `
  -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $runnerPath) `
  -WorkingDirectory $Repo `
  -PassThru

Write-State "STARTED" "CLAUDE_CHAT_LOOP"
Write-State "PID" $process.Id
Write-State "LOG_DIR" $logDir
Write-State "STDOUT" $stdoutPath
Write-State "DEBUG_LOG" $debugPath
Write-State "RUNNER" $runnerPath
