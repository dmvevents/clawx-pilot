# CLWX-115 — Association checker accepts semantically incorrect summaries

## Scope and reproduction

Found by an independent Claude tester on September 8, 2026, reviewing **unmerged source** `e12c150a` against `f93ac8b3`. Worktree `/private/tmp/clawx-w2-fidelity-20260908`; branch `lane/w2-fidelity-gate-20260908`. This is a defect in proposed source acceptance tooling, separate from the still-open installed document-fidelity journey on CLWX-115.

Using the faithful synthetic summary from `eval/fixtures/raj2-association-fidelity.json`, replace only the named sentence and run `checkAssociationFidelity` from `eval/lib/raj2-association-fidelity.mjs`:

| Mutation | Actual at e12c150a | Expected |
|---|---|---|
| `Anil Rampersad is attending and needs no meal or shirt.` | PASS with zero failures | FAIL: source states he is not attending |
| `Keisha Mohammed wants a small meal and a vegetarian shirt.` | PASS with zero failures | FAIL: shirt size and meal preference are bound to the wrong attributes |

All names/data above are synthetic fixture data. The reviewer ran 55 focused tests successfully before the adverse probes exposed these omissions: the existing green suite did not cover these realistic shapes.

## Confirmed cause

- Negation: `NEG_AFTER_WINDOW = 16` / `hasCueInWindow` can borrow `no` from the adjacent meal fact to negate `attending`; a stray preceding `not` also passes.
- Attribute binding: the cue check tests for `meal` or `shirt` anywhere in the person's sentence segment. Both cues exist even when each value is attached to the wrong attribute.
- Cross-person swap controls passed their negative checks; retain that behavior. The required gate row and scorecard failure propagation were independently verified.

Private full review and minimal reproductions: `artifacts/ga-fable-20260908/w2-review/result.md`. Source paths at the reviewed revision are `eval/lib/raj2-association-fidelity.mjs`, `eval/fixtures/raj2-association-fidelity.json`, `tests/unit/raj2-association-fidelity.test.ts`, `scripts/raj2-association-fidelity-gate.mjs`, `scripts/ga-gate.mjs`.

## Fix criteria and handoff

The `w2-fix` Claude lane owns the checker/fixture/test files. Add both exact mutations as expected failures before repairing cue/negation binding to the relevant fact/value. Preserve faithful wording and existing controls. Do not build a general natural-language parser or weaken the assertion to accept swapped meanings.

Run the focused fidelity and GA-verdict suites, the fixture runner, and focused lint. An independent delta reviewer must rerun these two probes and faithful controls. Record the fix SHA and results here and on CLWX-115. Until then, `e12c150a` is **REQUEST_CHANGES**, held outside the release candidate.

Installed-agent fidelity remains **NOT_RUN** regardless of source fixture success. The live `ga:gate` was deliberately not executed by these lanes because it can perform external actions. A suspected lockfile mismatch was disproved: 2026.4.23 was the separate WeCom plugin; actual OpenClaw is 2026.9.2. Do not reopen that dependency investigation.

## Second independent review — September 8, 12:19 UTC

Correction `2ee28efa` fixes both original false passes with clause-fenced negation and value-bound attribute cues. Independent review reran 58 tests and 11 fixture rows successfully, then reproduced `Anil Rampersad is attending with no meal or shirt.` returning PASS with zero failures; `despite` in place of `with` also passes. Source states he is not attending, so both must FAIL.

Confirmed mechanism: the after-value negation window crosses a prepositional connector and borrows `no` from the meal fact. Existing punctuation/conjunction fences do not block it. Private result: `artifacts/ga-fable-20260908/w2-delta-review/result.md`. Verdict remains REQUEST_CHANGES; `2ee28efa` is held outside the candidate.

The `w2-negation-finish` author owns only the checker, fixture and fidelity test: add exact failing controls, minimally repair fact binding, preserve prior corrections, then focused tests and independent delta review. No general-language-parser rewrite is required. Installed acceptance remains NOT_RUN.

## Third source checkpoint

`6ed95e828eca254d76c3e16eccce65cf26fa6ae0` adds the exact preposition controls. They failed against the prior checker (four unit failures and fixture exit 1), then passed after an after-window negation cue attached to another fact's noun stopped being credited backwards. Own-attribute negation and prior corrections are preserved. Author result: 60 focused tests and 12 fixture rows PASS, focused lint clean. Independent `w2-binding-review` is running; source remains held pending verdict. Private receipt: `artifacts/ga-fable-20260908/w2-negation-finish/result.md`.

Independent delta APPROVE is now recorded in `artifacts/ga-fable-20260908/w2-binding-review/result.json`. The full correction chain is integrated as `01a7fe08`, `6dae2e30`, `488ebe29`. One retained limitation was explicitly reproduced at both parent and correction: “Anil Rampersad is attending with no fuss” can still borrow the generic adjacent negation and falsely pass. This is outside the curated different-fact-noun controls; the fixture is not a general semantic validator. Installed acceptance must independently check every required source fact rather than treating the fixture result as proof of arbitrary generated text.
