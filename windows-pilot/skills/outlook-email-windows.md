---
name: outlook-email-windows
description: Drive Outlook on the pilot Windows laptop via the moe-principal-assistant plugin's outlook.* tools. Read inbox, draft, reply, send — with confirm-gated safety on send.
metadata:
  os: windows
  prereq-skill: chrome-cdp-windows
  account: test.fac@fac.edu.tt (demo); never *@moe.gov.tt without principal at the keyboard
---

# Outlook on Windows pilot

## When to use

- Demo turn 1 (email path): "Show me my 5 most recent emails", "Draft a reply…", "Send it."
- Acceptance smoke before demo: prove all 11 outlook.* tools work end-to-end on Windows.
- Diagnosis: an outlook.* tool returned an unexpected error.

## Tool surface (registered by the moe-principal-assistant plugin)

The agent calls these via the Anthropic tool-use protocol; you do **not** call them directly from this skill. List is here so the agent and humans agree on the contract.

| Tool | Purpose | Gate |
|---|---|---|
| `outlook.open` | Ensure an Outlook tab exists; create one if not | none |
| `outlook.read_inbox(top?)` | Top N rows: from, subject, snippet, date | none |
| `outlook.search_inbox({subjectContains, fromContains, dateRange})` | Filtered search | none |
| `outlook.read_email({id})` | Full body, recipients, attachments-meta | none |
| `outlook.draft_email({to, subject, body})` | Open compose pane with values | none |
| `outlook.reply({id, body, replyAll?})` | Open Reply or Reply All compose with recipients/subject pre-filled by Outlook | none |
| `outlook.forward({id, to, body?})` | Open Forward compose | none |
| `outlook.send_email({confirm:true})` | **Send the single visible reviewed draft** | **hard-confirm gate** (see below) |
| `outlook.list_attachments({id})` | List names + sizes | none |
| `outlook.download_attachment({id, attachmentId, confirm:true})` | Save to disk | hard-confirm |
| `outlook.mark_read({id, read})` | Toggle read state | none |

Source of truth: `electron/services/outlook-browser-v2/manager.ts` + `outlook-actions.ts`.

## Explicit Outlook action rules

- Reply must use `outlook.reply({id, body})`. Reply All must use `outlook.reply({id, body, replyAll:true})`.
- Forward must use `outlook.forward({id, to, body?})`.
- Never use generic browser clicks, toolbar guessing, keyboard shortcuts, or broad DOM automation for reply, reply-all, or forward. Locate the target message with `outlook.read_inbox`, `outlook.search_inbox`, or `outlook.read_email`, then call the explicit Outlook tool.
- Body text belongs only in the compose message body editor. Do not place body text in To, Cc, or Bcc fields, and do not ask for a recipient after Outlook has pre-filled a reply draft.
- Sending is separate from drafting. After `outlook.reply`, `outlook.forward`, or `outlook.draft_email`, leave the draft open for review. Send only with `outlook.send_email({confirm:true})` after the principal has reviewed the visible draft and explicitly approved sending.

## Send gate (mandatory)

`outlook.send_email` will refuse unless `confirm: true` is in the args and Outlook shows exactly one complete reviewed draft with its own Send button.

Normal reviewed sends use `outlook.send_email({confirm:true})` only. Do not ask the principal to restate the recipient, subject, or body after they already reviewed the open Outlook draft. Optional `to`, `cc`, `bcc`, `subject`, and `body` fields are advanced safety assertions only; passing stale assertions after review can cause a correct draft to be refused.

## Prerequisites checklist (run before any outlook.* call)

```
[ ] ssh pilot 'echo ok' answers within 1s
[ ] Gateway listening on 18789 + host-API on 13210 (run pilot-probe-state.ps1)
[ ] Chrome CDP on 18792 → run chrome-cdp-windows skill if not
[ ] At least one tab matches outlook.(office|cloud.microsoft|office365|live).com
[ ] Tab is signed-in (URL contains /mail/inbox or similar — not /login)
[ ] ~/.openclaw/openclaw.json has model.primary = google/gemini-2.5-pro
[ ] Inbox has 3-5 demo messages (per DEMO_RUNBOOK pre-flight #3)
```

