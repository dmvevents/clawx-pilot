# ClawX doc-tooling evaluation pipeline

```bash
pnpm eval                 # lanes A-E, deterministic, ~15s
pnpm eval:ci              # same + JSON and JUnit reports under artifacts/eval/
pnpm eval:live            # add lane F (needs a reachable model)
pnpm eval --lane C        # one lane; repeatable
pnpm eval:snapshot-skills # refresh the competing-skill descriptions
```

## Why this exists

On 2026-07-21 the Ministry ran five prompts against a ClawX build and scored
**0/5** (`incoming-tests/ClawX Agent Tests/`). The offline harness scored the
same code path **5/5**, and the prompt replay scores **7/7**. All three numbers
are correct, and that is the whole problem:

| Layer | Question | Covered by |
|---|---|---|
| handler | does `readDocx()` parse a .docx? | `harness/run.ts` — 5/5 |
| **selection** | **would the model call `document.read_docx` at all?** | **nothing, until now** |
| **discovery** | **does a bare filename resolve on a real laptop?** | **nothing, until now** |

`harness/run.ts` reads `expect_calls_tool` from its own spec and calls that
handler directly with an absolute path. It is structurally incapable of
observing selection or discovery — the two layers that actually failed.
`CHAT-001-6.png` shows what did happen: the agent read
`~/.openclaw/skills/pdf/SKILL.md`, reached for `pdfplumber`, wrote a Python
script, and ran `uv pip install`. Seven tool calls, no answer.

## Lanes

| Lane | Scores | Fails when |
|---|---|---|
| **A** selection | Ranks the shipped tool catalogue against each Ministry prompt, under **two** catalogue profiles | a Python skill out-ranks a `document.*` tool, or the wrong `document.*` tool wins |
| **B** counterfactual | Replays the **pre-fix** catalogue | the pre-fix catalogue does *not* reproduce the failure |
| **C** discovery | Stages real files on a real tree and resolves them | a bare filename misses, or the sandbox leaks |
| **D** steering | The catalogue/manifest state the fix rests on | steering text or `autoEnable: false` regresses |
| **E** capability | Delegates to `harness/run.ts` | a handler breaks |
| **F** live | Real LLM tool-pick | — currently always SKIPs |

### Lane A scores two catalogues, not one

A fresh install auto-enables no Python doc skills, so the native tools would
win by default — an easy pass. But `resources/skills/bundles.json` ships
`pdf`, `xlsx`, `docx`, and `pptx` inside the **recommended** "Principal's
toolkit". A principal who accepts the recommendation gets every competitor
back. Lane A therefore scores both `default` and `principal-bundle`, and the
native tools must win **on merit** in the second one. Passing rows print the
margin over the strongest competitor, because a hair-thin win is not durable.

Five of the twelve cases (`A1`–`A5`) are adversarial: they use the exact
vocabulary the competing `SKILL.md` files advertise as their triggers
("the xlsx in my downloads", "letterhead", "OCR on scanned"). A steering fix
that only survives the literal five Ministry prompts is overfitted.

### Lane B is the one that makes lane A mean something

A green metric is worthless if it cannot go red. Lane B rebuilds the
**pre-fix** catalogue — Python skills auto-enabled, no persona routing rule,
steering sentences stripped from the tool descriptions — and asserts the
Python skill **wins**. It currently reproduces 4/12, including all three
adversarial vocabulary cases, and `B-sensitivity` FAILs the run if that
number ever hits zero. Lane C does the same for the traversal fix: it runs
the shipped breadth-first scan and the superseded depth-first one against the
same real tree and requires the old one to miss.

## What this pipeline does NOT prove

**Lane A is a retrieval proxy, not a model.** It is BM25 over the real
catalogue plus the real persona directives, and every input is a live on-disk
artifact — descriptions come from calling the plugin's own `register()`, not
from parsing source. But an LLM is not BM25. Lane A can prove the catalogue is
no longer stacked against the native tools; it cannot prove what Gemini or
Sonnet will pick.

Only lane F can, and it SKIPs. The runner says so on every green run:

```
9 check(s) SKIPPED — a green run here does NOT mean full coverage.
Tool selection is PROXY-VERIFIED ONLY. Closing it out needs an in-app LLM run.
```

Two other standing caveats:

- The fixtures are **reconstructed**, not the Ministry's bytes. The PDF in
  particular is a hand-built PDF-1.4, so P3 proves the path works, not that it
  survives a real circular. Ask Raj for the real `MoE Agent Testing Folder`.
- Lane C stages files under the **runner's** `$HOME`. It proves the OneDrive
  KFM logic on whatever tree it finds; it is not a Windows KFM laptop. The
  `windows-vm-smoke` skill covers that.

## Layout

```
eval/
  run.mjs                        lane runner; exit 1 on any FAIL
  snapshot-skills.mjs            refresh the competing-skill descriptions
  lib/steering.mjs               BM25 + persona-directive ranking model
  cases/tool-selection.json      12 prompts (P1-P6 verbatim, A1-A5 adversarial)
  cases/discovery.json           14 discovery/sandbox cases
  fixtures/skill-descriptions.json  snapshot of competing SKILL.md text
```

Cases are data. Adding a prompt means editing JSON, not code. Each case
carries `why` / `note` / `raj_result` so a future reader knows which real
failure it descends from.

## Relationship to the other suites

| Suite | Layer | Command |
|---|---|---|
| `tests/unit/doc-tooling-steering.test.ts` | 14 unit assertions on the fix | `pnpm test` |
| `harness/run.ts` | handler capability, JUnit | `pnpm harness:ci` |
| `skills/laptop/evidence/2026-08-20-raj-prompt-replay/` | end-to-end replay, 7/7 | `node …/replay-raj-prompts.mjs` |
| **this pipeline** | **selection + discovery** | `pnpm eval` |

Run all four before shipping a build to the Ministry. None of them replaces
an in-app LLM run on the pilot laptop.
