---
id: upgrade-openclaw-2026-9
title: Upgrade bundled OpenClaw runtime to 2026.9.2
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Keep the packaged Gateway runtime compatible with the current OpenClaw release while preserving ClawX backend communication behavior.
touchedAreas:
  - harness/specs/tasks/upgrade-openclaw-2026-9.md
  - package.json
  - pnpm-lock.yaml
  - extensions/moe-principal-assistant/openclaw.plugin.json
  - scripts/bundle-openclaw.mjs
  - scripts/verify-openclaw-bundle.mjs
  - scripts/download-bundled-node.mjs
  - scripts/ensure-electron-runtime.mjs
  - scripts/harness-artifact-transport-child.mjs
  - resources/cli/win32/openclaw
  - resources/cli/win32/openclaw.cmd
  - scripts/openclaw-2026-9-upgrade-verifier.mjs
  - tests/unit/openclaw-2026-9-upgrade-verifier.test.ts
  - tests/unit/clwx92-bundle-fixture.test.ts
  - tests/unit/openclaw-chat-history-patch.test.ts
  - tests/unit/openclaw-pricing-cache-patch.test.ts
  - tests/unit/openclaw-sdk-alias-patch.test.ts
  - tests/unit/harness-artifact.test.ts
  - tests/unit/moe-principal-assistant-plugin.test.ts
  - tests/unit/windows-package-inspection.test.ts
expectedUserBehavior:
  - A packaged Windows Gateway starts with a Node runtime satisfying OpenClaw's declared engine range.
  - Renderer/backend Gateway calls keep using the existing Host API and RPC boundaries.
  - OpenClaw bundle verification fails closed if a required fork patch is obsolete, missing, or mismatched.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - gateway-readiness-policy
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
acceptance:
  - The package lock resolves openclaw 2026.9.2 and compatible channel/runtime dependencies.
  - The standalone bundled Windows Node and Electron UtilityProcess runtime satisfy OpenClaw's engine range.
  - The OpenClaw bundle verifier checks the actual new patch disposition instead of bypassing stale 2026.4.23 patch guards.
  - Focused bundle/runtime tests and the gateway-backend-communication harness validation pass on the changed source.
docs:
  required: false
---

This task covers the bounded OpenClaw runtime upgrade lane. It does not publish,
dispatch a hosted build, install on a VM, alter release holds, or claim installed
Windows acceptance. Installed package and stakeholder acceptance remain separate
release gates.
