---
id: moe30-integration-approved-repairs
title: Integrate the approved CLWX-61, CLWX-130 and CLWX-102 repairs into one candidate
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Carry three independently approved repairs that existed only in author worktrees into a single identified candidate, so one artifact can demonstrate them. The frozen moe.29 installer contains none of them, and it additionally ships the browser identity code with two reproduced fail-open paths still live because the rejected revision and its first correction are ancestors of that candidate while the fail-open fix is not.
touchedAreas:
  - electron/services/chrome-cdp.ts
  - electron/services/outlook-browser-v2/outlook-actions.ts
  - electron/gateway/config-sync.ts
  - electron/gateway/manager.ts
  - electron/gateway/supervisor.ts
  - electron/utils/e2e-gateway-guard.ts
  - electron/utils/openclaw-doctor.ts
  - tests/e2e/fixtures/electron.ts
  - tests/unit/chrome-cdp.test.ts
  - tests/unit/config-sync.test.ts
  - tests/unit/e2e-gateway-guard.test.ts
  - tests/unit/gateway-manager-e2e-launch-guard.test.ts
  - tests/unit/gateway-supervisor-doctor-repair.test.ts
  - tests/unit/openclaw-doctor.test.ts
  - tests/unit/outlook-attachment-metadata.test.ts
  - package.json
  - harness/specs/tasks/moe30-integration-approved-repairs.md
expectedUserBehavior:
  - A principal's own Chrome is never mistaken for another user's, and the assistant refuses to drive a browser endpoint it cannot attribute, instead of attaching to a stranger's session.
  - Reading an email with attachments reports each real attachment's name, size and type, and reports none for a chip that carries no name, so a nameless entry can no longer be handed to the confirmation-gated retrieval step.
  - Running the desktop test suite never starts or terminates a real backend on the operator's machine.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - completion-evidence
requiredTests:
  - tests/unit/chrome-cdp.test.ts
  - tests/unit/outlook-attachment-metadata.test.ts
  - tests/unit/gateway-manager-e2e-launch-guard.test.ts
acceptance:
  - Each integrated commit is equivalent to the revision its own independent review approved; no content is altered or dropped by integration.
  - The candidate carries a new unused version identity, and no earlier version's evidence is reused for it.
  - The E2E launch guard is inert outside test mode, so no production gateway start behaviour changes.
  - The browser ownership check compares real path containment, and the attach gate refuses an endpoint that answers HTTP while reporting no attributable listener.
  - Attachment extraction emits no entry without a name, and the regression rows fail both when the repair is reverted and when a placeholder name is substituted.
  - Nothing unrelated or held is carried in; any excluded approved repair has a criterion-based disposition rather than an implicit omission.
docs:
  required: false
---

This spec exists because integration was the missed step, not the repairs. Each of the three lanes was independently reviewed and approved in its own worktree, and each verdict remains valid for its own diff; this task covers only whether the integration is faithful, complete and release-appropriate, and whether the resulting candidate can be bound to a package receipt.

Source and package gates here prove nothing about installed behaviour. Installed startup with an existing state database, ordinary chat, the doctor-repair path, tenant and client evidence, and unaided stakeholder acceptance all remain separate stages on their own cards, and the interactive test-desktop blocker is tracked independently of this integration.
