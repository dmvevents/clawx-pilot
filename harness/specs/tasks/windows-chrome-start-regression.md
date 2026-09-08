---
id: windows-chrome-start-regression
title: Route explicit Chrome opening through the Ministry Windows path with endpoint ownership verification
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: >-
  Fix the CLWX-130 boundary where "open chrome" was answered by the stock
  managed browser plugin (timeout plus Mac menubar recovery text on Windows)
  and where diagnoseChromeCdp claimed cdp_ready from a bare HTTP version probe
  even when the loopback debug port belonged to a Chrome in another Windows
  session or an unidentifiable process.
touchedAreas:
  - harness/specs/tasks/windows-chrome-start-regression.md
  - electron/services/chrome-cdp.ts
  - electron/services/outlook-browser-v2/playwright-driver.ts
  - electron/services/forms-browser-v2/forms-driver.ts
  - extensions/moe-principal-assistant/index.mjs
  - extensions/moe-principal-assistant/persona.mjs
  - extensions/moe-principal-assistant/openclaw.plugin.json
  - tests/unit/chrome-cdp.test.ts
  - tests/unit/outlook-playwright-driver-cdp.test.ts
  - tests/unit/forms-browser-driver-cdp.test.ts
  - tests/unit/moe-principal-assistant-plugin.test.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - docs/evidence/WINDOWS_CHROME_START_REGRESSION_2026-09-08.md
expectedUserBehavior:
  - Asking to open Chrome or the browser calls the explicit Ministry browser.open_chrome tool, which launches the principal's system Chrome through the existing Main repair/ensure service; the stock managed browser is never the Ministry path.
  - On Windows, a responding CDP endpoint is only reported ready after a bounded loopback ownership check confirms the listener is a Chrome ClawX may drive - our own spawn (positive PID ownership), the dedicated ClawX automation profile, or the principal's own user-profile Chrome deliberately started with the debug port (the documented pilot launch).
  - A debug port confirmed to belong to another Windows user's session is refused with truthful different-session guidance; a same-session Chrome that was not started for automation is refused as a same-session conflict - the principal is never told to sign in to a Windows session they are already in.
  - An unidentifiable endpoint owner is reported truthfully as unverified, never as ready - and unknown identity is never a reason to kill a running Chrome; the only Chrome ever killed is the one ClawX itself spawned, and only on confirmed foreign/conflicting ownership or port-bind timeout.
  - The Outlook and Forms drivers verify loopback endpoint ownership BEFORE connectOverCDP, so a reachable wrong-session endpoint is refused at the attach boundary instead of being driven; ownership, launch and readiness all derive one port identity from the CDP endpoint.
  - Ordinary cases keep working - same-session automation profile reports ready, no Chrome launches Chrome, missing Chrome still says install Chrome, our own locked profile still says close Chrome, and macOS/Linux never run Windows ownership queries.
  - Recovery guidance surfaced on Windows never contains macOS menu-bar instructions.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - gateway-readiness-policy
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - docs-sync
  - comms-regression
requiredTests:
  - tests/unit/chrome-cdp.test.ts
  - tests/unit/moe-principal-assistant-plugin.test.ts
acceptance:
  - browser.open_chrome is registered behind the CLWX-86 capability gate and executes POST /api/browser/repair-chrome-cdp on the Host API; no new parallel service or route is introduced for the same behavior.
  - diagnoseChromeCdp and the post-launch ready check verify loopback endpoint ownership on win32 via an injectable runtime probe; the default probe is one bounded PowerShell invocation with a validated integer port, no shell interpolation and no secret logging.
  - Confirmed foreign session/profile returns a typed foreign-owner state with actionable Windows guidance; unknown identity returns a typed unverified state; neither is cdp_ready and neither triggers a launch, kill or port change.
  - Non-win32 platforms and the chrome_not_found / profile_locked_close_chrome / port_bind_timeout guards keep their existing contracts.
  - Persona and tool descriptions route browser opening and Windows recovery to browser.open_chrome / browser.diagnose / browser.repair_chrome_cdp, forbid the stock managed browser for Ministry journeys, and forbid macOS menu-bar recovery instructions on Windows.
  - All fixtures stay synthetic; no real tenant identifiers, session tokens or private URLs in tests.
docs:
  required: true
  expectedPaths:
    - docs/evidence/WINDOWS_CHROME_START_REGRESSION_2026-09-08.md
---

# Windows Chrome start regression (CLWX-130)

Owner RDP feedback (2026-09-08, screenshot 15:48:52 Asia/Dubai; trace call
11:44:02.283Z, result 11:44:20.134Z, isError:false): "cna you open chrome" was
routed to the stock OpenClaw `browser` tool with `{"action":"start"}`, which
timed out on the managed profile and returned recovery text telling a Windows
user to restart OpenClaw from the Mac menu bar. Later read-only observation
showed CDP port 18792 owned by a Chrome in Windows Session 1 while the Gateway
and user ran in Session 2 - yet `diagnoseChromeCdp` would have called that
endpoint `cdp_ready` from the HTTP version probe alone.

This task adds the explicit Ministry `browser.open_chrome` tool (backed by the
existing Main `ensureChromeCdpReady` service over the existing
`/api/browser/repair-chrome-cdp` route) and a minimal Windows loopback
ownership/profile verification before any ready claim, with typed truthful
refusals for confirmed-foreign and unknown owners. Automatic per-user port
allocation beyond the existing narrow endpoint contract is a separate
follow-up, deliberately out of scope.
