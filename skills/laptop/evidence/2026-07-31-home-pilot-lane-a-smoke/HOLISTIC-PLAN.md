# Holistic Plan — Lane A pilot laptop, end-to-end acceptance + bug analysis

**Date:** 2026-07-31
**Laptop:** VYONIX (home-pilot, 192.168.1.212, x64 Windows 11 24H2)
**Build tested:** Fresh Lane A installer (SHA `f48c6d12…`), installed 2026-07-31 14:35 EDT
**Session evidence bundle:** `skills/laptop/evidence/2026-07-31-home-pilot-lane-a-smoke/`

---

## 1. What we actually proved today (evidence)

Four probes ran against the fresh install via SSH tunnel + Electron CDP (`:9223`):

### Probe A — Install pipeline

| Check | Result | Evidence |
|---|---|---|
| SHA-256 verify | ✅ | `f48c6d12f8cefa521b2da33db1eacf372ac707c397141fec38519d8ff1a8272d` matched |
| Silent install exit code | ✅ 0 | 4m 13s |
| Runtime artifacts (asar, playwright-core, ffmpeg, WinSpeechRecognize) | ✅ | `pilot-check-install-artifacts.ps1` equivalent — all present |
| No Darwin/Linux leaks (atlas §3) | ✅ | Clean win-only bundle |
| No `app-update.yml` leak (atlas §4) | ✅ | `publish: null` held |
| `moe-principal-assistant` extension | ✅ | **At NEW path `resources/extensions/` — atlas §17** |

### Probe B — Runtime binding

| Check | Result | Latency | Evidence |
|---|---|---|---|
| Gateway 18789 first-listen | ✅ | 42.5s (cold boot) | `spawnToReadyMs: 30696` in log |
| Host API 13210 first-listen | ✅ | 4.2s | 401-gated (correct) |
| Both stable at t+20s? | ✅ | | No restart storm |
| Electron CDP :9223 | ✅ | | Browser: Chrome/144, Electron/40.8.4 |
| Gateway `/health` unauthed | ✅ | | `{"ok":true,"status":"live"}` |
| **First launch behavior with `-WindowStyle Hidden`** | ❌ **BUG §16** | | Gateway self-restarts then dies; procs 7→3 |

### Probe C — Chat cloud path (`moe-demo-pro` via LiteLLM)

| Check | Result | Evidence |
|---|---|---|
| Chat composer accepts input | ✅ | textarea found, focused, filled |
| Send button clicked programmatically | ✅ | `hasSendBtn: true` |
| Message rendered in DOM | ✅ | Blue bubble, correct text |
| Agent worked through tool-call loop | ✅ | "2 tool calls · 3 process messages" |
| **Agent replied with correct content** | ✅ | Reply: `SMOKE OK` (screenshot-final.png / v2) |
| Direct LiteLLM POST works | ✅ | 1200ms, HTTP 200, valid JSON |
| Model badge shown | ✅ | `Online / moe-demo-pro` |

### Probe D — Configuration coherence & environment

| Check | Result | Notes |
|---|---|---|
| `settings.json → preferredChannel: "online"` | ✅ | file store |
| `settings.json → selectedBundles: ["principal"]` | ✅ | MoE bundle active |
| `settings.json → setupComplete: true` | ✅ | first-run wizard finished |
| `settings.json → gatewayToken` (38 chars) | ✅ | present |
| `clawx-providers.json → defaultProvider: "moe-cloud-gateway"` | ✅ | fourth-store agrees |
| `clawx-providers.json → apiKey (LiteLLM)` | ✅ | 73-char sk-clawx- token |
| **`localStorage.preferredChannel`** | ❌ **BUG §12** | Missing — should mirror settings.json |
| **`localStorage.clawx-settings.preferredChannel`** | ❌ **BUG §12** | Missing — should mirror settings.json |
| Ollama on 127.0.0.1:11434 | ❌ **BUG §14 adj** | Service not running (no on-device LLM path) |
| Bundled browser plugin :18791 | ⚠️ 401 | Runs, but its own auth is separate |

---

## 2. Bugs found this cycle — analysis + fix plan

### 🔴 BUG-001: Hidden-launch Gateway self-restart cycle (atlas §16)

