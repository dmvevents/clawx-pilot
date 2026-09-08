# Outlook/Graph readiness feedback — 2026-09-08

## Incident (primary evidence)

- Owner-supplied RDP screenshot, 2026-09-08 15:40:41 Asia/Dubai; app Online, Gateway connected, port 18789, pid 8280 (root confirmed pid 8280 "Ministry of Education", SessionId 2, 11:42:15Z).
- Redacted receipt: `/Users/antonalexander/Github/moe-tt/ClawX/artifacts/ga-fable-20260908/graph-feedback/screenshot-receipt.json` (sha256 `c868ab8a…11ce9ba` for the PNG). Raw image not loaded for this fix; the receipt's observed/interpretation fields were sufficient.
- Observed behavior: asked "is the microsoft graph api installed", the installed assistant called one tool, reported an Outlook **config path does not exist**, said it was unable to check the configuration, and asked the user whether to try an Outlook tool for transport/source.
- Interpretation (per receipt): this does **not** establish that Graph is absent or that the tenant is authenticated. It demonstrates inadequate capability diagnosis: the assistant had no read-only readiness surface and fell back to probing a fictional config path.

## Root cause (source level, revision f93ac8b3 + this change)

- The `moe-principal-assistant` plugin exposed no explicit readiness/diagnosis tool. The only Outlook entry that reveals state is `outlook.open`, which **navigates the principal's browser** — a mutation for a status question. `browser.diagnose` covers Chrome/CDP only.
- Graph configured/signed-in/transport state existed only on renderer IPC (`msgraph:status`); the gateway plugin had no host-API path to it. Transport selection truth lives in `shouldUseGraphOutlookRead/Compose` (electron/api/routes/outlook.ts) and was not reportable.

## Fix

- `POST /api/outlook/readiness` (electron/api/routes/outlook.ts): read-only; reports typed Graph state `signed_in | not_signed_in | not_configured | unknown`, `configured/signedIn/mockMailbox`, per-lane `{ enabled, transport }` from the **same** intent helpers the real transport selectors consume, and `mailSendScopeGranted` mirroring the send gate (incl. mock bypass and resource-qualified scopes). A failed status read is reported `unknown`, never "not configured". Browser lane is honestly `state: "unknown"` — only `outlook.open`/`browser.diagnose` observe it. Logs booleans only.
- `POST /api/outlook/readiness` registered in `PLUGIN_FACING_HOST_API_ROUTES` (electron/api/routes/capabilities.ts) — one-line registration mechanically required by the CLWX-86 drift triangle (route file ⇄ inventory ⇄ plugin route map); on older installed apps lacking the route the tool self-parks with the readable update-the-app message.
- Plugin `outlook.readiness` tool (extensions/moe-principal-assistant/index.mjs) + facade route; description and persona (persona.mjs) direct availability questions to the tool, forbid config-file inference and browser navigation for diagnosis, and state Graph is a built-in cloud service that never needs a local API install. Manifest contract updated (openclaw.plugin.json).

## Verification (source-level, synthetic fixtures, this branch)

- `tests/unit/outlook-readiness-diagnostics.test.ts` — 11 tests: typed states (disabled lanes/unconfigured/unsigned/signed, mock, unknown-on-status-failure), Mail.Send grant variants, 405 on GET, **no mutation while querying** (no browser-manager or Graph mailbox call), plugin registration, single-POST diagnosis, skew self-park, creds-absent absence, persona contract. Written first and failing (9 rows red) before the fix.
- `tests/unit/outlook-routes-graph.test.ts`, `tests/unit/host-api-capabilities-route.test.ts` (drift triangle), `tests/unit/clwx86-capability-handshake.test.ts` (now 19 gated tools), `tests/unit/moe-principal-assistant-plugin.test.ts` — all green (83 tests across the 5 suites).
- `pnpm typecheck` pass; `pnpm harness validate --spec harness/specs/tasks/outlook-readiness-capability-diagnosis.md --since f93ac8b3` valid. Lint/dry-run/comms results in the commit receipt.

## Source vs installed distinction

This is a **source-tree fix with source-level test evidence only**. The installed app on the owner's VM (pid 8280 session) predates it: the observed incident remains the installed-build behavior until root installs a build containing this change after accepted integration. No installed-build, live-account, or external-tester evidence is claimed. Cards CLWX-40 (Graph transport) and CLWX-61 (email) remain open; this change does not close them.

## Coordinator checkpoint

The author stopped at its explicit spending cap, not a successful final receipt. Root completed the checkpoint on September 8: all 83 focused tests passed; focused ESLint had zero errors and one existing-in-this-diff test `any` warning; communication replay/compare passed. The first harness dry-run omitted `--since` and compared unrelated branch history; it failed. Rerunning with `--since f93ac8b3` passed without widening the task's ownership. Independent source review is pending.

Read-only installed evidence at 11:44:52Z confirms the Graph handler exists with `configured:false`, `signedIn:false`, empty granted scopes, `mockMailbox:false`, and `effectiveMock:true`. This is not a working live mailbox. The installed tool trace confirms `gateway` / `config.schema.lookup` / `outlook` at 11:39:41Z. The defect is tracked separately as CLWX-131; CLWX-39 owns connection setup and CLWX-40 owns transport acceptance.
