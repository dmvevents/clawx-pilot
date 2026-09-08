---
id: stakeholder-unconfigured-startup
title: Prevent false usable model selection on stakeholder startup
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Stop Windows startup from routing ordinary chat to an automatically seeded local Ollama account unless that local model is actually reachable, while preserving explicit user channel intent and showing setup guidance when no model route is usable.
touchedAreas:
  - harness/specs/tasks/stakeholder-unconfigured-startup.md
  - electron/main/index.ts
  - electron/main/local-provider-seed.ts
  - electron/services/providers/channel-router.ts
  - electron/services/providers/provider-service.ts
  - electron/api/routes/providers.ts
  - src/pages/Chat/ChatInput.tsx
  - src/lib/model-options.ts
  - src/i18n/locales/en/chat.json
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - tests/unit/gateway-boot-convergence.test.ts
  - tests/unit/channel-router.test.ts
  - tests/unit/provider-stored-default-probe-route.test.ts
  - tests/unit/chat-input.test.tsx
  - tests/unit/provider-service-stale-cleanup.test.ts
  - tests/unit/model-options.test.ts
  - tests/e2e/stakeholder-unconfigured-startup.spec.ts
expectedUserBehavior:
  - A packaged Windows app with a persisted managed cloud provider imports that provider before startup channel selection and routes Online instead of falling back to local.
  - A fresh or upgraded install does not automatically make local Ollama the default unless the configured local model answers the bounded readiness probe.
  - If Gateway is running but the default model route is not usable, the composer is disabled with setup guidance instead of sending a normal message into a timeout.
  - If the principal explicitly selected On this device, startup does not silently switch that session/content to Online.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - gateway-readiness-policy
requiredTests:
  - pnpm exec vitest run tests/unit/gateway-boot-convergence.test.ts tests/unit/channel-router.test.ts tests/unit/provider-stored-default-probe-route.test.ts tests/unit/chat-input.test.tsx tests/unit/model-options.test.ts tests/unit/provider-service-stale-cleanup.test.ts
  - pnpm exec playwright test tests/e2e/stakeholder-unconfigured-startup.spec.ts
  - pnpm harness validate --spec harness/specs/tasks/stakeholder-unconfigured-startup.md
acceptance:
  - Startup imports provider accounts derivable from openclaw.json before the local fallback seed and channel preflight run.
  - The local fallback seed proves the configured Ollama model via a bounded local models probe before creating an automatic local account/default.
  - Boot preflight can ignore unready local accounts for automatic selection, can prefer imported cloud when no explicit channel has been chosen, and preserves an explicit on-device preference without silently applying Online.
  - The default-provider probe can distinguish a reachable local default from an unreachable local default.
  - The chat composer disables send and shows model setup guidance when Gateway is connected but the default provider probe reports no usable model route.
  - Existing manual channel selection and cloud provider validation behavior remain unchanged.
docs:
  required: false
---

Karunesh's moe.21 startup log showed Gateway connected, but startup selected `ollama-ollamalo/qwen2.5:3b-instruct` and ordinary `Hi` turns failed with local transport `Connection error`. The root failure was not email/Outlook; the app presented a usable chat while the selected model provider route was not usable. This task scopes the repair to startup provider import/readiness and the existing Host API/UI readiness contract.
