---
name: ministry-liaison-send
description: Prepare and deliver an explicitly owner-authorized WhatsApp note to Raj for the Ministry liaison. Resolve the current recipient, validate the available transport, preserve the exact approved content and verify the outgoing result. Never use for unsolicited updates or read-only stakeholder intake.
user-invocable: true
allowed-tools: Bash, Read
---

# Ministry liaison send

Read `docs/PROJECT_CONTRACT.md`. This skill applies only after the user has explicitly authorized the actual message and recipient. Reading feedback or preparing a release does not authorize an outward update. Read-only intake uses `ministry-liaison-monitor`.

## Prepare the concrete action

1. Draft the exact note in local `~/openclaw-agent/outbound-drafts/`, without credentials, private access links or unrelated message content. Reuse any approval already supplied for that exact action; do not ask again merely because a skill was loaded.
2. Resolve the current contact from local WhatsApp contact data and inspect relevant thread context. Raj's newer thread uses an `@lid` privacy identifier; the old phone thread ends in July. Never strip the identifier suffix, use a digit-prefix match, hard-code the old number, or choose the first ambiguous contact match.
3. Check the available MCP/bridge's actual recipient contract before dispatch. Developer tool availability is session-local. The prior digits-only bridge recipe was removed because it contradicted the unresolved `@lid` transport evidence. No successful `@lid` dispatch was established by the September 7 alignment.
4. If recipient identity or transport support cannot be established, retain the prepared draft and explain that specific blocker. Do not send a probe message or POST to a send endpoint as a health check. Use read-only health/contact checks.

## Execute only the authorized send

Use the supported transport with the exact resolved recipient and approved content. Construct structured data with a JSON encoder. Inspect the actual outbound content for secrets, including content loaded from files; scanning only a shell command is insufficient. Do not print the payload, full recipient ID, provider response body or raw bridge logs.

After the call, inspect the outgoing record in the **same exact recipient thread**, matched to the new send's timestamp and content/identifier internally. Report only redacted metadata. A successful HTTP response or command exit does not establish transmission or recipient delivery. An outgoing echo is outgoing-record evidence; claim recipient delivery only when a delivery receipt supports it. If the outcome is ambiguous, report unknown and do not blindly retry.

## Limits and retained rules

- Raj is the recipient this skill covers. Karunesh also tests ClawX; that does not authorize sending a Raj liaison note to him. Classify incoming messages by project content, not by sender.
- The checked-in `whatsapp-send-guard.sh` is attached to **Bash only** and scans command text. It does not inspect native MCP tool input, file payload content or delivery receipts. Its masked invocation ledger is not a delivery ledger.
- Keep any audit entry to necessary masked metadata; no message body, full phone/JID, password, API key, token or private credential link. Never open expiring credential links as part of a send.
- No board Done transition, deployment, account re-pairing or credential changes as a side effect of messaging. Diagnose missing access read-only; use the separately authorized recovery workflow if required.
- This alignment changed instructions only. It did not change the hook implementation, establish a new transport, or execute a send.
