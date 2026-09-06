# Codex adversarial review — CLWX-77 registration-smoke leg (2026-09-06)

Lane: cross-model adversary (§3b, additive). Runner:
`codex-companion.mjs adversarial-review` (codex-cli 0.153.4, pin `gpt-6-astra`,
allowlisted). Target: branch diff against `c1e08d5a` (commit `91f1c588`).
Focus: staged-artifact isolation, closed-port probe semantics, false-GREEN
paths, inventory correctness, side-effect freedom.

## Verdict (verbatim)

> Verdict: needs-attention
>
> Do not ship yet: registration can grade PASS after a child crash or with
> parked tools. The 31-name inventory matches current source.
>
> Findings:
> - [medium] Reject child failures even after a successful registration
>   verdict (scripts/harness-artifact-child.mjs:64-65) — The new registration
>   mode emits success before background work finishes. runChild subsequently
>   accepts that verdict without checking the child's exit code or signal. A
>   controlled mutation scheduling an asynchronous throw inside register()
>   produced exit code 1 while plugin-registration.full still graded PASS.
> - [medium] Replace the assumed closed port with deterministic network
>   isolation (scripts/harness-artifact.mjs:273-275) — Nothing reserves or
>   guarantees that port 65123 is closed. register() invokes the capability
>   gate's real GET /api/capabilities, so a listener can receive requests and
>   influence the gate. With a mocked successful response containing an empty
>   route inventory, all 31 names still passed while browser.diagnose
>   returned unavailable.

## Triage — both CONFIRMED, fixed same tick (38fee5c6), probes re-run

The Claude lenses (separate workflow, 11 agents, 8 confirmed minors / 0
refuted) independently confirmed the closed-port overstatement and added the
duplicate-registration set-semantics hole, the missing fast-lane inventory
coupling, the unpinned skillAllowlist kill-switch gate, and two docs-honesty
wording fixes — all landed in the same commit.

1. **Child exit ignored** → `foldChildExit` (exported, unit-tested 4 rows):
   nonzero exit/signal = infra FAIL even with a framed success verdict.
   Re-proof: the exact async-throw mutation now grades FAIL
   ("child exited 1 after framing a verdict (discarded)").
2. **Assumed-closed port** → the child stubs `globalThis.fetch` BEFORE the
   plugin loads (records + rejects every attempt; no socket possible; the
   CLWX-86 probe deterministically takes unreachable → fail-open).
   Re-proof: an ACTIVE HTTP listener on 65123 received **zero** connections
   while `plugin-registration.full` passed (harness exit 0).

Also landed from the Claude lane: `inventoryDiff` duplicate detection, the
`plugin-registration.killswitch` row (host.skillAllowlist without 'outlook'
suppresses exactly the outlook family), and a fast-lane drift guard parsing
the registerTool literals out of index.mjs (31/31 match).

Full artifact matrix after hardening: **22 rows — 14 PASS /
7 REFUSED-READABLY / 0 FAIL / 1 NO-TOOL**
(`docs/evidence/HARNESS_ARTIFACT_2026-09-06.md`). Unit guards 39/39.
No gate loosened; the Codex lane is additive to the required Claude lenses.
