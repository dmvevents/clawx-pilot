---
id: deny-ondevice-gateway-tool
title: Deny the internal gateway tool for on-device qwen chat turns
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Prevent the local qwen2.5 on-device provider from looping on invalid internal gateway tool calls during ordinary chat while preserving principal, plugin, and cloud tool behavior.
touchedAreas:
  - harness/specs/tasks/deny-ondevice-gateway-tool.md
  - electron/utils/ondevice-tool-policy.ts
  - tests/unit/ondevice-tool-policy.test.ts
expectedUserBehavior:
  - On-device ordinary principal chat answers do not enter a gateway tool-call repair loop.
  - Principal document tools and MoE plugin tools remain available to the on-device provider.
  - Online/cloud providers retain their untrimmed tool catalog.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - gateway-readiness-policy
requiredTests:
  - pnpm exec vitest run tests/unit/ondevice-tool-policy.test.ts
  - pnpm harness validate --spec harness/specs/tasks/deny-ondevice-gateway-tool.md
acceptance:
  - The real OpenClaw tool-policy matcher rejects gateway for the ollama-ollamalo provider after the on-device trim.
  - The real OpenClaw tool-policy matcher continues to allow read, write, edit, message, exec, outlook_send_email, forms_fill and moe_draft_letter for the trimmed on-device provider.
  - A provider with no on-device trim policy still keeps the full representative catalog, including gateway.
  - No chat timeout, watchdog or renderer degradation threshold is changed.
docs:
  required: false
---

Clean Windows moe.21 evidence showed the local qwen2.5 provider repeatedly calling the internal `gateway` tool with invalid arguments instead of answering an ordinary principal prompt. This task scopes the source regression to the on-device tool policy and leaves installed Windows proof to the VM acceptance pass for the rebuilt artifact.
