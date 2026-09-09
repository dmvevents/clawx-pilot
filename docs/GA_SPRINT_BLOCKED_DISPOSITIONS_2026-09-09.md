# GA closure sprint — criterion-by-criterion disposition, 2026-09-09

Reconciled against the **live** Plane board (33 sprint cards read from the API, not the snapshot) after the executable slices for this pass were completed. Current outcome and evidence stay in [COMPLETION_PLAN.md](COMPLETION_PLAN.md); this file exists so every remaining slice has a named dependency, owner and exact resume action in one place instead of being re-derived each tick.

**GA is RED.** Nothing here is a release verdict, and no card was promoted to Ready.

## Executable slices completed this pass

| Card | Slice | Result | Evidence |
|---|---|---|---|
| CLWX-119 | Promote the volatile per-run eval artifacts and the four-run zero-flip comparison; disposition the manifest link | **VERIFIED** — four runs parsed and diffed per row: 16 pass / 1 fail / 1 skip in each, **zero flips**; the two non-pass rows are stable and typed, routed to CLWX-123 and CLWX-61; 436-link sweep found the run-2 reference resolving correctly | [Promoted record](evidence/CLWX-119_EVAL_REPEAT_RUNS_2026-09-07.md), Plane `72bab7b8` |
| CLWX-110 | Pilot distribution checklist plus the revised-schedule note, drafted and held | **VERIFIED (held, nothing dispatched)** — held note with no date/version/identifiers, 10-row checklist with per-row owner and state, 13-step per-laptop onboarding | [Held draft](CLWX-110_PILOT_DISTRIBUTION_DRAFT_2026-09-09.md), Plane `55d87dde` |
| CLWX-120, 102, 130, 77, 63, 106 | Independent review / analysis slices | Dispatched to independent Claude/Bedrock lanes in owned worktrees; outcomes recorded on each card as they land | Lane reports on the owning cards |

## Independent review-lane outcomes, same pass

All lanes were Claude on Bedrock, read-only unless stated, in owned worktrees. Codex was **not** invoked: no selected acceptance required a cross-model lane, and the owner's recorded cost preference is Claude on Bedrock. The plugin remains available if a future slice assigns it.

| Card | Verdict | Substance |
|---|---|---|
| CLWX-120 | **APPROVE** | Grading byte-identical to the audited commit at candidate HEAD; typed refusal originates at exactly one site after a successful click; fail-closed on absent reason, `not_in_list`, non-ok status and missing array; **no laundering path** — an unrendered pane returns true so it cannot buy a skip, and a systematic locate defect would still fail six sibling rows. 63/63 and 102/102 green |
| CLWX-77 | **APPROVE** | Rows now grade on content, not file existence; every deleted line was a replacement by a stronger assertion; negative controls proven to fail against **real** doc-tools, not just synthetic objects (PNG-as-jpg, truncated JPEG, dropped formula cache, damaged docx, number-coerced `0412`); no new scaffold; no placeholders; 122 tests green, typecheck exit 0 |
| CLWX-106 | **APPROVE** | 17 required criteria must each have an exact PASS row; `GA_GATE_STATIC=1` is explicit-only and is *not* a release escape; the release path re-derives the verdict and requires exit-0 logs, 24h freshness, candidate-digest binding and staged-bytes equality; publication is gated before any artifact upload; identity is fail-closed in three layers, exercised against fixtures. **No false-green construction reached a release PASS.** 199/199 green |
| CLWX-63 | **APPROVE** after correction | Two overclaims found and fixed at `b5ef0e57`: the single dev-tree sandbox form run is now named with its date and account class and marked NOT_RUN for tenant and installed builds, and the adapter is reframed as a pattern with the nine-route/no-file-tool fact. Reviewer re-checked the diff, not the paraphrase |
| CLWX-130 | **REQUEST_CHANGES** | Five prior findings genuinely resolved, but **two new fail-opens reproduced by execution**: (A) `startsWith(homedir)` without a separator boundary lets `C:\Users\Teacher2` match home `C:\Users\Teacher`, classifying another user's Chrome as ours; (B) the attach gate allows on `no_listener` without probing HTTP while `diagnoseChromeCdp` calls the same evidence unverified, and `-ErrorAction SilentlyContinue` makes cmdlet failure indistinguishable from "no rows". Fix lane in progress |
| CLWX-102 | Analysis delivered | The second recurrence is a **different mechanism** from the first: Electron Helper processes checking in with LaunchServices as GUI applications during the provider-lifecycle specs. Lead verified the decisive link in shipped bytes (below). Guard author lane in progress |

