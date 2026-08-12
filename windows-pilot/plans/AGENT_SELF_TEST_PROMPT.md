# Agent self-test prompt — paste into Ministry of Education chat composer

**Purpose:** instead of attaching Chrome via SSH from outside, we let the OpenClaw agent (with Gemini 2.5 Pro) drive its own browser plugin and run the email smoke autonomously. Results come back as a structured report we can verify.

**Pre-conditions** (already true as of this session):
- Gateway up on 18789 ✓
- Host-API up on 13210 ✓
- moe-principal-assistant plugin enabled ✓
- agents.defaults.model.primary = google/gemini-2.5-pro ✓
- Network reachable to outlook.office.com / generativelanguage.googleapis.com ✓

**Pre-condition you control:**
- A Chrome window must be open with the principal signed into test.fac@fac.edu.tt at outlook.office.com (any Chrome window — the openclaw `browser` plugin handles attaching).

---

## The prompt (copy from here to the end-marker, paste, hit Enter)

```
You are running an end-to-end self-test of the moe-principal-assistant
plugin's Outlook tools. Today is 2026-05-26. We are validating Windows
pilot readiness for a demo. Be fully autonomous. Do not ask for
permission between steps. Run every step in order. Report results in
a structured JSON-like format at the end.

GROUND RULES — DO NOT BREAK ANY:
- DO NOT send any email. The send_email tool's hard-confirm gate must
  NEVER fire on this run. Never call outlook.send_email.
- DO NOT submit any form. Never call forms.submit_suspension.
- DO NOT call download_attachment.
- It is OK and expected to call: outlook.open, outlook.read_inbox,
  outlook.search_inbox, outlook.read_email, outlook.list_attachments,
  outlook.draft_email, outlook.reply, outlook.forward (don't actually
  forward — abort the call after the compose pane opens),
  forms.list, forms.preview_suspension.
- After every tool call, briefly note what the tool returned (success,
  error, count of items, etc.).
- If a tool fails, capture the exact error message verbatim and
  continue with the next step.

STEPS:

1. Call outlook.open. Note whether it returns "opened" or
   "needs_signin". If needs_signin, STOP and report which account is
   signed in (or that Chrome is missing CDP).

2. Call outlook.read_inbox with top=5. Capture the count returned and
   the subject line of each (truncate to 60 chars).

3. Call outlook.search_inbox with subjectContains="suspension".
   Capture the count and the message id of the first match (if any).

4. If step 3 returned at least one match, call outlook.read_email
   with that id. Capture the body length in characters and the first
   80 chars of the body.

5. Call outlook.list_attachments on the same id (only if step 4
   returned a body). Note the count and names of any attachments.

6. Call outlook.search_inbox with subjectContains="parent meeting".
   Capture the first match's id.

7. If step 6 returned a match, call outlook.reply with that id and
   body="DRAFT — confirming I'll attend at 4 pm and bring the report
   card. (This is a self-test draft; do not send.)". Note that the
   compose pane should open in Chrome but NOTHING should be sent.

8. Call forms.list to confirm the suspensions form is registered.

9. (Stretch goal — only if step 4 returned a usable suspension body):
   Extract the suspension fields from that email body in your head
   (do not call any tool yet) and identify how many of the 32 schema
   fields you could fill from the body. Report that number.

FINAL REPORT FORMAT:

Return a markdown block exactly like this:

----- SELF-TEST RESULTS -----
timestamp: <ISO8601>
model: <which Gemini variant you are>
chrome_cdp: <"attached" | "not attached" | "unknown">
outlook_signed_in_as: <email address from open response, or null>

steps:
  1_open: <"opened" | "needs_signin" | error message>
  2_read_inbox: count=<N>, subjects=[<list>]
  3_search_suspension: count=<N>, first_id=<id|null>
  4_read_email: body_chars=<N|null>, body_preview="<...>" or null
  5_list_attachments: count=<N|null>, names=[...]
  6_search_parent_meeting: first_id=<id|null>
  7_reply_draft: status=<"compose_opened" | error>
  8_forms_list: forms=[<names>]
  9_extraction_estimate: fields_extractable=<N>/32

errors_encountered:
  - <verbatim>

ready_for_demo:
  email_path: <true|false> with reason
  forms_path: <true|false> with reason

----- END SELF-TEST -----

Now run all steps. Do not summarize before running. Tools first,
then the report. Begin.
```

---

## After the agent returns

I'll grab the chat output (or the gateway log tail). Either way, the
report tells us:

- Whether Chrome CDP is healthy from the agent's side (the openclaw
  browser plugin attaches automatically — this bypasses our SSH
  Chrome-launch fight entirely)
- Which test.fac account is signed in
- Whether all 11 outlook tools are wired and the suspension email is
  in the inbox with extractable fields

If any step errors, the verbatim error message gives us the next move.

---

## How to send me the result

Easiest: paste the full chat response back into our Claude session.
Or screenshot the chat pane.

If the report says `ready_for_demo: email_path: true, forms_path:
true`, we are done with verification and can move directly to the
forms preview + the actual demo run.
