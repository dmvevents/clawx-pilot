# Bootstrap Windows GitHub Dev

Configure the Windows pilot laptop as a GitHub-backed ClawX dev target and prepare Claude Code session control.

Read:

- `docs/WINDOWS_GITHUB_CLAUDE_DEV_RUNBOOK.md`
- `.claude/skills/windows-github-dev/SKILL.md`
- `.claude/skills/claude-bedrock-windows/SKILL.md`

First check SSH:

```bash
ssh -o ConnectTimeout=5 -o BatchMode=yes pilot 'echo ok'
```

If SSH is refused but ping works, report that OpenSSH Server must be restored on Windows using:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\pilot-enable-openssh.ps1
```

If SSH works, run:

```bash
scp windows-pilot/scripts/pilot-bootstrap-github-dev.ps1 windows-pilot/scripts/pilot-probe-github-dev.ps1 windows-pilot/scripts/pilot-setup-claude-wsl-tmux.ps1 pilot:/Users/vyonix/
ssh pilot 'powershell -NoProfile -ExecutionPolicy Bypass -File C:/Users/vyonix/pilot-bootstrap-github-dev.ps1 -RunGhLogin -InstallAwsCli'
ssh pilot 'powershell -NoProfile -ExecutionPolicy Bypass -File C:/Users/vyonix/pilot-probe-github-dev.ps1'
```

Report Git/GitHub/Node/Claude/WSL readiness and next blocker. Do not print tokens or secrets.
