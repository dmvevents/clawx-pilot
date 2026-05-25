# Microsoft Forms internal `/formapi/` (reverse-engineered, 2026-05-25)

We captured the Forms web app's own API by attaching Playwright over CDP to the user's Chrome and watching network. This is undocumented but it's what `forms.office.com/Pages/DesignPageV2.aspx` itself talks to. **No Graph token needed** — rides on the user's session cookies.

## Endpoint shape (OData)

```
Base: https://forms.office.com/formapi/api/{tenantId}/users/{userId}/forms('{formId}')
```

- `{tenantId}` — Microsoft 365 tenant GUID, e.g. `9590bb09-ce2c-40e2-8181-fad0a7edebfe` for `fac.edu.tt`
- `{userId}` — your user object id within the tenant
- `{formId}` — base64url-encoded form id from the design URL (`?id=...`)

You can read all three from the design page URL (`Pages/DesignPageV2.aspx?id=...`) and the `O365ClientService` cookie or `_authToken` element.

## CONFIRMED: Create question

```http
POST {base}/questions
Content-Type: application/json
Cookie: <existing session cookies>

{
  "type": "Question.TextField",
  "title": "Question",
  "id": "ref2bc769b36241d98ff20df30f1bb577",
  "order": 2000500,
  "isQuiz": false,
  "required": false,
  "questionInfo": "{\"Multiline\":false,\"ShuffleOptions\":false,\"ShowRatingLabel\":false}"
}
```

Response: `201 Created` with `@odata.context` and the created question entity.

**Notes:**
- `id` is a client-generated string starting with `r` and 32 hex chars (essentially `r + uuid-without-dashes`)
- `order` is a sortable float — increments by `1000000` per question, with `500` jitter so reordering doesn't collide
- `questionInfo` is a JSON STRING (not a JSON object) — double-encoded
- The default `title: "Question"` is created on click; the real title is set by a subsequent PATCH

## INFERRED: Other question types

The `type` enum follows the pattern `Question.{Kind}`. Likely values (need confirmation by capturing):

| Type | Schema |
|---|---|
| `Question.TextField` | ✅ confirmed. `questionInfo`: `{Multiline,ShuffleOptions,ShowRatingLabel}` |
| `Question.Choice` | inferred — likely embeds `choices: [{title}]` array, `questionInfo`: `{ShuffleOptions, AllowMultipleSelection}` |
| `Question.DateTime` | inferred — likely no `questionInfo` body |
| `Question.Rating` | inferred — `questionInfo`: `{Levels: 5, Style: "stars"}` |
| `Question.Likert` | inferred — has `statements` and `choices` arrays |

## INFERRED: Update question (title, required)

```http
PATCH {base}/questions('{questionId}')
Content-Type: application/json

{
  "title": "Education District",
  "required": true
}
```

Probably uses standard OData PATCH semantics. Need to confirm with capture-while-typing.

## INFERRED: Set form title/description

```http
PATCH {base}
Content-Type: application/json

{
  "title": "Primary School Student Suspensions: Term 3 2025/26",
  "description": "..."
}
```

## INFERRED: Submit response (for fill side)

When a respondent clicks Submit on a `ResponsePage.aspx`, the runtime API takes a different shape:

```
POST https://forms.office.com/runtime/api/{tenantId}/forms('{formId}')/responses
Content-Type: application/json

{
  "answers": "[{\"questionId\":\"r...\",\"answer1\":\"value\"}]"
}
```

This is what we'd hit programmatically to **submit the form** — same session cookie, no Graph token. THIS is the production-relevant endpoint for principals filling forms autonomously.

## What we know works (proof from today)

- 1× `POST /questions` with `Question.TextField` → 201 Created, the question appeared in the editor.
- The session cookie set by `forms.office.com` is what gates the call. No bearer token in the headers.

## What we don't know yet

- Choice / DateTime / Rating bodies (need a clean capture)
- PATCH body for title/required (capture-while-typing)
- Submit response shape on `runtime/api`
- Token rotation behaviour: are the cookies sufficient on their own, or is there a CSRF/double-submit token (e.g., `__RequestVerificationToken`)?

## Production implications

**This is not the path for production with `@moe.gov.tt`.** It works because we're driving an interactive Chrome that already authenticated. For headless / Windows pilot / cron-driven submission, we still need the Graph + SharePoint List path (`docs/MSFORMS_API_PATHS.md`).

But for **the demo tomorrow**: this is gold. We can submit form responses without needing IT to do anything new.

## Open-source references to chase post-demo

- `microsoftgraph/microsoft-graph-docs-contrib` — Microsoft's public Graph docs (no Forms write API documented)
- `pnp/pnpjs` — PnP SharePoint client; has utilities for the legacy `_api/web/lists` endpoint that backs Forms
- Reverse-engineering blog posts to chase: search "forms.office.com formapi reverse engineering" with sign-in to GitHub code search
