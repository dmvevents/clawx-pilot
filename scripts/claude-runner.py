#!/usr/bin/env python3
"""Supervise a local Claude Code print-mode (-p --bare) session on macOS/POSIX.

Dependency-free (stdlib only). Provides liveness, observable progress, safe
timeout handling, final-outcome classification and restart/resume visibility.
See docs/ops/CLAUDE_CLI_MONITORING.md. CLI success is NOT task acceptance;
every outcome stays validation=PENDING_INDEPENDENT_REVIEW.
"""
import argparse
import json
import os
import re
import signal
import subprocess
import sys
import time
import uuid

REMOVED_ENV_KEYS = ("AWS_BEARER_TOKEN_BEDROCK", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN")
VALIDATION = "PENDING_INDEPENDENT_REVIEW"
TERM_STAGES = ("none", "SIGINT", "SIGTERM", "SIGKILL")


def private_dir(path):
    os.makedirs(path, mode=0o700, exist_ok=True)
    os.chmod(path, 0o700)
    return path


def open_private(path, mode="wb"):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    return os.fdopen(fd, mode)


def write_atomic_json(path, obj):
    tmp = path + ".tmp"
    with open_private(tmp, "w") as f:
        json.dump(obj, f, indent=2, sort_keys=True)
        f.write("\n")
    os.replace(tmp, path)


def kill_owned_group(pid, sig):
    """Signal ONLY the process group this supervisor created (pgid == child pid)."""
    try:
        if os.getpgid(pid) != pid:
            return  # not the group we started; never signal anything else
        os.killpg(pid, sig)
    except (ProcessLookupError, PermissionError):
        pass


class StreamState:
    """Incremental stream-json reader. Counts events; never copies content out."""

    def __init__(self, path):
        self.path, self.cursor, self.tail = path, 0, b""
        self.events = self.tool_calls = 0
        self.result = self.observed_model = None
        self.last_child_activity = None

    def usage_facts(self):
        """(providers, models) observed in the final result's modelUsage metadata.

        The real CLI does not name a provider in the init event; the only
        trustworthy provider evidence is the final usage block. Content is
        never read, only usage metadata."""
        providers, models = set(), set()
        usage = (self.result or {}).get("modelUsage")
        if isinstance(usage, dict):
            for key, entry in usage.items():
                models.add(key)
                if isinstance(entry, dict):
                    if entry.get("provider"):
                        providers.add(entry["provider"])
                    if entry.get("canonicalModel"):
                        models.add(entry["canonicalModel"])
        return providers, models

    def poll(self, now):
        try:
            with open(self.path, "rb") as f:
                f.seek(self.cursor)
                chunk = f.read()
                self.cursor = f.tell()
        except FileNotFoundError:
            return
        if not chunk:
            return
        self.last_child_activity = now  # any bytes (even a partial line) prove liveness
        lines = (self.tail + chunk).split(b"\n")
        self.tail = lines.pop()
        for line in lines:
            if not line.strip():
                continue
            try:
                ev = json.loads(line)
            except (ValueError, UnicodeDecodeError):
                continue  # malformed line: tolerated for progress, never for a result
            self.events += 1
            kind = ev.get("type")
            if kind == "system" and ev.get("subtype") == "init":
                self.observed_model = ev.get("model")
            elif kind == "assistant":
                content = (ev.get("message") or {}).get("content") or []
                self.tool_calls += sum(
                    1 for c in content if isinstance(c, dict) and c.get("type") == "tool_use")
            elif kind == "result":
                self.result = ev


def classify(exit_code, state, timed_out, requested_model):
    providers, usage_models = state.usage_facts()
    model_mismatch = (bool(state.observed_model) and state.observed_model != requested_model) \
        or any(m != requested_model for m in usage_models)
    provider_mismatch = any(p != "bedrock" for p in providers)  # absent evidence is not a mismatch
    mism = (model_mismatch, provider_mismatch)
    if exit_code is None:
        return ("TIMED_OUT" if timed_out else "RUNNING"), mism
    if timed_out:
        return "TIMED_OUT", mism
    if exit_code != 0:
        return "CLI_FAILED", mism
    r = state.result
    if r is None:
        return "EXIT_WITHOUT_RESULT", mism  # exit 0 alone is not a pass
    if not isinstance(r.get("is_error"), bool) or not r.get("subtype"):
        return "MALFORMED_RESULT", mism
    if r["is_error"] or r["subtype"] != "success":
        return "CLI_FAILED", mism
    if model_mismatch:
        return "MODEL_MISMATCH", mism
    if provider_mismatch:
        return "PROVIDER_MISMATCH", mism  # explicit contrary evidence fails closed
    return "CLI_SUCCEEDED", mism


def snapshot(a, state, pid, exit_code, started, now, session_id, stage, removed_keys):
    phase, (model_mismatch, provider_mismatch) = classify(exit_code, state, stage > 0, a.model)
    providers, _ = state.usage_facts()
    alive = exit_code is None
    activity = state.last_child_activity if state.last_child_activity is not None else started
    status = {
        "task": a.task, "phase": phase, "validation": VALIDATION,
        "pid": pid, "supervisorPid": os.getpid(), "processAlive": alive,
        "exitCode": exit_code, "sessionId": session_id, "resumedSession": bool(a.resume),
        "requestedModel": a.model, "observedModel": state.observed_model,
        "modelMismatch": model_mismatch, "requestedProvider": "bedrock",
        "observedProviders": sorted(providers),
        "providerMismatch": provider_mismatch,
        "providerEvidence": "result-usage" if providers else "env-pinned-unobserved",
        "awsProfile": a.aws_profile, "awsRegion": a.aws_region,
        "removedEnvKeys": list(removed_keys),
        "startedAt": started, "heartbeatAt": now, "pollSeconds": a.poll_seconds,
        "elapsedSeconds": round(now - started, 2),
        "lastChildActivityAt": activity,
        "childQuietSeconds": round(now - activity, 2),
        "quietWarning": alive and (now - activity) > a.quiet_warning_seconds,
        "eventCount": state.events, "toolCalls": state.tool_calls,
        "resultReceived": state.result is not None,
        "deadlineSeconds": a.deadline_seconds, "budgetUsd": a.budget_usd,
        "terminationStage": TERM_STAGES[min(stage, 3)],
    }
    r = state.result
    if isinstance(r, dict):
        status.update({
            "isError": r.get("is_error"), "resultSubtype": r.get("subtype"),
            "numTurns": r.get("num_turns"),
            "estimatedCostUsd": r.get("total_cost_usd"),  # client-side estimate only
        })
    return status


def build_command(a, session_id):
    cmd = [a.claude_bin, "-p", "--bare", "--model", a.model]
    cmd += (["--resume", session_id] if a.resume else ["--session-id", session_id])
    cmd += ["--output-format", "stream-json", "--verbose", "--include-partial-messages"]
    if a.budget_usd is not None:
        cmd += ["--max-budget-usd", str(a.budget_usd)]
    # Vetted tool caps only ("" is valid: a no-tools probe). No generic
    # passthrough exists, so provider/model pins cannot be overridden.
    if a.tools is not None:
        cmd += ["--tools", a.tools]
    if a.allowed_tools is not None:
        cmd += ["--allowedTools", a.allowed_tools]
    for d in a.add_dir:
        cmd += ["--add-dir", d]
    return cmd


def cmd_run(a):
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}", a.task):
        sys.exit("task must match [A-Za-z0-9][A-Za-z0-9._-]{0,63}")
    if a.session_id and a.resume:
        sys.exit("--session-id and --resume are mutually exclusive")
    out = private_dir(os.path.join(private_dir(os.path.expanduser(a.output_root)), a.task))
    status_path = os.path.join(out, "status.json")
    if os.path.exists(status_path):  # never double-supervise or auto-retry a task dir
        try:
            with open(status_path) as f:
                prev = json.load(f)
            fresh = time.time() - prev.get("heartbeatAt", 0) < max(30.0, 10 * prev.get("pollSeconds", 2.0))
            if prev.get("processAlive") and fresh:
                sys.exit("task %r appears to be running (pid %s); inspect with `status` first" % (a.task, prev.get("pid")))
        except (ValueError, OSError):
            pass
    session_id = a.resume or a.session_id or str(uuid.uuid4())
    env = os.environ.copy()
    removed = [k for k in REMOVED_ENV_KEYS if env.pop(k, None) is not None]  # names only, never values
    env.update(CLAUDE_CODE_USE_BEDROCK="1", AWS_PROFILE=a.aws_profile, AWS_REGION=a.aws_region)
    cmd = build_command(a, session_id)
    stream_path = os.path.join(out, "stream.jsonl")
    started = time.time()
    try:
        with open(a.prompt, "rb") as prompt_f, \
                open_private(stream_path) as out_f, open_private(os.path.join(out, "stderr.log")) as err_f:
            proc = subprocess.Popen(cmd, cwd=a.cwd, env=env, stdin=prompt_f,
                                    stdout=out_f, stderr=err_f, start_new_session=True)
    except OSError as exc:  # fail closed with structured receipts, no traceback
        final = {
            "task": a.task, "phase": "SPAWN_FAILED", "validation": VALIDATION,
            "pid": None, "supervisorPid": os.getpid(), "processAlive": False,
            "exitCode": None, "sessionId": session_id, "resumedSession": bool(a.resume),
            "requestedModel": a.model, "requestedProvider": "bedrock",
            "providerEvidence": "env-pinned-unobserved", "removedEnvKeys": list(removed),
            "startedAt": started, "heartbeatAt": time.time(),
            "spawnError": "%s: %s" % (type(exc).__name__, exc),
        }
        write_atomic_json(status_path, final)
        write_atomic_json(os.path.join(out, "receipt.json"),
                          {"finalStatus": final, "command": cmd, "cwd": a.cwd,
                           "promptPath": os.path.abspath(a.prompt), "outputDir": out})
        print(json.dumps(final, sort_keys=True))
        return 1
    state = StreamState(stream_path)
    stage, signalled = 0, 0.0
    while True:
        now = time.time()
        exit_code = proc.poll()
        state.poll(now)
        if exit_code is not None:
            state.poll(now)  # drain anything written just before exit
            break
        if a.deadline_seconds is not None and now - started > a.deadline_seconds:
            if stage == 0:
                stage, signalled = 1, now
                kill_owned_group(proc.pid, signal.SIGINT)
            elif stage < 3 and now - signalled > a.grace_seconds:
                stage, signalled = stage + 1, now
                kill_owned_group(proc.pid, signal.SIGTERM if stage == 2 else signal.SIGKILL)
            elif stage >= 3 and now - signalled > max(5.0, a.grace_seconds):
                proc.kill()  # last-resort direct kill of the child we own
                signalled = now
        write_atomic_json(status_path, snapshot(a, state, proc.pid, None, started, now,
                                                session_id, stage, removed))
        time.sleep(a.poll_seconds)
    now = time.time()
    final = snapshot(a, state, proc.pid, exit_code, started, now, session_id, stage, removed)
    write_atomic_json(status_path, final)
    if state.result is not None:
        write_atomic_json(os.path.join(out, "result.json"), state.result)
    receipt = {
        "finalStatus": final, "command": cmd, "cwd": a.cwd,
        "promptPath": os.path.abspath(a.prompt), "outputDir": out,
        "files": sorted(f for f in os.listdir(out) if not f.endswith(".tmp")),
        "resumeHint": "inspect stream.jsonl/result.json, then rerun with --resume %s" % session_id,
        "notes": ["CLI success is not task acceptance; independent review required.",
                  "estimatedCostUsd is a client-side estimate, not billing truth."],
    }
    write_atomic_json(os.path.join(out, "receipt.json"), receipt)
    print(json.dumps(final, sort_keys=True))
    return 0 if final["phase"] == "CLI_SUCCEEDED" else 1


