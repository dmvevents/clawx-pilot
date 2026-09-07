# Claude Code + Amazon Bedrock On Windows

Last updated: 2026-05-29.

This runbook installs Claude Code on the Windows pilot laptop and configures it to use Amazon Bedrock without storing secrets in the repo. It also documents the project skills, commands, and agents created for future Claude Code sessions.

## Official Reference Points

The setup follows these official Claude Code surfaces:

- Claude Code install/setup supports native binary install and Windows via WinGet.
- Claude Code Amazon Bedrock requires AWS credentials, `CLAUDE_CODE_USE_BEDROCK=1`, and `AWS_REGION`.
- Claude Code skills are stored under `.claude/skills/<skill-name>/SKILL.md`.
- Claude Code subagents are stored under `.claude/agents/*.md`.
- Claude Code Agent Teams should be given explicit context; teammates are separate Claude sessions.

Official docs:

- `https://docs.anthropic.com/en/docs/claude-code/setup`
- `https://docs.anthropic.com/en/docs/claude-code/amazon-bedrock`
- `https://docs.anthropic.com/en/docs/claude-code/skills`
- `https://docs.anthropic.com/en/docs/claude-code/sub-agents`
- `https://docs.anthropic.com/en/docs/claude-code/agent-teams`

## Files Added For This Workflow

Windows scripts:

- `windows-pilot/scripts/pilot-install-claude-bedrock.ps1`
- `windows-pilot/scripts/pilot-probe-claude-bedrock.ps1`

Claude Code project command:

- `.claude/commands/install-claude-bedrock-windows.md`

Claude Code project skill:

- `.claude/skills/claude-bedrock-windows/SKILL.md`

Claude Code subagents:

- `.claude/agents/claude-bedrock-installer.md`
- `.claude/agents/claude-bedrock-verifier.md`

Windows pilot skill mirror:

- `windows-pilot/skills/claude-code-bedrock.md`

## What The Installer Does

`pilot-install-claude-bedrock.ps1`:

- installs Claude Code if `claude` is not on PATH;
- supports install methods `auto`, `winget`, `native`, `npm`, or `none`;
- creates or updates `%USERPROFILE%\.claude\settings.json`;
- sets non-secret Bedrock environment values:
  - `CLAUDE_CODE_USE_BEDROCK=1`
  - `AWS_REGION=<region>`
  - optional `AWS_PROFILE=<profile>`
  - optional model pins
  - optional `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`
- adds conservative deny permissions for common secret files;
- backs up existing Claude settings before writing;
- probes `claude --version`;
- probes AWS identity and Bedrock Anthropic model visibility if AWS CLI is present.

It does not print or store AWS access keys.

## Mac-To-Windows Install

From repo root on the Mac:

```bash
scp windows-pilot/scripts/pilot-install-claude-bedrock.ps1 windows-pilot/scripts/pilot-probe-claude-bedrock.ps1 pilot:/Users/vyonix/
ssh pilot 'powershell -NoProfile -ExecutionPolicy Bypass -File C:/Users/vyonix/pilot-install-claude-bedrock.ps1 -AwsRegion us-east-1 -EnableAgentTeams'
ssh pilot 'powershell -NoProfile -ExecutionPolicy Bypass -File C:/Users/vyonix/pilot-probe-claude-bedrock.ps1 -AwsRegion us-east-1'
```

If the laptop does not have AWS CLI or credentials configured yet, the Claude Code install/config can still complete. The Bedrock probe will report `AWS_CLI=MISSING` or `AWS_IDENTITY=FAILED_OR_NOT_CONFIGURED`.

## AWS Credential Options

Use one of these on the Windows laptop. Do not store credentials in repo files.

Option A: AWS IAM Identity Center / SSO:

```powershell
aws configure sso
aws sso login --profile <profile>
```

Then run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\vyonix\pilot-install-claude-bedrock.ps1 -AwsRegion us-east-1 -AwsProfile <profile> -EnableAgentTeams
```

Option B: existing environment or shared credentials file:

```powershell
aws sts get-caller-identity --region us-east-1
aws bedrock list-foundation-models --region us-east-1 --by-provider Anthropic
```

Then run the installer without `-AwsProfile`.

## Model Pinning

If the Bedrock account requires explicit model IDs, pass them as parameters:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\vyonix\pilot-install-claude-bedrock.ps1 `
  -AwsRegion us-east-1 `
  -SonnetModel "<bedrock-sonnet-model-id>" `
  -HaikuModel "<bedrock-haiku-model-id>" `
  -EnableAgentTeams
```

Leave model IDs blank when using the Claude Code defaults. Pin models only when the AWS account/region has confirmed access.

## Verification

Read-only verification:

```bash
ssh pilot 'powershell -NoProfile -ExecutionPolicy Bypass -File C:/Users/vyonix/pilot-probe-claude-bedrock.ps1 -AwsRegion us-east-1'
```

Expected healthy output:

```text
STATE:CLAUDE_COMMAND=PRESENT
STATE:CLAUDE_VERSION=<version>
STATE:SETTINGS_EXISTS=TRUE
STATE:BEDROCK_ENABLED=TRUE
STATE:AWS_REGION=us-east-1
STATE:AWS_CLI=PRESENT
STATE:AWS_IDENTITY_ACCOUNT=<redacted/account-id-ok>
STATE:BEDROCK_ANTHROPIC_MODEL_COUNT=<positive number>
STATE:DONE=CLAUDE_BEDROCK_PROBE
```

## How A New Claude Code Session Should Start

From the repo root:

```text
/project:windows-demo-resume
```

For Bedrock-specific installation or repair:

```text
/project:install-claude-bedrock-windows
```

Then load:

- `.claude/skills/claude-bedrock-windows/SKILL.md`
- `.claude/skills/windows-demo-resume/SKILL.md`
- `docs/CLAUDE_CODE_RESUME_AND_TEAMS_GUIDE_2026-05-29.md`

## Safety

- Never print AWS access keys, session tokens, Claude API keys, Outlook tokens, or Host API bearer tokens.
- Do not run `claude` prompts that can send email or submit Forms until the app's no-send/no-submit gates are verified.
- Do not mutate `%USERPROFILE%\.claude\settings.json` without backing it up.
- Do not assume Bedrock is working just because `CLAUDE_CODE_USE_BEDROCK=1` exists. Verify AWS identity and Bedrock model visibility.
