#!/usr/bin/env bash
# whatsapp-send-guard.sh — PreToolUse(Bash) guard for outbound WhatsApp sends.
#
# Purpose: apply the same "no secrets leave the machine" + audit-ledger floor to
# WhatsApp liaison sends that the Outlook send_email double-gate applies to email.
# It does NOT decide whether a message should be sent (that is the owner's gate,
# exercised in chat). It only:
#   1. BLOCKS a send whose payload looks like it carries a secret or a credential
#      link (test password, client secret, api key, bearer token, moevault URL).
#   2. Appends a MASKED audit line to the send ledger (recipient last-4 + byte
#      count only — never the body, per the logging hard rule).
#
# Protocol: reads the PreToolUse JSON event on stdin. Exit 0 = allow; exit 2 =
# block (stderr is returned to the agent). Any command that is not a WhatsApp
# send passes through untouched.
set -euo pipefail

LEDGER="${CLAWX_WA_SEND_LEDGER:-$HOME/openclaw-agent/outbound-drafts/whatsapp-send-ledger.log}"

# --- read the event; extract the Bash command -------------------------------
event="$(cat)"
cmd="$(printf '%s' "$event" | python3 -c 'import sys,json;
try:
    e=json.load(sys.stdin)
    print((e.get("tool_input") or {}).get("command",""))
except Exception:
    print("")
' 2>/dev/null || true)"

# Not a WhatsApp send? allow silently. Match the bridge send route only.
case "$cmd" in
  *api/send*|*send_message*|*localhost:8080*|*127.0.0.1:8080*) : ;;
  *) exit 0 ;;
esac
# Require it to actually be a send route (avoid matching an unrelated :8080 read).
if ! printf '%s' "$cmd" | grep -qiE '(api/send|send_message)'; then
  exit 0
fi

# --- secret / credential-link scan ------------------------------------------
# Static keyword classes that must NEVER leave over WhatsApp. NOTE: no literal
# secret value is embedded here (that would leak it into git). The actual
# test-account password is matched dynamically below, read from the operator's
# environment ($PILOT_TEST_PASSWORD) at runtime only.
STATIC='PILOT_TEST_PASSWORD|client[_-]?secret|x-api-key|api[_-]?key[[:space:]:=]|bearer [A-Za-z0-9._-]{12,}|passw(or)?d[[:space:]:=]|moevault|secure-send'
hit=0
printf '%s' "$cmd" | grep -qiE "$STATIC" && hit=1
if [ -n "${PILOT_TEST_PASSWORD:-}" ] && printf '%s' "$cmd" | grep -qF "$PILOT_TEST_PASSWORD"; then hit=1; fi
if [ "$hit" -eq 1 ]; then
  echo "BLOCKED: WhatsApp send payload appears to contain a secret or a credential link." >&2
  echo "Secrets, passwords, API keys, bearer tokens, and the moevault/secure-send credential" >&2
  echo "link must never be transmitted over WhatsApp. Send the value's *location* or ask the" >&2
  echo "Ministry to reissue instead. (Hard rule: no basic-auth / no token replay / no plaintext.)" >&2
  exit 2
fi

# --- masked audit ledger (no body content) ----------------------------------
# Pull the recipient digits if present; mask to last 4.
recip="$(printf '%s' "$cmd" | grep -oE '"recipient"[[:space:]]*:[[:space:]]*"[^"]+"' | head -1 | grep -oE '[0-9]{6,}' | head -1 || true)"
if [ -n "${recip:-}" ]; then
  masked="${recip: -4}"; masked="***${masked}"
else
  masked="unknown"
fi
bytes="$(printf '%s' "$cmd" | wc -c | tr -d ' ')"
mkdir -p "$(dirname "$LEDGER")" 2>/dev/null || true
printf '%s  to=%s  cmd_bytes=%s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$masked" "$bytes" >> "$LEDGER" 2>/dev/null || true

exit 0
