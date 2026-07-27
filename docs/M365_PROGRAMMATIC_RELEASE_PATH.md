# Microsoft 365 Programmatic Release Path

## Target Result

Fresh Windows installs should not require principals to configure Chrome,
remote debugging, provider keys, or command-line tools. The acceptable first
run interaction is:

1. install the Ministry of Education app;
2. open the app from the desktop shortcut;
3. sign in with Microsoft 365 when the app asks;
4. use chat to read/draft Outlook mail and preview/fill MoE forms.

## Programmatic Outlook Path

Outlook should use Microsoft Graph first, through ClawX Host API routes:

- `POST /api/outlook/read-inbox`
- `POST /api/outlook/search-inbox`
- `POST /api/outlook/read-email`
- `POST /api/outlook/draft`
- `POST /api/outlook/send`

The current Host API already prefers Graph when Microsoft 365 is signed in and
falls back to Chrome/CDP only when Graph is unavailable. Sending still refuses
without `confirm:true`.

Required tenant setup:

- Entra public-client app registration.
- Redirect URI: `http://localhost:53682/callback`.
- Delegated scopes: `openid`, `profile`, `email`, `offline_access`,
  `User.Read`, `Mail.Read`, `Mail.ReadWrite`, `Mail.Send`.
- Optional: `Calendars.Read` if calendar triage remains in scope.

Package defaults are non-secret and can be injected into:

```text
resources/microsoft-graph.json
```

The ignored release file follows:

```json
{
  "enabled": true,
  "tenantId": "moe.gov.tt",
  "clientId": "<public-client-id>",
  "redirectUri": "http://localhost:53682/callback",
  "scopes": [
    "openid",
    "profile",
    "email",
    "offline_access",
    "User.Read",
    "Mail.Read",
    "Mail.ReadWrite",
    "Mail.Send",
    "Calendars.Read"
  ]
}
```

Do not put `clientSecret`, `apiKey`, passwords, refresh tokens, or mailbox
content in this file. The client ID is public. User tokens are created only
after Microsoft sign-in.

## Programmatic Forms Path

There are two supported paths:

- **GA path:** submit structured form payloads to an IT-owned destination:
  SharePoint Lists through Microsoft Graph, or Power Automate/Logic Apps HTTP
  endpoints that write to SharePoint/Excel/Dataverse.
- **Demo fallback:** fill the existing Microsoft Forms browser UI through the
  ClawX-owned Chrome/CDP driver, then wait for explicit same-session
  `yes, submit`.

Do not treat reverse-engineered `forms.office.com/formapi` response submission
as GA. It can remain a diagnostic/probe path, but it is not the stable install
package path.

For the SharePoint Graph path, IT provides:

- SharePoint hostname and site path or site ID.
- List display name or list ID for Daily Report.
- List display name or list ID for Suspensions.
- Internal column names and required field list per form.
- Delegated or application permission approach approved by tenant policy.

For the Power Automate path, IT provides one HTTPS endpoint per form, owned by
the tenant and mapped to the official destination store. Treat endpoint URLs as
bearer secrets; do not commit them.

## Installer Shift

The Windows package now has three seed layers:

| Seed | File | Secret? | Purpose |
|---|---|---:|---|
| Online model gateway | `resources/cloud-gateway.json` + `cloud-gateway.key` | key is secret | Make chat work through our controlled gateway without exposing upstream model keys. |
| Microsoft Graph defaults | `resources/microsoft-graph.json` | no | Make Outlook show as configured and ready for Microsoft sign-in. |
| Gateway plugin schema | `%USERPROFILE%\.openclaw\openclaw.json` placeholders | no | Prevent gateway validation from failing on fresh installs. |

GitHub Actions packaging inputs:

- `CLAWX_CLOUD_GATEWAY_CONFIG_JSON` secret.
- `CLAWX_CLOUD_GATEWAY_KEY` secret.
- `CLAWX_MICROSOFT_GRAPH_CONFIG_JSON` repository secret or variable.
- `requireCloudGatewaySeed=true` for release builds.
- `requireMicrosoftGraphSeed=true` only after IT returns the Entra app
  registration.

## Validation

Local checks:

```bash
pnpm exec vitest run tests/unit/microsoft-graph-store.test.ts tests/unit/outlook-routes-graph.test.ts tests/unit/microsoft-graph-outlook-adapter.test.ts
pnpm run typecheck
```

Packaging checks:

```bash
pnpm run build:win
```

Fresh Windows install proof must show:

- desktop shortcut launches the app;
- Host API and Gateway are reachable;
- online model provider is defaulted to the managed gateway;
- Microsoft Graph status is `configured: true` when the seed is packaged;
- Microsoft Graph sign-in opens Microsoft login, then `signedIn: true`;
- inbox read/draft uses `transport=graph` in Host API logs;
- send refuses without `confirm:true`;
- Forms preview works in browser fallback after Microsoft sign-in, or the
  configured SharePoint/Power Automate path dry-runs without submitting.

## Admin Packet

Ask IT for:

- Entra tenant ID or verified domain.
- Public client application ID.
- Confirmation that redirect `http://localhost:53682/callback` is registered.
- Delegated consent for Outlook scopes.
- SharePoint/Power Automate destination details for the two forms.
- A test mailbox and test form/list destination for installer smoke tests.

## Current Release State

Programmatic Outlook is code-ready once the Entra app registration exists and
is packaged through `resources/microsoft-graph.json`.

Programmatic Forms is not complete until IT chooses either SharePoint List
writes or Power Automate endpoints and provides destination mappings. Browser
Forms remains the controlled demo fallback with no-submit safety gates.
