---
name: windows-outlook-forms
description: Verify, debug, or drive the Windows Outlook and Microsoft Forms demo path through the Ministry app, signed-in user Chrome CDP, Host API, and moe-principal-assistant tools, with no-send/no-submit safety gates.
---

# Windows Outlook And Forms

## Hard Rules

- Use the principal's signed-in Chrome profile through CDP. Do not use managed Chromium for Microsoft tenant flows.
- Final proof must follow the installed app path: Electron renderer to Host API or Gateway, then Outlook/Forms manager, then Chrome CDP.
- Do not send email, reply, forward, download attachments, or submit Forms unless the user explicitly confirms that exact action in the current session.
- Do not print passwords, provider keys, Host API tokens, email bodies, full recipient lists, or private Forms URLs.

## First Reads

- `docs/AGENT_OUTLOOK.md`
- `docs/MSFORMS_AUTOMATION.md`
- `docs/M365_TOOLING_DEEP_DIVE.md`
- `.codex/skills/windows-outlook-demo/references/outlook-forms-critical-path.md`
- `windows-pilot/skills/outlook-email-windows.md`
- `windows-pilot/skills/forms-suspension-fill.md`

## Read-Only Probes

```bash
ssh pilot 'powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\pilot-probe-state.ps1"'
ssh pilot 'powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\pilot-verify-outlook-tab.ps1"'
```

Expected state:

- app, Gateway, Host API, browser plugin, Chrome CDP, and Electron CDP are reachable;
- Outlook tab is signed in;
- Forms list returns configured demo forms;
- the model path is cloud/Gateway coherent.

## Pass Evidence

For demo readiness, collect artifact paths and one-line summaries for:

- Outlook open/read/draft safety smoke;
- Forms list/preview and no-submit dry run;
- latest session transcript with tool calls and non-error tool results;
- no browser profile mismatch or managed Chromium fallback.
