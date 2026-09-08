---
id: clwx125-cold-turn-terminal-state
title: Preserve cold-turn timeout evidence across late empty history reloads
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Keep a submitted chat turn visible with a neutral terminal no-response state when cold Windows runtime preparation outlives the renderer watchdog.
touchedAreas:
  - src/stores/chat.ts
  - src/stores/chat/runtime-send-actions.ts
  - src/pages/Chat/index.tsx
  - src/lib/error-display.ts
  - src/i18n/locales/en/chat.json
  - windows-pilot/scripts/pilot-chat-turn-driver.js
  - tests/unit/chat-channel-degrade.test.ts
  - tests/unit/error-display.test.ts
  - tests/unit/windows-pilot-harness-honesty.test.ts
  - tests/e2e/chat-pending-send.spec.ts
  - harness/specs/tasks/clwx125-cold-turn-terminal-state.md
expectedUserBehavior:
  - A cold Online turn that receives no model output stops at the existing watchdog with a visible no-response error.
  - The submitted user message remains in the chat after a later empty chat.history refresh.
  - Late finals from the aborted run do not replace the explicit timed-out state during the same renderer run.
  - The no-response copy stays neutral and does not imply rate limit, quota, or automatic on-device fallback.
  - The Windows pilot chat driver records the generic error banner as a hard failing surface.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - renderer-main-boundary
  - completion-evidence
requiredTests:
  - tests/unit/chat-channel-degrade.test.ts
  - tests/unit/error-display.test.ts
  - tests/unit/windows-pilot-harness-honesty.test.ts
  - tests/e2e/chat-pending-send.spec.ts
acceptance:
  - Renderer watchdog timing is unchanged.
  - No false local fallback or replay is added for a silent Online timeout.
  - Empty or late chat.history cannot erase the current session's submitted prompt while the timeout state belongs to that prompt.
  - New sends in the same session supersede the retained timeout snapshot.
  - Driver verdicts remain non-zero for visible run-error, inline-chip, and generic error banners.
docs:
  required: true
---

Use this task spec when changing renderer chat terminal-state handling for cold Windows startup or the pilot CDP chat-turn driver. Transport remains Main/Gateway owned; the renderer only preserves local user intent and visible terminal evidence for the current run.
