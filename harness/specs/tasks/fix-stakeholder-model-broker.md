---
id: fix-stakeholder-model-broker
title: Package model broker runtime imports and preserve Vertex OpenAI endpoint paths
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Ensure the standalone model broker starts from its packaged Docker context and proxies Vertex/OpenAI-compatible chat routes to the documented upstream path.
touchedAreas:
  - harness/specs/tasks/fix-stakeholder-model-broker.md
  - services/model-broker/Dockerfile
  - services/model-broker/server.mjs
  - tests/unit/model-broker.test.ts
expectedUserBehavior:
  - The broker container includes every local module imported by server.mjs.
  - Ordinary OpenAI-compatible upstream bases ending in /v1 still receive /v1/chat/completions and /v1/responses.
  - Vertex OpenAI-compatible bases ending in /endpoints/openapi receive /chat/completions and /responses without an extra /v1 segment.
  - Broker auth, model allowlisting, streaming proxy, and usage metering behavior remain unchanged; interrupted streams do not crash the broker.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
requiredTests:
  - pnpm harness validate --spec harness/specs/tasks/fix-stakeholder-model-broker.md
  - pnpm exec vitest run tests/unit/model-broker.test.ts tests/unit/model-broker-caps.test.ts
acceptance:
  - Dockerfile source completeness is covered by a regression that verifies every relative server.mjs import is copied into the runtime image context.
  - Vertex ADC/OpenAI-compatible chat completions are proxied to /endpoints/openapi/chat/completions, matching the documented base URL contract.
  - Ordinary OpenAI-compatible /v1 upstream behavior is preserved by focused regression coverage.
  - Unauthorized requests, inherited object keys, and invalid model-map values still avoid upstream calls.
  - Streaming upstream responses keep their timeout active until the body finishes, abort upstream work when the client disconnects, and do not terminate the broker when interrupted after headers.
docs:
  required: false
---

Stakeholder testing is blocked by client connectivity and broker reliability concerns. This task keeps the repair limited to the model broker package boundary and upstream path construction; it does not change credentials, deployment, VM state, release artifacts, or message-sending behavior.
