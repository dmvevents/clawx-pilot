# Windows problems atlas (moe.1 → moe.10)

Every Windows-specific bug we hit during the moe.1→moe.10 build sequence, with **symptom**, **root cause**, **fix**, and **commit reference**. Use this as a lookup when something breaks; do NOT re-debug from scratch.

---

## §1. `Cannot find module 'playwright-core'` (moe.9)

**Symptom:** App launches as PID, stays alive, **0 bytes stdout/stderr**, no userData created, no helpers spawned, no ports open. SSH `ps` shows the process but no UI.

**Root cause:** `playwright-core` was in `devDependencies`. electron-builder strips devDeps from the asar when packaging. The outlook-browser-v2 services `require('playwright-core')` at module-load time, so the main process crashes silently during `dist-electron/main/index.js` evaluation BEFORE it can write a log file.

**Fix:** Move `playwright-core` to `dependencies` in `package.json`. Bumped to moe.10. Added a comment in package.json so this regression doesn't reappear:
```json
"//runtime-deps-note": "playwright-core is a runtime dep (used by electron/services/outlook-browser-v2/playwright-driver.ts). Do not move back to devDependencies — electron-builder strips devDeps when packaging, breaking the moe.X build with 'Cannot find module playwright-core'."
```

**Commit:** `e26a702` (fix(packaging): playwright-core must be a runtime dep, not devDep).

**Detection:** `dependency-class-auditor` sub-agent. Runs before any `package:win`. Flags any `require()` at top-level of `electron/**` against a module in devDependencies.

---

## §2. `google-query-key` enum reseed loop (moe.4 → moe.10)

**Symptom:** Gateway crashes on boot with `Config validation failed: models.providers.google.api: Invalid option: expected one of "openai-completions"|"openai-responses"|...|"google-generative-ai"|"ollama"|...`

**Root cause:** ClawX's auth-protocol field used `google-query-key`. Upstream OpenClaw renamed the runtime API enum to `google-generative-ai`. Multiple writers in the codebase mutate `~/.openclaw/openclaw.json` without going through the canonical normaliser, so even after we patched it, restarts re-seeded the bad value. We band-aided with `chflags uchg` (Mac) but Win has no equivalent and the issue surfaced on every restart.

**Fix:** `electron/services/providers/provider-runtime-sync.ts::normalizeRuntimeApi()` — applied at ALL writer sites. Plus a one-shot migration in `seedGatewayPluginConfig` that walks an existing config on boot.

**Commit:** `21bce2b` (fix(provider-sync): apply apiProtocol→runtime api normaliser at all writers), `ef9801c` (fix: map auth-protocol → runtime api enum).

**Detection:** `state-idempotency-auditor` sub-agent. Plus the `windows-smoke.yml` regex check `badEnumHit` flags it in build artefacts.

**Never:** Use `chflags uchg` (Mac) or `attrib +R` (Win) as a workaround. That hides the bug and causes EPERM cascades when other writers race.

---

## §3. Mac native binaries leaking into Windows bundle (moe.8)

**Symptom:** Win installer was 350 MB → ought to be 283 MB. Static analysis showed `@napi-rs/canvas-darwin-arm64` and `@mariozechner/clipboard-darwin-*` in the asar.unpacked tree on a Win build.

**Root cause:** The `cleanupNativePlatformPackages` after-pack hook only walked `resources/openclaw/node_modules`. It missed `resources/app.asar.unpacked/node_modules` and `resources/openclaw/dist/extensions/*/node_modules`.

**Fix:** Extended the hook to walk all three trees.

**Commit:** `7040b24` (fix(packaging): cleanup native binaries across asar.unpacked + extension trees).

---

## §4. Auto-update YAML leak (moe.7 → moe.8)

**Symptom:** Pilot install would auto-update from upstream `oss.intelli-spectrum.com` (Chinese CDN, unrelated to MoE) the moment the laptop got internet.

**Root cause:** electron-builder generates `app-update.yml` by default. Even with `ENABLE_AUTO_UPDATE=0` env at runtime, the YAML's mere presence + a `latest.yml` on the publish endpoint = silent download.

