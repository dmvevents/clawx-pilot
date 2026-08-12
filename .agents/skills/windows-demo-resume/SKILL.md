---
name: windows-demo-resume
description: Resume or hand off the ClawX Ministry Windows demo and release work from repo artifacts, including current RC status, Windows pilot scripts, Claude/Codex agent surfaces, Outlook, Forms, Office files, ASR, and model/Gateway recovery.
---

# Windows Demo Resume

## Objective

Rebuild the current operating picture from checked-in artifacts, not chat memory.

## First Reads

Load only the files needed for the task:

- `CLAUDE.md`
- `AGENTS.md`
- `docs/AGENT_SKILL_INTEROPERABILITY.md`
- `docs/GA_RELEASE_PLAN_2026-06-09.md`
- `docs/NEXT_AGENT_WINDOWS_DEMO_HANDOFF_2026-05-29.md`
- `windows-pilot/README.md`
- `windows-pilot/AGENTS.md`

## Procedure

1. Run `git status --short --branch`.
2. Identify whether the task is release planning, Windows runtime recovery, Outlook/Forms, packaging, or form-prefill work.
3. Load the matching skill:
   - `ga-release-readiness`
   - `windows-runtime-recovery`
   - `windows-outlook-forms`
   - `windows-build-package`
   - `pilot-ssh-ops`
   - `moe-form-prefill`
4. Report the current target result, relevant docs/skills/agents, dirty files, live Windows probe status, and safest next validation step.

## Safety

- Do not send email, download attachments, submit Forms, print secrets, or mutate Windows state during the resume pass.
- If live Windows state is needed, run read-only probes first.
- Treat a cloud model/Gateway failure as runtime coherence until proven otherwise.
