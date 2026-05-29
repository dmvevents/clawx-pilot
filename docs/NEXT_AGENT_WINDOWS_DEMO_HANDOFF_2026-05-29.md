# Next Agent Handoff - Windows Demo Recovery And Test Strategy

Last updated: 2026-05-29.

This is the handoff document for the next agent picking up the Ministry of Education / ClawX Windows demo stabilization work. It consolidates the active demo goal, the evidence gathered so far, the known failure signatures, the safe diagnostic commands, and the next test/build strategy.

## Target Result

The Windows laptop must run the Ministry app end to end for tomorrow's demo:

- Cloud model routing works through `google/gemini-2.5-pro` or another explicitly configured cloud model, not the local Ollama model.
- Chat does not get stuck on "thinking"; model failures surface as actionable errors with logs.
- Excel and Word/document tasks work from user files in Downloads.
- Outlook tools open/read/draft/send through the user's signed-in Chrome session with confirmation gates.
- Microsoft Forms tools fill all required fields in the correct signed-in Chrome session and refuse unsafe submit attempts unless confirmed.
- ASR is acceptable for the demo, or typed prompts are used with ASR documented as best effort.
- The app can be installed cleanly on Windows, launched from desktop shortcuts, probed over SSH, and verified with repeatable scripts.

## Non-Negotiable Safety Rules

- Do not print passwords, provider API keys, Host API bearer tokens, Forms response URLs, full recipient lists, or email bodies.
- Do not send email, download attachments, or submit Forms unless the user explicitly confirms that exact action in the same session.
- Do not use Playwright's managed Chromium for Outlook or Forms. Microsoft Conditional Access blocks it. Use the user's Chrome session over CDP.
- Do not treat standalone `openclaw agent` over SSH as final proof. It is diagnostic only because the real app path depends on Electron's private Host API token.
- Do not switch the demo to the local Ollama model. The user explicitly wants Claude/Gemini-class cloud behavior; Gemini was the stable path.
- Do not edit or delete user state without first backing it up. Important state lives in `%APPDATA%\Ministry of Education` and `%USERPROFILE%\.openclaw`.
- Do not rely on config UI alone to prove provider readiness. Verify the app-facing runtime path with sanitized logs and a real request.

## Critical Existing References

Read these before re-debugging:

- `docs/CLAUDE_CODE_RESUME_AND_TEAMS_GUIDE_2026-05-29.md` - Claude Code startup, skills, subagents, Agent Teams, and OMX/OMC team guidance.
- `docs/WINDOWS_PROBLEMS_ATLAS.md` - known Windows failure classes and fixes.
- `docs/WINDOWS_INSTALL_RUNBOOK.md` - real Windows install/probe sequence over SSH.
- `docs/UTM_WINDOWS_SETUP.md` - Windows VM setup for this Mac.
- `windows-pilot/README.md` - pilot package overview, scripts, hard rules.
- `windows-pilot/plans/WINDOWS_DEMO_INTEGRATION_STRATEGY_2026-05-26.md` - Outlook, Forms, Office, ASR plan.
- `windows-pilot/plans/TOOL_REFERENCE.md` - exact `moe-principal-assistant` tool names and gates.
- `.codex/skills/windows-outlook-demo/SKILL.md` - project-local Codex skill for the Windows Outlook/Forms demo path.

## Current Repository Evidence

The repo has purpose-built scripts and tests for this work:

- `package.json`
  - `pnpm run demo:office-analysis` parses Excel/Word demo files without requiring the model.
  - `pnpm run prep:win-binaries` downloads Windows `uv`, Windows `node`, and builds the Windows ASR helper.
  - `pnpm run package:win` and `pnpm run build:win` include the Windows ASR helper preflight.
  - `playwright-core` is a runtime dependency. Do not move it back to `devDependencies`; Windows packaged builds fail with `Cannot find module 'playwright-core'`.
- `tests/e2e/fixtures/electron.ts`
  - E2E launches Electron with temp `HOME`, `USERPROFILE`, `APPDATA`, and `LOCALAPPDATA`.
  - E2E intentionally skips heavy runtime side effects such as Gateway auto-start, skill install, tray, and CLI auto-install.
  - This is useful for renderer/UI paths, but it cannot catch the real "Gateway stuck thinking" class by itself.
- `tests/unit/channel-router.test.ts`
  - Covers channel switching transactions for online/on-device.
- `tests/unit/provider-runtime-sync.test.ts`
  - Covers provider runtime sync and Gateway reload scheduling.
