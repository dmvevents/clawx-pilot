---
id: s1-lifecycle-connection-oracles
title: Pin startup channel and lifecycle failure oracles
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Preserve explicit Online intent and bounded turn lifecycle behavior across cold startup, local fallback seeding, session clear recovery, cancellation, and late responses.
touchedAreas:
  - harness/specs/tasks/s1-lifecycle-connection-oracles.md
  - electron/services/providers/channel-router.ts
  - electron/main/local-provider-seed.ts
  - src/stores/chat.ts
  - src/stores/gateway.ts
  - windows-pilot/scripts/pilot-chat-turn-driver.js
  - tests/unit/windows-pilot-harness-honesty.test.ts
  - tests/unit/channel-router.test.ts
  - tests/unit/gateway-boot-convergence.test.ts
  - tests/unit/chat-channel-degrade.test.ts
expectedUserBehavior:
  - A profile that explicitly prefers Online does not silently boot into a ready local model when no Online account is currently selectable.
  - Local fallback provisioning may add an on-device account, but it does not take default ownership from an existing cloud account.
  - A cold accepted Online turn remains bounded and survives the real owned lifecycle-start event without widening timeouts or replaying uncertain writes.
  - Cancelled, superseded, wrong-session, watchdog-terminated, or late responses cannot revive an old run or overwrite the current session.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - gateway-readiness-policy
  - completion-evidence
requiredTests:
  - pnpm exec vitest run tests/unit/channel-router.test.ts tests/unit/gateway-boot-convergence.test.ts tests/unit/chat-channel-degrade.test.ts tests/unit/windows-pilot-harness-honesty.test.ts
  - pnpm exec playwright test tests/e2e/chat-pending-send.spec.ts
  - pnpm harness validate --spec harness/specs/tasks/s1-lifecycle-connection-oracles.md
acceptance:
  - Boot preflight keeps explicit preferredChannel values authoritative: automatic fallback is allowed only when no stored preference exists.
  - Automatic local provider seeding preserves an existing cloud default and records the local account as a fallback only.
  - Existing lifecycle-start handling continues to count exactly one owned OpenClaw lifecycle start as liveness for the current run/session/generation.
  - Existing cancellation and late-event guards continue to reject old or unowned run outcomes after abort, timeout, session switch, or supersession.
  - Historical inline error chips from pre-send chat history do not fail a successful current turn, while post-send inline error chips remain terminal blockers.
  - No chat watchdog duration, transport timeout, replay policy, package behavior, or provider fallback architecture is changed.
docs:
  required: false
---

This task covers the S1 source failure-oracle layer for the September 8 Windows connection work. It is source evidence only: installed Windows 10/11, external stakeholder, and packaged artifact acceptance remain separate release gates.