### Lead verification and decisions arising from the lanes

- **Cross-class link verified, not assumed.** In the extracted moe.29 package, `doctor-completion-CtrQMyqI.js:40` starts `process.execPath` with `env = { ...process.env }`, **57** dist files reference `process.execPath`, and **no file in the shipped OpenClaw dist sets `ELECTRON_RUN_AS_NODE`** — every execPath child depends entirely on the inherited environment. That is direct evidence the CLWX-136 in-process shim covers the whole class, including the CLWX-102 mechanism. Recorded on both cards as a strong source-traceable expectation, not proof; confirmation needs the provider-lifecycle specs on a shim-bearing build in a safe isolated GUI environment.
- **E2E test-seam defect confirmed at the candidate.** `onlyIfRunning` exists and is honoured in `provider-runtime-sync.ts`, and one call site passes it while the provider-delete restart path does not — so deleting a provider can restart a stopped gateway, which in E2E boots a real OpenClaw. A guard author lane is implementing a typed fail-closed refusal at the three entry points that can start a real OpenClaw process.
- **Decision on the CLWX-120 residual.** Other id-scoped rows (W8.4, W8.2, W5.1, W6.1, W3.1) still charge a guard refusal as FAIL rather than consulting the typed reason. **Leave as is.** The current behaviour errs toward FAIL, and extending a skip path widens the laundering surface for no acceptance gain; if a guard refusal ever lands on one of those rows the right response is to investigate that row, not to teach it to skip. Recorded so the asymmetry is deliberate rather than forgotten.
- **CLWX-106 follow-up A recorded, not expanded.** The consumer's running-app-version and both-hop-hash mismatch branches have no pinned unit test; the code is correct today (proved by probe) but could regress silently. Owner: GA lead. This is prevention rather than required acceptance, so it is logged here instead of being pulled into this pass.
- **CLWX-61 acceptance-honesty finding.** W3.2 returns `ok: true` with a "metadata leg UNEXERCISED" note when no attachment-bearing mail is seeded, so the 18-row pass count over-reads until the seed exists. Recorded on CLWX-61; an author lane is writing the DOM-fixture unit pin that gives the extraction coverage independent of the live seed.

## Blocked slices — dependency, owner, exact resume action

Ordered by what unblocks the most. Everything in the first group waits on one thing: an interactive standard-user desktop on the QA machine, which the 03:29:42 UTC system reboot destroyed.

### Group 1 — waits on installed acceptance of the moe.29 candidate

