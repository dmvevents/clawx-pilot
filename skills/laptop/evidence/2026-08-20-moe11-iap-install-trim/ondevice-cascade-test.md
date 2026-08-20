# On-device tool-cascade re-test — moe.11, qwen2.5:3b-instruct

Guest: `clawx-win-rc-20260609` over IAP. ollama installed on the VM (silent, exit 0),
`qwen2.5:3b-instruct` pulled (1.9 GB), served detached via WMI on `127.0.0.1:11434`.
Tests hit the ollama `/api/chat` API directly, which isolates model tool-calling discipline
from ClawX's turn loop.

## Arm definitions

| Arm | Tools offered |
|---|---|
| `FULL` | the 10-tool catalog: the 9 denied by the trim, plus `exec` |
| `TRIM` | `exec` only — exactly what survives `byProvider['ollama-ollamalo'].deny` |
| `NONE` | no `tools` key at all (documented clean baseline) |

## Result 1 — five varied principal-style prompts

| Arm | Spurious tool calls | Notes |
|---|---|---|
| `FULL` | **2/5** | P1 -> `web_search`, P3 -> `exec` |
| `TRIM` | **1/5** | P1 -> `exec` |
| `NONE` | **0/5** | every prompt answered as text |

## Result 2 — same prompt x6, "What is the capital of Trinidad and Tobago?"

A single knowledge question with no plausible tool need. This is the sharpest discriminator.

| Arm | Spurious tool calls | Text answers |
|---|---|---|
| `FULL` | **6/6** (`web_search` every run) | 0/6 |
| `TRIM` | **4/6** (`exec`) | 2/6 |
| `NONE` | **0/6** | **6/6** |

## Verdict: the trim is a real but PARTIAL mitigation — the blocker is not closed

The monotonic 6/6 -> 4/6 -> 0/6 is unambiguous and reproducible. Two conclusions:

1. **The trim works on what it removes.** With the 9 denied tools gone, the specific documented
   failure modes they caused cannot occur: no `tts` call with no provider ("TTS conversion
   failed"), and no `process` -> `sessions_list` -> `subagents` cascade into the infinite
   `subagents {action:list}` loop. `web_search`, which dominated `FULL` at 6/6, is denied.

2. **Keeping `exec` leaves the defect open in a new shape.** `exec` alone still draws a
   spurious call on **4 of 6** runs of a plain knowledge question. The model's tool-calling
   discipline is the root cause and it attaches to whatever tool remains. Only the
   empty catalog (`NONE`) restores clean answering, and it does so perfectly — 6/6, and
   fastest (2.9s vs 5.5-17s).

**Recommendation (not applied — branch is under HOLD):** add `exec` to
`ONDEVICE_DENIED_TOOLS` in `electron/utils/ondevice-tool-policy.ts`, making the on-device
catalog empty. The `NONE` arm shows that is the only configuration that answers cleanly, and
an on-device principal chat has no need to shell out. This is a one-line change to an existing
list, behind the existing `TRIM_ONDEVICE_TOOL_CATALOG` flag, and provider-scoped so cloud is
untouched.

## Result 3 — does the residual `exec` call hang the turn, or recover?

Answered by simulating ClawX's turn loop: on a spurious `exec` call, feed a tool result back
(`"exec is not available in this context."`) and see whether the model settles into text or
calls again indefinitely. Cap 6 hops, 3 trials.

| Trial | hop1 | hop2 | Verdict |
|---|---|---|---|
| 1 | `TOOL_CALL(exec)` | `TEXT_ANSWER` "The capital of Trinidad and Tobago is Port of Spain." | **TERMINATES** |
| 2 | `TOOL_CALL(exec)` | `TEXT_ANSWER` same | **TERMINATES** |
| 3 | `TOOL_CALL(exec)` | `TEXT_ANSWER` same | **TERMINATES** |

**3/3 self-recover in one hop with the correct answer.** No trial reached the 6-hop cap.

This materially downgrades the residual defect. The original blocker had two failure modes;
with the trim applied, both of the fatal ones are gone and only a benign one remains:

| Failure mode | Status under the trim |
|---|---|
| `tts` call, no provider -> "TTS conversion failed" | **eliminated** (`tts` denied) |
| `process` -> `sessions_list` -> `subagents` infinite loop | **eliminated** (all denied) |
| `web_search` on every knowledge question (6/6) | **eliminated** (denied) |
| spurious `exec`, recovers next hop | **remains — cosmetic latency, not a hang** |

Residual user-visible cost: one wasted round-trip (~5s) on some on-device turns, then the
correct answer. That is not the "Thinking…" -> `incomplete turn detected payloads=0` hang that
made this a go/no-go blocker.

## Revised verdict: the go/no-go blocker is CLEARED; one cosmetic issue remains

The hang is gone and the fix is confirmed active on a real Windows install. Remaining work is
an optimization, not a blocker.

**Optional follow-up (not applied — branch under HOLD):** adding `exec` to
`ONDEVICE_DENIED_TOOLS` would take the last 4/6 to 0/6 and remove the wasted hop, since the
`NONE` arm answers cleanly (6/6) and fastest (2.9s vs 5.5-17s). An on-device principal chat has
no need to shell out. One line, existing list, existing flag, provider-scoped. Worth doing, but
it does not gate a demo.

## Caveats on scope

- These arms hit the **ollama API directly**, which isolates model tool-calling discipline. The
  turn-loop behaviour in Result 3 is a faithful simulation of ClawX's loop, not the loop itself.
  A full in-app on-device chat turn was not run: the guest is on `online` /
  `custom-moecloud/moe-demo-pro`, and flipping `preferredChannel` to `on-device` was out of
  scope for this pass.
- The deny list ClawX actually wrote to guest config was verified independently and matches the
  `TRIM` arm exactly, so the arm is faithful to shipped behaviour.
