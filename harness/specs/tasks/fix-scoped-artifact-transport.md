---
id: fix-scoped-artifact-transport
title: Scope the artifact transport harness to the MoE plugin
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Keep the artifact transport preflight on the real staged OpenClaw plugin-host boundary without loading every discovered OpenClaw plugin during package builds.
touchedAreas:
  - scripts/harness-artifact.mjs
  - scripts/harness-artifact-transport-child.mjs
  - tests/unit/harness-artifact.test.ts
  - harness/specs/tasks/fix-scoped-artifact-transport.md
expectedUserBehavior:
  - Package preflight still proves the staged MoE plugin registers the exact no-hostapi and full-hostapi tool inventories through OpenClaw's real plugin loader.
  - The transport harness does not spend the Windows package lane loading unrelated OpenClaw plugins before checking the MoE plugin.
  - A broad diagnostics payload, wrong plugin id, missing tools, or extra plugin list cannot satisfy the transport row.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - completion-evidence
  - backend-communication-boundary
requiredTests:
  - tests/unit/harness-artifact.test.ts
acceptance:
  - Transport rows use the staged OpenClaw loader with onlyPluginIds for moe-principal-assistant.
  - The hermetic state/home, staged-source validation, and fetch-stub sentinel remain enforced.
  - Both gateway-transport.no-hostapi and gateway-transport.full pass against the local staged bundle before a native Windows rerun.
docs:
  required: false
---

The package fast lane failed on hosted Windows because `openclaw plugins inspect
moe-principal-assistant --json` builds a full diagnostics report before
filtering to the requested plugin. This task keeps the real OpenClaw loader
boundary but makes the row scoped to the MoE plugin so unrelated plugin startup
cost cannot block installer packaging.
