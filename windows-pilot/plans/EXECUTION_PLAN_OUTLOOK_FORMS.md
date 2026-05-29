# Execution plan — end-to-end Outlook + Forms on Windows pilot (2026-05-26)

**Single goal:** Prove that on the pilot Windows laptop the Ministry of Education app can: read inbox, draft a reply, send (with hard-confirm gate), extract suspension data from an email, fill the test.fac Suspensions form, and submit it.

**Demo time:** today (2026-05-26).
**Mode while writing this plan:** read-only on app code; the dev session in another window owns app-side changes.

---

## Confirmed pilot state (T-now, 2026-05-26 ~11:38am AST)

| Dimension | State | Source |
|---|---|---|
| App installed | Ministry of Education v0.4.3-moe.10 at `%LOCALAPPDATA%\Programs\Ministry of Education\` | `pilot-probe-state.ps1` |
| App running | Yes (5 procs, main PID 16228) | live probe |
| Gateway 18789 | UP, PID 16228 | `Get-NetTCPConnection` |
| Host-API 13210 | UP, PID 12968 | `Get-NetTCPConnection` |
| Ollama 11434 | UP (irrelevant — cloud only) | `Get-NetTCPConnection` |
| Chrome procs | 12 | `Get-CimInstance Win32_Process` |
| **Chrome CDP 18792** | **DOWN** — no proc has `--remote-debugging-port` | `Win32_Process.CommandLine` scan |
| `~/.openclaw/openclaw.json` | model.primary = `google/gemini-2.5-pro` ✓; agents.list empty (inherits defaults) | direct read |
| `moe-principal-assistant` | enabled ✓ | openclaw.json |
| `microsoft-graph` | disabled (expected — Entra packet pending Raj) | openclaw.json |
| Test.fac form URL | Present at `extensions/.../suspensions-test-fac-url.txt` | local file |
| Suspensions schema | 32 fields, VLM-extracted | local file |
| User on pilot | Active in another SSH session, app development in flight | user statement |
| **Symptom user reports** | "model call failed" in chat composer | user statement |

## What the "model call failed" likely is

Three candidates, ranked by likelihood:

1. **Stale Google provider override in `models.providers.google`** — commit `ec88a2f` ("Keep Windows Gemini on the built-in runtime path") explicitly addresses this: when Wi-Fi recovers after a drop, stale explicit provider entries put Gemini on the wrong runtime path and produce 400/no-body. The fix path: built-in providers should resolve via OpenClaw's runtime, not an `openai-completions` override.
2. **Network reachability** to `generativelanguage.googleapis.com:443`. Test with `Test-NetConnection`. If pilot was on a flaky link (likely — Cat-5 link-local), TLS may have stalled.
3. **Four-store config drift** post-update. Less likely since `agents.defaults` reads cleanly and shows Pro, but worth running `clawx-config-doctor` if 1+2 don't explain it.

The dev session is currently working this. **My plan does NOT block on this fix.** Outlook + Forms verification continues in parallel; once the dev session declares model-call green, we reconvene for the live demo.

---

## Phase plan

Each phase has: **action**, **stop condition**, **fallback**, **owner**. Don't iterate inside a phase — fall back instead.

### Phase 0 — Mac-side preparation (5 min, plan-author owns)

**Action:** transfer all `windows-pilot/scripts/*.ps1` to the pilot user home so they're invokable.

```bash
cd /Users/antonalexander/Github/moe-tt/ClawX
scp -q windows-pilot/scripts/*.ps1 pilot:/Users/vyonix/
ssh pilot 'powershell -NoProfile -c "Get-ChildItem $env:USERPROFILE\pilot-*.ps1, $env:USERPROFILE\probe-*.ps1 | Select Name,Length"'
```

**Stop condition:** all 5 scripts visible on pilot.
**Fallback:** if scp blocked, paste the script contents inline via a HEREDOC.

### Phase 1 — Read-only audit (3 min, plan-author owns)

**Action:**

```bash
ssh pilot 'powershell -NoProfile -ExecutionPolicy Bypass -File C:/Users/vyonix/pilot-probe-state.ps1'
```

Capture the `STATE:` line at the bottom. Expected: `INSTALLED | GATEWAY_UP | API_UP | CDP_DOWN`.

**Stop condition:** state matches expectation OR a clear deviation is reported (e.g., `GATEWAY_DOWN` would mean app crashed).
**Fallback:** `GATEWAY_DOWN` → tell the dev session; don't restart the app yourself.

### Phase 2 — Chrome CDP attach (5 min, plan-author drives, human approves the launch)

**Action:**

The user reported they have an active SSH session and Chrome is open. We need `--remote-debugging-port=18792` on the principal's Chrome without losing their open tabs.

Decision tree:
- If the human can close Chrome cleanly and reopen with the flag → cleanest. Run:
  ```bash
  ssh pilot 'powershell -NoProfile -ExecutionPolicy Bypass -File C:/Users/vyonix/pilot-attach-chrome-cdp.ps1'
  ```
  Script will detect existing Chrome → exit 20 (`STATE: PROFILE_LOCKED`) → tell the human.
- After human closes Chrome:
  ```bash
  ssh pilot 'powershell -NoProfile -ExecutionPolicy Bypass -File C:/Users/vyonix/pilot-attach-chrome-cdp.ps1'
  ```
  Should print `STATE: CDP_UP` after ~3-5s.

**Alternative (lossless):** if the human wants to preserve their open tabs, they can launch Chrome with the flag BEFORE closing the existing one — Chromium will refuse (profile locked), but the human can use `--user-data-dir=$env:LOCALAPPDATA\Google\Chrome\Demo Data` for a separate test profile. Sign into test.fac there. **Demo can run from a separate profile.** This avoids the close-Chrome friction entirely.

**Stop condition:** `pilot-verify-outlook-tab.ps1` reports `STATE: OUTLOOK_READY`.
**Fallback:** if profile-locked AND human can't close, switch to demo-profile alternative above.

### Phase 3 — Sign-in verification (2 min, human at the laptop)

**Action:** human navigates the CDP-attached Chrome to `https://outlook.office.com`, signs in as `test.fac@fac.edu.tt` using the local operator-provided test password. Then:

```bash
ssh pilot 'powershell -NoProfile -ExecutionPolicy Bypass -File C:/Users/vyonix/pilot-verify-outlook-tab.ps1'
```

**Stop condition:** `OUTLOOK_TAB_FOUND: yes` + `SIGNED_IN: yes` + `STATE: OUTLOOK_READY`.
**Fallback:** `AADSTS53003` → wrong profile (managed). Switch to a personal Chrome profile.

### Phase 4 — Wait for "model call failed" resolution (variable, dev session owns)

**Action:** none from this plan. Wait for the dev session to confirm model-call is green.

While waiting:
- Re-read `windows-pilot/skills/outlook-email-windows.md` (the demo-turn texts)
- Re-read `windows-pilot/skills/forms-suspension-fill.md` (extract → preview → submit pattern)
- Verify the test.fac inbox has the 3 demo emails (parent-meeting, suspension-report, MoE circular). If not, the human sends them now.

**Stop condition:** dev session says "model is back" OR the chat composer in the app responds successfully to a trivial prompt.
**Fallback:** if model-call is still failing 30 min before demo time, escalate to "demo on Mac" path.

### Phase 5 — Outlook acceptance smoke (10 min, human types, plan-author tails logs)

**Action:** human types each of the 10 acceptance smoke prompts into the chat composer (see `outlook-email-windows.md` § "Acceptance smoke"). Plan-author runs:

```bash
ssh pilot 'powershell -NoProfile -ExecutionPolicy Bypass -File C:/Users/vyonix/pilot-tail-gateway-log.ps1' -Lines 200 -Filter "outlook|moe-principal"
```

For each tool, expect a log line within 10s of the prompt. Subjects truncated ≤120 chars in logs.

**Stop condition:** 10/10 pass.
**Fallback:**
- 1-2 failures: WARN, demo proceeds. Note in risk register.
- 3+ failures: NO-GO on Outlook. Escalate.
- `outlook.send_email` fails: this is demo-critical. Investigate gate logic before proceeding.

### Phase 6 — Forms acceptance smoke (15 min, human + plan-author)

**Action:**

1. Open the form URL in Chrome:
   ```bash
   ssh pilot 'powershell -NoProfile -ExecutionPolicy Bypass -File C:/Users/vyonix/pilot-launch-form.ps1'
   ```
2. Human types Turn A (extract + preview):
   > Read the suspension report email from this morning and fill out the Term 3 Suspensions form. Don't submit yet — let me review.
3. Tail log for `forms.preview_suspension`. Capture field count.
4. Human visually confirms 30+ fields populated correctly.
5. Human types Turn B:
   > Submit the form.
6. Tail log for `forms.submit_suspension({confirm:true})` + DOM Submit click.
7. Human confirms "Thanks" page.

**Stop condition:** "Thanks" page reached after Turn B.
**Fallback:**
- Field count <25: brain icon (Think mode) ON, retry Turn A. If still <25, NO-GO on Forms.
- Submit can't find button: form is paginated; click "Next" once, retry Turn B.
- Agent picks API path (`forms.<api-anything>` instead of `preview/submit`): kill the turn, re-issue with explicit "via the browser, not the API". This is a critical guard — Bearer-401 will visibly fail in front of the principal.

### Phase 7 — Dress rehearsal (10 min, full run-through)

**Action:** Reset state (Ctrl+R on form tab; close compose pane if open). Run the **demo script** from `PRINCIPAL_DEMO_SCRIPT.md` end-to-end with stopwatch.

**Stop condition:** 3 turns of email + 2 turns of forms complete in ≤10 min total. No surprises.
**Fallback:** any blocker on the rehearsal = demo on Mac.

### Phase 8 — Hand-off (2 min)

**Action:** plan-author writes a 1-paragraph status to the human + dev session:
- Outlook: PASS / WARN / FAIL
- Forms: PASS / WARN / FAIL
- Risk register: live items
- Go / no-go for principal

---

## Risk register (live, T-now)

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| "Model call failed" not resolved by demo time | medium | demo-critical | Mac demo as fallback; commit `ec88a2f` is the dev session's fix |
| Chrome profile-lock prevents CDP attach | medium | demo-critical | Demo-profile alternative (separate user-data-dir) |
| Test.fac sign-in expired | low | medium | Re-sign-in before demo; password authorized |
| Form clicked stale state from prior failed runs | low | medium | Ctrl+R reset before each turn |
| Agent picks Bearer-API path on stage | low | demo-critical | Brain icon ON; Turn-A wording forces preview, not API |
| Network drops mid-demo | low | high | Pre-recorded clip as backup; Mac fallback |
| Gateway crashes mid-demo | low | high | Just relaunch — chat history persists in `~/.openclaw/` |
| Agent calls outlook.send_email on the wrong email (mismatch) | very low | high | The double-gate refuses; demo this on purpose once |
| 401 Required user login in form fill | high (if API path triggered) | demo-killer | DOM-only path; explicit prompt wording |
| User accidentally sees `claude-sonnet-4-5` model name in UI | very low | trust | UI shows "Online"/"On this device" only — anonymisation rule honored |

## Hard rules summary (do NOT break)

- `profile=user` Chrome always; never managed Chromium.
- Send-email double-gate (`confirm:true` + subject match) MUST fire.
- No body / recipients in logs; subject ≤120 chars.
- Test.fac password only from local operator context (`PILOT_TEST_PASSWORD` or direct human sign-in), never printed or committed.
- No Ollama on the demo critical path.
- No body editing of `~/.openclaw/openclaw.json` without going through `clawx-config-doctor`.
- No `Stop-Process` on Chrome / Ministry of Education / ollama without explicit human approval.
- Don't push to `ValueCell-ai/ClawX` upstream.

## Owner key

- **plan-author** = this Claude session, working over SSH only.
- **dev session** = the other Claude session in the user's other window, owning app code/config.
- **human** = the user, sitting at the pilot laptop for GUI-driven steps.

---

## Cross-references

- Skills: `windows-pilot/skills/*.md`
- Scripts: `windows-pilot/scripts/*.ps1`
- Demo script: `windows-pilot/plans/PRINCIPAL_DEMO_SCRIPT.md`
- Sub-agents: `windows-pilot/agents/*.md`
- Project hard rules: `CLAUDE.md`
- Original demo runbook (Mac focus): `docs/DEMO_RUNBOOK_2026-05-26.md`
- Windows install runbook: `docs/WINDOWS_INSTALL_RUNBOOK.md`
- Windows problems atlas: `docs/WINDOWS_PROBLEMS_ATLAS.md`
- Forms API investigation (post-demo): `docs/MSFORMS_API_FILL_PLAN.md`