- `tests/unit/forms-browser-driver-cdp.test.ts`
  - Covers Forms CDP reconnection, authenticated context preference, required-field behavior, submit confirmation, and validation errors.
- `tests/unit/forms-browser-submit-gate.test.ts`
  - Covers submit fingerprint and suspension payload formatting.
- `tests/unit/asr-ipc-provider-selection.test.ts`
  - Mocks `process.platform = win32` and tests Azure Speech fallback to Windows native ASR.
- `scripts/demo-office-analysis-e2e.mjs`
  - Offline Office parser for Excel/Word demo artifacts. Use it to isolate "model cannot read file" from "file parsing failed."

## What Happened In This Session

### Packaging And Installer

- The earlier Windows packaged app hit `Cannot find module 'playwright-core'`.
- Root cause: `playwright-core` was bundled as a dev dependency and stripped by electron-builder.
- Current repo has `playwright-core` under runtime dependencies with a package note. Keep that invariant.
- Windows packaging has a native ASR helper build path via `pnpm run prep:win-binaries`.

### Model/Gateway Failures

Observed symptoms:

- Chat stayed on "thinking."
- Windows logs showed stuck sessions with `state=processing`, increasing age, and queue depth.
- User saw model call failures after the app had been working.
- The SEA Excel prompt became stuck even though the file flow had worked before.

Root causes observed or strongly indicated:

- Wi-Fi was disabled at one point; Gemini could not reach Google's API.
- Provider/runtime drift happened after recovery: UI/provider store pointed online while parts of OpenClaw runtime config still pointed to local Ollama or stale Google API protocol data.
- The app can present "Google/Gemini" while the runtime is still using a stale local model snapshot if the multiple stores diverge.

Recovery performed:

- Set preferred channel back to `online`.
- Set provider default/default provider account to Google in the app provider store.
- Set OpenClaw default model toward `google/gemini-2.5-pro`.
- Restarted app/Gateway and verified Gateway health.
- Confirmed recent stuck session count returned to zero after recovery.

Remaining risk:

- A config guard / last-good restore can rewrite a small or divergent `openclaw.json` during restart. The next agent should add a regression test that simulates this split-brain state and proves preflight converges all stores.

### Outlook And Forms

Observed symptoms:

- The agent sometimes could not find the email button.
- The app sometimes opened a fresh Chrome window that was not logged in.
- Forms filling missed fields, then reported a problem.

Load-bearing facts:

- Outlook and Forms must run through the signed-in user Chrome profile over CDP on `127.0.0.1:18792`.
- Managed Chromium is not acceptable because Conditional Access blocks it.
- Forms response pages are more stable than Forms editor pages.
- Submit/send gates are intentional and must stay in place.

Current strategy:

- Use `windows-pilot/scripts/pilot-attach-chrome-cdp.ps1` to ensure Chrome CDP.
- Use `windows-pilot/scripts/pilot-verify-outlook-tab.ps1` to prove Outlook login readiness.
- Use `windows-pilot/scripts/pilot-electron-cdp-probe.js` through `pilot-run-electron-cdp-probe.ps1` to prove the Electron renderer path can call Host API routes.
- Keep `microsoft-graph` disabled for the real send path until it has equivalent visible draft and confirmation gates.

### Office Documents

Current useful path:

- Put demo Excel/Word files in Windows Downloads.
- Use `pnpm run demo:office-analysis -- --excel <file> --word <file> --json-out <out>` on Mac, or the equivalent Node script on Windows, to prove parsing independent of model.
- The model prompt should be principal-oriented: analyze the file, produce a staff-ready/parent-ready brief, draft a Word-style document, then attach or prepare email when explicitly asked.

Risk:

- Excel parsing and model reasoning are separate failure domains. Diagnose them separately. If the parser succeeds but the model stalls, go back to provider/Gateway coherence.

### ASR

Observed symptoms:

- Whisper CLI not found on Windows.
- Native ASR quality was poor.

Current repo direction:

- Packaged Windows should prefer Azure Speech when configured.
- Fallback order is Azure Speech, Windows native helper, then Whisper CLI.
- `WinSpeechRecognize.exe` must be present in the packaged resources for Windows native fallback.
- If demo time is tight, typed prompts are safer than trying to tune ASR at the last minute.

## Windows State Probe Checklist

Start every Windows debugging pass with read-only evidence.

```bash
ssh pilot 'echo ok'
ssh pilot 'powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\pilot-probe-state.ps1"'
ssh pilot 'powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\pilot-verify-outlook-tab.ps1"'
ssh pilot 'powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\pilot-tail-gateway-log.ps1"'
```

