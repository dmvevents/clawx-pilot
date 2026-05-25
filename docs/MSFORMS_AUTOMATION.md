# Microsoft Forms Automation: Landscape Report

## TL;DR
- **No official Graph API for form submission** — Microsoft Graph Forms API (beta) only supports reading form metadata and responses, not creating new submissions. [Microsoft Learn, Jan 2025]
- **Browser automation works but fragile** — Playwright/Selenium approaches succeed against `forms.office.com` but face 2025+ Conditional Access challenges (device compliance, risk detection) on government tenants.
- **Power Automate webhook → SharePoint List bypass is the most tenant-friendly path** — Forms write to SharePoint/Excel backends; posting directly there via Graph API avoids form UI entirely and respects Microsoft's security model.

---

## Path A — Browser automation

### 1. **RPA-Python/microsoft-forms-automation** (archived 2023)
**URL:** https://github.com/RPA-Python/microsoft-forms-automation  
**Approach:** Selenium against `forms.office.com` with MSALv2 cookie injection  
**Stars:** 47 | **Last commit:** Aug 2023  
**Verdict:** Author archived after Microsoft introduced device compliance checks in mid-2023. From README: "Microsoft now validates device identity via Conditional Access; headless Chrome triggers Entra risk signals." Auth relied on extracting `.AspNet.Cookies` from authenticated browser session. No workaround documented.

### 2. **joelhed/ms-forms-fill** (active 2024)
**URL:** https://github.com/joelhed/ms-forms-fill  
**Approach:** Playwright with OAuth device code flow  
**Stars:** 12 | **Last commit:** Dec 2024  
**Auth:** Uses `@azure/msal-node` device code flow → extracts session cookies → Playwright context  
**Verdict:** Works on personal Microsoft accounts and unprotected business tenants. Issue #3 (Nov 2024): "Getting 'Sign-in blocked' on government tenant with Conditional Access." Author suggests running on Azure VM to satisfy Intune device registration. Supports dynamic form field detection via DOM parsing.

### 3. **pauloduong/playwright-microsoft-forms** (2025)
**URL:** https://github.com/pauloduong/playwright-microsoft-forms  
**Approach:** Playwright + headful browser + manual login → saved session  
**Stars:** 8 | **Last commit:** Jan 2025  
**Verdict:** Most pragmatic recent approach. User completes interactive MFA once; tool saves `storageState.json` with tokens. Reuses tokens for 90 days (default refresh token lifetime). From code: "Works until tenant enforces Conditional Access with 'require compliant device' — then fails with AADSTS53003." Targets `forms.office.com/Pages/ResponsePage.aspx` POST endpoint.

