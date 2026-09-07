# GA evidence packet — Ministry of Education principal assistant

*Assembled 2026-09-02; **refreshed 2026-09-03** (CLWX-10). Board @ 90, gate
GREEN. One index from which every GA claim can be verified: artifact →
evidence doc → commit → runnable check. The human GO/NO-GO scorecard is
`docs/wiki/GA_READINESS.md` §4; this packet is the evidence behind its boxes.
The single acceptance command is **`pnpm ga:gate`** (CLWX-90); a GA tag
requires a full GREEN run ≤24h old. First GREEN:
`docs/evidence/GA_GATE_2026-09-03.md` — **9 pass / 0 fail / 2 opt-in skips**.*

## 1. Release artifacts

| Build | Artifact | SHA256 | Carries |
|---|---|---|---|
| **moe.15 (installed + smoked)** | `release/…moe.15-win-x64.exe` (390 MB, signed; GCS; handed to the external tester via signed URL) | `d10de580…18df` | moe.14 + retry breaker (`fee7294d`), KFM tilde resolver (`97004aa6`), Outlook gate + migration (`a8322ad9`) |
| moe.14 | `release/…moe.14-win-x64.exe` (signed) | `8634bd74…65d7` (verified guest==build host) | channel-choice + EPERM boot fixes |
| moe.13 | `release/…moe.13-win-x64.exe` | `a8494ec0…3ecf` (verified) | slow-ready fix, outbox wiring, fixed seeder |
| moe.12 | `release/…moe.12-win-x64.exe` (shipped, on VM) | `0a3bbf27…5ee64` | doc-tooling steering |
| VM restore point | GCP snapshot `clawx-l2-moe12-kr1pass-20260902` | READY, VSS-consistent | L2 per docs/VM_TEST_BASE.md |

moe.15 VM install + smoke is **DONE** (2026-09-02, gap A): silent `/S`
install, tree complete, gateway boot `RESULT=COMPLETE`, office write
`OFFICE_WRITE_OK`. Evidence:
`skills/laptop/evidence/2026-09-02-moe15-install-verify/RESULT.md`.

**The GA tag is now moe.16**: a cut carrying the four post-moe.15 fixes —
CLWX-46 (`715e17b7`), CLWX-59 (`2e01891d`), CLWX-72 (`2591af3a`), CLWX-78
(`4261811a`), plus the Google store-400 stamp (`73c9e88c`) — followed by a
fresh-install re-verify (drag-PDF, degrade failover, K14 matrix).

## 2. Suite evidence (at HEAD)

The umbrella is the gate run; individual rows below are its components plus
the live-lane suites.

| Suite | Result | Where |
|---|---|---|
| **`pnpm ga:gate` (CLWX-90)** | **GREEN — 9 pass / 0 fail / 2 opt-in skips** (send proof + NSCC are opt-in flags; each skip names its unlock) | `docs/evidence/GA_GATE_2026-09-03.md`, run 2026-09-03. Run 1 was RED and caught 4 lint errors + 2 eval-harness defects — fixed same tick, red-to-green proven |
| Typecheck + lint | 0 errors (lint:check now in preflight) | gate rows T0 |
| Unit tests | **162 files / 1280 tests green** (intentional platform/pilot skips only) | gate run + full-suite runs through the 09-03 ticks |
| Bundle verify (CLWX-72 gate) | 19 extra packages present, 3 ship-target binding sets, 4 parsers loadable on host | `scripts/verify-openclaw-bundle.mjs`, wired into the package chain |
| Doc-tooling harness (KR1 proxy) | 5/5 | gate row; enforced preflight (`617a6ceb`) fronts every package script |
| Outlook safety contracts | 73/73 (incl. inverted subject-gate contract) | `tests/unit/outlook-actions-safety.test.ts` |
| Outlook live eval | **15/15 on outlook.cloud.microsoft** — run H started from a WEDGED lane and self-healed (`bfeb2cf1`); gate rerun 69s | `scripts/v2-eval.ts` |
| Stale-read guard (CLWX-46) | 3/3 rows × 3 consecutive runs | `scripts/clwx46-stale-read-check.ts` |
| Send-gate live proof | 4-step PASS (draft / mismatch REFUSED / matching send delivered) | `scripts/v2-send-test.ts` (gate opt-in `GA_GATE_SEND=1`) |
| Forms fill+gate dry-runs | Suspensions PASS + Daily Report PASS | gate rows T1; `scripts/forms-fill-{suspensions,daily-report}.ts` |
| NSCC Q&A eval | 18/20 (90%), 20/20 NSCC citations, wrong-edition guard proven — Raj's own 20 questions | `scripts/nscc-qna-eval.ts` (`a00ada49`); gate opt-in `GA_GATE_FULL=1` |
| Boot chain | 4/4 (+59 config/router) | `tests/unit/fresh-install-boot-chain.test.ts` |
| Outbox (KR5) | 13/13 incl. restart + crash-retry + idempotent replay | `tests/unit/outbox*.test.ts` |

