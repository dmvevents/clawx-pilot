# ClawX (Ministry of Education fork) — agent alignment doc

**This file is read by Claude Code at the start of every session.** It is the single source of truth for: who the user is, what we're building, the operational rules that must be honoured, the current state, and how to pick up where we left off.

---

## What this is

ClawX is a desktop AI assistant. This fork is rebranded as **Ministry of Education** for primary-school principals across Trinidad & Tobago's seven education districts (Caroni, North Eastern, Port of Spain & Environs, South Eastern, St. George East, St. Patrick, Victoria). It runs as a native Electron app on the principal's Mac or Windows laptop with on-device LLM by default and managed cloud (Bedrock Sonnet 4.5 for VLM, Gemini 2.5 Pro/Flash for text) when a turn benefits.

**The user is the technical lead** for the MoE pilot. They make product decisions; you execute. Demo for principals is **2026-05-26 (tomorrow as of moe.10)**.

---

## Hard rules (never break these)

These are operational constraints learned the hard way. Each one has a real incident behind it.

| Rule | Why |
|---|---|
| **`profile=user` always for Chrome.** Never managed Chromium. | Conditional Access on `@moe.gov.tt` blocks managed sessions with `AADSTS53003`. Riding the principal's already-signed-in tab is the only path that works. |
| **Outlook `send_email` requires TWO gates.** `confirm:true` AND the open compose pane's subject must match `args.subject`. | Sending the wrong email from an MoE principal is real harm. The double gate has caught real mismatches. |
| **`download_attachment` same hard-confirm gate.** | Same concern, different surface. |
| **No body content / recipients / passwords in logs.** Subject truncated to 120 chars, recipient counts only. | The log files leave the laptop via tail-and-paste; this is the floor. |
| **No basic-auth, no token replay, no session hijack** for `*@moe.gov.tt` or `*@fac.edu.tt`. | Microsoft revokes session cookies in minutes via CAE; basic auth is disabled tenant-wide. The browser session is the only auth carrier. |
| **`outlook` in `PRINCIPAL_SKILL_ALLOWLIST` is the kill-switch.** | Single gate to disable email integration in production if it misbehaves. |
| **English-only locales.** Other locale jsons have been deleted. | This is a Trinidad-only product. Localised strings drift from English; principals confused if a label flips on them. |
| **Anonymise model identity in UI.** "Online" / "On this device" only. No raw model IDs in chat-facing surfaces. | Principals shouldn't think about model selection. This matters for trust ("why did the AI change?"). |
| **Hide cost in frontend, log in backend.** | Same trust concern. Principals don't need to see `$0.0023`. |
| **Auto-update OFF in PILOT_MODE.** `publish: null` in electron-builder.yml suppresses auto-update.yml generation. | Pilot laptops can't be auto-updated remotely. Each version goes through MoE IT. |
| **Test account passwords ARE allowed in repo/chat:** `test.fac@fac.edu.tt / Education@2000`. | User explicitly approved storage for this account only. NEVER for `*@moe.gov.tt` accounts. |
| **Don't push to upstream `ValueCell-ai/ClawX` without confirmation.** Push to `dmvevents/clawx-pilot` (SSH) is OK. | We're a fork. Don't pollute upstream. |
| **Don't run destructive git ops** without explicit confirmation. | force-push, reset --hard, branch -D — ask first. |

### Engineering invariants (regression classes)

These rules close systemic bug patterns we hit repeatedly during moe.4 → moe.10. Each is enforced by a `.claude/agents/*-auditor.md` sub-agent.

