---
id: ollama-native-runtime-contract
title: Route managed on-device Ollama through OpenClaw native API
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Ensure the managed loopback Qwen on-device provider writes an OpenClaw 2026.9-compatible Ollama provider row so native /api/chat receives the validated context allocation instead of losing num_ctx through the OpenAI-compatible /v1 path.
touchedAreas:
  - harness/specs/tasks/ollama-native-runtime-contract.md
  - electron/main/local-provider-seed.ts
  - electron/shared/providers/types.ts
  - electron/services/providers/provider-runtime-sync.ts
  - electron/shared/pi-ai-model-cost.ts
  - tests/unit/gateway-boot-convergence.test.ts
  - tests/unit/provider-runtime-sync.test.ts
expectedUserBehavior:
  - On this device uses the managed loopback Ollama server at http://127.0.0.1:11434 with OpenClaw api: ollama.
  - The managed Qwen row carries aligned contextTokens and params.num_ctx metadata capped at the validated 32k on-device ceiling.
  - Cloud, remote custom providers, and explicitly OpenAI-compatible Ollama providers keep their current protocol and endpoint behavior.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - gateway-readiness-policy
  - active-config-guards
requiredTests:
  - pnpm exec vitest run tests/unit/gateway-boot-convergence.test.ts tests/unit/provider-runtime-sync.test.ts
  - pnpm exec tsc --noEmit
  - pnpm harness validate --spec harness/specs/tasks/ollama-native-runtime-contract.md
acceptance:
  - Fresh local seed stores the managed provider with root loopback baseUrl and apiProtocol: ollama.
  - Existing managed seed accounts with stale /v1 or openai-completions drift are repaired and re-synced idempotently.
  - Readiness probing supports native Ollama /api/tags as well as legacy /v1/models.
  - Runtime provider sync writes baseUrl root, api: ollama, and model metadata containing contextWindow, contextTokens, and params.num_ctx for the managed loopback Qwen provider.
  - Explicit OpenAI-compatible Ollama providers and managed MOE cloud/custom providers are unchanged.
docs:
  required: false
---

OpenClaw 2026.9.2 documents native Ollama provider rows with `api: "ollama"`, a root Ollama base URL, active budget `contextTokens`, and allocation `params.num_ctx`. The current managed local seed still writes `/v1` plus `openai-completions`; on Ollama 0.32.14 the OpenAI-compatible path does not preserve the context allocation reliably, so this repair is restricted to the managed loopback Qwen provider used by the Windows on-device lane.
