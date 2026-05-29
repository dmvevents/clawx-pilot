---
name: windows-outlook-demo
description: Verify, debug, or repair the ClawX/Ministry Windows pilot demo for Outlook, Microsoft Forms, Office document handling, ASR, desktop shortcuts, SSH deployment, live Electron CDP probing, and subagent/OMX/agentmemory coordination. Use when working on the Windows pilot machine, `windows-pilot/` scripts, `moe-principal-assistant`, Outlook browser-session tools, Forms preview/submit flows, or demo readiness.
---

# Windows Outlook Demo

## Operating Rules

- Treat Outlook login as an existing signed-in browser session. Do not print passwords, tokens, full recipient lists, Forms URLs, or email bodies.
- Use the app path for end-to-end proof: Electron renderer -> `hostapi:fetch` or `gateway:rpc` -> Host API -> Outlook/Forms manager -> Chrome CDP.
- Do not use standalone SSH `openclaw agent` as the final Outlook proof. It lacks the Electron-only `CLAWX_HOST_API_TOKEN`.
- Do not send email, reply, forward, download attachments, or submit Forms unless the user explicitly confirms that exact action in the same session.
- Prefer Outlook Browser v2 (`CLAWX_OUTLOOK_V2=1`) for Windows. Keep Microsoft Graph out of the real-send path until it has the same visible draft and confirmation gates.

## Quick Checks

From the repo root:

```bash
ssh pilot 'powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\pilot-probe-state.ps1"'
ssh pilot 'powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\pilot-verify-outlook-tab.ps1"'
```

Required state:

- App installed and running.
- Gateway `18789`, Host API, browser plugin `18791`, Chrome CDP `18792`, and Electron CDP `9223` up.
- Outlook tab title indicates signed-in mailbox.
- App config points to `google/gemini-2.5-pro` or Claude, not a local model.

If chat is stuck on "thinking", Gateway goes down, Excel prompts stall, or the model/provider appears to have changed, switch to the `windows-runtime-recovery` skill before changing Outlook/Forms code. Those symptoms usually indicate provider/runtime drift or cloud network failure, not a DOM automation bug.

## Live App Probe

Use the reusable CDP probe for safe UI-path evidence:

```bash
scp windows-pilot/scripts/pilot-electron-cdp-probe.js windows-pilot/scripts/pilot-run-electron-cdp-probe.ps1 pilot:
ssh pilot 'powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\pilot-run-electron-cdp-probe.ps1"'
```

Expected:

- `hasElectronInvoke: true`
- `/api/outlook/open` returns status `opened`
- `/api/forms/list` returns status `ok`
- screenshot and JSON artifacts in Windows Downloads
- `eventCount: 0`

Only after the safe Host API probe passes, run:

```bash
ssh pilot 'powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\pilot-run-electron-cdp-probe.ps1" -SafeChat'
```

Then inspect `C:\Users\VYONIX\.openclaw\agents\main\sessions\*.jsonl` for the latest tool result. A healthy run has a Gemini/Claude `toolCall` for `outlook.open` followed by a non-error tool result.

## Known Failure Signatures

- `Cannot find module 'playwright-core'`: packaged runtime missing `playwright-core`; it must remain a production dependency.
- `Cannot use 'in' operator to search for 'type' in undefined`: tool schema missing or malformed.
- `tool.execute is not a function`: plugin registered `handler` instead of OpenClaw `execute`.
- Forms list returns `not_configured`: installed app cannot see `extensions/moe-principal-assistant/forms/suspensions-test-fac-url.txt` from its working directory or package resources.
- Gateway "connecting" while port is listening: `system-presence` readiness timeout; use probe evidence and restart/recovery scripts, then fix manager readiness separately.

## Subagent Routing

Use subagents only for non-blocking lanes:

- `verifier`: run safe Windows probes and collect artifact paths/log snippets.
- `architect`: review Outlook/Forms safety and critical path.
- `executor`: bounded docs/scripts/config changes with disjoint write scope.
- `code-reviewer`: inspect diffs for secret leaks and send/submit bypasses.

Leader owns final evidence and never delegates the immediate blocking fix if waiting would stall the demo.

## References

Load only as needed:

- `docs/NEXT_AGENT_WINDOWS_DEMO_HANDOFF_2026-05-29.md` for the full current handoff, status, and next-agent execution order.
- `references/outlook-forms-critical-path.md` for route/file map and acceptance criteria.
- `references/subagent-memory.md` for OMX and agentmemory coordination.
- `.codex/skills/windows-runtime-recovery/SKILL.md` for Gateway/model coherence, Office-parser isolation, ASR fallback, and Mac/VM Windows test strategy.
