# Windows install + UI + core-flow test pass — 2026-08-03

**Target:** VYONIX Windows 11 24H2 laptop (`home-pilot` = 192.168.1.212, x64 native), real install of the Lane A build (0.4.3-moe.11, Electron 40.8.4, bundled OpenClaw gateway v2026.4.23), built fresh from `fc435c6b`.
**Method:** SSH + interactive session-1 scheduled tasks for full-resolution (1920x1080) screenshot capture; CDP (remote-debugging port 9223) for driving the renderer and reading DOM; AWS Bedrock Opus (`us.anthropic.claude-opus-4-8`) for vision grading.
**All artifacts in this directory are real** — screenshots pulled from the running app, logs from `%APPDATA%\Ministry of Education\logs`, direct-API probes against local Ollama.

---

## GO / NO-GO: **NO-GO for an on-device (default) chat demo. CONDITIONAL-GO only with a cloud model.**

The clean install boots correctly and the UI is well-designed (7/8 screens pass vision grading on layout). **But the default on-device chat is non-functional: the agent cannot answer even a basic question — it tool-cascades and hangs indefinitely.** This is the single blocking defect.

---

## 1. INSTALL — PASS

- Clean install launches; gateway comes up green: `gateway connected | port: 18789 | pid: <pid>` (verified across several relaunches: pid 14244, 264, 6868, 12876, 6652).
- **BUG-012 (fresh-install missing `agents` block) is FIXED and confirmed in the live UI.** `~/.openclaw/openclaw.json` now contains `agents.defaults.model.primary = "ollama-ollamalo/qwen2.5:3b-instruct"`; RPC router recovers via the ready-fallback probe ("Gateway ready fallback RPC router probe succeeded" at boot). Onboarding wizard → Environment Check (all green) → "All Set!" → main chat all reached.
- Expected, non-blocking: on a credential-less fresh install, 4 cloud plugins fail validation gracefully (`amazon-bedrock, amazon-bedrock-mantle, google, microsoft`). No crash.

## 2. UI (Opus vision grading) — 7/8 layout PASS; 2 copy/leak FAILs

| Screen | Verdict | Score | Key note |
|---|---|---|---|
| 01 setup-welcome | PASS | 7 | Duplicate "Welcome…" heading; placeholder MoE logo; language selector affordance unclear |
| 02 chat (clean idle) | **FAIL** | 4 | Layout clean, but raw session IDs (`agent:main:main`), `port/pid` status line, and dev-jargon chips ("Continuous Execution", "Multi-Agent Parallel") leak to non-technical users |
| 03 models | PASS | 9 | Clean. **BUT token-usage chart prints raw `qwen2.5:3b-instruct`** — violates "anonymise model identity" hard rule |
| 04 agents | PASS | 8 | Clean; sparse empty area |
| 05 channels | PASS | 8 | Clean; sparse empty area |
| 06 skills | PASS | 8 | Clean; exposes full `C:\Users\VYONIX\...` paths + dev-oriented skill copy |
| 07 cron | PASS | 8 | "Create Your First Task" CTA clipped at viewport bottom |
| 08 settings | PASS | 9 | Clean |

**Design conclusion:** visual layout/contrast/consistency is genuinely good. The recurring real problem is **anonymisation/copy hygiene** — raw model IDs, ports, PIDs, session keys, and filesystem paths surface to a non-technical principal audience, contrary to the CLAUDE.md hard rules ("anonymise model identity", "hide dev details"). These are polish/compliance fixes, not layout breakage.

## 3. CORE FLOWS + EDGE CASES — on-device chat is the blocker

### BLOCKER: on-device agent tool-cascades and never terminates

Reproduced repeatedly across fresh relaunches with pristine config:

- Prompt "Say the single word PONG and nothing else." → model emits its answer as a spurious `tts` tool call (`{"text":"PONG"}`), tts has no provider → "TTS conversion failed: no provider registered" → turn ends `stopReason=stop payloads=0` → **"incomplete turn detected … surfacing error to user"**, UI hangs at "Thinking…" (screen 10).
- Prompt "What are three things a principal should check before term?" → model calls `process {action:list}` → `sessions_list {}` → `subagents {action:list}` in a cascade, eventually an **infinite `subagents {action:list}` loop**; stuck-session diagnostics climb past 955s; never answers (screen 09).

