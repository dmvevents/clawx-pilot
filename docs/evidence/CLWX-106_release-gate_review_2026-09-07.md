# CLWX-106 — independent review of the fail-closed release gate

Workstream 1 ("trust the acceptance result"). Review-only lane, independent of
the author (the change was authored by a parallel Codex session; this reviewer
saw the diff, the tests and a mutation probe — not the authoring transcript).

| Field | Value |
|---|---|
| Criterion | CLWX-106 partial: strict release mode fails closed on missing / non-PASS required proof |
| Source revision | working tree atop `58d04eb0` (the CLWX-106 changeset is **uncommitted**) |
| Reviewed files | `scripts/ga-gate.mjs`, `scripts/ga-gate-verdict.mjs`, `tests/unit/ga-gate-verdict.test.ts` |
| Reviewed-bytes hash | `sha256:1d3a9684093a4ea73fb3c559b22b574def7e7e90f048f3750efef9df9cf32786` (of `git diff HEAD --` over those three files) |
| Environment | local dev (macOS), Node + vitest 4.1.1 |
| Timestamp | 2026-09-07T09:02:10+0400 |
| Result | **PASS (CONFIRMED)** — zero findings |

## Fail-open hunt (the #1 recurring defect class; re-shipped ≥6×)

Each candidate hole was traced and closed:

1. **INFO T2 probe as proof** — `t2-installed-windows-app` only ever emits `SKIP` or `INFO`, never `PASS`, so release mode is currently *unpassable by construction* until real installed-app evidence ingestion exists. Honest fail-closed, not a hole. Pinned: test L347.
2. **`optional:true` bypass** — dev mode filters optional rows out of `fails`; release mode does not exempt a release-required criterion because it is optional. Pinned: test L390.
3. **Caller-supplied override** — `scorecard` ignores any `releaseCriteria` option and always uses the module-pinned `RELEASE_REQUIRED_CRITERIA`. Pinned: test L281.
4. **Absent-by-typo** — a criterion id with no emitting row is `ABSENT` → blocker → exit 1 (fails safe). All 16 required ids cross-check against emitting rows in `ga-gate.mjs`.
5. **Fabricated PASS** — `PASS` is set only on real exit-0 execution in `run()`; `skip()` sets `SKIP`. No note-text/stdout verdict path remains (`classifyRow` is exit-code-only; pinned L134).
6. **Dev-mode regression** — with `release=false`, `releaseBlockers=[]`, exit contract unchanged. Pinned L420.
7. **Static+release** — `GA_GATE_STATIC=1` + release always fails (`release-mode=STATIC_ONLY` blocker). Pinned L401.
8. **Executable vs pure function** — the vm-sandboxed test drives the actual `ga-gate.mjs` and asserts `process.exit(1)` + "Release strict gate: FAIL" written. Pinned L430.

## Falsifiability (mutation proof)

Neutralising the guard (`const releaseFailed = releaseBlockers.length > 0` → `false`)
on a throwaway copy makes a run with a **missing required lane** exit `0` instead
of `1`. The real module exits `1`/RED on the same input. Therefore the suite's
fail-closed assertions are load-bearing, not tautological. Probe:
`$CLAUDE_JOB_DIR/tmp/mutation-proof.mjs` → `MUTATION PROOF PASS`.

Focused suite: `pnpm exec vitest run tests/unit/ga-gate-verdict.test.ts` → **30/30 passed**.

## Scope and what remains (CLWX-106 stays PARTIAL)

This review covers only the fail-closed *verdict* semantics. Per the completion
plan, workstream 1 is not closed: the T2 row still collects only availability
(no artifact provenance / installed-evidence ingestion), and release-publication
integration is not wired. The gate correctly refuses to emit a GREEN release
verdict today — it cannot yet emit a GREEN one at all, which is the intended
fail-closed posture until that evidence pipeline is built.

**Blocker on continuing workstream 1:** the reviewed code is sound but sits in a
~36-file uncommitted peer changeset. Building the T2/publish integration on top
of uncommitted peer work would entangle authorship and defeat independent review.
The concrete unblock is an owner commit decision on that changeset; no card is
moved to Ready (CLWX-106 remains In Progress / partial).
