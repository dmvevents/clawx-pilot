# Windows Deployment Plan — moe.5 + Beyond

## Context

The Mac dev environment now has the full agentic-Outlook stack working
end-to-end against the test.fac@fac.edu.tt account:

- v2 OutlookActions with 11 actions (open, read_inbox, search_inbox,
  read_email, draft, send, reply, forward, mark_read, list_attachments,
  download_attachment-tbd)
- Bedrock Sonnet 4.5 for VLM grounding when semantic locators miss
- Plugin (`moe-principal-assistant`) registers all tools with the
  agent via `api.pluginConfig` and a host-API HTTP facade
- 14/14 eval rows pass on a populated inbox (1 skipped on empty-inbox)
- Live-tested: open in 41ms, draft in 2.1s, send-protection refuses
  without confirmation, parser returns clean sender/subject

Current commit stack is 13 commits ahead of origin. The unblocked
agentic workflow now needs to ship to Windows.

## Current Windows Deployment Reality

| | State |
|---|---|
| Last installed build on pilot | moe.2 — has the config-clobber bug, no v2, no Phase 1-5 fixes |
| Cat-5 link to pilot | Down (last working: yesterday) |
| Pilot SSH access | Yes when Cat-5 up |
| Pilot internet access | None today |
| Pilot Chrome session | Whatever VYONIX last had open |
| Pilot Chrome remote-debugging-port | Not enabled |
| Pilot Bedrock auth | No AWS_PROFILE configured |
| Pilot Anthropic / Gemini env vars | Unknown — likely none |
| Pilot Ollama | Installed, qwen2.5:3b-instruct pulled |

## What Needs to Land in moe.5 for Windows

### Code (already in main, just needs a fresh build)

All 13 commits since moe.4 must ship:
- e117648  v2 live-verified (Gemini grounder + dialog + dev scripts)
- b05dd45  plugin wired to v2 via host-API
- 721eaed  Bedrock Sonnet 4.5 VLM
- 0e54a81  parser fix (no concatenated sender/subject)
- f67a875  7 new agent tools
- 6f4abee  eval harness
- ef9801c  apiProtocol → runtime api mapping (this fix is critical;
            without it the gateway crash-loops)

### New work required for Windows specifically

| # | What | Why |
|---|---|---|
| W1 | **Bundle Bedrock SDK** | @aws-sdk/client-bedrock-runtime is a runtime dep; must be in `extraResources` openclaw bundle for Windows so the spawned gateway can load it |
| W2 | **AWS credential resolution on Windows** | Mac uses `AWS_PROFILE=bedrock` from shell. Windows installs need either: (a) embedded credentials per-pilot (not great), (b) "use Anthropic API direct via env var" path (simpler), or (c) Gemini fallback default for unauth'd installs |
| W3 | **Decide VLM provider for Windows** | If pilots can't reach AWS, Bedrock fails. Three options below |
| W4 | **Chrome remote-debugging-port pattern** | Pilot's Chrome isn't launched with `--remote-debugging-port=18792`. The v2 driver falls back to `launchPersistentContext` which collides with already-running Chrome. Need a startup script or Chrome shortcut that wraps it |
| W5 | **Sign-in flow on first run** | Principal must sign into Outlook in the debug-port-enabled Chrome window once. UI/onboarding cue needed |
| W6 | **CLAWX_HOST_API_TOKEN env propagation** | Already done in code (commit b05dd45). Windows-specific verification: ensure forkEnv reaches the spawned openclaw.exe gateway under `electron-builder`'s NSIS install layout |
| W7 | **Skill allowlist verification** | `outlook` must be in PRINCIPAL_SKILL_ALLOWLIST in shared/feature-flags.ts (it is). Windows pilot inherits this from the build |
| W8 | **First-run skill installation** | Bundled extensions (microsoft-graph, moe-principal-assistant) are now included in installer (commit d562477). Verify they install to the right path on Windows: `<install>/resources/extensions/<name>/` |
| W9 | **Smoke test runbook for Windows** | Translation of `scripts/v2-eval.ts` into a Windows-runnable test that doesn't require pnpm dev |

### Decision: VLM provider on Windows pilots

| Option | Pros | Cons | Recommendation |
|---|---|---|---|
| **A. Bedrock Sonnet 4.5 with embedded creds** | Best grounding accuracy | Each pilot needs AWS creds; embedding them means rotating becomes a redeploy | NO |
| **B. Direct Anthropic API with GoogleGenerative key fallback** | Single env var per pilot; rotation via env | Cost-per-call; needs ANTHROPIC_API_KEY on each pilot | Maybe |
| **C. Gemini 2.5 Flash via $GEMINI_API_KEY** | Already proven; cheaper; Google has free tier | Slightly less accurate than Sonnet on hard UI cases | **Recommended for v1** |
| **D. Hybrid: Gemini default, Bedrock when AWS_PROFILE set** | Dev box gets Sonnet, pilots get Gemini, no per-pilot config | Two code paths | **Final answer** |

