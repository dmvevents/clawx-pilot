---
name: demo-flow-recovery
description: Live-demo failure triage for the Ministry app — maps the top ~10 demo-day symptoms (composer silent, thinking forever, send refused, form login redirect, wrong email summarised, gateway port dead, on-device loop, stale channel, CDP attach failure, missing recording) to a state in docs/FLOW_STATE_DIAGRAMS.md, a read-only probe, and the exact recovery command. Use DURING or immediately before a demo when a flow misbehaves and you need the fastest correct move, not a debugging session.
---

# Demo flow recovery — symptom → state → command

Companion to `docs/FLOW_STATE_DIAGRAMS.md` (the state machines and failure
modes behind every row here). This skill is the OPERATIONAL index: read-only
probe FIRST, then the recovery. Do not re-debug anything with a named
signature — the atlas (`docs/WINDOWS_PROBLEMS_ATLAS.md`) and the flow doc
already carry root causes.

## Standing rules (bind every recovery below)

- Read-only probes before any mutation: `git status --short`,
  `windows-pilot/scripts/pilot-probe-state.ps1`, targeted Vitest files.
- Never retry through a confirm gate (send/submit/download). A refusal is the
  gate WORKING.
- Never mask auth/config failures with a channel degrade — the classifier's
  NEVER patterns (`src/lib/channel-degrade.ts`) are policy, not a suggestion.
- No bodies, recipients, passwords, or keys in anything you print or paste.
- Windows state mutations: back up `%APPDATA%\Ministry of Education` and
  `%USERPROFILE%\.openclaw` first; launch the app VISIBLE (hidden launch kills
  the Gateway — flight check IF-4).

## Log paths (exact)

| Surface | Path |
|---|---|
| App log (Mac) | `~/Library/Application Support/Ministry of Education/logs/clawx-<timestamp>.log` (latest by mtime) |
| App log (Windows) | `%APPDATA%\Ministry of Education\logs\` — tail via `ssh pilot` + `windows-pilot/scripts/pilot-tail-gateway-log.ps1 -Lines 100` |
| Agent trajectory | `~/.openclaw/agents/main/agent/trajectory.jsonl` |
| Self-test cron | `~/.openclaw/selftest/last-run.json` |
| Runtime config | `~/.openclaw/openclaw.json` (+ `.last-good` sibling) |
| Provider store (Mac) | `~/Library/Application Support/Ministry of Education/clawx-providers.json` |

## The symptom table

### 1. Composer silent — accepts the message, never streams a reply

Flow 2 `Compose → SilentTurn` (four-store drift, Atlas §12 — hit 3+ times).

```bash
# Probe (read-only)
jq -r '.agents.defaults.model.primary, .agents.list[0].model.primary' ~/.openclaw/openclaw.json
tail -1 ~/.openclaw/agents/main/agent/trajectory.jsonl | jq .metadata.model
```
If they disagree with the UI channel pill: run the **`clawx-config-doctor`**
agent, or apply the four-store transaction without a restart:
```bash
curl -s -X PUT http://127.0.0.1:13210/api/settings/preferredChannel \
  -H 'Content-Type: application/json' -d '{"value":"online"}'
```
Never hand-patch `agents.list[*].model.primary` — that recreates the drift.

### 2. Thinking forever / stuck processing on a cloud turn

Flow 2 `ProviderCall → ClassifyFailure`. Diagnose provider/network FIRST, not
UI (Atlas §13).

```bash
# Mac probe
nc -z generativelanguage.googleapis.com 443 && echo NET_OK
grep -iE "idle timeout|fetch failed|429|ECONN" \
  "$(ls -t ~/Library/Application\ Support/Ministry\ of\ Education/logs/*.log | head -1)" | tail -5
