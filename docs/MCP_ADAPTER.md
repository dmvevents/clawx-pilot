# ClawX MCP adapter — gated forms/outlook tools for any MCP client (CLWX-71)

`scripts/clawx-mcp-server.mjs` is a thin stdio MCP server that proxies the
app's host-API (`127.0.0.1:13210`) as nine MCP tools, so any MCP client
(Claude Code, Claude Desktop, future agents) can drive the app's Outlook and
Microsoft Forms capabilities **through the same server-side gates the in-app
agent uses**. The adapter is deliberately dumb: it forwards requests
verbatim; the two-gate send (confirm + compose-pane subject fingerprint),
the forms hard-confirm gate, the `PRINCIPAL_SKILL_ALLOWLIST` kill-switch,
and the audit-first outbox writes all execute inside the app and cannot be
bypassed from any MCP client.

## Run

The Ministry of Education app must be running (the host-API is
auth-token-gated and per-boot).

```bash
CLAWX_HOST_API_TOKEN=<token> node scripts/clawx-mcp-server.mjs
# or via the package script:
CLAWX_HOST_API_TOKEN=<token> pnpm mcp:serve
```

Claude Code registration:

```bash
claude mcp add clawx -e CLAWX_HOST_API_TOKEN=<token> -- node scripts/clawx-mcp-server.mjs
```

**Token contract:** the bearer token comes ONLY from the
`CLAWX_HOST_API_TOKEN` env var — never argv, never files, never logged. It
is per-app-boot and in-memory only; with the app running, an operator can
recover it from the spawned gateway child's env (the documented
KERN_PROCARGS2 mechanism used by the live harnesses).

## Tools

| Tool | Host-API route | Gate |
|---|---|---|
| `forms_list` | `/api/forms/list` | read-only |
| `forms_preview_daily_report` | `/api/forms/preview-daily-report` | fills for review, never submits |
| `forms_submit_daily_report` | `/api/forms/submit-daily-report` | **hard confirm** (server-side) |
| `forms_preview_suspension` | `/api/forms/preview-suspension` | fills for review, never submits |
| `forms_submit_suspension` | `/api/forms/submit-suspension` | **hard confirm** (server-side) |
| `outlook_open` | `/api/outlook/open` | read-only attach |
| `outlook_read_inbox` | `/api/outlook/read-inbox` | read-only |
| `outlook_draft_email` | `/api/outlook/draft` | drafts stay open for review |
| `outlook_send_email` | `/api/outlook/send` | **two-gate**: confirm + pane-subject match |

Confirmed submits/sends are for the `test.fac` sandbox only — never a
production destination without explicit operator direction.

## Verification

- Live proof: `pnpm exec tsx scripts/clwx71-mcp-handshake.ts` — SDK-client
  handshake, exact 9-tool inventory, and the no-confirm send refusal proven
  end-to-end through the MCP surface (2026-09-06: PASS against the running
  app; the no-confirm send came back `status:"refused"`, never sent).
- Unit guards: `tests/unit/clawx-mcp-server.test.ts` (tool table, log
  hygiene incl. never-stdout, env-only token fail-fast, dependency
  classification).

## WARNING — raw browser MCPs are dev/debug only

Generic browser MCP servers (`playwright-mcp --cdp-endpoint`,
`chrome-devtools-mcp --browserUrl`) can attach to the principal's Chrome at
`:18792` and satisfy the Conditional-Access constraint — but they are
**ungated click/type surfaces**: nothing stops a client from clicking Send
or Submit directly. They must never be principal-facing or wired into any
production agent. This adapter exists precisely so MCP clients inherit the
app's gates instead of bypassing them. Full analysis:
`docs/MCP_INTEGRATION_RESEARCH_2026-09-03.md`.

## Known limitations (2026-09-06)

- No Microsoft Forms Graph/REST API exists anywhere — form submission is
  only possible through the app's gated browser path (research verdict on
  the card).
- The confirmed-submit positive leg and live inbox reads require a healthy
  Chrome attach (`:18792`) and the sandbox session; the handshake harness
  records those legs honestly when the lane is down.