Option D is what's already in the code (commit 721eaed). On Windows we
flip the default by setting `CLAWX_VLM_PROVIDER=gemini` in the gateway
spawn env when AWS_PROFILE is empty. Two-line change in
config-sync.ts.

### Decision: VLM credential delivery to pilots

The Gemini key is the only credential the pilot needs (besides
ANTHROPIC_API_KEY for chat, which is already wired). Two options:

1. **Bake into installer** — encrypt at build, decrypt on first run.
   Convenient but key rotation = redeploy.
2. **Onboarding flow asks for it** — first-launch prompt: "Paste your
   ministry-issued Gemini key". Adds a step but works for rotation.

Recommended: **option 2** — pilot Onboarding gets a "Cloud AI Key"
field. Encrypted in `clawx-providers.json` like other API keys.

## Phased Plan

### Phase A — Pre-Windows checks (Mac)

- [ ] Confirm 14/14 eval still passes (re-run with populated test inbox)
- [ ] Confirm typecheck + 831/831 tests
- [ ] Bump `package.json` to `0.4.3-moe.5`
- [ ] Update WINDOWS_DEPLOY.md with the new test-account flow

### Phase B — Windows-specific code

1. **VLM provider auto-select** based on AWS_PROFILE presence
   (electron/gateway/config-sync.ts)
2. **Onboarding prompt** for `GEMINI_API_KEY` if missing on first launch
3. **Chrome launcher wrapper script** — bundled `.bat` that launches
   Chrome with the right debug port + user data dir, with a clear
   "this opens Outlook for ClawX" UX
4. **Pilot smoke test** — Windows-runnable equivalent of v2-eval.ts that
   uses bundled `node_modules/.bin/tsx`

### Phase C — Build

- [ ] `pnpm build:win` for moe.5 (~5 min, reproducible)
- [ ] SHA256 + sign reminder (NSIS unsigned, expect SmartScreen)
- [ ] Optional: build mac-arm64.dmg in parallel for the pilot owner's
  own laptop testing

### Phase D — Deploy

When Cat-5 link is up:

1. SSH `vyonix@169.254.46.90`, kill running app
2. Wipe `%APPDATA%\Ministry of Education\` (preserves `~\.openclaw\` —
   the new uninstaller in moe.4 already does this; for in-place we do
   it manually first)
3. SCP `release/Ministry of Education-0.4.3-moe.5-win-x64.exe`
4. `Start-Process /S` install
5. Verify shortcut name = "Ministry of Education" (commit 5a7bc72)
6. First launch:
   - Onboarding prompt: paste Gemini key → encrypted store
   - Onboarding prompt: "Open Outlook in the ClawX-managed Chrome
     window" (with launcher button)
   - Sign in to test account
7. Run pilot smoke test — confirm 4/15 eval rows pass on empty inbox,
   14/15 on populated

### Phase E — Live agent test on Windows

After install + sign-in:

1. Open chat composer
2. Type: "show me my inbox"
3. Watch agent call `outlook.read_inbox`, return rows
4. Type: "draft an email to me saying hello"
5. Watch agent call `outlook.draft_email`, see compose pane open in
   pilot Chrome
6. Decline send (verify confirm gate)
7. Document any drift between Mac eval and Windows live behaviour

## Risks

| Risk | Mitigation |
|---|---|
| Outlook UI on Windows Edge differs from Mac Chrome (Microsoft tests against Edge first) | Force Chrome at the launcher level; Edge is not part of the contract |
| Bedrock SDK adds 50+ MB to bundle | Already in `dependencies`; tree-shaking should keep it lazy. If size becomes a problem, fall back to Gemini-only build |
| Pilot has no internet → Gemini calls fail | Cache last-good ground results aggressively; surface "offline mode" which makes draft/send work but search degrades |
| Microsoft auth token expires every ~30 days on the pilot Chrome session | Surface needs_signin clearly; principal re-signs in the Chrome window. No password storage needed |
| Conditional Access / managed Chromium block | profile=user (system Chrome) is a hard rule. Already enforced in playwright-driver.ts |
| Pilot owner closes the ClawX-launched Chrome window | Driver's CDP attach falls back to launchPersistentContext (with the user data dir). Document the recovery |

## Acceptance for moe.5 Windows release

Re-using the W*-rows from /tmp/outlook-acceptance.md. Pilot install is
"done" when:

- [ ] Gateway port 18789 listens within 30s of launch
- [ ] Plugin registers `outlook.*` tools (10 of them)
- [ ] Eval harness passes 14/15 (W7.1 may skip on small inbox)
- [ ] Chat composer can drive draft → review → send-with-confirm
- [ ] No `Config validation failed` in pilot logs
- [ ] Auto-update is OFF (PILOT_MODE = true; commit d562477)
- [ ] Uninstaller removes the right paths (commit d562477)

## Ownership / Sequencing

This whole plan is achievable in one Mac → Windows session of ~3-4 hours
once Cat-5 is back up. Suggested order: complete Phase A + B before
re-establishing Cat-5; build moe.5 on Mac; then deploy + test. If
anything fails on Windows, iterate on Mac and rebuild.
