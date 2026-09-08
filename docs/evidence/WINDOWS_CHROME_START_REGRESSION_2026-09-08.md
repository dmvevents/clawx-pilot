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
