# GA evidence packet — Ministry of Education principal assistant

*Assembled 2026-09-02 (CLWX-10). One index from which every GA claim can be
verified: artifact → evidence doc → commit → runnable check. The human
GO/NO-GO scorecard is `docs/wiki/GA_READINESS.md` §4; this packet is the
evidence behind its boxes.*

## 1. Release artifacts

| Build | Artifact | SHA256 | Carries |
|---|---|---|---|
| **moe.15 (GA-tag candidate)** | `release/…moe.15-win-x64.exe` (390 MB, signed; also in GCS) | `d10de580…18df` | moe.14 + retry breaker (`fee7294d`), KFM tilde resolver (`97004aa6`), Outlook gate + migration (`a8322ad9`) |
| moe.14 | `release/…moe.14-win-x64.exe` (signed) | `8634bd74…65d7` (verified guest==build host) | channel-choice + EPERM boot fixes |
| moe.13 | `release/…moe.13-win-x64.exe` | `a8494ec0…3ecf` (verified) | slow-ready fix, outbox wiring, fixed seeder |
| moe.12 | `release/…moe.12-win-x64.exe` (shipped, on VM) | `0a3bbf27…5ee64` | doc-tooling steering |
| VM restore point | GCP snapshot `clawx-l2-moe12-kr1pass-20260902` | READY, VSS-consistent | L2 per docs/VM_TEST_BASE.md |

Remaining on moe.15: one VM install + smoke (fresh-state boot + green turn)
to stamp it — then it is the tag.

## 2. Suite evidence (at HEAD)

| Suite | Result | Where |
|---|---|---|
| Typecheck | clean | every commit this sprint |
| Unit tests | **1230/1230** (6 intentional platform/pilot skips, inspected) | full run 2026-09-02 |
| Outlook safety contracts | 73/73 (incl. inverted subject-gate contract) | `tests/unit/outlook-actions-safety.test.ts` |
| Outlook live eval | **15/15 on outlook.cloud.microsoft** | `scripts/v2-eval.ts` |
| Send-gate live proof | 4-step PASS (draft / mismatch REFUSED / matching send delivered) | `scripts/v2-send-test.ts` |
| Doc-tooling resolver | 20/20 (incl. KFM tilde case) | `tests/unit/doc-tooling-steering.test.ts` |
| Boot chain | 4/4 (+59 config/router) | `tests/unit/fresh-install-boot-chain.test.ts` |
| Outbox (KR5) | 13/13 incl. restart + crash-retry + idempotent replay | `tests/unit/outbox*.test.ts` |

## 3. Live in-app evidence (shipped builds, persona VM + Mac lane)

| Claim | Evidence doc | Headline |
|---|---|---|
| KR1 doc-tooling in-app | `docs/evidence/KR1_INAPP_RUN_2026-09-02.md` | full PASS on moe.12: tool-select + KFM resolve + faithful summary; P4 xlsx PASS on moe.14 (2/6 P-prompts live; BM25 harness covers the set) |
| KR2 fresh install | `docs/evidence/KR2_FRESH_INSTALL_RUN_2026-09-02.md` | gateway ready 50–51s (was ~285s+); both boot fixes proven live on moe.14; on-device binding persists across restarts |
| KR3 offline | lane G (c9f1aa34) | 5/5 with falsifiable egress guard — CHECKED on the scorecard |
| KR4 degrade | bde78d94 + G-degrade-classify | CHECKED on the scorecard |
| KR5 outbox | `ebc4be75` + tests | real actions wired (send + both form submits), audit trail durable |
| Outlook lane on the NEW domain | commit `a8322ad9` narrative | gate false-negative closed; migration survived same-day |
| Forms fill | `docs/CAPABILITY_STATE_2026-09-02.md` | 29/32 fields, 0 errors, submit gate held (cloned suspensions form) |
| Latency | `docs/evidence/LATENCY_BASELINE_2026-09-02.md` | median ≈103s vs proposed 15s p50 — **FAIL, known limitation** |
| Raj June defects | `docs/STAKEHOLDER_REPORT_2026-09-02.md` | RAJ-1 + RAJ-4 fixed-verified, RAJ-3 refuted by script, RAJ-2 open (scenario designed) |

## 4. Defect posture

`docs/DEFECT_REGISTER_2026-09-02.md`: 50+ entries. Open-blocking is down to
items that are **human/external-gated** (security sitting, trim unhold,
Ministry values, external tester, assisted-GUI recording) plus RAJ-2.
Open-not-blocking includes the four stakeholder-sweep additions (exec-noise,
idle-timeout-raw, Plaud, LATENCY-UX) — all with testable criteria on CLWX-44/43.

## 5. Known limitations (state them at GA, do not hide them)

1. **Latency**: ~7× over the proposed budget on the VM lane; movers are the
   trim (owner HOLD), prompt caching (Ministry ask #7), routing. Laptop
   measurement pending.
2. **On-device turns** complete on persona laptop hardware (moe.11 lane),
   NOT on the CPU-starved e2 VM; retry-breaker (`fee7294d`) ships moe.15.
3. **Forms production destination** waits on Ministry flow URLs (Tier C);
   the clone lane is the demo/GA path.
4. **Email lane rides the browser session** until the Entra/Graph packet
   lands (post-GA, late September earliest).
5. **RAJ-2** (reply content fidelity) open with a designed scenario.

## 6. Security floor status

- Working tree: 0 credential literals (f99f2c1f scan); board mirror exporter
  redacts + scans clean every sync.
- **OPEN (owner)**: CLWX-18 public-repo history scrub + source/releases
  split; CLWX-19 `sk-clawx` rotation. Both required by the scorecard's
  security boxes — the one sitting, ~an hour.

## 7. How to re-verify everything (one sitting, ~30 min)

```bash
pnpm typecheck && pnpm test                     # suites
pnpm exec tsx scripts/v2-eval.ts                # Outlook live (needs lane)
pnpm exec tsx scripts/v2-send-test.ts           # gate proof (sandbox)
pnpm exec tsx scripts/forms-fill-suspensions.ts # forms dry-run
pnpm exec tsx scripts/raj3-reply-archive-check.ts
# VM lane: windows-pilot/scripts/pilot-*.ps1 per docs/VM_TEST_BASE.md
```
