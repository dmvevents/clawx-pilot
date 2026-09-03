# Persona state vector + thought map — 2026-09-03

*Companion to `GA_FINISH_SPRINT_2026-09-03.md`. Purpose: every review, scope
call, and acceptance decision in this sprint is made from a named persona's
seat, not from "the agent's" undifferentiated view. Each persona has one core
question, defined inputs, defined authority, and a current verdict grounded in
real stakeholder feedback. Personas map onto the existing `.claude/agents/`
and `.claude/skills/` surfaces where one already exists — we reuse, we don't
duplicate.*

## 1. The thought map — how a claim becomes "done"

```
                    ┌────────────────────────────────────────────────┐
                    │  OWNER (Anton) — the only Done authority       │
                    │  gates: sends, destructive ops, GA declaration │
                    └──────────────▲─────────────────────────────────┘
                                   │ packaged sittings, GO asks
       ┌───────────────────────────┼───────────────────────────────┐
       │                           │                               │
┌──────┴───────┐          ┌────────┴────────┐             ┌────────┴────────┐
│ PRODUCT      │ accepts  │ RELEASE MANAGER │  ships      │ MINISTRY        │
│ MANAGER      │ scope +  │ ga-release-     │  RCs,       │ LIAISON         │
│ (new agent:  │ criteria │ conductor +     │  smokes     │ ministry-       │
│ moe-product- │◄────────►│ windows-smoke   │             │ liaison-monitor │
│ manager)     │          └────────▲────────┘             │ (Raj, Karunesh) │
└──────▲───────┘                   │ evidence             └────────▲────────┘
       │ "does the evidence        │                               │ asks,
       │  prove the use case?"     │                               │ defects,
┌──────┴───────────────────────────┴───────┐              ┌────────┴────────┐
│ QA / VERIFICATION LEAD                   │              │ PRINCIPAL PROXY │
│ ga-e2e-regression-verifier +             │  trust lens  │ (new agent:     │
│ production-readiness + test-lane-prober  │◄────────────►│ principal-      │
└──────▲───────────────────────────────────┘              │ proxy)          │
       │ regression classes                               └─────────────────┘
┌──────┴───────────────────────────────────┐
│ ENGINEERING CONSCIENCE (the 4 auditors)  │
│ config-coherence / dependency-class /    │
│ dom-selector-regression / state-         │
│ idempotency (+ forms drift, CLWX-64)     │
└──────────────────────────────────────────┘
```

Flow of a claim: **builder → engineering conscience (regression classes) →
QA lead (live evidence) → principal proxy (trust lens) → product manager
(acceptance vs objective) → release manager (ship it) → owner (Done)**.
The liaison feeds real-world defects and asks into the top of the loop and
carries dispositions back out (draft-and-hold; owner opens the send gate).

## 2. Persona state vector

