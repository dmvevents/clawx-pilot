---
id: graph-connection-setup-states
title: Make Microsoft Graph connection setup states actionable on a vanilla install
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: A principal or IT administrator on a fresh Windows install must be able to tell from Settings whether Microsoft 365 is unconfigured, configured-but-signed-out, authenticating, signed in, expired, or was cancelled — and what to do next — without mock-mailbox fixtures masquerading as a live connection.
touchedAreas:
  - electron/services/microsoft-graph/connection-state.ts
  - electron/services/microsoft-graph/manager.ts
  - electron/utils/microsoft-graph-oauth.ts
  - electron/main/microsoft-graph-ipc.ts
  - src/lib/microsoft-graph.ts
  - src/pages/Settings/MicrosoftGraphSection.tsx
  - tests/unit/microsoft-graph-connection-state.test.ts
  - tests/unit/microsoft-graph-oauth-callback.test.ts
  - tests/unit/microsoft-graph-refresh-auth-required.test.ts
  - tests/e2e/settings-msgraph-connection.spec.ts
  - harness/specs/tasks/graph-connection-setup-states.md
  - docs/evidence/GRAPH_CONNECTION_SETUP_2026-09-08.md
expectedUserBehavior:
  - On a vanilla install with no tenant defaults, Settings states plainly that Microsoft 365 is not configured, that Outlook tools run against the demo mailbox until an administrator supplies Tenant + Client ID, and shows the administrator form.
  - After a valid configuration is saved, the section transitions to a signed-out state with a working Sign in button; saving does not claim any connection.
  - Cancelling or declining on the Microsoft sign-in page ends the in-app sign-in attempt promptly with a neutral "cancelled" outcome instead of a ten-minute hang followed by a manual-code prompt.
  - An expired access token is labelled as expired with a sign-in-again action; automatic refresh continues to work and a refresh rejected by Microsoft (invalid_grant / interaction_required) surfaces as "sign in again", not an opaque error.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - completion-evidence
requiredTests:
  - tests/unit/microsoft-graph-connection-state.test.ts
  - tests/unit/microsoft-graph-oauth-callback.test.ts
  - tests/e2e/settings-msgraph-connection.spec.ts
acceptance:
  - Renderer status gains a deterministic connectionState (unconfigured | signed_out | signed_in | expired) derived in the main process from existing persisted facts; no new renderer transport paths and no direct Gateway access are introduced.
  - The OAuth loopback callback interprets an error redirect (e.g. access_denied) immediately as a typed declined outcome; state mismatch and missing code remain failures, and the manual-code fallback still exists for port_in_use / timeout.
  - A refresh-token rejection with invalid_grant or interaction_required is classified as AUTH_REQUIRED so callers prompt re-sign-in rather than retrying blindly.
  - Mock mailbox / effectiveMock is never presented as a live Microsoft 365 connection; tenant registration values are never invented and interactive sign-in remains an account-holder action outside automated tests.
docs:
  required: false
---

Scope guard: this task changes only the Microsoft Graph connection setup surface (status derivation, sign-in cancel/expiry classification, Settings copy). It does not alter Graph draft/send permission policy, Outlook routes, browser automation or extension capability gates, and it does not add SDK dependencies or rebuild the existing PKCE flow.