## 3. Live evidence (shipped builds, persona VM + Mac lane + external tester)

| Claim | Evidence | Headline |
|---|---|---|
| KR1 doc-tooling in-app | `docs/evidence/KR1_INAPP_RUN_2026-09-02.md` | full PASS on moe.12: tool-select + KFM resolve + faithful summary; P4 xlsx PASS on moe.14; K9 (Raj's 5-prompt suite) is a permanent fixture; CLWX-72 canvas-binding fix + bundle verify close the packaged-runtime PDF gap (re-verify on moe.16) |
| KR2 fresh install | `docs/evidence/KR2_FRESH_INSTALL_RUN_2026-09-02.md` | gateway ready 50–51s (was ~285s+); both boot fixes proven live on moe.14; moe.15 VM boot `RESULT=COMPLETE`. **Recording STAGED** — everything armed; one precondition: RDP at ≥1920×1080 (owner sitting) |
| KR3 offline | lane G (c9f1aa34) | 5/5 with falsifiable egress guard — CHECKED on the scorecard |
| KR4 degrade | bde78d94 + `f01bb43a` (idle-timeout class) + **CLWX-78 fix `4261811a`** | V-batch W10 caught the OpenAI-SDK "Connection error." surface missing from UNREACHABLE_PATTERNS; classifier fixed + 3 regression rows same tick; **live re-verify rides moe.16** |
| KR5 outbox | `ebc4be75` + tests | real actions wired (send + both form submits), audit trail durable |
| KR7 Graph/identity | `2baa9589` (L1–L3 live PASS on the real tenant) + `847cd616` (in-app lane behind toggles) + `e51362b9` (UserId=oid stamped + forwarded) | ~6-week external gate cleared; L4 staged (one 2-min operator sign-in); evidence `skills/laptop/evidence/2026-09-02-graph-signin-L1-L3/RESULT.md` |
| **V-batch (moe.15 VM)** — ASR | `pilot-asr-smoke.ps1` → `ASR_SMOKE_OK`, verbatim transcript | W8 Windows ● (first-ever run) |
| V-batch — cron | `FIRED_OK` +21 ms; real agentTurn produced the 3:45pm reminder text, no send | W5 Windows ● (direct CLWX-67 Windows-leg evidence) |
| V-batch — b2 write turn | `vbatch-b2.docx` written + independently read back, 3-layer proof | CLWX-65 Windows leg ● (Karunesh's matrix item d = first EXTERNAL in-app write-turn proof) |
| Outlook lane hardening | **CLWX-46 fixed** `715e17b7` (settle-on-expected-item guard; wrong-target reads impossible; read latency 57s→1.5s class) + **CLWX-59 fixed** `2e01891d` (rotated Fluent SplitButton compose pane) + harness self-heal `bfeb2cf1` (CLWX-69 discard-OK wedge) | 15/15 run H from a wedged lane; `docs/FLOW_STATE_DIAGRAMS.md` + `demo-flow-recovery` skill for live recovery |
| **CLWX-72 packaged-runtime PDF** | RCA + fix `2591af3a`: win32 `@napi-rs/canvas` binding never installed on the Mac build host; loadDep catch-all masked it. Four fix layers (supportedArchitectures, DOMMatrix polyfill + truthful errors, bundler hard-fail, `verify-openclaw-bundle.mjs`) | artifact-grade proof: patched doc-tools on the still-broken moe.15 VM runtime → `CLWX72_VERIFY=PASS pages=1 chars=835` on a real Ministry circular; fresh-install re-verify rides moe.16 |
| Forms — Suspensions | `docs/CAPABILITY_STATE_2026-09-02.md` + W3 Mac ● | 29/32 fields, 0 errors, submit gate held (cloned suspensions form); recorded-verified submit harness (`bfc092a4`): refusal proven, ONE confirmed submit landed (responses 5→6, 2xx POST) with video + trace |
| Forms — **Daily Report e2e (CLWX-62)** | `scripts/forms-fill-daily-report.ts` live on the test.fac clone (`66790d22`) | the statutory 3:45pm form's first end-to-end: open PASS, **fill 55/57 / 0 errors**, gate REFUSED without confirm, confirmed submit PASS; recorded leg is the last acceptance item |
| Latency | `docs/evidence/LATENCY_BASELINE_2026-09-02.md` | median ≈103s vs proposed 15s p50 — **FAIL, known limitation** (§5); CLWX-46 improved the read path |
| Raj June defects — **all four dispositioned** | `docs/STAKEHOLDER_REPORT_2026-09-02.md` + `a0f390b4` | RAJ-1 + RAJ-4 fixed-verified; RAJ-3 refuted by script (re-refuted 09-03); **RAJ-2 NOT REPRODUCED at the model layer** (`scripts/raj2-reply-fidelity-check.ts`: live turn, coverage floor met, zero invented entities, nothing dispatched) → CLWX-34 Ready. The run's by-catch (STALE-READ) became CLWX-46, fixed same sprint |
| External tester (Karunesh) | `docs/KARUNESH_ERROR_LEDGER.md` (K1–K14) + `docs/BLOCKER_BUG_COLLECTION_2026-09-03.md` | moe.15 handed over (hash-verified signed URL); his matrix 4/5 Worked; the two failures root-caused with log evidence → CLWX-72 (PDF, fixed-in-tree) and CLWX-70/74 (send chain; litter swept — 14 automation drafts deleted, re-scan 0). Every error he ever reported has a derived test criterion wired into CLWX-77 |
| Stakeholder regression battery | re-run live 09-03 | 118/118 unit contracts + 15/15 v2-eval + RAJ-3 re-refuted; consolidated update SENT to Raj (owner GO, ledgered) |

## 4. Defect posture

`docs/DEFECT_REGISTER_2026-09-02.md` (+ 09-03 deltas) and
`docs/BLOCKER_BUG_COLLECTION_2026-09-03.md` (144 quote-backed findings mined
from every session source; 20 NEW → CLWX-79..89; 14 fixed-unguarded → named
tests folded into CLWX-77; 46 fixed-guarded with guards green TODAY).
Board @ 90.

Pre-GA agent-side fixes remaining: **moe.16 cut + fresh-install re-verify**
(closes CLWX-72/78), **CLWX-79** (statutory-form demo-default backfill —
urgent, data-fabrication class), **CLWX-82** (typecheck blind to
`electron/**`), CLWX-62 recorded leg, CLWX-58/70 recovery + exit-path
invariant. Open-blocking beyond that is **human/external-gated** (security
sitting, trim unhold, Ministry values, KR2 RDP sitting, tester follow-up).

## 5. Known limitations (state them at GA, do not hide them)

1. **Latency**: ~7× over the proposed budget on the VM lane; movers are the
   trim (owner HOLD), prompt caching (Ministry ask #7), routing. Laptop
   measurement pending.
2. **On-device turns** complete on persona laptop hardware (moe.11 lane),
   NOT on the CPU-starved e2 VM; retry-breaker (`fee7294d`) shipped in
   moe.15.
3. **Outlook folder operations are out of GA scope** (PM scope call on
   CLWX-22, `docs/GA_FINISH_SPRINT_2026-09-03.md` §matrix): read, draft,
   reply, gated send are in; move/organize folders is a documented
   known-limitation, not a GA blocker.
4. **Degrade live re-verify rides moe.16.** The CLWX-78 classifier fix
   (`4261811a`) is landed with regression rows, but the live
   cloud-down/on-device-down failover proof on a shipped build waits for the
   moe.16 install re-verify.
5. **KR2 recording is staged, awaiting the owner RDP sitting** (assisted GUI
   at ≥1920×1080). All silent/timed evidence exists; the recording is the
   remaining acceptance form.
6. **Ministry chain is post-GA by design**: KR8 working session → real
   APIM/Entra production values → KR7 fleet identity → KR6 fleet-verify;
   forms production destination (Tier C flow URLs) and the Graph/Entra
   production packet ride the same chain (late September earliest). The
   clone lane is the demo/GA path; the email lane rides the browser session
   until then (Graph lane already proven L1–L3 + in-app behind toggles).

## 6. Security floor status

- Working tree: 0 credential literals (f99f2c1f scan); board mirror exporter
  redacts + scans clean every sync.
- **OPEN (owner)**: CLWX-18 public-repo history scrub + source/releases
  split; CLWX-19 `sk-clawx` rotation. Both required by the scorecard's
  security boxes — the one sitting, ~an hour.
- New from the mining sweep: **CLWX-84** (plaintext sandbox credentials in
  local liaison logs + probe scripts passing recipient/body via process
  args) — high, local-only surface, carded.

## 7. How to re-verify everything (one command, then the lanes)

```bash
pnpm ga:gate                                     # THE acceptance test (T0+T1; report to docs/evidence/)
GA_GATE_SEND=1 GA_GATE_FULL=1 pnpm ga:gate       # + live send proof + NSCC eval (opt-in)
pnpm exec tsx scripts/v2-eval.ts                 # Outlook live 15-row (needs lane)
pnpm exec tsx scripts/clwx46-stale-read-check.ts # CLWX-46 guard
pnpm exec tsx scripts/v2-send-test.ts            # gate proof (sandbox)
pnpm exec tsx scripts/forms-fill-suspensions.ts  # forms dry-run
pnpm exec tsx scripts/forms-fill-daily-report.ts # Daily Report dry-run (CLWX-62)
pnpm exec tsx scripts/raj3-reply-archive-check.ts
node scripts/verify-openclaw-bundle.mjs          # CLWX-72 packaging gate
# VM lane: windows-pilot/scripts/pilot-*.ps1 per docs/VM_TEST_BASE.md (V-batch pattern)
```

*Refreshed 2026-09-03 — board @ 90, gate GREEN.*
