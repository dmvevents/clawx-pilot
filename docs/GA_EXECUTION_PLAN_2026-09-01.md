# ClawX GA execution plan — 2026-09-01

**Purpose.** Turn the CLWX board (OKR anchor CLWX-22, KR1–KR8) into an executable
GA plan: what can run in parallel, how bugs get reported, and how OKRs /
acceptance criteria / blockers are defined so "done" is falsifiable, not a claim.

This is grounded in today's verified ground truth, not aspiration. It supersedes
nothing on the board (the live board stays source-of-truth for *what to work
on*); it is the *how*.

---

## 0. Ground truth as of 2026-09-01

Two read-only probes (production-readiness, test-lane-prober) established:

| Layer | State | Evidence |
|---|---|---|
| **Code** | 🟢 GREEN | `pnpm typecheck` 0 errors; unit **1197 passed / 6 skipped / 0 failed**; `eval:ci` **61 PASS / 0 FAIL / 9 SKIP** (2026-08-21); doc-tooling harness **5/5**. |
| **Local runtime** | 🔴 RED (self-serviceable ~2 min) | ME app + ports `18789`/`13210` down. Not an external blocker — start the app. |
| **Windows lane** | 🟡 operator-gated | GCP IAP `clawx-win-rc-20260609` green 2026-08-20; needs `gcloud` SDK on this Mac to drive. home-pilot unreachable (external). |
| **Self-test cron** | 🟡 stale | `com.moe.clawx.selftest.plist` last ran 2026-08-25 (overall **pass**); 7 days idle — reload it. |

The 6 skipped unit tests are benign pilot channel-filtering; the 9 eval skips are
lanes needing live creds. Neither is a failure.

---

## 1. Workstream map — what runs in parallel

The KRs are **not** all independent. The critical path is a chain gated on one
owner action; everything off that chain is parallelizable *now*.

```
        ┌─ LANE A (zero-dependency, start today) ──────────────┐
        │  KR1 doc-tooling in-app        (CLWX-1 / seq24)      │
        │  KR2 clean-VM install recording(CLWX-2 / seq25)      │  no cross-deps
        │  revive self-test cron         (ops)                 │  → run concurrently
        └──────────────────────────────────────────────────────┘

        ┌─ LANE B (offline/resilience, code-only) ─────────────┐
        │  KR3 offline operation  (CLWX-3/seq26) — 2 named gaps│
        │  KR4 degrade→on-device  (CLWX-4/seq27) — feat landed │  depends on nothing
        │  KR5 store-forward outbox(CLWX-5/seq28) — closes gap1│  external; internal
        └──────────────────────────────────────────────────────┘  seq: KR5 closes a KR3 gap

        ┌─ LANE C (the gated chain) ───────────────────────────┐
        │  KR8 send Ministry reply (CLWX-8/seq31) ── OWNER GATE │
        │        └─► unblocks real APIM hostname                │
        │              └─► KR7 Entra sign-in + UserId (seq30)   │  strictly serial
        │                    └─► KR6 per-user caps (seq29, 5b)  │
        └──────────────────────────────────────────────────────┘
```

**Parallelizable right now (no human but the owner-gate in Lane C):**

- **Lane A** and **Lane B** are fully independent of Lane C and of each other.
  Three people (or three sub-agent threads) can run A-items, B-items, and prep
  C simultaneously.
- Within Lane B, KR5 (outbox) is the internal dependency that closes **gap 1**
  of KR3 (no send-time channel fallback). Do KR4 → KR5 → re-verify KR3.
