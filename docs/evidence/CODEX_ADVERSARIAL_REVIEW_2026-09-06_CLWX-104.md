# Codex adversarial review — CLWX-104 run-error de-dup (2026-09-06)

Lane: cross-model adversary (§3b, additive). Runner:
`codex-companion.mjs adversarial-review` (codex-cli 0.153.4, pin `gpt-6-astra`,
allowlisted). Target: branch diff against `5f0a74e3` (commit `f37ec9a6`).
Focus: can the D0 seed-gate hide a real failure; can the D1 suppression leave
zero surfaces; is the wrapper-blanking over-broad; is degrade gating
byte-identical; do the new tests actually pin the fix.

## Verdict (verbatim)

> Verdict: needs-attention
>
> Do not ship: two reproduced regressions hide real failures. In-memory probes
> confirmed both; Vitest was blocked by sandbox restrictions.
>
> Findings:
> - [high] History suppression removes the only visible failure surface
>   (src/stores/chat.ts:2378-2380) — An attachment-only send is valid, but its
>   empty lastSentPayload.text makes ownTurnSurfacedError false. A
>   history-only failure such as {stopReason:'error', errorMessage:'401
>   Unauthorized', content:[]} now leaves runError, error, and degradeNotice
>   null. The assumed inline fallback does not exist: extractText ignores
>   errorMessage, and ChatMessage returns null for empty content. Reopened and
>   adopted turns lose visibility similarly. Differential probes showed the
>   base displaying the auth failure and this commit displaying nothing.
> - [high] A failed resend is hidden behind the previous failover notice
>   (src/pages/Chat/index.tsx:155-159) — Suppression checks only whether any
>   degradeNotice exists. After cloud failover, an on-device resend can reject
>   with ECONNREFUSED; sendMessage catches that failure and resolves, so
>   maybeDegradeChannel restores {resent:true,to:'on-device'} alongside the
>   new error. These predicates then hide the failure, leaving only copy
>   claiming an answer came from this device.
>
> Next steps: Add rendered regression tests for both invisible-failure paths.
> Fix the K12 reload fixture: it also passes against the base because
> automatic resend clears the banner before assertion. Disable failover and
> assert no resend.

## Triage — both HIGHs + the fixture note CONFIRMED, fixed same tick (round 2)

The Claude lenses (separate workflow, 18 agents) independently confirmed both
HIGHs (escalating the resend one to critical) and verified each round-2 fix
goes red against committed round 1 and green with the fix:

1. **Attachment-only invisibility** → banner ownership changed from text
   presence to payload PRESENCE (`ownSendThisWindow = !!lastSentPayload`);
   the text gate remains only on the replay decision (CLWX-93). Pin: "paints
   the banner for an attachment-only own send".
2. **Failed resend hidden** → two-part: the terminal-error path clears a
   `resent: true` notice (it no longer explains anything), and the page
   predicate (`errorBannerVisibility`) never lets a success-claiming notice
   suppress a failure. Pin: "clears a success-claiming resent notice when the
   resend itself fails terminally".
3. **Vacuous K12 fixture** → failover disabled in the row (online-only
   accounts); mutation probe now shows exactly the 4 guard rows failing on a
   reverted seed-gate.

Full round-2 proof chain: `docs/evidence/CLWX-104_RUN_ERROR_DEDUP_2026-09-06.md`.
No gate loosened; the Codex lane is additive to the required Claude lenses.