| Card | Unmet criterion | Dependency | Owner | Exact resume action |
|---|---|---|---|---|
| CLWX-136 | Installed startup with an existing state database reaching Gateway readiness, no second GUI instance; ordinary chat; doctor-repair path | Interactive `ClawXFresh0908` desktop session (operator-held password; three lanes probed and recorded) | GA lead | Start the already-staged `ClawXMoe29InstallAssisted` task; nothing needs rebuilding, re-downloading or re-reviewing |
| CLWX-125 | Existing/fresh/next Online turn each answering once with 30s terminal observation; cancel during preparation and generation; one controlled fault then recovery; no silent replay; cold and warm timestamps | CLWX-136 startup | GA lead | Run the fault/cancel matrix on the accepted artifact immediately after startup passes |
| CLWX-94 | A vanished-context run is never re-submitted as a new user turn under the churn recipe | CLWX-125 matrix row | GA lead | Execute as a row inside the 125 matrix; do not schedule separately |
| CLWX-95 | Interrupted turn resumes exactly once or terminates visibly; never an indefinite spinner | CLWX-125 matrix row | GA lead | Same matrix run |
| CLWX-96 | Installed fault row: post-restore Online recovery and visible cancel | CLWX-125 | GA lead | Source is PASS_SOURCE with 145 focused passes; only the installed row remains |
| CLWX-117 | Installed on-device answer with no top-level `sessions_yield`; stalled loop terminates visibly | CLWX-136 startup, local model present | GA lead | Run the on-device prompt on the accepted artifact with the local model available |
| CLWX-26 | Packaged offline run: network blocked, on-device channel, local document read and grounded answer, zero non-loopback egress, guard negative control | CLWX-117 | GA lead | One receipt also satisfies CLWX-113; annotate rather than re-run |
| CLWX-24 | Live in-app P1–P5 plus folder discovery on the installed candidate; `document.*` tool trace every time; OneDrive-redirected Desktop; complete obligation recall | CLWX-77, CLWX-115, installed candidate | GA lead | Run the document journeys on the accepted artifact |
| CLWX-114 | Two consecutive in-app file enumerations with exact set equality, or a dated CANNOT-REPRO disposition | CLWX-77 fixtures, installed candidate | GA lead | Run twice against the seeded manifest on the accepted artifact |
| CLWX-115 | Installed overlapping-name meal/shirt journey reviewed fact-by-fact | Installed candidate | GA lead | Source fixture is approved and integrated; only the installed rerun remains |
| CLWX-131 | Installed unaided rerun returns actual Main-owned Graph status with no fictional config probing and no auth side effects | Installed candidate | GA lead | Ask the Graph capability question on the accepted artifact |
| CLWX-118 | Installed browser regression preserves principal-owned tabs and sign-in redirects | CLWX-130 review, CLWX-121, installed candidate | GA lead | Run the tab-ownership regression on the accepted artifact after 130 lands |
| CLWX-43 | Five matched cold plus five warm samples; p50/p90 against an explicitly recorded budget | CLWX-125, **plus an owner budget decision** | GA lead + owner | Owner records the budget disposition (30s versus 45s is not the agent's call); then measure on the accepted artifact |
| CLWX-107 | One continuous timed rehearsal of all three demo moments; runbook committed; two backstop clips staged | CLWX-125, CLWX-24 | GA lead + owner | Rehearse on the accepted candidate, machine and account |
| CLWX-133 | One continuous release run with strict required-evidence verdict | Everything above | GA lead | Execute after installed, client, tenant and tester evidence exists |

### Group 2 — waits on an external party, not on us

| Card | Unmet criterion | Dependency | Owner | Exact resume action |
|---|---|---|---|---|
| CLWX-25 | Assisted install on a Windows 10/11 client as standard user; unprovisioned first-run state; documented provisioning path | **No Windows 10/11 machine available.** The only known one is off-network (real SSH handshake timed out); the GCP lane is Server 2022 only | Ministry (hardware) or owner | Obtain a Win10/11 client at principal specification, then run the assisted install and first-run checks |
| CLWX-39 | Approved tenant/client configuration, account-holder sign-in, token and Graph read | Tenant configuration and consent; interactive account holder | Ministry ICT + owner | Source is approved and integrated; needs the account holder to sign in on a configured tenant |
| CLWX-40 | Graph transport matrix on a Chrome-less install with account-holder sign-in | CLWX-39 | Ministry ICT + owner | Run after 39; redirect URIs still outstanding |
| CLWX-61 | Confirm-leg attachment retrieval, and two live runs | **One seeded attachment-bearing mail** (account-holder action, not code) plus CLWX-123 | Owner/account holder | Seed the mail, then run the confirm leg twice; the authored DOM-fixture pin is separately reviewable |
| CLWX-63 | Live extraction to prefill on the Suspensions clone, ≤3 field misses, gate holds, form left unsubmitted | Installed candidate plus live tenant form access | GA lead + Ministry | Study re-review is in a lane now; the product chain needs installed plus live access |
| CLWX-123 | Installed W4.1 and W4.4 pass with an authenticated user | Installed candidate plus live account | GA lead | The stable W4.1 failure is now pinned per-run by the CLWX-119 comparison; verify the fix on the artifact |
| CLWX-134 | Unaided principal completes the guide on their own Microsoft account, including expired-sign-in and wrong-account recovery | Verified candidate plus **Karunesh's availability** | Owner | Hand over the accepted artifact and guide; he was told to wait for the fix |
| CLWX-110 | Rows 1, 3, 4, 5, 6, 8, 9, 10 of the distribution checklist | Verified candidate, roster, owner decisions | Owner + pilot coordinator | Draft is held; fill and deliver only on explicit approval after the verdict |

### Group 3 — waits on a decision or another card's output, no external party

| Card | Unmet criterion | Dependency | Owner | Exact resume action |
|---|---|---|---|---|
| CLWX-102 | Complete the required UI-suite criteria in a safe isolated GUI environment | A safe GUI environment away from the owner desktop; owner hold stands | GA lead + owner | Analysis lane is running; then choose the isolation path it recommends |
| CLWX-122 | Principal-readable footer with no port or pid; component and E2E proof; independent review | CLWX-102 must first provide a safe validation path | GA lead | Edits are preserved; resume only after 102 yields the path |
| CLWX-121 | Cross-tab draft visibility, landing with the coupled browser-ownership work | CLWX-130 | GA lead | No separate implementation lane; rides 130 |
| CLWX-77 | Packaged-runtime execution rows | Installed candidate | GA lead | Review lane covers the fixture/grading slice now; execution needs the artifact |
| CLWX-22 | All seven pilot acceptance groups recorded with a final strict verdict | Every card above | GA lead + human | Anchor card; record the verdict once evidence exists. Human closes Done |
| CLWX-135 | Nothing outstanding beyond confirming the repair holds on the next installed run | CLWX-136 install | GA lead | The installer repair already passed 11 native scenarios and 93 assertions; confirm on the moe.29 install |

## Fix rounds arising from the reviews

| Card | Fix | Status |
|---|---|---|
| CLWX-130 | `75a40554` on `lane/browser-regression-20260908` (parent `41359e12`). Defect A: `commandUsesUserOwnedProfileDir` now uses a real containment check (`isPathWithinDir`, `chrome-cdp.ts:699-729`) with slash and `..` normalisation, Windows lowercasing and trailing-separator handling, so `C:\Users\Teacher2` no longer matches home `C:\Users\Teacher`. Defect B: on `no_listener` the gate probes `/json/version` (`:1006-1017`, `endpointAnswersHttp` at `:332-341`) and refuses if anything answers, and the inline PowerShell now runs under `-ErrorAction Stop` with only ObjectNotFound reaching `no_listener` and anything else mapped to unverified. The row that previously pinned the fail-open was corrected in place, not deleted | Resolution verification requested from the lane that found the defects. **Lead independently confirmed the safety-critical half**: `defaultFetchJson` (`:293-309`) returns `{ok:false,status:500}` rather than throwing, so an HTTP 500 counts as answering and the gate refuses — the exact trap the author reported falling into on a first attempt using `probeVersion` |
| CLWX-61 | `c0437a97` pin reviewed: **REQUEST_CHANGES, narrow.** The reviewer independently reproduced the author's mutants and confirmed the fake page evaluates the real production script, then found a blind spot the author had not tested: a placeholder-filename regression (`.trim() \|\| 'untitled'`) leaves the **entire suite green**, because `it.fails` only asserts that a row throws for some reason and cannot distinguish the known empty-filename defect from a different fabrication on the same path into the gated retrieval action | Author asked to replace the `it.fails` row with an explicit equality pin on the current defective output (red on the real fix *and* on any other fabrication) and to correct one over-claiming comment. Test-file edits only |

### Verified evidence-quality caveat: `pnpm typecheck` does not cover `tests/`

Raised by the CLWX-61 reviewer and **verified by the lead against the configs**: the three TypeScript projects include `src` (`tsconfig.json:30`), `electron` plus `vite.config.ts` (`tsconfig.node.json:30`, which `tsconfig.electron-typecheck.json` extends) and `scripts/**/*.ts`. No project includes `tests/`, and vitest strips types at run time. Therefore **"pnpm typecheck exit 0" says nothing about any test file**, in this pass or any earlier one. Running `tsc` directly over a test file surfaces errors from an inherited pattern where test helpers redeclare private members — the existing safety suite shows hundreds of the same kind — so this is a long-standing repository convention rather than new debt from any commit reviewed here. It also explains the editor diagnostics that appeared throughout this pass for `@electron/...` imports inside test files across several lanes.

Consequence for how lane evidence is read: for a **test-only** change, the meaningful evidence is the focused suite result plus mutation proof, not the typecheck line. Recorded as prevention, owner GA lead: adding a tests-scoped project would make the claim honest, but that is new scope and was not taken in this pass.

## Standing rules that survive this pass

- Source, package, installed, live-account and external-tester evidence never substitute for one another. A green source suite has now twice failed to predict an installed startup failure.
- Required fail, skip, block or missing is never green. Unknown is NOT_RUN or BLOCKED, never PASS.
- The agent ceiling is Ready; only a human closes Done. Neither state is a GA verdict.
- One VM operator at a time; the lease is part of the receipt for any VM step.
- Owner holds in force: the macOS Electron/Keychain hold, and no account resets, credential-history reopening or acceptance weakening to obtain green.