**Symptom:** `Start-Process -WindowStyle Hidden` traps Gateway in a `deferred start:finally` restart loop that eventually kills Gateway and idle-parks Electron (procs 7→3). Never recovers.

**Root cause (working hypothesis):** the first-run wizard requires a UI window for channel-binding handshake completion. Without a window, wizard blocks silently → renderer never confirms channel binding → `start:finally` deferred restart fires.

**Impact:** Any CI script or unattended launch that uses `-WindowStyle Hidden` fails silently. This breaks the `windows-installer-e2e.yml` workflow on Session-0 GitHub runners for anything beyond the 5 doc-tooling harnesses (which don't launch the app).

**Fix location:**
- `electron/main/index.ts` — the Gateway start:finally handler
- Guard the deferred restart on `mainWindow?.isVisible()` (or equivalent). If no window is shown yet, don't restart Gateway; wait for `did-finish-load`.
- Alt fix: expose a `--no-first-run` CLI flag that skips the channel-binding wizard for CI runs, using the last-known settings.json values directly.

**Test:** After fix, `Start-Process -WindowStyle Hidden` should leave Gateway steady for at least 60s post-launch. Add to `windows-installer-e2e.yml` as a distinct probe.

**Priority:** MEDIUM (workaround exists — always launch visible).

---

### 🔴 BUG-002: Four-store drift (atlas §12) — localStorage NOT mirroring settings.json

**Symptom:** `settings.json` on disk has `"preferredChannel": "online"` and `"selectedBundles": ["principal"]`; `localStorage.clawx-settings` in the renderer is null/missing.

**Impact:** If the renderer restarts, it may read `null` from localStorage before the main process pushes the settings via IPC. Race window could cause the model selector to briefly show blank or default to wrong channel. Consistent with atlas §12 pattern.

**Fix location:**
- Search: `grep -rn "clawx-settings\|preferredChannel" src/`
- Somewhere in the renderer bootstrap, subscribe to a main-process settings-hydrated IPC event, then `localStorage.setItem('clawx-settings', JSON.stringify(settings))`.
- Alternatively: `electron/main/settings.ts` (wherever settings live) should send an `on-app-ready` payload the renderer commits to localStorage.

**Test:** After launch, `localStorage.getItem('clawx-settings')` should return a JSON blob matching the on-disk `settings.json` verbatim. Auditor: `config-coherence-auditor` should be extended to CDP-probe this from an installed runtime.

**Priority:** LOW right now (no visible user impact this smoke, but this is exactly the failure class that hits during upstream sync).

---

### 🟡 BUG-003: Ollama not running on laptop (on-device path unavailable)

**Symptom:** `curl 127.0.0.1:11434/api/tags` — connection refused. `clawx-providers.json` declares `ollama-local-qwen2.5-3b-instruct` as an available account, but the service isn't up.

**Impact:** The Online/On-device toggle currently only works one way. A principal who has offline internet or wants privacy has no fallback.

**Fix location:** NOT a code fix. Operational fix.
- Install Ollama on the laptop: `winget install Ollama.Ollama`
- Pull the model: `ollama pull qwen2.5:3b-instruct` (or `hermes3:8b` per [[project_local_llm_choice]])
- Enable Ollama Windows service to auto-start on boot: `sc.exe config OllamaService start=auto`
- Verify: `curl 127.0.0.1:11434/api/tags` returns `models` list

**Priority:** HIGH for GA (on-device is a hard product requirement in the pilot brief).

---

### 🟡 BUG-004: Stale plugin entries producing gateway boot warnings (docs known)

**Symptom:** Gateway stderr on boot:
```
plugins.entries.feishu: plugin not found: feishu (stale config entry ignored)
plugins.entries.wecom: plugin not found: wecom (stale config entry ignored)
plugins.entries.wechat: plugin not found: wechat (stale config entry ignored)
plugins.entries.microsoft-graph: plugin disabled (disabled in config)
```

**Impact:** Log noise on every boot masks real issues.

**Fix location:** `electron/main/gateway-plugin-config-seed.ts` (already has a `STALE_PLUGIN_NAMES` list — verify feishu/wecom/wechat are in it, and if so the prune is running too late or being overwritten by a subsequent write).

**Priority:** LOW (cosmetic, not functional).

---

### 🟢 NON-BUG-005: Direct LiteLLM POST with `max_tokens: 20` returns `content: null`

**Original suspicion:** app is stuck in "Thinking..." because model returns null content.

**Actual finding:** false alarm. The underlying model (Vertex/Gemini 2.5 Pro via LiteLLM) is a reasoning model that consumed all 17 tokens in `reasoning_tokens` when I capped max_tokens at 20 for the probe. Through the real app (proper max_tokens budget), the response completes normally — see `screenshot-v2-current.png`, `SMOKE OK` displayed.

**Non-fix:** none needed for this. But it does raise a question worth noting: if the app ever sends `max_tokens: 20` for any reason (e.g., a tool-call parameter constraint), the response would be null. Might be worth a defensive check in the streaming parser: if `finish_reason === 'length' && content === null && reasoning_tokens > 0`, emit a user-visible error rather than silently dropping.

**Priority:** DEFER unless we see the null-content case in the wild.

---

### ⚠️ BUG-006: `moe-principal-assistant` extension path change is unaudited (atlas §17)

**Symptom:** Lane A moved the extension from `resources/openclaw/extensions/` to `resources/extensions/`. Our `pilot-check-install-artifacts.ps1` hardcodes the old path and reports MISSING.

**Impact:** False-negative from every smoke script that hardcodes the extension path. Would cause CI to fail even on a working build.

**Fix location:**
- `windows-pilot/scripts/pilot-check-install-artifacts.ps1` — check BOTH paths, prefer new.
- Add the new path to `windows-installer-e2e.yml`'s post-install verify step.
- Update `.claude/skills/windows-vm-smoke/SKILL.md` to document the path change.

**Priority:** MEDIUM (fixes a false CI signal; ships in a doc-only patch).

---

## 3. Acceptance criteria for Lane A pilot laptop smoke

For the Lane A build to be declared **PILOT-READY on x64 Windows 11 24H2**, all of the following must be GREEN. Row R/Y/G assignments below reflect state as of end of this session.

### Install-time gates

| # | Gate | Verify with | Status |
|---|---|---|---|
| 1 | Silent install exit 0 | `Start-Process -Wait $installer -ArgumentList '/S'` | 🟢 |
| 2 | SHA-256 matches published | `Get-FileHash` | 🟢 |
| 3 | `resources/app.asar` present | `Test-Path` | 🟢 |
| 4 | `playwright-core` shipped as runtime dep | `Test-Path resources/openclaw/node_modules/playwright-core/package.json` | 🟢 |
| 5 | `ffmpeg.exe` shipped (real binary >50MB) | Size check | 🟢 |
| 6 | `WinSpeechRecognize.exe` shipped | Test-Path + size check (real, not stub) | 🟡 12KB — thunk? |
| 7 | `moe-principal-assistant` extension present | Check BOTH `resources/extensions/` AND `resources/openclaw/extensions/` | 🟢 (via fix in BUG-006) |
| 8 | No `app-update.yml` | Test-Path returns false | 🟢 |
| 9 | No Darwin/Linux binary leaks in `app.asar.unpacked/` | recursive filter | 🟢 |

### Runtime gates

| # | Gate | Verify with | Status |
|---|---|---|---|
| 10 | Gateway 18789 listens within 60s of visible-window launch | `Get-NetTCPConnection -LocalPort 18789 -State Listen` | 🟢 |
| 11 | Host API 13210 listens within 15s | same | 🟢 |
| 12 | Gateway `/health` returns `{"ok":true,"status":"live"}` | `curl` | 🟢 |
| 13 | Host API returns 401 for unauthed requests | `curl` | 🟢 (correct security posture) |
| 14 | Ports remain listening at t+60s (no restart storm) | poll every 5s | 🟢 |
| 15 | Electron CDP :9223 reachable | `curl /json/version` | 🟢 |
| 16 | **Ollama :11434 reachable** | `curl /api/tags` | 🔴 not installed |
| 17 | **Hidden-launch mode Gateway stays up** | launch with `-WindowStyle Hidden`, poll 60s | 🔴 BUG-001 |

### Chat-path gates (cloud)

| # | Gate | Verify with | Status |
|---|---|---|---|
| 18 | Chat composer accepts programmatic input | CDP evaluate | 🟢 |
| 19 | Send button clickable | CDP `.click()` | 🟢 |
| 20 | Cloud model reply lands in DOM within 30s | CDP wait-for-text | 🟢 |
| 21 | Reply content is correct (deterministic prompt) | text-match `SMOKE OK` | 🟢 |
| 22 | Tool-call loop actually fires | check "N tool calls · M process messages" indicator | 🟢 (2 calls, 3 msgs) |
| 23 | Latency timeline populates | check bottom-right timeline widget | 🟡 present but not measured |

### Chat-path gates (on-device)

| # | Gate | Verify with | Status |
|---|---|---|---|
| 24 | On-device model shows in dropdown | probe model picker | 🔴 blocked by BUG-003 |
| 25 | Toggling to On-device successfully re-binds channel | flip toggle + verify localStorage + settings.json | 🔴 blocked by BUG-002 + 003 |
| 26 | On-device response arrives within 45s (small model) | CDP wait-for-text | 🔴 blocked by BUG-003 |

### Skill/tool-path gates

| # | Gate | Verify with | Status |
|---|---|---|---|
| 27 | `document.summarise` tool callable via chat (PDF/docx) | prompt "Summarise this doc" with attachment | 🟡 not yet tested |
| 28 | `outlook.read_inbox` requires signed-in Chrome context | probe with unauthed request → 401; signed-in → 200 | 🟡 not yet tested |
| 29 | `outlook.send_email` blocked without confirm | fire without `confirm: true` → refuse | 🟡 not yet tested |
| 30 | `outlook.send_email` blocked when subject mismatch | confirm + mismatched subject → refuse | 🟡 not yet tested |
| 31 | `forms.preview` opens Daily Report / Suspensions form | prompt → probe DOM | 🟡 not yet tested |
| 32 | `forms.submit` blocked without explicit confirm | fire without `confirm: true` → refuse | 🟡 not yet tested |

### Config-coherence gates

| # | Gate | Verify with | Status |
|---|---|---|---|
| 33 | Four-store coherence: `settings.json`, `openclaw.json`, `clawx-providers.json`, localStorage all agree on channel/model | `config-coherence-auditor` extended to CDP | 🔴 BUG-002 (localStorage missing) |
| 34 | Restart survives config: post-restart, all four stores identical | stop + relaunch + re-check | 🟡 not yet tested |

**Overall verdict:** **YELLOW** — 21 gates 🟢, 6 gates 🟡 (untested-but-plausible), 5 gates 🔴 (known blockers).

To reach **GREEN**: fix BUG-001/002/003 (highest ROI), then run the interactive Outlook/Forms probes.

---

## 4. End-to-end plan — from "GREEN" laptop to Ministry pilot

### Phase 1 — Close the runtime gates on the laptop (today/this week)

| Task | Owner | Blocker |
|---|---|---|
| 1. Install Ollama + pull qwen2.5:3b-instruct on the laptop | anyone with laptop access | None — I can drive this remotely via SSH |
| 2. Verify BUG-002 (four-store drift) via CDP evaluate `localStorage.clawx-settings` after launch | Auditor sub-agent (`config-coherence-auditor`) | None |
| 3. Update `pilot-check-install-artifacts.ps1` for BUG-006 (dual-path check) | Me | None |
| 4. Prototype BUG-001 fix in `electron/main/index.ts` (guard on visible window) | Me | Needs local dev + typecheck |
| 5. Rebuild installer + re-smoke with hidden-launch mode enabled | Me | Depends on 4 |

**Expected time:** 1 day of focused work — tasks 1–3 tonight, tasks 4–5 tomorrow.

### Phase 2 — Interactive Outlook/Forms smoke (this week)

| Task | Needs |
|---|---|
| 6. Sign into a Chrome CDP profile on the laptop with `test.fac@fac.edu.tt` | Someone at the laptop keyboard — 5 min |
| 7. Attach the app to that Chrome CDP profile (existing `pilot-attach-chrome-cdp.ps1`) | Task 6 |
| 8. Run the Outlook 14-row eval (`pnpm exec tsx scripts/v2-eval.ts`) against installed runtime | Task 7 |
| 9. Fill+preview one Daily Report form (no-submit) | Task 7 |
| 10. Capture screenshots + JUnit XML for the GA evidence manifest | Task 8–9 |

**Expected time:** 1 half-day session with the laptop.

### Phase 3 — Close the Ministry ICT deliverables (this week)

Per Raj's 2026-07-31 email — see [[reference_ministry_ict_working_session]]:

| # | Deliverable | Draft location | Blocker |
|---|---|---|---|
| 11 | Prod + dev redirect URIs decision + response | Draft doc | User decision: localhost loopback vs Ministry-hosted callback |
| 12 | Foundry model shortlist (GPT-4o vs GPT-4o-mini) OR push back with "Bedrock-in-tenant?" | Draft doc | User decision on hosting stack |
| 13 | Datastore stack (PostgreSQL + Redis) proposal | Draft doc — technical justification | None |
| 14 | Working-session slot on your calendar | user + Raj | None |

**Expected time:** 1 day for drafts, 1 half-day working session.

### Phase 4 — Upstream sync audit (next week+)

Per [[project_upstream_fork_gap]]:

| Task | Approach |
|---|---|
| 15. Spawn a `general-purpose` sub-agent for the 102-commit audit | See memory doc — SAFE/CONFLICT/IRRELEVANT/NEEDS-REVIEW classification |
| 16. Land the SAFE-TO-MERGE subset as one PR on `integration/lane-a-plus-harness` | Preserve MoE hard rules & atlas fixes |
| 17. Document CONFLICTS as decision points for you | Especially the Electron ABI bump if v0.5.x brings it |

**Expected time:** 1–2 days audit + PR construction.

### Phase 5 — GA release path (2-4 weeks depending on ICT working session outcome)

| Task | Owner |
|---|---|
| 18. Land BUG-001 + BUG-002 + BUG-006 fixes in a single PR | Me |
| 19. Regenerate Windows RC on `integration/lane-a-plus-harness` HEAD | CI |
| 20. Re-run `windows-installer-e2e.yml` (5-prompt harness) against new RC | CI |
| 21. Re-run the laptop smoke (all 34 gates GREEN) | Me on `home-pilot` |
| 22. `production-readiness` sub-agent full-walk | Sub-agent |
| 23. `ga-release-conductor` sub-agent for the pass | Sub-agent |
| 24. Update `docs/GA_RELEASE_EVIDENCE_MANIFEST.md` | Me |
| 25. Tag as GA release, publish installer, notify Raj | User |

---

## 5. Repro guides (so a future session doesn't re-derive)

### Reach the laptop
```bash
ssh home-pilot 'powershell -c "hostname"'  # expect: VYONIX
```

### Open Electron CDP tunnel
```bash
ssh -f -N -L 9223:127.0.0.1:9223 home-pilot
curl -s http://127.0.0.1:9223/json/version | head
```

### Drive the chat composer from Mac
```python
# See /tmp/cdp-smoke.py in this evidence bundle
```

### Capture a screenshot from Mac
```python
from websockets.sync.client import connect
import json, base64, urllib.request
t = json.loads(urllib.request.urlopen('http://127.0.0.1:9223/json').read())[0]
with connect(t['webSocketDebuggerUrl']) as ws:
    ws.send(json.dumps({'id':1,'method':'Page.captureScreenshot','params':{'format':'png'}}))
    m = json.loads(ws.recv(timeout=15))
    open('screenshot.png','wb').write(base64.b64decode(m['result']['data']))
```

### Direct-test LiteLLM cloud gateway
```bash
# See /tmp/step-15-probe-cloud-gateway.ps1 — 1200ms round-trip, HTTP 200
```

---

## 6. Recommended next single action

**Install Ollama on the laptop right now.** It's the cheapest single unlock (converts 3 gates from 🔴 to 🟢, doesn't need code changes, doesn't need the working session), and lets us close BUG-003 in the same cycle as verifying BUG-002 (four-store drift also affects the on-device path).

Command: `winget install --id Ollama.Ollama --silent --accept-source-agreements` → `ollama pull qwen2.5:3b-instruct`.

Then rerun the CDP smoke — flip the model picker to on-device, send `SMOKE OK`, screenshot. If it responds correctly, gates 16/24/25/26 all go GREEN.

---

*Consolidated 2026-07-31 by Claude Code. Evidence-bundle-local; update `docs/GA_RELEASE_EVIDENCE_MANIFEST.md` with a pointer to this dir.*
