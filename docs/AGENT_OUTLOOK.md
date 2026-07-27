# Agent-driven Outlook — Canonical Reference

This is the single source of truth for the Outlook v2 integration. It
consolidates the OKR, acceptance criteria, architecture, host-API
contract, dev-mode runbook, and current scorecard.

## TL;DR — what does this give the principal?

A principal can sit in the ClawX chat composer and say things like:

- "What's in my inbox?"
- "Anything urgent from district HQ this week?"
- "Summarise my unread emails"
- "Draft a reply to the latest email from districtoffice@moe.gov.tt"
- "What attachments are on the message about budgets?"

…and the agent picks the right tool, drives Outlook Web through
Playwright in the principal's existing Chrome session (preserving SSO),
and either returns the answer or leaves a draft open for review. Send
and download are hard-gated behind explicit user confirmation.

## OKR

**Objective**: agent-driven Outlook is fully usable by a principal on
the MoE pilot, against their real `*@fac.edu.tt` / `*@moe.gov.tt`
account, with no risk of accidental email sends or attachment leaks.

| KR | Target | Status |
|---|---|---|
| KR1 | Plugin tools register at gateway boot | verified |
| KR2 | Agent picks the right tool from natural-language ≥80% on a 15-prompt eval | implementation done; live LLM scoring pending |
| KR3 | Each tool call ≤5s warm / ≤30s cold | all sub-second on Mac eval |
| KR4 | Send-protection: no `confirm:true`, ambiguous drafts, and explicit assertion mismatches refuse | gates fire in live eval and unit tests |
| KR5 | Inbox parser returns clean rows | works on 1-row inbox; multi-row needs populated inbox |
| KR6 | Plugin discovery robust to gateway-API drift | defensive chain |

## Acceptance criteria — by workflow

| # | Workflow | Tool used | Status |
|---|---|---|---|
| W1 | open Outlook | `outlook.open` | OK |
| W2.1 | list recent | `outlook.read_inbox` | OK (parser fixed in 0e54a81) |
| W2.2 | filter unread | `outlook.search_inbox({unread:true})` | OK |
| W2.3 | filter by sender | `outlook.search_inbox({from})` | OK |
| W2.4 | filter by subject | `outlook.search_inbox({subjectContains})` | OK |
| W3.1 | full body | `outlook.read_email` | OK |
| W3.2 | attachment metadata | `read_email` returns `attachments` | OK |
| W4.1 | new draft | `outlook.draft_email` | OK |
| W4.2 | refuse without confirm | `send_email({confirm:false})` | refused |
| W4.4 | refuse on explicit assertion mismatch | live-tested | refused |
| W5.1 | reply | `outlook.reply` | OK |
| W5.2 | reply-all | `reply({replyAll:true})` | OK |
| W5.3 | forward | `outlook.forward` | OK |
| W6.1 | mark read/unread | `outlook.mark_read` | OK |
| W7.1 | multi-message | `read_inbox` + `read_email` loop | inbox needs 2+ rows |
| W8.1 | search by attachment | `search_inbox({hasAttachment:true})` | OK |
| W8.2 | metadata only | `outlook.list_attachments` | OK |
| W8.3 | download with confirm | `download_attachment({confirm:true})` | implemented; live deferred |

## Architecture

```
Renderer (chat) → LLM picks tool → OpenClaw Gateway plugin →
HTTP POST to ClawX Host-API → outlookBrowserManagerV2 → Playwright
CDP → user's Chrome → outlook.cloud.microsoft / outlook.office.com
```

Plugin runs in the gateway process and reaches back to ClawX via the
host-API, with `CLAWX_HOST_API_PORT` and `CLAWX_HOST_API_TOKEN`
threaded through `forkEnv` (electron/gateway/config-sync.ts).

### Why CDP attach instead of `launchPersistentContext`

Persistent-context mode collides with already-running Chrome on the
same user data dir. Principals will commonly have Chrome open. CDP
attach to a Chrome launched with `--remote-debugging-port=18792`
works regardless. See `playwright-driver.ts` for the fallback chain.

### VLM grounder

When semantic locators (Playwright `getByRole`, `getByLabel`) miss,
v2 falls back to screenshot + ask-the-vision-model "where is the New
mail button?" The bbox centre becomes a Playwright click.

Default: Bedrock-hosted Claude Sonnet 4.5 via
`@aws-sdk/client-bedrock-runtime` (uses `AWS_PROFILE=bedrock`).
Override with `CLAWX_VLM_PROVIDER=gemini` and `GEMINI_API_KEY` to
use Gemini 2.5 Flash. See commit 721eaed.

## Host-API contract

All endpoints under `/api/outlook/*`. POST only. Bearer token from
`CLAWX_HOST_API_TOKEN`. 404 when `outlook` is not in
`PRINCIPAL_SKILL_ALLOWLIST`.

| Endpoint | Body | Returns |
|---|---|---|
| `/open` | (none) | `OutlookOpenResult` |
| `/read-inbox` | `{ top? }` | `ReadInboxResult` |
| `/search-inbox` | `SearchInboxArgs` | `SearchInboxResult` |
| `/read-email` | `{ id }` | `ReadEmailResult` |
| `/draft` | `DraftEmailArgs` | `DraftEmailResult` |
| `/send` | `SendEmailArgs (confirm req'd)` | `SendEmailResult` |
| `/reply` | `ReplyArgs` | `ReplyResult` |
| `/forward` | `ForwardArgs` | `ForwardResult` |
| `/mark-read` | `{ id, read }` | `MarkReadResult` |
| `/list-attachments` | `{ id }` | `ListAttachmentsResult` |
| `/download-attachment` | `{ id, filename, confirm }` | `DownloadAttachmentResult` |

