# Windows pilot — uninstall, reinstall, verify all features (demo plan, 2026-05-26)

**Mode:** read-only on code (active dev session in another window). This document is the plan; we execute later.
**Target:** pilot Windows 11, `vyonix@169.254.46.90`, SSH multiplexer ready.
**Demo machine of record:** Mac (moe.10 verified). Windows is parity / IT showcase.
**Model policy:** **cloud only** for the demo. No Ollama / no on-device. Gemini 2.5 Pro for text turns (Think mode), Bedrock Sonnet 4.5 for VLM grounding. The "On this device" pill is shown but not exercised.

---

## Dev cycle we now have

Cat-5 link is up. Real iteration loop, not one-shot:

```
edit on Mac → pnpm typecheck → CI build win-x64 → gh run download
            → scp to pilot   → silent uninstall (NSIS /S)
            → silent install  → tail logs → re-test
```

Wall-clock per cycle ≈ 8 min once .exe is in hand (CI build is the bottleneck at ~5 min). Plan to do **2–3 cycles max** before demo. Each cycle has a single-purpose hypothesis; if a cycle fails to confirm or refute it, fall back, don't dig.

---

## Demo critical path (the only three things that have to work on Windows)

1. **Email** — `outlook.read_inbox` → `outlook.reply` → `outlook.send_email` (hard-confirm gate)
2. **Forms** — extract from email body → `forms.preview_suspension` (DOM fill on test.fac) → `forms.submit_suspension` (DOM submit, **not** the API path — Bearer 401 still open)
3. **Cron reminder** — pre-recorded clip is the planned fallback; don't budget execution time

Anything beyond these three is post-demo.

---

## Phase-by-phase plan

Each phase has: action, stop condition, fallback. Stop conditions are hard — if missed, fall back, don't iterate.

### Phase 0 — Decisions before touching anything (5 min, no tool calls)

| Decision | Default | Confirm? |
|---|---|---|
| Demo on Mac if Windows slips | yes | confirmed |
| Skip Ollama / on-device entirely | yes | **confirmed in this thread** |
| Forms = DOM submit, not Bearer-API | yes | confirmed |
| Test account = `test.fac@fac.edu.tt` with local-only password | yes | hard-rule-ok |
| Cron reminder = pre-recorded fallback | yes | confirmed |
| Plan owns Phases 1–5 (SSH); user owns Phase 6 (laptop) | yes | needs confirmation |

If any "no", revisit before Phase 1.

### Phase 1 — Pull moe.10 .exe to Mac (3 min, Mac-side only)

```
gh run list --repo dmvevents/clawx-pilot --workflow package-win-manual.yml --limit 1
gh run download <id> --repo dmvevents/clawx-pilot --name windows-installer-x64 --dir /tmp/moe10
ls -lh /tmp/moe10/
```

Latest known good: run `26427466224`, HEAD `6ae18d8`, success at 2026-05-26T01:41:39Z.

**Stop condition:** `Ministry of Education-0.4.3-moe.10-win-x64.exe` lands in `/tmp/moe10/`, ≥230 MB.
**Fallback:** if artifact retention expired, run `pnpm build:win` locally on Mac (~6 min), output goes to `release/`.

### Phase 2 — Pilot pre-state + sacred-state backup (3 min, SSH)

Use `docs/WINDOWS_INSTALL_RUNBOOK.md` Steps 0–3 verbatim. Don't paraphrase the powershell — escaping is finicky and the runbook works.