Required high-level state:

- App installed in `%LOCALAPPDATA%\Programs\Ministry of Education`.
- Gateway is listening on `18789`.
- Host API is listening on its configured port.
- Browser plugin / Outlook manager ports are available when needed.
- Chrome CDP is listening on `18792`.
- Outlook tab is signed in, not on login.
- Provider/channel points to online Google/Gemini or the explicitly selected cloud model.
- Recent sessions do not show `state=processing` with old age and unchanged queue depth.

## Provider/Gateway Coherence Checklist

When chat is stuck on "thinking" or model call failed:

1. Verify network first.

```powershell
Test-NetConnection generativelanguage.googleapis.com -Port 443
```

2. Verify app/provider store state.

Check sanitized values only:

- `%APPDATA%\Ministry of Education\settings.json`
- `%APPDATA%\Ministry of Education\clawx-providers.json`
- `%USERPROFILE%\.openclaw\openclaw.json`
- `%USERPROFILE%\.openclaw\agents\main\agent\models.json` if present
- latest `%USERPROFILE%\.openclaw\agents\main\sessions\*.jsonl`

Expected:

- preferred channel: `online`
- default provider: `google`
- default model: `google/gemini-2.5-pro`
- latest model snapshot provider: `google`, not `ollama-ollamalo`
- Google runtime API protocol: `google-generative-ai` when explicitly present
- no stale explicit OpenAI-compatible Google override

3. Restart only after backing up state if a write is necessary.

4. Verify the exact app-facing request path after restart, not just config files.

Pass evidence:

- Gateway health returns live/ok.
- A raw Gateway chat request starts and produces an assistant result.
- Transcript records provider `google`, model `gemini-2.5-pro`, and no stale local model snapshot.
- No new stuck processing diagnostics after 30-60 seconds.

## Forms/Outlook Checklist

Before asking the model to send an email or fill a form:

- Chrome CDP `http://127.0.0.1:18792/json` must respond.
- The CDP page list must include a signed-in Outlook tab for email tasks.
- The app must use the Electron Host API path, not direct renderer fetches to Gateway endpoints.
- Forms preview must fill but not submit.
- Forms submit must require `confirm:true` and the expected form title.
- Outlook draft must leave a visible draft open.
- Outlook send must require `confirm:true` and a subject match with the open compose pane.

Useful log grep patterns:

```text
moe-principal-assistant
outlook.open
outlook.draft_email
outlook.send_email
forms.list
forms.preview_suspension
forms.submit_suspension
connectOverCDP
tool.execute is not a function
```

## Mac-Side Windows Emulation Strategy

Mac can catch deterministic logic, but it cannot fully emulate Windows. Use it for fast checks, then validate real Windows behavior in a VM or pilot laptop.

### Layer 1 - Fast Mac Regression Tests

Use temp Windows-like directories:

```bash
APPDATA=/tmp/clawx-win/AppData/Roaming
LOCALAPPDATA=/tmp/clawx-win/AppData/Local
USERPROFILE=/tmp/clawx-win/User
HOME=/tmp/clawx-win/User
```

Add or run tests that seed split-brain config:

- Settings says `preferredChannel: online`.
- Provider store says Google default.
- OpenClaw config still points to Ollama/local.
- Agent model registry is missing, stale, or mismatched.

Then run the real preflight/sync code and assert all stores converge. This is the highest-value missing regression test.

Run targeted checks:

```bash
pnpm exec vitest run tests/unit/channel-router.test.ts tests/unit/provider-runtime-sync.test.ts
pnpm exec vitest run tests/unit/forms-browser-driver-cdp.test.ts tests/unit/forms-browser-submit-gate.test.ts
pnpm exec vitest run tests/unit/asr-ipc-provider-selection.test.ts tests/unit/asr-feature-flags.test.ts
pnpm run comms:replay
pnpm run comms:compare
```

Office parser isolation:

```bash
pnpm run demo:office-analysis -- --excel "<path-to-xlsx>" --word "<path-to-docx>" --json-out /tmp/office-analysis.json
```

### Layer 2 - Windows VM On This Mac

Use `docs/UTM_WINDOWS_SETUP.md` to create a Windows 11 ARM VM. Treat the VM like the pilot:

- Install Chrome.
- Install Office/Outlook or use Outlook Web login.
- Enable OpenSSH Server.
- Install the packaged app.
- Run the same `windows-pilot/scripts` probes over SSH.
- Snapshot before each risky install or demo rehearsal.

This catches:

