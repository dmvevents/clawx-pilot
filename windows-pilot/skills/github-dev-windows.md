---
name: github-dev-windows
description: Bootstrap Git/GitHub CLI/Node/pnpm/AWS CLI and clone/update the ClawX pilot repo on the Windows laptop, then prepare Claude Code session control.
metadata:
  os: windows
  related-doc: docs/WINDOWS_GITHUB_CLAUDE_DEV_RUNBOOK.md
---

# GitHub dev on Windows pilot

## Goal

Use the Windows laptop as a real ClawX development/debug target.

## If SSH Is Down

Run locally on Windows as Administrator:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\pilot-enable-openssh.ps1
```

## Bootstrap

From Mac after SSH works:

```bash
scp windows-pilot/scripts/pilot-bootstrap-github-dev.ps1 windows-pilot/scripts/pilot-probe-github-dev.ps1 pilot:/Users/vyonix/
ssh pilot 'powershell -NoProfile -ExecutionPolicy Bypass -File C:/Users/vyonix/pilot-bootstrap-github-dev.ps1 -RunGhLogin -InstallAwsCli'
ssh pilot 'powershell -NoProfile -ExecutionPolicy Bypass -File C:/Users/vyonix/pilot-probe-github-dev.ps1'
```

## Session Control

Preferred persistent terminal control is WSL + tmux:

```bash
scp windows-pilot/scripts/pilot-setup-claude-wsl-tmux.ps1 pilot:/Users/vyonix/
ssh pilot 'powershell -NoProfile -ExecutionPolicy Bypass -File C:/Users/vyonix/pilot-setup-claude-wsl-tmux.ps1 -StartSession -SyncClaudeSettings'
```

Use native PowerShell scripts for deterministic probes/builds when WSL/tmux is unavailable.

## Safety

Never print GitHub tokens, AWS keys, Claude tokens, passwords, email bodies, Forms URLs, or Host API bearer tokens.
