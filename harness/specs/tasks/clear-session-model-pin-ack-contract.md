---
id: clear-session-model-pin-ack-contract
title: Accept OpenClaw session pin clear acknowledgements by effective resolved model
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Prevent the renderer from rejecting a successful `sessions.patch { model: null }` clear when OpenClaw retains runtime model fields that already match the resolved Online default.
touchedAreas:
  - src/stores/chat.ts
  - tests/unit/chat-channel-degrade.test.ts
  - harness/specs/tasks/clear-session-model-pin-ack-contract.md
expectedUserBehavior:
  - When the user is in Online mode and the stored Online default is proven healthy, a stale on-device session pin is cleared if Gateway acknowledges the session resolves to the Online default.
  - A clear acknowledgement that still contains explicit model override fields is rejected.
  - A clear acknowledgement that resolves to any model other than the proven Online default is rejected.
  - Existing ownership gates still prevent clearing when the default changes, the channel intent changes, or the session/generation no longer matches.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - gateway-readiness-policy
  - completion-evidence
requiredTests:
  - pnpm exec vitest run tests/unit/chat-channel-degrade.test.ts
  - pnpm harness validate --spec harness/specs/tasks/clear-session-model-pin-ack-contract.md
acceptance:
  - `sessions.patch { model: null }` readback is validated against OpenClaw's effective `resolved` model, not by requiring retained runtime `entry.model` and `entry.modelProvider` fields to disappear.
  - Retained runtime fields are accepted only when the ack has no explicit override fields and the effective resolved model matches the proven Online default.
  - Conflicting resolved readback, wrong session key, failed ack, or residual explicit override fields keep the recorded pin.
  - No timeout, fallback, provider-probe, or session-ownership policy changes are introduced.
docs:
  required: false
---

Use this task spec when changing renderer validation of OpenClaw `sessions.patch { model: null }` acknowledgements. Transport remains Main/Gateway owned; the renderer may clear its local stale-pin state only after Gateway proves the session resolves to the intended Online default.
