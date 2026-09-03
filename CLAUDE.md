# ClawX (Ministry of Education fork) — agent alignment doc

**This file is read by Claude Code at the start of every session.** It is the single source of truth for: who the user is, what we're building, the operational rules that must be honoured, the current state, and how to pick up where we left off.

---

## Current finish-sprint packet - 2026-09-03 (START HERE)

This block supersedes the 2026-05-29 and 2026-06-09 packets below (kept for history). For any GA, sprint, board, or capability work, start with:

1. `docs/GA_FINISH_SPRINT_2026-09-03.md` — epic purpose, story map, objectives × coverage × deficit matrix, sequenced finish backlog
2. `docs/PERSONA_STATE_VECTOR_2026-09-03.md` — persona thought map + stakeholder feedback ledger (Raj, Karunesh, owner)
3. `docs/GA_SPRINT_STATE_VECTOR.md` — per-card truth table + pre/in/post-flight checks
4. `docs/plane-board/CLWX-board.md` — board mirror (68 cards; agent ceiling is **Ready**, a human closes Done)
5. `.claude/skills/ga-sprint-driver/SKILL.md` — the tick loop (sense → analyze → act → sync → report)
6. **`pnpm ga:gate`** — THE acceptance test (CLWX-90): every criterion, one command, scorecard mapped to the GO/NO-GO boxes; report lands in `docs/evidence/`
7. Problem history: `docs/BLOCKER_BUG_COLLECTION_2026-09-03.md` (144 mined findings, all sources) · `docs/KARUNESH_ERROR_LEDGER.md` (external tester K1–K14) · `docs/DEFECT_REGISTER_2026-09-02.md` (register + deltas) — mine new sources with `.claude/skills/session-log-miner`

