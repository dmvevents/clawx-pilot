# CLWX-39 — Microsoft Graph connection setup: states, cancel, expiry (source checkpoint 2026-09-08)

Handoff for the Graph connection-setup workstream on `lane/graph-connection-20260908`
(base `f93ac8b3`). Structure follows `docs/bugs/TEMPLATE.md` (read-only reference).
Root owns board/current-doc syncing; this file is the dated raw evidence.

## Identity and impact

- Reported/last verified: 2026-09-08T12:15Z (UTC), local operator TZ UTC-4.
- Owning card: CLWX-39 (Graph connection setup). Related: Outlook Graph transport cards.
- Status: three defects **source verified** (fix + regression tests at this revision);
  independent review of `7a129570` APPROVED; local mocked Electron UI E2E PASS
  (see "E2E unblock"). Remaining gates: installed-build proof, live-tenant sign-in
  (account holder only).
- Environment: macOS dev checkout, source SHA base `f93ac8b3` + this working tree
  (committed on this lane). No installer/artifact — installed behavior is **unknown**,
  not inferred from this checkout.
- Known working baseline: `f93ac8b3` compiled and passed the pre-existing Graph suites;
  the three defects below existed there (bugs 1–2) or in the uncommitted candidate diff (bug 3).

## Defects, reproduction and expected result

### Bug 1 (baseline): OAuth error callback answers 400 but never resolves `waitForCode`

- At `f93ac8b3`, `startLocalOAuthServer` handled `error=` redirects by responding 400
  and returning — only `lastCode` could resolve `waitForCode`. Cancelling/declining on
  Microsoft's page (`error=access_denied`) left the renderer spinner for the full
  10-minute window, then fell into the manual-code prompt.
- Repro (synthetic): start `loginMicrosoftGraphOAuth`, GET
  `http://localhost:53682/callback?error=access_denied&error_description=AADSTS65004&state=<flow state>`.
  Expected: prompt typed rejection. Observed at baseline: 10-minute hang.
- Fix: `waitForCode` now also resolves on `lastError`; `access_denied` maps to typed
  `MicrosoftGraphSignInDeclined` → IPC error code `CANCELLED` → neutral toast (no error
  toast, no `msgraph:error` emit). Other OAuth errors fail loud with the error code.
- Test: `tests/unit/microsoft-graph-oauth-callback.test.ts`
  ("rejects promptly with a typed declined error…", bounded <5 s).

### Bug 2 (baseline): rejected refresh (`invalid_grant` / `interaction_required`) was opaque

- `refreshMicrosoftGraphToken` threw a generic `Error` with the raw body; callers could
  not distinguish "sign in again" from transient failure, so tools retried blindly.
- Fix: the OAuth `error` code from the JSON body is attached as `oauthError`;
  `getAccessToken` maps `invalid_grant` / `interaction_required` to
  `MicrosoftGraphAuthRequired` ("Microsoft session expired — sign in again").
  Non-JSON/5xx failures stay plain errors (no forced re-sign-in). Tokens are not
  cleared; sign-in overwrites, sign-out clears.
- Tests: `tests/unit/microsoft-graph-oauth-callback.test.ts` (refresh classification),
  `tests/unit/microsoft-graph-refresh-auth-required.test.ts` (manager mapping + negative control).

### Bug 3 (candidate diff, root review 2026-09-08, corrected here): error classified before CSRF state

- The uncommitted candidate's `interpretOAuthCallback` checked `error` **before**
  validating `state`. Combined with Bug 1's fix (`lastError` terminates the flow),
  any process able to reach `localhost:53682` could cancel the real pending sign-in
  by sending `error=access_denied` with missing/forged `state`.
- Repro (synthetic): during a pending flow, GET
  `/callback?error=access_denied` (no state) — candidate cancelled the flow.
- Fix: state is validated first; a callback whose `state` does not match the pending
  request yields `state_mismatch` (HTTP 400) and affects nothing. Entra echoes `state`
  on error redirects (OAuth 2.0 §4.1.2.1), so genuine cancels still match. The error
  400 body is served as `text/plain; charset=utf-8` so `error_description` is never
  browser-interpreted as HTML; descriptions are not logged.
- Tests (regression written first, observed failing pre-fix, passing post-fix):
  "rejects an error redirect whose CSRF state is missing or wrong" and the flow-level
  "does not cancel the real sign-in when a foreign access_denied callback lacks our state".

## Verification (this revision, source/static class)

