# Microsoft 365 Tooling Deep Dive

Date: 2026-06-05

## Objective

Make the Windows install work out of the box without asking the user to
configure Chrome, Chrome profiles, or remote debugging. The acceptable first-run
interaction is Microsoft sign-in. After sign-in, Outlook and official form
submissions should use Microsoft 365 APIs.

## Bottom Line

Use ClawX's internal Microsoft Graph path as the shipped product path. Use
off-the-shelf MCP servers only as development probes for tenant consent and
resource discovery.

The repo already contains most of the product foundation:

- `src/pages/Settings/MicrosoftGraphSection.tsx` provides tenant/client config
  and Microsoft sign-in.
- `electron/utils/microsoft-graph-oauth.ts` implements loopback OAuth with PKCE
  and manual-code fallback.
- `electron/services/microsoft-graph/manager.ts` stores/refreshes delegated
  tokens and exposes Graph mail calls.
- `electron/services/forms-graph/forms-graph-client.ts` can create SharePoint
  list items once IT provides site/list IDs and scopes.
- `resources/microsoft-graph.example.json` documents the non-secret packaged
  seed used to make fresh installs show Microsoft Graph as configured before
  the user signs in.

The missing product work is routing agent tools to Graph/SharePoint first when
signed in, then falling back to Chrome/CDP only when Graph is unavailable or a
visible browser review is specifically required.

## Tooling Researched

| Tool | Evidence from package/repo probe | Strength | Limitation | Use |
|---|---:|---|---|---|
| `@pnp/cli-microsoft365` | npm `11.8.0`; bin `m365` | Mature Microsoft 365 CLI; broad SharePoint/Power Platform/Outlook surface | Global setup/login oriented; not ideal to bundle inside Electron | Dev/admin probe |
| `@pnp/cli-microsoft365-mcp-server` | npm `0.1.22`; official PnP MCP server | Exposes CLI for Microsoft 365 commands through MCP; can manage Outlook, SharePoint, Power Automate, Teams, etc. | Requires globally installed CLI and prior `m365 login`; MCP server does not authenticate for us | Dev MCP probe |
| `@softeria/ms-365-mcp-server` | npm `0.114.1`; bin `ms-365-mcp-server`; uses MSAL; read-only/tool filtering | Broad Graph MCP surface, personal and org modes, permission listing | Third-party auth/token/logging surface must be audited before bundling | Dev MCP probe / design reference |
| `@mcp-z/mcp-outlook` | npm `1.0.13`; Outlook-only MCP; OAuth loopback/device-code modes | Focused Outlook search/read/send tool surface | Still needs app registration/client ID; no Forms/SharePoint | Outlook-specific dev probe |
| `Astral0/outlook-com-mcp` | GitHub repo found for Outlook desktop via COM/pywin32 | Could work when Outlook desktop is already installed and logged in | Windows-only, depends on Outlook desktop profile, not a Microsoft 365 API path | Emergency local fallback only |

## What "With The Login" Can Do

With a delegated Microsoft 365 login and the right tenant consent, ClawX can:

- Read profile: `/me`.
- Read/search messages: `/me/messages`.
- Create drafts: `POST /me/messages`.
- Send mail: `POST /me/sendMail`.
- Read calendars if consented.
- Resolve SharePoint sites/lists.
- Create SharePoint list items for official form destinations.
- Call an IT-owned Power Automate flow if IT chooses that path instead of
  direct SharePoint list writes.

What it cannot safely do from only username/password:

- Bypass MFA or Conditional Access.
- Use resource-owner-password flow in a modern school tenant.
- Submit Microsoft Forms through a stable public Forms API that Microsoft
  documents as a supported response-submission endpoint.

## Out-Of-Box Product Path

1. Package the app with tenant defaults:
   - `tenantId` or verified domain.
   - public-client `clientId`.
   - default scopes.
   - optional SharePoint form destination config.
   - preferred seed file: ignored `resources/microsoft-graph.json`, copied into
     packaged resources by `scripts/after-pack.cjs`.
