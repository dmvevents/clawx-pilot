---
name: forms-suspension-fill
description: Extract suspension-report fields from an email body, fill the test.fac Suspensions form via DOM, and submit it with the principal's confirmation. Uses the proven 31/31 React-native-setter approach.
metadata:
  os: windows
  prereq-skills: chrome-cdp-windows, outlook-email-windows
  form-url-config: extensions/moe-principal-assistant/forms/suspensions-test-fac-url.txt
  proven-state: 31/31 fields filled + POST 201 (2026-05-26 00:27Z, Mac side)
  demo-path: DOM fill + DOM submit (Bearer-API path is post-demo polish)
---

# Forms suspension fill — Windows pilot

## When to use

- Demo turn 2 (forms path): "Read the suspension report email and fill out the Suspensions form. Don't submit yet…" → review → "Submit the form."
- Acceptance smoke: prove the 32-field schema fill works without manual intervention.
- Diagnosis: a `forms.preview_suspension` or `forms.submit_suspension` call failed.

## Tool surface (registered by moe-principal-assistant)

| Tool | Purpose | Gate |
|---|---|---|
| `forms.preview_suspension({payload})` | Open the form ResponsePage, fill all fields, **stop before submit** | none |
| `forms.submit_suspension({confirm:true})` | Click Submit on the already-previewed form | hard-confirm |

The fill driver is `electron/services/forms-browser-v2/forms-driver.ts` + `suspensions-actions.ts`. It uses Playwright over the same CDP attach as Outlook.

## Demo path = DOM, NOT API

**DO NOT trigger the Bearer-API path on stage.** It returns `401 Required user login` because the in-page fetch can't grab the MSAL Bearer token (open investigation in `docs/MSFORMS_API_FILL_PLAN.md`).

The DOM path is **proven 31/31** as of 2026-05-26 00:27Z (commit `a7e7623`). Schema-driven Playwright with the React-native-setter pattern fills every field type cleanly:
- Text inputs (single + multi-line)
- Radio choice (single answer)
- Checkbox choice (multi answer)
- Date (typed in locale format `MM/DD/YYYY` or `DD/MM/YYYY`, never ISO)
- Phone (handles curly-quote variants on apostrophe-bearing labels)
- Long single-select dropdowns (454-school list works)

## React-native-setter pattern (why fields stick)

Forms uses React-controlled inputs. Naive `element.value = "x"` doesn't trigger React's onChange and the value reverts. We use the Object.getOwnPropertyDescriptor approach:

```js
const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
setter.call(input, newValue);
input.dispatchEvent(new Event('input', { bubbles: true }));
```

Same pattern for textarea. Checkbox/radio use `element.click()` after locating by label text (curly-quote-tolerant matcher).

Source: `forms-driver.ts` — search for `nativeSetter` or `reactSetValue`.

## Schema source

The 32-field suspension schema lives at:
```
extensions/moe-principal-assistant/forms/suspensions-schema.vlm.json
```

VLM-extracted from the official MoE PDF using Sonnet 4.5 (commit `a18d470`). Includes:
- Question ID (Forms-side)
- Question label (canonical)
- Type (`text` / `single_choice` / `multi_choice` / `date` / `phone`)
- Required (boolean)
- Options (for choice types — full 454-school list inline for question 4)

The agent extracts values from the source email body by Pro-mode (gemini-2.5-pro). Don't try this on Flash — schema-validation 400s, demonstrated repeatedly. If Flash is selected, **enable the brain icon** (Think mode) before the turn.

## Test.fac form URL (cloned twin)

Saved at `extensions/moe-principal-assistant/forms/suspensions-test-fac-url.txt`. Do not print the full Forms response URL in logs or reports. This is **the test.fac clone of the real MoE Suspensions form**, owner = `test.fac@fac.edu.tt`. Submitting it doesn't go to the real MoE.

## Prerequisites checklist

