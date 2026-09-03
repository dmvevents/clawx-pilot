# MCP integration research — forms filling and app enhancement (2026-09-03)

*Deep-research pass (web-verified 2026-09-02/03) answering: can we fill
Microsoft Forms via MCP, and what else can MCP do for this app? Board card:
CLWX-71. Companion to `docs/MSFORMS_AUTOMATION.md` (the three-tier forms
strategy) and `docs/GA_FINISH_SPRINT_2026-09-03.md`.*

## TL;DR

**No MCP server anywhere — official or community — can submit Microsoft Forms
responses**, because Microsoft Forms still has no public Graph/REST API for
response submission (verified against Microsoft's official MCP catalog, the
300-tool softeria Graph MCP server, Microsoft Learn, and the Power Automate
Forms connector reference — which remains read-only, doc updated 2025-10-06).
The easiest viable path is pointing the official **Playwright MCP at our
existing Chrome CDP endpoint** (`--cdp-endpoint http://127.0.0.1:18792`) —
minutes of setup, satisfies the Conditional Access constraint because it rides
the same user Chrome — but it is a raw, ungated click/type surface: **dev/debug
only**. The **recommended build** is a **thin local MCP adapter (~200 lines,
~1 day) over our existing host-API on :13210**, exposing the forms/outlook
endpoints as MCP tools; the hard-confirm gates live server-side in
FormsBrowserManager, so every MCP client inherits them and cannot bypass them.

## Options

| Option | Fills MS Forms? | Works with our CDP-to-user-Chrome rule? | Effort | Gate-safe? | Verdict |
|---|---|---|---|---|---|
| Dedicated Forms MCP server | none exists | — | — | — | Not available |
| Graph-based M365 MCP (softeria; MS official remote servers) | no — Graph has no Forms workload | n/a | low | n/a | Useless for forms; useful later for mail/calendar/files |
| Playwright MCP (`@playwright/mcp`) | generically (click/type) | **yes** — `--cdp-endpoint` | hours | **no gate** | Dev/debug only |
| chrome-devtools-mcp | generically | **yes** — `--browserUrl` | hours | **no gate**; telemetry ON by default | Dev/debug only |
| BrowserMCP | in theory | yes (extension) | low | no gate; effectively unmaintained, docs 403 | Avoid |
| **Thin MCP adapter over host-API :13210** | **yes — via our hardened forms-browser-v2 driver** | yes — same `connectOverCDP(:18792)` session | **~1 day** | **yes — confirm gate + title fingerprint stay server-side** | **Recommended (CLWX-71)** |
| Logic Apps Standard as remote MCP server (preview) | no (connector read-only) — but flows could write the form's backing store directly | n/a | Ministry IT | OAuth server-side | Future; pairs with the pending Power Automate path (Raj) |

## What MCP can do for this app (inventory)

- **Playwright MCP** (github.com/microsoft/playwright-mcp) — attach to :18792
  via `--cdp-endpoint`; best dev-time debugger for our Outlook/Forms drivers.
- **chrome-devtools-mcp** (github.com/ChromeDevTools/chrome-devtools-mcp) —
  `--browserUrl` attach; performance traces, network, console. Disable
  telemetry (`--no-usage-statistics`).
- **softeria/ms-365-mcp-server** — 300+ delegated Graph tools (mail, calendar,
  OneDrive, Excel, SharePoint, Teams). Complements our PKCE Graph mail
  transport; device-code flow must clear tenant Conditional Access and needs
  our Entra registration (in flight).
- **Microsoft official M365 remote MCP servers** (microsoft/mcp catalog) —
  Mail, Calendar, Word, OneDrive/SharePoint, SharePoint Lists, Teams. No
  Forms. Remote/preview and admin-gated; licensing/enablement details
  UNVERIFIED (overview page 404) — needs Ministry IT.
- **Microsoft MCP Server for Enterprise** (learn.microsoft.com/en-us/graph/mcp-server/overview)
  — preview, read-only Entra directory/reporting, 100 calls/min/user.
- **markitdown MCP** (Microsoft) — PDF/Office→markdown; relevant to document
  processing.
- **Logic Apps Standard as MCP server** (preview, doc 2026-02-25) — exposes
  Request-trigger workflows as MCP tools (Easy Auth/Entra); 1,400+ connectors
  incl. SharePoint/Excel writes. Power Automate itself has no MCP surface.
- **MCP TypeScript SDK** (github.com/modelcontextprotocol/typescript-sdk) —
  v2 line, stdio + Streamable HTTP, Zod schemas; a small server is ~35-50
  lines plus tools.

## Recommendation (why the adapter wins)

The host-API already exposes exactly the right verbs
(`/api/forms/list|preview-*|submit-*`, `/api/outlook/open|read-inbox|draft|send`),
and the confirm gate is enforced in FormsBrowserManager *behind* the route —
the route cannot bypass it. An MCP server that just `fetch()`es those
endpoints (~9 registerTool blocks, stdio transport, :13210 token via env var,
never argv) gives Claude Code, Claude Desktop, and any future agent the same
hardened, gated, allowlist-controlled capability with zero new attack surface
on the browser session and no CDP contention (everything still funnels through
the one serialized manager). This is how MCP "re-enhances the app": the app's
capabilities become tools *other* agents can drive — same gates, same logs.

**Risks vs hard rules:** same trust model as today (localhost, token-gated,
user's own Chrome). Gates must never be re-implemented client-side. Adapter
logs counts only, never payload bodies. MCP SDK goes in `dependencies`
(moe.10 playwright-core regression class). Never expose raw browser MCPs
(Playwright/chrome-devtools) in a principal-facing config — ungated click/type
over an authed session includes Outlook Send.

## Sources (accessed 2026-09-02/03)

microsoft/mcp catalog; microsoft/playwright-mcp; ChromeDevTools/
chrome-devtools-mcp (+docs/configuration.md); softeria/ms-365-mcp-server;
learn.microsoft.com/en-us/connectors/microsoftforms/ (read-only, upd.
2025-10-06); Microsoft Learn search (no Forms API); modelcontextprotocol/
typescript-sdk (spec 2026-07-28); learn.microsoft.com/en-us/azure/logic-apps/
create-model-context-protocol-server-standard (preview 2026-02-25);
learn.microsoft.com/en-us/graph/mcp-server/overview; BrowserMCP/mcp (repo
only; docs 403). Unverified: M365 remote server licensing/enablement;
Copilot Studio MCP consumption.
