# moe-principal-assistant (ClawX plugin stub)

Persona, tone, jurisdiction, templates, and form-payload builders for a
digital admin assistant serving primary-school principals in Trinidad &
Tobago.

The Ministry of Education (MoE) is the customer; the principal is the user.
This plugin gives the agent the *role* and the *shape of its outputs*. It
does not call any external service on its own.

## Status

**Stub.** The plugin registers six openclaw tools and exports a system
prompt. The plugin is **disabled by default** (`enabledByDefault: false`)
and refuses to register tools until `principalName`, `schoolName`,
`educationDistrict`, and `schoolType` are configured.

## Configure

In the host's `openclaw.json`, under the plugin entry for
`moe-principal-assistant`:

```json
{
  "principalName": "Mrs. J. Maraj",
  "schoolName": "Belmont Boys' RC School",
  "educationDistrict": "Port of Spain & Environs",
  "schoolType": "Denominational",
  "defaultDailyReportRecipientUrl": "https://forms.office.com/...",
  "defaultSuspensionFormUrl": "https://forms.office.com/..."
}
```

The seven valid `educationDistrict` values are: **Caroni**, **North
Eastern**, **Port of Spain & Environs**, **South Eastern**, **St. George
East**, **St. Patrick**, **Victoria**. `schoolType` is **Denominational**
or **Government**.

## Tools registered

| Name | Purpose |
|---|---|
| `principal.draft_letter` | Draft a formal letter from `templates/letter.md`. Returns prose. |
| `principal.draft_memo` | Draft an internal memo from `templates/memo.md`. Returns prose. |
| `principal.summarise_circular` | Returns the structural shape `{ summary, action_items, deadline }` the agent fills in. |
| `principal.daily_report_payload` | Build the JSON payload for the Primary School Daily Report (Term 3 2025/26). |
| `principal.suspension_payload` | Build the JSON payload for the Primary School Student Suspensions form. |
| `principal.find_school` | Substring search against `data/schools.json`; returns up to 10 matches. |

## Persona

`@clawx/moe-principal-assistant/persona` exports `SYSTEM_PROMPT`. The host
should prepend it to the agent's base system message when the plugin is
enabled. It establishes:

- **Role.** Digital admin assistant for primary-school principals in T&T.
- **Tone.** Respectful, professional, plain English, brief by default.
  British English spelling; matches the principal's register.
- **Jurisdiction.** T&T; the seven MoE education districts; Denominational
  and Government schools; Standard 1–5 (with Infant 1–2); NSDSL school
  meals.
- **Capabilities.** Drafting letters/memos/notices; summarising circulars,
  emails, meeting notes; preparing minutes and action items; assisting
  with the daily report and suspension forms; tracking deadlines; taking
  call notes.
- **Boundaries.** Not a lawyer; will not authorise discipline; will not
  submit forms or send messages without explicit confirmation; redacts
  pupils' names ("Student A") in any draft that may leave the school.
- **Output discipline.** JSON-only for form payloads; prose-only for
  letters, memos, summaries, and minutes.

## What's intentionally stubbed

- **The school roster.** `data/schools.json` ships ~30 representative
  entries with a `__note__` flag. The full ~1300-school MoE roster will
  replace it; `principal.find_school` works the same way once it does.
  `educationDistrict` is left `null` for entries we are not certain about
  rather than guessed wrong.
- **Form submission.** This plugin only *builds* the payload. Actual
  submission to Microsoft Forms is delegated to a separate plugin (a
  browser-driver plugin or `@clawx/microsoft-graph` if/when the MoE
  exposes the form via Graph). The principal must explicitly confirm
  before any submission.
- **`principal.summarise_circular`.** The handler returns the structural
  shape only; the model is expected to do the actual summarisation. This
  is deliberate — keeping the structure here means the UI and downstream
  tools have a stable schema to rely on regardless of which model the
  host routes to.

## Composition with sibling plugins

The principal-admin experience is a composition of three plugins:

| Plugin | Role |
|---|---|
| `@clawx/whisper-asr` | Captures dictation (end-of-day notes, call summaries) on-device with whisper.cpp. Audio never leaves the machine. |
| `@clawx/moe-principal-assistant` | Turns the principal's words into the right *shape*: letter, memo, daily report payload, suspension payload, summary. |
| `@clawx/microsoft-graph` | Sends the resulting letter or memo as Outlook mail to the district office, parents, or staff, scoped to the school's Entra tenant. |

A typical end-of-day flow:

1. Principal taps the mic. `whisper-asr` transcribes locally.
2. The agent classifies the dictation (daily report? suspension? letter?
   memo?) and calls the matching `principal.*` tool to produce a
   structured payload or draft.
3. The agent reads back the result. The principal says "send" or "submit".
4. For mail, `microsoft-graph` sends. For Microsoft Forms, a browser
   plugin (out of scope here) navigates the form using the JSON payload
   as input.

