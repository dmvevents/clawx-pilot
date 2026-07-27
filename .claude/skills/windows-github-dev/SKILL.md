---
name: windows-github-dev
description: Configure the Windows pilot laptop as a GitHub-backed ClawX development target with Git, GitHub CLI, Node/pnpm, repo clone/update, Claude Code Bedrock, and optional WSL/tmux session control.
---

# Windows GitHub Dev

## Purpose

Use this skill to move the project onto the Windows laptop, configure GitHub, and make Claude Code controllable there for faster Windows debugging.

## First Reads

- `docs/WINDOWS_GITHUB_CLAUDE_DEV_RUNBOOK.md`
- `docs/CLAUDE_CODE_BEDROCK_WINDOWS_RUNBOOK.md`
- `windows-pilot/scripts/pilot-enable-openssh.ps1`
- `windows-pilot/scripts/pilot-bootstrap-github-dev.ps1`
- `windows-pilot/scripts/pilot-probe-github-dev.ps1`
- `windows-pilot/scripts/pilot-setup-claude-wsl-tmux.ps1`

## Current Known SSH State

If `ssh pilot` reports connection refused while ping works, Windows is reachable but OpenSSH Server is not listening. Restore SSH locally on Windows with `pilot-enable-openssh.ps1`.

## Bootstrap

After SSH works:

```bash
scp windows-pilot/scripts/pilot-bootstrap-github-dev.ps1 windows-pilot/scripts/pilot-probe-github-dev.ps1 pilot:/Users/vyonix/
ssh pilot 'powershell -NoProfile -ExecutionPolicy Bypass -File C:/Users/vyonix/pilot-bootstrap-github-dev.ps1 -RunGhLogin -InstallAwsCli'
ssh pilot 'powershell -NoProfile -ExecutionPolicy Bypass -File C:/Users/vyonix/pilot-probe-github-dev.ps1'
```

## Session Control

Preferred persistent terminal path:

```bash
scp windows-pilot/scripts/pilot-setup-claude-wsl-tmux.ps1 pilot:/Users/vyonix/
ssh pilot 'powershell -NoProfile -ExecutionPolicy Bypass -File C:/Users/vyonix/pilot-setup-claude-wsl-tmux.ps1 -StartSession -SyncClaudeSettings'
ssh -t pilot 'wsl -- tmux attach -t clawx-claude'
```

If WSL/tmux is not ready, use native PowerShell scripts for builds/probes and Claude Code Agent Teams for in-session parallelism.

## Safety

- Never print GitHub tokens, AWS keys, Claude tokens, passwords, Host API tokens, email bodies, or Forms URLs.
- Do not push to upstream `ValueCell-ai/ClawX` without explicit confirmation.
- Do not overwrite dirty local work on either Mac or Windows.
