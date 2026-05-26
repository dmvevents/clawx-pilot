# Outlook And Forms Critical Path

## Runtime Path

Outlook and Forms must run through the installed app:

1. Renderer callers go through `src/lib/host-api.ts` / `src/lib/api-client.ts`.
2. Under the wrapper, `hostapi:fetch` invokes the Electron IPC bridge and injects the Host API bearer token.
3. Host API routes:
   - `POST /api/outlook/open`
   - `POST /api/outlook/read-inbox`
   - `POST /api/outlook/draft`
   - `POST /api/outlook/send`
   - `POST /api/outlook/search-inbox`
   - `POST /api/outlook/read-email`
   - `POST /api/outlook/reply`
   - `POST /api/outlook/forward`
   - `POST /api/outlook/mark-read`
   - `POST /api/outlook/list-attachments`
   - `POST /api/outlook/download-attachment`
   - `POST /api/forms/list`
   - `POST /api/forms/preview-suspension`
   - `POST /api/forms/submit-suspension`
4. Main process managers drive Chrome CDP.

## Load-Bearing Files

- `electron/main/ipc/host-api-proxy.ts`: renderer bridge and token injection.
- `electron/api/routes/outlook.ts`: Host API Outlook routes and safe logging.
- `electron/api/routes/forms.ts`: Host API Forms routes and submit gate.
- `electron/services/outlook-browser-v2/manager.ts`: v2 manager.
- `electron/services/outlook-browser-v2/outlook-actions.ts`: draft/send/reply/forward/download behavior.
- `electron/services/forms-browser-v2/manager.ts`: Forms URL lookup and list/preview/submit surface.
- `extensions/moe-principal-assistant/index.mjs`: Gateway plugin tools. OpenClaw expects each tool to expose `execute(toolCallId, params)`, not `handler(params)`.
- `shared/feature-flags.ts`: `OUTLOOK_BROWSER_V2`, `PRINCIPAL_SKILL_ALLOWLIST`.

## Safety Gates

- Draft tools leave drafts open.
- `outlook.send_email` requires `confirm: true`.
- v2 send verifies an open draft and subject match before clicking Send.
- `outlook.download_attachment` requires `confirm: true`.
- `forms.preview_suspension` fills but does not submit.
- `forms.submit_suspension` requires `confirm: true`.
- Logs should contain tool names, status, counts, subject preview, and body length only.

## Acceptance Criteria

- Windows Host API safe probe opens Outlook through signed-in Chrome.
- Gemini/Claude chooses `outlook.open` and the OpenClaw tool execution result is not `tool.execute is not a function`.
- `forms.list` returns `available` once the form URL is visible to the installed app.
- Send/download/submit refuse without confirmation.
- Verification artifacts are screenshots, redacted probe JSON, app logs, and transcript snippets with no secrets.
