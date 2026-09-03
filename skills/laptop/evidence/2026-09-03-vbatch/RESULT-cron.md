# STAGE 2b — Gap D: cron/agentTurn live fire on Windows (vbatch)

**Verdict: PASS — `FIRED_OK`.** A cron job armed through the app's own Host API fired on schedule on the installed moe.15 build and ran a real agentTurn chat prompt (no send of any kind).

- **Date:** 2026-09-03 ~03:51–03:54 UTC (VM clock)
- **Host:** GCP VM `clawx-win-rc-20260609`, guest `clawxtest`, over IAP (sshd -> localhost:12222)
- **Build:** installed 0.4.3-moe.15; app up in console session 1 with `--remote-debugging-port=9223`; Gateway :18789 and Host API :13210 live
- **Raw logs in this dir:** `vbatch2-cron-out.log` (arm leg), `vbatch2-cron-debug.log` (envelope discovery), `vbatch2-cron-observe.log` (fire + transcript + cleanup)
- **Method:** node (packaged `resources\bin\node.exe`) + bundled playwright-core over CDP :9223 -> `window.electron.ipcRenderer.invoke('hostapi:fetch', ...)` — the app's own renderer bridge, so the Host API bearer token never left the app and no secret was read or printed.

## FACTS

1. **Armed:** `POST /api/cron/jobs` `{name:"vbatch-cron-probe", message:"Scheduled reminder test (vbatch, no send): remind the principal, in one short sentence, to submit today's daily report before 3:45pm.", schedule:"53 3 * * *"}` -> job `e2400174-669b-4027-a1ee-d18748cd7144`, `delivery.mode="none"`, `nextRun=2026-09-03T03:53:00Z`, agentId `main`, payload kind `agentTurn`.
2. **Fired on schedule:** `lastRun.time=2026-09-03T03:53:00.021Z` (21 ms after the scheduled minute), `success=true`, `duration=76737 ms`.
3. **The fired turn is a real chat prompt turn:** run log `~/.openclaw/cron/runs/e2400174-….jsonl` line: `action=finished, status=ok, summary="Just a reminder to please submit today's daily report before 3:45pm.", model=moe-demo-pro, provider=custom-moecloud, durationMs=76737` — a genuine cloud LLM turn produced the reminder text.
4. **Visible in chat surfaces:** `GET /api/cron/session-history?sessionKey=agent:main:cron:<id>` returned the two chat messages the app renders for this session — the system "Scheduled task / Prompt" header and the assistant reminder message ("Just a reminder to please submit today's daily report before 3:45pm. / Duration: 77s | Model: custom-moecloud/moe-demo-pro").
5. **No send:** `delivered=false`, `deliveryStatus="not-requested"` (delivery mode `none`). No Outlook/Forms/channel delivery was requested or attempted.
6. **Cleanup:** `DELETE /api/cron/jobs/<id>` -> 200; `GET /api/cron/jobs` -> 0 jobs; `cron.json` absent after delete. Residue: the 819-byte run log `cron\runs\e2400174-….jsonl` remains on the guest (historical log only).

## What this proves

W5's Windows leg (gap D in `docs/APP_WORKFLOWS_TEST_MATRIX.md`): the gateway cron scheduler on Windows accepts a job via the Host API, wakes at the scheduled minute, executes an isolated agentTurn against the configured cloud model, records the run, and exposes the fired turn as chat messages. The daily-report reminder mechanism (demo item 3) is live on Windows.

## Notes / trap for next agent

- `hostapi:fetch` IPC responses are **enveloped**: `{ok, data:{status, ok, json}}` — read `.data.json`, not `.json`. The first arm attempt looked like `FAILED_CREATE` purely because of this envelope; the job had in fact been created (that is also why the observe leg targets a fixed job id).
- The run log's delivery block records `resolved.ok=false "Channel is required…"` — expected and harmless when `delivery.mode="none"`; `deliveryStatus="not-requested"` is the operative field.
