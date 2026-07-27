# Claude Code Resume And Agent-Team Guide

Last updated: 2026-05-29.

This guide translates the official Claude Code guidance into the local ClawX / Ministry Windows-demo workflow. It is written for the next Claude Code session that needs to resume from the current repo state without re-discovering the Windows pilot, SSH, model/Gateway, Outlook, Forms, ASR, and packaging context.

## Official Claude Code Guidance Applied Here

Official docs consulted:

- Claude Code memory / `CLAUDE.md`: `https://code.claude.com/docs/en/memory`
- Claude Code skills: `https://code.claude.com/docs/en/skills`
- Claude Code subagents: `https://code.claude.com/docs/en/sub-agents`
- Claude Code Agent Teams: `https://code.claude.com/docs/en/agent-teams`
- Claude Code hooks: `https://code.claude.com/docs/en/hooks`
- Claude Code slash commands: `https://code.claude.com/docs/en/slash-commands`

The local design follows these principles:

- Keep startup memory short and current. Put the latest resume pointer near the top of `CLAUDE.md`.
- Put long procedures in project skills under `.claude/skills/<skill>/SKILL.md` so Claude loads them on demand.
- Use `.claude/agents/*.md` for bounded specialist workers. Give every worker a concrete task, path scope, and evidence requirement.
- Use project slash commands under `.claude/commands/*.md` for repeatable kickoff prompts.
- Do not expect subagents or teammates to know the current conversation. Pass file paths and the task packet explicitly.
- Use team/parallelism only after a context snapshot exists and acceptance criteria are clear.
- Prefer read-only probe scripts first; mutate Windows state only after backing it up.

## New Claude-Native Resume Surfaces

These files are intended for the next Claude Code session:

- `CLAUDE.md` - startup memory, now with a current 2026-05-29 resume packet near the top.
- `.claude/commands/windows-demo-resume.md` - run as `/project:windows-demo-resume`.
- `.claude/skills/windows-demo-resume/SKILL.md` - broad resume / next-agent workflow.
- `.claude/skills/windows-runtime-recovery/SKILL.md` - model/Gateway/Office/ASR runtime triage.
- `.claude/skills/pilot-ssh-ops/SKILL.md` - safe SSH/PowerShell patterns for Windows.
- `.claude/skills/windows-build-package/SKILL.md` - build/package/install validation workflow.
- `.claude/skills/windows-outlook-forms/SKILL.md` - signed-in Chrome CDP, Outlook, Forms, and send/submit gates.
- `.claude/skills/claude-bedrock-windows/SKILL.md` - Claude Code + Amazon Bedrock install/config/verification on Windows.
- `.claude/skills/windows-github-dev/SKILL.md` - GitHub CLI/repo clone and Claude session control on Windows.
- `docs/NEXT_AGENT_WINDOWS_DEMO_HANDOFF_2026-05-29.md` - long handoff and current state.

The Codex/OMX mirrors still exist:

- `.codex/skills/windows-outlook-demo/`
- `.codex/skills/windows-runtime-recovery/`
- `windows-pilot/skills/`
- `windows-pilot/scripts/`
- `windows-pilot/plans/`

## Recommended New Session Start

In Claude Code, from repo root:

```text
/project:windows-demo-resume
```

If custom slash commands are unavailable, paste:

```text
Resume the ClawX Windows demo from the current repo state. First read CLAUDE.md, docs/NEXT_AGENT_WINDOWS_DEMO_HANDOFF_2026-05-29.md, docs/CLAUDE_CODE_RESUME_AND_TEAMS_GUIDE_2026-05-29.md, .claude/skills/windows-demo-resume/SKILL.md, and .claude/skills/windows-runtime-recovery/SKILL.md. Run only read-only local probes first: git status, list .claude agents/skills, list windows-pilot scripts, and summarize the current highest-risk blockers. Do not send email, submit forms, print secrets, or mutate Windows state until the exact action is confirmed or required by the assigned task.
```

## First Ten Minutes Protocol

1. Confirm current directory:

```bash
pwd
git status --short
```

2. Read the active handoff:

```bash
sed -n '1,220p' docs/NEXT_AGENT_WINDOWS_DEMO_HANDOFF_2026-05-29.md
sed -n '1,220p' docs/WINDOWS_PROBLEMS_ATLAS.md
```

3. Inventory resumable surfaces:

```bash
find .claude -maxdepth 3 -type f -print | sort
find .codex -maxdepth 4 -type f -print 2>/dev/null | sort
find windows-pilot -maxdepth 3 -type f -print | sort
```

4. Decide lane:

- Model/Gateway stuck, wrong provider, Excel prompt stalls: use `windows-runtime-recovery`.
- SSH/Windows probe/install: use `pilot-ssh-ops`.
- Build/package/install loop: use `windows-build-package`.
- Outlook/Forms/email: use `windows-demo-resume` plus `.claude/skills/windows-outlook-demo` if added later, or `windows-pilot/skills/*`.

5. Gather evidence before edits:

```bash
pnpm exec vitest run tests/unit/channel-router.test.ts tests/unit/provider-runtime-sync.test.ts
pnpm exec vitest run tests/unit/forms-browser-driver-cdp.test.ts tests/unit/forms-browser-submit-gate.test.ts
```

Run Windows probes only when the task needs live Windows state:

