---
id: microsoft-outlook-graph-compose-diagnostics
title: Distinguish Microsoft Graph draft and send permission diagnostics
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Keep Outlook Graph compose diagnostics aligned with Microsoft Graph's separate draft and send permission contracts so a tenant that can create drafts is not reported as unable to draft solely because Mail.Send is absent.
touchedAreas:
  - harness/specs/tasks/microsoft-outlook-graph-compose-diagnostics.md
  - electron/api/routes/outlook.ts
  - electron/services/microsoft-graph/outlook-adapter.ts
  - tests/unit/outlook-routes-graph.test.ts
  - tests/unit/microsoft-graph-outlook-adapter.test.ts
expectedUserBehavior:
  - When Graph compose is explicitly enabled and the signed-in tenant grants Mail.ReadWrite but not Mail.Send, draft_email can create a saved Graph draft instead of reporting that Microsoft 365 cannot draft.
  - When Graph send is explicitly enabled without Mail.Send, send_email refuses with setup guidance before any send call.
  - When Graph draft or send receives a 403 from Microsoft 365, the refusal names the permission needed for that operation.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - renderer-main-boundary
  - comms-regression
requiredTests:
  - pnpm exec vitest run tests/unit/outlook-routes-graph.test.ts tests/unit/microsoft-graph-outlook-adapter.test.ts
  - pnpm harness validate --spec harness/specs/tasks/microsoft-outlook-graph-compose-diagnostics.md
acceptance:
  - The Outlook Host API draft route no longer pre-requires Mail.Send when Graph compose is enabled.
  - The Outlook Host API send route still pre-requires Mail.Send and never silently falls back to the browser lane for a Graph send scope failure.
  - Graph adapter 403 refusals distinguish draft creation guidance from send guidance.
  - Browser Outlook draft/send behavior and explicit mock mailbox behavior remain unchanged.
docs:
  required: false
---

Karunesh's stakeholder feedback includes generic "assistant could not be reached" reports that can mask different Microsoft transport states. This task keeps the Graph compose contract diagnostic precise: draft creation and message sending have separate Microsoft Graph endpoints and grants, so the app must not collapse them into one read-only failure.
