# moe.19 install + full-matrix verify — clawx-win-rc-20260609 (2026-09-06)

VM: `clawx-win-rc-20260609` (us-central1-a) over the IAP tunnel `localhost:12222 → guest:22`.
Base: the moe.18 install. moe.19 installed **over** it (NSIS `/S /CURRENTUSER`, state deliberately
not wiped — upgrade-path evidence). Driver: `scripts/vm-verify-moe19.sh` plus the interactive
turn legs from `docs/STAKEHOLDER_GAP_ANALYSIS_2026-09-06.md` §4.

Owner directive this run was built to satisfy: *"test on the VM, not this Mac… VLM grading of the
real Windows desktop screen, not only the CDP viewport. Prove install completeness, no excluded
packages, and every function working as stakeholders see it."*

Installer: `Ministry of Education-0.4.3-moe.19-win-x64.exe`, 433,622,791 B,
sha256 `3a533a0fa1733fac6243fba19e4f1bc21d70c57eb498e1121a969b025bc48888` (verified both hops).
No sends, no submits, sandbox account only. **VM left RUNNING** (stopping it is owner-only).

**The matrix is incomplete and the run is parked, not finished.** It ended on an expired gcloud
credential (`Reauthentication failed. cannot prompt during non-interactive execution`), which is an
owner-interactive gate: `gcloud auth login`. Everything below is what was actually observed before
that point; nothing is extrapolated past it.

## Scorecard

| Leg | Verdict | Basis |
|---|---|---|
| Artifact + both-hop sha256 | **PASS** | Mac hop + guest `Get-FileHash` match |
| Install (enforced exit code, version, ports) | **PASS** | exit 0; `0.4.3-moe.18` → `0.4.3-moe.19`; **running-process** binary attested; 18789 + 13210 up |
| Install completeness — no excluded packages | **PASS** (caveat below) | 19/19 `EXTRA_BUNDLED_PACKAGES` + `nscc-2026.txt` all `True` |
| Config integrity after upgrade | **PASS** | `config-health.json`: `lastKnownGood == lastPromotedGood`, no suspicious signature |
| VLM desktop grading — app shell | **PASS** | real desktop screenshot, ≤2000px, graded by Sonnet 4.5 |
| VLM desktop grading — chat content | **FAIL** | assistant on screen says it cannot read the PDF |
| K10 in-app PDF summarise | **FAIL as seen; INVALID as an Online test** | no assistant prose; both runs had auto-degraded to on-device |
| Silence-on-send (CLWX-95) on the installed binary | **RED — reproduced live** | gateway restart lost the port race for ~4 minutes; composer went dead |
| On-device turn: top-level `sessions_yield` | **RED — new defect** | turn parks forever, no terminal state (`ondevice-stall-rootcause.md`) |
| Trust sweep on graded frames | **PASS, one observation** | no model IDs, no cost, no raw HTTP; footer does expose gateway port + pid |
| CLWX-87 System.Speech WER row | **NOT RUN** | needs the repo checkout on the guest |
| CLWX-77 Windows fast lane | **NOT RUN** | parked with the lane |

## Install completeness (PASS, with a caveat that matters)

All 19 packages plus the NSCC pack present under the installed tree
(`resources\openclaw\node_modules\…`, and `resources\extensions\moe-principal-assistant\data\nscc-2026.txt`):

```
@whiskeysockets/baileys=True   @larksuiteoapi/node-sdk=True   @grammyjs/runner=True
@grammyjs/transformer-throttler=True   grammy=True   @buape/carbon=True
@discordjs/voice=True   discord-api-types=True   opusscript=True
@tencent-connect/qqbot-connector=True   mpg123-decoder=True   silk-wasm=True
acpx=True   playwright-core=True   xlsx=True   docx=True   mammoth=True
pdf-parse=True   qrcode-terminal=True   nscc-2026.txt=True
```

