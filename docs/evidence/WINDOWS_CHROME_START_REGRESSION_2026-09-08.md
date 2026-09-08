# Windows Chrome start regression — CLWX-130 source fix (2026-09-08)

Lane: `lane/browser-regression-20260908`, base `6ec32807`. Author: Claude (Bedrock). Independent review: pending (separate lane). **No installed-build claim** — this is source-level evidence only.

## Failure being fixed

Owner RDP report 2026-09-08 (screenshot 15:48:52 Asia/Dubai; trace 11:44:02.283Z → 11:44:20.134Z, `isError:false`): "cna you open chrome" was routed to the stock OpenClaw `browser` tool (`action:start`), which timed out on the managed profile and returned recovery text telling a Windows user to restart OpenClaw from the **Mac menu bar**. Read-only port observation later showed CDP 18792 owned by Chrome PID 4860 in Windows **Session 1** while the Gateway/user ran in **Session 2** — yet `diagnoseChromeCdp` claimed `cdp_ready` from the bare `/json/version` HTTP probe, ignoring Windows session/profile ownership. Authoritative handoff: `docs/bugs/CLWX-130-windows-chrome-start.md` (sanitized documentation intended for the committed history; maintained in the root checkout, not part of this lane's diff). The exact 11:44 stock-launch bootstrap cause remains UNKNOWN and is not claimed fixed here.

## What changed (source)

| Area | Change |
|---|---|
| `extensions/moe-principal-assistant/index.mjs` | New explicit `browser.open_chrome` tool behind the CLWX-86 capability gate. Executes the EXISTING Main service over the EXISTING `POST /api/browser/repair-chrome-cdp` route (facade `openChrome` alias — no new parallel service or route). Description forbids the stock managed browser for Ministry journeys and macOS recovery wording. |
| `extensions/moe-principal-assistant/persona.mjs` | New capability bullet routing "open Chrome / open the browser" and Windows browser recovery to `browser.open_chrome`; forbids stock `browser start` for Ministry journeys and any macOS menu-bar/flags/command-line guidance. |
| `extensions/moe-principal-assistant/openclaw.plugin.json` | `browser.open_chrome` added to the manifest tool contract (parity test enforced). |
| `electron/services/chrome-cdp.ts` | Minimal Windows loopback ownership/profile verification before any `cdp_ready` claim (diagnose) and after launch. Injectable `runtime.describeLoopbackPortOwner` for deterministic tests; default is ONE bounded PowerShell invocation (5s timeout, validated integer port only — no shell interpolation of untrusted strings, no secret logging; only PID/session numbers surface). New typed states: `foreign_endpoint_owner` (confirmed other Windows session or non-ClawX profile; action `resolve_port_conflict`; never kills/attaches/switches port) and `endpoint_owner_unverified` (unknown identity reported truthfully, never ready). win32 loopback only — macOS/Linux and explicit non-loopback endpoints keep their existing contracts. |

Preserved unchanged: `chrome_not_found`, `profile_locked_close_chrome`, `port_bind_timeout`, the CLWX-73 no-managed-profile and no-orphan rules, `electron/api/routes/browser.ts` and the capabilities inventory (no route change), Graph auth / outlook readiness route / send gates / Forms DOM.

## Verification (source revision: see commit)

| Check | Command | Result |
|---|---|---|
| Chrome-CDP unit incl. wrong-session, wrong-profile, unknown-identity, post-launch foreign (kills only our spawn), success, missing-Chrome, timeout, macOS and non-loopback controls | `pnpm exec vitest run tests/unit/chrome-cdp.test.ts` | PASS (18) |
| Plugin: `browser.open_chrome` facade proof (POST `/api/browser/repair-chrome-cdp` observed), manifest parity, persona routing/negative wording, no-credentials negative control, preserved send/confirm gates | `pnpm exec vitest run tests/unit/moe-principal-assistant-plugin.test.ts` | PASS (29) |
| Adjacent capability/handshake/policy suites | `pnpm exec vitest run tests/unit/clwx86-capability-handshake.test.ts tests/unit/host-api-capabilities-route.test.ts tests/unit/gateway-plugin-config-seed.test.ts tests/unit/ondevice-tool-policy.test.ts` | PASS (66) |
| Typecheck | `pnpm typecheck` | PASS (exit 0; all three tsconfig projects) |
| Lint (focused, no autofix) | `pnpm exec eslint electron/services/chrome-cdp.ts extensions/moe-principal-assistant/index.mjs extensions/moe-principal-assistant/persona.mjs tests/unit/chrome-cdp.test.ts tests/unit/moe-principal-assistant-plugin.test.ts` | PASS (exit 0) |
| Harness spec | `pnpm harness validate --spec harness/specs/tasks/windows-chrome-start-regression.md --since 6ec32807`; `pnpm harness run --spec … --dry-run --since 6ec32807` | PASS (spec valid; dry-run report pass — backend-communication boundary scan pass; fast/comms profile steps skipped by dry-run, covered by the direct runs in this table) |
| Comms | `pnpm comms:replay` && `pnpm comms:compare` | PASS (all thresholds; `history_load_qps` and `rpc_p95_ms` at 0.00% delta vs baseline) |

## Exact limitations

- Model tool SELECTION is steered by persona/description text; it is testable as text and by the facade proof, but only an installed rerun proves the model picks `browser.open_chrome` for "open chrome". Installed acceptance, live-account Outlook/Forms preview and the CLWX-130 card advance remain NOT_RUN.
- The stock `browser` plugin remains enabled (`syncBrowserConfigToOpenClaw` default predates the incident); disabling it globally was explicitly out of scope per the handoff ("do not disable stock browser globally").
- The precise 11:44 stock-launch failure cause remains BLOCKED on incident-time Gateway logs; this fix removes the false-ready ownership boundary and the routing gap, not that unknown.
- Automatic per-user CDP port allocation beyond the existing narrow endpoint contract is a named follow-up, not implemented.
- Default PowerShell probe behavior on a real multi-session Windows Server (permissions to read another session's `Win32_Process.CommandLine` vary) is exercised only via the injected runtime in tests; unknown identity degrades to `endpoint_owner_unverified`, never a false ready. Requires installed Windows verification.

## Ownership-repair follow-up — review findings resolved (2026-09-08, lane `lane/browser-regression-20260908`, base `736ffe9e`)

The independent review of `a091a968` returned REQUEST_CHANGES with three reproduced defects plus three source findings. This follow-up (CLWX-130, coupled CLWX-121) resolves all six at the owning boundaries. Author: Claude (Bedrock). Independent review of THIS diff: pending — this section is author evidence, not approval.

| Review finding | Repair |
|---|---|
| 1. `endpoint_owner_unverified` after launch killed our own working Chrome (CIM-denied box) | Positive spawn ownership: the spawned PID is recorded per port (process-lifetime memory) and an endpoint owned by that PID is `cdp_ready` even with unreadable process metadata. The ownership probe re-probes once before concluding. Unknown identity NEVER kills; the only Chrome ever killed is our own spawn, on confirmed foreign/conflicting ownership or port-bind timeout. |
| 2. Same-session different-profile labelled "another user session" with sign-in advice | Verdicts split by evidence: confirmed different session vs same-session conflict return distinct truthful messages (both `foreign_endpoint_owner`; no consumer contract change). "Please sign in to your own Windows session" is gone. The documented pilot launch — the principal's own user-profile Chrome started with the debug port — is now accepted as ours (profile=user preserved); the managed "Ministry of Education" dir stays refused (CLWX-73). |
| 3. Outlook/Forms `connectOverCDP` bypassed the ownership gate | New exported `verifyCdpEndpointOwnershipForAttach` runs BEFORE any `connectOverCDP` in both drivers; a reachable wrong-session or unverifiable loopback endpoint refuses the attach fail-closed. `no_listener`, macOS/Linux and non-loopback endpoints proceed unchanged. |
| 4. Ownership probed `debugPort` while readiness probed `cdpEndpoint` | One endpoint identity: the endpoint-derived port now wins for ownership, launch and readiness; a conflicting `debugPort` option is logged, not silently honored. |
| 5. Default PowerShell probe branches untested | `defaultDescribeLoopbackPortOwner` exported and exercised against a controlled `powershell.exe` process fixture on PATH (real spawn/parse): invalid-port (no spawn), `no_listener`, full ok payload (validated integer port and `-NoProfile` asserted from the recorded argv), null commandLine, malformed stdout, unrecognized payload, non-zero exit. Skipped on real win32 where the fixture cannot shadow System32 — the genuine probe there remains installed-Windows evidence (NOT_RUN). |
| 6 / CLWX-121. Subject/compose state unbound before narrowing the draft scan | Driver-level binding first: `composeSurface()` is the ONLY trustable compose surface (the bound tab, re-validated live/in-context/on-Outlook; never a silent re-bind), and `outlookPages()` — the draft scan — is DERIVED from it, so the MEDIUM-8 narrowing cannot exist without the MEDIUM-7 binding. Confirm/exact-subject/recipient gates, tab-theft rules and no-replay behavior unchanged. |

### Verification (this lane, uncommitted tree over `736ffe9e`; commands exact)

| Check | Command | Result |
|---|---|---|
| Chrome-CDP incl. spawn-ownership, never-kill-on-unverified, session-vs-profile split, user-profile launch accepted, managed refused, endpoint identity, attach gate, PS process fixture | `pnpm exec vitest run tests/unit/chrome-cdp.test.ts` | PASS (36) |
| Outlook driver incl. attach gate order/refusal and CLWX-121 compose-surface rows | `pnpm exec vitest run tests/unit/outlook-playwright-driver-cdp.test.ts` | PASS (19) |
| Forms driver incl. attach gate order/refusal | `pnpm exec vitest run tests/unit/forms-browser-driver-cdp.test.ts` | PASS (16) |
| Adjacent safety/gate suites (send gates, submit gate, readiness, plugin, probe parity) | `pnpm exec vitest run` on the 9 focused files | PASS (240 total) |
| Mutation proof (9 legs, each caught by a named row, sources restored byte-identical: `cmp` clean) | disable spawn ownership; kill-on-unverified; revert port precedence; drop user-profile acceptance; revert draft-scan narrowing; strip composeSurface checks; drop bound-tab preference; remove each driver's attach gate | 9/9 caught |

### Limitations (unchanged unless stated)

- The exact 11:44Z stock-launch timeout cause remains **UNKNOWN**; nothing here claims it fixed.
- No installed-build, live-account, VM or GUI evidence in this follow-up (GUI/Electron launches on hold). The real PowerShell probe on multi-session Windows Server remains NOT_RUN.
- Fail-closed attach on a box where the ownership probe itself is broken (PowerShell missing/denied and no recorded spawn) refuses Outlook/Forms attach until a ClawX-launched Chrome restores positive ownership; this is deliberate (a reachable wrong-session endpoint must not bypass checks) and recorded as a support-visible behavior.
- After a CDP reconnect the driver cannot re-identify its previous draft tab (Page objects are new); the compose binding then starts empty and the send gates re-verify on the freshly bound tab. Actions-level snapshot continuity remains with the outlook-actions owner.
