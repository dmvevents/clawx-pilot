---
id: clwx123-outlook-recipient-proof
title: Repair Outlook v2 active-compose recipient and multiline body proof
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: >-
  Ensure Outlook v2 draftEmail creates one reviewable sandbox draft whose
  recipient, subject, and multiline body are proven from the active compose
  surface before any send-capable flow can proceed.
touchedAreas:
  - harness/specs/tasks/clwx123-outlook-recipient-proof.md
  - electron/services/outlook-browser-v2/outlook-actions.ts
  - tests/unit/outlook-actions-safety.test.ts
  - docs/COMPLETION_PLAN.md
  - docs/GA_RELEASE_EVIDENCE_MANIFEST.md
  - docs/plane-board/CLWX-board-export.json
  - docs/plane-board/CLWX-board.md
expectedUserBehavior:
  - Product draftEmail creates a new Outlook draft only when no unrelated open draft is present.
  - The prepared draft is left open for user review and is never sent by this task.
  - Recipient proof comes from the exact active compose To/Cc/Bcc bucket, not from Outlook chrome, suggestions, ancestor text, mailbox rows, or body text.
  - Multiline body readback uses rendered body text so Outlook block markup boundaries are preserved without replacing editor content.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - gateway-readiness-policy
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - docs-sync
  - comms-regression
requiredTests:
  - tests/unit/outlook-actions-safety.test.ts
acceptance:
  - Exact active-compose To/Cc/Bcc selectors pass while broad recipient-looking decoys fail closed.
  - Suggestion-list options do not count as committed recipients.
  - Inbox rows, folders, reading panes, body text, and compose ancestors do not satisfy recipient assertions.
  - Multiline draft body verification and readback use rendered body text before textContent so block markup does not concatenate line boundaries.
  - Live diagnostic creates one owned CLWX123 sandbox draft, clicks no Send control, and reads back matching recipient, subject, and normalized multiline body.
docs:
  required: true
  expectedPaths:
    - docs/COMPLETION_PLAN.md
    - docs/GA_RELEASE_EVIDENCE_MANIFEST.md
    - docs/plane-board/CLWX-board-export.json
    - docs/plane-board/CLWX-board.md
---

# CLWX123 — Outlook v2 active-compose recipient and body proof

Outlook Web exposes recipient-looking text across compose chrome, suggestion popups, ancestor nodes, and mailbox rows. Release safety must not infer recipient correctness from broad selectors such as `[aria-label*="recipient" i]` outside the active compose surface.

The same draft path must handle stakeholder-style multiline body text through rendered body extraction. Product acceptance is a reviewable draft whose readback confirms the requested recipient bucket, subject, and normalized multiline body without clicking Send, while shared reply/forward body insertion keeps existing quote and signature content intact.

## Prohibited actions

No send, reply, forward, attachment download, Forms submit, VM, GitHub, Plane, or non-CLWX123 draft mutation.
