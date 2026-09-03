# The GA loop — how it works and how to drive it

*Written 2026-09-03 for the owner. The "Claude loop" for this project is not
magic: it is one bounded tick, run repeatedly, where every tick leaves the
system consistent (board == docs == git). Three ways to run it, same tick.*

## 1. The tick (what one iteration does)

Defined in `.claude/skills/ga-sprint-driver/SKILL.md`:

1. **SENSE** (read-only): `git status`, board re-export + diff, state vector
   §0, sprint plan lanes, cheap blocker probes.
2. **ANALYZE**: classify every non-terminal card P (parallel-now) / S
   (serial, named predecessor) / O (owner) / V (VM window) / M (Ministry);
   promote anything whose gate cleared; rank P by leverage.
3. **ACT** (bounded): execute the single highest-leverage P item fully, with
   evidence, respecting every hard rule (gates, secrets, no destructive git).
4. **SYNC**: evidence comments on touched cards; met-acceptance cards → Ready
   (**never Done — a human closes**); state vector §0 delta; board re-export;
   scoped commit.
5. **REPORT**: cards moved, item executed + evidence pointer, promotions,
   and the exact owner asks outstanding.

Because each tick is self-contained, ticks compose: a cron, a fresh session,
or a human can run the next one without shared memory.

## 2. Three ways to run the loop

**A. The armed cron (already live).** Durable job `977942a5` fires every 6
hours and invokes the `ga-sprint-driver` skill. Recurring jobs auto-expire
after 7 days (armed 2026-09-02 → expires ~2026-09-09); re-arm by asking any
session: *"re-arm the ga-sprint-driver cron, every 6 hours, durable."*

**B. Manual tick (paste into any Claude Code session in this repo):**

```text
Run one ga-sprint-driver tick. Sprint plan: docs/GA_FINISH_SPRINT_2026-09-03.md
(items 1-10 to Ready). Truth table: docs/GA_SPRINT_STATE_VECTOR.md. Persona
bars: docs/PERSONA_STATE_VECTOR_2026-09-03.md. Ceiling is Ready; draft-and-hold
all outward comms; no destructive git. End with the tick report.
```

**C. Run-to-exhaustion loop (paste when you want it driven, not ticked):**

```text
Drive the GA finish sprint (docs/GA_FINISH_SPRINT_2026-09-03.md) to
completion autonomously: loop ga-sprint-driver ticks back-to-back until
every agent-executable item (sprint backlog 1-10) is at Ready with evidence
or provably blocked on an O/V/M gate. Between ticks, re-run the recursive
analysis (SENSE/ANALYZE) so newly unblocked serial items are promoted. Never
loosen a quality gate to pass; never move a card past Ready; park owner and
Ministry gates with a note. When nothing is P-class, stop and print: the
Ready list awaiting my close, the single owner sitting (bucket B), and the
V-batch command.
```

## 3. What only you can do (the loop will keep parking these)

- **Close Ready → Done.** 20+ cards sit in Ready with evidence comments;
  review each and close. The ceiling exists so an agent never declares its
  own work accepted.
- **Bucket-B sitting (~1h):** CLWX-18 repo scrub, CLWX-19 key rotation, trim
  unhold, latency budget number, KR2 acceptance mode, external tester, CLWX-45
  per-item GO.
- **V-batch:** start the Windows VM (one gcloud command on the card) so gap
  C/D + b2 + W10 run in one window.
- **GA declaration** when `docs/wiki/GA_READINESS.md` §4 boxes are checked or
  owner-accepted.

## 4. Guardrails the loop must never lose

Ready ceiling; draft-and-hold comms; two-gate sends only from the test.fac
sandbox; no secrets in logs/board/commits; no destructive git; probe blockers
before believing them; every Ready transition carries evidence and names the
persona bar it met.
