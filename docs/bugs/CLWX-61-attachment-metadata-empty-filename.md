# CLWX-61 — attachment extraction fabricates an empty-filename entry

## Identity and impact

- Reported/last verified: 2026-09-09, discovered by the CLWX-61 authoring lane while writing the DOM-fixture unit pin; independently reproduced by the suite's own assertion at author time. The pin is independently approved (`cd88a205`); the repair (`2b5646a5`) is under independent review.
- Owning card: [CLWX-61](../plane-board/CLWX-board.md) (Outlook eval gaps — attachment metadata is its W3.2/W8.4 subject). Related: CLWX-136 (candidate), CLWX-119 (per-run eval evidence showing W8.4 skipping in all four runs).
- Severity: medium as a data-quality defect; **safety-adjacent** because the fabricated entry can be handed to `download_attachment`, which is a confirmation-gated action. No authorization bypass is claimed or observed: the confirm gate is unchanged and still refuses without `confirm:true`.
- Status: **reproduced at source, repaired at source, repair under independent review.** Remaining gates: completion of that review, then the installed and live-account legs that CLWX-61 already owns.
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
| 2026-09-09, `c0437a97` then `cd88a205` | `tests/unit/outlook-attachment-metadata.test.ts` | The defect was first encoded as an `it.fails` row; review showed that could not distinguish this defect from a different fabrication, so it became an exact pin on the defective output, which the repair then inverted | The original `it.fails` form proved nothing beyond "something threw" |
| 2026-09-09 | Author and reviewer mutation runs, production file restored each time | Fail-open push, empty→undefined, selector widening, size-multiplier drift and a disabled chip loop were each caught. A reviewer-added mutant substituting a default name initially passed the whole suite, which is what forced the exact pin | The mutation set is synthetic: it proves the suite discriminates, not that the mail client renders such a label |

Execution path: `readEmail` (`outlook-actions.ts:792-853`) passes a page-side script string to `page.evaluate`; the chip block at `:828-838` builds each entry, with inline `parseSize` at `:839-845` and `guessMime` at `:846-850`; the result is assembled at `:862-871`. `listAttachments` (`:1105-1125`) is a thin wrapper and inherits the same output.

## Confirmed cause versus hypotheses

**Confirmed:** the regex permits a whitespace-only capture and the push is not guarded on a non-empty filename. Both facts are readable at the cited lines and the behaviour is reproduced by assertion.

**Hypotheses, explicitly unproven:**

- That Outlook actually renders a chip label with an empty filename. No live evidence exists; the defect is currently reachable only through a synthetic fixture. It is a latent robustness defect, not an observed field failure.
- Two related observations from the same lane, neither pinned nor confirmed: a filename containing a comma (`Budget, Q3.xlsx`) is truncated at the first comma because `.+?` stops there even when no size follows; and because the parser is unanchored and the chip query is document-wide, a label such as `Attachment options` elsewhere on the page could produce an entry named `options`. Neither has live evidence.

## Confirmed impact on the gated retrieval path

Established while authoring the repair, and material to the severity: an entry with an empty filename would have **satisfied** the attachment-retrieval existence check. `downloadAttachment` resolves the requested name against chip labels with `label.includes(<filename>)` (`electron/services/outlook-browser-v2/outlook-actions.ts:1195`), and `includes('')` is always true, so a fabricated empty-filename entry would have matched the first chip rather than being rejected as unknown.

This does **not** mean an unauthorised retrieval could occur: the confirmation gate is a separate mechanism, is unchanged by this defect and by its repair, and still refuses without explicit `confirm:true`. The consequence is that a nameless fabricated entry could be resolved to the wrong real attachment inside an otherwise authorised request, which is a correctness and trust problem rather than an authorization bypass. Recorded so the severity is neither inflated nor understated.

## Attempted changes and outcomes

The authoring lane deliberately did **not** touch production inside the test-only slice, which was correct scope discipline; the repair was then authored as its own slice once the pin was approved. No workaround, no swallowed error, no loosened assertion at any point.

## Repair chosen, and why

Two options existed: require a non-whitespace capture (`(\S.*?)`), or guard the push on a non-empty trimmed filename. **The guard was chosen** (`if (!filename) continue;`, with a comment stating the invariant), leaving the shared regex byte-identical. Reasoning recorded by the author: the guard states the invariant directly (no entry without a name), holds however the label grammar evolves, and keeps every existing matching pin valid without re-derivation, whereas altering the shared capture changes backtracking for all label shapes while protecting only this one.

## Tests and validation

At the repair (`2b5646a5`): suite **33 passed (33)**; with five adjacent Outlook suites **Test Files 6 passed, Tests 176 passed (176)**; eslint exit 0 on both changed files; `pnpm typecheck` exit 0 — which covers the production edit only, because no TypeScript project in this repository includes `tests/`.

Mutation evidence in both directions: with the repair in place plus a placeholder default (`.trim() || 'untitled'`), two rows fail (the inverted pin and the placeholder guard); with the repair reverted, the same two rows fail. So the suite catches the original defect, any substituted default name, and an over-aggressive guard that drops a valid chip.

Earlier stages, retained: at `c0437a97` the suite ran 31 passed with 1 expected fail; at `cd88a205` it ran 32 passed.

## Owner, revisions, blockers and next exact action

- Owner: GA lead (routing), with the source repair to be authored in a bounded lane and independently reviewed. Author never approves their own change.
- Revisions: defect at `0f708082` and earlier; pin `c0437a97`, pin correction `cd88a205` (both independently approved), repair `2b5646a5` (under review) — all on `fix/clwx61-attachment-metadata-pin`, worktree `/private/tmp/clawx-clwx61-attachment-pin-20260909`. Not pushed.
- Blockers: none for the source fix. CLWX-61's own remaining acceptance is blocked separately — one seeded attachment-bearing mail is an external account-holder action, and the live confirm-leg runs need the installed candidate (blocked with CLWX-136).
- **Repair authored at `2b5646a5`** (on top of the approved pin `cd88a205`, same branch, not pushed): the push is guarded with `if (!filename) continue;` and a comment stating the invariant, leaving the shared regex byte-identical. The author chose the guard over a `(\S.*?)` capture deliberately — it states the invariant directly, survives changes to the label grammar, and keeps every existing matching pin valid without re-derivation. The pin row is inverted to expect no entry, now with a valid chip beside the malformed one so it also fails if the guard over-drops, and a new row asserts every emitted filename is a substring of some chip label so any future default name is caught whatever it is called. Both directions demonstrated by mutation: with the fix plus a placeholder default, two rows fail; with the fix reverted, the same two rows fail. Verbatim: 33 passed in the suite, 176 passed across six Outlook suites, eslint exit 0, typecheck exit 0 for the production edit. Independent review of `2b5646a5` is in progress.
- **Comma-in-filename: deliberately not repaired,** with the reasoning recorded rather than left undecided. The `(?:,|$)` terminator is what allows trailing fields after the size; a comma-tolerant capture would trade that away, and there is no live label evidence for which grammar the tenant renders. A truncated name is still a substring of the chip label, so retrieval still resolves it — a fidelity limitation, not a fabrication. Not pinned in either direction.
- **Next exact action:** complete the independent review of `2b5646a5`. The `it.fails` question is settled: an independent reviewer demonstrated that it could not distinguish this defect from a different fabrication on the same path, so it was replaced with an exact pin, which is now inverted by the repair. Do not fold this into the installed acceptance run; it is source work and proceeded while the VM lane was blocked.
