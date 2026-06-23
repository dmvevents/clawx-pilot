# Principal demo script — Windows pilot, 2026-05-26

**Audience:** primary-school principal from one of MoE Trinidad & Tobago's 7 districts.
**Platform:** Ministry of Education v0.4.3-moe.10 on the pilot Windows 11 laptop.
**Length:** 8-10 minutes.
**Goal:** prove email + suspension-form-fill end-to-end, with the human visibly in control of every consequential action.

---

## Pre-flight (T-30 min, you do this without the principal watching)

1. `ssh pilot 'powershell ... pilot-probe-state.ps1'` → STATE: INSTALLED | GATEWAY_UP | API_UP | CDP_UP
2. `ssh pilot 'powershell ... pilot-verify-outlook-tab.ps1'` → STATE: OUTLOOK_READY
3. Send 3 demo emails into the test.fac inbox:
   - **From:** `<your test address>`
   - **Subject:** "Parent meeting Tuesday — request to attend"
   - **Body:** "Dear Principal, will you be at our PTA meeting Tuesday at 4pm? We'd like to discuss our daughter's progress. — Mrs. James"
   ---
   - **Subject:** "Suspension report — Standard 4 incident"
   - **Body:** A full 32-field narrative pasted from the demo source (date of incident, student name, grade, school, district, infraction type, witnesses, parent contact, etc.). The agent will extract from this body.
   ---
   - **Subject:** "MoE Circular: Term 3 deadlines"
   - **Body:** Filler so there's a 3rd email visible.
4. Open the test.fac form tab in Chrome. Press Ctrl+R to reset to a clean ResponsePage. Leave the tab visible.
5. Open the Ministry of Education app. Confirm "Online" pill is selected (not "On this device").
6. Type a trivial prompt ("hello") to warm the model and confirm cloud is reachable. Delete the response.
7. Stopwatch ready. Print this page.

---

## Opening (1 min)

> "What you're about to see runs entirely on your laptop. The assistant attaches to your existing browser session — you stay in control of when to send an email, when to submit a form. Anything that would actually change the world — sending, submitting — needs your explicit confirmation."

Show the gateway-status footer ("gateway connected"). Show the "Online" pill.

---

## Path 1 — Email (3 min)

### Turn 1 — read

Type into the chat composer (verbatim):

> Show me my 5 most recent emails

**Expected result (~5s):** chat shows 5 rows: from, subject, snippet for each. Subjects ≤120 chars.

### Turn 2 — draft

> Draft a reply to the parent meeting email saying I'll be there at 4 pm and to bring a copy of the report card.

**Expected result (~10s):** Outlook compose pane opens in Chrome with `Re: Parent meeting Tuesday — request to attend` subject and the requested body. **Switch to Chrome briefly** so the principal sees the compose pane. **Do NOT click Send.** Switch back to chat.

### Turn 3 — send (the gate moment)

> Send it.

**Expected result (~3s):** the agent calls `outlook.send_email({confirm:true})` only, sends the single visible reviewed draft, and the compose pane closes. Reply visible in Sent.

**Optional 30s gate demo:** say "send it" before any draft is open, or leave two compose panes open. The gate refuses with a clear message. Close extra drafts, review the intended draft, then say "send it" again. **This is the trust moment.**

> "The assistant sends only the draft you can see and approve. You can edit that draft yourself before approving."

---

## Path 2 — Suspension form (4 min)

### Turn A — extract + preview

> Read the suspension report email from this morning and fill out the Term 3 Suspensions form. Don't submit yet — let me review.

**Expected result (~15s):**
1. Chat shows: "Reading inbox..." → "Found suspension report from <sender>" → "Extracting 32 fields..." → "Filling form..."
2. Chrome's form tab visibly fills in real time (or shows fully filled when you switch to it).
3. Chat-side summary: "Filled 31 of 31 required fields. Form is open for your review."

