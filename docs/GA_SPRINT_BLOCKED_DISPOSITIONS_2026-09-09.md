# GA closure sprint — criterion-by-criterion disposition, 2026-09-09

Reconciled against the **live** Plane board (33 sprint cards read from the API, not the snapshot) after the executable slices for this pass were completed. Current outcome and evidence stay in [COMPLETION_PLAN.md](COMPLETION_PLAN.md); this file exists so every remaining slice has a named dependency, owner and exact resume action in one place instead of being re-derived each tick.

**GA is RED.** Nothing here is a release verdict, and no card was promoted to Ready.

## Executable slices completed this pass

| Card | Slice | Result | Evidence |
|---|---|---|---|
| CLWX-119 | Promote the volatile per-run eval artifacts and the four-run zero-flip comparison; disposition the manifest link | **VERIFIED** — four runs parsed and diffed per row: 16 pass / 1 fail / 1 skip in each, **zero flips**; the two non-pass rows are stable and typed, routed to CLWX-123 and CLWX-61; 436-link sweep found the run-2 reference resolving correctly | [Promoted record](evidence/CLWX-119_EVAL_REPEAT_RUNS_2026-09-07.md), Plane `72bab7b8` |
| CLWX-110 | Pilot distribution checklist plus the revised-schedule note, drafted and held | **VERIFIED (held, nothing dispatched)** — held note with no date/version/identifiers, 10-row checklist with per-row owner and state, 13-step per-laptop onboarding | [Held draft](CLWX-110_PILOT_DISTRIBUTION_DRAFT_2026-09-09.md), Plane `55d87dde` |
| CLWX-120, 102, 130, 77, 63, 106 | Independent review / analysis slices | Dispatched to independent Claude/Bedrock lanes in owned worktrees; outcomes recorded on each card as they land | Lane reports on the owning cards |

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

## Standing rules that survive this pass

- Source, package, installed, live-account and external-tester evidence never substitute for one another. A green source suite has now twice failed to predict an installed startup failure.
- Required fail, skip, block or missing is never green. Unknown is NOT_RUN or BLOCKED, never PASS.
- The agent ceiling is Ready; only a human closes Done. Neither state is a GA verdict.
- One VM operator at a time; the lease is part of the receipt for any VM step.
- Owner holds in force: the macOS Electron/Keychain hold, and no account resets, credential-history reopening or acceptance weakening to obtain green.
