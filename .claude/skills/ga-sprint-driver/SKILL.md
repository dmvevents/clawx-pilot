---
name: ga-sprint-driver
description: One tick of the self-driving GA sprint loop — analyze the state vector + board, update cards, re-plan sequential/parallel lanes, execute the highest-leverage unblocked item, sync everything back. Safe to run repeatedly (idempotent per tick). Works for any board-driven sprint; paths below parameterize it.
---

# GA sprint driver — one tick of the loop

You are one tick of a self-driving sprint loop. Each tick: **sense → analyze →
act → sync → report**. The loop's power is that every tick leaves the system
consistent (board == docs == git), so ticks compose regardless of who runs
them (a cron, a fresh session, a human).

## Parameters (edit for other projects — everything else is generic)

| Param | This project |
|---|---|
| Board API | `http://localhost:8090`, workspace `issues-agent`, project `81a2ea23-e060-49b4-a344-1ab0339f46d5`, token via `set -a; . ~/issues-agent-runtime/plane/.agent-token; set +a` (never print) |
| Board mirror | `docs/plane-board/` via `node scripts/plane-board-export.mjs` |
| State vector | `docs/GA_SPRINT_STATE_VECTOR.md` |
| Sprint plan | `docs/GA_FINISH_SPRINT_2026-09-03.md` (supersedes GA_SPRINT_PLAN_2026-09-02; GA bar = `docs/wiki/GA_READINESS.md` §4; persona bars = `docs/PERSONA_STATE_VECTOR_2026-09-03.md`) |
| Defect register | `docs/DEFECT_REGISTER_2026-09-02.md` |
| Ceiling | Cards move at most to **Ready**; only a human closes Done. Cancelled/scope changes need explicit owner authorization in the transcript. |

## The tick

### 1. SENSE (read-only)
- `git status --short --branch` — confirm branch and a clean-or-known tree.
- Re-export the board; diff against the committed mirror (`git diff --stat docs/plane-board/`).
- Read the state vector §0 delta + the sprint plan lane tables + register group A.
- Probe blockers cheaply before believing them (test-lane-prober discipline):
  gcloud auth (`gcloud compute instances list --limit=1`), tunnel
  (`nc -z -w3 localhost 12222`), board (`curl -s -o /dev/null -w '%{http_code}'` on the states endpoint).

### 2. ANALYZE
Build the tick's worklist by classifying every non-terminal card:
- **P (parallel-now):** no unmet dependency, agent-executable → candidate.
- **S (serial):** name the predecessor; if the predecessor resolved since last
  tick, PROMOTE to P (this is the main thing loops catch that humans forget).
- **O (owner/external):** verify the gate still holds; if it cleared (e.g.
  auth restored, values arrived), promote and say so loudly.
Rank P items by leverage: (items retired per unit work) × (GA-bar boxes touched).

### 3. ACT (bounded)
Execute the SINGLE highest-leverage P item this tick — fully, with evidence
(tests run, output captured), respecting all hard rules in CLAUDE.md (no sends
without gates, no secrets in logs/board, no destructive git). If the top item
is large, do its next atomic sub-step and leave a resumable trail on the card.
If NOTHING is P (all gates owner/external), skip to 4 and say so — do not
manufacture work.

### 3b. Separate-lane review (before any Ready move that changed code)
The session that wrote a change never approves it. Two lens families, both
review-only (reviewers never edit; the driver fixes and re-proves):
- **Claude lenses (required):** 2–3 fresh sub-agent contexts (e.g.
  `code-reviewer`, domain auditor, falsifiability lens), each passed the diff +
  acceptance text, never the authoring transcript. This is the existing bar —
  unchanged.
- **Codex cross-model lens (additive, use when available):** the
  `codex@openai-codex` plugin delegates to the local Codex CLI (GPT-5.5) — a
  second-vendor adversary with no shared blind spots with the authoring model.
  Preflight once per session: `codex-companion.mjs setup --json` must report
  `ready: true` (plugin root: `~/.claude/plugins/cache/openai-codex/codex/<ver>/scripts/`).
  Invoke as `/codex:adversarial-review` (or headless:
  `codex-companion.mjs adversarial-review "--wait --base <ref> --scope branch <focus>"`),
  scoped to the tick's commits, with focus text naming the change's riskiest
  assumptions. Capture the verdict verbatim under `docs/evidence/` and triage
  every finding exactly like a Claude-lens finding (confirm → fix same tick →
  falsifiability, or refute with evidence on the card).
Non-negotiables: the Codex lens ADDS a lane, it never replaces one — a Codex
PASS does not override a Claude-lens FAIL, does not skip the Claude lenses, and
never loosens any gate (two-gate send, hard-confirm download, profile=user,
ceiling=Ready all unchanged). If Codex is unavailable, proceed on Claude lenses
alone and say so in the tick report.

### 4. SYNC (the invariant)
- Post evidence comments on every card the tick touched; move cards that met
  acceptance to Ready (never Done).
- Append a delta bullet to the state vector §0; update register rows.
- Re-export the board (it redacts secrets and retries 429s); commit docs +
  code together with a scoped conventional commit.

### 5. REPORT
End with: cards moved (from→to), the one item executed + evidence pointer,
newly promoted/blocked items, and the exact owner asks outstanding (with the
one-line command or decision each needs). Keep it under 15 lines.

## Guardrails
- One tick ≠ the whole sprint: bounded action keeps ticks cheap and safe.
- Never re-litigate owner decisions recorded on cards or in the state vector.
- If the board is unreachable, still do SENSE/ANALYZE from the committed
  mirror, act, and queue the board sync as the next tick's first step.
- If two consecutive ticks found nothing P, recommend the owner batch
  (auth/security/values) instead of ticking again.
