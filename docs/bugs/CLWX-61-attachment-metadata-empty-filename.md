# CLWX-61 — attachment extraction fabricates an empty-filename entry

## Identity and impact

- Reported/last verified: 2026-09-09, discovered by the CLWX-61 authoring lane while writing the DOM-fixture unit pin; independently reproduced by the suite's own assertion at author time. Independent review of the pin is in progress.
- Owning card: [CLWX-61](../plane-board/CLWX-board.md) (Outlook eval gaps — attachment metadata is its W3.2/W8.4 subject). Related: CLWX-136 (candidate), CLWX-119 (per-run eval evidence showing W8.4 skipping in all four runs).
- Severity: medium as a data-quality defect; **safety-adjacent** because the fabricated entry can be handed to `download_attachment`, which is a confirmation-gated action. No authorization bypass is claimed or observed: the confirm gate is unchanged and still refuses without `confirm:true`.
- Status: **reproduced at source**; no fix attempted. Remaining gates: source repair with a regression, independent review, then the installed and live-account legs that CLWX-61 already owns.
- Environment: source only. Revision `0f708082c941fbed007173c57232aec916f4eff1` (moe.29 candidate base), file `electron/services/outlook-browser-v2/outlook-actions.ts`. No VM, no installed artifact, no live mailbox involved. Node/vitest on macOS. **Not observed on an installed build** — do not infer installed behaviour from this record.
- Known working baseline: none. The defect appears to predate the candidate; no revision is known to be free of it.

## Reproduction and expected result

1. Prerequisites: none beyond the unit suite. No user state changes, no network, no mailbox.
2. Input: a reading-pane attachment chip whose accessible label is `Attached file: ` — the separator followed only by whitespace, with no filename after it.
3. Observed: `readEmail` returns an attachments array containing one fabricated entry, `{ filename: '', sizeBytes: undefined, mimeType: undefined }`.

Expected observable result: no entry at all (an empty array), because there is no attachment to describe. Frequency: deterministic, every run; pinned by one assertion in `tests/unit/outlook-attachment-metadata.test.ts`.

## Evidence and execution path

| Timestamp / revision | Evidence locator | Observation | What it does not prove |
|---|---|---|---|
| 2026-09-09, `0f708082` | `electron/services/outlook-browser-v2/outlook-actions.ts:832-836` | The chip regex `/(?:Attached file\|Attachment)[:\s]+(.+?)(?:,\s*([\d.]+\s*[KMG]?B))?(?:,\|$)/i` lets `[:\s]+` give back its trailing space, so `.+?` matches a lone space; `.trim()` then yields `''` and the push is unguarded | Says nothing about installed behaviour or whether Outlook ever renders such a label |
| 2026-09-09, `c0437a97` | `tests/unit/outlook-attachment-metadata.test.ts` (`it.fails` row) | The assertion runs and currently documents the defective output; it is expected to turn red when the regex or the push guard is repaired | Not a skip, but see the review question below |
| 2026-09-09 | Author mutation runs (5 mutants, production file restored each time) | Fail-open push, empty→undefined, selector widening, KB multiplier drift and a disabled chip loop were each caught by the suite | Does not establish that the empty-filename case itself is caught by anything other than the `it.fails` row |

Execution path: `readEmail` (`outlook-actions.ts:792-853`) passes a page-side script string to `page.evaluate`; the chip block at `:828-838` builds each entry, with inline `parseSize` at `:839-845` and `guessMime` at `:846-850`; the result is assembled at `:862-871`. `listAttachments` (`:1105-1125`) is a thin wrapper and inherits the same output.

## Confirmed cause versus hypotheses

**Confirmed:** the regex permits a whitespace-only capture and the push is not guarded on a non-empty filename. Both facts are readable at the cited lines and the behaviour is reproduced by assertion.

**Hypotheses, explicitly unproven:**

- That Outlook actually renders a chip label with an empty filename. No live evidence exists; the defect is currently reachable only through a synthetic fixture. It is a latent robustness defect, not an observed field failure.
- Two related observations from the same lane, neither pinned nor confirmed: a filename containing a comma (`Budget, Q3.xlsx`) is truncated at the first comma because `.+?` stops there even when no size follows; and because the parser is unanchored and the chip query is document-wide, a label such as `Attachment options` elsewhere on the page could produce an entry named `options`. Neither has live evidence.

## Attempted changes and outcomes

None. The authoring lane deliberately did not fix production code inside a test-only slice, which is correct scope discipline. No workaround, no swallowed error, no loosened assertion.

## Fix options for the owner

1. Require a non-whitespace filename in the capture, e.g. `(\S.*?)` instead of `(.+?)`.
2. Guard the push on `filename.length > 0` after trimming.

Either fix must also decide the comma-in-filename behaviour deliberately rather than by accident, and must keep the `it.fails` row honest — when the defect is fixed that row turns red and must be promoted to a normal passing expectation in the same change.

## Tests and validation

- `pnpm vitest run tests/unit/outlook-attachment-metadata.test.ts` → 31 passed, 1 expected fail (32).
- With five adjacent Outlook suites → Test Files 6 passed, Tests 174 passed, 1 expected fail (175).
- `pnpm typecheck` exit 0; `pnpm lint:check` 0 errors, 43 pre-existing warnings, none in the new file.

## Owner, revisions, blockers and next exact action

- Owner: GA lead (routing), with the source repair to be authored in a bounded lane and independently reviewed. Author never approves their own change.
- Revisions: defect at `0f708082` and earlier; pin at `c0437a97` on `fix/clwx61-attachment-metadata-pin`, worktree `/private/tmp/clawx-clwx61-attachment-pin-20260909`. Not pushed.
- Blockers: none for the source fix. CLWX-61's own remaining acceptance is blocked separately — one seeded attachment-bearing mail is an external account-holder action, and the live confirm-leg runs need the installed candidate (blocked with CLWX-136).
- **Next exact action:** await the independent review of `c0437a97`, including its explicit judgement on whether `it.fails` is an acceptable known-defect pin here. Then author the one-line regex or guard fix with a normal regression row replacing the `it.fails` row, and review it independently. Do not fold this into the installed acceptance run; it is source work and can proceed while the VM lane is blocked.
