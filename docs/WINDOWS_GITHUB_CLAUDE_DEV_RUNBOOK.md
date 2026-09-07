# Windows GitHub + Claude Code Dev Loop

Last updated: 2026-05-29.

This runbook sets up the Windows laptop as a real development/debug target: GitHub CLI, Git, Node/pnpm, the ClawX pilot repo, Claude Code with Bedrock, and a controllable session strategy.

## Current SSH Status

From the Mac on 2026-05-29:

```text
ping 169.254.46.90 -> OK, 0% packet loss
nc 169.254.46.90 22 -> connection refused
ssh pilot -> connection refused
```

Interpretation: the laptop is physically reachable over Ethernet, but Windows OpenSSH Server is stopped, not installed, disabled, or blocked by firewall.

## Restore SSH First

If SSH is down, run this locally on the Windows laptop in an Administrator PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\pilot-enable-openssh.ps1
```

If the script is not on the laptop yet, copy it by USB, browser download, or paste it from:

- `windows-pilot/scripts/pilot-enable-openssh.ps1`

Then verify from the Mac:

```bash
ssh -o ConnectTimeout=5 pilot 'echo ok'
```

## Bootstrap GitHub Dev Tools

Once SSH works:

```bash
scp windows-pilot/scripts/pilot-bootstrap-github-dev.ps1 windows-pilot/scripts/pilot-probe-github-dev.ps1 pilot:/Users/vyonix/
ssh pilot 'powershell -NoProfile -ExecutionPolicy Bypass -File C:/Users/vyonix/pilot-bootstrap-github-dev.ps1 -RunGhLogin -InstallAwsCli'
ssh pilot 'powershell -NoProfile -ExecutionPolicy Bypass -File C:/Users/vyonix/pilot-probe-github-dev.ps1'
```

The bootstrap installs:

- Git for Windows
- GitHub CLI
- Node.js LTS
- optional AWS CLI
- repo clone/update at `%USERPROFILE%\Github\ClawX`

Default repo target:

```text
dmvevents/clawx-pilot
```

Do not push to upstream `ValueCell-ai/ClawX` without explicit confirmation.

## GitHub Auth

Preferred auth flow:

```powershell
gh auth login --hostname github.com --git-protocol https --web
```

This opens a browser/device flow on the Windows laptop. Do not paste GitHub tokens into chat or repo files.

Verify:

```powershell
gh auth status --hostname github.com
git remote -v
```

## Claude Code + Bedrock

Use the Bedrock runbook:

- `docs/CLAUDE_CODE_BEDROCK_WINDOWS_RUNBOOK.md`

After GitHub bootstrap:

```bash
scp windows-pilot/scripts/pilot-install-claude-bedrock.ps1 windows-pilot/scripts/pilot-probe-claude-bedrock.ps1 pilot:/Users/vyonix/
ssh pilot 'powershell -NoProfile -ExecutionPolicy Bypass -File C:/Users/vyonix/pilot-install-claude-bedrock.ps1 -AwsRegion us-east-1 -EnableAgentTeams'
ssh pilot 'powershell -NoProfile -ExecutionPolicy Bypass -File C:/Users/vyonix/pilot-probe-claude-bedrock.ps1 -AwsRegion us-east-1'
```

## Session Management Strategy

There are three usable levels.

### Level 1 - Claude Code Agent Teams

Use this for work coordination inside Claude Code. The Bedrock installer can set:

```text
CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1
```

Workers must get explicit context files; they do not inherit the lead chat.

### Level 2 - WSL + tmux

Best for persistent remote terminal control from the Mac:

```bash
scp windows-pilot/scripts/pilot-setup-claude-wsl-tmux.ps1 pilot:/Users/vyonix/
ssh pilot 'powershell -NoProfile -ExecutionPolicy Bypass -File C:/Users/vyonix/pilot-setup-claude-wsl-tmux.ps1 -StartSession -SyncClaudeSettings'
ssh -t pilot 'wsl -- tmux attach -t clawx-claude'
```

If WSL/tmux/Claude are missing, the script reports the exact blocker. Installing WSL or tmux may require admin rights, internet, a reboot, or first-launch setup.

### Level 3 - Native Windows Commands

Use SSH + PowerShell scripts for deterministic probes/builds:

```bash
ssh pilot 'powershell -NoProfile -ExecutionPolicy Bypass -File C:/Users/vyonix/pilot-probe-github-dev.ps1'
```

This is reliable for builds and diagnostics, but it is not a persistent interactive Claude session.

## Validation Checklist

Pass state:

- SSH accepts `ssh pilot 'echo ok'`.
- Git, GitHub CLI, Node, corepack/pnpm are present.
- `gh auth status` succeeds.
- `%USERPROFILE%\Github\ClawX` exists and has the `pilot` repo.
- Claude Code is installed.
- Claude Code Bedrock probe passes or reports a concrete AWS credential/model-access blocker.
- Either Agent Teams is enabled or WSL/tmux session control is available.

## Safety

- Do not print GitHub tokens, AWS keys, Claude tokens, Host API tokens, passwords, email bodies, Forms URLs, or full recipient lists.
- Do not move real development to the Windows clone until `git status --short` is clean or intentionally documented on both machines.
- Back up Windows app state before mutating `%APPDATA%\Ministry of Education` or `%USERPROFILE%\.openclaw`.
