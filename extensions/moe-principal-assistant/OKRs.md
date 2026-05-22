# MoE Principal Assistant — OKRs and Acceptance Criteria

**Audience:** Anton (delivery lead), Raj (Ministry IT liaison), pilot principals, internal ClawX devs.
**Source of truth:** project_scope.md (Sections 1–3 of the engagement). Acceptance criteria here trace back to the scope items principals were promised.

This document is the contract the agent commits to. If a behaviour isn't here, treat it as out of scope until it is.

---

## Comparison: what modern Electron AI agents ship

We are not inventing the surface — we're reusing what users already expect.

| Pattern | Where it shows up | Our equivalent |
|---|---|---|
| Chat composer with @-mention agents | Cursor, Continue.dev | `src/pages/Chat/ChatInput.tsx` — already supports `@agent` |
| Slash-commands / skill picker | Claude Code, Cursor | `src/pages/Chat/ChatInput.tsx` `/skill` token highlighting |
| File drop / paste / dialog | Anthropic Claude Desktop, ChatGPT app | Three-way file ingest — already implemented |
| Mic button + voice transcription | ChatGPT app, Granola, Limitless | `src/components/chat/MicButton.tsx` + `whisper-asr` skill |
| Per-provider settings tile (with sign-in) | OpenAI/Anthropic apps, MS Copilot | `src/pages/Settings/MicrosoftGraphSection.tsx` |
| "Mock" or "demo" mode | Vercel AI playground, MS Copilot Studio | `mockMailbox` toggle + fixture |
| Skills / MCP marketplace | Claude Code, OpenWebUI | `src/pages/Skills/index.tsx` + ClawHub |
| Cron / scheduled prompts | Lindy, Manus | Existing cron handlers + `moe:seed-cron` |
| Browser automation | OpenInterpreter, Manus, n8n | OpenClaw `browser` plugin + `moe-form-filler` wrap |
| Artifact preview before send | Claude artifacts, ChatGPT canvas | `src/components/file-preview/ArtifactPanel.tsx` |
| Persona / system-prompt customisation | OpenWebUI, LibreChat | `src/persona.mjs` |
| Desktop notifications | Linear, Notion AI | `electron.Notification` in `moe-seed.ts` |

If a feature in this OKR doesn't have a clear analogue above, we're either pioneering or scope-creeping. Flag it.

---

## Objective 1 — Reduce time-to-submit for the daily report

**Why it matters:** This is the single highest-frequency admin task (every weekday by 3:45pm) and the most concrete pain point in the scope doc. If we don't move the needle here, nothing else matters.

### Key Results
- **KR1.1** — Median time from "principal opens ClawX" to "Microsoft Forms submission confirmation" ≤ **90 seconds** during pilot.
- **KR1.2** — ≥ 80% of pilot principals submit at least one daily report through ClawX in week 1 of training.
- **KR1.3** — Zero double-submissions caught by the idempotency ledger (`electron/services/moe-form-filler/store.ts`).

### Acceptance criteria — `principal.daily_report_payload`
- **Given** a principal dictates "12 teachers present, 287 of 312 pupils present, 4 absent, NSDSL meals 230 distributed, no incidents, transport fine"
- **When** the agent calls `principal.daily_report_payload`
- **Then** the returned payload contains `teachersPresent: 12`, `pupilsPresent: 287`, `pupilsAbsent: 25`, `mealsDistributed: 230`, `disciplineIncidents: ''` or null, `transportIssues: ''` or null
- **And** missing required fields (`educationDistrict`, `schoolType`, `schoolName`) are auto-filled from plugin config when present
- **And** the agent never asks for fields already in config

