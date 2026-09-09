---
description: Install or verify Claude Code with Bedrock on the assigned Windows pilot target.
---

# Install Claude Code Bedrock On Windows

Install or verify Claude Code on the Windows pilot laptop using Amazon Bedrock.

Read first:

- `docs/CLAUDE_CODE_BEDROCK_WINDOWS_RUNBOOK.md`
- `.claude/skills/claude-bedrock-windows/SKILL.md`
- `.claude/skills/pilot-ssh-ops/SKILL.md`

Then run read-only local checks:

```bash
git status --short
test -f windows-pilot/scripts/pilot-install-claude-bedrock.ps1 && echo installer-ok
test -f windows-pilot/scripts/pilot-probe-claude-bedrock.ps1 && echo probe-ok
```

Default Windows install path:

```bash
scp windows-pilot/scripts/pilot-install-claude-bedrock.ps1 windows-pilot/scripts/pilot-probe-claude-bedrock.ps1 pilot:/Users/vyonix/
ssh pilot 'powershell -NoProfile -ExecutionPolicy Bypass -File C:/Users/vyonix/pilot-install-claude-bedrock.ps1 -AwsRegion us-east-1 -EnableAgentTeams'
ssh pilot 'powershell -NoProfile -ExecutionPolicy Bypass -File C:/Users/vyonix/pilot-probe-claude-bedrock.ps1 -AwsRegion us-east-1'
```

Report:

- Claude Code installed or blocker.
- `%USERPROFILE%\.claude\settings.json` Bedrock state.
- AWS CLI / AWS identity state.
- Bedrock Anthropic model visibility.
- Whether Agent Teams env is enabled.

Never print AWS keys, tokens, passwords, email bodies, Forms URLs, or Host API bearer tokens.
