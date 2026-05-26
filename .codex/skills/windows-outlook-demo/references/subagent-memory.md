# Subagent, OMX, And Memory Coordination

## oh-my-codex

Use OMX as the coordination layer around Codex, not as part of the Outlook runtime. `omx doctor` should be clean before relying on team workflows. In this repo, prefer native subagents for bounded lanes unless an active OMX CLI runtime is explicitly running.

Recommended lanes:

- Leader: owns critical path, Windows deployment, and final evidence.
- Verifier: runs `pilot-*` probes, collects screenshots/log snippets, and reports pass/fail.
- Architect: checks safety gates and runtime boundaries.
- Executor: edits docs/scripts/plugin code only inside assigned files.
- Code reviewer: checks for secret leaks, confirmation bypasses, broad refactors, and untested claims.

## agentmemory

Use agentmemory as shared recall and handoff memory when available. It works with MCP/REST and can share memory across agents. If it is not configured in the active Codex MCP list, do not block Outlook work; write durable notes in repo artifacts instead.

Minimum durable handoff:

- Store runbooks under `.codex/skills/windows-outlook-demo/`.
- Store pilot plans under `windows-pilot/plans/`.
- Store raw safe evidence paths in final reports.
- Do not store passwords, Host API tokens, Forms URLs, email bodies, or full recipient addresses.

## Handoff Note Shape

Each subagent report should include:

- Task and scope.
- Commands run.
- Files changed, if any.
- Evidence paths.
- Pass/fail verdict.
- Remaining blocker.
- Explicit statement that no email was sent and no form was submitted unless that was the assigned confirmed action.