def cmd_status(a):
    path = os.path.join(os.path.expanduser(a.output_root), a.task, "status.json")
    try:
        with open(path) as f:
            status = json.load(f)
    except (OSError, ValueError) as exc:
        sys.exit("no readable status for task %r: %s" % (a.task, exc))
    if status.get("processAlive"):
        age = time.time() - status.get("heartbeatAt", 0)
        status["supervisorHeartbeatAgeSeconds"] = round(age, 2)
        status["supervisorStale"] = age > max(30.0, 10 * status.get("pollSeconds", 2.0))
    print(json.dumps(status, indent=2, sort_keys=True))
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(prog="claude-runner", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    run = sub.add_parser("run", help="start and supervise one print-mode session")
    run.add_argument("--task", required=True)
    run.add_argument("--prompt", required=True, help="file streamed to claude stdin")
    run.add_argument("--cwd", default=os.getcwd())
    run.add_argument("--output-root", default="~/.claude-runner")
    run.add_argument("--session-id", help="explicit session UUID (default: random uuid4)")
    run.add_argument("--resume", metavar="SESSION_ID", help="intentional resume of an inspected session")
    run.add_argument("--model", default="claude-fable-5")
    run.add_argument("--aws-profile", default="bedrock")
    run.add_argument("--aws-region", default="us-east-2")
    run.add_argument("--budget-usd", type=float, default=None)
    run.add_argument("--deadline-seconds", type=float, default=None)
    run.add_argument("--poll-seconds", type=float, default=2.0)
    run.add_argument("--quiet-warning-seconds", type=float, default=180.0)
    run.add_argument("--grace-seconds", type=float, default=20.0)
    run.add_argument("--claude-bin", default="claude")
    run.add_argument("--add-dir", action="append", default=[])
    run.add_argument("--tools", default=None,
                     help="vetted tool cap passed to claude --tools; '' disables tools (probe)")
    run.add_argument("--allowed-tools", default=None,
                     help="vetted allowlist passed to claude --allowedTools")
    status = sub.add_parser("status", help="attachless read of the latest status snapshot")
    status.add_argument("--task", required=True)
    status.add_argument("--output-root", default="~/.claude-runner")
    a = parser.parse_args(argv)
    return cmd_run(a) if a.command == "run" else cmd_status(a)


if __name__ == "__main__":
    sys.exit(main())
