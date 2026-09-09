# CLWX-119 — Outlook eval repeat-run reproducibility, September 7 2026

Promoted from volatile `/private/tmp` per-run artifacts on 2026-09-09 by the GA lead, because CLWX-119's acceptance requires the repeat-run comparison to live in versioned evidence rather than in a temporary directory. Redacted: no addresses, no message subjects or bodies, no private form or attachment URLs. This is **live-mailbox eval evidence bound to September 7 source**, not installed-artifact acceptance and not a release verdict. GA remains RED.

## Why this record exists

CLWX-119 reported that the 18-row Outlook eval was **not reproducible**: two runs ten minutes apart on identical code swapped rows. A per-run comparison is the only thing that can retire or confirm that claim, and the four repeat runs it depends on were sitting in `/private/tmp`, where macOS tmp reaping had already emptied the sibling lane directories (`/tmp/laneK_raj_eval`, `/tmp/laneR87_raj_eval`, `/tmp/laneR87_raj_eval2` are now empty directories).

## Four repeat runs, identical outcome

Source artifacts: `/private/tmp/v2-eval-results-2026-09-07T04-{10-37-315,12-03-325,15-02-532,17-34-315}Z.json`. Computed comparison: `/private/tmp/clawx-119-zero-flip-comparison.json`.

| Run (UTC) | pass | fail | skip | total | pass rate |
|---|---:|---:|---:|---:|---|
| 2026-09-07T04:10:37.315Z | 16 | 1 | 1 | 18 | 94.12% |
| 2026-09-07T04:12:03.325Z | 16 | 1 | 1 | 18 | 94.12% |
| 2026-09-07T04:15:02.532Z | 16 | 1 | 1 | 18 | 94.12% |
| 2026-09-07T04:17:34.315Z | 16 | 1 | 1 | 18 | 94.12% |

## Per-row status matrix — zero flips

Every one of the 18 rows held the same status across all four runs. **Flipped rows: 0.**

| Row | R1 | R2 | R3 | R4 |
|---|---|---|---|---|
| W1, W2.1, W2.2, W2.3, W2.4 | pass | pass | pass | pass |
| W3.1, W3.2 | pass | pass | pass | pass |
| W4.1 | **fail** | **fail** | **fail** | **fail** |
| W4.2, W4.4 | pass | pass | pass | pass |
| W5.1, W5.2 | pass | pass | pass | pass |
| W6.1 | pass | pass | pass | pass |
| W7.1 | pass | pass | pass | pass |
| W8.1, W8.2, W8.3 | pass | pass | pass | pass |
| W8.4 | **skip** | **skip** | **skip** | **skip** |

The two non-pass rows are stable and typed, not flaky:

- **W4.1 `fail`** — "draft_email opens compose pane with To/Subject/Body filled"; notes `status=failed leftOpen=true`. A real, repeatable product failure, and the same defect CLWX-123 owns (draft_email refusing a draft its own fill path committed). It is not an eval-harness artifact.
- **W8.4 `skip`** — "download_attachment with confirm downloads the seeded attachment"; notes "no attachment-bearing mail in view — seed one per CLWX-61". A typed environment skip with its unlock named, not a silent pass. This is the fixture gap CLWX-61 owns.

All 18 rows reported `latencyClass: ok`.

## Relationship to the earlier September 7 gate run

The surviving gate-run log `/tmp/ga-gate-logs/2026-09-07T00-58-14-292Z/outlook-eval_15-row_K6_K14_guards_.log` (the [run 2 gate](GA_GATE_2026-09-07_run2.md), RED overall) records the **pre-fix** shape: 16/18 pass with **W3.2 failing** on attachment metadata. In the four post-fix repeat runs above, W3.2 passes and the single stable failure moves to W4.1. So the cross-run difference CLWX-119 originally reported spans a real code change; within a fixed revision the eval is stable. That distinction is the finding — a swapped row between two runs is only evidence of flakiness when the revision is identical.

## Scope and what this does not establish

- **Does not** establish installed-artifact acceptance. These runs are live-mailbox eval runs against September 7 source on the QA test account, not the moe.29 candidate.
- **Does not** satisfy CLWX-119's remaining criterion, which is **≥2 eval runs on the final artifact** recorded per-run under the repeat-run rule. That stays open and depends on installed acceptance, currently blocked with CLWX-136.
- **Does not** close CLWX-61 (attachment fixture seeding) or CLWX-123 (the W4.1 draft failure); it supplies each with a stable, dated per-row signal.
- The `/tmp` gate-run logs are still volatile. The four run JSONs are the authoritative source for this table and were read directly to compute it.

## Manifest-link check

CLWX-119 also asked to fix a broken `GA_GATE_2026-09-07_run2.md` manifest link. A full sweep of **436 relative links** across `docs/**/*.md` plus the root instruction files found that reference resolving correctly from [the evidence manifest](../GA_RELEASE_EVIDENCE_MANIFEST.md); no broken link involving that file exists today. Two other results from the same sweep: one regex string in the generated `docs/plane-board/CLWX-board.md` that only looks like a link (false positive, generated file, left alone), and one genuinely broken evidence reference in `docs/bugs/CLWX-128-claude-session-configuration.md` pointing at `../evidence/claude-goal-controller-20260909.json`. That file belongs to the configuration-audit owner for this pass and was deliberately left untouched; it is reported to that owner rather than edited here.