# Windows probe
ssh pilot 'powershell -NoProfile -c "Test-NetConnection generativelanguage.googleapis.com -Port 443 | Select TcpTestSucceeded"'
```
- Network-class or idle-timeout error in the log: the KR4 degrade should have
  fired (`f01bb43a` covers the idle-timeout class). If the build predates it,
  toggle to "On this device" and resend — never edit config to "fix" this.
- 401/403 in the log: STOP — auth/config class, fail-loud by design. Fix the
  key/config; do not degrade, do not retry.
- Neither: escalate to `.claude/skills/windows-runtime-recovery/SKILL.md`
  (prove the app-facing runtime path, not config labels).

### 3. Send refused unexpectedly

Flow 3 `Verify → Refused`. The gate is usually RIGHT — a8322ad9 made subject
drift refuse and killed the recipient-well false positive.

```bash
pnpm exec tsx scripts/outlook-shot.ts        # screenshot FIRST → /tmp/outlook-state.png
pnpm exec tsx scripts/outlook-cleanup-compose.ts   # discard stacked compose panes
```
Read the refusal reason verbatim. Per the persona steering: do NOT redraft.
Verify exactly ONE reviewed visible draft, then retry `outlook.send_email`
with `confirm:true`. If the refusal contradicts what you see on the
screenshot, switch to `.claude/skills/outlook-lane-debug/SKILL.md`
(verifier-lying class — proven 2026-09-02).

### 4. Form redirects to Microsoft login

Flow 4 `AuthCheck → SigninRedirect` (ATLAS-15 — auth state, NEVER selectors).

```bash
# Probe: what is the Forms tab actually on?
node windows-pilot/scripts/pilot-forms-cdp-inspect.js   # host + title + question count
```
Host `login.microsoftonline.com` + question count 0 ⇒ sign in to Microsoft in
the Chrome profile ClawX opened, then rerun the preview. Do not broaden
selectors; do not touch the driver.

### 5. Wrong email summarised

Flow 3 `RowAction → StaleRead` — **CLWX-46, OPEN**. The reading pane can serve
an adjacent message's body for the clicked row; the agent then summarises the
wrong email faithfully.

```bash
pnpm exec tsx scripts/outlook-shot.ts   # is the open message the one asked about?
```
Demo workaround until the settle-on-expected-item guard ships (TO-BUILD TB-1
in `docs/FLOW_STATE_DIAGRAMS.md`): have the agent `outlook.search_inbox` for
the exact subject and `outlook.read_email` the search hit, instead of
summarising "the last email"; cross-check the summary's subject against the
screenshot before showing it. If the subject reads "Navigation pane", that is
CLWX-46's known selector defect (TB-2), not a new bug.

### 6. Gateway port dead

Flow 1 (boot). Composer shows `gateway error | port 18789 | pid`.

```bash
# Mac probe
pgrep -fl "Ministry of Education"; lsof -nP -iTCP -sTCP:LISTEN | grep -E "18789|13210"
grep -E "exited before becoming ready|doctor repair failed" \
  "$(ls -t ~/Library/Application\ Support/Ministry\ of\ Education/logs/*.log | head -1)" | tail -3