Caveat, recorded because it is the more useful finding: `packages-nscc-presence.txt` was produced by
an ad-hoc probe, **not** by the verify script. The script's own package list came from a regex
scraped out of `verify-openclaw-bundle.mjs`, which only *imports* the constant — so the regex matched
nothing, the presence loop iterated over an empty list, and the phase logged
`bundled packages all present (0 checked)`. A zero-package check reported as a pass. Fixed this tick:
the script now imports the module for real, **fails** on an empty list rather than passing vacuously,
and writes the per-package readout as a reviewable artifact instead of a summary line. Version on
disk `0.4.3-moe.19`; the attested **running** binary:

```
0.4.3-moe.19|C:\Users\clawxtest\AppData\Local\Programs\Ministry of Education\Ministry of Education.exe
```

## VLM grading of the real desktop (1 PASS, 1 FAIL)

Grader: `us.anthropic.claude-sonnet-4-5-v1:0` over the actual Windows desktop, not the CDP viewport.

Shot 1 — **PASS**. Verbatim observation: full sidebar (New Chat, Models, Agents, Channels, Skills,
Cron Tasks, Settings), chat interface live, status "Online" / "Talking to Main Agent",
"No setup wizard, crash dialog, raw model identifiers, costs, or HTTP errors visible."

Shot 2 — **FAIL**. The grader read the transcript and found the assistant saying:

> "I am sorry, but I am still encountering the same technical error that has prevented me from
> accessing that PDF file in the past. I am unable to read its content."

That is the stakeholder-visible outcome, and it is why the desktop-screen leg exists: the CDP
viewport legs had scored the same turn as `ANSWERED`.

## K10 in-app PDF — FAIL as seen, and invalid as an Online test

Two fresh-session runs (19:16 and 19:26), both recorded `verdict: ANSWERED`. Both verdicts are
**wrong**, and the artifacts say so on their face:

```
messagesBefore: 0   messagesAfter: 2   executionSteps: []   toolNames: []
answerText: "Please summarise the PDF file at C:\Users\clawxtest\Downloads\fixture.pdf in five bullet points. just now"
degradeNoticeSeen: true
```

`answerText` is the principal's own prompt echoed back, `toolNames` is empty (no `read_pdf`), and the
message dump confirms two bubbles carrying identical text. This is exactly the harness-honesty class
the Codex adversarial lens flagged in the same tick; the driver now records `assistantPromptEcho`,
requires assistant prose, and rejects echo-only and chip-only output (commit `c22e7a26`).

Second, more important point: `degradeNoticeSeen: true` on **both** runs — the cloud provider was
unreachable from the VM for the whole window, so every turn auto-degraded to `qwen2.5:3b-instruct`.
K10 therefore never exercised the Online channel it is meant to test. CLWX-92 (which passed on moe.17
with a real summary) is neither re-proven nor disproven by this run. Re-running K10 needs cloud
reachability confirmed on the guest first — the missing precondition check the next run must add.

## Silence-on-send reproduced on the installed binary (CLWX-95, RED)

The defect fixed at source this tick was caught live on moe.19, in the app log, in the exact shape
the fix targets — a mid-send gateway restart that then loses its own port:

```
19:33:48 Scheduling Gateway reload after provider switch to "ollama-ollamalo"
19:33:49 [gateway-refresh] mode=reload result=fallback_restart cause=windows
19:33:53 [gateway:rpc] chat.send failed (timeoutMs=120000): Error: Gateway not connected
19:34:35 Port 18789 still occupied after 30000ms; aborting startup   (retry 1/3)
19:35:17 Port 18789 still occupied after 30000ms; aborting startup   (retry 2/3)
19:35:59 Gateway start failed … Debounced Gateway reload failed
19:37:49 Gateway reconnection attempt failed: Port 18789 still occupied after 30000ms
```

What the principal got: `TIMED_OUT_MID_TURN`, then a **disabled composer** whose placeholder read
`Gateway not connected...` — the app locked itself out of its own chat box for about four minutes
because a channel switch restarted the runtime mid-send.

