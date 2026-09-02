# App workflows & test matrix — the full toolset, and how we prove it on the laptop

*2026-09-02. The complete enumeration of every function the Ministry app exposes,
grouped into principal-facing workflows, with a per-workflow test status for Mac
(dev) and the Windows pilot laptop. Companion to `docs/GRAPH_TEST_PLAN.md` (the
Outlook/Graph slice) and `docs/PRODUCT_PRINCIPAL_ASSISTANT.md` (feature status).*

Goal (owner, 2026-09-02): **get the full toolset — Outlook, Word, Excel, PDF,
Forms, voice, taskflow — running and TESTED on the principal's laptop.** This doc
is the checklist that proves it.

---

## 1. The complete surface (what the app can do)

Two layers expose functionality:

- **Agent tools** — 31 tools the on-device/cloud LLM can call directly in chat.
- **Host-API routes** (`127.0.0.1:13210`) — the HTTP surface the session calls
  "the Outlook MCP"; the agent tools for Outlook/Forms are thin wrappers over these.
- **Skills** — bundled document/utility packs (the legacy Python doc skills are
  now superseded by native `document.*` tools; kept for fallback).

### 1a. Agent tools (31), by category

| Category | Tools | Count |
|---|---|---|
| **Outlook (email)** | open, read_inbox, draft_email, send_email*, search_inbox, read_email, reply, forward, mark_read, list_attachments, download_attachment* | 11 |
| **Forms (MoE)** | list, preview_suspension, preview_daily_report, submit_suspension*, submit_daily_report* | 5 |
| **Documents** | read_pdf, read_docx, write_docx, read_xlsx, write_xlsx, read_image | 6 |
| **Principal/taskflow** | draft_letter, draft_memo, summarise_circular, daily_report_payload, daily_report_form_payload, suspension_payload, find_school | 7 |
| **Browser/misc** | browser.diagnose, browser.repair_chrome_cdp | 2 |

`*` = hard-confirm gate (send/submit/download). **+6 parked Graph tools**
(`outlook.profile/list_messages/get_message/draft_reply/send_mail/list_events`)
register only when `tenantId`+`clientId` land — see §5.

### 1b. Host-API routes that matter for principal workflows

- **Outlook**: `/api/outlook/{open,read-inbox,draft,send†,search-inbox,read-email,reply,forward,mark-read,list-attachments,download-attachment†}` — all gated by `PRINCIPAL_SKILL_ALLOWLIST` (404 when `outlook` not allow-listed = the kill-switch).
- **Forms**: `/api/forms/{list,preview-daily-report,submit-daily-report†,preview-suspension,submit-suspension†}` — same allowlist gate.
- Supporting: `/api/diagnostics/gateway-snapshot` (health), `/api/files/stage-*` (attach), `/api/settings/degradeChannel` (cloud→on-device failover), `/api/cron/*` (the daily-report reminder).

`†` = confirm-gated + audited to the outbox service.

### 1c. Skills → document capability map

| Skill | Capability | Native replacement |
|---|---|---|
| `docx` | Word read/write | `document.read_docx` / `write_docx` |
| `xlsx` | Excel read/write | `document.read_xlsx` / `write_xlsx` |
| `pptx` | PowerPoint read/manip | none yet (skill only) |
| `pdf`, `nano-pdf` | PDF extract | `document.read_pdf` |
| `openai-whisper` | Voice → text | none (skill only) |
| `summarize`, `taskflow`, `taskflow-inbox-triage` | summarise / reminders / triage | — |
| `tavily-search`, `weather`, `goplaces`, `blogwatcher` | web/info lookups | — |
| `find-skills`, `skill-creator`, `self-improving-agent` | meta | — |

---

## 2. Principal-facing workflows (composed end-to-end)

These are the flows a principal actually runs — each chains several tools:

| # | Workflow | Tool chain | Demo item |
|---|---|---|---|
| W1 | **Summarise recent email** | outlook.open → read_inbox → summarise | Demo 1 |
| W2 | **Draft & send a reply** | read_email → reply/draft_email → send_email (2-gate) | Demo 1 |
| W3 | **Document → form prefill → submit** | download_attachment → read_pdf/docx → suspension_payload → forms.preview_suspension → submit_suspension (gate) | Demo 2 |
| W4 | **Daily report** | daily_report_form_payload → forms.preview_daily_report → submit_daily_report (gate) | Demo 2 |
| W5 | **Daily-report cron reminder** | cron job → chat prompt → W4 | Demo 3 |
| W6 | **Draft letter / memo** | draft_letter / draft_memo → write_docx | product |
| W7 | **Read a spreadsheet / build one** | read_xlsx / write_xlsx | product |
| W8 | **Transcribe a voice note / meeting** | openai-whisper → summarise → draft_memo | product |
| W9 | **Routine query (chat & over email)** | on-device or cloud LLM turn | product |
| W10 | **Cloud→on-device failover** | degradeChannel when provider unreachable | resilience |

