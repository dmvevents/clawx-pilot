# skills/laptop — Windows pilot laptop knowledge pack

**Single-entry-point for anyone working on the pilot Windows laptop (`vyonix`, x64 Windows 11 24H2).** Everything below has been consolidated from the scattered `.claude/skills/`, `.claude/agents/`, `windows-pilot/scripts/`, and `docs/` trees so a future session doesn't repeat these lessons.

**Last consolidated:** 2026-07-31 · integration branch `integration/lane-a-plus-harness` @ `f1a7f3db`.

---

## 0. Read-order for a cold start

If a fresh Claude Code session opens on this project and needs to touch the laptop, read these THREE files first, in order:

1. **This INDEX.md** (you're here) — orientation, quick-answers, ladder of what to run.
2. **`docs/WINDOWS_PROBLEMS_ATLAS.md`** — 15 already-solved Windows bugs. Symptom → root cause → fix → detection agent. **DO NOT re-debug anything catalogued here.**
3. **`docs/PILOT_LAPTOP_ACCESS.md`** — SSH + file-transfer + emergency fallback.

Then, based on task:

| Task | Read | Then run |
|---|---|---|
| Install / re-install the app | `skills/windows-vm-smoke/SKILL.md` + `docs/WINDOWS_INSTALL_RUNBOOK.md` | `scripts/pilot-run-silent-install.ps1` |
| Post-install verify | `skills/windows-vm-smoke/SKILL.md` | `scripts/pilot-check-install-artifacts.ps1` |
| Gateway/Host-API smoke | `skills/windows-vm-smoke/SKILL.md` | `scripts/pilot-run-installed-gateway-smoke.ps1` |
| Outlook/Forms demo | `skills/windows-outlook-forms/SKILL.md` | `scripts/pilot-launch-and-run-cdp-smoke.ps1 -OutlookOnly` |
| Gateway crash / re-seed loop | `skills/windows-runtime-recovery/SKILL.md` + `docs/WINDOWS_PROBLEMS_ATLAS.md §2, §5, §12` | (agent) `gateway-recovery` |
| Chat says "thinking" forever | `skills/windows-runtime-recovery/SKILL.md` + atlas §13 | `scripts/pilot-probe-state.ps1` |
| Voice/ASR broken | atlas §14 | `scripts/pilot-office-runtime-check.ps1` |
| Set up Claude Code on laptop | `skills/claude-bedrock-windows/SKILL.md` + `docs/CLAUDE_CODE_BEDROCK_WINDOWS_RUNBOOK.md` | (agent) `claude-bedrock-installer` |
| GA release readiness | `skills/ga-release-readiness/SKILL.md` + `docs/GA_RELEASE_PLAN_2026-06-09.md` | (agent) `ga-release-conductor` |

---

## 1. Where the laptop is right now (2026-07-31)

| Fact | Value | Verified how |
|---|---|---|
| Alias | `home-pilot` (in `~/.ssh/config`) | `ssh home-pilot 'powershell -c "hostname"'` → `VYONIX` |
| IP | `192.168.1.212` (home Wi-Fi, Verizon g3100 subnet) | ARP + mDNS `VYONIX.local` |
| Hostname | `VYONIX`; user `vyonix\vyonix` | SSH probe |
| Arch | `AMD64` (Intel Core, Alder/Raptor Lake-class) — **x64 native, fleet parity** | `$env:PROCESSOR_ARCHITECTURE` |
| OS | Windows 11 Home 24H2 (`10.0.26200`) | `Win32_OperatingSystem.Version` |
| SSH | Open, `id_ed25519` accepted | `ssh home-pilot ...` returned 0 |
| Latency | ~4ms first-connect, ~50ms with control-master | ping + SSH round-trip |
| MoE install present | `%LOCALAPPDATA%\Programs\Ministry of Education\` from 2026-07-06 | `Get-Item ... FullName, LastWriteTime` |
| **Historical**: prior Cat-5 link-local IP | `169.254.46.90` (still in `~/.ssh/config` as `pilot`) | Preserved for on-site work |

**Two SSH aliases coexist:** `pilot` (Cat-5 link-local, on-site) and `home-pilot` (Wi-Fi, remote). Same user, same key. Both use `ControlMaster auto` + `ControlPersist 30m` — first call ~0.3s, subsequent ~50ms.

---

## 2. Hard rules (never break — real incidents behind each)

Learned the expensive way. All 12 apply to laptop work.

| Rule | Why |
|---|---|
| **Always `profile=user` for Chrome**, never managed Chromium | Conditional Access blocks managed Chromium on `@moe.gov.tt` (`AADSTS53003`). Only the principal's already-signed-in tab works. |
| **`send_email` needs TWO gates**: `confirm:true` AND open compose subject matches `args.subject` | Sending the wrong email from an MoE principal is real harm. Double gate has caught real mismatches. |
| **`download_attachment` same hard-confirm gate** | Same concern, different surface. |
| **No body content / recipients / passwords in logs.** Subject ≤120 chars, recipient counts only | Log files leave the laptop via tail-and-paste. |
| **No basic-auth, no token replay, no session hijack** for `*@moe.gov.tt` / `*@fac.edu.tt` | Microsoft revokes cookies in minutes via CAE; basic auth is disabled tenant-wide. |
| **`outlook` in `PRINCIPAL_SKILL_ALLOWLIST` is the kill-switch** | Single gate to disable email integration in prod if it misbehaves. |
| **English-only locales** — other locale JSONs are deleted | Trinidad-only product; localised strings drift. |
| **Anonymise model identity in UI**: "Online" / "On this device" only. No raw model IDs in chat | Principals shouldn't think about model selection. |
| **Hide cost in frontend**, log in backend | Same trust concern. |
| **Auto-update OFF in `PILOT_MODE`.** `publish: null` in electron-builder.yml | Pilot laptops go through MoE IT, not auto-update. |
| **Test creds local-only:** `test.fac@fac.edu.tt` uses `PILOT_TEST_PASSWORD`; never print or commit plaintext. **NEVER** for `*@moe.gov.tt` | Sacred boundary. |
| **Don't push to upstream `ValueCell-ai/ClawX` without confirmation.** Push to `dmvevents/clawx-pilot` (SSH) OK | We're a fork. |

**Also — protect user state on the laptop:**
- `~/.openclaw/`, `%APPDATA%\Ministry of Education\` are **SACRED**. Back up before mutation (runbook step 3).
- NSIS uninstaller is designed to preserve them; don't delete them manually.
- `chflags uchg` / immutable-file workarounds are **BANNED in production paths** (atlas §11).

---

## 3. Engineering invariants — the auditor pyramid

Four regression classes we hit repeatedly during moe.4→moe.10. Each has a dedicated auditor sub-agent under `agents/`.

| Invariant | Auditor | What it catches |
|---|---|---|
| **Four-store channel coherence** | `clawx-config-doctor` (write) + `config-coherence-auditor` (read-only) | `~/.openclaw/openclaw.json` (defaults + `agents.list[0]`), `~/.openclaw/agents/*/agent/models.json`, `clawx-providers.json`, and `localStorage preferredChannel` must ALL agree. Drift → silence on send. |
| **Dependency classification** | `dependency-class-auditor` | Any module imported synchronously by `electron/` or `extensions/` MUST be in `dependencies`, not `devDependencies`. electron-builder strips devDeps from asar. `playwright-core` in devDeps broke moe.9. |
| **DOM selector fallbacks** | `dom-selector-regression-tester` | Every Microsoft/Google/Apple DOM selector must be classified stable (role+aria) or rotated (CSS class, `data-automation-id`, aria-substring). Rotated selectors require 3+ fallback strategies. MS Forms editor died in <a week from `data-automation-id` rotation. |
| **Atomic + idempotent state writes** | `state-idempotency-auditor` | Every writer to `~/.openclaw/*.json` or `clawx-providers.json` must use temp-file + `rename()`, produce identical state on second call. Delegate to canonical `channel-config.ts::writeOpenClawConfig`. |

---

## 4. Windows Problems Atlas — 15 already-solved bugs

**Anything on this list you must NOT re-debug.** Full detail in `docs/WINDOWS_PROBLEMS_ATLAS.md`. Summary:

| # | Bug | One-line fix | Detection |
|---|---|---|---|
| 1 | `Cannot find module 'playwright-core'` (moe.9) | Move to `dependencies` | `dependency-class-auditor` |
| 2 | `google-query-key` enum reseed loop | Fix `channel-config` writer; atomic + idempotent | `state-idempotency-auditor` |
| 3 | Mac native binaries in Win asar (moe.8) | electron-builder `files:` scoped exclude | `production-readiness` |
| 4 | Auto-update YAML leak to `oss.intelli-spectrum.com` | `publish: null` in electron-builder.yml | `production-readiness` |
| 5 | Gateway unresponsive after launch | Kill orphaned gateway before re-launch | `gateway-recovery` |
| 6 | Handshake timeout on Windows | Increase `GATEWAY_HANDSHAKE_TIMEOUT_MS` for cold Win boot | (manual) |
| 7 | `vcruntime140.dll` missing | VC++ 2015-2022 x64 Redistributable prereq | Install runbook |
| 8 | `AADSTS53003` — Conditional Access | ALWAYS `profile=user`, never managed Chromium | Hard rule |
| 9 | MS Forms editor DOM rotation | Pivoted to response page (stable surface) + `dom-selector-regression-tester` | Auditor |
| 10 | Electron Session 0 (GHA runners) | Cannot fix — runner limitation; use VM/laptop instead | Documented |
| 11 | `EPERM` after `chflags uchg` | BANNED workaround; use atomic writes | `state-idempotency-auditor` |
| 12 | Multi-store config drift (Online vs On-device) | `clawx-config-doctor` transactional repair | Auditor |
| 13 | Chat "thinking" forever / Gemini 400 no-body | `google-query-key` = `google-generative-ai` (not `openai-completions`) | `gateway-recovery` |
| 14 | Whisper.exe not found on Win | Bundle `WinSpeechRecognize.exe` native helper + ffmpeg; check `resources/bin/` | `pilot-office-runtime-check.ps1` |
| 15 | Forms preview redirects to sign-in | Ride signed-in Chrome via `profile=user` CDP attach; never managed Chromium | Hard rule 1 |

---

## 5. Skills index (see `skills/` subdir for full text)

| Skill | Use when | Trigger keywords |
|---|---|---|
| `windows-vm-smoke` | Clean-install validation (VM or laptop) after installer build / RC / GA gate | "smoke", "vm", "install evidence", "post-install" |
| `windows-outlook-forms` | Outlook read/draft/reply/send OR Forms preview/submit on Windows | "outlook", "forms", "compose", "send email", "principal demo" |
| `windows-runtime-recovery` | Chat stuck thinking, gateway down, model call failed, Excel prompt stalls | "gateway", "thinking", "model call failed", "port 18789", "reseed" |
| `windows-build-package` | Build `.exe`, package via electron-builder, sign, prep runtime deps | "build:win", "electron-builder", "NSIS", "package:win" |
| `windows-demo-resume` | Resume the pilot laptop demo from cold, handoff between operators | "resume demo", "handoff", "next agent Windows" |
| `windows-github-dev` | Turn the laptop into a Git-clone-able dev target (WSL optional) | "github on windows", "clone repo on pilot" |
| `claude-bedrock-windows` | Install / verify Claude Code + Bedrock on the laptop | "claude on windows", "bedrock", "agent teams" |
| `pilot-ssh-ops` | Safe SSH + PowerShell quoting patterns; read-only probes | "ssh pilot", "powershell quoting", "safe probe" |
| `ga-e2e-regression` | Run the GA regression matrix after demo failure / before RC | "regression matrix", "e2e", "GA", "RC" |
| `ga-release-readiness` | Coordinate the whole GA path — plan, gates, docs, security | "release readiness", "GA gate", "ship" |

---

## 6. Agent index (see `agents/` subdir for full text)

| Agent | Use for | RW |
|---|---|---|
| `windows-smoke` | Windows post-install smoke runner — happy-path red/yellow/green | R |
| `windows-claude-session-manager` | Set up / verify Claude Code session control on Windows | RW (install only) |
| `windows-github-dev-installer` | Install Git/gh/Node/AWS CLI + clone ClawX on laptop | RW |
| `gateway-recovery` | Gateway crash-loop repair; plugin schema violations | RW |
| `clawx-config-doctor` | Four-store channel/model coherence repair | RW |
| `dependency-class-auditor` | Catch playwright-core-class devDep mistakes pre-ship | R |
| `dom-selector-regression-tester` | Flag rotated MS/Google selectors without fallbacks | R |
| `state-idempotency-auditor` | Catch `chflags uchg`-class atomicity gaps | R |
| `production-readiness` | Pre-release checklist walk | R |
| `ga-release-conductor` | Coordinate the whole GA readiness pass | R |
| `ga-e2e-regression-verifier` | Extend + verify the GA regression matrix | R |
| `skill-audit` | Detect skill-bundle drift | RW |

---

## 7. Scripts index (see `scripts/` subdir — 49 total)

**Read-only probes (safe to run any time):**
- `pilot-probe-state.ps1` — snapshot Ministry/Education processes, ports 18789/13210/18792, disk of `%APPDATA%\Ministry of Education\`, `~/.openclaw/`
- `pilot-check-install-artifacts.ps1` — verify `app.asar`, `playwright-core`, `ffmpeg.exe`, `WinSpeechRecognize.exe` all shipped
- `pilot-verify-outlook-tab.ps1` — probe Chrome CDP for a signed-in Outlook tab
- `pilot-window-process-probe.ps1` — process tree of Electron main + helpers
- `pilot-tail-gateway-log.ps1` — tail `%APPDATA%\Ministry of Education\logs\gateway.log`
- `pilot-probe-github-dev.ps1` / `pilot-probe-claude-bedrock.ps1` — verify dev-target install
- `pilot-probe-install-process.ps1` — check for stale MSIExec / installer processes
- `pilot-app-event-probe.ps1` — Windows Event Log for the app
- `pilot-office-runtime-check.ps1` — Excel/Word/PPT parser availability

**Install + launch (mutating — use with intent):**
- `pilot-run-silent-install.ps1` — NSIS `/S /log=<path>` silent install
- `pilot-fresh-install-environment.ps1` — clean-slate before install (backs up `~/.openclaw` first)
- `pilot-clean-temp-smoke-user.ps1` — remove temp smoke test-user artifacts
- `pilot-launch-and-run-cdp-smoke.ps1` — launch app, attach to Chrome CDP, run smoke (`-OutlookOnly` flag for scoped)
- `pilot-launch-and-watch-app.ps1` — launch + tail logs live
- `pilot-clean-slate-cdp-harness.ps1` — fresh CDP session for demo
- `pilot-install-demo-shortcuts.ps1` — desktop shortcuts for principal demo

**Configuration + credentials:**
- `pilot-configure-cloud-gateway.ps1` — write cloud-gateway.json
- `pilot-configure-cloud-gateway-from-gcloud.sh` — pull creds from gcloud (Mac side)
- `pilot-configure-winhttp-proxy.ps1` — corporate proxy config
- `pilot-copy-provider-from-user.ps1` — inherit provider settings from another user profile

**Chrome + browser probes (CDP):**
- `pilot-attach-chrome-cdp.ps1` — attach to signed-in Chrome on `:18792`
- `pilot-attach-chrome-cdp-demo.ps1` — demo-specific attach (verbose)
- `pilot-login-outlook-cdp.js` — Node CDP script: navigate to Outlook, verify sign-in
- `pilot-forms-cdp-inspect.js` — inspect Forms DOM for selector regressions
- `pilot-electron-cdp-probe.js` — Electron main-process CDP probe
- `pilot-managed-cdp-visual-smoke.ps1` — visual smoke via managed Chromium (fallback only; usually blocked by CA)

**Demo orchestration:**
- `pilot-run-demo-acceptance.ps1` — full demo acceptance run
- `pilot-run-chat-procedures.ps1` — chat-driven demo procedures
- `pilot-launch-form.ps1` — open a Form directly for demo
- `pilot-relaunch-app-outlook-v2.ps1` — restart app pinned to Outlook path
- `pilot-shell-launch-shortcut.ps1` — launch via Windows shortcut (as principal would)
- `pilot-seed-demo-documents.ps1` — pre-stage docs for demo

**Bedrock + Claude Code on laptop:**
- `pilot-install-claude-bedrock.ps1` — install Claude Code with Bedrock env
- `pilot-install-local-dev-tools.ps1` — Git + Node + gh CLI + AWS CLI
- `pilot-bootstrap-github-dev.ps1` — clone ClawX + set up ~/.aws + env
- `pilot-setup-claude-wsl-tmux.ps1` — WSL2 + tmux for session control
- `pilot-start-claude-chat-loop.ps1` — persistent claude-code chat process
- `pilot-enable-openssh.ps1` — enable OpenSSH Server (if not already)

**App-payload deployment:**
- `pilot-deploy-appasar-payload.ps1` — surgical asar patch without full reinstall
- `pilot-run-installed-gateway-smoke.ps1` — gateway smoke against installed runtime

**Post-run cleanup + evidence:**
- `pilot-stop-probe-processes.ps1` — halt probes cleanly
- `pilot-watch-tool-calls.ps1` — live tool-call trace
- `pilot-prod-email-probe.ps1` — hard-confirm-gated production email probe (danger zone)
- `pilot-run-electron-cdp-probe.ps1` — wrapper for the Node CDP probe
- `pilot-launch-cdp-task.ps1` — launch a specific CDP task
- `pilot-temp-user-fresh-install-smoke.ps1` — install as a fresh Windows user to prove clean-slate

**Mac side helpers:**
- `pilot-mac-wait-run-demo.sh` — Mac-side orchestrator; waits for laptop signal, kicks demo
- `install-pilot-watcher-launchd.sh` — install launchd watcher on Mac
- `pilot-create-sea-results-brief.py` — post-run brief generator

---

## 8. SSH + PowerShell — the safe patterns (from `pilot-ssh-ops`)

**Always single-quote the `powershell -c` argument.** Bash/zsh expand `$env:` and `$_.` differently; double-quoting eats them.

```bash
# SAFE
ssh home-pilot 'powershell -NoProfile -c "Get-Process | Where-Object { $_.ProcessName -match \"Ministry|Education\" } | Select Id, Name"'

# UNSAFE — shell eats $_.ProcessName before PowerShell sees it
ssh home-pilot "powershell -NoProfile -c \"Get-Process | Where { \$_.ProcessName -match 'Ministry' }\""
```

**Copy files:**
```bash
scp /path/to/installer.exe home-pilot:'C:\Users\vyonix\Downloads\'
```

**Run a repo script:**
```bash
scp windows-pilot/scripts/pilot-probe-state.ps1 home-pilot:'C:\Users\vyonix\Downloads\'
ssh home-pilot 'powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\vyonix\Downloads\pilot-probe-state.ps1'
```

**Backup user state before ANY install/reinstall:**
```powershell
# Run on the laptop:
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$bak = "$env:USERPROFILE\pilot-backup-$stamp"
New-Item -ItemType Directory -Force $bak | Out-Null
if (Test-Path "$env:USERPROFILE\.openclaw") { Copy-Item "$env:USERPROFILE\.openclaw" "$bak\openclaw" -Recurse -Force }
if (Test-Path "$env:APPDATA\Ministry of Education") { Copy-Item "$env:APPDATA\Ministry of Education" "$bak\appdata-moe" -Recurse -Force }
Write-Host "Backup at: $bak"
```

---

## 9. Current RC snapshot (from `docs/CURRENT_WINDOWS_RC.md`)

| Field | Value |
|---|---|
| **Fresh installer (2026-07-27)** | `Ministry.of.Education-0.4.3-moe.10-win-x64.exe` |
| SHA-256 | `f48c6d12f8cefa521b2da33db1eacf372ac707c397141fec38519d8ff1a8272d` |
| Source | Release `ci-harness-2026-07-27-lane-a-plus-harness` on `dmvevents/clawx-pilot` |
| Built from | `integration/lane-a-plus-harness` @ `e8bc2e7a` (Lane A HEAD + skill-bundler fixes + workflow scaffold) |
| Build workflow run | `30266938287` (8m19s, success) |
| 5-prompt harness run | `30267871406` (3m26s, **5/5 GREEN**, doc-tooling only) |
| **Previous RC (still on laptop)** | `moe10-windows-rc-20260623-outlook-green-b38b620` @ `b38b6208` |
| Previous SHA-256 | `a19a9c62eaacd958df772b432277dd220a38e61e5f0e69b449ee6b66ef00c6ee` |
| Verdict on previous RC | **YELLOW** — package proof + local Outlook proof; clean-install VM/laptop evidence pending |
| **Verdict on fresh** | **DOC-TOOLING GREEN, ALL OTHER GATES OPEN** — needs `home-pilot` smoke to close the interactive-session gap |

---

## 10. Ministry ICT working-session deliverables (2026-07-31 pending)

Per Raj's 2026-07-31 email, four items owed back:

| # | Item | Where the answer lives |
|---|---|---|
| 1 | Prod + dev/localhost redirect URIs | Dev URI: `http://localhost:18789/oauth/callback` (already in `/tmp/moe-entra-app-registration-request.md`). Prod URI: **DECISION PENDING** — desktop-app localhost loopback vs Ministry-hosted callback |
| 2 | 1-2 Foundry model options with tradeoffs | **BLOCKED** — Foundry does NOT host Claude (Bedrock/Vertex only). GPT-4o vs GPT-4o-mini is the shortlist if committing to Foundry; alt is "ask Ministry to accept Bedrock-in-tenant" |
| 3 | Datastore stack proposal | PostgreSQL (profiles) + Redis (session cache). Currently we persist to `~/.openclaw/openclaw.json` on device only — server-side store is a NEW component |
| 4 | Working-session slot | User's calendar — Anton to schedule |

---

## 11. What was NEVER done on this laptop for the current build

**Explicit inventory of open evidence gaps** as of 2026-07-31, so a future session can pick these up cleanly:

- ❌ Fresh (`ci-harness-2026-07-27-lane-a-plus-harness`) installer **NOT YET RUN** on `home-pilot`. Current install is from 2026-07-06.
- ❌ Gateway 18789 + Host API 13210 binding proof on x64 Windows for Lane A — **never verified**
- ❌ Outlook read/draft/reply/reply-all/forward/send **on the Lane A build** (was proven on moe.10, not since)
- ❌ Forms preview/submit no-submit-safety on Lane A
- ❌ ASR (`WinSpeechRecognize.exe` + ffmpeg + Whisper fallback) on Lane A
- ❌ Cloud Gateway path (Bedrock Sonnet 4.5 + Gemini) exercised from packaged runtime on Lane A
- ❌ On-device toggle (`hermes3:8b` or `qwen2.5:3b-instruct`) verified on Lane A
- ❌ Excel/Word/PPT via chat composer (not direct tool call) on Lane A
- ❌ `%APPDATA%` + `~/.openclaw` survival across app restart on Lane A

**All of these can be closed by:** scp'ing the fresh installer → running `pilot-run-silent-install.ps1` → the probe ladder in section 5.

---

## 12. Escalation — when this doc doesn't have the answer

1. Grep the full `docs/` tree, not just the copies here: `grep -rn "<symptom>" docs/`
2. Grep `.claude/agents/` for a specialized auditor: `ls .claude/agents/`
3. Check `windows-pilot/plans/` for prior handoff snapshots (`MOE_WINDOWS_GA_STATUS_*`, `MOE_WINDOWS_RC_*`)
4. If it's a truly-new bug: capture symptom verbatim, add to `docs/WINDOWS_PROBLEMS_ATLAS.md` per its own "How to extend" section, and consider spawning a new auditor sub-agent to prevent regression.

**Never delete `~/.openclaw` or `%APPDATA%\Ministry of Education\` to "fix" a bug.** That's user state; back it up first (section 8).

---

*Consolidated 2026-07-31 by Claude Code. Update this file when a new skill/agent/script lands or when the current-RC snapshot in section 9 rolls forward.*
