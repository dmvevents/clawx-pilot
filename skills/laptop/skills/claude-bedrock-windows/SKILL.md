---
name: claude-bedrock-windows
description: Install, configure, verify, or repair Claude Code on the Windows pilot laptop using Amazon Bedrock, including AWS credential checks, project skills, Agent Teams settings, and safe SSH deployment scripts.
---

# Claude Code Bedrock Windows

## Purpose

Use this skill when the task is to install Claude Code on the Windows laptop, configure it for Amazon Bedrock, verify AWS/Bedrock access, create Claude Code skills/commands/agents, or prepare Claude Agent Teams for the ClawX demo.

## First Reads

- `docs/CLAUDE_CODE_BEDROCK_WINDOWS_RUNBOOK.md`
- `docs/CLAUDE_CODE_RESUME_AND_TEAMS_GUIDE_2026-05-29.md`
- `windows-pilot/skills/pilot-ssh-ops.md`
- `windows-pilot/scripts/pilot-install-claude-bedrock.ps1`
- `windows-pilot/scripts/pilot-probe-claude-bedrock.ps1`

## Safety Rules

- Never print AWS keys, AWS session tokens, Claude tokens, Host API tokens, Outlook tokens, passwords, email bodies, or Forms URLs.
- Do not store credentials in repo files.
- Back up `%USERPROFILE%\.claude\settings.json` before writing.
- Treat Bedrock setup as incomplete until AWS identity and Bedrock Anthropic model visibility are verified.

## Install

From Mac:

```bash
scp windows-pilot/scripts/pilot-install-claude-bedrock.ps1 windows-pilot/scripts/pilot-probe-claude-bedrock.ps1 pilot:/Users/vyonix/
ssh pilot 'powershell -NoProfile -ExecutionPolicy Bypass -File C:/Users/vyonix/pilot-install-claude-bedrock.ps1 -AwsRegion us-east-1 -EnableAgentTeams'
```

If AWS credentials use a named profile:

```bash
ssh pilot 'powershell -NoProfile -ExecutionPolicy Bypass -File C:/Users/vyonix/pilot-install-claude-bedrock.ps1 -AwsRegion us-east-1 -AwsProfile <profile> -EnableAgentTeams'
```

## Probe

```bash
ssh pilot 'powershell -NoProfile -ExecutionPolicy Bypass -File C:/Users/vyonix/pilot-probe-claude-bedrock.ps1 -AwsRegion us-east-1'
```

Pass state:

- `CLAUDE_COMMAND=PRESENT`
- `BEDROCK_ENABLED=TRUE`
- `AWS_REGION=<region>`
- AWS identity succeeds or the missing credential blocker is explicit.
- Bedrock Anthropic model count is positive, or authorization blocker is explicit.

## Agent Teams

Enable only as an env setting:

```text
CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1
```

When starting a team, pass explicit context files. Teammates do not inherit the lead's chat.
