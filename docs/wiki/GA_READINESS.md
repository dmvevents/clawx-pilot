# GA readiness scorecard — the single GO/NO-GO document

_Last updated: 2026-09-01, HEAD `f99f2c1f`. This is the consolidation the other
docs feed: gap → feedback → test → mitigation → evaluation criterion, in one
place. When every row in §4 is checked, we are at GA. Sources: `GA_EXECUTION_PLAN`
§3 (criteria), `TEST_PLAN.md` (probe results), `LIAISON_LOG.md` (Ministry record),
`DECISION_LOG.md` (why), the board (live state)._

## 1. What GA means (unchanged, from the OKR anchor)

> A Ministry principal can do a full working day on ClawX — email, forms,
> documents — with the app degrading gracefully offline and staying inside the
> Ministry's token budget and identity model.

GA = **all 8 KRs green with evidence** + the 2 standing security items resolved.
Ceiling for agents is Ready; a human declares GA.

## 2. Chronological gap & feedback ledger (what happened → what we did → status)

Every known gap, defect, and piece of external feedback, date-ordered, each with
its mitigation and current status. Nothing here is unsourced.

| # | Date | Gap / feedback (source) | Mitigation | Status |
|---|---|---|---|---|
| G1 | 2026-05-2x | Four-store config drift → silent-on-send, hit 3+ times (CLAUDE.md invariants) | Canonical atomic writer + `config-coherence-auditor` | ✅ CLOSED (ADR-005; unit-covered) |
| G2 | 2026-05-2x | moe.9 shipped broken — `playwright-core` in devDeps (CLAUDE.md) | Runtime-dep rule + `dependency-class-auditor` | ✅ CLOSED (ADR-004) |
| G3 | 2026-05-2x | MS Forms selectors rotated, automation died <1wk (CLAUDE.md) | 3+ fallback rule + response-page pivot + `dom-selector-regression-tester` | ✅ CLOSED (ADR-003) |
| G4 | 2026-06-21 | **Raj's 4 email defects**: send-gate false positive, content misread, reply archives original, draft in To: field (LIAISON_LOG §C) | moe.10 hard-confirm gate likely fixes #1; others untriaged | 🟡 OPEN — CLWX-bug card (seq34): reproduce-or-refute each on moe.11 |
| G5 | 2026-06-23 | Principals demo ran; **no post-demo verdict captured**; "0/5" score has NO source in any channel | Ask Raj for the demo outcome; never cite 0/5 without a source | 🟡 OPEN — question queued for next Raj contact |
| G6 | 2026-06-30 | PDF read inconsistencies (Karunesh via Raj) + document-search inconsistency (07-17) | Doc-tooling steering rebuilt; harness P1–P5 green; eval lanes A–E green | 🟡 PARTIAL — code layer green, in-app unproven (→ KR1) |
| G7 | 2026-07-20 | Ansari: "only thing I absolutely need is the redirect URIs" — sat unanswered ~6wk (LIAISON_LOG §B) | **Answered 2026-09-01:** redirect = app-server callback (keys off hostname) + dev loopback offered now | 🟡 SENT — awaiting Raj (B4) |
| G8 | 2026-08-18 | Ministry handoff: 4 design conflicts (app-server vs desktop, secret vs PKCE, redirect URI, read-only scopes); all 20 values placeholders (`MINISTRY_INFRA_HANDOFF_2026-08-18.md`) | **Condensed reply SENT by WhatsApp 2026-09-01** (owner-authorized; bridge 200 + log proof; sent-ledger at `~/openclaw-agent/outbound-sent/`). Full written reply still to follow. Session + reissued link requested. | 🟡 SENT — awaiting Raj (B4) |
| G9 | 2026-08-20 | Token-budget ceiling: ~7,550-tok fixed floor = ~71% of every turn; fleet 429 at ~20 schools (SCALE_ANALYSIS) | Trim branch `fix/tool-catalog-trim` (~2,000 floor) exists, ON HOLD; per-user caps designed, not built | 🔴 OPEN — B3 owner unlock of trim + KR7 identity |
| G10 | 2026-08-20 | Offline gaps: no send-time channel fallback, no outbox (lane G work, OFFLINE_ARCHITECTURE) | KR4 degrade **landed** (bde78d94); KR5 outbox designed, not built | 🟡 PARTIAL — KR4 ✅, KR5 🔴 |
| G11 | 2026-08-2x | On-device tool-cascade blocker (memory) | Trim verified live on Windows moe.11 (6/6→0/6); residual `exec` self-recovers | ✅ CLOSED (cosmetic residual) |
| G12 | 2026-09-01 | **CLWX-18**: public repo hosts full source + plaintext test password in 3 files | Working tree scrubbed (0 literals); password now local-only by owner decision; public-branch scrub + source/releases split pending | 🟡 PARTIAL — owner-gated public-side fix |
| G13 | 2026-09-01 | **CLWX-19**: `sk-clawx` key shared over WhatsApp, un-rotated (not leaked in repo) | Rotate | 🔴 OPEN — owner action |
| G14 | 2026-09-01 | KR1's real gap: every eval lane is a BM25 proxy; lane F (live LLM tool-pick) always SKIPs (TEST_PLAN §2) | In-app run on Windows via IAP VM | 🟡 IN MOTION — gcloud installed; needs `gcloud auth login` then the VM run |
| G15 | 2026-09-01 | Outbound-message ledger gap: we can't always prove what we told Raj (LIAISON_LOG §F) | `~/openclaw-agent/outbound-sent/` ledger created; **first entry 2026-09-01** (the condensed infra reply, verbatim, with proof refs) | ✅ CLOSED — every send now ledgered |

