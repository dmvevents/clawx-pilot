# CLWX-39 — Graph sign-in cancellation and reauthentication need terminal outcomes

## Identity and impact

September 8, 2026 source investigation prompted by the owner's unconfigured/unsigned-in Windows profile. These are source findings in the existing Graph setup feature, distinct from CLWX-131's agent diagnosis defect. No account-holder sign-in or cancellation has been reproduced on the VM in this workstream.

Base `f93ac8b3`; branch `lane/graph-connection-20260908`, worktree `/private/tmp/clawx-graph-connection-20260908`. The initial author stopped at its spending cap with uncommitted code/tests. The completion author committed `7a129570`; `graph-connection-review` now owns independent review. Never treat these changes as installed.

## Findings, reproduction and mechanism

| Finding | Reproduction / expected behavior | Source mechanism and confidence |
|---|---|---|
| OAuth denial can leave the app waiting | During an authorized sign-in, Microsoft returns an OAuth error such as `access_denied`; the app should promptly report cancellation/denial | In base `electron/utils/microsoft-graph-oauth.ts`, the callback sends HTTP 400 but does not resolve `waitForCode`; its polling window can run for ten minutes. Source-confirmed; live account NOT_RUN |
| Rejected refresh is an opaque failure | A synthetic token response has `invalid_grant` or `interaction_required`; the app should require account-holder sign-in instead of blind retry | Base `refreshMicrosoftGraphToken` throws generic error text; `manager.ts/getAccessToken` has no typed reauthentication translation. Source-confirmed; tenant policy behavior NOT_RUN |
| Unmerged callback repair accepts an error before checking OAuth state | Call the proposed `interpretOAuthCallback` with its callback path, `error=access_denied`, and missing/wrong state; it must refuse to end the current flow | Root inspected the first uncommitted repair: error handling preceded state validation and now recorded a terminal error. A different local request could cancel the flow. This does **not** establish token theft/account takeover. The completion lane was instructed to add a failing synthetic regression and validate state for both code and error callbacks |

The setup UI also needs to distinguish unconfigured, authenticating, cancelled, signed-in and reauthentication-required states, with mock state labelled separately. A typed cached state is not proof of a successful Graph network call.

## Ownership and attempts

Initial source owns `electron/services/microsoft-graph/connection-state.ts`, `manager.ts`, `electron/main/microsoft-graph-ipc.ts`, `electron/utils/microsoft-graph-oauth.ts`, `src/lib/microsoft-graph.ts` and `src/pages/Settings/MicrosoftGraphSection.tsx`. Focused tests cover connection state, callback interpretation and refresh failures; `tests/e2e/settings-msgraph-connection.spec.ts` is the visible-flow check. Harness task: `harness/specs/tasks/graph-connection-setup-states.md`.

The first author reported 16 new unit passes before its cap and began the E2E spec. Its stdout report was incomplete; do not claim the E2E, final typecheck or integrated run passed from that observation. Retain receipts under `artifacts/ga-fable-20260908/graph-connection/` and `graph-connection-finish/`.

## Acceptance and resume

Finish the callback-state regression first. Verify matching-state success/denial, missing/wrong-state refusal without terminating another flow, terminal cancellation, rejected-refresh reauthentication, transient-error distinction and unchanged permissions. Run focused/new and existing Graph suites, typecheck/lint, explicit-base harness validation/dry-run and communication checks. Run only mocked local Electron E2E; capture any blocker. Record exact source SHA and independent reviewer verdict before integration.

No new OAuth stack, dependency, public client ID, tenant registration or permission broadening is part of this repair. Client registration/consent and real account authentication remain externally required. Root owns board/current documents and later installed validation; the Claude author must produce `docs/evidence/GRAPH_CONNECTION_SETUP_2026-09-08.md` with the final commands and results. Coordinate shared Graph types with the already integrated readiness route before the combined tests.

## Completion checkpoint — September 8, 12:17 UTC

At `7a129570`, state validation precedes both OAuth code and error handling. The regression failed against the prior candidate; two forged denial callbacks now return 400 without ending the flow, while the genuine callback completes through a mocked token exchange. Matching-state cancellation has a typed neutral outcome; rejected refresh requires authentication, preserving tokens and distinguishing transient errors.

Author evidence: 18 new and 45 existing Graph unit tests PASS; typecheck, focused lint, explicit-base harness validation/dry-run and communication replay/compare PASS. Renderer build PASS. Electron E2E BLOCKED: launch reports ENOENT for Electron 42's `path.txt` in the shared pnpm store. A prepared isolated Electron test environment and rerun of `tests/e2e/settings-msgraph-connection.spec.ts` remain required. This is a test-environment gap, not evidence of a Windows installer defect.

Commands and handoff: candidate `docs/evidence/GRAPH_CONNECTION_SETUP_2026-09-08.md` and private `graph-connection-finish/result.md`. Next: independent source verdict, mocked Electron UI proof, then account-holder verification on the identified installed artifact.

Independent review update: `graph-connection-review/result.md` returns **APPROVE** for `7a129570`, confirming callback state isolation, neutral cancellation, auth-required refresh classification, token preservation and unchanged send gates. The review reran the new focused suites. Electron E2E and live account proof remain open; source has not yet been integrated or installed.

## UI environment blocker removed

`graph-ui-proof` passed the existing Settings E2E against real Electron 42 UI at approved source `7a129570`: unconfigured → saved synthetic configuration → signed_out with enabled sign-in and truthful mock badge. One test passed in 11.5 seconds; no live OAuth or Graph call was made. The shared package contained a hollow app stub and no `path.txt`; an isolated official darwin-arm64 binary matched the package-pinned SHA-256 `3c619bb8ec6a243142e392335382a3383739a9977ca85067cb1f31599ff993e5`.

Reproduce: `ELECTRON_OVERRIDE_DIST_PATH=/private/tmp/clawx-graph-e2e-electron42/dist pnpm exec playwright test tests/e2e/settings-msgraph-connection.spec.ts` from the Graph worktree with its matching renderer build. The override resolves a symlink to the real Electron binary and leaves shared dependencies unchanged. Evidence commit `9a17b3ee`; private result `artifacts/ga-fable-20260908/graph-ui-proof/result.json`. Graph source is integrated as `f520d2cc`; this original-revision UI result does not replace final integrated, installed Windows or tenant acceptance.
