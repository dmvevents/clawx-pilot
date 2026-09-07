# ClawX GA plan — the path from today to General Availability

> Historical plan/evidence. Current execution order and readiness: [COMPLETION_PLAN.md](COMPLETION_PLAN.md); shared instructions: [PROJECT_CONTRACT.md](PROJECT_CONTRACT.md). Preserve dated entries below as evidence, not current startup instructions.

**Status: plan. Written 2026-08-27 against branch `fix/doc-tooling-steering`, HEAD `bde78d94`.**

The source of truth for *what to work on* and *what "done" means* is the CLWX Plane
board (project `81a2ea23-e060-49b4-a344-1ab0339f46d5`), not this file. This document is
the ordered reading of that board: how today's state becomes GA, each step named against
the card and Key Result it satisfies, and each step grounded in an artifact in this repo.

The agent ceiling on that board is **Ready**. Only a human moves a card to **Done**. This
plan never assumes otherwise.

FACTS are things in git or a committed doc. INFERENCE is reasoning not yet proven
end-to-end. OPEN QUESTIONS are Ministry-owned. Every section separates them.

---

## Where GA is defined

The Definition of GA lives in the board's **`★ OKR ANCHOR — ClawX GA`** card as KR1..KR8.
Summarised:

| KR | GA condition | Card | Status |
|---|---|---|---|
| KR1 | Raj's 5 prompts + discovery pass in a **live in-app LLM run**; `document.*` chosen every time, Python skill zero times | CLWX-1 | capability GREEN, in-app RED |
| KR2 | moe.11 installs unattended on a clean Windows VM; both ports bind | CLWX-2 | GREEN on IAP (assisted-screen run outstanding) |
| KR3 | On-device default answers grounded in a local doc with the network cut | CLWX-3 | GREEN |
| KR4 | A cloud turn during an outage degrades to on-device, not silence | CLWX-4 | GREEN |
| KR5 | Offline form/audit records queued locally, delivered exactly once | CLWX-5 | RED — not built |
| KR6 | Per-turn floor trimmed + per-user caps so the fleet can't 429 at once | CLWX-6 | RED — trim on HOLD, caps not built |
| KR7 | Interactive Entra sign-in yields a stable `oid`; `UserId` stamped server-side | CLWX-7 | RED — stub identity only |
| KR8 | Ministry reply sent + hostname / redirect-URI / caching settled | CLWX-8 | DRAFT ready, UNSENT (owner gate) |

---

## Timeline (the spine — full detail in board card `[CLWX-0]`)

**FACTS:**

- **2026-06-09/23** — Windows RC line and the Outlook "Green" RC: send/draft/reply hardened
  with the same-session hard-confirm gate; moe.10 installer built (`b38b6208` line; sha256
  `e35ee6cd`, 2026-06-23).
- **2026-07-25** — Native `document.*` tools land (`98e805d8`); 5-prompt harness and
  windows-installer-e2e scaffolds (`bf6c0d26`, `2d4e318a`).
- **2026-07-31 → 08-03** — Windows knowledge pack (`afff7f15`); BUG-012 first-run crash
  found then fixed (`0fb4918e` → `fc435c6b`); PowerShell BOM regression (`9311f107`);
  on-device tool-catalog trim to stop the cascade hang (`7add864b`, branch
  `fix/tool-catalog-trim`).
- **2026-08-19** — GCP IAP Windows test lane established; the AWS EC2 lane retired as
  IAM-dead. The static-IP question dissolves (IAP needs none).
- **2026-08-20** — Ministry's 0/5 transcript committed (`794cce74`); doc-tooling
  steering + discovery fix (`c1b18125`); 6-lane tool-selection eval (`73514b4f`); moe.11
  built and installs clean over IAP with the trim verified live (`de8e9759`, `verdict.md`);
  Ministry reply drafted UNSENT (`7dfb43d9`) and rebuilt around an app server that accepts
  PostgreSQL (`78fd6fe0`); scale analysis (`982fd5d4`); offline design + lane G egress guard
  (`c45c5bc4`, `c9f1aa34`).
- **2026-08-21** — Cloud→on-device send-time degradation shipped and tested (`bde78d94`).

**INFERENCE:** the doc-tooling *capability* gap closed on 2026-07-25, but the *steering*
gap stayed open until 2026-08-20 — a fresh install's auto-enabled `pdf` skill still told the
model to reach for Python. `c1b18125` closes it in config and eval, but no in-app LLM run has
confirmed it against Raj's fixtures.