## 3. Tests run and reports back (the evidence base)

| Date | Test / report | Result | Where |
|---|---|---|---|
| 2026-05-25 | Outlook live e2e (open/read/draft/hard-confirm send) | ALL PASS | CLAUDE.md smoke record |
| 2026-06-21 | **Raj's manual test round** | draft ✓ read ✓ summary ✓ / send ✗ reply ✗ | LIAISON_LOG §A/C (the G4 defects) |
| 2026-08-20 | moe.11 IAP silent install | Tree complete, ports bind; sha256 `b01bb6c3` | `skills/laptop/evidence/…/verdict.md` |
| 2026-08-20/21 | eval:ci 6-lane | 61 PASS / 0 FAIL / 9 SKIP | `artifacts/eval/report.json` |
| 2026-08-20 | Lane G offline egress-guard | PASS (on-device + local docs, egress blocked) | eval lane G |
| 2026-08-25 | Self-test cron last green | overall **pass** | `~/.openclaw/selftest/` |
| 2026-09-01 | Full re-run at HEAD `f99f2c1f` | typecheck 0 err; unit **1197/6skip/0fail**; eval **61/0/9**; harness **5/5** | TEST_PLAN.md + CLWX-1 comment |
| 2026-09-01 | Read-only lane probe | KR3/KR4 GREEN; KR1/KR2 gated only by gcloud (B2); KR5–8 owner/Ministry-gated | TEST_PLAN.md |

## 4. The GA gate — evaluation criteria (GO/NO-GO checklist)

GA is declared when every box is checked. Each is falsifiable; "checked" requires
the named evidence, not an assertion.

**Product KRs**
- [ ] **KR1** — In the shipped app on Windows, a live-LLM turn picks doc-tooling for P1–P6 and `resolveReadablePath` resolves a file on `%USERPROFILE%\OneDrive\Desktop`. _Evidence: in-app trace showing `document.*` tool-calls 6/6._ (Harness/eval green already — necessary, not sufficient.)
- [x] **KR3** — On-device model + local docs answer with egress blocked. _Evidence: lane G 5/5._
- [x] **KR4** — Cloud turn degrades to on-device instead of going silent. _Evidence: bde78d94 + 25 units + `G-degrade-classify`._ (Optional hardening: kill-egress-mid-turn e2e.)
- [ ] **KR2** — Fresh-VM install (assisted GUI, recorded) boots gateway + green on-device turn, zero manual steps. _Evidence: recording + install log._
- [ ] **KR5** — Offline action persists to an outbox, survives `kill -9` + restart, flushes idempotently on reconnect. _Evidence: `G-outbox-{durable,idempotent,drain}` green._
- [ ] **KR6** — Per-turn floor ≤2,500 tok (trim merged) AND per-user caps unit-tested behind a flag; fleet-verified when KR7 lands. _Evidence: floor measurement + cap tests._
- [ ] **KR7** — Real Entra sign-in yields a stable per-principal `UserId` carried in the APIM header. _Evidence: App Insights shows per-user attribution._
- [ ] **KR8** — Ministry reply sent, working session held, real APIM/Entra values received. _Evidence: sent artifact + received values._

**External validation**
- [ ] Raj's 4 June-21 defects reproduced-or-refuted on moe.11; any confirmed one fixed. _Evidence: per-defect trace (CLWX-bug card)._
- [ ] One tester completes the download→install→first-turn path from the public Release with no help. _Evidence: tester report (board card seq11)._

**Security floor**
- [ ] Plaintext test password absent from all PUBLIC branches + history (CLWX-18 split executed). _Working tree already clean._
- [ ] `sk-clawx` key rotated (CLWX-19).

**Release hygiene**
- [ ] `pnpm typecheck` + unit + eval:ci + harness green at the GA tag. _(Green today at f99f2c1f.)_
- [ ] GA evidence packet assembled (board card seq10).

## 5. Critical path from here (ordered)

1. **You: `! gcloud auth login`** (interactive, ~1 min). gcloud is installed; token is stale.
2. **Agent: IAP VM run** → KR1 in-app (P1–P6 + KFM) + KR2 assisted-screen recording + G4 defect triage. This flips the two biggest unchecked boxes and the external-validation row in one VM session.
3. **Agent: build KR5 outbox** (design exists, OFFLINE_ARCHITECTURE §5) + the three `G-outbox-*` tests. Independent of everything else.
4. **You: two owner sends/decisions** — (a) send the Ministry reply (unlocks KR8→KR7→KR6-fleet), (b) unhold the trim branch (KR6 floor). Plus the two security actions: public-branch password scrub / repo split, key rotation.
5. **Agent: KR6/KR7 built behind a flag now**, verified the day the real values arrive.
6. **Assemble the GA evidence packet** (seq10) and hand the checklist above to a human for the GA call.

**Nothing on this path is unknown or unplanned. Every unchecked box has a named
owner, a named blocker class, and a falsifiable test.**
