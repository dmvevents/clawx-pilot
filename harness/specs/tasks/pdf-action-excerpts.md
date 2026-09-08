---
id: pdf-action-excerpts
title: Surface source-derived PDF action excerpts before raw text
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Give ordinary PDF-summary prompts model-visible source excerpts for explicit action, deadline, submission, exception and explanation sections while preserving the full extracted PDF text unchanged.
touchedAreas:
  - extensions/moe-principal-assistant/doc-tools.mjs
  - extensions/moe-principal-assistant/index.mjs
  - extensions/moe-principal-assistant/persona.mjs
  - tests/unit/moe-principal-assistant-doc-tools.test.ts
  - harness/specs/tasks/pdf-action-excerpts.md
expectedUserBehavior:
  - A five-minute summary of a Ministry circular is less likely to omit explicit deadline and routing lines that are present in the PDF.
  - The assistant still receives the original extracted PDF text and can answer from the whole source, not only from the excerpts.
  - Excerpts are bounded and source-derived; missing sections remain absent instead of invented.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - document-discovery-boundary
  - completion-evidence
requiredTests:
  - pnpm exec vitest run tests/unit/moe-principal-assistant-doc-tools.test.ts tests/unit/moe-principal-assistant-plugin.test.ts tests/unit/doc-tooling-steering.test.ts
  - pnpm harness validate --spec harness/specs/tasks/pdf-action-excerpts.md
acceptance:
  - document.read_pdf returns bounded source excerpts before raw text for explicit headings such as deadlines, required actions, submissions, exceptions and explanations.
  - The excerpt helper preserves source wording, including negations, conditions and wrapped lines, without injecting fixture-specific dates, organisations or mandatory labels.
  - Raw `text`, `truncated` and `totalChars` behavior remains unchanged.
  - The actual installed P3 prompt must still pass separately before release acceptance can claim the document journey is fixed.
docs:
  required: false
---

The installed moe.22 P3 retest used the correct scoped file discovery and read the
full ICT audit PDF, but the natural five-minute summary still omitted an explicit
deadline line that was present in the source. Tool-description guidance alone did
not make the model preserve all actionable dates. This task keeps the reader as a
source extractor and adds bounded source excerpts for explicit sections; it does
not hard-code the ICT fixture or replace installed prompt acceptance.
