# GA / demo readiness — holistic assessment (2026-09-05)

**Audience:** technical lead (owner). **Purpose:** one honest read of where we are
against the Monday principals' demo (~2026-09-08) AND against the broader GA bar,
*before* pointing the next block of work. No code was written to produce this —
it is grounded in the board export, the GO/NO-GO scorecard, the gate mechanics,
and the live-lane state, not in the capabilities map's intent.

This deliberately separates **two different bars** that we have been blurring:

- **Bar A — the Monday demo.** Three scripted live moments in front of principals.
- **Bar B — GA.** All 8 capabilities production-safe on the fleet, 14 GO/NO-GO
  boxes checked. This is weeks out and gated on the Ministry, not on us.

Conflating them is exactly the "little spot fixes" trap: grinding GA cards
(Bar B) does not de-risk Monday (Bar A), and vice-versa.

---

## 0. Bottom line up front

- **Monday is demoable, but on a knife-edge with one dominant failure mode.**
  All three demo moments have been proven at least once (email read/draft/send
  gate; doc→form fill+submit *recorded*; cron reminder as a clip). What is NOT
  reliable is the thing they all sit on: **the live Chrome-over-CDP attach to
  the signed-in Outlook/Forms tab.** It has crashed and wedged the live lane for
  3+ consecutive checks, and the auto-recovery path itself has a hard-rule
  hazard (CLWX-73: it can fall back to *managed* Chromium, which Conditional
  Access blocks with AADSTS53003).
- **GA (Bar B) is not close and is mostly not ours to close.** Of 14 GO/NO-GO
  boxes, 2 are checked (KR3 offline, KR4 degrade). The rest are either
  owner/Ministry-gated (KR7 Entra UserId, KR8 Ministry session, CLWX-18/19
  security floor) or need real work (KR2 fresh-VM install, KR5 outbox, KR6 token
  floor). No amount of agent ticking checks the Ministry boxes.
- **The single highest-leverage thing we control before Monday is lane
  stability, not feature breadth.** One reliable Outlook/Forms attach that
  survives a 20-minute demo (and never silently degrades to managed Chromium)
  protects all three demo moments at once. That is the same root that (a) wedges
  the GA gate's live lane and (b) blocks Karunesh's real-box email test (K1).
  One fix, three payoffs.

---

## 1. The demo (Bar A) — the three moments, honestly

Per CLAUDE.md the principal sees, in order: **(1) Email**, **(2) Document→form**,
**(3) Cron reminder**. Items 1+2 must work live; item 3 ships as a clip if cron
timing doesn't line up.

| Moment | Proven? | Demo-safe verdict | Dominant risk | Fallback if it breaks on stage |
|---|---|---|---|---|
| **1. Email** — "summarise my last 5 emails", then "draft a reply … I'll be at the parent meeting", review, Send (hard-confirm gate fires) | Yes — 15/15 eval + 4-step two-gate send proof (historical, live) | **At-risk (recoverable)** | Chrome renderer tab crash mid-session → CDP handshake wedges; auto-recovery may pick managed Chromium (CLWX-73) → AADSTS53003 | Pre-warm a fresh Chrome attach immediately before the demo; have a recorded email clip in reserve |
| **2. Document→form** — drop a suspension report, agent extracts 32 fields, pre-fills Suspensions clone on test.fac, principal confirms, submit | Yes — fill 29/32 + gate refusal + ONE confirmed submit *verified landed*, **video+trace recorded** | **Safe (recorded backstop exists)** | Same CDP dependency for the live fill; MS Forms selector rotation (mitigated by response-page pivot) | Play the recorded submit; it is already a clean artifact |
| **3. Cron reminder** — 3:45pm chat prompt "submit today's daily report", principal answers back to submit or defer | Partially — pipeline built; **e2e cron→visible-prompt not proven** (CLWX-67 Todo) | **Clip-only for Monday** (as planned) | Cron timing won't line up in a live window anyway | Pre-recorded clip — this was always the plan; do not attempt live |

**Reading:** the demo's exposure is concentrated in moment 1 (live email), and
entirely in the Chrome/CDP attach — not in the LLM, the tools, or the gates,
which are all proven. Moment 2 has a recorded backstop. Moment 3 is a clip by
design.

---

## 2. All 8 capabilities vs. GA (Bar B) — grounded status

Status keys: **● live-proven**, **◐ built (not live-proven end-to-end)**,
**○ planned**. "Demo-relevant" = touches one of the three Monday moments.

