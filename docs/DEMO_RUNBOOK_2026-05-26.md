# Demo runbook — 2026-05-26

Audience: Principals from MoE Trinidad & Tobago.
Length: ~10 minutes.
Goal: prove the assistant reads email, drafts replies on demand, extracts a suspension report from a document, and fills the MoE Forms suspension form end-to-end with a hard-confirm gate.

---

## Pre-flight (do these 30 min before the demo)

### 1. Mac app is running

```bash
pgrep -fl "Ministry of Education" | grep -v Helper | head -1
lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | grep -E "18789|13210"
```

Both ports must be listening. If not:

```bash
pkill -9 -f "Ministry of Education"
sleep 3
open -a "Ministry of Education"
sleep 22
lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | grep -E "18789|13210"
```

### 2. Chrome is on test.fac@fac.edu.tt with Outlook open

```bash
curl -s http://127.0.0.1:18792/json | python3 -c "import json,sys; [print(t.get('url')[:120]) for t in json.load(sys.stdin) if t.get('type')=='page']" | head -10
```

Look for `outlook.cloud.microsoft/mail/inbox`. If absent: switch to test.fac in Chrome and open Outlook.

### 3. Inbox has 3-5 demo messages

Send three test emails to `test.fac@fac.edu.tt` from your own account 5 min before the demo:
- Subject: "Parent meeting Tuesday — request to attend" (the agent will reply to this one in Demo Path 1)
- Subject: "Re: Suspension report — Standard 4 student" with the suspension narrative pasted in body (Demo Path 2 input)
- Subject: "MoE Circular: Term 3 deadlines" (filler so the agent has something to summarise in Demo Path 0)

### 4. Run the live smoke

```bash
pnpm exec tsx scripts/v2-chatbot-e2e.ts
```

Expect: ALL PASS in ~25s. If any step fails, stop and diagnose.

### 5. Clone the Suspensions form on test.fac (one-time, ~5 min)

Forms admin DOM is too volatile for automated cloning. Build by hand once:

1. In the test.fac Chrome tab go to https://forms.office.com/
2. Click **+ New Form**
3. Follow `extensions/moe-principal-assistant/forms/suspensions-form-spec.md` — paste each question. ~5 min.
4. Click **Collect responses** → copy the URL → save it:
   ```bash
   echo "<URL>" > extensions/moe-principal-assistant/forms/suspensions-test-fac-url.txt
   ```
5. Verify the fill driver works:
   ```bash
   pnpm exec tsx scripts/forms-fill-suspensions.ts
   ```
   Expect: FILL PASS — fields filled, hard-confirm gate refused, no actual submit. Eyeball the form in Chrome to verify the values landed correctly.

### 6. Default model is gemini-2.5-pro

Compound queries (read Excel + emails + draft reply) hit Flash 400s on schema validation. Pro handles them.

```bash
grep '"primary"' ~/.openclaw/openclaw.json
# expect "google/gemini-2.5-pro"
```

If it shows Flash, edit the file, lock it, restart the app:

```bash
python3 -c "
import json
p='/Users/antonalexander/.openclaw/openclaw.json'
d=json.load(open(p))
for a in d.get('agents',{}).get('list',[]):
  if a.get('model',{}).get('primary'): a['model']['primary']='google/gemini-2.5-pro'
defaults=d.get('agents',{}).get('defaults',{})
if defaults.get('model',{}).get('primary'): defaults['model']['primary']='google/gemini-2.5-pro'
json.dump(d,open(p,'w'),indent=2)
"
chflags uchg ~/.openclaw/openclaw.json
pkill -9 -f "Ministry of Education"; sleep 3
open -a "Ministry of Education"
sleep 22
chflags nouchg ~/.openclaw/openclaw.json
```

---

## Demo path

Open the chat composer in the Ministry of Education app. The principal sits next to you.

### Path 0 — opening (1 min)

> "This runs entirely on your laptop. Your email session stays in your browser; the assistant attaches to it instead of asking you to log in again. Anything sensitive — sending an email, submitting a form — is gated by an explicit confirmation. The assistant will never act on its own."

Show the gateway-status footer ("gateway connected"). Show the "Online" / "On this device" channel pill.

### Path 1 — Email (3 min)

Type into the composer (verbatim):

> Show me my 5 most recent emails

Expect: agent calls `outlook.read_inbox` → returns sender+subject+snippet rows. ~3-5s.

Then:

> Draft a reply to the parent meeting email saying I'll be there at 4 pm and to bring a copy of the report card.

Expect: agent calls `outlook.reply` with body filled. Compose pane opens in Chrome with the body inline. **Do not click Send.** Show the principal that the assistant stopped at the draft.

Then:

> Send it.

Expect: agent calls `outlook.send_email` with `confirm:true`. If the open compose pane's subject still matches, send fires. If not, gate refuses with a clear reason.

### Path 2 — Suspension form fill (4 min)

Type:

> Read the suspension report email from this morning and fill out the Term 3 Suspensions form. Don't submit yet — let me review.

Expect:
1. Agent calls `outlook.search_inbox({subjectContains:"suspension"})`.
2. Agent calls `outlook.read_email({id})` to get the body.
3. Agent extracts the 32 fields from the body (Pro handles this fine).
4. Agent calls `forms.preview_suspension({payload})` — opens the form on test.fac, fills every field.
5. Agent shows a chat-side summary of the filled fields and the form URL for principal review.

Click into the form tab in Chrome. Show the principal each section. They should see realistic data in every required field.

Then back in the chat composer:

> Submit the form.

Expect: agent calls `forms.submit_suspension({confirm:true})`. Submit fires. Forms shows the "Thanks" page. Agent reports success in chat.

### Path 3 — Cron reminder (1 min, can be a clip)

If timing aligns and we've configured a cron near demo time, watch the chat composer fire the 3:45pm prompt. Otherwise, play `docs/ui-snapshots/cron-reminder-demo.mov`.

### Closing (1 min)

> "Three things you saw: emails handled by an assistant that respects your authority over Send; a 32-field government form filled in seconds from a single source document; and reminders that come to you instead of you remembering them. Everything you saw runs on your laptop today; the parts that talk to MoE systems will go through the IT-issued keys when those land."

---

## Failure-mode escape hatches

If an agent turn errors with **"400 status code (no body)"**: type the same prompt again with the **brain icon enabled** (Think mode → routes to gemini-2.5-pro). Pre-flight step 6 should have made this unnecessary, but the brain toggle is the fastest live recovery.

If `outlook.send_email` **refuses on subject mismatch**: re-draft. The compose pane subject got edited (by the principal or a stray click). Ask the agent to "redraft the reply" so subjects match again.

If `forms.submit_suspension` **fails to find the Submit button**: the form page may be on a sub-page (Forms paginates long forms). Click "Next" in the form once, then re-issue "submit the form" in chat.

If the **gateway disconnects** (footer shows red): `pkill -9 -f "Ministry of Education"; open -a "Ministry of Education"`. Wait 22s. Re-run the live smoke. If it doesn't recover, fall back to a screen-recording of last night's good run.

---

## Post-demo

Capture the principals' verbal feedback verbatim. The exact phrases they use ("I want it to do X", "this is too much like a robot", "more like our usual letter") become the next sprint's letter/memo templates.
