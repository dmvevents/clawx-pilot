---
name: windows-outlook-forms
description: Verify, debug, or drive the Windows Outlook and Microsoft Forms demo path through the Ministry app, signed-in user Chrome CDP, Host API, and moe-principal-assistant tools, with no-send/no-submit safety gates.
---

# Windows Outlook And Forms

## Hard Rules

- Never use managed Chromium for Microsoft tenant flows.
- Always use the signed-in user Chrome session over CDP on `127.0.0.1:18792`.
- Do not send email, download attachments, or submit Forms unless explicitly confirmed in the same session.
- Do not print passwords, tokens, Forms URLs, full recipient lists, or email bodies.
- Use the app path for proof: Electron renderer -> Host API/Gateway -> Outlook/Forms manager -> Chrome CDP.

## First Reads

- `windows-pilot/skills/chrome-cdp-windows.md`
- `windows-pilot/skills/outlook-email-windows.md`
- `windows-pilot/skills/forms-suspension-fill.md`
- `windows-pilot/plans/TOOL_REFERENCE.md`
- `.codex/skills/windows-outlook-demo/references/outlook-forms-critical-path.md`

## Read-Only Probes

```bash
ssh pilot 'powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\pilot-probe-state.ps1"'
ssh pilot 'powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\pilot-verify-outlook-tab.ps1"'
```

Use the Electron CDP probe for app-path evidence:

```bash
scp windows-pilot/scripts/pilot-electron-cdp-probe.js windows-pilot/scripts/pilot-run-electron-cdp-probe.ps1 pilot:
ssh pilot 'powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\pilot-run-electron-cdp-probe.ps1"'
```

## Pass Evidence

- Chrome CDP is live.
- Outlook tab is signed in.
- `/api/outlook/open` works through the Host API bridge.
- `forms.list` returns available forms.
- Draft/preview works without sending/submitting.
- Send/submit refuses without `confirm:true`.
