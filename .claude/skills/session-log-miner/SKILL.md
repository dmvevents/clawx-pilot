---
name: session-log-miner
description: Mine JSON/JSONL session logs (Codex rollouts, ClawX app sessions, Claude Code transcripts), stakeholder feedback documents, and problem reports for every bug, blocker, workaround, and piece of user feedback they contain - then reconcile each finding against the known-defect registry (board, register, error ledgers) and report what is tracked, what is fixed-but-unguarded, and what is brand new. Use when asked to "extract all the blockers/bugs from the sessions", after receiving tester feedback, or before a release to sweep for forgotten failures.
---

# Session-log miner — extraction + reconciliation protocol

You are looking at machine logs and human feedback, not prose. Your job:
surface every problem that ever happened, prove which are handled, and name
the ones that fell through. Follow this protocol exactly.

## 1. Know your source shape first

| Source | Shape | Where the signal lives |
|---|---|---|
| Codex CLI rollouts (`~/.codex/sessions/**/rollout-*.jsonl`) | one JSON object per line; message/tool records | user messages (verbatim owner/tester asks + pasted errors), tool stderr, assistant admissions ("the build failed because...") |
| ClawX app sessions (`~/.openclaw/agents/*/sessions/*.jsonl`) | chat + toolCall records | toolCall results with `error`, assistant apologies to the principal, degrade/refusal texts |
| Claude Code transcripts (`~/.claude/projects/**/*.jsonl`) | same idea | tool errors, hook denials, user corrections |
| App logs (`clawx-*.log`) | timestamped lines | `[WARN]`/`[ERROR]`, Gateway stderr, tool failures |
| Feedback docs (docx/md from testers) | prose + test tables | per-prompt Worked/Failed verdicts, reproduction notes |

## 2. Extraction discipline (never read 250 MB linearly)

1. Size the file first (`wc -c`). Over ~2 MB: locate signal with grep, then
   read a window (±30 lines / ±3 records) around each hit.
2. Signal patterns, case-insensitive - run ALL of them, not the first that
   works: `error|fail|exception|timeout|refus|block|broken|crash|hang|stuck|
   cannot|can't|unable|not found|missing|denied|revert|regress|workaround|
   band-aid|TODO|FIXME`.
3. In JSONL, also mine the HUMAN side: user-role records contain the pasted
   error texts and the frustration ("same problems", "reverted") that mark
   real incidents. Quote them verbatim.
4. Timestamp every finding from the record itself (or the filename date).
5. A finding = {source, when, kind: bug|blocker|feedback|workaround|regression,
   verbatim quote <=200 chars, symptom in your words, component, outcome-in-log
   (fixed there? worked around? abandoned?)}.
6. Workarounds ARE findings: every "chflags uchg"-style band-aid marks an
   unfixed invariant. Extract them.

## 3. Reconciliation (the half people skip)

Load the known-defect registry BEFORE reporting:
- `docs/plane-board/CLWX-board.md` (cards + states)
- `docs/DEFECT_REGISTER_2026-09-02.md` (register + deltas)
- `docs/KARUNESH_ERROR_LEDGER.md` (external-tester ledger K1-K14)
- `docs/WINDOWS_PROBLEMS_ATLAS.md` (solved Windows classes)

Classify every finding exactly one of:
- **TRACKED-OPEN** (card/register row exists, still open) - name it.
- **FIXED-GUARDED** (fixed AND a named test/eval row pins it) - name both.
- **FIXED-UNGUARDED** (fixed but no regression test) - these become test-suite
  asks; name the missing test.
- **NEW** (matches nothing) - these become board cards; write the one-line
  card title.
When unsure between two rows, prefer the finding-is-NEW verdict and say why -
false-new is cheap to dedupe, false-tracked silently loses a bug.

## 4. Report shape

Return (or write, if asked) a table sorted NEW first, then FIXED-UNGUARDED,
then TRACKED-OPEN, then FIXED-GUARDED. Include per row: when | source |
quote | symptom | classification | card/test name or proposed title. End with
counts and the explicit statement of which sources you did NOT cover (files
skipped, date ranges truncated) - silent truncation reads as "covered
everything" when it didn't.

## Hard rules

No secrets in the output (keys, passwords, tokens get `[REDACTED]` even when
quoting). No message bodies beyond the error text itself. Minors' names never
appear. Findings must carry verbatim quotes - a paraphrase without a quote is
a hypothesis, not a finding.
