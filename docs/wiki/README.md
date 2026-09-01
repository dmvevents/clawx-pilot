# ClawX pilot wiki — index

The durable knowledge base for the ClawX / Ministry of Education pilot. This is
the **wiki** half of a wiki+agile split:

- **Wiki (this dir, `docs/wiki/`)** — knowledge that changes slowly and must
  survive on clone: product, architecture, runbooks, decisions, the liaison
  record, the repo/release map. Version-controlled markdown is the source of
  truth. (Plane's own Pages/wiki is not API-accessible, so we keep the wiki in
  the repo and optionally mirror key pages into Plane by hand.)
- **Agile board (Plane, `localhost:8090`)** — the *work*: what to do next.
  Mirrored read-only into `docs/plane-board/`.

## The agile model on the board

Plane project **modules/cycles are disabled** (a UI-only toggle), so we express
agile structure with **labels** until they're enabled:

| Agile concept | How it's expressed | Where |
|---|---|---|
| **Epic** | `epic/KR1…KR8` labels (one per Key Result) | Plane labels, tagged on cards |
| **Story / task** | an issue (card) | Plane issues |
| **Definition of Done** | the per-KR acceptance test | `docs/GA_EXECUTION_PLAN_2026-09-01.md` §3 |
| **Sprint** | `sprint/N` label (add when we start time-boxing) or enable Cycles | Plane labels/cycles |
| **Type** | `type/security`, `type/bug` (via `report-bug.mjs`) | Plane labels |
| **Blocker class** | `blocked/B0…B4` (see GA plan §3 taxonomy) | Plane labels |

To upgrade to true Plane Modules + Cycles: enable them in Plane project settings
(Features), then the same epic/sprint grouping moves off labels onto native
modules/cycles.

## Pages

| Page | What it holds | Freshness |
|---|---|---|
| [`GA_READINESS.md`](./GA_READINESS.md) | **The GO/NO-GO document**: chronological gap ledger, test evidence, GA gate checklist, critical path | 2026-09-01 |
| [`REPO_AND_RELEASE_MAP.md`](./REPO_AND_RELEASE_MAP.md) | Every repo we use, visibility, role, and the release/distribution + security plan | 2026-09-01 |
| [`EXTRACTION_PLAYBOOK.md`](./EXTRACTION_PLAYBOOK.md) | How to turn session JSONL / threads into wiki+board content with LLM prompts + meta-prompts | 2026-09-01 |
| [`LIAISON_LOG.md`](./LIAISON_LOG.md) | Chronological Raj (ClawX) + Karunesh (video) record, open asks, defects, Ministry-docs inventory | (generated) |
| [`TEST_PLAN.md`](./TEST_PLAN.md) | What can be tested right now, by KR, and coverage gaps | (generated) |
| [`DECISION_LOG.md`](./DECISION_LOG.md) | ADR-style record of the decisions that shaped the pilot | 2026-09-01 |

## Companions (existing docs this wiki links, not replaces)

- `docs/GA_EXECUTION_PLAN_2026-09-01.md` — lanes, acceptance criteria, blocker taxonomy.
- `docs/PRODUCT_PRINCIPAL_ASSISTANT.md` — feature-by-feature product description.
- `docs/plane-board/` — the board backup + card map.
- `docs/project-history/TIMELINE.md` — chronological build history.
- `docs/MINISTRY_INFRA_HANDOFF_2026-08-18.md` — the inbound Ministry infra packet (placeholders only).
- `docs/MINISTRY_REPLY_DRAFT_2026-08-20.md` — the unsent Lane-C infra reply (answers the handoff).

## Conventions

- One page = one durable topic. Work items go on the board, not here.
- Every factual claim cites a source (file, db row, commit, or card).
- Secrets never appear here (no phone numbers, passwords, keys, credential links).
- Update the freshness date when a page changes; note *why* in the commit.