**OPEN QUESTIONS:** moe.11 has never been through an assisted-screen clean-VM install (only
silent `/S` and IAP); OneDrive-redirected Desktop discovery is unverified on Windows.

---

## The ordered path to GA

Ordering follows "what breaks first" (`SCALE_ANALYSIS_2026-08-20.md` §7) and "what needs
nothing from the Ministry" first.

### Step 1 — Close the doc-tooling loop in-app (CLWX-1 → KR1) — IN PROGRESS

This is the failure Raj actually saw and the one still unproven. The capability is fixed
(handler replay 7/7, `raj-prompt-replay/REPORT.md`) and steering is fixed in config + a BM25
eval (`c1b18125`, `73514b4f`), but both bypass the live LLM — the exact blind spot that let
0/5 happen.

- **Acceptance test:** a live, in-app, LLM-driven run on Windows executes P1–P5 + the folder
  discovery prompt; the tool-call trace shows `document.*` selected every time and a Python
  skill selected zero times; discovery finds files without a pasted absolute path, including
  under OneDrive Known Folder Move.
- **Grounded in:** `c1b18125`, `98e805d8`, `73514b4f`,
  `skills/laptop/evidence/2026-08-20-raj-prompt-replay/REPORT.md`.
- **Residual to fix inside this step:** `resolveReadablePath` does not search
  `%USERPROFILE%\OneDrive\Desktop`; every Ministry laptop with folder redirection has this
  shape.

### Step 2 — Assisted-screen clean-VM install (CLWX-2 → KR2) — TODO

moe.11 is proven to install over the IAP lane (silent `/S`, complete tree, ports bind,
`verdict.md`). The remaining gap is the *supported end-user* assisted-installer flow.

- **Acceptance test:** clean Windows VM, assisted installer screens, 0 manual dependency
  steps, complete tree, Gateway 18789 + host-API 13210 bind — screen recording + exit 0.
- **Grounded in:** `2026-08-20-moe11-iap-install-trim/verdict.md`,
  `2026-08-19-gcp-iap-windows-lane/REPORT.md`, `de8e9759`. Lane:
  `windows-pilot/vm-testing/gcp-iap-lane.sh`.
- **Do not chase the wrong layer:** install-time cost is payload re-extraction under
  Defender (131k files), not dependency reinstallation — `installer.nsh` has no install step.

### Steps 3 & 4 — Offline + degradation (CLWX-3, CLWX-4 → KR3, KR4) — READY

Both are built and tested; they sit in **Ready** awaiting a human close.

- **CLWX-3 acceptance (met):** eval lane G — `G-doc-read`, `G-no-egress`, `G-model`
  (qwen2.5:3b, 0.5–2.6s), `G-guard-live` (mutation-tested). `c9f1aa34`, `c45c5bc4`.
- **CLWX-4 acceptance (met):** 25 unit tests + lane G `G-degrade-classify`; `preferredChannel`
  never rewritten; fail-closed on unrecognised errors. `bde78d94`,
  `docs/OFFLINE_ARCHITECTURE.md` §3.1.
- **Note:** degradation keeps the assistant *answering*; it does not make a mid-flight turn's
  output *durable* — that is Step 5.

### Step 5 — Trim the token floor + meter per user (CLWX-6 → KR6) — TODO

The economics break before the features do: ~71% of every cloud turn is a ~7,550-token fixed
floor, so 100M/month dies at ~20 schools. Two moves, both ours.

- **5a — Unblock the trim.** `fix/tool-catalog-trim` (`7add864b`) already cuts the floor
  toward ~2,000 (~78% more capacity) and is on the pilot remote under **HOLD**. Unblocking the
  reviewer pass is an **owner gate** — the agent does not push, merge, or self-approve it.
