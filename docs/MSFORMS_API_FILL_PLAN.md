# MS Forms API-only fill — engineering plan

**Goal:** Given a form URL pasted by a teacher, programmatically submit a response. **No browser DOM, no clicking, no editor session.** Just HTTP POST.

This is the production skill for autonomous form submission. Browser DOM fill stays as fallback for when API access is denied.

---

## What we already know

From the design-side reverse-engineering:

| Surface | Endpoint | Auth | Status |
|---|---|---|---|
| Read form schema | `GET /formapi/api/{tenant}/users/{user}/forms('{id}')` | session cookie + `__requestverificationtoken` header | ✅ proven (used by our list-cleanup tool) |
| List questions | `GET /formapi/api/.../forms('{id}')/questions` | same | ✅ proven |
| Create question | `POST /formapi/api/.../forms('{id}')/questions` | same | ✅ proven |
| Delete question | `DELETE /formapi/api/.../forms('{id}')/questions('{id}')` | same | ✅ proven |
| **Submit response** | `POST /runtime/api/...` (TBD) | **TBD** | ❓ to capture |

The respondent side uses a different host path (`/runtime/api/`) and may have different auth (the responder is often a different identity than the form owner).

---

## What we need to capture (one real submit)

When you fill the form on `https://forms.office.com/Pages/ResponsePage.aspx?id={formId}` and click Submit, the page POSTs to a runtime endpoint. We need:

1. **Endpoint URL** — likely `https://forms.office.com/runtime/api/{tenant}/forms('{id}')/responses` but could be `/answers` or `/submissions`
2. **Headers** — almost certainly `__requestverificationtoken` (same CSRF pattern as design)
3. **Body shape** — the answer encoding. From scattered references:
   ```json
   {
     "startDate": "2026-05-25T20:00:00.000Z",
     "submitDate": "2026-05-25T20:01:23.000Z",
     "answers": "[{\"questionId\":\"r{32hex}\",\"answer1\":\"<text or option-id>\"}]"
   }
   ```
   `answers` is a JSON STRING (double-encoded), each entry is `{questionId, answer1, answer2, …}`.
4. **Choice answer encoding** — for `Question.Choice`, does `answer1` contain the option's display text or an internal option-id? Capture confirms this.

---

## Implementation plan (3 phases)

### Phase 1 — capture (1 manual fill)

`scripts/forms-capture-submit.ts`:
- Attach via CDP, watch network for POSTs to `/runtime/api/`
- User opens form in new tab, fills 4-5 fields, clicks Submit
- We log full request URL, headers, body
- Output: `/tmp/forms-submit-shape.json` containing the lock-in shape

### Phase 2 — API-only submit driver

`electron/services/forms-graph/forms-runtime-client.ts`:

```typescript
export interface SubmitArgs {
  formUrl: string;          // any of: /r/SHORT, /Pages/ResponsePage?id=, full design URL
  answers: Record<string, string | string[]>;  // map question label → value
  confirm: boolean;
}

export interface SubmitResult {
  status: 'submitted' | 'refused' | 'error';
  responseId?: string;
  reason?: string;
}

async function submitFormResponse(args: SubmitArgs): Promise<SubmitResult>
```

**Implementation steps:**
1. Parse form URL → extract form id
2. `GET /formapi/api/{tenant}/anonymous/forms('{id}')` (or whatever public endpoint exists) to read questions + their option ids
3. Map user-supplied label → questionId, user-supplied value → answer1 string (text) or option Description (choice)
4. Build the `answers` JSON string per the captured shape
5. `POST /runtime/api/.../responses` with the body
6. On 201, return `responseId`. On 4xx, surface `reason`.

### Phase 3 — wire as agent tool

Already-prepared host-API + plugin tool surfaces (see `forms-browser-v2/manager.ts`). Swap the implementation to call `forms-runtime-client.submitFormResponse` instead of the browser-driver. Same agent-facing tool name (`forms.submit_suspension`), same hard-confirm gate.

**The teacher's experience:**
1. Principal pastes a form URL or says "submit today's daily report"
2. Agent reads the form schema (one Graph or formapi call)
3. Agent extracts the 32 answers from the source document (Outlook email, PDF, etc.)
4. Agent shows preview to principal in chat ("here's what I'll submit, confirm?")
5. Principal confirms
6. Agent POSTs to runtime endpoint — done in <1 second
7. Agent reports the response id in chat

No browser, no editor, no Chrome session needed. Production-ready.

---

## Token / auth model

**Open question:** does the runtime/responses endpoint accept anonymous (form-key auth, no user login) or does it require the responder's session?

- If **anonymous-allowed** (the form is shared publicly): we can submit from a headless context with just the form URL. Best case.
- If **requires-responder-session**: we need a one-time browser login per principal to mint a Forms-scoped cookie + Bearer, then we cache it. Same pattern as Outlook today.

The capture in Phase 1 will tell us which model the form is in. Most MoE forms are tenant-scoped, so likely the responder-session path. That's still fine — we already attach to the principal's existing browser session today.

---

## Why this matters

With the DOM fill driver: 30+ seconds per submission (waiting for page load, animations, etc.) and brittle to layout changes.

With the API driver: <1 second, no DOM at all, immune to UI changes (only schema changes break it, and schema is what we already extract via VLM).

This is **the** production-grade form-submission skill for ClawX.