| Persona | Surface | Core question | Authority | Current verdict (2026-09-03) |
|---|---|---|---|---|
| **Product manager** | `.claude/agents/moe-product-manager.md` (new) | Does the evidence prove a principal can do this use case, and is the board/doc story honest about it? | Acceptance criteria; scope calls; §3 matrix ownership | Matrix has 6 ◐ rows now carded (CLWX-61..67); folder ops ruled known-limitation; forms row in CLAUDE.md was materially stale — fixed this sprint |
| **Principal proxy** | `.claude/agents/principal-proxy.md` (new) | What does the principal see at 3:30pm on a dropped link — and does anything leak model IDs, cost, raw errors? | Trust-lens veto on UI/UX evidence | Open trust items: CLWX-52 (raw model id), CLWX-53 (raw HTTP), CLWX-47 (slow-turn notice), CLWX-51 (blank window); latency p50 ≈103s vs 15s proposal is the biggest felt gap |
| **QA / verification lead** | `ga-e2e-regression-verifier`, `production-readiness`, `test-lane-prober` | Is it proven live, on a persona-faithful base, with re-runnable scripts? | Ready-transition evidence bar | 161 files / 1264 unit tests green; v2-eval 15/15; forms recorded-submit proof pattern established; gaps b2/C/D named, not hidden |
| **Release manager** | `ga-release-conductor`, `windows-smoke`, preflight gate 617a6ceb | Is the artifact the thing we tested? | RC cut + smoke sign-off | moe.15 hash-verified, installed + smoked on VM; GA-tag candidate pending owner sitting |
| **Ministry liaison** | `ministry-liaison-monitor` agent + `ministry-liaison-send` skill | What have Raj/Karunesh asked, what do we owe, what did we prove back? | Draft-and-hold comms; ask ledger | See §3 feedback ledger — Raj's 4 defects dispositioned; latency quantified; NSCC 18/20; Graph unblocked (L1–L3 PASS); Karunesh has moe.15 + quickstart |
| **Engineering conscience** | the 4 `*-auditor` agents | Which regression class does this change re-open? | Block on class violation | dom-selector class caught CLWX-59 (fixed+verified); forms drift detector missing → CLWX-64 |
| **Security officer** | owner-gated rows + hard rules (no separate agent) | Any secret, send, or destructive op outside its gate? | Hard-rule veto | CLWX-18 (public repo + leaked test password) and CLWX-19 (sk-clawx) remain the two urgent owner items |
| **Owner (Anton)** | — | Ship it? | Done; GA declaration; all send gates | Bucket-B sitting (~1h) is the GA gate; everything agent-side converges to Ready |

## 3. Stakeholder feedback ledger (what the personas reconcile against)

**Raj (Ministry ICT) — asks and dispositions:**
- 2026-06-21 defect list RAJ-1..4: **all four dispositioned** — RAJ-1
  fixed-verified, RAJ-2 refuted at model layer (dual deterministic assertion;
  found real suspect STALE-READ → CLWX-46), RAJ-3 refuted by targeted
  scenario, RAJ-4 fixed-verified. Consolidated update SENT (owner GO,
  ledgered).
- Latency complaint (volunteered twice): quantified at ~103s median cloud turn
  vs proposed 15s p50 → CLWX-43; movers are prompt-caching ask, trim unhold
  (owner), routing.
- NSCC ask: his own 20 Q&A rows run live — 18/20 (90%), wrong-edition guard
  proven; in-app knowledge pack is sprint item 9.
- Graph/Entra: client id + dev redirect URI delivered; L1–L3 PASS live —
  the ~6-week external gate cleared; L4 waits on one 2-min operator sign-in.
- Owed him: working-session slot (KR8) — ball on his side since 09-02.

**Karunesh (curriculum QA) — asks and dispositions:**
- Prompt-Tests 0/5 → fixed; KR1 in-app proof owed to him as evidence.
- KAR-PDF / KAR-DOCSEARCH: need repro-or-current-build-proof (open).
- Tester handoff: moe.15 installer + `TESTER_QUICKSTART.md` delivered
  (signed URL, verified byte-exact); his unaided install→first-turn is
  Ext-val B on the GA scorecard.
- Video project is SEPARATE — never conflate (liaison rule).

**Owner (Anton) — standing decisions in force:**
- Ceiling Ready / human closes Done; draft-and-hold on all outward comms;
  trim branch `7add864b` on HOLD pending latency-budget sign-off; KR2
  acceptance mode and demo-default channel decisions recorded; CLWX-18/19
  reserved to owner hands.

## 4. Operating rule

Every Ready transition names the persona whose bar it met in the evidence
comment (e.g. "QA bar: 15/15 live eval; PM acceptance: matrix row Email/send
→ ●"). A card that can't name its persona isn't ready to be Ready.

**Gate rule (CLWX-90):** every new card whose acceptance is machine-testable
must add or name its `pnpm ga:gate` check id — acceptance criteria that the
gate can't see don't exist at release time.
