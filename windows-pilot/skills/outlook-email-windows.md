---
name: outlook-email-windows
description: Drive Outlook on the pilot Windows laptop via the moe-principal-assistant plugin's outlook.* tools. Read inbox, draft, reply, send — with the double-gate safety on send.
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
| `outlook.reply({id, body})` | Open Reply compose with `Re:` subject pre-filled | none |
| `outlook.forward({id, to, body?})` | Open Forward compose | none |
| `outlook.send_email({to, subject, confirm:true})` | **Send** | **double-gate** (see below) |
| `outlook.list_attachments({id})` | List names + sizes | none |
| `outlook.download_attachment({id, attachmentId, confirm:true})` | Save to disk | hard-confirm |
| `outlook.mark_read({id, read})` | Toggle read state | none |

Source of truth: `electron/services/outlook-browser-v2/manager.ts` + `outlook-actions.ts`.

## Double-gate on send (mandatory)

`outlook.send_email` will refuse unless **BOTH** are true:
1. `confirm: true` is in the args.
2. The currently-open compose pane's subject matches `args.subject` (substring match acceptable per implementation).

If the principal types "send it" and the agent has the right draft open with the matching subject, the gate fires. If the principal accidentally edited the subject in the compose pane, the gate refuses with a clear reason. **This is intended behavior — demo it on purpose at least once.**

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

**Do NOT click Send.** Show the principal the assistant stops at draft.

### Turn 3 — send (double-gate demo)

> Send it.

Expected: `outlook.send_email({to, subject, confirm:true})` with the same subject as the open compose pane. Send fires. Compose pane closes. Reply visible in Sent.

**Demo of the gate (optional 30s):** before saying "send it", click into the compose pane and edit the subject. Then say "send it." Gate refuses with subject-mismatch message. Re-issue draft → send → succeeds.

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
7. `outlook.send_email({to:"test.fac@fac.edu.tt", subject:"Smoke A", confirm:true})`
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
| `send_email: subject mismatch (compose has "X", arg has "Y")` | Working as designed | Re-draft so subjects match, retry |
| Gateway reports "model call failed" | `~/.openclaw/openclaw.json` drift OR network | Run `clawx-config-doctor` sub-agent; verify cloud reachability with `Test-NetConnection generativelanguage.googleapis.com -Port 443` |
| Compose pane opens but body is empty | Content-Security-Policy blocking the inject | Check `outlook-actions.ts:fillCompose`; this is a v2 regression — escalate |
| `read_inbox` returns 0 rows | Inbox empty OR Outlook UI in non-default folder | Send 3 test emails; ensure Outlook is on Inbox folder, not Focused/Other split |

## Cross-references

- Driver source: `electron/services/outlook-browser-v2/`
- Plugin tools: `extensions/moe-principal-assistant/index.mjs` (search for `outlook.`)
- Demo turn order: `docs/DEMO_RUNBOOK_2026-05-26.md` lines 132-155
- Live smoke (Mac equivalent): `pnpm exec tsx scripts/v2-chatbot-e2e.ts`
- Hard rules: `CLAUDE.md` "Hard rules" table