| Check | Command | Result |
|---|---|---|
| New unit suites (3 files, 18 tests incl. regressions) | `pnpm vitest run tests/unit/microsoft-graph-{oauth-callback,connection-state,refresh-auth-required}.test.ts` | PASS |
| Existing Graph suites (45 tests) | `pnpm vitest run tests/unit/microsoft-graph-{outlook-adapter,send-safety,store}.test.ts tests/unit/outlook-routes-graph.test.ts` | PASS |
| Typecheck | `pnpm typecheck` | PASS |
| Lint (owned files, no autofix) | `pnpm exec eslint <owned files>` | PASS (clean) |
| Harness spec | `pnpm harness validate --spec harness/specs/tasks/graph-connection-setup-states.md --since f93ac8b3` | PASS ("Spec is valid") |
| Harness dry-run | `pnpm harness run --spec … --since f93ac8b3 --dry-run` | PASS (`artifacts/harness/latest.md`; fast/comms steps executed manually above) |
| Comms | `pnpm comms:replay` + `pnpm comms:compare` | PASS (0 order violations; qps/p95 delta 0.00%) |
| E2E `tests/e2e/settings-msgraph-connection.spec.ts` | `pnpm run build:vite && pnpm exec playwright test tests/e2e/settings-msgraph-connection.spec.ts` | **PASS** — see "E2E unblock" below. build:vite PASS earlier this revision (dist/ + dist-electron/ dated 2026-09-08 16:15 local, reused unchanged); Playwright rerun 2026-09-08 ~16:45 local with an isolated official Electron binary: `1 passed (11.5s)`. |

### E2E unblock (2026-09-08, environment-only, source unchanged at `7a129570`)

- Root cause (diagnosed, not assumed): the shared read-only pnpm store's
  `electron@42.0.0` package has **no `path.txt`** and its `dist/Electron.app` is a
  hollow 236K stub (Resources/lproj only, **no `Contents/Frameworks/`**). Direct launch
  fails: `dyld: Library not loaded: @rpath/Electron Framework.framework/Electron
  Framework`. Without `path.txt`, `node_modules/electron/index.js` would attempt
  `downloadElectron()` — a write into the read-only shared store.
- Remedy: the package's `index.js` supports `ELECTRON_OVERRIDE_DIST_PATH`, which
  returns `join($OVERRIDE, path.txt-contents || 'electron')` with **no store write**.
  Prepared an isolated cache (no lockfile/store/dependency change, no installer run):
  - `curl -fsSL https://github.com/electron/electron/releases/download/v42.0.0/electron-v42.0.0-darwin-arm64.zip` → `/private/tmp/clawx-graph-e2e-electron42/`
  - SHA-256 `3c619bb8ec6a243142e392335382a3383739a9977ca85067cb1f31599ff993e5` — matches
    `node_modules/electron/checksums.json["electron-v42.0.0-darwin-arm64.zip"]` exactly.
  - `ditto -x -k … dist/`; symlink `dist/electron → Electron.app/Contents/MacOS/Electron`
    (matches the override's `'electron'` fallback since `path.txt` is absent).
  - Sanity: `dist/electron --version` → `v42.0.0` (darwin-arm64 host);
    `ELECTRON_OVERRIDE_DIST_PATH=… node -e "console.log(require('electron'))"` resolves
    the isolated path, shared store untouched (post-run: still no `path.txt`, stub still 236K).
- Command: `ELECTRON_OVERRIDE_DIST_PATH=/private/tmp/clawx-graph-e2e-electron42/dist
  pnpm exec playwright test tests/e2e/settings-msgraph-connection.spec.ts`
- Output: `✓ 1 … vanilla install shows unconfigured, saving config yields signed_out
  with Sign in (11.1s)` → `1 passed (11.5s)`. Real Electron-rendered Settings showed
  `data-state=unconfigured` ("Not connected", demo-mailbox copy, no Sign in button),
  then after saving synthetic `moe.gov.tt` / `11111111-2222-3333-4444-555555555555`
  transitioned to `data-state=signed_out` ("Not signed in", enabled Sign in, "Mock
  mailbox" badge). Mocked/local only: no sign-in, no account, no Graph API traffic.
  Fixture temp home/user-data dirs self-cleaned; none left behind.
- `tests/e2e/fixtures/electron.ts` unchanged — it already honors the package override
  via `import electronBinaryPath from 'electron'`; no source change, no new review round.

## Known limits / not proven here

- Source-class evidence only: no installed build, no VM, no live tenant, no real
  account sign-in (account-holder action). Live Entra behavior (`state` echo on error
  redirects, Conditional Access `interaction_required`) is asserted from OAuth 2.0 /
  Microsoft identity-platform documented behavior, not observed against the tenant.
- `connectionState` is derived, not persisted; `effectiveMock` stays a separate fact
  and never renders as a live connection (unit-tested; E2E assertion now passing, see above).
- The E2E pass is dev-tree Electron UI evidence (mocked, local, synthetic tenant/client
  values), not installed-artifact, live-tenant or signed-in evidence.
- No tenant/client IDs invented; no new dependency; scopes/permissions unchanged.

## Resume here

- Branch `lane/graph-connection-20260908`; `7a129570` contains fix + tests + spec.
  Independent review of `7a129570`: APPROVED (root
  `artifacts/ga-fable-20260908/graph-connection-review/result.md`). The E2E is now
  green at that revision (environment-only unblock above; no source delta since review).
- Next: installed-build + live-tenant acceptance per CLWX-39 gates (account holder
  required for sign-in).
- Do not repeat: the unit/typecheck/lint/harness/comms evidence above for an unchanged diff.
