# GA finish sprint — 2026-09-03 ("reconcile and finish")

*Supersedes `GA_SPRINT_PLAN_2026-09-02.md` as the sequencing authority. The
state vector (`GA_SPRINT_STATE_VECTOR.md`) stays the per-card truth table; the
Plane board stays authoritative for card state; the persona pack
(`PERSONA_STATE_VECTOR_2026-09-03.md`) is the review lens. Built from four
parallel capability audits (email / forms / documents / plan-coherence) run
2026-09-03 against code, tests, board mirror, and docs.*

---

## 1. Purpose — why this epic exists

**Epic (board anchor CLWX-22):** Ship ClawX (Ministry of Education fork) to GA
for T&T primary-school principals — an on-device-default desktop assistant that
survived Raj's 2026-07-21 Ministry test (scored 0/5) and now provably passes
it, installs unattended on Windows, works offline, and scales without a
fleet-wide outage.

**The problem behind the epic:** a principal's statutory admin load — email
triage, the two MoE forms with the **3:45pm school-day deadline**, letters,
minutes, registers — done on a laptop whose connectivity routinely drops.
The failure mode that defines the product: *a principal at 3:30pm on a dropped
connection with an assistant that appears broken.* That is a trust event, and
**trust is the pilot's actual deliverable** (`OFFLINE_ARCHITECTURE.md` §1).
Every hard rule (two-gate send, model-identity anonymisation, hidden cost,
degrade-not-silence) exists to protect that trust.

**Definition of done for the epic:** each principal-facing use case below is
(a) proven by a live, re-runnable test with captured evidence, (b) tracked on
the board, and (c) accurately described in `CLAUDE.md` + the product doc — with
the Ministry-gated remainder explicitly packaged as post-GA integration, not
silently pending.

## 2. Stories and what each serves

| Story | Purpose (what the principal gets) | KR / cards |
|---|---|---|
| S1 Email | Triage, draft, reply, send from chat — the #1 admin channel; where Raj's four defects came from and where the two-gate send protects them | CLWX-6, 34, 46, 54, 58, 59, +61 |
| S2 Forms | Turn a document into a **submitted** MoE form before 3:45pm — the statutory reason the product exists | CLWX-7, +62, +63, +64 |
| S3 Documents | Circulars in (read/classify), letters & reports out (draft/write) — Raj's original 0/5 test, now KR1 PASS | CLWX-12, 24, 42, +65, +66 |
| S4 Minutes | Meetings become minutes without typing (transcribe → draft) | CLWX-20, +66 |
| S5 Reminders | The 3:45pm safety net — cron fires a chat reminder; principal answers to submit or defer | +67 |
| S6 Platform trust | Install unattended, work offline, degrade loudly, queue durably, answer fast, never show raw model/cost/HTTP | CLWX-25, 26, 27, 28, 36–38, 43, 47, 51–53 |
| S7 Identity & economics | The fleet survives 200 schools: Entra identity → per-user attribution → caps | CLWX-29, 30, 31, 39, 40 (Ministry-paced) |
| S8 Security & hygiene | No leaked secrets, board == docs == git, evidence packet current | CLWX-18, 19, 10, 23, 35, 41, 45 |
| S9 Post-GA registers | Leave/attendance registers + inventory schema (visible, parked) | +68 |

`+NN` = cards filed by this sprint's reconciliation (see §4).

## 3. Objectives × coverage × deficit matrix (audit synthesis, 2026-09-03)

Legend: **●** live-proven with evidence · **◐** built, not live-proven · **○** planned/absent.