| Rule | Why | Auditor |
|---|---|---|
| **Four-store channel coherence is non-negotiable.** All of `~/.openclaw/openclaw.json` (defaults + agents.list[0]), `~/.openclaw/agents/*/agent/models.json`, `clawx-providers.json`, and `localStorage preferredChannel` must agree on the same provider/model pair. | When one drifts, the user sees silence on send. We hit this 3+ times before adding the auditor. | `config-coherence-auditor` |
| **No misclassified dependencies.** Any module imported synchronously by code under `electron/` or `extensions/` MUST be in `dependencies`, not `devDependencies`. electron-builder strips devDeps from the asar. | moe.9 shipped broken because `playwright-core` was in devDeps. The fix is a lockfile move; the auditor is the prevention. | `dependency-class-auditor` |
| **DOM selectors must have fallbacks for vendor-rotated UIs.** Every selector against Microsoft / Google / Apple surfaces must classify itself stable (role+aria) or rotated (CSS class, data-automation-id, aria-substring). Rotated selectors require 3+ fallback strategies. | MS Forms editor automation died in <a week because `data-automation-id` values rotated. We pivoted to the response page (more stable surface) and codified the rule. | `dom-selector-regression-tester` |
| **State writers must be atomic + idempotent.** Every function that writes to `~/.openclaw/*.json` or `clawx-providers.json` must (a) write via temp-file + `rename()` and (b) produce identical state when called twice. All writers delegate to the canonical writer (`channel-config.ts::writeOpenClawConfig`). No `chflags uchg` workarounds in production paths. | The `google-query-key` enum kept getting re-seeded because multiple writers raced. The `chflags uchg` band-aid was the smell that exposed the deeper invariant violation. | `state-idempotency-auditor` |

---

## Architecture (one diagram)

```
┌─ Electron main (Node)              ┌─ User's Chrome                ┌─ Cloud
│  host-API on :13210                 │  CDP on :18792                 │
│  ├─ /api/outlook/*                  │  authed Outlook tab           │  AWS Bedrock
│  ├─ /api/forms/*                    │  authed Forms tab             │  └─ Sonnet 4.5 (VLM grounding)
│  └─ auth-token gated                │                               │
│                                     │                               │  Google AI
└─ OpenClaw gateway (Node)           ─┘                               │  ├─ Gemini 2.5 Flash (default)
   WS on :18789                                                       │  └─ Gemini 2.5 Pro (Think mode)
   ├─ moe-principal-assistant plugin                                  │
   ├─ microsoft-graph plugin (stub)                                   │  Ollama (local)
   └─ runs LLM turns                                                  │  └─ qwen2.5:3b-instruct
```

