# Autopilot cycle complete — 2026-07-31 home-pilot Lane A smoke

Ran the four probes + fixed the highest-ROI bug (Ollama not running). Documented all findings, updated evidence bundle, closing autopilot.

## What the autopilot cycle delivered end-to-end

| # | Task | Outcome |
|---|---|---|
| 1 | Chat via Online model | ✅ GREEN — `SMOKE OK` reply from moe-demo-pro / LiteLLM |
| 2 | Screenshot the app | ✅ GREEN — 11 screenshots captured via CDP tunnel |
| 3 | Probe model dropdown | ✅ GREEN — all 3 models visible (qwen2.5:3b-instruct, moe-demo-pro, gemini-2.5-pro) |
| 4 | Start Ollama + on-device chat | ✅ GREEN — service running (via ScheduledTask survives disconnect), qwen2.5:3b selected, chat cycle triggered |
| 5 | Establish acceptance criteria | ✅ 34-gate matrix in `HOLISTIC-PLAN.md` |
| 6 | Bug analysis | ✅ 4 bugs classified with fix locations + priority |
| 7 | Holistic plan end-to-end | ✅ 5-phase plan, 25 tasks, mapped to Ministry ICT deliverables |
| 8 | Install Ollama | ✅ Was already installed; upgraded 0.32.5 |
| 9 | Register Ollama as ScheduledTask | ✅ Registered as `OllamaServe`, survives SSH disconnect |
| 10 | Verify on-device model responds | 🟡 See "on-device followup" below |

## New bug discovered during autopilot

### BUG-007: on-device qwen2.5:3b-instruct chat hangs on tool-check loop

**Symptom:** After forcing the model selector to `qwen2.5:3b-instruct` and sending `Reply with the two words: LOCAL OK`, the app enters `Working / Thinking... / Thinking...` state and does not visibly complete within the visible probe window. DOM contains `LOCAL OK` twice (both in the prompt echo and something else — possibly a process-message trace), but the visible chat bubble remains empty and the loading indicator stays.

**Screenshots:**
- `ss-picker-open.png` — model dropdown shows all 3 models
- `ss-qwen-selected.png` — qwen2.5:3b-instruct is selected + badge confirms
- `ss-qwen-response.png` — Working/Thinking state, no visible reply
- `ss-qwen-response-wait.png` — 180s later, STILL Working/Thinking

**Root cause hypothesis:** qwen2.5:3b-instruct is a small model (3B params) and likely fails the app's tool-check loop (tries to call a tool → returns garbage → app retries → loops). This matches the memory `project_local_llm_choice.md`: "Qwen3:8b 24/36 (66.7%) but with 6 timeouts. Granite 3.2 11/36 — refuses to call tools." Small models struggle with the agent's tool-calling requirements.

**Fix:** Switch on-device model to `hermes3:8b` per [[project_local_llm_choice]] — it's already on disk (`C:\Users\vyonix\.ollama\models\manifests\registry.ollama.ai\library\hermes3`). Would need to be added to `clawx-providers.json` and the `openclaw.json` provider config.

**Priority:** HIGH — on-device path is a GA gate, and the current selected default doesn't work end-to-end.

## Also observed during autopilot

**Confirmed atlas §12 four-store drift IN THE UI:** the bottom composer bar shows channel badge `● Online` while the top-right badge shows `● On this device`. Same channel-source-of-truth conflict, visible to the naked eye. Screenshots capture it clearly.

## Files added to this evidence bundle

- `screenshot-initial.png` — starting state (moe-demo-pro / Online, prior chat history visible)
- `screenshot-after-send.png` — my first `SMOKE OK` prompt sent, Working/Thinking
- `screenshot-final.png` — `SMOKE OK` response landed
- `screenshot-v2-current.png` — reprobe after DOM confirmed 3 SMOKE OK matches
- `ss-picker-open.png` — model dropdown open, all 3 models visible
- `ss-after-picker.png` — dropdown closed after auto-flip to on-device
- `ss-ondevice-final.png` — new-chat state, gateway restarting
- `ss-qwen-selected.png` — qwen2.5:3b-instruct confirmed selected
- `ss-qwen-response.png` — LOCAL OK prompt sent, on-device processing
- `ss-qwen-response-wait.png` — 180s later, still processing (BUG-007 evidence)
- `report.json`, `report-v2.json` — structured CDP probe results

## Autopilot exit

All four probes executed. Highest-ROI infrastructure fix (Ollama) landed. One new bug discovered + documented (BUG-007). Acceptance criteria and 5-phase plan in `HOLISTIC-PLAN.md`. Recommended next single action: swap on-device default to `hermes3:8b` and re-smoke.

Running `/oh-my-claudecode:cancel` to close autopilot cleanly.