**Root cause (isolated with direct-API probes against local Ollama):**
1. **No-tools:** `qwen2.5:3b-instruct` answers the principal question perfectly and fast (full correct list). → the model is capable.
2. **With just 2 tools present:** the same model returns `finish_reason=tool_calls` and wraps its answer inside a spurious `tts` call instead of replying. → **the model has poor tool-calling discipline.**
3. ClawX's agent runtime injects its **full built-in tool catalog** (`tts`, `process`, `sessions_list`, `subagents`, `cron`, `canvas`, …) into every on-device turn, so the 3B model tool-cascades instead of answering.

**Config-only mitigation does NOT work (tested live, not assumed):**
- `agents.defaults.tools.sandbox.tools.deny=["tts","web_search","image"]` → tts STILL called. `tts` is registered by the bundled `speech-core` extension via the *message-provider* tool path (`TOOL_ALLOW_BY_MESSAGE_PROVIDER.node`), not the sandbox-policy path, and `createTtsTool()` is pushed unconditionally (openclaw-tools:8891). The sandbox `deny` never reaches it.
- `allow=["read"]` + broad `deny` of process/subagents/etc → cascade STILL happened (fell into the `subagents` loop). These built-in agent tools are not gated by the sandbox allow/deny policy either.
- Also note: the seed's intended "tool-call hammer"/compat mitigation (`patchProviderModelCompat` → `model.compat.supportsTools` etc.) **never lands on fresh install** — the live `models.providers["ollama-ollamalo"]` model entry has NO `compat` block, because the always-run patch bails (`if (!providerEntry) return`) when the runtime provider entry doesn't yet exist at patch time.

### Other flows
- Model/channel toggle shows "On this device" (correctly anonymised in the toggle chip). No cloud account configured, so the online channel is unexercised (no creds — expected).
- No crashes observed across ~6 relaunches, config patches, and forced process kills; state files (`~/.openclaw/`) preserved (backed up before every edit, restored after).

---

## Recommended fixes (in priority order)

1. **BLOCKER — fix on-device tool discipline.** The real fix is in code, not config. Options:
   - (a) **Restrict the tool catalog exposed to the on-device agent** at the point ClawX assembles the agent's toolset — trim to the small set a principal turn actually needs (chat + the moe-principal-assistant tools + document skills), excluding `tts`/`process`/`subagents`/`cron`/`canvas`/`sessions_*`. This must be done where ClawX drives the gateway, since the bundled sandbox allow/deny policy demonstrably does not gate these.
   - (b) **Land the compat block on fresh install.** Make `patchProviderModelCompat` (or the seed) create/patch the `ollama-ollamalo` model entry's `compat` (`supportsTools`, reasoning extraction) BEFORE first turn, instead of bailing when the entry is absent. Verify whether `compat` alone tames the spurious tool-calling.
   - (c) **Consider a better-behaved on-device model** if (a)/(b) don't fully fix it; or gate the demo to a cloud model. (Note: memory's "hermes3:8b default" is stale — the seed intentionally chose qwen2.5:3b for the 16 GB laptop footprint; hermes3:8b is present on disk but rejected at 30 GB loaded.)
2. **Anonymisation/copy hygiene (hard-rule compliance):** hide `port/pid` status line, raw session IDs, raw model ID in Models token chart, and `C:\Users\…` paths in Skills from principal-facing surfaces.
3. **Polish:** de-duplicate the welcome heading; real MoE logo; un-clip the Cron "Create Your First Task" CTA.

## What I changed on the box
- Nothing persisted. All config edits were applied to a backup-first copy (`openclaw.json.bak-toolpolicy`) and **restored to pristine** after each test. Final state: pristine config, app relaunched clean, gateway green.
- Helper scripts left on the box: `cap-screen.ps1`, `action.ps1`, `patch-*.ps1`, `register-launch.ps1`; scheduled tasks `ClawXCapture`, `ClawXAction`, `ClawXLaunch`.