**Fix:** `publish: null` in `electron-builder.yml`. Suppresses YAML generation entirely. Verified by `windows-smoke.yml` — checks `!Test-Path "$installDir\resources\app-update.yml"`.

**Commit:** `b1d2b8a` (fix(packaging): publish: null to suppress electron-builder auto-update.yml).

---

## §5. Gateway unresponsive after launch (pre-moe.1)

**Symptom:** Gateway WS port opens but every RPC times out. App's chat composer accepts a message but never streams a reply.

**Root cause:** Windows symlink restrictions. The gateway preserves a junction tree under `%APPDATA%\Ministry of Education\openclaw` for skill files; on Win it tried `mklink /D` (requires admin), failed silently, and the gateway hung on first read.

**Fix:** Fall back to NTFS junction (`mklink /J`) when symlink fails. Then test that with junctions, the watchers still fire correctly.

**Commit:** `8cf30ab` (fix(gateway): fall back to junction when symlink unavailable on Windows).

---

## §6. Handshake/challenge timeouts on Windows (pre-moe.1)

**Symptom:** Mac gateway hands off in 800ms; Win gateway times out at 5s on first launch.

**Root cause:** Windows AV (Defender + tenant-pushed CrowdStrike on the pilot) inspects every spawned exe. Adds 3-4s on cold-start to the python-bundled gateway and the helper Node processes.

**Fix:** Widen the gateway-ready timeout from 5s to 30s on `win32` only. Plus a "first-RPC ready inference" — if any RPC succeeds, gateway is implicitly ready.

**Commit:** `ffdd04e` (fix(gateway): widen handshake/challenge timeouts on Windows), `6ea8e9c` (test coverage).

---

## §7. Visual C++ Redistributable missing

**Symptom:** Install exits 1, error in log: `The application failed to start because vcruntime140.dll was not found.`

**Root cause:** Some bundled native modules require MSVC 2019/2022 runtime. Fresh Windows installs (especially Win 11 Home/Pro Education images) don't always have it.

**Fix:** Settings Doctor checks for it and points to the MS download. Pilot pre-flight: install `vc_redist.x64.exe` from `https://aka.ms/vs/17/release/vc_redist.x64.exe` (small, < 25 MB).

**Commit:** `8ae0364` (docs), `6581a9a` (feat(doctor): add Windows MSVC runtime check to Settings Doctor).

---

## §8. Conditional Access blocks managed Chromium

**Symptom:** Browser plugin tries to open `outlook.office.com`, gets redirected to login, hangs at `AADSTS53003: Access has been blocked by Conditional Access policies`.

