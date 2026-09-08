---
id: outlook-readiness-capability-diagnosis
title: Add a read-only Outlook/Graph readiness diagnosis owned by Main
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: >-
  Give the assistant a truthful, read-only answer path for "is the Microsoft
  Graph API installed / configured / signed in, and which transport will
  email use" so a capability question is never answered by probing fictional
  config paths or by navigating the principal's browser.
touchedAreas:
  - harness/specs/tasks/outlook-readiness-capability-diagnosis.md
  - electron/api/routes/outlook.ts
  - electron/api/routes/capabilities.ts
  - extensions/moe-principal-assistant/index.mjs
  - extensions/moe-principal-assistant/persona.mjs
  - extensions/moe-principal-assistant/openclaw.plugin.json
  - tests/unit/outlook-readiness-diagnostics.test.ts
  - tests/unit/clwx86-capability-handshake.test.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - docs/evidence/OUTLOOK_READINESS_FEEDBACK_2026-09-08.md
expectedUserBehavior:
  - Asking whether Microsoft Graph or cloud email is installed, configured, or signed in yields a plain answer plus the accurate next step, without any window opening or navigation.
  - The reported read/compose transports come from the same selection code real reads and composes execute, so the diagnosis can never disagree with behavior.
  - A failed Graph status read is reported as unknown, never as "not configured" or absent.
  - The Outlook window's own sign-in state is reported honestly as unknown by this check; only outlook.open or browser.diagnose observe browser state.
  - On an older installed app without the readiness route, the tool self-parks with the readable update-the-app message instead of a raw HTTP error.
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
  - tests/unit/outlook-readiness-diagnostics.test.ts
acceptance:
  - POST /api/outlook/readiness returns typed graph state signed_in / not_signed_in / not_configured / unknown plus per-lane { enabled, transport } and Mail.Send grant, and calls no browser-manager or Graph mailbox method.
  - Transport selection intent is shared between the readiness report and shouldUseGraphOutlookRead/Compose (single interpretation).
  - The plugin registers outlook.readiness behind the CLWX-86 capability gate; the drift triangle (route file, capabilities inventory, plugin route map) stays set-equal.
  - Persona and tool description forbid config-file inference and browser navigation for status questions and state that Graph never needs a local API install.
  - All fixtures stay synthetic; no real addresses or tenant identifiers in tests.
docs:
  required: true
  expectedPaths:
    - docs/evidence/OUTLOOK_READINESS_FEEDBACK_2026-09-08.md
---

# Outlook/Graph readiness — read-only capability diagnosis

Owner RDP feedback (2026-09-08, artifacts/ga-fable-20260908/graph-feedback): asked
"is the microsoft graph api installed", the installed assistant probed a
non-existent Outlook config path, reported it could not check the
configuration, and asked the user whether to run an Outlook tool. The plugin
exposed no read-only readiness surface — the only state-revealing entry was
outlook.open, which navigates the principal's browser.

Main owns actual availability, sign-in, and selected transport. The gateway
plugin reports that truth over one authenticated host-API route and teaches
the agent to distinguish bundled integration, configured client, signed-in
account, and usable browser session.

## Prohibited actions

No email read/draft/send, no browser navigation or window opening, no Forms
action, no Graph mailbox network call, no OAuth/consent or app-registration
change, no credential-file access.