```
[ ] All from outlook-email-windows checklist (CDP + Outlook tab)
[ ] Form URL above is reachable from the test.fac browser session (Chrome → URL → page loads)
[ ] No previous failed fill in flight on the form page (Cmd+R / Ctrl+R if mid-fill state visible)
[ ] Source email with suspension report body is in the test.fac inbox (manually placed pre-demo)
[ ] Compound queries route to Pro (brain icon ON if defaults haven't propagated)
```

## Demo turn-by-turn (verbatim chat composer text)

### Turn A — extract + preview

> Read the suspension report email from this morning and fill out the Term 3 Suspensions form. Don't submit yet — let me review.

Expected sequence:
1. `outlook.search_inbox({subjectContains: "suspension"})`
2. `outlook.read_email({id: <top result>})`
3. Agent extracts the 32 fields from the body (Pro-mode, ~5-10s)
4. `forms.preview_suspension({payload: <extracted>})` opens the form on test.fac and fills 31/31 fields
5. Chat-side summary: "Filled X/31 required fields. Form is open in Chrome for your review."

**Switch to the Chrome tab.** Show the principal each section. Realistic data should be in every required field.

### Turn B — submit (hard-confirm gate)

> Submit the form.

Expected: `forms.submit_suspension({confirm:true})` → DOM Submit click → "Thanks" page in Chrome → success report in chat.

## Acceptance smoke (before the principal arrives)

Pre-flight on Mac equivalent: `pnpm exec tsx scripts/forms-fill-suspensions.ts`. On Windows we don't have a tsx runtime; instead, do the GUI smoke:

1. Reset the form: open the configured test.fac ResponsePage URL in Chrome, Ctrl+R if any state visible.
2. From chat composer, type Turn A verbatim with a known good source email.
3. Visual check: scroll the form. Every required field has a value.
4. Type Turn B. "Thanks" page appears.
5. Open https://forms.office.com/, find the form, click "Responses" — the new submission counts.

Reset for demo: open the form URL fresh, Ctrl+R, leave the tab on the empty ResponsePage.

## Failure modes & escape hatches

| Symptom | Cause | Fix |
|---|---|---|
| Field count <30 after preview | Schema mismatch OR Flash selected | Brain icon ON; retry |
| `Cannot find Submit button` | Form paginated; on a sub-page | Click "Next" once in Chrome, retry "submit the form" |
| Date field rejected with "invalid date" | ISO format used | The driver should locale-format. If not, manually edit the date in Chrome to `MM/DD/YYYY`, retry submit |
| Multi-choice checkbox didn't click | Curly-quote in label OR DOM rotation | Click the missing checkbox manually; document selector drift to `dom-selector-regression-tester` sub-agent |
| Phone field missed (Q28) | Apostrophe variant | Manually type the value; flag for v2 fix |
| `401 Required user login` | Agent picked the API path | Re-issue the prompt; if it picks API again, kill the turn and start over saying "fill the form via the browser, do not use the API" |
| Form shows "Page not found" | Owner deleted the cloned form | Recreate via `forms-clone-suspensions.ts` (Mac side) — 5 min |
| `forms.preview_suspension` returns "no payload extracted" | Source email body too short / not structured | Re-send the demo email with the full 32-field narrative |

## What's deliberately deferred

- **API submit** (`POST /formapi/api/.../responses`) — Bearer attachment incomplete, `401`. Path locked, post-demo polish. See `docs/MSFORMS_API_FILL_PLAN.md`.
- **Daily Report form** (57 fields, separate schema) — built but not on demo critical path. Use cloned Suspensions only.
- **Real MoE form** — Power Automate flow URL pending IT (Raj). Test.fac clone is the demo surface.

## Cross-references

- Schema: `extensions/moe-principal-assistant/forms/suspensions-schema.vlm.json`
- Form spec: `extensions/moe-principal-assistant/forms/suspensions-form-spec.md`
- Driver: `electron/services/forms-browser-v2/forms-driver.ts`
- Mac smoke: `scripts/forms-fill-suspensions.ts`
- Capture experiments: `scripts/forms-auto-fill-and-capture.ts`
- API plan: `docs/MSFORMS_API_FILL_PLAN.md`
- Demo turn order: `docs/DEMO_RUNBOOK_2026-05-26.md` lines 158-170