```bash
ssh pilot 'echo ok'
ssh pilot 'powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\pilot-probe-state.ps1"'
```

## Claude Subagents

Use `.claude/agents` for bounded work. Existing useful agents:

- `clawx-config-doctor` - config/model coherence repair.
- `gateway-recovery` - Gateway crash-loop recovery.
- `windows-smoke` - Windows post-install smoke runner.
- `config-coherence-auditor` - four-store provider drift audit.
- `dependency-class-auditor` - catches packaged-runtime dependency mistakes like `playwright-core`.
- `dom-selector-regression-tester` - reviews fragile vendor DOM selectors.
- `state-idempotency-auditor` - reviews atomic/idempotent config writers.
- `production-readiness` - release audit.

Subagent prompt pattern:

```text
You are <agent-name>. Task: <bounded task>. Scope: read-only unless explicitly stated. Start by reading <paths>. Do not inspect the conversation. Report: commands run, files read/changed, evidence, pass/fail verdict, remaining blocker. Do not print secrets, send email, or submit forms.
```

Good fanout for the current demo:

- Lane 1: `clawx-config-doctor` checks provider/Gateway coherence and current transcript model snapshots.
- Lane 2: `dom-selector-regression-tester` checks Forms field coverage and selector robustness.
- Lane 3: `dependency-class-auditor` checks Windows packaging runtime deps and ASR helper packaging.
- Lane 4: `windows-smoke` runs read-only Windows install/runtime smoke after the lead confirms it is safe.

## Claude Code Agent Teams

Agent Teams are appropriate when the work is large enough to justify multiple Claude instances: packaging plus Windows smoke plus Forms/Outlook plus regression tests. They are not necessary for a single file edit.

Before starting a team:

1. Create or read a context packet. Use `docs/NEXT_AGENT_WINDOWS_DEMO_HANDOFF_2026-05-29.md` as the packet unless a narrower one exists.
2. Define acceptance criteria.
3. Assign each teammate a bounded lane and file/path scope.
4. State safety gates explicitly.
5. Keep one lead responsible for final evidence.

Suggested Agent Team kickoff:

```text
Start an agent team for ClawX Windows demo recovery.

Context packet:
- Read CLAUDE.md current resume packet.
- Read docs/NEXT_AGENT_WINDOWS_DEMO_HANDOFF_2026-05-29.md.
- Read docs/WINDOWS_PROBLEMS_ATLAS.md.
- Read windows-pilot/README.md and windows-pilot/AGENTS.md.

Goal:
Get the Windows demo path reproducibly verifiable: cloud model/Gateway coherent, Excel/Word file prompt isolated, Outlook/Forms through signed-in Chrome CDP, ASR/build packaging known-good or documented best effort.

Teammates:
1. Runtime lane: provider/Gateway coherence, stuck thinking, transcript model snapshots.
2. Outlook/Forms lane: Chrome CDP, signed-in context, field coverage, send/submit gates.
3. Build/ASR/Office lane: Windows packaging, playwright-core runtime dep, ASR helper, Office parser smoke.
4. Verification lane: collect commands, logs, screenshots/artifacts, and update handoff docs.

Safety:
No secrets in logs. No email send/download/form submit unless explicitly confirmed in this same session. Read-only Windows probes first. Back up Windows app/openclaw state before mutation.

Output:
Each teammate reports commands run, paths inspected/changed, evidence, verdict, and next blocker. Lead integrates and owns final verification.
```

## OMX / OMC Team Mode

The user may say OMC; this repo's installed orchestrator is OMX / oh-my-codex.

Use OMX `omx team` only when the session is inside an OMX/tmux runtime and the task benefits from durable tmux workers. Otherwise use Claude Code subagents or Agent Teams.

Preflight:

```bash
omx doctor
tmux -V
test -n "$TMUX" && echo IN_TMUX
```

Claude-worker team example:

```bash
OMX_TEAM_WORKER_CLI=claude omx team 4:executor "Recover and verify the ClawX Windows demo from docs/NEXT_AGENT_WINDOWS_DEMO_HANDOFF_2026-05-29.md. Use read-only probes first, split runtime/forms/build/verification lanes, and report evidence without secrets."
```

Mixed Codex/Claude team example:

```bash
OMX_TEAM_WORKER_CLI_MAP=codex,claude,claude,codex omx team 4:executor "Run Windows demo recovery lanes with one runtime lane, one Outlook/Forms lane, one build/ASR lane, and one verification/docs lane."
```

Do not start `omx team` from a plain non-tmux Claude Code session unless the user explicitly asks to launch that runtime. If `omx team` is already active, use `omx team status`, `omx team resume`, and only shut it down after all tasks are terminal.

## What To Avoid

- Do not bulk-import `AGENTS.md` into `CLAUDE.md`; it is large and Codex-specific. Mirror only the current, useful rules into Claude-native skills.
- Do not let workers infer context from prior chat. They do not have it.
- Do not run mutating Windows scripts before `pilot-probe-state.ps1`.
- Do not judge readiness by UI model labels alone.
- Do not hand-edit one provider store without reconciling all stores.
- Do not use managed Chromium for Outlook or Forms.

## Stop Condition

The new session is truly resumed when it can state:

- current repo status and untracked handoff files;
- which docs/skills/agents are authoritative;
- whether live Windows state has been probed in this session;
- current highest-risk blocker;
- exact next safe command or code edit;
- what evidence will prove success.
