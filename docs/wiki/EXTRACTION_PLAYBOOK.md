# Extraction playbook — turning transcripts into wiki + board content

_Last updated: 2026-09-01._

How to reliably pull learnings, decisions, defects, and asks out of raw
material (Claude Code session JSONL, WhatsApp threads, Ministry docs) and land
them in the wiki and the board.

## Can we just feed the whole JSONL to an LLM? (the honest answer)

**Partly.** The material is bigger than one context window and mostly noise:

- One session JSONL ≈ **5.6 MB / ~1.4 M tokens**; there are **4 sessions** for
  this project → several million tokens. That exceeds a normal context window
  and most of the bulk is **tool output** (file dumps, command stdout), not the
  reasoning or decisions we actually want.

So don't raw-dump. **Pre-distill, then extract.** Two viable paths:

1. **Distill first (recommended).** Strip the JSONL to just the signal —
   user turns, assistant text, and *tool-call summaries* (drop large tool
   results) — which shrinks it ~5–10×. Then a single long-context model
   (e.g. Gemini 2.5 Pro, 2 M window) can read one distilled session at a time.
2. **Map-reduce.** Chunk the raw JSONL, run the same extraction prompt over each
   chunk (map), then merge + dedupe the structured results (reduce). Slower, but
   handles unlimited size and needs no giant context window.

A distill filter is trivial (JSONL is line-delimited): keep `type` in
`{user, assistant}` text blocks and tool_use `name`+`input`; drop `tool_result`
bodies over N bytes, replacing them with a one-line marker.

## How to write the extraction prompt (the important part)

A good extraction prompt is **five parts**, in this order:

1. **Role + purpose.** "You are a release analyst building a versioned wiki for
   the ClawX pilot. Extract durable facts, not narration."
2. **The exact output schema.** Don't ask for prose — ask for rows. Give the
   JSON/markdown-table shape you want, field by field. The schema is the single
   biggest quality lever.
3. **Extraction rules.** Cite a source for every row (file / db row / commit /
   card). Separate FACT from ANALYSIS. Mark anything uncertain `UNVERIFIED`.
   Never invent. "If it's not in the source, omit it and say the section is empty."
4. **One worked example.** A single filled-in row of the schema. Few-shot beats
   description for format adherence.
5. **The source, last.** Put the (distilled) material at the end so the
   instructions aren't buried.

Concrete template (reused across sources):

```
ROLE: You extract durable knowledge for the ClawX pilot wiki. You do not narrate.
TASK: From the SOURCE below, extract every <THING> into the schema. Nothing else.
SCHEMA (one row each): | date(abs) | who | claim | source-ref | status |
RULES:
- Every row cites a source-ref (file path, db rowid, commit sha, or CLWX-N).
- Convert relative dates ("tomorrow") to absolute using the message timestamp.
- FACTS only in the table; put inferences under a separate "ANALYSIS" heading.
- Redact secrets: no phone numbers (mask …3280), passwords, keys, cred links.
- If a category has nothing, write "(none found)" — do not fabricate.
EXAMPLE ROW: | 2026-08-18 | Raj | provisioned APIM 100M tok/mo, UserId header | inbound-docs/handoff.pdf | open |
SOURCE:
<distilled material>
```

Point the schema at the target wiki page (Liaison log rows, Decision-log ADRs,
defect rows) so the output drops straight in.

## Meta-prompts — yes, but bounded

A **meta-prompt** generates the per-source extraction prompt. Useful because we
have several source types (JSONL, WhatsApp, PDFs, emails) and several targets
(liaison log, decision log, defect list). Rather than hand-write N×M prompts:

> "You are a prompt author. Given a TARGET wiki schema and a SOURCE type, emit a
> single extraction prompt following the five-part structure (role, schema,
> rules, one example, source-slot). Keep the redaction + citation rules verbatim."

**Keep it bounded, not fully dynamic.** In practice a small library of ~4 fixed
templates (one per target page) is more reliable than open-ended meta-prompting —
the meta-prompt is best used *once* to author those templates, then version them
here. Fully dynamic meta-prompting drifts and is hard to review.

## The pipeline, end to end

```
raw JSONL / threads / PDFs
   └─ distill (strip tool-output noise; OCR PDFs)         ← cheap script
        └─ extract (five-part prompt, per target schema)  ← LLM, long-context or map-reduce
             └─ review (human/agent: cite-check, dedupe)  ← separate pass, never self-approve
                  ├─ wiki page (docs/wiki/*.md)           ← durable knowledge
                  └─ board cards (scripts/report-bug.mjs) ← work items (defects, gaps)
```

Two hard habits: **the extractor and the reviewer are different passes** (don't
let the model bless its own extraction), and **defects become cards, knowledge
becomes wiki** — never mix work items into the wiki.

## What we already automate

- `scripts/plane-board-export.mjs` — board → repo backup (restore-grade JSON + md).
- `scripts/report-bug.mjs` — uniform bug → Plane Backlog.
- The `ministry-liaison-monitor` agent — the read-side extractor for Raj/Karunesh
  threads + inbound docs (feeds `LIAISON_LOG.md`).
