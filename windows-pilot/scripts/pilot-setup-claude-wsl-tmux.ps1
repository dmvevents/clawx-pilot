# pilot-setup-claude-wsl-tmux.ps1
# Probes or starts a controllable Claude Code session under WSL + tmux.
# Idempotent: yes. Mutating only when -StartSession or install switches are used.

[CmdletBinding()]
param(
  [string] $ProjectDir = "$env:USERPROFILE\Github\ClawX",
  [string] $SessionName = "clawx-claude",
  [string] $Distro = "",
  [switch] $StartSession,
  [switch] $InstallWslUbuntu,
  [switch] $InstallTmuxInWsl,
  [switch] $SyncClaudeSettings
)

$ErrorActionPreference = "Stop"

function Write-State($name, $value) {
  Write-Output ("STATE:{0}={1}" -f $name, $value)
}

function Test-Command($name) {
  return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

Write-State "START" "CLAUDE_WSL_TMUX_SETUP"

if (-not (Test-Command "wsl")) {
  Write-State "WSL" "MISSING"
  if ($InstallWslUbuntu) {
    Write-State "WSL_INSTALL" "START"
    wsl --install -d Ubuntu
    Write-State "WSL_INSTALL" "REQUESTED_REBOOT_MAY_BE_REQUIRED"
  }
  Write-State "DONE" "CLAUDE_WSL_TMUX_SETUP"
  exit 0
}

$distros = @(wsl.exe -l -q 2>$null | Where-Object { $_.Trim().Length -gt 0 } | ForEach-Object { $_.Trim() })
Write-State "WSL_DISTRO_COUNT" $distros.Count
foreach ($item in $distros) { Write-State "WSL_DISTRO" $item }

if ($distros.Count -eq 0) {
  Write-State "WSL" "NO_DISTRO"
  if ($InstallWslUbuntu) {
    wsl --install -d Ubuntu
    Write-State "WSL_INSTALL" "REQUESTED_REBOOT_OR_FIRST_LAUNCH"
  }
  Write-State "DONE" "CLAUDE_WSL_TMUX_SETUP"
  exit 0
}

if ($Distro.Trim().Length -eq 0) { $Distro = $distros[0] }
Write-State "WSL_SELECTED" $Distro

$wslRepo = (wsl.exe -d $Distro -- wslpath -a "$ProjectDir" 2>$null | Select-Object -First 1)
Write-State "WSL_REPO_PATH" $wslRepo

$tmuxState = "MISSING"
try {
  wsl.exe -d $Distro -- bash -lc "command -v tmux >/dev/null" 2>$null
  if ($LASTEXITCODE -eq 0) { $tmuxState = "PRESENT" }
} catch {
  $tmuxState = "MISSING"
}
Write-State "TMUX" $tmuxState

if ($InstallTmuxInWsl -and $tmuxState -ne "PRESENT") {
  Write-State "TMUX_INSTALL" "START"
  wsl.exe -d $Distro -- bash -lc "sudo apt-get update && sudo apt-get install -y tmux git curl"
  Write-State "TMUX_INSTALL" "DONE"
}

if ($SyncClaudeSettings) {
  $winSettings = Join-Path $env:USERPROFILE ".claude\settings.json"
  if (Test-Path $winSettings) {
    Write-State "CLAUDE_SETTINGS_SYNC" "START"
    wsl.exe -d $Distro -- bash -lc "mkdir -p ~/.claude && cp /mnt/c/Users/$env:USERNAME/.claude/settings.json ~/.claude/settings.json && chmod 600 ~/.claude/settings.json"
    Write-State "CLAUDE_SETTINGS_SYNC" "DONE"
  } else {
    Write-State "CLAUDE_SETTINGS_SYNC" "SKIPPED_NO_WINDOWS_SETTINGS"
  }
}

$claudeState = "MISSING"
try {
  wsl.exe -d $Distro -- bash -lc "command -v claude >/dev/null" 2>$null
  if ($LASTEXITCODE -eq 0) { $claudeState = "PRESENT" }
} catch {
  $claudeState = "MISSING"
}
Write-State "CLAUDE_WSL" $claudeState

if ($StartSession) {
  if ($tmuxState -ne "PRESENT") {
    Write-State "START_SESSION" "BLOCKED_NO_TMUX"
  } elseif ($claudeState -ne "PRESENT") {
    Write-State "START_SESSION" "BLOCKED_NO_CLAUDE_IN_WSL"
  } elseif (-not (Test-Path $ProjectDir)) {
    Write-State "START_SESSION" "BLOCKED_NO_PROJECT_DIR"
  } else {
    $cmd = "cd '$wslRepo' && tmux new-session -d -s '$SessionName' 'claude' 2>/dev/null || true && tmux has-session -t '$SessionName'"
    wsl.exe -d $Distro -- bash -lc $cmd
    if ($LASTEXITCODE -eq 0) {
      Write-State "START_SESSION" "OK"
      Write-State "ATTACH_COMMAND" ("ssh -t pilot 'wsl -d {0} -- tmux attach -t {1}'" -f $Distro, $SessionName)
      Write-State "CAPTURE_COMMAND" ("ssh pilot 'wsl -d {0} -- tmux capture-pane -pt {1} -S -120'" -f $Distro, $SessionName)
    } else {
      Write-State "START_SESSION" "FAILED"
    }
  }
}

Write-State "DONE" "CLAUDE_WSL_TMUX_SETUP"