- NSIS install behavior.
- Windows `%APPDATA%` / `%LOCALAPPDATA%` paths.
- Windows file locking and restart behavior.
- Native ASR helper presence.
- Chrome CDP on Windows.

It does not perfectly catch:

- x64-only laptop quirks.
- Tenant-specific Conditional Access differences.
- Physical network/Wi-Fi state.

### Layer 3 - Physical Pilot Laptop

The physical Windows laptop is the source of truth for demo readiness. Use it for final smoke only after Mac/VM checks are green.

Run:

- install/launch check
- provider/Gateway coherence check
- Excel/Word file demo check
- Outlook open/read/draft check
- Forms preview check
- ASR smoke if time permits

## Missing Regression Tests To Add

These are the highest-value gaps.

1. `windows-profile-coherence` test
   - Seed divergent Windows-like stores.
   - Run channel preflight/provider runtime sync.
   - Assert online Google/Gemini is coherent across settings, provider store, OpenClaw defaults, agent list/defaults, and runtime provider registry.

2. `gateway-stuck-thinking` UI test
   - Mock a Gateway RPC that starts but never completes.
   - Assert chat shows timeout/retry/actionable error instead of silent infinite thinking.

3. `model-switch-during-active-request` comms replay
   - Reproduce a request started on one provider while config flips.
   - Assert session model snapshot is stable per request or recovery is explicit.

4. `forms-required-fields` fixture expansion
   - Use representative suspension/attendance data.
   - Assert every required field is filled or the driver returns exact missing field names.

5. `packaged-office-runtime` smoke
   - On Windows install, verify `xlsx`, document generation dependencies, and ASR helper import/run from packaged resources.

## Recommended Next-Agent Execution Order

1. Read this file, `docs/WINDOWS_PROBLEMS_ATLAS.md`, and `.codex/skills/windows-outlook-demo/SKILL.md`.
2. Run read-only pilot probes. Do not write config until the current state is captured.
3. If chat is stuck, diagnose network and provider/runtime coherence first.
4. If Office file prompts stall, run `scripts/demo-office-analysis-e2e.mjs` against the same file to separate parser failure from model failure.
5. If email/forms fail, verify Chrome CDP and signed-in Outlook/Form context before changing code.
6. If the same failure recurs, add the missing regression test before patching.
7. After any functional change, run targeted tests plus `pnpm run typecheck` if feasible.
8. Update `docs/WINDOWS_PROBLEMS_ATLAS.md` with any new failure class and detection line.

## Completion Criteria For Demo Readiness

Do not call the Windows demo ready until there is fresh evidence for all of these:

- App launches from the installed Windows shortcut.
- Gateway becomes ready and stays live.
- Cloud model request succeeds through the app path.
- Latest transcript shows the intended cloud provider/model.
- Excel sample can be parsed and summarized.
- Outlook can open/read/draft through signed-in Chrome.
- Sending remains gated and works only after explicit confirmation.
- Forms preview fills all expected required fields.
- Forms submit remains gated and works only after explicit confirmation on the test form.
- Logs have no secrets and no repeated stuck processing diagnostics.
- A rollback path exists: backed-up app state and known-good installer.

## Quick "Do Not Re-Debug" Map

| Symptom | First place to look |
|---|---|
| `Cannot find module 'playwright-core'` | `docs/WINDOWS_PROBLEMS_ATLAS.md` §1 |
| Gemini shows thinking forever | Provider/Gateway coherence, network, latest session model snapshot |
| Gemini 400/no body | stale Google runtime API override; expect `google-generative-ai` |
| New Chrome opens but not logged in | CDP/profile issue; use signed-in user Chrome, not managed Chromium |
| Forms misses fields | Forms driver required-field capture and schema mapping |
| Email button not found | wrong Outlook view/profile or CDP page context |
| Whisper not found | Windows ASR helper package/fallback chain |
| Gateway down after restart | app logs, health port, config guard/last-good restore |
| Excel prompt stuck | separate Office parser success from model/Gateway request |

## Artifact Discipline

Keep reusable knowledge in repo files:

- Failure class: `docs/WINDOWS_PROBLEMS_ATLAS.md`
- Operator runbook: `docs/WINDOWS_INSTALL_RUNBOOK.md`
- VM setup: `docs/UTM_WINDOWS_SETUP.md`
- Demo/pilot scripts: `windows-pilot/scripts/`
- Agent-facing skills: `.codex/skills/` and `windows-pilot/skills/`
- One-off Windows output: Windows Downloads or an explicit timestamped artifact path

Keep logs redacted. Prefer counts, statuses, subject previews, model/provider names, and file paths over raw content.
