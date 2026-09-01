# ClawX project history

A chronological, sourced record of how the ClawX (Ministry of Education fork)
pilot was built — reconstructed from git history, the repo docs, and the Codex
sessions used along the way.

## Files

- [`TIMELINE.md`](./TIMELINE.md) — dated build history (FACTS vs INFERENCE),
  a Codex-session index, the two-project separation, and the open-gaps list.

## How this was compiled

Assembled 2026-09-01 from on-disk sources only:

- `git log` on this repo (branch `fix/doc-tooling-steering`).
- `docs/*.md` (esp. `GA_PLAN.md`, `OFFLINE_ARCHITECTURE.md`,
  `SCALE_ANALYSIS_2026-08-20.md`, `MINISTRY_REPLY_DRAFT_2026-08-20.md`,
  `PRODUCT_PRINCIPAL_ASSISTANT.md`, the `GA_RELEASE_PLAN` / Windows docs).
- `skills/laptop/evidence/**` timestamped evidence dirs.
- `~/.codex/sessions/**` (266 `.jsonl` files) + `~/.codex/history.jsonl`.

## Two projects — never conflate

This maintainer runs two projects with a shared contact surname. The history
below is **ClawX only**. See `TIMELINE.md` §"Two-project separation".

- **ClawX principal-assistant pilot** — contact **Raj Ramdass** / Ansari Khan.
  This repo.
- **Curriculum-video generator** — contact **Karunesh Ramdass**. The
  `Test N - <topic>` QA batches. A separate workstream, not in this repo.

The `ministry-liaison-monitor` skill/agent enforces this split when reading the
inbound-docs drop.

## Source of truth

For *what to work on* and *what "done" means*, the CLWX Plane board
(`81a2ea23-e060-49b4-a344-1ab0339f46d5`) and `docs/GA_PLAN.md` are authoritative.
This folder is the historical record, not the plan.
