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

## Outlook State Vector

For every Outlook action, classify the current page before acting:

- `tab`: one active signed-in Outlook mail tab. Ignore background duplicates.
- `folder`: Inbox, message detail, Drafts, Sent, Archive, Deleted Items, or other.
- `surface`: inbox list, message detail, compose draft, saved Drafts row, folder delete confirmation, discard draft dialog, or recipient autocomplete.
- `source`: target message id/subject/action. Replied or forwarded source messages may now be archived or in another folder.
- `draft`: kind, visible draft count, reviewed flag, marker/subject, recipients, body location, and stale/open status.
- `guards`: explicit send confirmation, marker-scoped cleanup target, and post-send draft-absence check.

Recover by moving to the intended state, not by guessing from the current view: return wrong-folder/Sent/Drafts/Archive views to Inbox or the target message; search/read the source if its row moved; resolve recipient autocomplete with email recipients only; cancel folder delete or discard dialogs unless cleaning a known marker-scoped test draft. Never click folder-level `Empty`, `Delete all`, or bulk cleanup controls. Never send unless exactly one visible reviewed draft is open and `confirm:true` is present. Body text must be in the Message body, never in To/Cc/Bcc. If send reports success but the draft remains open or in Drafts, treat it as not sent.

Acceptance for compose, reply, reply-all, forward, and send: the right Outlook tab and message/folder context are active, exactly one intended draft exists, recipients are valid email addresses, the subject is correct, body text is in the body editor, no autocomplete/delete/discard dialog blocks the draft, and send closes/removes the draft or reports a refusal.

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
