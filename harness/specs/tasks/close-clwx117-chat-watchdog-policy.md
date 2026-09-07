---
id: close-clwx117-chat-watchdog-policy
title: Bound on-device tool cascades and stale channel recovery
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Prevent on-device session-yield cascades, guarantee visible terminal outcome for stalled tool-only runs, and require Main-owned provider proof before clearing stale on-device session pins.
touchedAreas:
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - electron/utils/ondevice-tool-policy.ts
  - src/stores/chat.ts
  - electron/api/routes/providers.ts
  - electron/services/providers/provider-service.ts
  - electron/services/providers/provider-validation.ts
  - electron/services/providers/channel-router.ts
  - tests/unit/ondevice-tool-policy.test.ts
  - tests/unit/chat-channel-degrade.test.ts
  - tests/unit/provider-validation.test.ts
  - tests/unit/provider-stored-default-probe-route.test.ts
  - tests/e2e/chat-task-visualizer.spec.ts
  - harness/specs/tasks/close-clwx117-chat-watchdog-policy.md
expectedUserBehavior:
  - On-device chat cannot choose sessions_yield during ordinary local answers.
  - A tool-only chat run that stops producing progress exits with a visible error instead of leaving the composer spinning.
  - A stale watchdog from an older turn cannot stop a newer send or hide active streaming progress.
  - Channel recovery remains visible while stale session-pin cleanup is still pending.
  - A stale on-device session pin is cleared only after Main proves the stored Online default with a strict 2xx credentialed probe and the Gateway acknowledges model:null.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - completion-evidence
requiredTests:
  - tests/unit/ondevice-tool-policy.test.ts
  - tests/unit/chat-channel-degrade.test.ts
  - tests/unit/provider-validation.test.ts
  - tests/unit/provider-stored-default-probe-route.test.ts
  - tests/e2e/chat-task-visualizer.spec.ts
acceptance:
  - The on-device provider policy denies sessions_yield through the real OpenClaw policy matcher without trimming cloud providers.
  - A local chat run that reaches completed tool-only output and then goes silent exits with a visible terminal failure inside the existing watchdog family.
  - Valid active streaming, running tool progress, and newer sends are not terminated by stale watchdog timers.
  - Existing channel recovery progress remains visible while stale session-pin cleanup is pending.
  - Stored-provider recovery rejects unavailable, local, mismatched, missing-key, and legacy-route outcomes without returning credential or upstream request details.
  - Failed provider probes do not consume the clear-RPC attempt budget; successful clears and fresh acknowledged fallback pins reset the budget for the next episode.
  - Watchdog and orphaned late-run cancellation name the exact old run; empty heartbeat/tool arrays cannot keep a stalled turn alive.
docs:
  required: true
---

Use this task spec when changing on-device tool policy, renderer chat watchdog behavior, or stale channel-pin recovery. The runtime boundary remains Main/Gateway owned: Main performs credentialed provider availability checks, Gateway acknowledges session pin clears, and renderer changes only consume sanitized proof plus Gateway events to surface bounded terminal state.
