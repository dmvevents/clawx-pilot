---
name: ministry-liaison-send
description: Send a WhatsApp message to a Ministry liaison (Raj Ramdass, ICT) from any Claude session via the local whatsmeow bridge. Use when the owner has explicitly approved sending an outbound note to Raj/the Ministry — a status update, a request for more time, a working-session ask. Draft-first, confirm-before-send, secrets never transmitted. This is the SEND side; the read side is the ministry-liaison-monitor skill.
user-invocable: true
allowed-tools: Bash, Read
---

# Ministry liaison — send

The outbound counterpart to `ministry-liaison-monitor` (which is read-only). Use
this to deliver an owner-approved note to **Raj Ramdass** (Ministry ICT — the
ClawX principal-assistant pilot) over WhatsApp, through the local whatsmeow
bridge that runs on this Mac.

## The gate that matters most

**Sending is the owner's decision, not yours.** Never send on inference. Send
only when the user has said, in this conversation, to send it. Then:

1. **Draft first.** The note lives as a file under
   `~/openclaw-agent/outbound-drafts/` (e.g. the "more time + reissue link" note).
   Show the exact text you will send and the recipient.
2. **Confirm the recipient.** Raj's number is **not stored in this repo** (it is
   PII and this repo may be public — see CLWX-18). Load it locally from the
   off-repo monitor config, which never leaves the machine:
   ```bash
   LIAISON="$(grep -oE '[0-9]{10,}@s\.whatsapp\.net' ~/openclaw-agent/raj-kiran-monitor.sh | head -1)"
   # masked, it ends in ...3280; export LIAISON so the commands below resolve it
   ```
   Verify the thread resolves to `raj ramdass` (see health check) before sending.
   Wrong-number sends to a Ministry official are real harm.
3. **Send** via the bridge (below).
4. **Verify honestly.** A `HTTP 200 {"success":true}` plus the message body in
   `bridge.log` is the proof of transmission. The bridge's `messages.db` only
   stores *inbound* messages, so an outbound send will NOT appear there — its
   absence is expected, not a failure. Never claim "sent" without the 200 + log.

## Health check (before relying on it)

```bash
launchctl list | grep com.anton.whatsapp-bridge          # status 0 + PID = running
curl -s -X POST http://localhost:8080/api/send | head -1 # API alive (rejects empty body)
DB=~/Github/whatsapp-mcp/whatsapp-bridge/store/messages.db
NUM="${LIAISON%@*}"                                        # digits only, from the off-repo config above
sqlite3 -readonly "$DB" "SELECT jid,name FROM chats WHERE jid LIKE '${NUM}%';"  # -> raj ramdass
sqlite3 -readonly -separator ' | ' "$DB" \
  "SELECT substr(timestamp,1,16),CASE is_from_me WHEN 1 THEN 'ME' ELSE 'RAJ' END,substr(content,1,60) \
   FROM messages WHERE chat_jid LIKE '${NUM}%' ORDER BY timestamp DESC LIMIT 6;"  # thread context
```

If the bridge is logged out (`bridge.log` shows `logged out`/401), re-pair:
`launchctl kickstart -k gui/501/com.anton.whatsapp-bridge`, then scan the QR in
`bridge.log` with the phone. See the `whatsapp-ops` / `whatsapp-local-mcp` skills
for the full recovery matrix.

## Send

Build the JSON with a real JSON encoder (never hand-concatenate — newlines and
quotes in the body will break a naive string):

The recipient comes from the `$LIAISON` shell var loaded above (off-repo), passed
into Python via the environment — never hard-coded here:

```bash
export LIAISON  # the JID resolved from ~/openclaw-agent/raj-kiran-monitor.sh (see step 2)
python3 - <<'PY'
import json, os, urllib.request
recipient = os.environ["LIAISON"].split("@")[0]  # digits only; not stored in the repo
msg = open(os.path.expanduser('~/openclaw-agent/outbound-drafts/2026-09-01-raj-more-time-reissue-link-DRAFT.md')).read()  # or paste the approved text
# ... strip the markdown header; send only the note body ...
payload = json.dumps({"recipient": recipient, "message": msg}).encode()
req = urllib.request.Request("http://localhost:8080/api/send", data=payload,
                             headers={"Content-Type": "application/json"}, method="POST")
with urllib.request.urlopen(req, timeout=30) as r:
    print("HTTP", r.status, r.read().decode())
PY
```

Then confirm transmission: `tail -20 ~/Github/whatsapp-mcp/whatsapp-bridge/bridge.log`
should show the body ending in `Message sent true Message sent to …3280`.

## Hard rules (enforced by the whatsapp-send-guard hook)

- **No secrets over WhatsApp.** No passwords, API keys, client secrets, bearer
  tokens. Never forward the moevault / secure-send credential link. The
  `.claude/hooks/whatsapp-send-guard.sh` PreToolUse hook **blocks** any send whose
  payload matches those patterns. If you need Raj to have a value, ask him to
  reissue it through his secure channel — do not paste it.
- **Masked audit only.** The guard appends a recipient-last-4 + byte-count line to
  `~/openclaw-agent/outbound-drafts/whatsapp-send-ledger.log`. No body, no full
  number — same floor as the Outlook log rule.
- **One recipient in scope: Raj (ICT / ClawX).** Karunesh Ramdass is the *video*
  project — do not send ClawX liaison notes there. See `ministry-liaison-monitor`
  for the two-project separation.
- **English only. Anonymise nothing that Raj needs, expose nothing he shouldn't.**
- **Never move a CLWX board card to Done** as a side effect of a send.

## Related

- `.claude/skills/ministry-liaison-monitor/SKILL.md` — the read side.
- `.claude/hooks/whatsapp-send-guard.sh` — the secret-scan + ledger guard.
- `docs/MINISTRY_LIAISON_MESSAGING.md` — full design + custody notes.
- `~/.claude/skills/whatsapp-ops` / `whatsapp-local-mcp` — the bridge internals
  and the recurring-break recovery matrix (global, cross-project).