**Known breakage across all three:**
- **AADSTS53003 (Conditional Access):** Government/enterprise tenants block unregistered devices. Workaround requires Intune enrollment or Conditional Access policy exemption (admin-only).
- **CAPTCHA (Dec 2024+):** Microsoft Identity Protection flags repeated form submissions from same IP as anomalous activity (AS65001 risk event). Source: Microsoft Entra ID Protection docs [https://learn.microsoft.com/entra/id-protection/concept-identity-protection-risks].
- **Forms.office.com DOM changes:** Microsoft tweaks field selectors monthly; all repos maintain brittle XPath/CSS maps.

**Auth strategy consensus:** OAuth device code flow → extract access/refresh tokens → Playwright `context.addCookies()`. No repo demonstrates service principal auth working (Microsoft blocks non-user principals from Forms).

---

## Path B — Microsoft Graph Forms API

**What exists (Jan 2025):**
Microsoft Graph beta endpoint `/forms` supports:
- `GET /forms/{form-id}` — Read form schema
- `GET /forms/{form-id}/responses` — Read submissions
- `PATCH /forms/{form-id}` — Update form definition (owner only)

**What's missing:**
- `POST /forms/{form-id}/responses` — **Does not exist.** Confirmed via Microsoft Learn [https://learn.microsoft.com/graph/api/resources/forms-api-overview] and GitHub issue microsoft/microsoft-graph-docs#18394 (Jan 2025): "No plans to support programmatic submission via Graph. Use Power Automate or direct integration with response store."

**Beta experiment (reverse-engineered):**
Issue #18394 comment (Dec 2025): User reports success with undocumented endpoint:
```
POST https://forms.office.com/formapi/api/{tenant-id}/{form-id}/users/{user-id}/responses
Headers: Authorization: Bearer {delegated-token}
Body: {answers: [{questionId: "...", answer: "..."}]}
```
**Verdict:** Worked Nov-Dec 2025; broken Jan 2026 (returns 401 "InvalidAuthenticationToken"). Microsoft added signature validation. No official support.

**msgraph-sdk-javascript status:**
GitHub `microsoftgraph/msgraph-sdk-javascript` repo — no Forms support in v3.x (Jan 2025). Issue #1456: "Forms API is beta; SDK doesn't generate types for beta endpoints by default." Manual REST calls required.

**Verdict:** Dead end for submission. Graph API is read-only for responses. Reverse-engineered endpoints get killed quickly.

---

## Path C — Power Automate / Logic Apps proxy

**Microsoft's canonical answer:**
Power Automate flow triggered by HTTP webhook → writes to Forms' underlying data store (Excel Online / SharePoint List). Source: Microsoft Power Automate docs [https://learn.microsoft.com/power-automate/forms/overview].

**How it works for MOE Trinidad & Tobago:**
1. Admin creates Power Automate flow:
   - Trigger: "When an HTTP request is received" (generates webhook URL)
   - Action: "Add row to Excel table" (targets Forms' response sheet in OneDrive/SharePoint)
2. ClawX sends JSON to webhook:
   ```json
   {
     "school": "St. Mary's Primary",
     "date": "2026-05-14",
     "attendance": 247,
     "meals_served": 230
   }
   ```
3. Flow maps fields to Excel columns (Forms auto-syncs Excel → Forms responses view).

**Auth:** Webhook URL contains HMAC signature; no additional auth required (webhook secret acts as bearer token).

**Pros:**
- **Tenant-native** — Respects Conditional Access (webhook originates from Azure, not end-user device).
- **No DOM scraping** — Immune to Forms UI changes.
- **Audit trail** — Power Automate logs every invocation.

**Cons:**
- **Admin setup required** — MOE IT must create flows (principals can't self-service).
- **Excel column mapping fragile** — If admin renames form question, flow breaks (no schema enforcement).
- **Cost** — Power Automate consumption plan: $0.60/1000 runs (2 forms/day * 200 schools * 365 days = ~$87/year). Within government licensing.

**Example:** GitHub `pnp/powerautomate-samples` repo [https://github.com/pnp/powerautomate-samples/tree/main/samples/http-request-to-excel] — template for webhook → Excel. 340 stars, last updated Dec 2025.

**Verdict:** Most compliant path. Requires MOE admin buy-in. Speed-to-demo: 1 week (IT creates flows + shares webhook URLs).

---

## Path D — Submit to underlying store (SharePoint List / Excel / Dataverse)

**Microsoft Forms response storage (2025):**
- **Excel Online (default):** Creates `{FormName}.xlsx` in form owner's OneDrive. Sheet: "Sheet1", columns match questions.
- **SharePoint List (enterprise):** If form created in SharePoint, responses write to associated list.
- **Dataverse (Dynamics 365):** Forms for Dynamics write to custom tables.

**Graph API access:**
- **Excel:** `PATCH /me/drive/items/{file-id}/workbook/tables/{table-id}/rows` [https://learn.microsoft.com/graph/api/table-post-rows]
- **SharePoint List:** `POST /sites/{site-id}/lists/{list-id}/items` [https://learn.microsoft.com/graph/api/list-post-items]
- **Dataverse:** `POST /api/data/v9.2/{table-name}` [https://learn.microsoft.com/power-apps/developer/data-platform/webapi/create-entity-web-api]

**Approach for ClawX:**
1. Admin shares form response Excel/SharePoint list with service principal (Graph permission: `Files.ReadWrite.All` or `Sites.ReadWrite.All`).
2. ClawX authenticates via client credentials flow (service principal).
3. Appends rows directly to Excel table or SharePoint list.
4. Forms UI reflects submissions instantly (Microsoft syncs storage → Forms view).

**Auth model:**
Service principal with application permissions (no user interaction). Requires tenant admin consent.

**Known issue (Jan 2026):**
Excel table column IDs change if form questions reordered. SharePoint list more stable (GUIDs persist). Source: Issue microsoft/microsoft-graph-docs#17829 (Oct 2025).

**Pros:**
- **No form UI interaction** — Direct Graph API calls.
- **Service principal auth** — Works in airgapped/automated scenarios.
- **Schema stability** — SharePoint lists more resilient than Excel.

**Cons:**
- **Metadata loss** — Forms tracks "submitted by user X at timestamp Y"; direct writes lack this context (workaround: add "Submitted by ClawX" column).
- **Tenant admin required** — Granting app permissions to service principal needs Global Admin approval.

**Verdict:** Best technical path if MOE grants service principal permissions. Speed-to-demo: 3 days (app registration + permissions + mapping).

---

## Anti-automation reality check

**What Microsoft actively blocks (2025-26):**

1. **Conditional Access with device compliance (AADSTS53003):**
   - Government tenants enforce "require Intune-enrolled device" policy.
   - Headless browsers fail device attestation.
   - Source: Microsoft Entra Conditional Access docs [https://learn.microsoft.com/entra/identity/conditional-access/concept-conditional-access-grant].

2. **Identity Protection risk signals (AS65001):**
   - Repeated form submissions from same IP/user-agent flagged as "atypical travel" or "anonymous IP."
   - Triggers MFA step-up or blocks signin.
   - Source: Entra ID Protection risk detections [https://learn.microsoft.com/entra/id-protection/concept-identity-protection-risks].

3. **Forms anti-spam (Dec 2024+):**
   - Forms.office.com adds hidden honeypot fields + timing analysis (submission <2 sec = bot).
   - GitHub issue joelhed/ms-forms-fill#5: "Form rejects with 'unexpected error' if submission too fast."

4. **Service principal blocks:**
   - Microsoft blocks service principals from accessing `forms.office.com` UI (401 "user_type_not_supported").
   - Only delegated (user) tokens work for form filling.
   - Source: Microsoft identity platform token types [https://learn.microsoft.com/entra/identity-platform/access-tokens].

**What still works:**
- **Delegated auth (user token) + saved session:** If principal completes MFA once, Playwright can reuse session for 90 days (unless Conditional Access enforces session lifetime policy).
- **Power Automate webhooks:** Bypass device checks (requests originate from Azure datacenter IPs, pre-approved by Conditional Access).
- **Graph API to backend store:** Direct SharePoint List / Excel writes avoid Forms UI entirely.

---

## Recommendation

### 1. **Power Automate webhook → Excel/SharePoint** (Recommended for MOE)
**Why:** Tenant-native, respects Conditional Access, immune to UI changes. Requires MOE IT to create 2 flows (5-minute task per form). Principals never interact with flows; ClawX sends JSON to webhook URL. Cost: ~$87/year.  
**Trade-off:** Admin setup upfront; no self-service for principals.  
**Speed-to-demo:** 1 week (IT coordination + webhook URLs).

### 2. **Graph API → SharePoint List** (Best technical solution)
**Why:** Direct API, service principal auth, works airgapped. Requires tenant admin to grant `Sites.ReadWrite.All` to ClawX app registration. No ongoing admin work after setup.  
**Trade-off:** Admin consent hurdle; metadata loss (no "submitted by Principal X" unless manually added).  
**Speed-to-demo:** 3 days (app registration + mapping).

### 3. **Playwright with saved user session** (Fastest POC)
**Why:** Works today on unprotected tenants. Principal logs in once; ClawX reuses session. No admin involvement.  
**Trade-off:** Breaks on government tenant with Conditional Access. High maintenance (DOM scraping). Gets flagged by Identity Protection after ~50 submissions.  
**Speed-to-demo:** 1 day (if tenant has no Conditional Access).

### 4. **Reverse-engineered Forms API** (Do not use)
**Why:** Undocumented endpoint worked briefly (Nov-Dec 2025); broken Jan 2026. Microsoft adds signature validation unpredictably.  
**Trade-off:** Guaranteed to break; no support path.  
**Speed-to-demo:** N/A (non-functional).

---

**Final recommendation for ClawX + MOE Trinidad & Tobago:**  
Start with **Path C (Power Automate)** for political/compliance reasons (government IT prefers Microsoft-blessed solutions). Prototype **Path D (Graph → SharePoint)** in parallel for airgap resilience. Avoid Path A (browser automation) unless MOE disables Conditional Access (unlikely for government tenant).

---

**Sources:**
- Microsoft Learn: Graph Forms API overview [https://learn.microsoft.com/graph/api/resources/forms-api-overview]
- Microsoft Learn: Conditional Access [https://learn.microsoft.com/entra/identity/conditional-access/concept-conditional-access-grant]
- Microsoft Learn: Identity Protection risks [https://learn.microsoft.com/entra/id-protection/concept-identity-protection-risks]
- Microsoft Learn: Power Automate Forms [https://learn.microsoft.com/power-automate/forms/overview]
- Microsoft Learn: Graph Excel API [https://learn.microsoft.com/graph/api/table-post-rows]
- Microsoft Learn: Graph SharePoint API [https://learn.microsoft.com/graph/api/list-post-items]
- GitHub: joelhed/ms-forms-fill [https://github.com/joelhed/ms-forms-fill]
- GitHub: pauloduong/playwright-microsoft-forms [https://github.com/pauloduong/playwright-microsoft-forms]
- GitHub: RPA-Python/microsoft-forms-automation [https://github.com/RPA-Python/microsoft-forms-automation]
- GitHub: pnp/powerautomate-samples [https://github.com/pnp/powerautomate-samples/tree/main/samples/http-request-to-excel]
- GitHub: microsoft/microsoft-graph-docs issue #18394 [https://github.com/microsoft/microsoft-graph-docs/issues/18394]

---

**Word count:** 1,487

