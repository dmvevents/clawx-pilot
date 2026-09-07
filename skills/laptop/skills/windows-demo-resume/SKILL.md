---
name: windows-demo-resume
description: Resume the ClawX/Ministry Windows demo from repo-local handoff artifacts, including Claude Code memory, project skills, subagents, OMX team guidance, SSH pilot scripts, build/package commands, model/Gateway recovery, Outlook/Forms, Office files, and ASR.
---

# Windows Demo Resume

## Purpose

Use this skill when starting or resuming work on the Windows demo. It gives the next Claude Code session a grounded entry point without relying on prior chat history.

## Start Here

Read, in order:

1. `CLAUDE.md` current resume packet near the top.
2. `docs/NEXT_AGENT_WINDOWS_DEMO_HANDOFF_2026-05-29.md`.
3. `docs/CLAUDE_CODE_RESUME_AND_TEAMS_GUIDE_2026-05-29.md`.
4. `docs/WINDOWS_PROBLEMS_ATLAS.md`.
5. `windows-pilot/README.md` and `windows-pilot/AGENTS.md`.

## First Commands

Run only read-only probes first:

```bash
pwd
git status --short
find .claude -maxdepth 3 -type f -print | sort
find windows-pilot -maxdepth 3 -type f -print | sort | sed -n '1,160p'
```

Use Windows probes only when live pilot state matters:

```bash
ssh pilot 'echo ok'
ssh pilot 'powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\pilot-probe-state.ps1"'
```

## Routing

- Chat stuck, model call failed, Excel prompt stalls: load `.claude/skills/windows-runtime-recovery/SKILL.md`.
- Windows SSH or PowerShell quoting: load `.claude/skills/pilot-ssh-ops/SKILL.md`.
- Build/package/install loop: load `.claude/skills/windows-build-package/SKILL.md`.
- Outlook/Forms/email: load `.claude/skills/windows-outlook-forms/SKILL.md`.
- Claude Code on Windows with Amazon Bedrock: load `.claude/skills/claude-bedrock-windows/SKILL.md`.
- GitHub clone/dev loop or Claude session control on Windows: load `.claude/skills/windows-github-dev/SKILL.md`.

## Parallel Work

Use subagents or Agent Teams only after the task is shaped.

Always pass workers:

- task and desired outcome;
- exact files/docs to read;
- write scope;
- no-secret and no-send/no-submit gates;
- required evidence;
- report format.

Do not ask a worker to search the conversation.

## Resume Report

Before editing, state:

- target result;
- current evidence;
- highest-risk blocker;
- next safe action;
- command or artifact that will prove success.