**Three local processes, three local ports, one external Chrome.** No backend service. No telemetry pipeline yet (task #51).

---

## Capabilities map (status as of moe.10)

| # | Feature | Status |
|---|---|---|
| 1 | Email — read/draft/send via Outlook | **● Live**, e2e tested 2026-05-25 |
| 2 | Daily MoE forms — Suspensions + Daily Report | **◐ Form-clone in progress for demo**; Power Automate path ready when IT issues flow URL |
| 3 | Letters & reports — drafting | **◐ Built**, templates dir empty (next sprint) |
| 4 | Leave & attendance support | **◐ Built** (read), **○ Planned** (registers) |
| 5 | Routine-query response | **● Live in chat**, **● Live over email** |
| 6 | Meeting minutes & memos | **● Live transcription**, **◐ Built drafting** |
| 7 | Inventory & follow-up | **◐ Built** (taskflow + agentTurn cron) |
| 8 | Document processing | **● Live** (read), **◐ Built** (classify/extract/route/draft) |

Full detail: [`docs/PRODUCT_PRINCIPAL_ASSISTANT.md`](./docs/PRODUCT_PRINCIPAL_ASSISTANT.md).

---

## What works right now (2026-05-25, moe.10)

- Mac install: `/Applications/Ministry of Education.app` v0.4.3-moe.10, ad-hoc signed
- Gateway WS `127.0.0.1:18789`, host-API `127.0.0.1:13210`, both green
- Chrome on `127.0.0.1:18792` with `test.fac@fac.edu.tt` Outlook tab live
- 11 Outlook tools registered with the agent and verified end-to-end against the live session (today's smoke: open + read_inbox + draft + hard-confirm send all PASS)
- `gemini-2.5-pro` configured as default agent model in `~/.openclaw/openclaw.json` (was hitting 400s on Flash)
- `playwright-core` shipped as runtime dep (the moe.9 → moe.10 fix)

## What doesn't work yet

- **Demo blocker:** sample Suspensions form on test.fac doesn't exist yet. **Building today.**
- **Demo blocker:** form-fill driver and e2e test for form submission. **Building today.**
- **Composer-level model override** (chat picks Flash even though config says Pro) → tracked, not blocking demo
- **`templates/` directory** in `extensions/moe-principal-assistant/` is empty — letter/memo templates need authoring (post-demo)
- **Real MoE logo asset** still placeholder (task #60)
- **Power Automate flows** for the two real MoE forms — blocked on IT (Raj)
- **Entra app registration** for Microsoft Graph — blocked on IT (Raj)
- **Windows pilot install** — blocked on Cat-5 link to pilot site

---

## Demo plan for 2026-05-26

The principal sees three things, in this order:

1. **Email** — types into the chat composer "summarise my last 5 emails", agent does it. Then "draft a reply to [a specific email] saying I'll be at the parent meeting". Compose pane opens, principal reviews, hits Send (or asks the agent to "send it" — hard-confirm gate fires correctly).
2. **Document → form** — principal forwards or drops a suspension report. Agent extracts the 32 fields. Pre-fills our cloned Suspensions form on `test.fac`. Principal reviews on screen. Confirms. Form submits.
3. **Cron reminder** — at a scheduled time, the assistant fires a chat-prompt reminder ("3:45pm — submit today's daily report"). Principal can answer back inside the chat to either submit or defer.

Items 1 + 2 must work live tomorrow. Item 3 ships as a pre-recorded clip if cron timing doesn't line up.

---

## Repo layout (where things are)

```
electron/                                 — Electron main + IPC + services
  api/routes/                             — host-API on :13210 (outlook.ts, forms.ts, …)
  services/outlook-browser-v2/            — Playwright + VLM Outlook driver (LIVE)
  services/forms-browser-v2/              — same pattern for MS Forms (BUILDING)
  main/index.ts                           — boot, gateway start, plugin seed
  utils/                                  — atomic JSON, channel-config, logger
extensions/                               — gateway plugins
  moe-principal-assistant/                — persona, tools, templates, form-payload schemas
  microsoft-graph/                        — Graph stub (awaiting Entra packet)
resources/skills/                         — bundled skills (pdf, xlsx, docx, pptx, whisper, …)
resources/skills/bundles.json             — Principal's toolkit (recommended bundle)
.claude/agents/                           — project subagents (clawx-config-doctor, gateway-recovery, …)
docs/                                     — architecture, runbooks, product, snapshots
  PRODUCT_PRINCIPAL_ASSISTANT.md          — feature-by-feature product description
  AGENT_OUTLOOK.md                        — Outlook integration spec
  MSFORMS_AUTOMATION.md                   — three-tier forms strategy
  ui-snapshots/                           — UX designer hand-off
scripts/
  v2-chatbot-e2e.ts                       — LLM tool-pick + Outlook live smoke
  v2-eval.ts                              — 14-row Outlook acceptance suite
  v2-send-test.ts                         — live send + hard-confirm gate proof
  snapshot-ui.ts                          — Playwright-driven UI snapshot helper
  forms-clone-suspensions.ts              — clone the MoE Suspensions form on test.fac (BUILDING)
  forms-fill-suspensions.ts               — fill driver + e2e test (BUILDING)
release/                                  — signed/unsigned installers
```

---

## How to pick up the work

If you've just been started on this project:

1. **Read this file and `docs/PRODUCT_PRINCIPAL_ASSISTANT.md`.** They are kept current.
2. **Check the running app:** `pgrep -fl "Ministry of Education"` and `lsof -nP -iTCP -sTCP:LISTEN | grep -E "18789|13210"`. Both ports listening means the gateway is healthy.
3. **Check the live test inbox:** Chrome on `:18792` should be on `test.fac@fac.edu.tt`. If not, the user runs `scripts/v2-signin.ts` (manual login first time, persists).
4. **Run the live smoke** to know everything still works: `pnpm exec tsx scripts/v2-chatbot-e2e.ts`. Three turns, ALL PASS expected.
5. **Demo plan above.** Execute around it.
6. **Memory pointers** are in `~/.claude/projects/-Users-antonalexander-Github-moe-tt-ClawX/memory/`. Read `MEMORY.md` first.

---

## Conventions

- **Versions are `0.4.3-moe.N`.** Bump N on every shippable release.
- **Commits use Conventional Commits** with the area in parens: `fix(packaging): …`, `feat(outlook): …`, `ci(windows): …`, `docs: …`.
- **Branch model:** `main` is the working branch. Push to `pilot/main` (SSH remote `pilot`) for the dmvevents/clawx-pilot fork. Don't push to `origin` (ValueCell-ai upstream) without confirmation.
- **No emojis in code or commits.** User did not ask for them.
- **Be decisive.** If the user said "do it now", don't ask permission again.

---

*Last updated: 2026-05-25 by Claude Code session fca48444. Update this file when capabilities change, when a new hard rule is learned, or when the architecture shifts.*
