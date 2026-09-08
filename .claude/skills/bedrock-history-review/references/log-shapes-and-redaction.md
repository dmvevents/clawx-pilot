# Log shapes and redaction ordering

## Codex CLI rollout JSONL

One JSON object per line. Relevant shapes:

| Line | Meaning |
|---|---|
| `type=session_meta` | session id, cwd, originator |
| `type=response_item`, `payload.type=message` | user/assistant text (`content[].text`) |
| `payload.type=reasoning` | **excluded** — model thinking |
| `payload.type=function_call` | `name`, `arguments` (JSON string), `call_id` |
| `payload.type=function_call_output` | `output`, often a JSON string wrapping `output`/`metadata` |
| `type=event_msg` | `task_started`, `item_completed`, `token_count`, `task_complete` |
| `type=turn_context`, `world_state`, `token_usage_record` | configuration and accounting |

## Claude Code transcript JSONL

| Field | Meaning |
|---|---|
| `type` | `user`, `assistant`, `system`, `attachment`, `mode`, `permission-mode`, `last-prompt`, `ai-title`, `file-history-snapshot`, `file-history-delta` |
| `message.content[]` | blocks: `thinking` (**excluded**), `text`, `tool_use` (`name`, `input`), `tool_result` (`content`) |
| `toolUseResult` | `{interrupted, isImage, noOutputExpected, stderr, stdout}` |

Developer/system instruction records and injected context (compaction summaries, agent-file
preambles, skill preambles, teammate and task notifications, chunked file dumps) are dropped
and counted as boilerplate. Without that filter they dominate the pack: on the 2026-09-08 run
8,173 records were boilerplate.

## Redaction ordering matters

Apply in this order; reordering silently breaks earlier rules.

1. Structural secret flags (`/p:`, `/pth:`, `/gp:` on RDP command lines).
2. `Authorization: Bearer …` and JWTs — **before** any `label=value` rule, or the label is
   consumed and the token survives.
3. Labelled secrets with prefix and suffix tolerance (`AWS_SECRET_ACCESS_KEY=`, `password2=`).
4. Secret labels followed by a quoted or bracketed literal in prose.
5. Bare credential shapes that carry no label at all.
6. Cloud access-key ids, and account ids inside ARNs.
7. Signed or credentialed URL queries.
8. Emails and identifiers.
9. Home paths — **before** opaque-token matching, or a long path becomes one token.
10. Opaque high-entropy tokens last, excluding `/` and excluding hex of length 40 or more so
    that content hashes survive as evidence.

## Leak classes a regex will miss

- Credentials narrated in prose (`the test password (…)`), including inside a model's own
  explanation of its mistake. Found on the first 2026-09-08 pack.
- Secrets embedded in a *guard pattern* written to block them.
- Anything present only in a raw environment or config dump. Do not export those at all: drop
  the record and count it.
- Errno detection must stay case-sensitive. An `(?i)` flag over `\bE[A-Z]{4,}\b` matches the
  plain word "error" and floods tool-error classification with ordinary prose.
