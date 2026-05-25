# Microsoft Forms — programmatic submission paths

**TL;DR:** Once we have a Graph token from MoE IT (Entra app registration + admin consent), there is a fully-supported, GA Microsoft Graph endpoint we can POST to and bypass the Forms UI entirely. This is the production path for submitting MoE forms (Suspensions, Daily Report, etc).

---

## Three working paths, ranked

### Path A — Microsoft Graph → SharePoint List ✅ **RECOMMENDED**

**Status:** GA in `graph.microsoft.com/v1.0`, last updated 2025-07-23 per Microsoft Learn.

**Why it works:** Microsoft Forms doesn't store data in Forms — it writes responses to a backing **SharePoint List**. We POST straight to that list, the form's submission flow becomes irrelevant.

**Endpoint:**

```http
POST https://graph.microsoft.com/v1.0/sites/{site-id}/lists/{list-id}/items
Authorization: Bearer {token}
Content-Type: application/json

{
  "fields": {
    "EducationDistrict": "Caroni",
    "SchoolType": "Government",
    "PerpetratorName": "...",
    "DateOfInfraction": "2026-05-20",
    ...
  }
}
```

**Required scope (delegated):** `Sites.ReadWrite.All` — OR — `Sites.Selected` (more granular, MoE IT picks specific sites we can write to).

**On success:** `HTTP 201 Created` with the new list item's id and webUrl.

**Implementation:** `electron/services/forms-graph/forms-graph-client.ts`. Three exported functions:
- `resolveSiteId({hostname, sitePath, token})` — one-time lookup
- `resolveListId({siteId, listDisplayName, token})` — one-time lookup
- `getListColumns({siteId, listId, token})` — read schema for validation
- `createListItem({siteId, listId, fields, token})` — actual submission

**Pros:**
- Headless (no Chrome required)
- Atomic write (no half-filled form risk)
- Works on the Windows pilot without browser session
- Reads schema dynamically — agent can self-validate before POST
- Same Entra app registration we already need for Outlook

**Cons / what we need from MoE IT:**
- Add `Sites.ReadWrite.All` (or `Sites.Selected` for the specific sites) to the scope list in the existing Entra packet
- Tell us the SharePoint hostname (e.g. `moegovtt.sharepoint.com`) and site path (e.g. `/sites/SchoolReports`)
- Tell us the list display name for each form (e.g. `"Primary School Suspensions T3 25-26"`)

### Path B — Power Automate webhook ✅ **FALLBACK** (no scope changes)

IT creates one Power Automate flow per form. Trigger: "When an HTTP request is received". Action: "Create item in SharePoint list" (or "Submit form response").

The trigger generates a SAS-signed URL. We POST our 32-field JSON to it.

**Endpoint shape:**

```http
POST https://prod-{N}.{region}.logic.azure.com:443/workflows/{guid}/triggers/manual/paths/invoke
       ?api-version=2016-06-01&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig={sig}
Content-Type: application/json

{
  "EducationDistrict": "Caroni",
  ...
}
```

No bearer token at request time — the SAS sig in the URL IS the auth.

**Pros:** No Graph scope changes needed. IT keeps full control of which fields land where.
**Cons:** IT has to author one flow per form. SAS URLs can leak — they should be rotated periodically.

### Path C — SharePoint REST (legacy, alternative to Graph)

```http
POST https://{tenant}.sharepoint.com/_api/web/lists(guid'{list-id}')/items
Authorization: Bearer {token}
Content-Type: application/json;odata=verbose
Accept: application/json;odata=verbose

{
  "__metadata": { "type": "SP.Data.{ListNameInternal}ListItem" },
  "Title": "...",
  ...
}
```

Documented but Graph (Path A) is the modern surface. Only use this if a tenant disables Graph for some reason.

### Path D — Forms editor automation ❌ **DEAD-END**

Selenium / Playwright against `forms.office.com/Pages/DesignPageV2.aspx` (creating a form) AND `forms.office.com/.../ResponsePage.aspx` (filling a form).

**Status:** Both surfaces are too volatile for production. The editor is rendered in a same-origin iframe with rotating class names; even data-automation-id attributes that exist in one render are absent after a re-render. The response page is more stable but still flakier than the API path.

We keep the response-page filler (`electron/services/forms-browser-v2`) as a **demo-only fallback** when no Graph token is available.

---

## What to ask MoE IT for (additions to the existing Entra packet)

Existing packet at `/tmp/moe-entra-app-registration-request.md` already requests:

```
Delegated:
  - User.Read
  - Mail.Read
  - Mail.ReadWrite
  - Mail.Send
  - Calendars.Read
  - offline_access
```

**Add to that packet:**

```
Delegated (additional, for MS Forms submission via SharePoint List backing):
  - Sites.Read.All           (read list schema for agent validation)
  - Sites.ReadWrite.All      (post form responses)

Tenant configuration (so we can target the right list):
  - SharePoint hostname:     ____________________
  - Site path / collection:  ____________________
  - For each MoE form, the list display name:
    * Primary School Daily Report:                _____________________
    * Primary School Student Suspensions T3 25-26: _____________________
```

If `Sites.ReadWrite.All` is too broad for IT, we accept `Sites.Selected` — IT scopes us to specific sites by hand.

---

## Reference implementation (current state, 2026-05-25)

**Built and ready (no token yet):**
- `electron/services/forms-graph/forms-graph-client.ts` — Graph transport (resolve site/list, read columns, create item). Requires only a token to function.

**Built and working (no token needed):**
- `electron/services/forms-browser-v2/` — Playwright + CDP fallback that drives the response page on the principal's existing browser session. End-to-end tested with hard-confirm gate today.

**Wired into the agent:**
- `forms.list`, `forms.preview_suspension`, `forms.submit_suspension` plugin tools (currently routing to forms-browser-v2; will route to forms-graph once token is available)
- Host-API: `/api/forms/list`, `/api/forms/preview-suspension`, `/api/forms/submit-suspension`
- Allowlist gate: `forms` in `PRINCIPAL_SKILL_ALLOWLIST`

**Next when token arrives:**
1. Implement `forms-graph/manager.ts` mirroring `forms-browser-v2/manager.ts`
2. Map the Suspensions schema (`extensions/moe-principal-assistant/forms/suspensions-schema.json`) to SharePoint internal column names. IT tells us those once.
3. The manager prefers Graph when token is available, falls back to browser-driver otherwise.

This means: the demo path tomorrow uses the browser-driver against the cloned form on test.fac. Production with `@moe.gov.tt` accounts uses Graph. Same agent surface, different transport.
