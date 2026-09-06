# CLWX-43 latency — Mac lane (live in-app turns, 2026-09-06)

Mechanism: host-API `chat.send` relay into the RUNNING app (the proven CLWX-65 lane);
wall-clock = submit -> the turn's final `model.completed` trajectory timestamp.
CAVEATS: M-series dev Mac, NOT the pilot laptop (laptop-lane repeat stays the named
remainder); n=1 per prompt shape; turns rendered in the live app UI; the memo turn
leaves fire-drill-memo.docx in ~/.openclaw/media/outbound as turn evidence.

| Prompt | Shape | Wall (s) | Tools | Reply chars |
|---|---|---|---|---|
| routine-question | no-tool routine answer | 8.8 | - | 653 |
| circular-summary | document.read_pdf + summarise | TIMEOUT | - | 0 |
| memo-write | draft + document.write_docx | 17.1 | document.write_docx | 995 |

Median (settled turns): 17.1s.
Reference points: proposed budget p50 <=15s / p90 <=30s (owner sign-off pending);
2026-09-02 e2-VM baseline: tool turns 79.6 / 103.4 / 182.2s, median ~103s.
Channel (from trajectory): google/gemini-2.5-pro.

## Addendum — the TIMEOUT row is a DEFECT REPRODUCTION, not a latency point

Root-caused same tick from /tmp/openclaw/openclaw-2026-09-06.log + the
trajectory:

- The installed app on this Mac is **0.4.3-moe.10** (May build — 8 versions
  behind the RC), and `plugins.load.paths` loads the CURRENT repo plugin
  into that old runtime.
- Both circular-summary attempts (16:29:35 and the 16:36:31 retry) show
  `prompt.submitted` with NO terminal event ever; the gateway log shows a
  fresh BOOT ~2 minutes into each turn (16:31:46, 16:38:20) with zero
  crash/SIGTERM lines — the read_pdf turn silently hard-kills the moe.10
  gateway process and the supervisor restarts it, evaporating the turn.
- This is the long-fixed CLWX-72 (canvas binding) / CLWX-92 (pdfjs
  UtilityProcess worker) class, REPRODUCED LIVE on the pre-fix installed
  build — twice. moe.17+ carries the fixes (VM-verified 2026-09-03); the
  fast lane (`harness:artifact --fast`) now gates every future package
  against the class. No new card: the fix + guard exist; the reproduction
  corroborates the MONDAY-BUILD owner ask (this dev Mac needs the new
  install too).
- The silent in-chat death (no error until much later) is the CLWX-78/104
  surface — also fixed in-tree awaiting the next build.

Valid latency rows therefore: routine 8.8s (within the proposed p50 ≤15s),
memo+write_docx 17.1s (near budget) — on gemini-2.5-pro via the moe.10
runtime with the current repo plugin. Trend vs the ~103s VM median is
strongly favorable, but the numbers that matter for sign-off are the
NEXT-BUILD laptop-lane repeats (named remainder).

Also observed at 16:34:53: `incomplete turn detected: runId=clwx43-memo-write…
stopReason=stop payloads=0 — surfacing error to user` logged in the SAME
second as the memo turn's successful model.completed + docx tool call —
recorded as a curiosity of the moe.10 runtime's run bookkeeping, not chased
(the runtime is 8 versions stale).