2. On first launch, show one action: **Sign in with Microsoft 365**.
3. Use the signed-in token for Outlook Host API calls.
4. Use the same token for SharePoint list submission when form destinations are
   configured.
5. Keep Chrome/CDP as fallback:
   - if Graph is not configured
   - if user has not signed in
   - if the user specifically needs visible Outlook Web compose review
   - for attachment flows until Graph attachment download is implemented

Tenant defaults can be preseeded without storing any secret:

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
    "Mail.Send"
  ]
}
```

The environment route remains available for IT policy or manual diagnostics:

```powershell
setx CLAWX_MICROSOFT_GRAPH_TENANT_ID "moe.gov.tt"
setx CLAWX_MICROSOFT_GRAPH_CLIENT_ID "<public-client-id>"
setx CLAWX_MICROSOFT_GRAPH_SCOPES "openid profile email offline_access User.Read Mail.Read Mail.ReadWrite Mail.Send"
```

Short aliases also work for installer/policy scripts:

```powershell
setx CLAWX_MS_GRAPH_TENANT_ID "moe.gov.tt"
setx CLAWX_MS_GRAPH_CLIENT_ID "<public-client-id>"
```

## Admin Ask

Minimum Entra app:

- Platform: Mobile and desktop applications / public client.
- Redirect: `http://localhost:53682/callback`.
- Delegated scopes:
  - `openid`
  - `profile`
  - `email`
  - `offline_access`
  - `User.Read`
  - `Mail.Read`
  - `Mail.ReadWrite`
  - `Mail.Send`
  - `Calendars.Read` if calendar triage remains in scope
  - `Sites.Read.All` and `Sites.Selected` or `Sites.ReadWrite.All` for forms
    list discovery/submission.

Forms destination:

- SharePoint hostname.
- Site path or site ID.
- List display name or list ID per form.
- Internal column names and required fields.
- Test list for smoke tests.
- Or an IT-owned Power Automate HTTP endpoint per form.

## Dev Probe Commands

Use these only on a dev machine or pilot laptop when intentionally testing
tenant consent. They may create local OAuth cache/state. Do not print tokens.

```powershell
# Install/check the mature CLI route.
npm i -g @pnp/cli-microsoft365
m365 setup
m365 login
m365 status

# MCP wrapper after CLI login.
npx -y @pnp/cli-microsoft365-mcp-server@latest
```

```powershell
# Inspect Graph MCP permission demand before login.
npx -y @softeria/ms-365-mcp-server@latest --org-mode --preset mail --list-permissions
npx -y @softeria/ms-365-mcp-server@latest --org-mode --read-only --list-permissions
```

```powershell
# Outlook-only MCP; needs tenant/client env vars.
$env:MS_CLIENT_ID = "<public-client-id>"
$env:MS_TENANT_ID = "<tenant-id-or-domain>"
npx -y @mcp-z/mcp-outlook@latest --auth=device-code
```

## Current Implementation Change

The Host API Outlook route now prefers Microsoft Graph for core actions when
Graph is signed in or explicit mock mailbox is enabled:

- `/api/outlook/read-inbox`
- `/api/outlook/search-inbox`
- `/api/outlook/read-email`
- `/api/outlook/draft`
- `/api/outlook/send`

Graph send still refuses unless `confirm:true`. Drafting through Graph saves a
draft but does not claim that a browser compose pane is open.

Browser/CDP remains the fallback and still owns:

- `/api/outlook/open`
- reply/forward
- mark read
- list/download attachments
- visible compose review

## Decision

Do not bundle a third-party MCP server as the production Outlook/Forms engine.
Use MCPs to probe tenant capability and compare behavior, then implement the
small controlled Graph/SharePoint surface inside ClawX where token storage,
logs, and safety gates are auditable.