**Switch to Chrome.** Walk the principal through:
- General Information section: district + school + name auto-filled
- Incident details: date in their local format
- Student narrative: extracted from the email body
- Witnesses, parent contact: filled

> "All of that came from the email you forwarded. The assistant pulled it apart into the form's structure."

### Turn B — submit

Switch back to chat:

> Submit the form.

**Expected result (~3s):** agent calls submit with confirm. DOM clicks Submit. Forms shows "Thanks" page in Chrome. Chat reports "Submitted successfully."

> "If you weren't ready, you'd just say 'wait' instead. Or edit any field yourself first. The assistant pauses at every consequential step."

---

## Path 3 — Cron reminder (1 min, may be a clip)

If 3:45pm timing aligns: watch the chat composer fire the daily-report reminder.
Otherwise: play `docs/ui-snapshots/cron-reminder-demo.mov`.

> "Reminders come to you in the same chat. You answer back inside it — to submit, to defer, to ask why. The assistant doesn't need a separate notification system."

---

## Closing (1 min)

> "Three things you saw: emails handled by an assistant that respects your authority over Send; a 32-field government form filled in seconds from a single source document; reminders that come to you instead of you remembering them. Everything you saw runs on your laptop today."

> "What's next: we'll connect this to the real MoE forms via the IT-issued integration keys when those land. The browser-based path you saw works today; the back-channel path will be even faster."

---

## Failure-mode escape hatches

| Symptom | Action |
|---|---|
| Agent turn errors with "400 status code (no body)" | Same prompt with brain icon ON (Think mode → Pro). |
| `outlook.send_email` refuses after review | Make sure exactly one reviewed draft is open, then say "send it" again. The agent should call `outlook.send_email({confirm:true})` only. |
| `forms.submit_suspension` fails to find Submit | Click "Next" in the form tab, then re-issue "submit the form". |
| Gateway disconnects (red footer) | Pause demo; tell the principal "let me restart"; relaunch app from Desktop shortcut; resume from Path 1 Turn 1. |
| Chrome lost CDP | Same — relaunch via the FIXED shortcut OR run `pilot-attach-chrome-cdp.ps1`. |
| Model call failed | Brain icon ON. If still fails, switch to Mac demo (have the Mac running silently in the background as backup). |
| Agent picks Forms API path (`forms.<api...>`) instead of preview | Kill the turn, re-issue: "Fill the form via the browser, please." |

---

## Post-demo

- Capture the principal's verbatim feedback. The phrases ("I want it to do X", "this is too much like a robot") become the next sprint's letter/memo templates.
- Note any UI surprise points; those go to the v2 polish queue.
- If a tool fired unexpectedly, save the chat thread.

---

*Demo cards (printable). Cut between sections.*

```
┌─ TURN 1 ─────────────────────────────────────────────┐
│ Show me my 5 most recent emails                      │
│ ~5s. Watch chat for 5 rows.                          │
└──────────────────────────────────────────────────────┘
┌─ TURN 2 ─────────────────────────────────────────────┐
│ Draft a reply to the parent meeting email saying     │
│ I'll be there at 4 pm and to bring a copy of the     │
│ report card.                                         │
│ ~10s. Compose pane opens in Chrome. DO NOT SEND.     │
└──────────────────────────────────────────────────────┘
┌─ TURN 3 ─────────────────────────────────────────────┐
│ Send it.                                             │
│ ~3s. Watch chat for "Sent". Compose closes.          │
└──────────────────────────────────────────────────────┘
┌─ TURN A ─────────────────────────────────────────────┐
│ Read the suspension report email from this morning   │
│ and fill out the Term 3 Suspensions form. Don't      │
│ submit yet — let me review.                          │
│ ~15s. Form fills in Chrome. Walk through it.         │
└──────────────────────────────────────────────────────┘
┌─ TURN B ─────────────────────────────────────────────┐
│ Submit the form.                                     │
│ ~3s. "Thanks" page in Chrome.                        │
└──────────────────────────────────────────────────────┘
```