| # | Capability | Grounded status | Demo-relevant | GA gap (card) |
|---|---|---|---|---|
| 1 | **Email** (read/draft/reply/send via Outlook) | ● live — 15/15 eval, two-gate send proof, 73/73 contract units; Graph read-only transport behind flag (CLWX-39) | **Yes (moment 1)** | forward + live attachment eval rows open (CLWX-61, Todo); stale-read guard landed (CLWX-46, Ready); compose auto-recovery landed+wired (CLWX-58, Ready) |
| 2 | **Daily MoE forms** (Suspensions + Daily Report) | ● live-proven + **recorded** on Suspensions; Daily Report e2e open | **Yes (moment 2)** | Daily Report recorded leg (CLWX-62, Ready, needs DEMO=1); production destination Ministry-gated (CLWX-7, Todo) |
| 3 | **Letters & reports** (drafting) | ◐ built — templates authored; runtime write proven (Win OFFICE_WRITE_OK, Mac 8/8) | No | live in-app write turn open (CLWX-65, Todo) |
| 4 | **Leave & attendance** | ◐ built (read) / ○ planned (registers) | No | registers post-GA (CLWX-68) |
| 5 | **Routine-query response** | ● live in chat (NSCC 18/20) + live over email | Indirectly (moment 1 tone) | NSCC eval is opt-in in the gate (GA_GATE_FULL) |
| 6 | **Meeting minutes & memos** | ● live transcription Mac (real whisper ×2); Windows ASR = gap | No | Windows ASR (V-batch); drafting untemplated (CLWX-66) |
| 7 | **Inventory & reminders** | ◐ built (taskflow + agentTurn cron) | **Yes (moment 3, clip)** | reminder e2e open (CLWX-67, Todo); Windows cron live-fire = gap |
| 8 | **Document processing** | ● live (read — KR1 in-app PASS incl. OneDrive-KFM) / ◐ built (classify/route/draft) | Feeds moment 2 | classify/extract/route/draft (CLWX-63/65/66, Todo) |

**Reading:** the three capabilities the demo actually leans on (1, 2, and 8 into
2) are the *most* proven of the eight. The Todo-heavy cards (65, 63, 66, 67, 61)
are GA-breadth, not Monday-blocking.

---

## 3. The dominant risk — one root cause wearing three hats

Everything worrying traces to a single dependency: **the live Chrome-over-CDP
attach to the principal's signed-in Outlook/Forms tab.** It is the only auth
carrier (by hard rule — no basic-auth, no token replay), and it is fragile.

It shows up as three separate-looking problems:

1. **GA gate can't stay green (Bar B).** The T1 live lane fails *all* rows at
   once whenever the shared Outlook renderer tab crashes (`Page crashed` →
   `connectOverCDP` timeout on a stale target). T0 static is GREEN; the live
   lane has been wedged 3+ checks. This is a lane condition, not a product/gate
   defect — but it means we cannot produce a fresh full-GREEN gate run on demand.
2. **Karunesh's real-box email is blocked (external validation).** The K1
   chrome-attach failure is the same class — the tester can't get a stable
   attach on their machine.
3. **On-stage Monday risk (Bar A).** If the tab crashes during the demo, the
   auto-recovery path (CLWX-73) can fall back to **managed Chromium**, which the
   MoE tenant's Conditional Access blocks (AADSTS53003) — turning a recoverable
   blip into a hard, on-stage auth failure in front of principals.

**CLWX-73 is the sharp edge.** A recovery path that violates the "never managed
Chromium for tenant flows" hard rule is worse than no recovery, because it fails
*louder* and in a way that looks like the product is broken. It is Ready on the
board; it deserves to be treated as demo-critical, not GA-breadth.

Secondary (real, not Monday-blocking):
- **CLWX-91** — seeded subagent/tool-heavy chat history trips an unguarded
  `.filter` in a `useMemo`, throwing to the top-level ErrorBoundary
  ("Something went wrong") and white-screening main-layout. A real trust-killer
  crash class for a principal with rich history — but not on the demo script.
- **CLWX-74 / CLWX-78** — VLM grounding hard-fails without AWS creds; some
  degrade strings ("Connection error.") aren't matched by the degrade
  classifier. Both erode the "never look broken" trust lens the principal-proxy
  guards, but neither is on the three demo moments.

---

## 4. GO/NO-GO scorecard (Bar B) — where the 14 boxes stand