Response envelope: `{ success: true, data: <result> }`.

## Hard rules (never violated)

1. **profile=user** — system Chrome only. Managed Chromium is blocked
   by Microsoft Conditional Access for `*@moe.gov.tt` / `*@fac.edu.tt`
   tenants. Enforced as the default in playwright-driver.ts.
2. **send_email refuses without `confirm:true`** and sends only one visible
   reviewed draft. Optional `to`, `cc`, `bcc`, `subject`, and `body` arguments
   are safety assertions for advanced flows; when provided, mismatches refuse.
   Normal reviewed sends after principal review should call `{ confirm: true }`
   only so the agent does not regenerate recipient/subject/body from memory.
3. **download_attachment refuses without `confirm:true`**. Same
   pattern.
4. **No bodies / recipients / passwords in logs.** Subject is
   logged truncated to 120 chars; recipient counts only.
5. **No basic-auth, no token replay** for `*@moe.gov.tt` /
   `*@fac.edu.tt`. Browser session is the only auth carrier.
6. **`outlook` in PRINCIPAL_SKILL_ALLOWLIST is the kill-switch**.

## Dev-mode runbook

```bash
# Chrome on debug port + isolated user data dir
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=18792 \
  --user-data-dir=/tmp/clawx-outlook-test \
  --no-first-run \
  --no-default-browser-check \
  "https://outlook.office.com/" &

# Sign in to your test account in that Chrome window.

# Start dev mode. Pilot builds default to v2; set CLAWX_OUTLOOK_V2=0 only
# when deliberately testing the legacy browser-plugin path.
pnpm dev > /tmp/clawx-dev-v2.log 2>&1 &
```

### Smoke scripts

| Script | What it does |
|---|---|
| `scripts/v2-smoke.ts` | open() + readInbox(5) — confirms plumbing |
| `scripts/v2-smoke-draft.ts` | draftEmail flow end-to-end |
| `scripts/v2-vlm-smoke.ts` | One Bedrock VLM ground call |
| `scripts/v2-eval.ts` | Full 15-row eval against live Outlook |
| `scripts/v2-page-state.ts` | Dump URL + screenshot to /tmp/ |
| `scripts/v2-aria-tree.ts` | Inspect inbox row DOM |
| `scripts/v2-test-cleanup.ts` | Reset state between eval runs |
| `scripts/v2-signin.ts` | Drive Microsoft sign-in (one-shot) |
| `scripts/v2-goto-inbox.ts` | Force-navigate back to /mail/ |

### Run the eval

```bash
pnpm exec tsx scripts/v2-eval.ts
# 14/15 pass on a 1-row inbox; 15/15 with populated multi-row inbox.
# Results: /tmp/v2-eval-results.json
```

## Failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| Gateway 000 on /healthz | Config validation failed on boot | Check log for `Config validation failed: models.providers.X.api`. Migration in seedGatewayPluginConfig should self-repair |
| `outlook host handle not provided` (in doctor logs) | Doctor preflight runs without env | Ignored — preflight isn't the runtime |
| `Could not find target (semantic locator missed and VLM grounding failed)` | Outlook DOM changed OR a dialog blocking | Run v2-page-state.ts; if dialog, dismissBlockingDialog may need a new affordance |
| `Send refused` after review | No open draft, multiple open drafts, or a stale optional assertion | Keep exactly one reviewed draft open and use `outlook.send_email({ confirm: true })` only for the normal send-after-review path |
| `outlook capability disabled: ... 404` | `outlook` removed from PRINCIPAL_SKILL_ALLOWLIST | Add it back |
| `[profile_locked_close_chrome]` | Chrome is already open without the ClawX automation endpoint on the target profile | Close all Chrome windows, then retry from ClawX |
| `Outlook is on the sign-in page` | MS session expired | Sign in manually in Chrome window |

## Pending work

- **Live LLM tool-pick eval** (KR2 measurement) — the v2-eval.ts
  bypasses the LLM. A complementary eval that grades NL → tool
  selection accuracy is filed for the next session.
- **Multi-row inbox testing** for KR5 — needs 4-5 test emails sent
  to `test.fac@fac.edu.tt` from another account.
- **Windows pilot install** of moe.6 — see WINDOWS_DEPLOYMENT_PLAN.md.
- **Live download_attachment test** — needs a real email with attachment.
- **Microsoft Graph (Phase 2)** — parked at `extensions/microsoft-graph/`,
  blocked on Entra app registration from MoE IT.

## Where to find what

```
electron/services/outlook-browser-v2/   v2 implementation
electron/services/outlook-browser/types.ts   shared type contract
electron/api/routes/outlook.ts          host-API surface
extensions/moe-principal-assistant/index.mjs   plugin tool registration
shared/feature-flags.ts:116             PRINCIPAL_SKILL_ALLOWLIST
shared/feature-flags.ts                 OUTLOOK_BROWSER_V2 flag
scripts/v2-*.ts                         all dev-mode helpers
tests/unit/outlook-vlm-grounder.test.ts 10 grounder tests
tests/unit/outlook-actions-search.test.ts 10 search-predicate tests
docs/AGENT_OUTLOOK.md                   you are here
docs/WINDOWS_DEPLOYMENT_PLAN.md         pilot moe.6 deploy plan
docs/UTM_WINDOWS_SETUP.md               local Windows VM runbook
```