**Root cause:** `@moe.gov.tt` and `@fac.edu.tt` tenants both have Conditional Access policies that require the device to be Intune-enrolled OR run a "real" browser (not Playwright's bundled Chromium).

**Fix (HARD RULE):** **Never** launch managed Chromium for Outlook/Forms. Always attach via CDP to the user's existing Chrome (`profile=user`, `--remote-debugging-port=18792`).

**Commit / memory:** documented at `~/.claude/projects/-Users-antonalexander-Github-moe-tt-ClawX/memory/feedback_browser_existing_session.md`.

**Detection:** `dom-selector-regression-tester` flags any new code that calls `chromium.launch()` instead of `chromium.connectOverCDP()`.

---

## §9. Forms editor DOM rotation (moe.5)

**Symptom:** A clone-form-from-schema script worked one day, broke the next with no code change.

**Root cause:** Microsoft Forms' editor (`Pages/DesignPageV2.aspx`) wraps content in a same-origin iframe with rotating CSS class names. `data-automation-id` values are present in one render and absent the next.

**Fix:** Don't automate the editor. Automate the **response page** (`Pages/ResponsePage.aspx`), which is much more stable. For form CREATE we use the internal `/formapi/api/.../questions` endpoint directly.

**Detection:** `dom-selector-regression-tester` requires 3+ fallback strategies for any vendor-rotated selector.

---

## §10. Electron Session 0 (GitHub Actions runners)

**Symptom:** CI runs build + install + launch a Win Electron app. Process stays alive but produces 0 bytes of output, no userData, no ports.

**Root cause:** GitHub-hosted `windows-latest` runners run in Session 0 (non-interactive desktop). GUI Electron's Chromium subsystem cannot complete initialization without a display device.

**Fix:** Don't try to verify GUI runtime on CI. Build + install + static checks in CI, runtime verification on the pilot or a real Win VM.

**Commit:** `95c95fb` (ci(windows): downgrade headless probes to warnings).

---

## §11. EPERM after `chflags uchg`

**Symptom (Mac, ported here as warning for Win):** Multiple writers race to `~/.openclaw/openclaw.json`; one of them locks the file with `chflags uchg`; subsequent writers get EPERM.

**Root cause:** Lock-file workarounds at the OS level mask the real bug (non-idempotent state writers).

**Fix:** Make every writer go through `channel-config.ts::writeOpenClawConfig` which is atomic + idempotent. NEVER lock the file.

**Detection:** `state-idempotency-auditor` sub-agent flags any direct `fs.writeFile` to openclaw.json that doesn't delegate to the canonical writer.

---

## §12. Multiple-store config drift (Online vs On-device)

**Symptom:** User flips the Online/On-device toggle in Settings. UI shows the new channel; gateway keeps using the old one.

**Root cause:** "Current model" lives in 4+ stores: `~/.openclaw/openclaw.json`, `~/.openclaw/agents/main/agent/models.json`, `clawx-providers.json` (electron-store), `clawx-settings` localStorage. Writers don't fan out atomically.

**Fix:** Channel-router transaction in `electron/services/providers/channel-router.ts::applyChannelChange()` — single API entry point that fans out to all 4 stores, then verifies coherence.

**Detection:** `config-coherence-auditor` sub-agent walks all 4 stores before/after change; reports drift.

---

## §13. Gemini shows "thinking" or model call failed after Windows deploy

**Symptom:** The Windows app opens, Gateway is live, and the UI shows Google/Gemini, but chat either sits at "thinking" or the transcript records `LLM request failed: network connection error`. A second failure mode after network recovery is a Gemini `400 status code (no body)` while `models.providers.google.api` is still `openai-completions`.

**Root cause:** There are two distinct causes that look similar in the UI:

- Wi-Fi disabled or no route to `generativelanguage.googleapis.com:443`. The runtime has a valid Gemini key/model but cannot reach Google.
- Stale explicit `~/.openclaw/openclaw.json.models.providers.google` config left over from older writer paths. Google is a built-in OpenClaw provider; retaining an explicit OpenAI-compatible override can route Gemini through the wrong runtime API even when `agents.defaults.model.primary` says `google/gemini-2.5-pro`.

**Fix:** First verify network (`Test-NetConnection generativelanguage.googleapis.com -Port 443`). Then let channel preflight re-run the four-store transaction. The app now treats built-in providers with only a legacy `apiProtocol` as built-in defaults, so `setOpenClawDefaultModel('google', 'google/gemini-2.5-pro')` removes stale `models.providers.google` entries instead of preserving the bad override.

**Detection:** Probe both the direct Gemini endpoint and the exact app-facing Gateway RPC. A passing Windows check is: direct Gemini endpoint returns HTTP 200, raw Gateway `chat.send` returns `status:"started"`, and the session transcript records `api:"google-generative-ai"`, `provider:"google"`, `model:"gemini-2.5-pro"`, with assistant text such as `OK`.

**Never:** Do not judge key presence from a config UI alone. Host/Gateway config surfaces may be redacted or split across `%APPDATA%\Ministry of Education\clawx-providers.json`, OS keychain, and `~\.openclaw\openclaw.json`. Confirm with sanitized key-presence checks and a real Gateway `chat.send`.

---

## How to extend this atlas

When you hit a new Windows-specific issue:
1. Capture symptom **verbatim** (paste error, exit code, missing-file path, etc.)
2. Find root cause (do NOT just band-aid). Look for the writer/reader divergence pattern, not the immediate file change.
3. Add a §N entry here with the four sections.
4. Add detection to the matching auditor sub-agent (see `.claude/agents/`).
5. Commit with `docs(windows): atlas §N — <symptom>`.

**Why every entry has a "detection" line:** that's the regression-class hardening. We're not just fixing instances; we're closing classes.