- Step 0: `ssh pilot 'echo ok'`
- Step 1: pre-state survey (installed apps, ollama list — informational only since we're not using it, ports 18789/13210/18792)
- Step 2: kill any running `Ministry|Education|ClawX|openclaw` process
- Step 3: backup `%USERPROFILE%\.openclaw` to `.openclaw.bak.YYYYMMDD-HHMMSS`. Also backup `%APPDATA%\Ministry of Education` if present.

**Stop condition:** backup line prints `backed up to: ...` (or "no .openclaw to back up" on a fresh machine).
**Fallback:** if backup fails (permissions, disk), abort the entire reinstall — sacred-state rule. Investigate before proceeding.

### Phase 3 — Uninstall + transfer + reinstall (5 min, SSH)

Runbook Steps 4–7.

- Step 4: NSIS silent uninstall (`/S /CURRENTUSER`). Keeps user data by design — Phase 2 backup is belt-and-suspenders.
- Step 5: scp .exe from `/tmp/moe10/` to `vyonix@169.254.46.90:/Users/vyonix/Downloads/`
- Step 6: NSIS silent install. Expect `exit: 0`.
- Step 7: verify `%LOCALAPPDATA%\Programs\Ministry of Education\Ministry of Education.exe` exists + `resources\extensions\` contains `microsoft-graph` and `moe-principal-assistant`.

**Stop condition:** both extensions present, `Ministry of Education.exe` ≥240 MB.
**Fallbacks:**
- `exit: 1` from NSIS → `WINDOWS_PROBLEMS_ATLAS.md` § "vc_redist.x64.exe missing"
- Missing extension dirs → `WINDOWS_PROBLEMS_ATLAS.md` § "playwright-core devDep" (regression class — should not recur on moe.10, but check)

### Phase 4 — Cloud-only model config (3 min, SSH)

Skip Ollama entirely. Force `~/.openclaw/openclaw.json` to `google/gemini-2.5-pro` for `agents.list[*].model.primary` and `agents.defaults.model.primary`. This is the four-store-coherence rule; if any drift, the chat composer goes silent.

```
ssh pilot 'powershell -NoProfile -c "
$cfg = \"$env:USERPROFILE\.openclaw\openclaw.json\"
if (Test-Path $cfg) {
  $j = Get-Content $cfg -Raw | ConvertFrom-Json
  # ... force primary to google/gemini-2.5-pro across defaults + list
  $j | ConvertTo-Json -Depth 30 | Set-Content $cfg -Encoding UTF8
}
"'
```

(Exact powershell to be drafted at execution time. The pattern matches the Mac equivalent in `DEMO_RUNBOOK_2026-05-26.md` lines 100–111.)

If the four stores drift after launch, run the `clawx-config-doctor` sub-agent — it knows how to repair openclaw.json + agents/*/agent/models.json + clawx-providers.json + localStorage `preferredChannel` together.

**Stop condition:** `grep '"primary"' ~/.openclaw/openclaw.json` (or PS equivalent) shows `google/gemini-2.5-pro` in all locations.
**Fallback:** brain icon (Think mode) in chat forces Pro per-turn. Acceptable for live demo.

### Phase 5 — Launch + verify gateway (4 min, SSH)

Runbook Steps 9–11.

- Detached launch: `Start-Process -WindowStyle Hidden`. App must survive SSH session close.
- Wait 18–22s for gateway boot.
- Gateway WS handshake on 18789 → expect `HTTP/1.1 101 Switching Protocols`.
- Host-API on 13210 `/health` → expect `401` (auth gate wired).
- Tail `%APPDATA%\Ministry of Education\logs\clawx-*.log`. Look for:
  - `Gateway auto-start succeeded`
  - `Gateway ready fallback RPC router probe succeeded`

**Stop condition:** both ports listening + both log lines present.
**Fallbacks:**
- `Config validation failed.*Invalid option` → `gateway-recovery` sub-agent + `WINDOWS_PROBLEMS_ATLAS.md` § "google-query-key reseed"
- Gateway crashes immediately → `state-idempotency-auditor` sub-agent (catches re-seed loops)
- Both ports silent after 60s → kill, look at the log file directly, escalate

### Phase 6 — Email path on Windows (8 min, principal at the laptop)

This is the only step where SSH stops — the principal sits at the Windows laptop directly because Electron GUI doesn't render right via SSH.

1. Launch Chrome with the openclaw browser plugin (auto-attaches `--remote-debugging-port=18792`). If plugin doesn't start Chrome, fallback command:
   ```
   start chrome --remote-debugging-port=18792 --user-data-dir="%LOCALAPPDATA%\Google\Chrome\User Data"
   ```
   **Hard rule:** `profile=user` always. Never managed Chromium. AADSTS53003 is the failure to look for.
2. Sign into Outlook in that Chrome with `test.fac@fac.edu.tt` using the local operator-provided test password. Do not print or commit the password.
3. From Mac, verify the tab is visible:
   ```
   curl -s http://169.254.46.90:18792/json | python3 -c "import json,sys; [print(t.get('url')[:120]) for t in json.load(sys.stdin) if t.get('type')=='page']"
   ```
   Expect `outlook.cloud.microsoft/mail/inbox`.
4. In the Ministry of Education chat composer:
   - "Show me my 5 most recent emails" → `outlook.read_inbox`
   - "Draft a reply to the parent meeting email saying I'll be there at 4pm" → `outlook.reply` → compose pane opens
   - "Send it." → `outlook.send_email` with `confirm:true` + subject-match gate. **Both gates must fire.**

**Stop condition:** all 3 turns succeed; send completes; subject-match gate visible in logs.
**Fallbacks:**
- AADSTS53003 → wrong Chrome profile. Restart with the user-data-dir flag.
- Tool 404 → gateway plugin didn't load `moe-principal-assistant`. Tail logs, look for the plugin-init line. If absent, restart app.
- Send gate refuses with subject mismatch → re-issue draft (compose-pane subject got edited). Working as designed; demo it once on purpose.

### Phase 7 — Forms path on Windows (10 min, principal at the laptop)

Two distinct sub-steps. Don't conflate.

**7a. Sample Suspensions form on test.fac must exist.** Check `extensions/moe-principal-assistant/forms/suspensions-test-fac-url.txt`. If empty, follow `DEMO_RUNBOOK_2026-05-26.md` step 5 (manual form clone via forms.office.com `+ New Form` against the spec at `extensions/moe-principal-assistant/forms/suspensions-form-spec.md`). ~5 min one-time.

**7b. DOM fill + submit on Windows:**
1. Drop a suspension report email into the test.fac inbox 5 min before the demo (per `DEMO_RUNBOOK` pre-flight step 3).
2. Chat: "Read the suspension report email from this morning and fill out the Term 3 Suspensions form. Don't submit yet — let me review."
3. Expect tool sequence:
   - `outlook.search_inbox({subjectContains:"suspension"})`
   - `outlook.read_email({id})`
   - extraction → 32 fields (Pro handles compound; brain-icon if it falls back to Flash)
   - `forms.preview_suspension({payload})` → opens form in Chrome and DOM-fills 30/31+ fields
4. Eyeball the form. Confirm fields look right.
5. Chat: "Submit the form." → DOM submit. Forms shows "Thanks" page.

**Stop condition:** Forms "Thanks" page visible.
**Fallbacks:**
- Submit can't find the button → click "Next" once on the form page, retry "submit the form" (Forms paginates long forms).
- Bearer-API 401 path triggers instead of DOM → known issue. Force DOM by re-issuing the prompt; if the agent insists on API, defer to post-demo investigation.
- Field extraction returns <25 fields → brain icon, retry. The 401 investigation in `MSFORMS_API_FILL_PLAN.md` is post-demo work.

### Phase 8 — Demo dress rehearsal on Windows (5 min)

Run all three turns end-to-end with a stopwatch. Target: <90s for email path, <3 min for forms path. If either blows past 2x, fall back to Mac for live demo and use Windows as "look, it also runs natively here" with a screen-recording.

**Stop condition:** rehearsal time inside budget; no surprises.
**Fallback:** Mac is the demo. Windows becomes a 30-second showcase clip.

---

## Iteration loop (if anything in Phases 4–7 needs a code fix)

This is the dev cycle the user described. Triggered when a Windows-specific bug appears that's NOT in `WINDOWS_PROBLEMS_ATLAS.md`:

```
Mac: edit code → pnpm typecheck → pnpm exec tsx scripts/v2-chatbot-e2e.ts (Mac smoke, ~25s)
   → git commit + push to dmvevents/clawx-pilot main
   → CI builds .exe (~5 min, watch with `gh run watch`)
   → gh run download → scp → ssh pilot 'NSIS /S uninstall' → 'NSIS /S install'
   → ssh pilot 'tail logs' → re-test affected phase
```

Budget: **2 cycles** before demo. Cycle 3 = abort, demo on Mac.

Discipline:
- Each cycle hypothesis-driven (one fix per cycle).
- Cycle ends with PASS or FALLBACK, never "let me try one more thing".
- Add anything new to `WINDOWS_PROBLEMS_ATLAS.md` and commit before next cycle starts.

---

## What lives in which doc (so we don't re-write things)

| Need | Doc |
|---|---|
| Step-by-step Windows install commands | `docs/WINDOWS_INSTALL_RUNBOOK.md` |
| Known Windows bugs + fixes + commit refs | `docs/WINDOWS_PROBLEMS_ATLAS.md` |
| Demo script (what to type, what to expect) | `docs/DEMO_RUNBOOK_2026-05-26.md` |
| Form schema + clone instructions | `extensions/moe-principal-assistant/forms/suspensions-form-spec.md` |
| Bearer-API 401 investigation (post-demo) | `docs/MSFORMS_API_FILL_PLAN.md` |
| Hard rules + sub-agent roster | `CLAUDE.md` |
| **This plan** | `docs/WINDOWS_DEMO_PLAN_2026-05-26.md` |

If a step in this plan diverges from the runbook, the runbook wins — it's been tested, this plan is the orchestration on top.

---

## What we're explicitly NOT doing today

- **Ollama / on-device path.** Cloud only for the demo. The "On this device" pill is shown for trust messaging, not exercised.
- **Bearer-API forms submit.** DOM submit only. The 401 investigation continues in `MSFORMS_API_FILL_PLAN.md` post-demo.
- **Power Automate flow URL.** Blocked on IT (Raj). We're using the cloned test.fac form, not the real MoE form.
- **Entra app registration.** Blocked on IT. Outlook path = browser-rides, not Graph.
- **Cron reminder live.** Pre-recorded clip is the plan.
- **Letter / memo templates.** Empty `templates/` dir is post-demo.
- **MoE logo asset.** Placeholder is fine for tomorrow.
- **Pushing to upstream `ValueCell-ai/ClawX`.** All pushes go to `dmvevents/clawx-pilot` per CLAUDE.md hard rule.

---

## Open questions for the user before execution

1. **Phase ownership confirm:** is plan-author driving Phases 1–5 over SSH while user keeps coding, with handoff to user at Phase 6?
2. **Phase 7a status:** has the test.fac Suspensions form been cloned and URL saved? If not, does this plan own the manual clone or does the parallel session?
3. **Iteration budget confirm:** 2 cycles before demo, then abort to Mac. Acceptable?
4. **moe.11 cut?** If any cycle requires a code change, we'd cut moe.11 with the version-bump scripts. Or stay on moe.10 + force-build a `0.4.3-moe.10-hotfix` artifact. Preference?

---

*Author: Claude Code session 2026-05-26 10:06am AST. Source-of-truth lives in this file; revise here, not in chat.*
