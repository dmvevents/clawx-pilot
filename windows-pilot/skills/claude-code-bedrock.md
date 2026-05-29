---
name: claude-code-bedrock
description: Install and verify Claude Code on the Windows pilot laptop with Amazon Bedrock, including Agent Teams env setup, AWS credential checks, and safe no-secret SSH operations.
metadata:
  os: windows
  related-doc: docs/CLAUDE_CODE_BEDROCK_WINDOWS_RUNBOOK.md
---

# Claude Code with Bedrock - Windows pilot

## Goal

Claude Code should be installed on the Windows laptop and configured to use Amazon Bedrock without storing secrets in repo files.

## Install

From Mac:

```bash
scp windows-pilot/scripts/pilot-install-claude-bedrock.ps1 windows-pilot/scripts/pilot-probe-claude-bedrock.ps1 pilot:/Users/vyonix/
ssh pilot 'powershell -NoProfile -ExecutionPolicy Bypass -File C:/Users/vyonix/pilot-install-claude-bedrock.ps1 -AwsRegion us-east-1 -EnableAgentTeams'
```

## Probe

```bash
ssh pilot 'powershell -NoProfile -ExecutionPolicy Bypass -File C:/Users/vyonix/pilot-probe-claude-bedrock.ps1 -AwsRegion us-east-1'
```

## Expected State

- Claude command present.
- `%USERPROFILE%\.claude\settings.json` exists.
- `CLAUDE_CODE_USE_BEDROCK=1`.
- `AWS_REGION` configured.
- AWS CLI/credentials either pass or report an explicit missing-credential blocker.
- Bedrock Anthropic models visible, or authorization blocker is explicit.

## Safety

Never print AWS keys, session tokens, Claude tokens, Host API tokens, passwords, email bodies, Forms URLs, or full recipient lists.