Source: `docs/wiki/GA_READINESS.md` §4. GA needs all boxes; today **2 are
checked**.

**Checked (2):** KR3 (on-device + local docs, egress blocked — lane G 5/5) ·
KR4 (cloud→on-device degrade — bde78d94 + 25 units).

**Evidence-complete, awaiting acceptance (product, ours):** KR1 (in-app
doc-tooling trace — harness green, needs the in-app trace) · release hygiene
(typecheck+unit+eval+harness green at tag — green today).

**Needs real work (ours):** KR2 (fresh-VM assisted install recording — blocked
by the VM being TERMINATED) · KR5 (offline outbox survives kill -9, idempotent
flush) · KR6 (per-turn floor ≤2,500 tok + per-user caps).

**Owner / Ministry-gated (NOT ours to check):**
- KR7 — real Entra sign-in → stable per-principal `UserId` in the APIM header.
- KR8 — Ministry reply sent + working session held + real APIM/Entra values.
- External: Raj's 4 June-21 defects reproduced-or-refuted; one tester completes
  download→install→first-turn unaided.
- Security floor: CLWX-18 (plaintext test password absent from PUBLIC branches +
  history) and CLWX-19 (`sk-clawx` key rotated) — **owner actions**, must not be
  done autonomously.

**Reading:** 6 of the remaining 12 boxes are owner/Ministry-gated. Agent ticking
moves at most the other 6, and two of those (KR2, live-lane refresh) are blocked
on infrastructure the owner controls (the terminated VM, the Chrome restart).

---

## 5. Owner-gated items (only you / the Ministry can unblock)

These are the true bottlenecks. None should be done autonomously.

1. **Restart Chrome on :18792 (un-wedge the live lane).** Loses the principal's
   unrelated open tabs, so it is your call. Un-wedges the GA gate T1 lane, the
   CLWX-62 recorded Daily Report leg, and any live email dry-run before Monday.
2. **CLWX-73 decision** — do we ship the managed-Chromium fallback disabled
   (fail closed, never managed) before the demo? Recommend yes; this is a
   hard-rule guardrail, and I can implement fail-closed once you say go.
3. **Restart / re-provision the VM** (`clawx-win-rc-20260609` is TERMINATED) —
   needed for KR2 and any Windows-lane refresh.
4. **CLWX-18 / CLWX-19** — repo-visibility split + key rotation. Owner actions.
5. **KR8 / KR7** — Ministry reply + working session + real APIM/Entra values.
   The entire cloud-attribution and token-floor story (KR6/KR7) waits on this.
6. **Gated commands** — `GA_GATE_SEND=1` (real dispatch), `GA_GATE_FULL=1`,
   `DEMO=1` (CLWX-62 recorded submit). I will not set these without your word.

---

## 6. Recommendation (for your call — no work started)

If the goal is **Monday**, the highest-leverage move is **not** more GA cards —
it is hardening the one dependency all three demo moments share:

- **P1 — CLWX-73 fail-closed** (never fall back to managed Chromium; on CDP
  crash, surface a clean "reconnecting to your browser" state and re-attach to
  the *user* profile only). Protects moment 1 on stage. Small, ours, high-value.
- **P2 — a demo pre-flight + recovery runbook** (pre-warm the attach; the exact
  reset sequence if it wedges live; which moments have recorded backstops).
- **P3 — freeze the recorded backstops** (moment 2 submit clip; moment 3 cron
  clip) so a live failure never leaves us empty-handed.

GA-breadth cards (CLWX-61/63/65/66/67, KR5/KR6) are real and worth doing, but
they are Bar B and should not consume the pre-Monday window.

---

## 7. Execution options (choose one; nothing started)

- **A — Demo-harden (recommended).** CLWX-73 fail-closed + demo pre-flight/
  recovery runbook + verify the recorded backstops. Smallest surface that most
  de-risks Monday.
- **B — Un-wedge + re-green first.** You restart Chrome on :18792; I run a full
  `pnpm ga:gate` to get a fresh GREEN scorecard and a live email/forms dry-run,
  then decide. Gives the truest picture but needs your Chrome restart.
- **C — Trust-hardening sweep.** Fix CLWX-91 (ErrorBoundary crash), CLWX-74/78
  (degrade/VLM never-look-broken) — the principal-proxy trust lens, broader than
  the demo script.
- **D — GA-breadth push.** Grind the Todo capability cards (61/63/65/66/67)
  toward the 8-capability bar. Moves Bar B; does little for Monday.
