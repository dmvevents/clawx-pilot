# Continuing the ClawX completion work

Updated 2026-09-07. The shared contract is [PROJECT_CONTRACT.md](PROJECT_CONTRACT.md); current work and exit criteria are in [COMPLETION_PLAN.md](COMPLETION_PLAN.md). The existing [ga-sprint-driver skill](../.claude/skills/ga-sprint-driver/SKILL.md) continues one outcome across bounded sessions.

## Resume prompt

```text
Read CLAUDE.md (or AGENTS.md in Codex) and docs/COMPLETION_PLAN.md.
Inspect git status and the selected CLWX card/evidence. Continue the highest-
priority unclosed workstream through its next falsifiable exit. Reuse existing
fixes and tests, preserve all action gates and owner holds, and use independent
review for changed code. Distinguish source checks from installed/live proof.
Do not repeat full gates on unchanged code, rotate to unrelated small cards,
or create another backlog to avoid a core failure. Report the outcome, evidence,
remaining criterion and next action; stop if no meaningful unblocked work remains.
```

## Scheduling and authority

Scheduling belongs to the active Claude/OMX runtime. Inspect actual local scheduler state before describing a task as armed, expired or running; a historical job ID or cron expression is not current evidence. The September 7 alignment updated only the existing sprint task's prompt in `.claude/scheduled_tasks.json`; cadence, ownership and firing metadata were preserved. No task was added, triggered or cancelled. The runtime reload was not verified; restart/resume sessions should reread current files because already-loaded guidance can be cached.

A timer supplies an execution window, not permission to publish, install over the owner's app, send stakeholder messages, submit Forms, reset credentials or override a user stop. The shared contract records the existing owner holds. Prepare concrete artifacts and decisions while completing independent local work.

## Evidence and stop condition

Each useful checkpoint advances an acceptance criterion, supplies a reproducible failure/fix, or resolves a dependency. Static health is labelled as such; release-required missing evidence blocks the release verdict. Stop unchanged/blocked ticks instead of generating reviews, board comments or reruns without new information.

Cards may reach **Ready** when their actual acceptance is met; a human closes **Done**. The product is complete only at the chosen demo/pilot/fleet bar in the completion plan, not when a backlog count reaches zero.