---

## 3. Test matrix (Mac dev vs pilot laptop)

Status legend: ● proven · ◐ built, partial proof · ○ untested on that platform.

| WF | Mac (dev) | Laptop (Windows VM) | Test command / evidence |
|---|---|---|---|
| W1 | ● live smoke | ● 15/15 eval on VM | `pnpm exec tsx scripts/v2-chatbot-e2e.ts`; VM `pilot-managed-cdp-visual-smoke.ps1` |
| W2 | ● 2-gate proven | ● 4-step send-gate proof on VM (new outlook.cloud domain) | `scripts/v2-send-test.ts` + `outlook-actions-safety.test.ts` (73/73) |
| W3 | ◐ forms lane live (29/32+gate) | ● 29/32 fields, submit gate refuses w/o confirm | `scripts/forms-fill-suspensions.ts`; VM `pilot-forms-cdp-inspect.js` |
| W4 | ● payload+preview | ● preview verified on VM | forms vitest; `/api/forms/preview-daily-report` |
| W5 | ● cron fires | ○ no live cron-fire captured on Windows | `/api/cron/trigger` — **gap D** |
| W6 | ● write+read round-trip (fn-level, `docx`+`mammoth`) | ● **write GREEN on VM** — packaged runtime wrote valid .docx (8582 B) + read back | VM `pilot-office-write-smoke.ps1` `STATE: OFFICE_WRITE_OK` 2026-09-02; Mac `/tmp/docwrite-roundtrip.mjs` 8/8. b2 (in-app turn) open |
| W7 | ● write+read round-trip (fn-level, `xlsx`/SheetJS) | ● **read + write GREEN on VM** — wrote valid .xlsx (16077 B) + read back | same VM smoke `OFFICE_WRITE_OK`; read GREEN (KR1). b2 (in-app turn) open |
| W8 | ◐ whisper skill | ○ `WinSpeechRecognize.exe` bundled, no ASR smoke | **gap C** — no `pilot-asr-smoke.ps1` yet |
| W9 | ● on-device + cloud | ● online (`moe-demo-pro`) + on-device (`qwen2.5:3b`) present on VM | live eval 15/15 |
| W10 | ● degrade path | ○ untested on Windows | degradeChannel unit test |

---

## 4. Laptop deployment state & gaps

**Where evidence stands:** all Windows evidence is from the **GCP Windows VM**
`clawx-win-rc-20260609` (over IAP), **not the physical pilot laptop**. moe.12,
moe.14 **and now moe.15 (GA candidate)** are installed+validated on the VM:
moe.15 installed 2026-09-02 (silent `/S`, tree complete, FileVersion
`0.4.3-moe.15`), gateway boot `RESULT=COMPLETE` on 18789, office write
`OFFICE_WRITE_OK`. The only unproven moe.15 legs are GUI-session-dependent
(managed-CDP visual smoke, b2 in-app write turn) — owner's assisted-GUI path.

**GREEN on the VM** (real evidence): Outlook email (read/draft/reply/forward/send
with the 2-gate), Forms (fill + submit-gate), document **reading** (Word/Excel/PDF
via KR1 tool-select + KFM path resolution), Gateway/Host-API (ports 18789/13210,
50–51s ready on moe.14), Chrome CDP attach to the signed-in profile.

**YELLOW** (built, thin Windows proof): document **writing** (`write_docx`/
`write_xlsx`/pptx). Update 2026-09-02: the write path is now **proven at the
function level on Mac** — `writeDocx`/`writeXlsx` (the exact functions the tools
call) produce valid OpenXML and `readDocx`/`readXlsx` round-trip the content
(8/8 PASS, `/tmp/docwrite-roundtrip.mjs`). Same native JS runs on Windows and
the deps already `require.resolve` in the packaged Windows node
(`pilot-office-runtime-check.ps1`), so the only unproven piece is the packaged
runtime *executing* a write on Windows. `pilot-office-write-smoke.ps1` (new)
closes that in one command; blocked only because the GCP VM
`clawx-win-rc-20260609` is currently **TERMINATED** (start it to run). ASR/voice
(`WinSpeechRecognize.exe` bundled, no end-to-end smoke); taskflow/cron (no live
fire captured on Windows).

