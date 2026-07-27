# Microsoft 365 Programmatic Access Plan

Date: 2026-06-05

## Decision Summary

For production, Outlook should move to Microsoft Graph with a tenant-approved
Entra app registration. Microsoft Forms should not depend on the volatile Forms
web UI; use either a SharePoint-list submission target exposed through Graph or
an IT-owned Power Automate HTTP trigger per form. Keep the Chrome/CDP browser
driver as the demo and emergency fallback because it rides the principal's
existing signed-in browser session and preserves visible review gates.

MCP can help as a tool surface, but it does not remove the Microsoft 365
authorization problem. Any MCP server that reads mail or writes form data still
needs the same delegated/app permissions, tenant consent, and data-loss rules.

## Supported Access Paths

| Capability | Production path | Admin requirement | Demo fallback |
|---|---|---|---|
| Read Outlook inbox | Microsoft Graph `/me/messages` delegated user token | Entra app + `Mail.Read` or `Mail.ReadWrite` + admin consent if required | Outlook Web via Chrome CDP |
| Draft Outlook mail | Microsoft Graph create draft `/me/messages` | Entra app + `Mail.ReadWrite` | Outlook Web compose via Chrome CDP |
| Send Outlook mail | Microsoft Graph `/me/sendMail` | Entra app + `Mail.Send`; keep same visible confirmation semantics in ClawX | Outlook Web send button via Chrome CDP hard gate |
| Submit Forms data | Graph writes to an IT-provided SharePoint list, or Power Automate HTTP trigger writes to the official destination | SharePoint site/list identifiers and `Sites.Selected`/`Sites.ReadWrite.All`, or IT-owned flow URL | Microsoft Forms response page via Chrome CDP |
| Create/manage Forms | Not recommended for production through UI automation | Prefer IT-created forms/lists/flows | Manual one-time form clone or captured internal API for lab only |

## What To Ask The Administrator For

### Entra app registration

Ask MoE IT to create or approve a public-client app registration for the
desktop app:

- App type: public client / mobile and desktop application.
- Redirect URI: loopback redirect such as `http://localhost:53682/callback`.
- Authentication: authorization code with PKCE; no client secret in the laptop.
- Tenant: MoE production tenant and any pilot/test tenant needed.
- Admin consent: grant tenant consent if user consent is disabled.

Delegated Microsoft Graph scopes:

- `User.Read`
- `offline_access`
- `Mail.Read`
- `Mail.ReadWrite`
- `Mail.Send`
- `Calendars.Read` if calendar triage remains in scope
- `Sites.Read.All` for list/schema discovery
- `Sites.Selected` preferred for least privilege, or `Sites.ReadWrite.All` if
  IT accepts broader delegated write for the pilot

If IT wants unattended service-side access later, ask for an application
permission review separately. That requires stricter mailbox scoping, audit,
and usually an application access policy; it should not be the first demo path.

### SharePoint / Forms data target

Because Microsoft Forms itself does not expose a clean supported Graph
"submit a response" API, ask IT to make the form destination explicit:

- SharePoint hostname, e.g. `tenant.sharepoint.com`.
- Site path or site id.
- List id/display name for each official form destination.
- Internal column names and required fields for each list.
- A test list for safe writes.
- Whether ClawX should create list items directly through Graph or POST to an
  IT-owned Power Automate flow that validates and writes the item.

Preferred least-privilege model:

1. IT creates the official SharePoint list or confirms the existing list.
2. IT grants the ClawX app `Sites.Selected` access only to that site/list.
3. ClawX reads list columns for validation, creates list items, and returns the
   created item id/web URL.

Fallback model:

1. IT creates a Power Automate flow with an HTTP trigger.
2. Flow validates the payload, writes to SharePoint/Form destination, and logs
   the submitter.
3. ClawX stores only the flow endpoint as a tenant setting. Rotate the endpoint
   if it leaks.

## MCP Options

### Recommended MCP posture

Use MCP as an internal tool boundary only after the authorization model is
settled:

- A Microsoft Graph MCP server can expose `mail.list`, `mail.draft`,
  `mail.send`, `sharepoint.list.create_item`.
- A browser MCP server can remain useful for visual/demo flows, but it should
  call the existing app-owned Chrome/CDP diagnostics rather than inventing a
  second browser bootstrap mechanism.

### Open-source options to evaluate

- Microsoft 365 / Graph MCP servers: useful if they already implement OAuth and
  Graph tools, but they must be audited for token storage, scopes, logging, and
  send/write confirmation semantics before bundling.
- Playwright MCP: useful for browser testing and visual interaction, but for
  Outlook/Forms production it is still browser automation, not a supported API.
- PnPJS: useful library option for SharePoint/Graph list work if we decide to
  adopt a client dependency instead of the current thin fetch wrapper.

## Repo Fit

Current repo state already matches this split:

- Browser fallback lives under `electron/services/outlook-browser-v2` and
  `electron/services/forms-browser-v2`.
- Shared Chrome/CDP diagnosis and repair lives in
  `electron/services/chrome-cdp.ts`.
- Agent tools call Electron Host API from
  `extensions/moe-principal-assistant/index.mjs`.
- Microsoft Graph plugin stub exists under `extensions/microsoft-graph`, but it
  is disabled until `tenantId`, `clientId`, token persistence, and consent are
  wired.

## Implementation Backlog

1. Wire Microsoft Graph OAuth into the app's provider/token store.
2. Enable the `microsoft-graph` extension only when tenant config and a fresh
   delegated token exist.
3. Preserve Outlook browser-v2's visible send/draft safety semantics in Graph
   tools: draft first, explicit same-session confirm for send.
4. Build a `forms-graph` manager around SharePoint list item creation, with
   schema validation and a browser fallback when no Graph/flow target exists.
5. Add tenant config UI for site/list IDs or Power Automate endpoints.
6. Add audit-friendly logging: tool name, status, item/message ids, trace id;
   never email bodies, passwords, cookies, raw tokens, full recipient lists, or
   full Forms response URLs.
7. Run fresh-install sandbox acceptance before shipping a release candidate.

## Sources Checked

- Microsoft Graph Outlook mail APIs: create/send messages and `/sendMail`.
- Microsoft Graph SharePoint list item creation.
- Microsoft identity platform desktop app + PKCE guidance.
- Microsoft Graph permission/admin-consent model.
- Microsoft MCP / Microsoft 365 MCP and Playwright MCP public references.