Repo state: fixed at source (`ddb1aa30` removes the refresh from the send path, `55b488db` replaces
it with an acknowledged `sessions.patch` cutover that never restarts and never resends on an
unconfirmed switch). **Not yet verified on an installed binary** — that needs a new Windows build and
a fresh VM pass, so the leg stays RED in the evidence until a binary carries the fix.

## New defect: top-level `sessions_yield` parks the turn forever (RED)

```
freshSession: true   messagesAfter: 2   executionSteps: ["sessions_yield {}"]
answerText: null     settled: false     verdict: TIMED_OUT_MID_TURN (300s budget)
degradeNoticeSeen: false   runErrorSeen: false
```

Full analysis in `ondevice-stall-rootcause.md`. Short form: `sessions_yield` hands control to a
*parent* session; at top level there is no parent, the 3B model picks it anyway on a plain question,
and the turn has no terminal state at all — no answer, no error, no timeout the principal can see.
The model was proven responsive at the same moment (direct ollama generate: 8.2s wall, 0.1s decode),
so this is a tool-loop stall, not slowness.

Our own harness hid it: `pilot-electron-cdp-probe.js:342` instructs the model not to use
`sessions_yield`, and that instruction exists only in the probe, never in the product persona. Every
eval through that probe was steering around the defect instead of measuring it. Same lesson as the
`skipGatewayRefresh` dead code from this tick — a harness that prompts around a defect reports GREEN
over a broken product.

Predicted fix layers (cheapest first): trim session-control tools from the on-device catalog
(`fix/tool-catalog-trim` @ `7add864b`, **under owner HOLD — not unheld here**); a terminal turn
watchdog so no tool-loop stall can render as an infinite spinner; persona-level instruction as
defence in depth.

## Trust observation (not scored)

The graded frame shows the footer reading `gateway connected : port: 16783 | pid: 5756`. No model ID,
no cost, no raw HTTP — so it passes the stated bar — but a port and a PID are runtime plumbing a
principal has no use for, and the port shown (16783) is not even the documented 18789. Flagging for a
scope call rather than fixing it unasked.

## What this run did NOT prove

- Nothing about the Online channel: the provider was unreachable throughout, so every functional leg
  ran on the 3B on-device model. K10, K13, K14 NSCC grounding and the cron legs all still owe an
  Online-channel run.
- Nothing about the CLWX-95 fix on a binary — it is source-only until a new build is installed.
- CLWX-87 System.Speech WER and the CLWX-77 Windows fast lane were never reached.
- The post-fix desktop shot and VLM re-grade are still outstanding.

## Owner asks

1. `gcloud auth login` — the credential expiry that parked the lane. The verify script now
   classifies this correctly as BLOCKED with this exact remedy; before the fix it reported the VM as
   `'unknown'` and asked the owner to **start** an instance that was probably already running.
2. Unhold `7add864b` if the `sessions_yield` trim should ship in the next build (still owner-only).

## Artifacts

- `packages-nscc-presence.txt`, `install-artifacts.txt`, `pre-version.txt`, `post-version.txt`,
  `running-binary-attest.txt`, `config-health.json` — install completeness.
- `moe19-desktop-20260906-230435.png`, `moe19-desktop-20260906-230618.png`, `vlm-shots.json`,
  `vlm-grading.md` — real-desktop VLM legs.
- `k10-message-dump.json`, `k10-app-log-tail.txt`, `k10-app-log-turn2.txt` — the K10 false-ANSWERED evidence.
- `turn-k10-fresh-1.txt`, `turn-k10-fresh-2.txt` — the two K10 driver runs (the echoed `answerText`).
- `turn-isolation-simple.txt`, `turn-ondevice-after-toggle-1.txt`, `turn-ondevice-after-toggle-2.txt` —
  the silence-on-send timeout, the dead composer, and the `sessions_yield` stall, as the driver saw them.
  (Copies with a `.txt` extension: `*.log` is gitignored repo-wide, so the originals would not have survived.)
- `isolation-turn-log.txt`, `ondevice-turn-log.txt` — the port-race and stall app-log windows.
- `ondevice-stall-rootcause.md` — the `sessions_yield` RCA.
