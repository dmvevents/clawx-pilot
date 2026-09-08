---
id: extend-chat-watchdog-on-lifecycle-start
title: Extend chat watchdog on owned Gateway lifecycle start
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Prevent a cold but accepted Online turn from being aborted shortly after OpenClaw starts the real model run, by treating the existing owned lifecycle-start event as liveness.
touchedAreas:
  - src/stores/gateway.ts
  - src/stores/chat.ts
  - tests/unit/chat-channel-degrade.test.ts
  - tests/e2e/chat-pending-send.spec.ts
  - harness/specs/tasks/extend-chat-watchdog-on-lifecycle-start.md
expectedUserBehavior:
  - A first Online turn that spends most of the renderer watchdog budget in Gateway preparation remains active after OpenClaw emits the real lifecycle start for the same run and session.
  - Wrong-session, wrong-run, duplicate, superseded, or watchdog-aborted lifecycle starts do not revive or extend a turn.
  - Truly silent accepted runs still end visibly within the existing watchdog policy.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - gateway-readiness-policy
  - completion-evidence
requiredTests:
  - pnpm exec vitest run tests/unit/chat-channel-degrade.test.ts
  - pnpm exec playwright test tests/e2e/chat-pending-send.spec.ts
  - pnpm harness validate --spec harness/specs/tasks/extend-chat-watchdog-on-lifecycle-start.md
acceptance:
  - The Gateway notification adapter normalizes OpenClaw agent lifecycle `stream: lifecycle` + `phase: start` to the existing chat started event shape while preserving legacy `phase: started` compatibility.
  - The chat store refreshes `_lastChatEventAt` exactly once for an active owned lifecycle start whose run id, session key, and send generation match the current send.
  - Lifecycle starts from another run/session, duplicate starts, or runs already terminated by the watchdog cannot refresh, revive, or clear terminal error state.
  - No chat send timeout, watchdog duration, artificial heartbeat, provider fallback, or Gateway transport deadline is changed.
docs:
  required: false
---

This task covers the September 8 fresh-Windows first-turn timing failure: `chat.send` acknowledged the Online run, OpenClaw spent about 75 seconds preparing the run, and the renderer aborted about 25 seconds after `prompt.submitted`. The runtime already emits an agent lifecycle start for the actual run; the app must consume that owned lifecycle event as liveness without treating silence or unrelated agent events as model progress.