- **Lane C is serial and starts with an owner decision** (send the Section-6
  infra reply, `docs/MINISTRY_REPLY_DRAFT_2026-08-20.md`). Until the real APIM
  hostname/identity exist, KR7 and KR6 cannot be *verified* against production —
  only built against placeholders (see memory: "Ministry endpoints
  unverifiable"). Build behind a flag; verify when the hostname lands.

**Recommended first cut (this week):** run Lane A to completion (all three are
zero-dependency and directly move KR1/KR2 to Ready), land KR5 in Lane B, and put
the owner decision for Lane C in front of the user.

**Lane C detail (deep-dive 2026-09-01).** The unlock is the 459-line reply
`docs/MINISTRY_REPLY_DRAFT_2026-08-20.md`, which already resolves the four
conflicts from the Aug-18 handoff packet:

| # | Handoff conflict | Reply resolution | Residual |
|---|---|---|---|
| 1 | Read-only Graph scopes vs our design | Accepted as granted (§3) | none |
| 2 | Client secret vs PKCE | App-server (Docker) holds the secret server-side (§2) | needs the app-server decision confirmed |
| 3 | Redirect URI not issued | Explicitly requested for the session | **B4 — owed by Raj; gates KR7** |
| 4 | App-server/Docker vs desktop | Addressed (§1); offline (§1.1) + offline sign-in (§1.2) named as consequences | none |

The token/identity chain is strict: **send reply → real APIM hostname + Entra
values (incl. redirect URI) → KR7 stable per-principal `UserId` → KR6 per-user
caps.** §4 owns the rollout math (100M tok/mo is fine for the pilot but ~71% of
every turn is our fixed 7,550-tok floor, so a shared key 429s fleet-wide at ~20
schools — §4.1). All 20 handoff values are still placeholders, so KR6/KR7 can
only be built behind a flag until the hostname lands. §5 declines to carry the
expired moevault credential link and asks Raj to reissue — consistent with the
send-guard hook.

---

## 2. Bug-reporting process

One front door, uniform shape, nothing lost in chat. Tool: `scripts/report-bug.mjs`.

```bash
set -a; . ~/issues-agent-runtime/plane/.agent-token; set +a   # loads PLANE_* (never printed)
node scripts/report-bug.mjs \
  --title "Composer picks Flash despite config Pro" \
  --severity high \                # critical|high|medium|low -> urgent|high|medium|low
  --area model \                   # outlook|forms|gateway|windows|offline|model|ui|packaging|other
  --repro "1. set default=pro\n2. send a turn\n3. inspect trace.metadata.model" \
  --expected "trace shows gemini-2.5-pro" \
  --actual  "trace shows gemini-2.5-flash" \
  --evidence "skills/laptop/evidence/2026-09-01-composer/trace.json" \
  --env "moe.11 / Windows 11 24H2 / gemini-2.5-pro"
```

Rules:

- **Every bug lands in Backlog** with the templated body (repro / expected /
  actual / evidence / environment / regression-class). Omitted fields become
  explicit `TODO:` markers — a bug with unknown repro is still worth filing.
- **Severity → priority** is fixed: critical=urgent, high=high, medium=medium,
  low=low. Don't hand-set priority; let severity map it.
- **Regression class**: if the bug is a member of one of the four known classes,
  name it (config-coherence, dependency-class, dom-selector, state-idempotency)
  and the matching `*-auditor` sub-agent owns prevention.
- **After filing**, refresh the repo backup: `node scripts/plane-board-export.mjs`.
- **Triage cadence**: at the start of a working session, read the board backup
  (`docs/plane-board/CLWX-board.md`) and pull Backlog → Todo for anything on the
  week's lanes.

---

## 3. OKR + acceptance criteria + blocker design

### The objective (CLWX-22, unchanged)

> **A Ministry principal can do a full working day on ClawX — email, forms,
> documents — with the app degrading gracefully offline and staying inside the
> Ministry's token budget and identity model.**

### KR acceptance criteria (falsifiable — a KR is "Ready" only when its test passes)

| KR | Card | Acceptance test (the thing that must be demonstrated) | Owner-gated? |
|---|---|---|---|
| **KR1** doc-tooling in-app | CLWX-1 / seq24 | In the *shipped app on Windows*, a principal asks for a PDF/xlsx/docx task and the tooling steering fires; `resolveReadablePath` finds a file on `%USERPROFILE%\OneDrive\Desktop` (KFM). Harness 5/5 is necessary but **not sufficient** — must be in-app. | no |
| **KR2** clean-VM install | CLWX-2 / seq25 | Unattended `/S` install on a *fresh* Windows VM boots gateway + on-device chat with zero manual steps; recorded. Evidence: install log + a green on-device turn. | no |
| **KR3** offline operation | CLWX-3 / seq26 | On-device model + local docs answer with network egress blocked (lane G egress-guard PASS). **Two named gaps** must close: (1) send-time channel fallback [=KR5], (2) outbox. | no |
| **KR4** degrade→on-device | CLWX-4 / seq27 | A cloud turn that cannot reach the provider silently degrades to on-device and the principal still gets an answer. **feat landed** (bde78d94) — needs an acceptance test that kills egress mid-turn. | no |
| **KR5** store-forward outbox | CLWX-5 / seq28 | An action taken offline (e.g. a queued send) persists to an outbox and flushes when connectivity returns; survives app restart (atomic + idempotent writer). Closes KR3 gap 1. | no |
| **KR6** cloud economics | CLWX-6 / seq29 | Per-turn fixed floor trimmed from ~7,550 tok; per-user caps enforced. Verifiable only once `UserId` (KR7) exists — build + unit-test the cap logic now, verify against fleet later. | partial (needs KR7) |
| **KR7** Entra + UserId | CLWX-7 / seq30 | Real Entra sign-in yields a stable per-principal `UserId` that the APIM `UserId` header carries. **Blocked** on Entra app registration + redirect URI (owed by Raj). | yes (Ministry) |
| **KR8** infra decisions | CLWX-8 / seq31 | The Section-6 infra reply is sent and the working session booked; real APIM hostname + Entra values received. **This unblocks the whole Lane-C chain.** | **yes (owner + Ministry)** |

### Blocker taxonomy (so "blocked" always means something specific)

Probe before declaring blocked (memory: two multi-week stalls were self-inflicted).

| Class | Definition | First action | Example |
|---|---|---|---|
| **B0 self-serviceable** | We can clear it in minutes; only looks blocked | Just do it | ME app down → start it |
| **B1 artifact-on-disk** | The input already exists; we haven't looked | `find`/grep for it before asking | install log already recorded |
| **B2 tooling-gap** | Need a tool installed locally | Install it | `gcloud` SDK for the IAP lane |
| **B3 owner-decision** | Needs the user to choose an irreversible/outward action | Put a crisp choice in front of them | send the Ministry reply (KR8) |
| **B4 external-party** | Genuinely waiting on someone outside | Named person + exact ask + date owed | Entra redirect URI from Raj |

Only **B3** and **B4** are real blockers. B0–B2 are work disguised as blockers —
the `test-lane-prober` sub-agent exists to catch this before we report a stall.

---

## 4. Immediate next actions (ordered)

1. **Lane A, item 3 (30 sec):** reload the self-test cron —
   `launchctl kickstart -k gui/501/com.moe.clawx.selftest` (or unload/load the
   plist). It last passed 2026-08-25; a green run today re-arms regression watch.
2. **Lane A, items 1–2:** close KR1 in-app doc-tooling (incl. the OneDrive/KFM
   `resolveReadablePath` fix) and record the KR2 clean-VM install. Both are
   zero-dependency and move two KRs to Ready.
3. **Lane B:** add the KR4 acceptance test (kill egress mid-turn), then build KR5
   outbox (closes KR3 gap 1).
4. **Lane C (owner gate):** decide whether to send
   `docs/MINISTRY_REPLY_DRAFT_2026-08-20.md`. This is the single unlock for KR7/KR6.
5. **Security (urgent, off-KR):** CLWX-18 (repo public) and CLWX-19 (shared
   `sk-clawx` key un-rotated) — see §5.

**Ceiling is Ready. A human closes a card to Done.** No card is moved to Done here.

## 5. Standing security items (not KRs, but block a safe GA)

Investigated 2026-09-01 — the picture is worse than "the repo is public":

- **CLWX-18** — `dmvevents/clawx-pilot` is **public and hosts the full source
  tree** (901 files, 13 branches: `electron/`, `docs/`, `extensions/`,
  `CLAUDE.md`), despite its own description saying "source lives in a private
  repo; this repo distributes signed releases only." The dev workflow
  ("push to `pilot/main`") has been publishing source to a public repo.
  - **A live credential is already public:** the test password `Education@2000`
    is in **3 public files** — `scripts/v2-signin.ts`,
    `scripts/forms-relogin-helper.ts`, `CLAUDE.md`. Violates the hard rule.
  - **The liaison phone number never leaked** — redacted before any push
    (commits `a1ff2cc7`, `2a0f55c8`); the two files carrying it are absent on
    public. This session pushes nothing.
  - **Recommended (owner-gated):** (1) rotate the test.fac password now;
    (2) make `clawx-pilot` private OR strip source to release artifacts only;
    (3) scrub `Education@2000` from the 3 public files + history. Confirm before
    flipping a shared org repo or rewriting history.
- **CLWX-19** — the `sk-clawx` key shared over WhatsApp is un-rotated (public
  code-search shows 0 hits, so not leaked in the repo — but rotate regardless).

---

## References

- `docs/plane-board/CLWX-board.md` — the board backup (logical-label → seq map in its README).
- `scripts/report-bug.mjs` — the bug front door. `scripts/plane-board-export.mjs` — the backup refresher.
- `docs/GA_PLAN.md`, `docs/PRODUCTION_CHECKLIST.md` — the prior plan + checklist this operationalizes.
- `docs/OFFLINE_ARCHITECTURE.md` — KR3/KR4/KR5 design and the two named gaps.
- `docs/MINISTRY_REPLY_DRAFT_2026-08-20.md` — the unsent Lane-C unlock.
