# Ministry of Education — Principal's Administrative Assistant

**Audience:** primary-school principals across Trinidad & Tobago's seven education districts (Caroni, North Eastern, Port of Spain & Environs, South Eastern, St. George East, St. Patrick, Victoria), Standards 1–5 plus Infant 1/2, Denominational and Government schools, with NSDSL meal-programme integration.

**Form factor:** Native desktop application (Mac and Windows), branded **Ministry of Education**, runs locally on the principal's machine. Uses on-device AI for routine work, escalates to managed cloud (Gemini, Bedrock Claude) only when the task requires it.

**Status as of moe.10 (2026-05-25):** Mac build is live and end-to-end verified against a real Outlook session. Windows .exe builds on every push via GitHub Actions and is awaiting installation on the pilot laptop when the network link returns.

---

## Capability Status Legend

| Status | Meaning |
|---|---|
| **● Live** | Shipped in moe.10, end-to-end tested today against a real Outlook account |
| **◐ Built** | Code is in the bundle and unit-passes; awaiting external config (Entra packet, Power Automate flow, MoE form URLs) before it can run live |
| **○ Planned** | Designed and scoped; implementation in `extensions/moe-principal-assistant/` exists as a stub or template |

---

## 1. Email — ● Live

**Outlook integration via the principal's existing Chrome session.** The application attaches to the principal's already-signed-in Outlook tab over the Chrome DevTools Protocol on `127.0.0.1:18792`. We never log in for them, never store passwords, never replay session cookies. Conditional Access on the `@moe.gov.tt` tenant is honoured by riding the user's own SSO.

Eleven Outlook tools are registered with the agent:

| Tool | What it does | Hard-confirm gate |
|---|---|---|
| `outlook.open` | Opens the Outlook tab, navigates to inbox | — |
| `outlook.read_inbox` | Lists the top N inbox messages with sender, subject, snippet, unread/attachment hints | — |
| `outlook.search_inbox` | Filter by `from`, `subjectContains`, `dateGte`, `dateLt`, `unread`, `hasAttachment` | — |
| `outlook.read_email` | Reads a specific email's full body and attachments list | — |
| `outlook.draft_email` | Opens a new compose pane with To/Subject/Body filled, **left open for review** | Always leaves draft open — principal must click Send themselves OR explicitly authorise via send_email |
| `outlook.send_email` | Clicks Send | **Refuses** unless `confirm:true` AND the open compose pane's subject matches `args.subject`. Two locks. |
| `outlook.reply` | Opens reply pane on a specific message with body filled | Same draft-left-open pattern |
| `outlook.forward` | Opens forward pane | Same |
| `outlook.mark_read` | Marks a message read/unread | — |
| `outlook.list_attachments` | Returns metadata array for one message's attachments | — |
| `outlook.download_attachment` | Saves an attachment locally | **Refuses** unless `confirm:true` |

**Verified today:** the agent picked the right tool from natural language ("Open my inbox", "Show me my 5 most recent emails", "Draft an email to test.fac@fac.edu.tt"), the action executed against the live Outlook Web session, and the live send-test successfully sent a real message to `test.fac@fac.edu.tt`.

**Implementation:** `electron/services/outlook-browser-v2/` (PlaywrightDriver + VlmGrounder + OutlookActions). Exposed by `extensions/moe-principal-assistant/index.mjs` as gateway plugin tools. Frontend route allowlisted via `outlook` capability flag.

---

## 2. Daily Forms — ◐ Built

**Two MoE forms in scope:** "Primary School Daily Report" (attendance, meals, discipline, transport) and "Primary School Student Suspensions" (per-incident). Submission deadline 3:45pm school days.

Research is canonical at `docs/MSFORMS_AUTOMATION.md`. The decisive finding is that **Microsoft Graph has no Forms write endpoint** — submission goes through one of three paths, ranked:

1. **Power Automate webhook → SharePoint List that backs the form.** ClawX POSTs JSON to a flow URL that IT (Raj) creates with the "When an HTTP request is received" trigger. This is the recommended path. Paste the flow URL into Settings → MoE Forms once IT issues it. Tracked in **task #109**.

2. **Browser-attach via the same Outlook v2 pattern.** Open form, fill fields, preview, submit on the principal's authenticated tab. Wraps the existing PlaywrightDriver. Brittle to form UI changes but works without IT involvement.

3. **Avoid:** managed Chromium (Conditional Access blocks it with AADSTS53003) and reverse-engineered Forms REST (broken since Jan 2026).

**Already built:** form-payload schemas, daily-report and suspension form-payload builders in `extensions/moe-principal-assistant/`. The persona prompt enforces "no auto-submit without explicit confirmation". A 3:45pm cron reminder rides the existing `agentTurn` payload kind in the Cron system.

**Awaiting:** the Power Automate flow URL from IT (one per form).

---

## 3. Preparing Letters and Reports — ◐ Built

**On-device drafting from a structured prompt.** The agent drafts letters, memos, notices, circulars from a prompt + optional source documents. Output is drafted locally using on-device Hermes 3 8B (post-bake-off winner, 75% on agentic tool-use eval) for routine work, escalating to Gemini 2.5 Pro (1M context) for long-context tasks like multi-page reports or Excel + email compound queries.

