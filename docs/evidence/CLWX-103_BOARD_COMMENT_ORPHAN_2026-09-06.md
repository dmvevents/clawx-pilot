# CLWX-103 — board comments orphaned cross-project: evidence pack (2026-09-06)

Companion to the state-vector 2026-09-06 third-tick delta and the CLWX-103 card.
Records the raw probes behind every reconcile claim so they stay falsifiable
(Claude falsifiability-lens finding). Review verdicts:
`docs/evidence/CODEX_ADVERSARIAL_REVIEW_2026-09-06_CLWX-103.md` (cross-model lane).

## 1. Symptom → falsified hypothesis

Five comments POSTed 2026-09-06 06:41:12Z (CLWX-42/78/92/95) and 07:11:13Z
(CLWX-83) returned HTTP 201 with full bodies (saved verbatim at
`/tmp/moe18-comments/resp-*.json`, ids `bbb083c4…`, `39a22351…`, `dc5d6433…`,
`e4483361…`, `92d72c02…`) yet never appeared on the board or in the mirror.

Hypothesis "list/export endpoint lags/paginates past just-posted comments" —
**falsified**: a fresh `plane-board-export.mjs` run produced a byte-identical
mirror (empty `git diff docs/plane-board/`), and a full-board audit fetching
`issues/<id>/comments/?per_page=100` live for **all 102 issues** and comparing
`total_results` against the export JSON reported:

```
checked 102 issues; 0 mismatches
```

## 2. Root cause (database ground truth)

Direct GET of a posted id under the CLWX path → `404 {"error":"The requested
resource does not exist."}`. But Postgres (`community-plane-db-1`, db `plane`):

```
select c.id, c.project_id, i.sequence_id, i.project_id from issue_comments c
join issues i on i.id=c.issue_id where c.id in (…the 5 ids…);
-- all 5 rows: deleted_at NULL, c.project_id = c6717c2c-af66-4b8b-9f9d-5a13a7a03df8
--            issue project_id = 81a2ea23-e060-49b4-a344-1ab0339f46d5 (CLWX)
select id, identifier, name from projects where id in (…);
-- c6717c2c… | GHIP | GitHub Issues & PRs
-- 81a2ea23… | CLWX | ClawX — Windows installer + agent
```

So: the rows existed, un-deleted, bound to the **GHIP** project while their
issues are CLWX — created through a wrong-project URL that this Plane build
accepts (201) and that every CLWX read path then filters out. The wrong id came
from the token file itself: `~/issues-agent-runtime/plane/.agent-token` line 4
exports `PLANE_PROJECT=c6717c2c…` for the GitHub-sync agent, and the tick-1/2
posting one-liners reused `$PLANE_PROJECT`.

## 3. Reconcile (executed this tick)

- Re-posted all 5 payloads via the new `scripts/plane-comment-post.mjs`
  (each line printed `… (readback verified: detail + list)`):
  CLWX-42 → `23fb5dd9…`, CLWX-78 → `fc9e69e5…`, CLWX-83 → `0a4e9879…`,
  CLWX-92 → `18d91214…`, CLWX-95 → `5354e176…` (created 07:27:37–39Z).
- Deleted the 5 GHIP orphans via API DELETE under their actual project path —
  five HTTP 204 responses — then re-checked Postgres:

```
select count(*) from issue_comments where id in (…the 5 orphan ids…)
  and deleted_at is null;  -- 0
```

- Re-exported the board: mirror diff +20/+15 lines = exactly the five
  recovered comments (commit `83ef926b`).

## 4. What "proven" means for the poster's branches

- Resolve-refusal branches (unknown card, malformed card, foreign-prefix card,
  unknown issue uuid, both-flags, missing --file value, TTY stdin, malformed
  JSON payload, malformed API key): exercised **live/local** — each exits 1
  with the expected message.
- Readback **ORPHANED** branch: exercised via the Codex lane's **mocked-fetch**
  run (created-but-not-readable → non-zero), NOT live — recreating a live
  cross-project write on purpose would re-pollute the GHIP project. Recorded
  as the honest limit of this proof.
- Readback **INCONCLUSIVE** branch (transient readback error after a 201):
  code-reviewed + type-checked only; would need a fault injector to exercise.

## 5. Fix commits

- `83ef926b` — poster v1 + skill-doc trap row + state-vector delta + reconciled
  mirror.
- Follow-up commit (this tick) — all review-lane fixes: key-shape guard +
  scrub + global handlers, project-identifier prefix check, stdin setEncoding,
  --file value validation, TTY-stdin refusal, both-flags refusal,
  case-insensitive .json sniff with parse/key errors that never echo payload,
  ORPHANED-vs-INCONCLUSIVE readback split, dead "(!)" marker removed in favor
  of a fail-closed project assert.
