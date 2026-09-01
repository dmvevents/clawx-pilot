# CLWX Plane board — persisted backup

A versioned snapshot of the CLWX Plane board so the GA plan survives on clone and
its history is tracked in git. The **live board** (self-hosted Plane,
`localhost:8090`, project `81a2ea23-e060-49b4-a344-1ab0339f46d5`) remains the
source of truth for *what to work on*; these files are a durable mirror.

## Files

- **`CLWX-board-export.json`** — restore-grade dump: states, every issue
  (sequence id, name, priority, state, description) and its comments.
- **`CLWX-board.md`** — human-readable mirror, grouped by state.

## Card map (logical label → sequence id)

The card *titles* carry a stable logical label `[CLWX-N]`; Plane's own
`sequence_id` differs. Use the logical label when reasoning about GA:

| Logical | Seq | Card |
|---|---|---|
| ★ OKR anchor | CLWX-22 | ClawX GA objective + KR1–KR8 |
| CLWX-0 | CLWX-23 | Timeline — GA work history |
| CLWX-1 | CLWX-24 | Verify doc-tooling steering in-app |
| CLWX-2 | CLWX-25 | Windows moe.11 unattended clean-VM install |
| CLWX-3 | CLWX-26 | On-device default operates fully offline |
| CLWX-4 | CLWX-27 | Cloud turn degrades to on-device |
| CLWX-5 | CLWX-28 | Store-and-forward outbox |
| CLWX-6 | CLWX-29 | Cloud economics: trim per-turn floor + caps |
| CLWX-7 | CLWX-30 | Real Entra sign-in + stable UserId |
| CLWX-8 | CLWX-31 | Close Ministry infra decisions (reply + session) |

## Refresh the backup

```bash
set -a; . ~/issues-agent-runtime/plane/.agent-token; set +a   # loads PLANE_* (never printed)
node scripts/plane-board-export.mjs                           # rewrites both files
```

Run it before a commit whenever the board moves. The exporter is read-only
against Plane.

## Restore intent

The JSON is the authoritative restore artifact — it holds enough (states, issue
text, comments) to re-create the board manually or via the Plane API if the
self-hosted instance is ever lost. It is a backup, not an automatic importer.
