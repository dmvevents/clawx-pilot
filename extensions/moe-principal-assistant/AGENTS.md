# MoE Principal Assistant Plugin Guidance

This plugin is loaded by OpenClaw as a Gateway plugin.

Rules:

- OpenClaw tool objects must expose `execute(toolCallId, params)`. Do not use `handler`.
- Every tool must include a JSON-schema `parameters` object; no `undefined` schemas.
- Preserve the principal safety contract: draft first, no send/submit/download without explicit same-session confirmation.
- Do not log passwords, tokens, Forms URLs, email bodies, or full recipient lists.
- Outlook and Forms browser-session tools must call Electron Host API through `CLAWX_HOST_API_PORT` and `CLAWX_HOST_API_TOKEN`; do not duplicate browser automation in this plugin.
- Microsoft Graph is not the real-send path unless it gets the same visible draft and confirmation semantics as Outlook Browser v2.

Verification:

- Run `node -c extensions/moe-principal-assistant/index.mjs`.
- Run `pnpm exec vitest run tests/unit/moe-principal-assistant-plugin.test.ts`.
- When changing tool registration, verify all registered tools have `execute` and `parameters`.
