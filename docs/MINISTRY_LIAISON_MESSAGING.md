# Ministry liaison messaging — read + send over WhatsApp

How this pilot communicates with its Ministry ICT liaison, **Raj Ramdass**, over
WhatsApp, and the guardrails that keep those sends safe. This pairs a read-only
monitor with an owner-gated send path and a hook that enforces the "no secrets
leave the machine" floor.

_Last updated: 2026-09-01._

---

## The two sides

| Side | Skill / component | Nature |
|---|---|---|
| **Read** | `.claude/skills/ministry-liaison-monitor/SKILL.md` + agent | Read-only. Turns the inbound drop + captured threads into a sourced, per-project status. Never sends. |
| **Send** | `.claude/skills/ministry-liaison-send/SKILL.md` | Owner-gated outbound. Delivers an approved note to Raj via the local bridge. |
| **Guard** | `.claude/hooks/whatsapp-send-guard.sh` (PreToolUse/Bash) | Blocks sends carrying secrets/credential links; writes a masked audit ledger. |

Both sides obey the **two-project separation**: **Raj Ramdass** (+ Ansari Khan)
= the ClawX principal-assistant pilot (this repo); **Karunesh Ramdass** = the
separate curriculum-video workstream. Liaison notes for ClawX go only to Raj.

## Transport: the local whatsmeow bridge

Sends do **not** go through the app's Outlook/Forms surfaces or the GCP gateway.
They use the local bridge that already runs on this Mac:

- **Go bridge** `com.anton.whatsapp-bridge` (LaunchAgent, KeepAlive) — connects to
  WhatsApp Web via `whatsmeow`, exposes a REST send API on
  `http://localhost:8080/api/send`, and stores **inbound** messages in
  `~/Github/whatsapp-mcp/whatsapp-bridge/store/messages.db`.
- **Recipient** Raj = `868…3280` → `868…3280@s.whatsapp.net` (thread name
  `raj ramdass`).

Because the bridge only persists inbound messages, a successful outbound send is
proven by the **HTTP 200 `{"success":true}` response** and the message body
appearing in `bridge.log` (`Message sent true Message sent to 868…3280`) — not
by a new row in `messages.db`. Reporting must reflect that; never infer "sent"
from the DB.

## The send discipline (owner gate)

1. Draft the note as a file in `~/openclaw-agent/outbound-drafts/`.
2. Get explicit owner approval to send (in the conversation).
3. Confirm the recipient thread resolves to `raj ramdass`.
4. Send via the bridge, encoding the JSON with a real encoder.
5. Verify against the 200 + `bridge.log`; report honestly.

This mirrors the Outlook `send_email` philosophy (a real outbound action to a
Ministry contact is potential harm) — the difference is WhatsApp has no compose
pane to diff against, so the **draft file + explicit in-conversation approval**
is the gate.

## The guard hook

`whatsapp-send-guard.sh` runs as a `PreToolUse` hook on every `Bash` call
(registered in `.claude/settings.json`). It is a fast no-op for anything that is
not a WhatsApp send. For a send, it:

- **Blocks** (exit 2, feedback to the agent) if the payload matches a secret or
  credential-link pattern: the test password, `PILOT_TEST_PASSWORD`,
  `client_secret`, `api_key`/`x-api-key`, `bearer <token>`, `password:`, or
  `moevault`/`secure-send`. Rationale: Microsoft revokes session cookies within
  minutes (CAE) and basic auth is disabled tenant-wide — a credential pasted into
  chat is both useless and a leak. If Raj needs a value, he reissues it through
  his secure channel.
- **Logs** a masked audit line to
  `~/openclaw-agent/outbound-drafts/whatsapp-send-ledger.log`:
  `<iso-ts>  to=***3280  cmd_bytes=NNN`. No body, no full number — the same
  logging floor as the Outlook rule (subjects ≤120 chars, recipient counts only,
  no body).

Override the ledger path with `CLAWX_WA_SEND_LEDGER` if needed.

### Verifying the guard

```bash
H=.claude/hooks/whatsapp-send-guard.sh
echo '{"tool_input":{"command":"ls"}}' | $H; echo "allow non-send exit=$?"           # 0
echo '{"tool_input":{"command":"curl .../api/send -d {\"message\":\"hi\"}"}}' | $H   # 0 + ledger
echo '{"tool_input":{"command":"curl .../api/send -d {\"message\":\"pwd: Education@2000\"}"}}' | $H  # exit 2
```

## What was sent (record)

| Date | To | Note | Proof |
|---|---|---|---|
| 2026-09-01 | Raj (`***3280`) | "brief update + secure-send link has expired" — buys time, asks him to reissue the credential link, keeps the working session warm | HTTP 200 `success:true` + `bridge.log`; draft `2026-09-01-raj-more-time-reissue-link-DRAFT.md` |

No secrets were transmitted. The moevault link was neither opened nor forwarded.

## Related

- `docs/MINISTRY_REPLY_DRAFT_2026-08-20.md` — the full infra-handoff reply (UNSENT).
- `~/openclaw-agent/outbound-drafts/` — all drafts + the send ledger.
- `~/.claude/skills/whatsapp-ops`, `whatsapp-local-mcp` — bridge internals and the
  recurring-break (whatsmeow aged-out / re-pair) recovery matrix.
- `docs/project-history/TIMELINE.md` — where this liaison work sits in the build history.
