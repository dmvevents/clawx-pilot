---
id: document-title-discovery
title: Resolve named local documents before asking for pasted content
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Give the principal assistant bounded metadata-only document discovery so ordinary titles resolve to exact file paths before the existing format readers run, and preserve native image content delivery for VLM-visible image reads.
touchedAreas:
  - extensions/moe-principal-assistant/doc-tools.mjs
  - extensions/moe-principal-assistant/index.mjs
  - extensions/moe-principal-assistant/persona.mjs
  - scripts/harness-artifact.mjs
  - tests/e2e/prompts.json
  - tests/e2e/golden/P5-image-fields.json
  - tests/unit/harness-windows-e2e.test.ts
  - scripts/harness-artifact-child.mjs
  - harness/run.ts
  - tests/unit/moe-principal-assistant-doc-tools.test.ts
  - tests/unit/moe-principal-assistant-plugin.test.ts
  - tests/unit/doc-tooling-steering.test.ts
  - tests/unit/harness-artifact.test.ts
  - tests/unit/harness-windows-e2e.test.ts
  - tests/e2e/chat-task-visualizer.spec.ts
  - harness/specs/tasks/document-title-discovery.md
  - harness/specs/rules/document-discovery-boundary.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - docs/PRODUCT_PRINCIPAL_ASSISTANT.md
  - docs/APP_WORKFLOWS_TEST_MATRIX.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - The assistant finds a named local document inside the supplied folder before requesting the user to upload or paste content.
  - Folder inventory and title lookup use document.find without shell commands, content reads or new dependencies.
  - Ambiguous or incomplete discovery asks the principal to choose a candidate; exact readers do not guess.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - document-discovery-boundary
  - completion-evidence
requiredTests:
  - tests/unit/moe-principal-assistant-doc-tools.test.ts
  - tests/unit/moe-principal-assistant-plugin.test.ts
  - tests/unit/doc-tooling-steering.test.ts
  - tests/unit/harness-artifact.test.ts
  - tests/unit/harness-windows-e2e.test.ts
  - tests/e2e/chat-task-visualizer.spec.ts
acceptance:
  - A supplied testing folder containing a numerically prefixed underscored PDF resolves an ordinary matching title into an exact path.
  - Discovery returns only bounded metadata from permitted canonical home or temp roots, refusing symlink escapes and UNC paths.
  - Multiple plausible candidates, exhausted traversal budget and incomplete result sets never claim a unique safe match.
  - Exact reader behavior and existing format support remain intact.
  - document.read_image returns a native image content block plus metadata text/details; harness goldens reject legacy dataUrl-only, text-only or empty-image results.
  - Registration and real staged plugin-host inventories include the discovery tool.
  - A fresh installed Windows session answers the original PDF prompt with actual document.find and document.read_pdf calls and correct source content.
  - The original PDF prompt's summary preserves distinct actionable deadlines plus required district/form routing and explanations from the source, without collapsing separate obligations into one deadline.
docs:
  required: true
---

Installed moe.21 discovery and Word journeys passed, but the fresh-session PDF
prompt asked for pasted text without calling a tool. The source has exact file
readers and no model-facing title lookup. Add one bounded metadata tool and keep
content access in the existing readers. Reuse the current search-root and
breadth-first traversal policy; do not make readers choose fuzzy paths.