| Use case | Status | Evidence | Deficit → owner card |
|---|---|---|---|
| Email: read inbox / read message / search | ● | v2-eval 15/15 live; v2-chatbot-e2e | Stale reading-pane body → CLWX-46 (top P item) |
| Email: draft / reply | ● | v2-eval W4.1/W5.1; RAJ-1/3/4 dispositioned | — |
| Email: send (two-gate) | ● | v2-send-test 4-step PASS post-CLWX-59; 73/73 contract units | — |
| Email: forward / download_attachment | ◐ | implemented + gated; no live eval rows | CLWX-61 |
| Email: folder operations | ○ | not implemented | **PM scope call: known-limitations, not GA scope** (packet §5) |
| Forms: Suspensions fill+gate+submit+verify | ● | forms-submit-recorded.ts — 29/32, refusal proved, landed 5→6, video+trace | — |
| Forms: Daily Report e2e | ◐ | 57-field schema + driver + clone exist; **never run end-to-end** | CLWX-62 (the 3:45pm form itself) |
| Forms: document→extraction→prefill chain | ◐ | halves proven separately; full chain untested | CLWX-63 (demo flow #2) |
| Forms: schema-drift + selector hardening | ○ | MSFORMS doc warns "selectors rotate monthly"; no detector | CLWX-64 |
| Docs: read PDF/Word/Excel | ● | KR1 in-app PASS moe.12; office e2e | — |
| Docs: write .docx/.xlsx | ◐ | runtime OFFICE_WRITE_OK (Win) + fn 8/8 (Mac); **no live in-app write turn** (gap b2) | CLWX-65 |
| Docs: classify/extract/route | ◐ | taxonomy in persona; no e2e, no card | CLWX-66 |
| Docs: letter/memo templates | ◐ | `letter.md`, `memo.md`, `daily_report_brief.md` **exist** (product doc was stale); no `meeting_minutes.md` | CLWX-66 |
| Minutes: transcription | ● Mac / ◐ Win | whisper ×2 real transcript (Mac); Windows = gap C, script armed | V-lane (state vector) |
| Minutes: drafting | ◐ | untemplated | CLWX-66 |
| Reminders: cron → chat prompt | ◐ | agentTurn path built; no e2e either platform; Windows = gap D | CLWX-67 |
| Registers / inventory | ○ | product doc ○ Planned; no cards existed | CLWX-68 (post-GA) |
| Offline / degrade / outbox (KR3/4/5) | ● | lane G 5/5; degrade evidence; outbox restart proof | — |
| Windows install (KR2) | ● install/◐ recording | moe.15 silent install + gateway COMPLETE + OFFICE_WRITE_OK | assisted-GUI recording = owner sitting |

## 4. Board reconciliation executed by this sprint

1. **File CLWX-61..68** (Todo unless noted) with acceptance criteria in each
   card body — see §3 rightmost column. CLWX-68 files as Backlog/low (post-GA).
2. **Comment CLWX-22** (anchor): link this plan; record the PM scope call that
   folder operations are a documented known-limitation for GA.
3. **CLWX-60** stays commented as duplicate of 59 (human cancels).
4. **Docs de-drifted:** product doc templates-empty claims corrected;
   `CLAUDE.md` capabilities map refreshed to moe.15 reality (forms row was the
   materially wrong one); resume packet pointer updated.
5. **Mirror re-exported + committed** so board == docs == git.

## 5. Sprint backlog — sequenced to move everything agent-executable to Ready

Ceiling stays **Ready**; a human closes Done. Classes per the state vector
taxonomy (P parallel-now / S serial / O owner / V VM-window / M Ministry).

| # | Item | Class | Acceptance (evidence that moves it to Ready) |
|---|---|---|---|
| 1 | CLWX-46 stale-read settle guard (TB-1/TB-2) | P | settle-on-expected-item guard + subject fallback; repro script shows stale body eliminated across 3 runs; 15/15 eval still green |
| 2 | CLWX-62 Daily Report e2e | P | fill ≥90% of 57 fields, gate refusal proved, ONE confirmed submit verified landed on the test.fac clone, recorded |
| 3 | CLWX-63 extraction chain e2e | P | fixture suspension letter → agent-extracted fields → prefill diff vs expected JSON ≤3 misses → gate holds |
| 4 | CLWX-65 in-app write turn (gap b2, Mac leg) | P | live chat turn produces a valid .docx opened+parsed back; office e2e gains write assertions |
| 5 | CLWX-61 forward + attachment eval rows | P | v2-eval gains W-rows for forward e2e and download_attachment(confirm:true) live; PASS on test.fac |
| 6 | CLWX-66 minutes template + classify e2e | P | `meeting_minutes.md` authored; classification e2e over 3 fixture docs; product doc updated |
| 7 | CLWX-64 forms drift detector | P | fingerprint check for the 32+57 schemas + forms selector audit wired into the auditor set |
| 8 | CLWX-67 reminder e2e (Mac leg) | P | cron entry → agentTurn fires visible chat prompt → defer path answered; Windows leg joins the V-batch |
| 9 | P12 NSCC in-app knowledge pack | P | `principal.nscc_lookup` + data file + persona line; 18/20 eval floor held in-app |
| 10 | P13 TB-3..TB-6 hardening batch | P | per-card acceptance already on CLWX-47..50 |
| 11 | V-batch: gap C ASR, gap D cron, W10 degrade, b2 Windows leg, KR2 recording staging | V | one VM window, scripts pre-armed |
| 12 | Graph L4 eval | S | one 2-min operator sign-in → `v2-eval-graph.ts` PASS |
| 13 | Owner sitting (unchanged) | O | CLWX-18/19, trim unhold, latency budget, KR2 acceptance, tester, CLWX-45 GO, close Ready cards |
| 14 | Ministry chain | M | KR8 session → KR7 verify → KR6 fleet-verify (post-GA by design) |

**Sprint definition of done:** items 1–10 at Ready with evidence; §3 matrix has
no ◐ row without either a Ready card or an explicit owner/Ministry gate; the O
and V batches are packaged single-sitting asks; board == docs == git.

## 6. GA runway — the exact remaining distance (counted 2026-09-03, board @ 89)

**THE acceptance test now exists: `pnpm ga:gate` (CLWX-90, urgent).** Every
criterion — static suites, bundle verify, live email/forms evals, ledger
guards — one command, one scorecard mapped to the GO/NO-GO boxes. A GA tag
requires a full GREEN run ≤24h old. Owner/Ministry boxes are reported as
named asks (the gate cannot green a human decision).

**Board arithmetic (89 cards):** 12 Cancelled · 22 **Ready — awaiting only
your close** · 11 In Progress · 29 Todo · 15 Backlog (post-GA by design).

**Scorecard arithmetic (14 GO/NO-GO boxes):** 2 checked (KR3, KR4) ·
4 evidence-complete pending your acceptance (KR1, KR5, ExtVal-A/CLWX-34,
release-hygiene — the gate is now that box's mechanism) · 8 need work split
three ways below.

| Lane | Items | What closes them |
|---|---|---|
| **Agent (me, next ticks)** | 1. ga:gate first GREEN run (in flight). 2. **moe.16 cut** (carries CLWX-46/59/72/78 fixes) + fresh-install re-verify: drag-PDF, degrade failover, K14 matrix → closes CLWX-72/78, refreshes KR1/KR2 evidence, gives the tester the ExtVal-B build. 3. CLWX-79 urgent (demo-default backfill). 4. CLWX-82 (typecheck electron/**, then fix what it reveals). 5. CLWX-62 recorded leg. 6. CLWX-58+70 (auto-recovery + exit-path invariant). 7. GA evidence packet refresh (CLWX-10). | ~3–4 driver ticks |
| **Owner (one sitting, ~1–2 h)** | Close the 22 Ready cards · CLWX-18 scrub · CLWX-19 rotate (rotation scope now includes the fleet-mailbox private repo: the sandbox password + a Raj temp password sat in 3 pushed note files; the 2026-09-05 CLWX-84 pass redacted + committed locally, but the REMOTE TIP and full git history still carry them — local master is ~459 behind origin, so pull/push/scrub is the owner's call) · run `bash scripts/security-credential-grep.sh` (CLWX-84 gate, expect `RESULT: clean`) · trim unhold (7add864b) · latency budget number · KR2 assisted recording (RDP ≥1920×1080; everything staged) · CLWX-45 per-item GO · then check the boxes | one sitting |
| **Ministry (post-GA-acceptable per the finish vector)** | KR7 App-Insights verify · KR8 session + real values · CLWX-7/8/40 | Raj-paced |

**Definition of done for GA (unchanged, now mechanized):** bucket-agent
empty + owner sitting done ⇒ every box checked or explicitly owner-accepted
with the known-limitations sheet; `pnpm ga:gate` GREEN at the tag.

## 7. Operating rules (inherited, unchanged)

Two-gate sends only from the test.fac sandbox; draft-and-hold for stakeholder
comms; no secrets/bodies in logs or board; every Ready transition carries an
evidence comment; board mirror re-export + commit after each batch; pre/in/
post-flight checks per `GA_SPRINT_STATE_VECTOR.md` §3.