### Acceptance criteria — `moe-form-filler` flow
- **Given** the principal's Chrome is signed into `@moe.gov.tt` with the Daily Report form URL configured
- **When** the agent calls `moeforms:start({ kind: 'daily-report', payload })`
- **Then** the form-filler navigates to the form, snapshots the field tree, maps payload → fields, and emits `stage: 'preview'` within 5 seconds
- **And** the renderer surfaces the preview with payload-key → form-question mapping and any unmatched fields
- **When** the principal explicitly clicks "Confirm" (or says "submit")
- **Then** the form-filler issues `act:fill` + clicks Submit, records to the ledger, emits `stage: 'submitted'`
- **And** the agent never auto-submits without that explicit confirmation step

---

## Objective 2 — Make written correspondence faster while keeping the principal's voice

**Why it matters:** Drafting parent letters, internal memos, and Ministry-bound notices is the second-largest time sink. The agent must produce drafts the principal would actually send — not generic AI prose.

### Key Results
- **KR2.1** — ≥ 70% of `principal.draft_letter` outputs need ≤ 2 edits before sending (sample = 30 letters reviewed by pilot principals).
- **KR2.2** — `principal.summarise_circular` outputs include explicit `{summary, action_items, deadline}` fields with ≥ 90% deadline-extraction accuracy on a labelled set of 20 real MoE circulars.
- **KR2.3** — All drafts addressed to or about pupils show student names redacted to "Student A/B/C" with zero false negatives.

### Acceptance criteria — `principal.draft_letter`
- **Given** `{ recipient: 'Mrs. Boodoo', subject: 'Bus delay this morning', intent: 'apology + remediation', key_points: ['delay confirmed', 'maths catch-up arranged for Monday'] }`
- **When** the agent calls the tool
- **Then** the response is plain prose using British English (`apologise`, `recognise`, `programme`)
- **And** it follows the `templates/letter.md` structure (school header, date, salutation, body, closing, signature block)
- **And** it does not contain LLM-tells like "I hope this email finds you well" or "Please don't hesitate to reach out"
- **And** if any `key_points` mention a pupil by name, the draft uses "Student A" instead

### Acceptance criteria — `principal.summarise_circular`
- **Given** the body of an MoE circular pasted in
- **When** the agent calls the tool
- **Then** the response is structured as `{ summary: string ≤ 80 words, action_items: string[], deadline: ISO date | null }`
- **And** if no deadline is parseable, `deadline` is `null` (never invented)
- **And** action items are imperative-form, second-person ("Submit the…", "Confirm with…")

---

## Objective 3 — Make voice the primary input for time-pressed principals

**Why it matters:** Principals are interrupted constantly. Typing during the school day is hostile UX. ASR is the single biggest accessibility win.

### Key Results
- **KR3.1** — Word Error Rate ≤ 8% on a 30-clip Trinidadian-English benchmark (small.en model).
- **KR3.2** — Median end-to-end (record-stop → text-in-composer) latency ≤ 6 seconds for a 30-second clip on M1 / Apple Silicon, ≤ 10 seconds on Windows ARM/x64 with `ggml-small.en`.
- **KR3.3** — `whisper-asr` plugin enabled for 100% of pilot installs; first-run model download flow completes without user intervention beyond a single Accept click.

### Acceptance criteria — MicButton
- **Given** the user has granted mic permission and the whisper-asr plugin is configured
- **When** the user clicks Record, speaks, clicks Stop
- **Then** the composer shows `[transcribing voice note…]` within 250ms of Stop
- **And** the placeholder is replaced with the transcribed text within 10 seconds for clips ≤ 30s
- **And** if transcription fails, the placeholder is replaced with `[voice note saved at <path>; transcription failed]` and a toast surfaces the actionable error (mic denied / bin not found / model not found / ffmpeg missing)
- **And** the OS-level mic indicator goes off the moment Stop is clicked (no zombie mic streams)

### Acceptance criteria — privacy
- Audio is written to `app.getPath('temp')` only, mode `0600`, in a `clawx-asr-*` mkdtemp directory.
- Audio never crosses the network at v1. Cloud ASR (Azure / OpenAI) is opt-in; default is local whisper.cpp.

---

## Objective 4 — Make Outlook triage usable in five minutes a day

