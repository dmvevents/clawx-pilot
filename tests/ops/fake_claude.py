#!/usr/bin/env python3
"""Deterministic fake `claude` executable for tests/ops/test_claude_runner.py.

Behavior is selected via FAKE_MODE; optional FAKE_PROBE records argv and the
sanitized environment the supervisor provided. Emits stream-json lines.
"""
import json
import os
import signal
import subprocess
import sys
import time

BANNED = ("AWS_BEARER_TOKEN_BEDROCK", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN")


def emit(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def result(is_error=False, provider="bedrock", canonical="claude-fable-5", usage=True, **extra):
    ev = {"type": "result", "subtype": "success", "is_error": is_error,
          "num_turns": 2, "total_cost_usd": 0.0123,
          "result": "SECRET_CONTENT_MARKER done"}
    if usage:  # mirrors the real CLI's final usage metadata shape
        ev["modelUsage"] = {"claude-fable-5": {
            "provider": provider, "canonicalModel": canonical,
            "costUSD": 0.0123, "inputTokens": 2, "outputTokens": 15}}
    ev.update(extra)
    return ev


mode = os.environ.get("FAKE_MODE", "success")
if mode in ("hang", "tree"):
    signal.signal(signal.SIGINT, signal.SIG_IGN)  # install ASAP: force escalation past SIGINT
sleep = float(os.environ.get("FAKE_SLEEP", "1.0"))
probe = os.environ.get("FAKE_PROBE")
if probe:
    with open(probe, "w") as f:
        json.dump({"argv": sys.argv,
                   "banned_present": [k for k in BANNED if k in os.environ],
                   "aws_profile": os.environ.get("AWS_PROFILE"),
                   "aws_region": os.environ.get("AWS_REGION"),
                   "use_bedrock": os.environ.get("CLAUDE_CODE_USE_BEDROCK")}, f)
sys.stdin.read()  # consume the prompt like the real -p CLI
model = "other-model" if mode == "mismatch" else "claude-fable-5"
# Real init events carry model/apiKeySource/tools but NO provider field.
emit({"type": "system", "subtype": "init", "model": model,
      "apiKeySource": "none", "tools": []})

if mode in ("success", "mismatch"):
    emit({"type": "assistant", "message": {"content": [
        {"type": "tool_use", "name": "Bash"}, {"type": "text", "text": "x"}]}})
    emit({"type": "assistant", "message": {"content": [{"type": "tool_use", "name": "Read"}]}})
    emit(result())
elif mode == "quiet":
    time.sleep(sleep)  # silent but alive; then finish cleanly
    emit(result())
elif mode == "wrongprovider":
    emit(result(provider="anthropic"))  # clean exit, contrary provider evidence
elif mode == "wrongcanonical":
    emit(result(canonical="other-model"))
elif mode == "nousage":
    emit(result(usage=False))  # valid result, no provider evidence at all
elif mode == "noresult":
    pass  # exit 0 with no result event at all
elif mode == "badresult":
    emit({"type": "result", "subtype": "success"})  # missing is_error -> malformed
elif mode == "iserror":
    emit(result(is_error=True, subtype="error_during_execution"))
elif mode == "contradictoryerror":
    emit(result(is_error=False, subtype="error_during_execution"))
elif mode == "hang":
    time.sleep(30)
elif mode == "tree":
    child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
    with open(os.environ["FAKE_CHILD_PID_FILE"], "w") as f:
        f.write(str(child.pid))
    time.sleep(30)
elif mode == "partial":
    line = json.dumps({"type": "assistant", "message": {"content": [
        {"type": "tool_use", "name": "Bash"}]}}) + "\n"
    sys.stdout.write(line[:12])
    sys.stdout.flush()
    time.sleep(sleep)
    sys.stdout.write(line[12:])
    sys.stdout.flush()
    emit(result())
elif mode == "resultbeforeexit":
    emit(result())
    time.sleep(sleep)  # result observable while process still alive
else:
    sys.exit(2)
sys.exit(0)
