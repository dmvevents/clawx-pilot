# Supervising local Claude Code print sessions

`scripts/claude-runner.py` is a dependency-free Python 3 supervisor for local
macOS/POSIX `claude -p --bare` sessions on Bedrock. It answers, without
attaching to the process: is the session alive, is it making progress, did it
finish, and with what outcome. It is an operations tool for owned agent
sessions; **CLI success is not task acceptance** — every status carries
`validation: PENDING_INDEPENDENT_REVIEW`.

Verified official reference (2026-09-08): <https://code.claude.com/docs/en/headless>
(recommends `--bare` for programmatic sessions; `--output-format stream-json
--verbose --include-partial-messages` emits token/tool events; `--bg` conflicts
with `-p` and is not used here; the final result JSON's `total_cost_usd` is a
client-side estimate, not billing truth).

## Start a supervised run

```sh
python3 scripts/claude-runner.py run \
  --task ga-fix-42 \
  --prompt /path/to/prompt.txt \
  --cwd /path/to/worktree \
  --budget-usd 5 --deadline-seconds 3600
```

Behavior:

- Spawns `claude -p --bare --model claude-fable-5 --session-id <uuid>
  --output-format stream-json --verbose --include-partial-messages` via an
  argument array (no shell), prompt streamed on stdin, in its **own process
  group** (`start_new_session`).
- Per run it removes `AWS_BEARER_TOKEN_BEDROCK`, `ANTHROPIC_API_KEY` and
  `ANTHROPIC_AUTH_TOKEN` from the child environment (names recorded in status,
  values never printed) and sets `CLAUDE_CODE_USE_BEDROCK=1`,
  `AWS_PROFILE=bedrock`, `AWS_REGION=us-east-2` (overridable with
  `--aws-profile/--aws-region`). No global configuration file is read or
  written.
- Writes to a private per-task directory (`~/.claude-runner/<task>` by
  default, dirs `0700`, files `0600`): `stream.jsonl` (raw child stdout),
  `stderr.log`, `status.json` (atomic temp+rename snapshots), `result.json`
  (final result event, when one arrived) and `receipt.json`.
- Refuses to start if the task directory shows a live supervisor heartbeat.

## Attachless status

```sh
python3 scripts/claude-runner.py status --task ga-fix-42
```

Prints the latest `status.json` plus `supervisorHeartbeatAgeSeconds` /
`supervisorStale` when the run claims to be alive. Any process with read
access can run this; it never touches the session. Key fields:

| Field | Meaning |
|---|---|
| `phase` | `RUNNING`, `CLI_SUCCEEDED`, `CLI_FAILED`, `EXIT_WITHOUT_RESULT`, `MALFORMED_RESULT`, `MODEL_MISMATCH`, `PROVIDER_MISMATCH`, `TIMED_OUT`, `SPAWN_FAILED` |
| `heartbeatAt` vs `lastChildActivityAt` | Supervisor liveness is tracked separately from child output activity. |
| `quietWarning` | Child alive but silent longer than `--quiet-warning-seconds` (default 180). A **warning only** — quiet sessions are never killed. |
| `eventCount`, `toolCalls` | Progress counters from incremental stream-json parsing. Status never copies message/prompt content. |
| `requestedModel` / `observedModel`, `modelMismatch` | Observed model from the `init` event plus `canonicalModel`/keys in the final usage metadata; any mismatch downgrades an otherwise clean exit to `MODEL_MISMATCH`. |
| `observedProviders`, `providerMismatch`, `providerEvidence` | The real `init` event names no provider; the only trustworthy provider evidence is `modelUsage[*].provider` in the final result. Contrary evidence fails closed (`PROVIDER_MISMATCH`); absent evidence stays honest as `providerEvidence: env-pinned-unobserved` (Bedrock pinned via env, not observed). `apiKeySource` cannot distinguish providers and is not used. |
| `resultReceived`, `isError`, `exitCode` | Exit 0 **without** a well-formed final result is `EXIT_WITHOUT_RESULT`, never a pass. |
| `estimatedCostUsd`, `budgetUsd`, `deadlineSeconds` | Cost is the CLI's client-side estimate only. |
| `terminationStage` | `none` / `SIGINT` / `SIGTERM` / `SIGKILL` — how far deadline escalation went. |

The supervisor's process exit code is `0` only for `CLI_SUCCEEDED`; treat that
as "the CLI run completed cleanly", not as evidence the task's acceptance
criteria are met.

## Deadlines and safe termination

When `--deadline-seconds` elapses, the supervisor signals **only the process
group it created** (SIGINT first, so Claude Code can interrupt gracefully;
then SIGTERM, then SIGKILL, each after `--grace-seconds`, default 20). Partial
`stream.jsonl`, the last `status.json` and `receipt.json` are always kept for
inspection.

## Restart / resume (intentional, never automatic)

The supervisor never retries by itself: a run that may already have performed
writes must not be blindly replayed. To continue after a timeout or failure:

1. Read `receipt.json` and `status.json`; inspect `stream.jsonl` /
   `result.json` for what the session actually did (files touched, tools run).
2. Decide whether continuing is safe; revert or note partial effects first.
3. Resume the same conversation explicitly:

   ```sh
   python3 scripts/claude-runner.py run --task ga-fix-42-resume \
     --prompt follow-up.txt --resume <sessionId from receipt.json>
   ```

   `--session-id` (fresh explicit UUID) and `--resume` are mutually exclusive;
   the receipt records the exact resume hint.

## Testing

```sh
python3 -m unittest tests.ops.test_claude_runner -v
```

`tests/ops/fake_claude.py` is a deterministic stand-in covering: normal
success, silent-but-live quiet warning, exit-0-without-result, `is_error`
results, malformed results, model mismatch, deadline escalation past an
ignored SIGINT, whole-process-tree termination scoping, partial JSON line
reassembly, and result-before-exit visibility. Intervals are configurable so
the suite finishes in well under 15 seconds.
