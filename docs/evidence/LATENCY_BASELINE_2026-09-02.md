# Latency baseline — first cut (CLWX-43 / LATENCY-UX)

*2026-09-02, sprint-driver tick. Source: every driver evidence JSON on the
persona VM (15 turns, moe.11→moe.14, wall-clock = finishedAt−startedAt).
Answers Raj's twice-volunteered complaint ("taking real long to respond…
thinking", 05-27 + 06-27) with numbers instead of impressions.*

## Measurements (cloud channel, VM lane)

| Class | Turns | Wall-clock |
|---|---|---|
| Successful tool-using turns (docx/xlsx read + summarise) | 3 | **79.6s / 103.4s / 182.2s** |
| Successful no-tool answer (post-fresh-boot) | 1 | 107.9s |
| Fast-fail answers (file-not-found graceful path) | 3 | 24.7–35s |
| On-device turns (e2 VM, CPU-starved — excluded from budget) | 2 | 265–302s, timed out |
| Driver INCOMPLETE artifacts (30.2–30.5s poll ceiling) | 5 | excluded |

**Median successful turn ≈ 103s. Proposed budget (p50 ≤15s / p90 ≤30s): FAIL
by ~7×.** The complaint is real, current, and now on the record with data.

## Caveats (read before quoting)
- The e2-standard-4 VM is NOT persona hardware (no GPU, 4 shared vCPU,
  datacenter network); the pilot LAPTOP measurement is the acceptance number.
- The driver adds up to ~9s settle-detection tail per turn.
- Small sample; mixed builds; two turns ran immediately post-fresh-boot.

## What moves the number (already carded/on the agenda)
1. **Prompt caching** (session ask #7) — the fixed ~7,550-token prefix is
   identical every turn; caching attacks both cost AND time-to-first-token.
2. **Tool-catalog trim** (owner HOLD, `7add864b`) — smaller prompt = faster.
3. Broker/model routing (moe-demo vs moe-demo-pro per turn class).

## Next (to close CLWX-43)
Repeat the 3-demo-prompt measurement on the pilot laptop under moe.14, agree
the budget with the owner, add the pass/fail row to the GA evidence packet.