## Why a separate plugin and not just a system prompt?

Three reasons:

- **Per-principal config.** The school name, district, and principal's
  name are configuration, not prompt. Hard-coding them in the system
  prompt would make a second-school deployment a code change.
- **Form payload schemas.** The MoE forms have a real shape. Keeping that
  shape in code (and validating required fields before returning) means
  the agent cannot invent fields or skip required ones.
- **Composition.** The persona has to coordinate with `whisper-asr` and
  `microsoft-graph`. Treating it as a plugin lets the host turn it on or
  off per deployment alongside its siblings.

## What's not here

- **Live form submission.** See above.
- **Reminders / scheduling.** The persona mentions deadline tracking; the
  *mechanism* (a scheduler tool) lives elsewhere in the host.
- **Telephony.** "Answering calls" in the scope is voicemail/transcription
  assist, not a softphone. That work belongs to whichever telephony
  integration the deployment chooses.
- **Multi-school support.** One principal, one school, per host config.
  A multi-school district-office variant would be a separate plugin.

## Composition with the bundled memory + speech stack

This persona is intentionally thin. It does not implement memory recall, voice
transcription, web search, or browser automation — the bundled OpenClaw
runtime already ships those primitives, and reinventing them creates a fork
this codebase will not maintain. The integration map:

### Memory (`memory-core` + `memory-lancedb` + `memory-wiki` + `active-memory`)

The bundled memory stack is in
`node_modules/openclaw/dist/extensions/{memory-core,memory-lancedb,memory-wiki,active-memory}/`.
For this deployment:

- **`memory-core`** — the canonical memory primitive. Owns the `dreaming`
  consolidation cycle (light/REM/deep phases) that ClawX's Dreams page
  surfaces. Nightly summarisation of the day's circulars, parent emails, and
  meeting notes lands here.
- **`memory-lancedb`** — vector backend. The repo-root `ruvector.db` is the
  active LanceDB store. Configure `embedding.{model, baseUrl, apiKey}` to use
  the embedding model the deployment prefers. Use this for semantic recall
  ("what did the parent of Student J ask last term?") rather than keyword
  search.
- **`memory-wiki`** — Obsidian-friendly vault. Optional; useful if the
  principal already keeps an Obsidian vault and wants minutes / circular
  summaries written there as Markdown they can audit.
- **`active-memory`** — runs a bounded sub-agent before each conversational
  reply to inject relevant memory context. This is the lever to make the
  persona "remember" yesterday's daily report or last week's PTA notes
  without shoving everything into the system prompt. Configure under
  `plugins.entries.active-memory.config` in `~/.openclaw/openclaw.json`.

We do not write a custom recall layer for this persona. If the principal asks
"summarise last month's parent complaints", the agent calls
`active-memory` / `memory-lancedb` tools — both already available.

### Voice transcription (`openai-whisper` skill / `media-understanding-core`)

Mic capture happens in the renderer (`src/components/chat/MicButton.tsx` +
`asr:saveBlob` IPC) — that's a genuine gap the bundle doesn't fill. But the
*transcription itself* is delegated to whatever the deployment configures:

- **`openai-whisper`** skill — local Python whisper CLI, no API key.
  Brew-installable. Default for airgap-resilient deployments.
- **`openai-whisper-api`** skill — cloud OpenAI transcription. Faster,
  network-dependent.
- **`media-understanding-core`** + a configured provider (deepgram, openai,
  elevenlabs, mistral, xai) — the bundled realtime-transcription contract
  for streaming dictation. Five providers ship out of the box.

The MicButton hands a file path to the agent in chat; the agent picks the
right transcription tool based on the skills the deployment has enabled.
No bespoke `whisper-asr` extension is required — an earlier scaffold by that
name was removed when the audit found it duplicated `openai-whisper`.

### TTS (`speech-core` with provider fallback chain)

Seven TTS providers ship: microsoft (Azure), openai, elevenlabs, google,
minimax, xai, vydra. The persona will use whatever provider is configured
under `messages.tts.*`; we do not need to wire one explicitly. Inline
`[[tts:...]]` directives are also supported.

### Web search (any of seven bundled providers)

`tavily, brave, exa, firecrawl, searxng, duckduckgo, perplexity` are all
shipped. `tavily-search` is auto-installed via the preinstalled-skills
manifest. The persona may use whichever search tool the deployment exposes.

### What we *do* still own

- The Trinidad-jurisdiction system prompt (`src/persona.mjs`).
- The form-payload schemas (Daily Report, Suspension) and validation
  (`src/index.mjs`).
- The MoE-formatted letter, memo, and daily-brief templates (`templates/`).
- The school list (`data/schools.json`).
- The handoff to `microsoft-graph` for mail and to the `moe-form-filler`
  service (in the host) for Microsoft Forms submissions.

Everything else is bundled.
