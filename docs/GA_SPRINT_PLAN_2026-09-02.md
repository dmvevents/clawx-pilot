# GA sprint plan — 2026-09-02

*Supersedes the day-plan in GA_EXECUTION_PLAN_2026-09-01.md as the operating
plan; the state vector (GA_SPRINT_STATE_VECTOR.md) stays the per-card truth
table. Board is authoritative for card state; this file is authoritative for
sequencing.*

## Mission

Take the Ministry of Education assistant from pilot-grade to GA: every KR card
at Ready with evidence, every known defect fixed-or-registered, the test
environment reproducible from snapshots instead of a hand-tended VM, and the
owner-gated items packaged so a human can close them in one sitting.

## The persona (who we replicate, who we test as)

All testing replicates **a T&T primary-school principal's laptop**, not a dev
machine: Windows 11 24H2 / 16 GB / OneDrive KFM redirected Desktop+Documents /
Chrome signed into the school Outlook account / Ollama qwen2.5:3b on-device /
MoE forms in the tenant / installers hand-delivered (no auto-update). The
persona's environment is now codified as a layered snapshot design in
`docs/VM_TEST_BASE.md` (L0 base-os → L1 persona-base → L2 post-install).
Acceptance evidence only counts when captured on a persona-faithful base.

## Build under test

- **moe.12** — shipped, on the test VM, KR1 PASS captured on it.
- **moe.13** — built + signed 2026-09-02 (`release/Ministry of
  Education-0.4.3-moe.13-win-x64.exe`, sha256 `a8494ec0ae7d054c9343…deb3ecf`).
  Carries: fresh-install slow-ready fix (61be816e), outbox wiring (ebc4be75),
  fixed OOXML seeder (1804aaab+128fcab6), driver settle fix (ecf31c4b).
  Pre-flight: typecheck clean, **1230/1230 unit tests** (6 intentional
  platform/pilot-scope skips), Windows ASR helper bundled from cache (source
  unchanged since 2026-05-26; dotnet not present on build host).

## Sprint structure — three lanes, strictly by dependency

### Lane 1 — LOCAL (no VM, no Ministry): run to exhaustion first
| # | Work | Card | Status |
|---|---|---|---|
| 1.1 | KR1 full in-app PASS + evidence + fixture root cause | CLWX-24 | ✅ **Ready** 2026-09-02 |
| 1.2 | Fresh-install slow-ready root cause + fix + regression test | CLWX-25 (partial) | ✅ code done; recording owed (Lane 2) |
| 1.3 | Outbox wired to real actions + restart test | CLWX-28 | ✅ **Ready** 2026-09-02 |
| 1.4 | moe.13 build + full-suite evidence | (feeds 2.x) | ✅ built + signed |
| 1.5 | VM test-base design (persona layers, commands, traps) | (feeds 2.x) | ✅ docs/VM_TEST_BASE.md |
| 1.6 | Stale-backlog triage: map CLWX-1..21 onto KR cards, mark superseded | board hygiene | ◐ this session |
| 1.7 | GA evidence packet assembly (CLWX-10-class) | CLWX-10 | ○ after 2.x lands |

### Lane 2 — VM EVIDENCE (blocked on owner: `gcloud auth login`)
Everything here is scripted and ready to execute the hour the lane returns.

| # | Work | Card | Pre-staged assets |
|---|---|---|---|
| 2.1 | L2 snapshot of current disk (evidence preservation) | infra | command in VM_TEST_BASE.md |
| 2.2 | Copy KR1 raw artifacts off-VM | CLWX-24 annex | scp one-liner known |
| 2.3 | Install moe.13; fresh-state first-boot RECORDING: timed gateway-ready + composer-enabled + one green on-device turn (before/after vs moe.12 slow-ready) | CLWX-25 → Ready | installer built; probe + driver + reader scripts in repo |
| 2.4 | Author L1 persona-base snapshot (uninstall, state wipe, bless checklist) | infra | checklist in VM_TEST_BASE.md |
| 2.5 | Stand up Outlook lane (user Chrome CDP :18792, test.fac sign-in — needs PILOT_TEST_PASSWORD locally) | CLWX-34 prereq | plan on card |
| 2.6 | Reproduce/refute Raj's 4 June-21 defects on moe.13 | CLWX-34 → Ready | defect list from registrar |
| 2.7 | Windows smoke + regression matrix on moe.13 | CLWX-10 evidence | windows-smoke agent + harness |

### Lane 3 — MINISTRY / OWNER-GATED (package for a human, don't wait on it)
| # | Work | Card | Gate |
|---|---|---|---|
| 3.1 | `gcloud auth login` (unblocks all of Lane 2) | — | **owner, 2 minutes** |
| 3.2 | Service account for unattended IAP (kills the recurring lane-killer) | CLWX-33 note | owner approval |
| 3.3 | Public-repo scrub + source/releases split | CLWX-18 | owner (destructive) |
| 3.4 | Rotate `sk-clawx` key | CLWX-19 | owner |
| 3.5 | Real Ministry endpoint values + working session | CLWX-31/KR8 | Raj |
| 3.6 | Entra sign-in → stable UserId | CLWX-30/KR7 | after 3.5 |
| 3.7 | Trim unhold decision (branch 7add864b) + per-user caps | CLWX-29/KR6 | owner + 3.6 |
| 3.8 | Point outbox drain at real app server (`MOE_APP_SERVER_URL`) | CLWX-28 annex | after 3.5 |

### Dependency DAG (what is truly sequential)

```
gcloud auth login (3.1) ──► ALL of Lane 2 (2.1→2.7 internally ordered:
                             snapshot first, then installs, then Outlook lane)
Raj values (3.5) ──► KR7 identity (3.6) ──► KR6 fleet caps (3.7) ──► KR8 close
                └──► outbox drain live (3.8)
Everything else is parallel-now and largely DONE.
```

## GA acceptance bar (testable statements)

GA is declared when ALL of:
1. KR1–KR5 cards at Ready with captured evidence on a persona-faithful base
   (KR1 ✅, KR3 ✅, KR4 ✅, KR5 ✅, KR2 = recording owed).
2. moe.13 (or later) installed cleanly on a fresh persona base with first-boot
   → green turn recorded, no manual state surgery.
3. Raj's June-21 defects each reproduced-or-refuted with evidence (CLWX-34).
4. Zero OPEN defects classed "blocking GA" in the defect register.
5. Security cards (CLWX-18/19) closed by the owner OR explicitly risk-accepted
   in writing.
6. KR6–KR8 either closed or formally descoped from GA by the owner (they gate
   FLEET scale-out, not single-school GA — decision needed).
7. GA evidence packet (CLWX-10) assembled: installer hash, test matrix,
   evidence index, known-limitations sheet.

## Operating rules for this sprint

- Cards move at most to **Ready**; a human closes to Done.
- Every state change gets an evidence comment on the card, then a board
  re-export commit (`scripts/plane-board-export.mjs`) so repo and board never
  drift.
- New defects found mid-sprint: register on the card they surfaced on, fix if
  local-lane, otherwise add to the register with class.
- All Lane-2 evidence captured with the committed scripts (probe, chat-turn
  driver, last-message reader) — no ad-hoc inline PowerShell (IF-2).