- **5b — Meter and cap in the broker.** `services/model-broker/server.mjs` authenticates but
  does no accounting. Add per-user `consumed-tokens` metering, per-user soft caps with a fleet
  reserve, and degrade a capped user to on-device (shares CLWX-4's mechanism). Counters live in
  PostgreSQL (no Redis).
- **Acceptance test:** measured per-turn floor ≤ 2,500 tokens; a synthetic heavy user is
  capped and degraded rather than starving the fleet; a fleet-level 429 degrades all clients.
- **Grounded in:** `docs/SCALE_ANALYSIS_2026-08-20.md`.
- **Dependency:** per-user caps need the identity from Step 6 (the cap key *is* `UserId`).

### Step 6 — Real Entra sign-in + `UserId` (CLWX-7 → KR7) — BACKLOG (Ministry-gated)

The app has no signed-in identity — only the stub `principal@school.example`. Backend-for-
frontend: the desktop signs in interactively, the app server holds the secret + tokens and
stamps `UserId` (`oid`) from the session.

- **Acceptance test:** a live sign-in produces a stable non-stub `oid`; an authenticated
  request carries a server-stamped `UserId`, verified in App Insights.
- **Grounded in:** `SCALE_ANALYSIS_2026-08-20.md` §4, `MINISTRY_REPLY_DRAFT_2026-08-20.md` §2.
- **Blocked on:** the redirect URI, which is `https://<app-server-host>/auth/callback` — so it
  depends on the hostname decision in Step 8.

### Step 7 — Store-and-forward outbox (CLWX-5 → KR5) — BACKLOG

No outbox, queue, retry ledger, or `pg` client exists today. Design in
`OFFLINE_ARCHITECTURE.md` §5: append-only, client idempotency keys, explicit terminal states,
bounded visible retry, no bodies/secrets at rest.

- **Acceptance test:** lane G `G-outbox-durable` (survives process kill),
  `G-outbox-idempotent` (replay twice = one record), `G-outbox-drain` (unblock → acked), each
  with a negative control that reddens when the queue is stubbed inert.
- **Blocked on:** the app server's write API (Step 8) and identity (Step 6). Cannot be tested
  against anything real until they exist — this is why it is last, not because it is optional.

### Step 8 — Close the Ministry infra decisions (CLWX-8 → KR8) — TODO, owner-gated

The drafted reply to Ansari Khan's 2026-08-18 handoff is complete and answers all of Section
6. It unblocks Steps 5b, 6, and 7. **It is UNSENT and the send is Anton's gate.**

- **Acceptance test:** reply sent (by Anton); working-session notes record the app-server
  hostname/reachability decision, a final redirect URI, and the prompt-caching answer.
- **Grounded in:** `docs/MINISTRY_REPLY_DRAFT_2026-08-20.md` (`7dfb43d9`, `78fd6fe0`).

---

## Blockers (owner-gated — the agent does not act on these)

1. **Send the Ministry reply (CLWX-8).** `docs/MINISTRY_REPLY_DRAFT_2026-08-20.md` is DRAFT
   only. The agent does not send it, does not email Raj/Ministry, and does not open the
   moevault credential link (5 accesses, expires ~2026-08-26). Anton's send is the gate.
2. **App-server hostname / reachability (Ministry).** Internet-facing over TLS vs
   iGovTT-only. Everything from the redirect URI (Step 6) to the outbox target (Step 7) keys
   off this. Open since 2026-07-20.
3. **Unblock the `fix/tool-catalog-trim` review (owner).** `7add864b` is under HOLD. Do not
   push, merge, or self-approve. Unblocking the reviewer pass is Anton's call; it is now on
   the critical path for scale (Step 5a).
4. **Prompt caching behind APIM (Ministry).** Available? Billed against the 100M? The single
   highest-leverage answer on the budget math, and free if it exists.
5. **`UserId` = `oid` vs UPN, and the migration-credential mechanism (Ministry).** Small
   decisions that block larger work (Steps 5b/6).
6. **Ministry's real test fixtures.** The 0/5 replay used reconstructed fixtures. Asking Raj
   for the real `MoE Agent Testing Folder` bytes would harden the KR1 acceptance test.

None of the code steps (1–7 above, excluding the owner/Ministry gates) require pushing to
upstream `ValueCell-ai/ClawX`; work stays on the pilot fork. Destructive git ops and any
outbound Ministry communication remain owner-gated.

---

## Related

- CLWX Plane board — source of truth (`★ OKR ANCHOR` + `[CLWX-0]`..`[CLWX-8]`)
- `docs/OFFLINE_ARCHITECTURE.md` — KR3/KR4/KR5 evidence and design
- `docs/SCALE_ANALYSIS_2026-08-20.md` — KR6/KR7 grounding
- `docs/MINISTRY_REPLY_DRAFT_2026-08-20.md` — KR8 (UNSENT)
- `skills/laptop/evidence/2026-08-20-raj-prompt-replay/REPORT.md` — KR1
- `skills/laptop/evidence/2026-08-20-moe11-iap-install-trim/verdict.md` — KR2
- `skills/laptop/evidence/2026-08-19-gcp-iap-windows-lane/REPORT.md` — KR2 lane