If any unchecked, **stop and run the prerequisite skill** rather than trying the outlook.* call and parsing a confusing error.

## Demo turn-by-turn (verbatim chat composer text)

### Turn 1 — read

> Show me my 5 most recent emails

Expected: agent calls `outlook.open` → `outlook.read_inbox(5)` → returns sender/subject/snippet rows. ~3-5s. Subjects show in chat.

### Turn 2 — draft

> Draft a reply to the parent meeting email saying I'll be there at 4pm and to bring a copy of the report card.

Expected:
1. `outlook.search_inbox({subjectContains: "parent meeting"})` to locate
2. `outlook.read_email({id})` to fetch context
3. `outlook.reply({id, body: "<draft>"})` opens compose pane in Chrome

The draft body must be inserted into the message body editor only. Outlook pre-fills the reply recipient and subject; do not fill To/Cc/Bcc with message body text and do not use browser clicks to hunt for a Reply button.

**Do NOT click Send.** Show the principal the assistant stops at draft.

### Turn 3 — send

> Send it.

Expected: `outlook.send_email({confirm:true})` against the single visible reviewed compose pane. Send fires. Compose pane closes. Reply visible in Sent.

**Demo of the gate (optional 30s):** say "send it" before any draft is open, or leave two compose panes open. The tool refuses with a clear message. Close extra drafts, review the intended draft, then say "send it" again.

## Acceptance smoke (before the principal arrives)

For each tool, run a known-good call from the chat composer and watch the gateway log for:
- The tool name in `[plugin:moe-principal-assistant]` log line
- Successful return (no `error` field in the tool result)
- Subject truncation in logs (≤120 chars; never raw bodies / recipients)

Order:
1. `outlook.open`
2. `outlook.read_inbox(5)`
3. `outlook.search_inbox({subjectContains: "test"})`
4. `outlook.read_email({id: <first id from #2>})`
5. `outlook.draft_email({to: "test.fac@fac.edu.tt", subject: "Smoke A", body: "smoke"})`
6. `outlook.reply({id: <id>, body: "ack"})`
7. `outlook.send_email({confirm:false})` must refuse before touching Outlook; a real `confirm:true` send requires exact same-session human approval and should use `{confirm:true}` only after the draft is reviewed
8. `outlook.list_attachments({id: <id of email with attachments>})`
9. `outlook.download_attachment({id, attachmentId, confirm:true})`
10. `outlook.mark_read({id, read: true})` then `false`

Pass if all 10 return without `error`. Document in the smoke result row.

## Failure modes & escape hatches

| Symptom | Cause | Fix |
|---|---|---|
| `connectOverCDP failed: ECONNREFUSED 127.0.0.1:18792` | Chrome not on CDP | Run `chrome-cdp-windows` skill |
| `No Outlook tab found, navigated to outlook.office.com but got login redirect` | Profile is signed out | Sign in as test.fac in the SAME Chrome profile, retry |
| `AADSTS53003 BlockedByConditionalAccess` | Wrong Chrome profile (managed) | Switch to test.fac personal profile; never managed Chromium |
| `send_email` refuses after review | Usually no open draft, multiple open drafts, or a stale optional assertion was passed | Keep exactly one reviewed draft open and retry with `{confirm:true}` only |
| Gateway reports "model call failed" | `~/.openclaw/openclaw.json` drift OR network | Run `clawx-config-doctor` sub-agent; verify cloud reachability with `Test-NetConnection generativelanguage.googleapis.com -Port 443` |
| Compose pane opens but body is empty | Content-Security-Policy blocking the inject | Check `outlook-actions.ts:fillCompose`; this is a v2 regression — escalate |
| `read_inbox` returns 0 rows | Inbox empty OR Outlook UI in non-default folder | Send 3 test emails; ensure Outlook is on Inbox folder, not Focused/Other split |

## Cross-references

- Driver source: `electron/services/outlook-browser-v2/`
- Plugin tools: `extensions/moe-principal-assistant/index.mjs` (search for `outlook.`)
- Demo turn order: `docs/DEMO_RUNBOOK_2026-05-26.md` lines 132-155
- Live smoke (Mac equivalent): `pnpm exec tsx scripts/v2-chatbot-e2e.ts`
- Hard rules: `CLAUDE.md` "Hard rules" table
