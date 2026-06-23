# Tool reference — moe-principal-assistant plugin (live ground truth)

Compiled by parallel sub-agents reading the source. Use this when log-tailing during the smoke — these are the EXACT names the agent will invoke and the gate semantics.

---

## Outlook tools (11)

All defined in `extensions/moe-principal-assistant/index.mjs`.

| Tool | index.mjs line | Description | Gate |
|---|---|---|---|
| `outlook.open` | 352-360 | Open Outlook Web; returns `opened` / `needs_signin` | none |
| `outlook.read_inbox` | 362-371 | Top N recent messages | none |
| `outlook.draft_email` | 373-388 | Compose draft (does NOT send) | none |
| `outlook.send_email` | 390-409 | **Send the single visible reviewed draft** | **hard-confirm gate** (see below) |
| `outlook.search_inbox` | 415-422 | Filter by sender, subject, date, unread, attachment | none |
| `outlook.read_email` | 424-433 | Open message; full body, recipients, attachments | none |
| `outlook.reply` | 435-445 | Reply / reply-all; leaves draft open | none |
| `outlook.forward` | 447-459 | Forward with optional commentary | none |
| `outlook.mark_read` | 461-473 | Toggle read state | none |
| `outlook.list_attachments` | 475-484 | List metadata (no download) | none |
| `outlook.download_attachment` | 486-500 | Save to disk | hard-confirm |

### `outlook.send_email` hard-confirm gate (the trust moment)

**Gate 1 — confirm flag** (plugin-side, `index.mjs:406`):
- Code: `confirm: confirm === true`
- Refusal message: `"Send blocked: confirm flag not set. Show the draft to the principal and re-call with confirm=true after they say yes."`

**Gate 2 — single visible reviewed draft** (driver-side, `electron/services/outlook-browser-v2/outlook-actions.ts`):
- Verifies Outlook shows exactly one complete reviewed draft with its own Send button.
- Normal reviewed sends call `outlook.send_email({confirm:true})` only. Optional recipient/subject/body values are advanced safety assertions; stale assertions can make a valid reviewed draft refuse.

Both gates must pass. Demo this by trying to send with no draft open or multiple compose panes open; the tool must refuse.

### Host-API mirror

`POST /api/outlook/send` at `electron/api/routes/outlook.ts:120-128` → delegates to `outlookBrowserManager.sendEmail(body)`.

### Log-grep pattern

The plugin logs use a **direct prefix** (no bracketed plugin tag):
```
moe-principal-assistant: ...
```

Visible in `index.mjs` log calls at lines 502, 504, 508. So when tailing the gateway log, grep for `moe-principal-assistant` OR `outlook\.\w+` to catch all tool invocations.

---

## Forms tools (3)

Defined in `extensions/moe-principal-assistant/index.mjs`.

| Tool | index.mjs line | Description | Gate |
|---|---|---|---|
| `forms.list` | 523 | List available forms | none |
| `forms.preview_suspension` | 530 | Open form, fill fields, **stop before submit** | none |
| `forms.submit_suspension` | 542 | Click Submit on previewed form | hard-confirm |

### `forms.submit_suspension` hard-confirm gate

**Plugin-side wiring** (`index.mjs:545`):
```js
handler: async (args = {}) => forms.submitSuspension({ confirm: args.confirm === true })
```

**Driver-side validation** (`electron/services/forms-browser-v2/forms-driver.ts:197-200`):
- If `!confirm`: returns `{ status: 'refused', reason: 'Submit blocked: confirm:true required. Re-call with confirm:true after the principal has reviewed the filled form.' }`

**Secondary title-match gate** (`forms-driver.ts:205-209`):
- Validates the open form page title contains `"Primary School Student Suspensions"` before allowing the Submit click. Defense in depth — if the agent somehow tries to submit while a different form is in front, it refuses.

### **CRITICAL DEMO SAFETY FINDING**

> The Bearer-API path that returns 401 is **NOT exposed as an agent-callable tool**. The agent CANNOT pick `forms.api_submit` or similar because no such tool is registered. The Bearer logic exists only as host-API plumbing (`/api/forms/preview-suspension`, `/api/forms/submit-suspension`) which the DOM driver wraps. The agent's only paths are the two DOM-gated tools above.

This means I do not need to actively block the API path on stage. Architectural guard.

### Schema actually consumed

The driver reads `extensions/moe-principal-assistant/forms/suspensions-schema.json` (NOT `suspensions-schema.vlm.json`). The `.vlm.json` variant is reference material, not load-bearing. `suspensions-actions.ts:11` is the read site. `SuspensionsPayload` interface at `suspensions-actions.ts:13-47` is the payload shape the agent must construct from the email body.

### DOM-fill mechanism

**No React-native-setter pattern in the production driver.** I documented "React setter" earlier based on the Mac smoke script (`scripts/forms-auto-fill-and-capture.ts`). The PRODUCTION path (`forms-driver.ts:115`, `fillField()`) uses Playwright `.fill()` directly — works because MS Forms response pages are vanilla DOM, not React-controlled like the editor side.

---

## Reference cross-check before the smoke

When watching the log for a tool call, expect lines like:
- `moe-principal-assistant: outlook.send_email called {...}` — invocation
- `moe-principal-assistant: outlook.send_email gated: confirm flag not set` — Gate 1 refusal
- `Send blocked: multiple open drafts were detected` or `No open draft found` — Gate 2 refusal
- `moe-principal-assistant: forms.submit_suspension status=refused reason=Submit blocked: confirm:true required` — forms hard-confirm refusal

Pass-through to host-API also generates `[INFO] POST /api/outlook/* 200` style lines — useful as secondary evidence.
