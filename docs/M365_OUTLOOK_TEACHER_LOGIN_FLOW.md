# Microsoft 365 Outlook Login Flow For Teachers

This document describes the Microsoft Graph design and administrator rollout requirements. Give end users [Connect your email and forms](USER_GUIDE.md), which covers their own account, browser sign-in, the separate in-app connection and Forms access. QA uses a designated test mailbox to validate that same workflow; it is not the account supplied to end users. Design targets below are not installed-release acceptance evidence.

## Target Result

Every teacher or principal can install the Ministry app, open it, sign in with
their Microsoft 365 work or school account, and use Outlook tools without
Chrome debugging setup, browser extensions, or model-provider keys.

## Production Design

Use Microsoft Graph delegated access with a public-client Entra application.
For Electron, the recommended implementation shape is MSAL Node with
authorization code flow plus PKCE.

Each teacher signs in as themselves. Tenant-wide admin consent pre-approves the
requested permissions, but it does not bulk-authenticate users. The app still
needs a per-user sign-in on each device/account.

The app receives delegated tokens for that signed-in user and can read, draft,
and send only as that mailbox within the approved scopes. The client ID and
tenant ID are non-secret package configuration. There is no desktop client
secret.

## Required Entra Setup

Ask the administrator for:

- tenant ID or verified tenant domain;
- public-client application ID;
- redirect URI: `http://localhost:53682/callback`;
- delegated permission consent for:
  - `openid`
  - `profile`
  - `offline_access`
  - `User.Read`
  - `Mail.ReadWrite`
  - `Mail.Send`
- optional delegated permission consent for:
  - `email`, only if the app reads email from identity-token claims;
  - `Mail.Read`, only if a read-only mode is separated from draft/send mode;
- test mailbox with an active Outlook license;
- whether conditional access or MFA policies apply to desktop/public-client
  apps;
- whether admin consent can be granted tenant-wide before rollout.

## App Behavior

1. Package `resources/microsoft-graph.json` with tenant ID, public client ID,
   redirect URI, and scopes.
2. On first Outlook request, check Graph config and token state.
3. If unsigned, open Microsoft sign-in.
4. Acquire tokens silently first and fall back to interactive sign-in only when
   Microsoft requires interaction.
5. Store account metadata and token-cache material in the app's Microsoft Graph
   store. Before GA signing, evaluate `@azure/msal-node-extensions` so Windows
   token-cache persistence uses DPAPI instead of plain app JSON.
6. Use Graph first for read/search/draft/send.
7. Fall back to browser only when Graph is unavailable and the release policy
   allows the fallback.
8. Keep send guarded by same-session confirmation.

## Support Logging Flow

For each teacher/principal, support needs enough signal to diagnose sign-in
without exposing mailbox data or tokens.

Safe fields:

- Graph config present: yes/no.
- Tenant ID/domain.
- Client ID suffix only, for example last 6 characters.
- Signed-in account domain, or redacted account such as `t***@school.edu`.
- Granted scope names.
- Token status: missing, valid, expired, refresh failed.
- Last token refresh timestamp.
- Outlook transport used: `graph` or controlled browser fallback.
- Last Graph error code and HTTP status.
- Whether Microsoft sign-in is required.

Never log:

- access tokens;
- refresh tokens;
- authorization codes;
- passwords;
- full email bodies;
- private recipient lists;
- attachment content;
- private Microsoft Forms URLs.

## Teacher Experience

Expected:

- install;
- open the desktop shortcut;
- sign in with Microsoft when prompted;
- use email commands.

Not expected:

- install Chrome MCP;
- enable Chrome remote debugging;
- open `chrome://flags`;
- paste provider keys;
- choose a model provider.

## Rollout Plan

### Pilot

- Keep browser fallback available.
- Package Graph config only after administrator supplies the real Entra app.
- Capture `transport=graph` in Host API logs for read/search/draft/send.
- Keep no-send tests and installed-app smoke evidence.

### GA

- Make Graph the primary supported Outlook path.
- Treat browser fallback as a support/diagnostic path, not the default teacher
  instruction.
- Add a Microsoft sign-in status panel in Settings for support staff.
- Add a redacted support bundle entry for Graph status, tenant, scopes, account
  email domain, and last token refresh result.

## Open Decisions

- Whether to require tenant-wide admin consent before broad teacher rollout.
- Whether Forms destinations should use the same delegated user token or an
  IT-owned Power Automate endpoint.
- Whether token storage must move from `electron-store` to OS keychain before
  GA signing.
- Whether the redirect URI should stay as `http://localhost:53682/callback` or
  move to the MSAL Electron custom-URI pattern before final tenant approval.

## Acceptance Criteria

- Fresh install shows Microsoft Graph configured when `resources/microsoft-graph.json` is packaged.
- First email request opens Microsoft sign-in if needed.
- After sign-in, inbox read/search/draft uses Graph transport.
- Send refuses without explicit same-session confirmation.
- Send succeeds only after explicit same-session confirmation and exact draft
  verification.
- A second teacher on the same tenant signs in with their own mailbox and sees
  only their own Outlook data.

## Official References

- Microsoft identity platform Electron desktop tutorial:
  `https://learn.microsoft.com/en-us/entra/identity-platform/tutorial-v2-nodejs-desktop`
- Microsoft identity platform desktop app configuration:
  `https://learn.microsoft.com/en-us/entra/identity-platform/scenario-desktop-app-configuration`
- Microsoft identity platform token cache guidance:
  `https://learn.microsoft.com/en-us/entra/identity-platform/msal-acquire-cache-tokens`
- Microsoft Graph permissions overview:
  `https://learn.microsoft.com/en-us/graph/permissions-overview`
- Microsoft Graph permissions reference:
  `https://learn.microsoft.com/en-us/graph/permissions-reference`
- Microsoft Entra admin consent guidance:
  `https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/grant-admin-consent`
