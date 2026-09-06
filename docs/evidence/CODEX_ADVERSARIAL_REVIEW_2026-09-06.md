# Codex cross-model adversarial review — first live run (2026-09-06)

Owner directive 2026-09-06: wire `/codex:adversarial-review` (plugin
`codex@openai-codex` v1.0.6, local Codex CLI 0.153.4, API-key auth) into the
separate-lane review protocol as a REAL cross-model adversary lens, and prove
it on a recent CLWX change. Protocol wiring: `.claude/skills/ga-sprint-driver/SKILL.md`
§3b; surface row: `docs/AGENT_SKILL_INTEROPERABILITY.md` (dev-tooling layer);
adoption record: `docs/PLUGIN_INTEGRATION_PLAN_2026-09-03.md` §1.

## Preflight

`codex-companion.mjs setup --json` → `ready: true` (node v26.7.0, codex-cli
0.153.4 "advanced runtime available", auth apiKey, direct session runtime).

## Invocation

Headless equivalent of `/codex:adversarial-review --wait`, scoped
`--base b6c990ae --scope branch` (the CLWX-83 test-infra batch, 15 files /
+692), with focus text naming the three riskiest assumptions (execArgv reach,
pwsh-lint fail-open paths, model-pin parser blind spots). Codex ran three
parallel review subagents, read the real diff, and executed live probes
(`pnpm lint:ps`, targeted vitest, doctor CLI fixtures) before rendering.

## Verdict (verbatim summary)

> **Verdict: needs-attention**
> No-ship: CLWX-83 adds tooling, but the new gates are not on the release
> path and there are still defensible false-green paths for model pins,
> PowerShell linting, and the heap fix proof.

Findings (5): full text preserved in the session transcript; dispositions
below quote the load-bearing claim of each.

## Findings × disposition (all triaged same tick, per protocol §3b)

| # | Sev | Finding (Codex) | Verified | Disposition |
|---|---|---|---|---|
| 1 | high | `lint:ps` + `doctor:agents` absent from `preflight`, GA T0, and PR CI — fail-open-by-omission on the release path | CONFIRMED (package.json:79, ga-gate.mjs T0) | FIXED: both wired into `preflight` and ga-gate T0. PR CI residual: unit guard already runs via `pnpm test`; `lint:ps` CI step needs a PSScriptAnalyzer install step — named on CLWX-83 for the next CI pass |
| 2 | high | Unknown ACTIVE user-config pins pass by default (`gpt-5.55-typo` proven clean without `--strict`) — the next spark class | CONFIRMED (reproduced) | FIXED: active pins outside the allowlist now FAIL by default; pins inside dead legacy `[profiles.*]` tables stay WARN (recorded owner fleet call). First live run then caught REAL drift: top-level `gpt-5.6-sol` — verified live (`codex exec` ok) and allowlisted |
| 3 | high | Parser bypasses: `model = "x" # """` skipped as multiline-open; duplicate frontmatter `model:` keys audit first-match-only | CONFIRMED (both reproduced) | FIXED: quote-aware comment strip before delimiter counting; `parseAgentMdModelPins` collects all keys, duplicates fail; 3 regression fixtures added (fail with fix stashed — proven) |
| 4 | medium | Non-terminating PSScriptAnalyzer errors bypass the try/catch while JSON still lands — partial-analysis false GREEN | CONFIRMED (code path) | FIXED: `$ErrorActionPreference='Stop'` + `-ErrorAction Stop` on the analyzer call; live run re-verified GREEN (130 findings / 0 gating, unchanged) |
| 5 | medium | Heap-bound worker proof was ad hoc, not committed — a future execArgv regression (the exact Vitest-4 class) would be silent | CONFIRMED (no committed probe existed) | FIXED: `tests/unit/clwx83-vitest-heap-execargv.test.ts` asserts the flag in `process.execArgv` AND the effective heap limit, inside a forked worker, on every `pnpm test` |

## Assessment of the lens

Genuine cross-model value on its first run: findings 2 and 3 were
mechanically demonstrated by Codex itself against code that had already
passed a 3-lens Claude review (2 FAIL + 1 PASS-with-MAJOR, all MAJORs fixed)
— these are guard-integrity gaps the same-family lenses missed. No gate was
loosened; the Codex lens is additive per protocol (a Codex PASS never
overrides a Claude-lens FAIL). Plugin-plan §1.4 acceptance ("catches or
corroborates a real issue") is met.