The principal reviews and edits before anything leaves the machine. No content is sent to the cloud unless the principal triggers an Outlook send.

**Templates** live in `extensions/moe-principal-assistant/templates/`. The bundled principal toolkit includes:

- **docx** — Word document handling
- **pdf** + **nano-pdf** — PDF read/extract
- **xlsx** — Excel spreadsheets
- **pptx** — PowerPoint
- **summarize** — document summarisation skill

**Verified today:** the chat composer can read `~/Downloads/improving-gemini-for-education_v7.pdf` via the bundled `pdf` skill (subject to the path-allowlist gate). Excel + email compound queries through the `xlsx` skill route to Gemini 2.5 Pro (the default).

**Awaiting:** the `templates/` directory inside `moe-principal-assistant` is currently empty — letter/memo templates need to be authored. Tracked as a follow-up.

---

## 4. Leave and Attendance Record Support — ◐ Built / ○ Planned

**Inputs:** the daily-form payload builders (#2) cover the attendance-submission side. Reading attendance back is a different surface.

**Built:**
- `xlsx` skill reads Excel registers — covers schools that keep attendance in Excel.
- `docx` skill reads leave-letter Word documents.
- The agent can extract names and dates from documents (see #8 — Document processing).

**Planned (not yet built):**
- Persistent attendance/leave register (SQLite or SharePoint List) that the assistant updates from new documents and queries on demand.
- `register_update` and `register_query` tools in the moe-principal-assistant plugin.

**Recommendation for IT request:** ask Raj to provision a SharePoint List per school for "Leave Register" + "Attendance Register" — that gives both the assistant and humans a shared, auditable store, and the assistant can read/write via Graph using the same Entra app registration as Outlook.

---

## 5. Responding to Routine Queries — ● Live (in chat) / ◐ Built (over email)

**In chat:** the principal can ask anything in the composer ("What's the policy on substitute teachers?", "Summarise the latest circular"). The on-device Hermes 3 8B handles routine prompts; the brain icon (Think mode) escalates to Gemini 2.5 Pro for harder questions. **Verified today** end-to-end.

**Over email:** the agent can read incoming queries via `outlook.read_email`, draft a reply via `outlook.reply` (which opens the reply pane with the suggested body filled), and **leaves the draft open** for the principal to review. The send still requires the hard-confirm gate. End-to-end verified today against the live test account.

The persona is shaped by `extensions/moe-principal-assistant/PERSONA.md` — Trinidad & Tobago vocabulary (the seven districts, NSDSL, Standards/Infant levels, Denominational vs Government), no auto-submit, decisions stay with the principal.

---

## 6. Generating Meeting Minutes and Memos — ● Live (transcription) / ◐ Built (drafting)

**Transcription path is live:**
- Renderer-side mic capture is wired (`MicButton.tsx` + `asr:saveBlob` IPC) and records WAV directly.
- Pilot builds try configured Azure Speech first for higher-quality ASR, then fall back to the platform fast path (`macSpeechRecognize` on macOS and `WinSpeechRecognize.exe` on Windows).
- Python/OpenAI Whisper remains a final fallback only when the preferred and native paths are unavailable.

**Drafting path is built but un-templated:**
- The agent can take a transcript + meeting metadata (date, attendees, agenda) and produce minutes/memo output.
- Templates land in `extensions/moe-principal-assistant/templates/` (currently empty).

**Recommendation:** in the first principal-feedback session, capture three real meeting examples (PTA, staff, Board) so we author templates that match how Trinidad principals actually structure minutes — generic templates won't earn trust.

---

## 7. Tracking Inventory and Basic Administrative Follow-up — ◐ Built / ○ Planned

**Built today:**
- `taskflow` skill — task workflow execution.
- `taskflow-inbox-triage` skill — email triage workflow that classifies inbox messages and surfaces what needs principal attention.
- `agentTurn` cron payload kind — schedules recurring agent runs (the 3:45pm form-submission reminder is the canonical use case).

**Planned:**
- A `school_inventory` schema (school equipment, NSDSL stock, classroom supplies) that the assistant updates from new documents and queries on demand.
- Reminder pipeline: extract dates from incoming circulars/letters → write to a local reminder store → fire `agentTurn` cron at the right time.

**The bundled `tavily-search` and `weather` skills round out routine queries** ("what's the weather for the sports day", "search for the latest MoE policy on field trips").

---

## 8. Document Processing — ● Live (file reading) / ◐ Built (classification, extraction, drafting)

This is the largest workflow surface. Today's status by sub-bullet:

| Sub-capability | Status | How it works |
|---|---|---|
| **Route documents by type** | ◐ Built | The agent reads file extension + first-page content, chooses the right skill (`pdf` / `docx` / `xlsx` / `pptx`), and routes to the right downstream action. The persona prompt encodes routing rules for circulars, letters, leave applications, attendance reports. |
| **Extract names, dates, leave periods, action items** | ◐ Built | The agent prompts the LLM with the document text (read via the file-type skill) and asks for a structured JSON extraction. Fields land in a typed schema defined in the moe-principal-assistant plugin. |
| **Classify incoming documents** | ◐ Built | Classification taxonomy is encoded in the persona: `MoE_circular`, `parent_letter`, `staff_leave_application`, `attendance_report`, `inventory_form`, `meeting_minutes`, `disciplinary_record`, `other`. Returned alongside extracted fields. |
| **Generate reminders** | ◐ Built | Once a date is extracted (deadline, follow-up, meeting), the agent writes a cron entry via the `agentTurn` payload kind. Reminder fires as a notification + chat-composer prompt at the configured time. |
| **Update registers** | ○ Planned | Wired only as far as drafting the diff. A `register_update` tool that writes to SharePoint List / local SQLite is **not yet built** — see #4. |
| **Create filing suggestions** | ◐ Built | The classifier proposes a folder path (`/circulars/2026/05/` style) + filename based on the extracted fields. The principal reviews and accepts; the assistant moves the file via `fs:move` (subject to the path-allowlist gate). |
| **Build draft responses** | ● Live | For email: `outlook.reply` with body filled, hard-confirm gate. For letters: drafts open in a buffer for review before any save. |
| **Flag incomplete records** | ◐ Built | The extractor returns `confidence` per field. Anything below threshold (or with a `null` required field) lands in an "incomplete records" view. The principal triages those manually. |

---

## Architecture (one-paragraph summary)

Native Electron desktop app running on the principal's laptop. Three local processes:
1. **Electron main** — host-API on `127.0.0.1:13210` (the renderer talks to it; auth-token gated).
2. **OpenClaw gateway** — WebSocket on `127.0.0.1:18789` (the runtime that executes plugin tools and orchestrates the LLM turn).
3. **Chrome (the user's existing browser)** — exposes CDP on `127.0.0.1:18792` so the assistant can drive the principal's already-signed-in Outlook tab.

LLM routing: on-device Hermes 3 8B via Ollama for routine work; managed cloud (Gemini 2.5 Pro by default, Bedrock Claude Sonnet 4.5 for VLM grounding of Outlook UI elements) for harder turns. Cost is hidden in the frontend (logged in the backend only) and the model identity is anonymised in the UI to "Online" / "On this device" — principals don't need to think about model selection.

---

## What's locked behind external gates

| Gate | Owner | What it unblocks |
|---|---|---|
| **Entra app registration** in `moe.gov.tt` tenant | MoE IT (Raj). Packet ready: `/tmp/moe-entra-app-registration-request.md` (regenerable from template; see `reference_entra_packet.md`) | Microsoft Graph for Outlook tenant access, calendar reads, and SharePoint List writes for #4 register support |
| **Power Automate flows** for the two daily forms | MoE IT (one flow per form, HTTP-trigger, return SAS-style URL) | #2 daily-form submission |
| **MoE form URLs and field schemas** | MoE administration | #2 form-payload builders need the exact field IDs |
| **Real MoE logo asset** | MoE comms | UI branding (placeholder is currently 933 bytes) |
| **Pilot laptop network** | Pilot site (Cat-5 link) | Windows runtime testing of moe.10 |

---

## Verified end-to-end today (2026-05-25)

- ✓ Mac moe.10 boots (gateway 18789, host-API 13210)
- ✓ Live LLM → tool-pick → `outlook.open` (1.6s round-trip)
- ✓ Live LLM → `outlook.read_inbox` 5 rows (1.9s)
- ✓ Live LLM → `outlook.draft_email` to test.fac@fac.edu.tt (1.9s, draft left open for review)
- ✓ Hard-confirm gate refuses send when subject doesn't match args
- ✓ Hard-confirm gate refuses send without `confirm:true`
- ✓ Live `outlook.send_email` actually delivered to `test.fac@fac.edu.tt`
- ✓ Windows .exe builds clean on GitHub Actions runner (run 26413522998)

---

## Source-of-truth links

- Repository (upstream / public): https://github.com/ValueCell-ai/ClawX
- Repository (pilot fork with this MoE work): https://github.com/dmvevents/clawx-pilot
- This document: [`docs/PRODUCT_PRINCIPAL_ASSISTANT.md`](./PRODUCT_PRINCIPAL_ASSISTANT.md)
- Outlook integration design: [`docs/AGENT_OUTLOOK.md`](./AGENT_OUTLOOK.md)
- MS Forms automation research: [`docs/MSFORMS_AUTOMATION.md`](./MSFORMS_AUTOMATION.md)
- Production checklist: [`docs/PRODUCTION_CHECKLIST.md`](./PRODUCTION_CHECKLIST.md)
- Windows deployment: [`docs/WINDOWS_DEPLOYMENT_PLAN.md`](./WINDOWS_DEPLOYMENT_PLAN.md)
- moe.8 static validation: [`docs/MOE_8_WINDOWS_VALIDATION.md`](./MOE_8_WINDOWS_VALIDATION.md)

After this commit lands, the canonical GitHub URL will be:

`https://github.com/dmvevents/clawx-pilot/blob/main/docs/PRODUCT_PRINCIPAL_ASSISTANT.md`
