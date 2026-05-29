# Windows pilot — Outlook + Forms end-to-end execution package

**Purpose:** everything an agent (or a human) needs to verify, configure, and exercise Outlook email + MS Forms suspension-form filling on the pilot Windows laptop **without disturbing the active app/dev session**.

**Pilot target:** `vyonix@VYONIX` via `ssh pilot` (multiplexer ready, ~50ms RTT after first call).

**App state on pilot (verified 2026-05-26 ~11:38am AST):**
- `Ministry of Education.exe` v0.4.3-moe.10 installed at `%LOCALAPPDATA%\Programs\Ministry of Education\`
- Gateway listening on **18789** (PID 16228), host-API on **13210** (PID 12968)
- Ollama running on **11434** (irrelevant for demo — cloud only)
- `~/.openclaw/openclaw.json` has `agents.defaults.model.primary = google/gemini-2.5-pro` ✓
- `agents.list = []` (empty) — agent inherits defaults at runtime, that's fine
- moe-principal-assistant plugin enabled, microsoft-graph plugin disabled (expected)
- Chrome running with **12 procs but NO `--remote-debugging-port=18792`** ← **this is the only blocker for Outlook + Forms automation**

---

## Read-this-first hard constraints

These are inviolable per project hard rules. Every script + skill + agent in this directory honors them:

1. **Never managed Chromium.** Always `profile=user` Chrome — the principal's already-signed-in session. Playwright's bundled Chromium is blocked by Microsoft Conditional Access (`AADSTS53003`).
2. **Outlook `send_email` requires double gate:** `confirm:true` + open compose pane subject must match `args.subject`. Demonstrate the gate; never skip it.
3. **`download_attachment` same hard-confirm gate.**
4. **No body / recipient / password content in logs.** Subject truncated to 120 chars, recipient counts only.
5. **Cloud only for the demo.** Agent must call `google/gemini-2.5-pro`; on-device path stays cosmetic.
6. **Test account credentials are local-only for `test.fac@fac.edu.tt`:** use the operator-provided password via `PILOT_TEST_PASSWORD`; never print it and never use automation for `*@moe.gov.tt`.
7. **Don't touch the live `release-moe10-nsis/`, `release-moe10-fresh/`, app config files, or kill running app processes.** Other session owns those.

---

## Layout

```
windows-pilot/
├── README.md                           ← you are here
│
├── skills/                             ← Claude Skills (markdown), invoked by SKILL_NAME
│   ├── outlook-email-windows.md        ← read inbox / draft / reply / send w/ hard-confirm
│   ├── forms-suspension-fill.md        ← DOM-fill + DOM-submit the test.fac form
│   ├── chrome-cdp-windows.md           ← attach/launch Chrome with --remote-debugging-port=18792
│   ├── model-gateway-recovery.md       ← recover "thinking" / model-call / provider drift failures
│   ├── windows-emulation-testing.md    ← Mac simulator + UTM VM + pilot validation ladder
│   ├── claude-code-bedrock.md          ← install/verify Claude Code with Amazon Bedrock
│   ├── github-dev-windows.md           ← GitHub CLI/repo clone + Claude session control
│   └── pilot-ssh-ops.md                ← SSH multiplexer + safe powershell-over-ssh patterns
│
├── agents/                             ← Sub-agent specs (mirror .claude/agents/*.md format)
│   ├── outlook-verify.md               ← end-to-end Outlook smoke on Windows pilot
│   ├── forms-fill-verify.md            ← DOM-fill + DOM-submit smoke on Windows pilot
│   └── windows-demo-conductor.md       ← orchestrates outlook-verify + forms-fill-verify
│
├── scripts/                            ← powershell + tsx helpers, all idempotent
│   ├── pilot-attach-chrome-cdp.ps1     ← turn on --remote-debugging-port=18792 on pilot
│   ├── pilot-probe-state.ps1           ← read-only audit (procs, ports, version, config)
│   ├── pilot-tail-gateway-log.ps1      ← live tail of latest clawx-*.log
│   ├── pilot-verify-outlook-tab.ps1    ← prove Outlook tab is signed in via CDP /json
│   └── pilot-launch-form.ps1           ← navigate Chrome to the test.fac form ResponsePage
│
└── plans/
    ├── EXECUTION_PLAN_OUTLOOK_FORMS.md ← THE plan; read top-to-bottom; each step has stop+fallback
    └── PRINCIPAL_DEMO_SCRIPT.md        ← what to say + type during the demo, with timings
```

For the latest cross-cutting handoff, start with `docs/NEXT_AGENT_WINDOWS_DEMO_HANDOFF_2026-05-29.md`. It captures the model/Gateway recovery work, current known gaps, Mac/VM emulation strategy, and exact next-agent execution order.

---

## How to execute (60-second TL;DR)

```bash
# From Mac, ssh multiplexer already cached:
ssh pilot 'echo ok'                                      # smoke test (≤50ms)

# 1. Read-only audit:
ssh pilot 'powershell -NoProfile -ExecutionPolicy Bypass -File C:/Users/vyonix/probe-pilot.ps1'

# 2. Attach Chrome to CDP (the one blocker today):
scp windows-pilot/scripts/pilot-attach-chrome-cdp.ps1 pilot:/Users/vyonix/
ssh pilot 'powershell -NoProfile -ExecutionPolicy Bypass -File C:/Users/vyonix/pilot-attach-chrome-cdp.ps1'

# 3. Verify Outlook tab via CDP /json:
ssh pilot 'powershell -NoProfile -ExecutionPolicy Bypass -File C:/Users/vyonix/pilot-verify-outlook-tab.ps1'

# 4. Drive the demo from the GUI (principal sits at the laptop directly).
#    The execution plan has the chat composer text verbatim.
```

Everything else (skills, agent specs, demo script) is reference material the runtime agent picks up at chat time.

---

## What I am NOT doing in this directory

- Editing `electron/`, `extensions/`, `scripts/forms-*.ts`, `electron-builder.yml`, `package.json`, or any `.openclaw/` state.
- Killing app procs, restarting the gateway, or modifying `~/.openclaw/openclaw.json` on pilot.
- Cutting a new build. moe.10 is good; we're verifying behavior, not rebuilding.
- Pushing to `dmvevents/clawx-pilot` until results land.

The handoff to the other (active dev) session is: **here are the gaps I confirmed, here are the scripts you can run when ready, here's what passes / what blocks**.

---

*Created 2026-05-26 11:40am AST. Owner: this Claude session. Active dev session in another window owns app code + builds.*
