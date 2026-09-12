---
id: fix-windows-post-ready-gateway-recovery
title: Recover a hung post-ready Windows Gateway after corroborated heartbeat loss
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Replace the unconditional Windows post-ready heartbeat recovery skip with a bounded, corroborated recovery so a hung Gateway is restarted once while a merely busy Gateway is left alone.
touchedAreas:
  - harness/specs/tasks/fix-windows-post-ready-gateway-recovery.md
  - electron/gateway/manager.ts
  - electron/gateway/connection-monitor.ts
  - tests/unit/gateway-manager-heartbeat.test.ts
  - tests/unit/gateway-connection-monitor.test.ts
  - docs/bugs/CLWX-95-windows-post-ready-gateway-recovery.md
expectedUserBehavior:
  - On Windows, after the Gateway has reported ready, repeated missed WebSocket pongs no longer leave the app attached to a Gateway that never answers RPCs; the Gateway is restarted through the existing restart policy once a bounded health RPC also fails.
  - A Windows Gateway that misses pongs but still answers a bounded health RPC is not restarted; the heartbeat counter is reset and monitoring continues.
  - Startup recovery (initial gateway.ready grace and restart) and the non-Windows heartbeat restart path are unchanged.
  - Manual stop, a new connection or a lifecycle epoch change during the health probe cancels the pending recovery; a late probe result cannot restart the new or stopped Gateway.
  - Recovery never replays chat or side-effect tools; pending RPCs fail with the existing terminal "Gateway stopped" error and the renderer keeps its existing bounded terminal outcome.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - gateway-readiness-policy
  - backend-communication-boundary
  - renderer-main-boundary
  - completion-evidence
requiredTests:
  - tests/unit/gateway-manager-heartbeat.test.ts
  - tests/unit/gateway-connection-monitor.test.ts
  - tests/unit/gateway-manager-diagnostics.test.ts
  - tests/unit/gateway-ready-fallback.test.ts
  - pnpm exec tsc --noEmit -p tsconfig.electron-typecheck.json
  - pnpm exec eslint electron/gateway/manager.ts electron/gateway/connection-monitor.ts tests/unit/gateway-manager-heartbeat.test.ts tests/unit/gateway-connection-monitor.test.ts
acceptance:
  - A focused test first reproduces the defect on the unmodified guard (post-ready Windows, five missed pongs, health RPC times out, no restart), then passes after the fix with exactly one restart.
  - Healthy control: post-ready Windows with missed pongs and a health RPC that answers (success or Gateway-declared error) does not restart and resets the heartbeat miss counter.
  - Sustained control: a Gateway that first corroborates healthy and later stops answering is probed again and recovered; a one-shot heartbeat timeout cannot permanently suppress rechecking.
  - Concurrency control: overlapping heartbeat timeouts run one corroboration and at most one restart; restart() still joins in-flight restarts and honours the restart governor.
  - Identity control: stop(), a replaced WebSocket or a bumped lifecycle epoch during the probe aborts recovery; the late probe result triggers no restart.
  - Initial-ready Windows recovery and the darwin/linux heartbeat restart tests continue to pass unchanged.
  - No new manager abstraction, no browser/auth/user-data reset, no reconnect storm; recovery goes through the existing restart()/governor/deferred-restart policies only.
  - Renderer code is untouched; Main remains the transport owner.
docs:
  required: true
---

Use this task spec when changing how `electron/gateway/manager.ts` reacts to heartbeat (pong) loss on Windows after the Gateway has reported ready. Startup readiness recovery already exists (`requestInitialReadyRecovery`); this task covers only the post-ready window, where the previous behaviour was `Gateway heartbeat recovery skipped (platform=win32)`.

The Windows skip exists for a reason (commits `83f67e1e` and `ba84cd98`): Windows Defender scans, system updates and synchronous event-loop work in the Gateway delay pongs without the Gateway being dead, and restarting on pong loss alone produced restart cascades. The fix therefore treats missed pongs as a trigger to run a bounded real Gateway RPC, not as proof of death. Only a Gateway that misses the pong threshold and then fails to answer a bounded `health` RPC on repeated attempts is restarted, and only through `restart()` so the governor cooldown, in-flight join and deferred-restart rules still apply.

The transport contract for the renderer is unchanged: a restart fails pending RPCs with `Gateway stopped`, which the existing chat watchdog and terminal-state handling already convert into a bounded visible outcome. Nothing is replayed.

Evidence for this change is source-level only (fake timers, mocked `rpc`, mocked `restart`). Installed Windows proof of the observed 2026-09-12 hang recovering remains a separate VM lane and is recorded in `docs/bugs/CLWX-95-windows-post-ready-gateway-recovery.md`.
