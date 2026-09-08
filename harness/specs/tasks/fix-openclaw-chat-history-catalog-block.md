---
id: fix-openclaw-chat-history-catalog-block
title: Fix OpenClaw chat.history catalog blocking
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Return startup chat.history without waiting on a cold Gateway model catalog used only to infer a missing thinkingLevel.
touchedAreas:
  - harness/specs/tasks/fix-openclaw-chat-history-catalog-block.md
  - scripts/bundle-openclaw.mjs
  - scripts/openclaw-chat-history-patch.mjs
  - scripts/verify-openclaw-bundle.mjs
  - tests/unit/clwx92-bundle-fixture.test.ts
  - tests/unit/openclaw-chat-history-patch.test.ts
expectedUserBehavior:
  - A fresh Windows startup can load visible chat history while the optional model catalog is still warming.
  - Explicit session thinking settings and configured thinking defaults still reach the renderer.
  - Actual chat.send model and thinking resolution remains owned by OpenClaw's turn execution path.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - gateway-readiness-policy
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
acceptance:
  - chat.history no longer awaits context.loadGatewayModelCatalog only to derive a missing thinkingLevel.
  - chat.history still returns unchanged messages, sessionId, fastMode and verboseLevel fields.
  - Persisted entry.thinkingLevel wins.
  - Configured per-model thinking and agents.defaults.thinkingDefault are preserved.
  - The OpenClaw bundle patch is idempotent and fails closed if the pinned target snippets drift.
docs:
  required: false
---

This task covers the runtime-bundle side of the September 8 startup finding:
`chat.history` waited on `context.loadGatewayModelCatalog()` after messages were
already loaded and sanitized. The catalog call was used only to infer a missing
`thinkingLevel`, so a cold catalog could block the first visible history response
and starve the Windows startup path.

The fix must stay narrow. Do not increase Gateway or renderer timeouts, change
chat.send turn resolution, defer explicit model catalog RPCs globally, or alter
message sanitization. Patch only the pinned shipped OpenClaw bundle and verify
the patch as part of bundle verification.
