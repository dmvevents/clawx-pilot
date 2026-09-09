#!/usr/bin/env python3
"""PostToolUseFailure hook: inject fixed blocker-recovery guidance.

Reads the hook payload from stdin (bounded), and for a genuine tool
execution failure (not a user interrupt) returns additionalContext that
points the session at the existing ga-sprint-driver blocker-recovery
policy. Emits an empty JSON object for anything else. Stdlib only; no
network, subprocess, filesystem writes, or state. No input field is ever
echoed back: the emitted context is a fixed constant.
"""
import json
import sys

MAX_INPUT_BYTES = 1024 * 1024  # bound stdin; larger payloads are ignored

RECOVERY_CONTEXT = (
    "A tool call failed. Preserve your current board assignment and any "
    "read-only scope; a failure does not grant new authority. First classify "
    "the failure: an expected negative probe is not by itself a defect. "
    "Preserve guard refusals; report a blocked criterion without bypassing "
    "its gate. For a real acceptance blocker, follow "
    "the ga-sprint-driver skill section 'Recover a blocker' in this repo: "
    "dedupe against existing bug reports/cards before filing; diagnose the "
    "cause from evidence; apply at most one safe, bounded correction; then "
    "re-verify the original acceptance criterion before moving any state. "
    "Preserve refusals, authentication requirements, recorded owner holds "
    "and the single-VM-owner rule. If the failed tool may have executed a "
    "write, inspect the actual resulting state before any replay. If the "
    "blocker is unchanged and externally caused, route to eligible "
    "independent sprint work or stop the tick instead of repeating retries."
)

EMPTY = "{}"


def main() -> int:
    try:
        data = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
    except Exception:
        print(EMPTY)
        return 0
    if len(data) > MAX_INPUT_BYTES:
        print(EMPTY)
        return 0
    try:
        payload = json.loads(data.decode("utf-8", errors="strict"))
    except Exception:
        print(EMPTY)
        return 0
    if not isinstance(payload, dict):
        print(EMPTY)
        return 0
    if payload.get("hook_event_name") != "PostToolUseFailure":
        print(EMPTY)
        return 0
    if payload.get("is_interrupt") is True:
        # Never auto-resume a user cancellation.
        print(EMPTY)
        return 0
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PostToolUseFailure",
            "additionalContext": RECOVERY_CONTEXT,
        }
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