**Why it matters:** Principals get overwhelming volumes of Ministry circulars + parent emails. The agent should let them clear the inbox without opening Outlook.

### Key Results
- **KR4.1** — `outlook.list_messages` returns inbox preview within 2 seconds of the principal opening ClawX (cold) on a 50-msg inbox.
- **KR4.2** — Drafted replies sent via `outlook.send_mail` show "From: Principal" headers — not "via ClawX" — so recipients see the principal's own voice.
- **KR4.3** — The mock-mailbox demo experience is fully clickable (list → read → draft → send) without any Microsoft sign-in.

### Acceptance criteria — mock mailbox parity
- **Given** `mockMailbox: true` or no Graph sign-in
- **When** any `outlook.*` tool is called
- **Then** it returns the same shape (`{ value: [...] }`, `{ id, subject, from, ... }`) as the real Graph response
- **And** the renderer Settings tile shows a `Mock mailbox` badge
- **And** `sendMail` succeeds without hitting Graph but logs `[msgraph mock] sendMail ...` in main-process logs

### Acceptance criteria — real-tenant flow
- **Given** an Entra app registration in the tenant with the documented scopes
- **When** the principal enters tenantId + clientId and clicks Sign in
- **Then** the system browser opens to `login.microsoftonline.com`, completes OAuth2 PKCE, and lands on `localhost:53682/callback` with a "you can close this tab" page
- **And** the renderer flips to "signed in" with the principal's `email` and the token's `expiresAt` shown
- **And** subsequent calls use the cached refresh token; expired access tokens auto-refresh once before failing

---

## Objective 5 — Stay in the principal's existing workflow

**Why it matters:** Principals will not adopt a tool that conflicts with their browser, mailbox, or filing system. The agent attaches to what they already use.

### Key Results
- **KR5.1** — Form-filling uses the principal's already-signed-in Chrome (`existing-session` profile) — zero new credentials required to fill the form.
- **KR5.2** — Letters generated by `principal.draft_letter` are saved as `.docx` (or pasted into Outlook compose) without converting to AI-tool-specific formats.
- **KR5.3** — The 3:45pm reminder fires as a desktop Notification, not just a chat message, so a principal not actively in ClawX still gets prompted.

### Acceptance criteria — browser handoff
- **Given** Chrome is running with remote debugging (instructed via onboarding), and the principal is signed in to Microsoft 365
- **When** the form-filler opens the form URL
- **Then** the form loads in that Chrome window using the principal's existing session — no second sign-in dialog
- **And** if Chrome is not signed in, the form-filler emits `stage: 'awaiting-signin'` with a message instructing the principal to complete sign-in in the Chrome window, then resume

### Acceptance criteria — desktop notifications
- **Given** the seed cron job `MoE Daily Report 3:30pm reminder` is scheduled
- **When** the cron fires (Mon-Fri 15:30 server time)
- **Then** Electron's native `Notification` shows with title `Daily Report due at 3:45pm`
- **And** clicking the notification focuses the ClawX window (TODO: wire up activate listener)

---

## Out-of-scope guardrails

The agent will **not**:
- Authorise, recommend, or trigger student suspensions on its own.
- Submit any form without explicit confirmation in the same turn.
- Send mail on behalf of a principal without showing the draft and getting confirmation.
- Use a pupil's full name in any output that may leave the device. Always "Student A/B/C".
- Provide legal advice. If asked, the persona offers to draft a referral to the Ministry's legal section.
- Operate against MoE's production tenant without an admin-approved Entra app registration.

---

## Definition of Done for v1 (pilot)

A pilot principal can:
1. Open ClawX, see their own email (mock or real depending on Entra status).
2. Dictate today's daily report numbers.
3. See the agent draft the form payload, click Confirm, watch their Chrome submit the form.
4. Be reminded by a desktop toast at 3:30pm if they haven't done so yet.
5. Draft a parent letter from a one-line voice note and copy it into Outlook.
6. Have all of the above survive a ClawX restart without losing config.

If any of those is missing, we're not done with v1.
