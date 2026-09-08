---
id: transient-degrade-requires-terminal-provider-failure
title: Require terminal provider failure before transient on-device degrade
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Prevent the renderer watchdog from treating first-turn silence as proof of cloud unreachability, and refuse transient on-device fallback when the local model is not ready.
touchedAreas:
  - src/stores/chat.ts
  - electron/services/providers/channel-router.ts
  - tests/unit/chat-channel-degrade.test.ts
  - tests/unit/channel-router.test.ts
  - tests/e2e/chat-pending-send.spec.ts
  - harness/specs/tasks/transient-degrade-requires-terminal-provider-failure.md
expectedUserBehavior:
  - A cold Online turn that has an accepted run id but no stream events before the watchdog does not silently pin or resend the session to On this device.
  - A real Online terminal network or rate-limit failure may still attempt the existing transient on-device recovery.
  - A transient on-device recovery is prepared only after Main proves the configured local model is reachable through the existing bounded readiness probe.
  - If the local fallback is stopped or missing its configured model, the original Online error remains visible and no session/runtime mutation claims a false local answer.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - gateway-readiness-policy
  - completion-evidence
requiredTests:
  - pnpm exec vitest run tests/unit/chat-channel-degrade.test.ts tests/unit/channel-router.test.ts
  - pnpm exec playwright test tests/e2e/chat-pending-send.spec.ts
  - pnpm harness validate --spec harness/specs/tasks/transient-degrade-requires-terminal-provider-failure.md
acceptance:
  - The chat watchdog still exits a truly silent accepted run visibly within the existing inactivity budget, but it does not call `/api/settings/degradeChannel`, patch a session model, pin the runtime channel, or resend the prompt from synthetic silence alone.
  - Real terminal provider errors and history-discovered terminal provider errors keep the existing cloud-to-local degradation behavior.
  - `prepareTransientChannelChange('on-device')` probes the selected local account and rejects before `ensureProviderAccountRuntime` when the probe reports unavailable.
  - Local readiness probing uses the configured account base URL and the exact resolved model id without increasing send or watchdog timeouts.
docs:
  required: false
---

Use this task spec for recovery changes that affect Online → On this device failover. Silence is only an app watchdog condition; the Main/Gateway boundary must supply terminal provider failure evidence before the app mutates a session to another channel.