**Definition of done for the core use cases (the epic's objectives):**

- **Email** — read/draft/reply/send ● proven live with the two-gate send (15/15 eval, 4-step gate proof); forward + attachment eval rows = CLWX-61; stale-read guard = CLWX-46.
- **Forms** — fill + gate + submit + verify-landed ● proven and RECORDED on the Suspensions test.fac clone; Daily Report e2e = CLWX-62; document→form extraction chain = CLWX-63; drift detector = CLWX-64.
- **Documents** — read ● (KR1 in-app PASS); live in-app write turn = CLWX-65; classify/route + minutes template = CLWX-66.
- **Reminders** — cron → visible chat prompt e2e = CLWX-67.

Review personas: `moe-product-manager` (acceptance/scope) and `principal-proxy` (trust lens) in `.claude/agents/`; the full persona map is in the persona doc.

## Current resume packet - 2026-05-29 (HISTORICAL)

This section supersedes older "as of 2026-05-25/26" status below. Keep this block short so Claude Code starts with current direction, then load details from skills/docs on demand.

## Current GA release packet - 2026-06-09

For GA, release-candidate, Windows installer, Outlook/Forms, model Gateway, or cross-agent handoff work, start with:

1. `docs/AGENT_SKILL_INTEROPERABILITY.md`
2. `docs/GA_RELEASE_PLAN_2026-06-09.md`
3. `.claude/skills/ga-release-readiness/SKILL.md`
4. `.claude/skills/ga-e2e-regression/SKILL.md`
5. `.claude/skills/windows-vm-smoke/SKILL.md`
6. `.claude/agents/ga-e2e-regression-verifier.md`
7. `.claude/agents/ga-release-conductor.md`
8. `docs/PRODUCTION_CHECKLIST.md`

The repo now mirrors critical workflows across official Codex surfaces (`.agents/skills`, `.codex/agents`) and Claude Code surfaces (`.claude/skills`, `.claude/agents`). Keep those surfaces behaviorally aligned when a release-critical process changes.

Start a new Claude Code session with:

```text
/project:windows-demo-resume
```

If slash commands are unavailable, read:

1. `docs/NEXT_AGENT_WINDOWS_DEMO_HANDOFF_2026-05-29.md`
2. `docs/CLAUDE_CODE_RESUME_AND_TEAMS_GUIDE_2026-05-29.md`
3. `.claude/skills/windows-demo-resume/SKILL.md`
4. `.claude/skills/windows-runtime-recovery/SKILL.md`
5. `windows-pilot/README.md`

Current critical path:

- Keep the Windows demo on a cloud model, preferably `google/gemini-2.5-pro`, unless the user explicitly changes provider.
- Diagnose "thinking", Gateway down, model call failed, or Excel prompt stalls as provider/Gateway/runtime-coherence first, not UI first.
- Outlook and Forms must use the signed-in user Chrome session over CDP. Never use managed Chromium for Microsoft tenant flows.
- Use read-only probes first: `git status --short`, `pilot-probe-state.ps1`, `pilot-verify-outlook-tab.ps1`, and targeted Vitest files.
- Do not send email, download attachments, submit Forms, print secrets, or mutate Windows state until the exact action is confirmed or the task explicitly authorizes it.

Claude-native resume surfaces now exist:

- `.claude/commands/windows-demo-resume.md`
- `.claude/skills/windows-demo-resume/SKILL.md`
- `.claude/skills/windows-runtime-recovery/SKILL.md`
- `.claude/skills/pilot-ssh-ops/SKILL.md`
- `.claude/skills/windows-build-package/SKILL.md`
- `.claude/skills/windows-outlook-forms/SKILL.md`
- `.claude/skills/ga-e2e-regression/SKILL.md`
- `.claude/skills/windows-vm-smoke/SKILL.md`
- `.claude/skills/claude-bedrock-windows/SKILL.md`
- `.claude/skills/windows-github-dev/SKILL.md`

Use Claude subagents or Agent Teams only after passing each worker an explicit context packet. They do not inherit this chat. For durable OMX/OMC teams, verify `omx doctor`, `tmux -V`, and `$TMUX` first; otherwise use Claude Code subagents/Agent Teams.

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
| **Test account credentials are local-only:** `test.fac@fac.edu.tt` may be used for demo automation, but its password must come from local operator context such as `PILOT_TEST_PASSWORD`; never print or commit the plaintext password. NEVER for `*@moe.gov.tt` accounts. |
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

## Capabilities map (status as of moe.15, refreshed 2026-09-03)

| # | Feature | Status |
|---|---|---|
| 1 | Email — read/draft/reply/send via Outlook | **● Live** — re-proven on `outlook.cloud.microsoft` (15/15 eval, 4-step two-gate send proof, 73/73 contract units); forward/attachment eval rows open (CLWX-61); stale-read guard pending (CLWX-46); Graph read-only transport landed behind flag (CLWX-39) |
| 2 | Daily MoE forms — Suspensions + Daily Report | **● Live-proven + RECORDED** on the test.fac Suspensions clone (29/32 fill, gate refusal, ONE confirmed submit verified landed, video+trace); Daily Report e2e open (CLWX-62); extraction chain (CLWX-63); production destination Ministry-gated (CLWX-7) |
| 3 | Letters & reports — drafting | **◐ Built** — letter/memo/daily-report templates authored; runtime write proven (Windows `OFFICE_WRITE_OK`, Mac fn 8/8); live in-app write turn open (CLWX-65) |
| 4 | Leave & attendance support | **◐ Built** (read), **○ Planned** (registers — post-GA, CLWX-68) |
| 5 | Routine-query response | **● Live in chat** (NSCC eval 18/20 on Raj's own questions), **● Live over email** |
| 6 | Meeting minutes & memos | **● Live transcription (Mac, real whisper ×2)**; Windows ASR = gap C (V-batch); drafting untemplated (CLWX-66) |
| 7 | Inventory & follow-up | **◐ Built** (taskflow + agentTurn cron); reminder e2e open (CLWX-67); Windows cron live-fire = gap D |
| 8 | Document processing | **● Live** (read — KR1 in-app PASS on moe.12 incl. OneDrive-KFM resolve), **◐ Built** (classify/extract/route/draft — CLWX-63/65/66) |

Full detail: [`docs/PRODUCT_PRINCIPAL_ASSISTANT.md`](./docs/PRODUCT_PRINCIPAL_ASSISTANT.md); current coverage matrix: `docs/GA_FINISH_SPRINT_2026-09-03.md` §3.

---

## What works right now (HISTORICAL — 2026-05-25, moe.10; current truth is `docs/GA_FINISH_SPRINT_2026-09-03.md` §3)

- Mac install: `/Applications/Ministry of Education.app` v0.4.3-moe.10, ad-hoc signed
- Gateway WS `127.0.0.1:18789`, host-API `127.0.0.1:13210`, both green
- Chrome on `127.0.0.1:18792` with `test.fac@fac.edu.tt` Outlook tab live
- 11 Outlook tools registered with the agent and verified end-to-end against the live session (today's smoke: open + read_inbox + draft + hard-confirm send all PASS)
- `gemini-2.5-pro` configured as default agent model in `~/.openclaw/openclaw.json` (was hitting 400s on Flash)
- `playwright-core` shipped as runtime dep (the moe.9 → moe.10 fix)

## What doesn't work yet (HISTORICAL — both demo blockers below were resolved; see the finish-sprint packet at the top)

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

1. **Read this file** and these three doc trees (in priority order):
   - `docs/PRODUCT_PRINCIPAL_ASSISTANT.md` (what we're building, feature status)
   - `docs/WINDOWS_INSTALL_RUNBOOK.md` (how to install/verify on the pilot)
   - `docs/WINDOWS_PROBLEMS_ATLAS.md` (every Windows bug we already solved — DO NOT re-debug)
2. **Check Mac dev state:** `pgrep -fl "Ministry of Education"` + `lsof -nP -iTCP -sTCP:LISTEN | grep -E "18789|13210"`. Both ports listening = gateway healthy.
3. **Check pilot Windows state:** `ssh pilot 'powershell -NoProfile -c "Get-Process | Where-Object { $_.ProcessName -match \"Ministry|Education\" } | Select Id"'` (uses the SSH multiplexer config in `~/.ssh/config`; first call ~0.3s, subsequent calls ~50ms).
4. **Check the live test inbox:** Chrome on `:18792` should be on `test.fac@fac.edu.tt`. If not: set `PILOT_TEST_PASSWORD` from the local demo credential and run `pnpm exec tsx scripts/forms-relogin-helper.ts` (test account only; never for `*@moe.gov.tt`).
5. **Run the live smoke:** `pnpm exec tsx scripts/v2-chatbot-e2e.ts`. Three turns, ALL PASS expected.
6. **Memory pointers** are in `~/.claude/projects/-Users-antonalexander-Github-moe-tt-ClawX/memory/`. Read `MEMORY.md` first.

---

## Move fast in this codebase

**SSH multiplexer for pilot Windows:** the Cat-5 link is link-local (`169.254.46.90`) and high-latency. `~/.ssh/config` has a `Host pilot` block with `ControlMaster auto` + `ControlPersist 30m`. First connect ~0.3s, subsequent calls ~50ms. Use `ssh pilot '<command>'` instead of `ssh vyonix@169.254.46.90`.

**Sub-agent parallelism:** when a task has 3+ independent threads (e.g. "extract Daily Report schema" + "build runtime client" + "audit regression-class"), spawn them as parallel `Agent` calls in a single message. Each runs in its own context window. See the four-agent regression investigation in this session's history for the pattern. **Never** ask a sub-agent to "search the conversation" — they start with empty context. Pass them the actual text or a path.

**Sub-agent coverage we already have:**
- `clawx-config-doctor` — channel/model coherence repair (read-write)
- `config-coherence-auditor` — early-warning when 4 stores drift (read-only)
- `dependency-class-auditor` — catch playwright-core-style devDep mistakes
- `dom-selector-regression-tester` — flag rotated selectors without fallbacks
- `state-idempotency-auditor` — catch chflags-band-aid-class bugs
- `gateway-recovery` — boot crash-loop repair
- `production-readiness` — pre-release audit
- `ga-e2e-regression-verifier` — known-failure regression matrix and evidence
- `skill-audit` — skill-bundle drift detector
- `windows-smoke` — Windows post-install smoke runner

**Instead of re-debugging, look in `docs/WINDOWS_PROBLEMS_ATLAS.md`.** Every Windows-specific bug from moe.1→moe.10 is catalogued with symptom → root cause → fix → commit → detection-agent. Twelve §-entries cover ~90% of the install/runtime issues we've ever seen.

**For commands on the pilot, ALWAYS use single quotes around the powershell -c argument.** Bash + zsh expand `$env:` and `$_.` differently from each other; double-quoting causes the shell to eat them. `ssh pilot 'powershell -c "Get-Process | Select Name"'` is the safe form.

**Don't manually delete user state.** `~/.openclaw/` and `%APPDATA%\Ministry of Education\` are sacred — they hold sessions, openclaw.json, agent state. Always backup before reinstall (`docs/WINDOWS_INSTALL_RUNBOOK.md` step 3 has the one-liner). The NSIS uninstaller is designed to keep these.

**Test changes locally before pushing builds.** `pnpm typecheck` + `pnpm exec tsx scripts/v2-chatbot-e2e.ts` together catch ~80% of regressions in <30s. Run them before `package:mac:local` (~6 min build cycle).

---

## Commands cheat-sheet

Package manager is **pnpm** (locked to `pnpm@10.33.4` via `packageManager` field). Use `pnpm exec` to invoke binaries from `node_modules/.bin`.

| Task | Command |
|---|---|
| Install | `pnpm install` (postinstall patches browser hint) |
| First-time bootstrap | `pnpm run init` (install + download bundled `uv`) |
| Dev (Vite + Electron) | `pnpm dev` |
| Typecheck | `pnpm typecheck` (`tsc --noEmit`) |
| Lint (autofix) | `pnpm lint` |
| Lint (CI / no fix) | `pnpm lint:check` |
| Unit tests (all) | `pnpm test` (vitest run) |
| Single unit test | `pnpm exec vitest run <path/to/file.test.ts>` (add `-t "<name pattern>"` to filter) |
| Playwright e2e (all) | `pnpm test:e2e` (headed: `pnpm test:e2e:headed`) |
| Single e2e test | `pnpm exec playwright test <path/to/spec.ts>` (add `-g "<title>"` to filter) |
| Live Outlook smoke | `pnpm exec tsx scripts/v2-chatbot-e2e.ts` (3-turn LLM + browser smoke) |
| Outlook 14-row eval | `pnpm exec tsx scripts/v2-eval.ts` |
| Send-gate proof | `pnpm exec tsx scripts/v2-send-test.ts` |
| Mac unsigned build | `pnpm package:mac:local` (~6 min; skips preinstalled-skills) |
| Mac signed build | `pnpm package:mac` |
| Windows build | `pnpm build:win` (NSIS x64) |
| Harness CI suite | `pnpm harness:ci` |
| Bundle gateway plugins | `pnpm bundle:openclaw-plugins` |
| Pre-flight before package | `pnpm typecheck && pnpm exec tsx scripts/v2-chatbot-e2e.ts` (catches ~80% of regressions in <30s) |

E2E tests require a built renderer; both `test:e2e` scripts run `build:vite` first. Do not skip that step manually.

---

## Conventions

- **Versions are `0.4.3-moe.N`.** Bump N on every shippable release.
- **Commits use Conventional Commits** with the area in parens: `fix(packaging): …`, `feat(outlook): …`, `ci(windows): …`, `docs: …`.
- **Branch model:** `main` is the working branch. Push to `pilot/main` (SSH remote `pilot`) for the dmvevents/clawx-pilot fork. Don't push to `origin` (ValueCell-ai upstream) without confirmation.
- **No emojis in code or commits.** User did not ask for them.
- **Be decisive.** If the user said "do it now", don't ask permission again.

---

*Last updated: 2026-09-03 (finish-sprint reconciliation — capabilities map refreshed to moe.15, finish-sprint packet added, historical sections marked). Update this file when capabilities change, when a new hard rule is learned, or when the architecture shifts.*
