# Multi-LLM Iteration: Chrome MCP/CDP Outlook Failure + Phoenix Tracing

Date: 2026-06-05
Repo: ClawX / Ministry of Education pilot

## Goal

Diagnose and harden the Windows demo path where a clean install cannot use Outlook/Form browser automation. The user-facing failure transcript shows the assistant repeatedly asking the principal to enable Chrome remote debugging manually and then giving up. We need a production-shaped fix that works out of the box or fails with a deterministic app-side repair/status.

Secondary goal: add a sane Phoenix/OpenTelemetry observability path for the online LiteLLM gateway so conversation/model traces can be inspected without exposing provider keys to end users.

## Grounded Evidence

- The failing transcript says the tool returned `Chrome MCP existing-session attach failed for profile "user"` and the assistant claimed Chrome must be running with remote debugging enabled.
- `shared/feature-flags.ts` currently has `OUTLOOK_BROWSER_V2 = flagFromEnv('CLAWX_OUTLOOK_V2', false)`. Pilot mode is true by default, but Outlook v2 is still opt-in.
- Outlook v1 path:
  - `electron/services/outlook-browser/browser-client.ts`
  - Calls the OpenClaw browser plugin HTTP API at `http://127.0.0.1:18791`.
  - Hard-codes `profile='user'`.
- Outlook v2 path:
  - `electron/services/outlook-browser-v2/playwright-driver.ts`
  - Calls `chromium.connectOverCDP('http://127.0.0.1:18792')`.
  - If CDP attach fails, falls back to `chromium.launchPersistentContext(userDataDir, { executablePath: system Chrome, args: ['--remote-debugging-port=18792'] })`.
  - The fallback can fail when Chrome is already open with the target profile, because the user-data-dir is locked.
- Forms v2 path:
  - `electron/services/forms-browser-v2/forms-driver.ts`
  - Directly calls `chromium.connectOverCDP('http://127.0.0.1:18792')` and has no repair/diagnostic path.
- Windows runbook already encodes the correct operational decision tree in `windows-pilot/skills/chrome-cdp-windows.md` and `windows-pilot/scripts/pilot-attach-chrome-cdp.ps1`:
  - Probe `http://127.0.0.1:18792/json/version`.
  - If down and Chrome is closed, launch system Chrome with `--remote-debugging-port=18792 --user-data-dir=%LOCALAPPDATA%\\Google\\Chrome\\User Data`.
  - If Chrome is already open with the profile and CDP is down, return `PROFILE_LOCKED` and ask user to close Chrome; do not force kill without explicit approval.
- `package.json` currently places `playwright-core` in runtime `dependencies` and has a note not to move it to devDependencies because packaged Windows builds otherwise fail with `Cannot find module playwright-core`.
- Existing Host API surfaces:
  - `electron/api/routes/outlook.ts` exposes `/api/outlook/*` to the gateway plugin.
  - `electron/api/routes/forms.ts` exposes `/api/forms/*`.
  - `extensions/moe-principal-assistant/index.mjs` registers `outlook.*` and `forms.*` tools by proxying through Host API using `CLAWX_HOST_API_PORT` and `CLAWX_HOST_API_TOKEN`.
- The assistant currently has no `browser.diagnose`, `browser.repair`, `outlook.diagnose`, or `forms.diagnose` tool, so it tells users to manually enable debugging.
- LiteLLM gateway currently exists in `services/litellm-gateway`, routes `moe-demo` to Gemini via Vertex AI, and does not have Phoenix tracing configured.

## Questions for Review

1. Is the likely root cause the v1 browser plugin/MCP path being enabled by default instead of Outlook v2, or should the fix keep v1 but install/repair the browser plugin more reliably?
2. What exact app-side state machine should browser automation expose? Candidate states:
   - `cdp_ready`
   - `chrome_not_found`
   - `cdp_down_chrome_closed`
   - `profile_locked_close_chrome`
   - `outlook_login_required`
   - `outlook_ready`
   - `browser_plugin_unavailable`
3. Should Outlook v2 be default in pilot mode (`OUTLOOK_BROWSER_V2` default true when `PILOT_MODE`)?
4. Should Forms and Outlook share a new `chrome-cdp` service instead of duplicating attach logic?
5. What should the clean-slate test harness simulate locally without destructively uninstalling the actual laptop?
6. What Phoenix/LiteLLM integration is most practical for today’s release candidate?
7. What are the highest-risk regressions and the minimal targeted tests needed before shipping?

## Preferred Constraints

- Do not force-kill Chrome by default; principals may have unsaved work.
- Do not use Playwright-managed Chromium for Microsoft login; Conditional Access may block it.
- Keep provider/API keys off the user laptop where possible.
- Keep all Outlook sends/forms submits hard-confirm gated.
- Avoid broad rewrites today; demo release candidate is time-sensitive.

## Expected Output

Return a concrete ranked recommendation with implementation steps, risks, and tests. If you disagree with flipping Outlook v2 on by default, explain the safer alternative and the evidence required.