**RED/untested on Windows:** moe.15 install+smoke; KR2 fresh-install recording;
external-tester validation. Silent `/S` install is diagnostic-only (partial-tree
failures) — the supported path is the assisted GUI install.

### Gap-closing checklist (to declare the FULL toolset laptop-verified)

- [x] **A — Install & smoke moe.15 on Windows.** DONE 2026-09-02 on VM
  `clawx-win-rc-20260609` (over IAP, silent `/S` — no desktop session available
  for the assisted GUI path; `quser` empty). Uploaded `…-moe.15-win-x64.exe`
  (SHA256 verified on the VM `d10de580…18df`), installed (exe FileVersion
  `0.4.3-moe.15`, tree complete, docx/xlsx/mammoth/playwright-core all present),
  and ran `pilot-run-installed-gateway-smoke.ps1` → `RESULT=COMPLETE`,
  `GATEWAY_READY=True` on 18789 (playwright-core regression class clean). The
  GUI-dependent legs (`pilot-managed-cdp-visual-smoke.ps1`, b2) still need an
  interactive session — that is the owner's assisted-GUI validation. Evidence:
  `skills/laptop/evidence/2026-09-02-moe15-install-verify/RESULT.md`.
- [x] **B (b1) — Document WRITING in the packaged Windows runtime.** DONE
  2026-09-02: `pilot-office-write-smoke.ps1` on VM `clawx-win-rc-20260609`
  returned `STATE: OFFICE_WRITE_OK` — wrote valid .docx (8582 B) + .xlsx
  (16077 B) to `media/outbound` and read both back. Evidence:
  `skills/laptop/evidence/2026-09-02-office-write-smoke/RESULT.md`. Mac
  fn-level round-trip 8/8 (`/tmp/docwrite-roundtrip.mjs`) same day.
- [ ] **B (b2) — Live in-app write turn on Windows.** One chat turn ("rewrite
  X.docx → Y.docx", "build a workbook from Z") asserting
  `document.write_docx`/`write_xlsx` fired in the gateway log (needs the app +
  a model turn, not just the runtime). (W6, W7)
- [ ] **C — ASR/voice smoke.** Confirm `WinSpeechRecognize.exe` present + Azure
  Speech seed (or documented fallback); mic→WAV→transcribe→JSON. **Create
  `pilot-asr-smoke.ps1`** (none exists). (W8)
- [ ] **D — Taskflow/cron live fire on Windows.** Trigger one cron fire; capture
  the chat-prompt reminder in logs. (W5)
- [ ] **E — KR2 fresh-install recording** from clean state (download→install→first
  green turn), ~5–10 min screen capture.
- [ ] **F — External-tester run** of moe.15 with no help; collect report.

Scripts present: `pilot-run-installed-gateway-smoke.ps1`,
`pilot-managed-cdp-visual-smoke.ps1`, `pilot-forms-cdp-inspect.js`,
`pilot-office-runtime-check.ps1` (dep-import only), **`pilot-office-write-smoke.ps1`
(new 2026-09-02 — actually writes + reads back .docx/.xlsx in the packaged
runtime)**. **Missing: `pilot-asr-smoke.ps1`.**

---

## 5. The one external dependency: Outlook via Graph

W1–W3 today run through the **browser lane** (Playwright + the signed-in Chrome
tab). That works but is Chrome-dependent and ~103s/turn. The **Graph path** (the
6 parked tools) makes email work on a Chrome-less laptop and fast.

**UPDATE 2026-09-02 — the external dependency is CLEARED and the OAuth path is
PROVEN.** The Ministry delivered the **Application (client) ID** and registered
the dev **redirect URI** `http://localhost:53682/callback` with read-only admin
consent (profile + inbox read + offline_access) on the existing Entra app (tenant
`9590bb09-…ebfe`). `scripts/graph-signin-smoke.ts` ran the ladder's **L1–L3 PASS
live** against the real tenant with sandbox `test.fac@fac.edu.tt`: token via pure
PKCE (no client secret), stable `oid` (KR7 UserId key), `/me` + inbox read (5
msgs). Evidence: `skills/laptop/evidence/2026-09-02-graph-signin-L1-L3/`. The
remaining Graph work is **ours, not the Ministry's**: wire the in-app
`CLAWX_GRAPH_AUTH` flow + host `getAccessToken`/token persistence so the 6 parked
tools become callable in-chat (`microsoft-graph.enabled` stays false until then —
`register()` crashes boot without host wiring). Full ladder + rungs L4–L7 in
`docs/GRAPH_TEST_PLAN.md`. Until the in-app path lands, the demo still runs the
browser lane (works, just slower and Chrome-bound).
