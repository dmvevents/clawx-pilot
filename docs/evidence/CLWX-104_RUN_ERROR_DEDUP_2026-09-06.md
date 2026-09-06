# CLWX-104 — run-error notice de-dup / stale-banner / channel-neutral copy (2026-09-06)

Fast-follow for the **CLWX-78/95** family, fixing moe.18 VM-verify **Findings
D0/D1/D2** (`skills/laptop/evidence/2026-09-03-moe18-verify/RESULT.md`).
Commits: `f37ec9a6` (round 1) + the round-2 review-hardening commit.

## What was broken (moe.18, installed release build)

- **D0** — the red `chat-run-error` banner persisted across new chats AND a
  gateway restart, clearing only on app relaunch: `loadHistory` unconditionally
  re-seeded `runError` from the last terminal assistant message in history.
- **D1** — the generic run-error component co-rendered with the correct amber
  degrade notice (up to three stacked error banners: principal-proxy "looks
  broken" veto).
- **D2** — its copy was online-centric regardless of which channel failed
  (contradicting the notice in the on-device direction), and "Technical
  details" surfaced the raw SDK wrapper "Connection error." which the trust
  bar forbids.

## The fix (display layer + two store seams; degrade/failover logic untouched)

1. **D0** (`src/stores/chat.ts` loadHistory): history may seed/clear the
   banner only while a turn is ACTIVE in this window (`lastUserMessageAt`,
   nulled after first surfacing) and only for an own send (payload PRESENCE —
   attachment-only sends included; the stricter text gate remains only on the
   REPLAY decision, CLWX-93). Idle-window reloads preserve; adopted console
   turns clear rather than paint. Mirrored into the dormant modular copy
   (`src/stores/chat/history-actions.ts`) so a future refactor cannot
   resurrect D0.
2. **D1** (`src/lib/error-display.ts::errorBannerVisibility`, thin call in
   `src/pages/Chat/index.tsx`): while a degrade notice is EXPLAINING a
   transport failure, same-class red banners are suppressed; a
   success-claiming notice (`resent: true`) never suppresses anything, and the
   store clears such a notice when a newer terminal error lands; the error bar
   never duplicates the callout verbatim; auth-config/generic always show.
3. **D2** (`error-display.ts` + `en/chat.json`): the exact transport-wrapper
   family ("Connection error.", optional "Model call failed" prefix) is
   blanked from the expander; `rawError=Connection error.` fragments stripped
   from longer details; classification still runs on the full string;
   unreachable/rate-limited copy is channel-neutral.

## Separate-lane review (all three lanes, §3b)

- **Codex cross-model** (gpt-6-astra): needs-attention, 2 HIGH both
  reproduced — attachment-only own send became invisible (no in-line surface
  exists for empty-content error messages); failed on-device resend hidden
  behind the stale success-claiming notice — plus the K12 test row passing
  vacuously on base. Verdict verbatim:
  `docs/evidence/CODEX_ADVERSARIAL_REVIEW_2026-09-06_CLWX-104.md`.
- **Claude lenses ×3** (error-visibility / trust-principal / falsifiability,
  18 agents, per-finding adversarial verify): 12 confirmed / 3
  refuted-with-evidence. Independently converged on both Codex HIGHs (one
  escalated to critical), and added: the dormant modular store copy still
  carried D0 with green tests pinning the OLD behavior; the D1 page wiring was
  untested; an e2e spec pinned the forbidden stale-banner-on-fresh-window
  behavior; the store comment claimed a nonexistent in-line fallback.
- **Graph lenses**: code-review-graph risk 0.40, 0 affected flows; flagged
  `applyLoadedMessages` as a coverage gap (covered indirectly via the six
  loadHistory banner rows).

**Every confirmed finding fixed same tick**: ownership-by-payload-presence;
resent-notice never suppresses + store clears it on a newer terminal error;
K12 row made falsifiable (failover disabled); modular copy + its tests aligned
to the new contract with a D0 pin row; `errorBannerVisibility` extracted and
unit-tested (5 rows); e2e spec re-pinned to the new contract; comment fixed.

## Proof

- Unit: 63 rows across the three touched suites; full suite **1535 pass /
  6 skip**; typecheck + lint clean.
- **Mutation probe**: reverting the D0 seed-gate makes exactly the 4 guard
  rows fail (incl. the K12 row post-hardening — it failed vacuously before);
  restored → green.
- Codex-verified red→green: the attachment-only row and the failed-resend row
  each fail against committed round 1 and pass with round 2.
- e2e: `chat-task-visualizer.spec.ts` "stale run-error banner" spec updated to
  the new contract and run locally against the built renderer.

## Honest limits / residuals (recorded, not blocking)

- **In-line rendering gap**: error-stopped assistant messages with empty
  content render NOTHING in the transcript, so a historical failure on
  session re-open now has no surface at all (the D0 bar removed the stale
  banner that used to stand in for it). Filed as its own follow-up card —
  in-line error chip for error-stopped messages.
- The degrade notice is store-global, not session-scoped: a `resent: false`
  notice can outlive a session switch and suppress an unrelated transport
  banner until dismissed/next send (minor, Dismiss exists).
- The neutral copy names both channels without knowing which is available.
- **NEXT-BUILD GATE**: the moe.18 findings were observed on the installed
  release build; these fixes ship with the next cut (same class as
  CLWX-99/100/101) — the live re-verify belongs to the next VM matrix run.