# Windows probe
ssh pilot 'powershell -NoProfile -ExecutionPolicy Bypass -File windows-pilot/scripts/pilot-probe-state.ps1'
```
`exited before becoming ready (code=1)` ⇒ plugin schema crash-loop: restart
the app (the idempotent seeder repairs), else run the **`gateway-recovery`**
agent (it can restore `openclaw.json.last-good`). PID alive but ZERO output
and no ports ⇒ the Atlas §1 silent-death class — check the installed build's
dependencies before anything else. Port bound but composer still disabled ⇒
that is symptom 10-adjacent slow-ready, see IF-5: wait on the composer, and on
moe.13+ ready should be ~51s, not 285s.

### 7. On-device loop — endless Working, CPU hot

Flow 2 `ToolCalls → IdenticalFailureLoop` (ONDEVICE-RETRY-LOOP, moe.14 run).

```bash
# Probe: identical repeated tool calls?
tail -30 ~/.openclaw/agents/main/agent/trajectory.jsonl | jq -c 'select(.type? // empty | test("tool"; "i"))' | tail -6
curl -s http://127.0.0.1:11434/api/tags | grep -o 'qwen2.5:3b-instruct'   # PF-6: ollama up?
```
Builds carrying `fee7294d` (moe.15+) break the loop after 3 identical
failures automatically. On older builds: stop the turn in the UI and rephrase
with the needed content inline (the 3B model was calling
`principal.summarise_circular` with empty args — give it the text). Do not
switch the demo to cloud to "fix" this unless the demo plan says cloud.

### 8. Stale channel choice — toggle did not stick / reverted after relaunch

Flow 1 `ChannelPreflight → ChannelClobbered` (CH-CLOBBER, fixed `38085ba3`,
ships moe.14+).

```bash
# Probe: what channel does the runtime actually resolve?
jq -r '.agents.list[0].model.primary' ~/.openclaw/openclaw.json
```
On moe.14+ this should not recur — if it does, that is a regression: capture
the log and file it. On older builds, re-apply the choice through the
transaction (Host API PUT from symptom 1, with the wanted value); the
`config-coherence-auditor` agent confirms all four stores agree. If the toggle
silently reverts in the UI, the requested channel has no configured account —
fix in Settings → Models, not in files.

### 9. CDP attach fails — Outlook/Forms tools cannot reach Chrome

Flow 3 `CDPAttach → AttachFailed`.

```bash
# Probe
curl -s http://127.0.0.1:18792/json/version | head -3   # empty ⇒ no debug endpoint
```
In-app path first: `browser.diagnose` then `browser.repair_chrome_cdp`. If
repair returns `profile_locked_close_chrome`: ONE action — close all Chrome
windows, retry from ClawX (never give a principal Chrome flags or commands).
Operator lane (Mac): Chrome's singleton ignores the flag while any instance
lives — fully quit, verify dead, relaunch the dedicated profile (exact command
in `.claude/skills/outlook-lane-debug/SKILL.md`). AADSTS53003 on a page means
someone launched managed Chromium — hard-rule violation, switch to
`profile=user` and never back.

### 10. Recording missing — evidence run produced no video

Flow 6 `Assemble → FramesOnly`. Recorder: `scripts/forms-submit-recorded.ts`
(Playwright trace + CDP screencast frames → MP4 via ffmpeg); older driver:
`windows-pilot/scripts/pilot-chat-turn-driver.js` (JSON + screenshots).

```bash
# Probe: what did the run actually produce?
ls skills/laptop/evidence/<run-dir>/   # expect run-summary.json, frames/, trace.zip, *.png, video.mp4
ls resources/bin/darwin-arm64/ffmpeg /opt/homebrew/bin/ffmpeg 2>/dev/null   # Mac resolver order
ssh pilot 'powershell -NoProfile -c "where.exe ffmpeg; Test-Path \"$env:LOCALAPPDATA\Programs\Ministry of Education\resources\bin\ffmpeg.exe\""'
```
No `video.mp4` but frames + `trace.zip` + `run-summary.json` present ⇒ the
frames-only fallback fired (the recorder prints WHY: `no ffmpeg binary found`
or `only N frame(s) captured`) — that IS complete evidence; ledger it now and
assemble the MP4 later on a box with ffmpeg (two-file rule, never in-place —
Atlas §14). Recorder logged `screencast unavailable` at start ⇒ trace-first
run; re-run with a healthy CDP session if video is mandatory. Chat-turn driver
JSON with zero PNGs ⇒ capture silently failed (TO-BUILD TB-5) — re-run and
watch frames land. Judge the run by the artifacts, never the command tail
(IF-1/PT-1).

## Escalation map

| If the symptom outlives this table | Go to |
|---|---|
| Any Windows runtime/coherence/ASR failure | `.claude/skills/windows-runtime-recovery/SKILL.md` |
| Any browser-lane behavior contradicting the code | `.claude/skills/outlook-lane-debug/SKILL.md` (screenshot-first) |
| Gateway boot crash-loop | `.claude/agents/gateway-recovery.md` |
| Channel/model divergence needing repair | `.claude/agents/clawx-config-doctor.md` |
| A Windows-specific error with a familiar smell | `docs/WINDOWS_PROBLEMS_ATLAS.md` §1–§15 before ANY re-debugging |
| Failure mode not in the state diagrams | Add it to `docs/FLOW_STATE_DIAGRAMS.md` + the matching auditor, per the atlas extension protocol |
