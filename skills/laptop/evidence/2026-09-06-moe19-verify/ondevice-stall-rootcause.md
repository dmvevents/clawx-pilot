# On-device turn stalls on a top-level `sessions_yield` — moe.19 VM, 2026-09-06

Second defect found by the moe.19 Windows VM verify, distinct from the
silence-on-send gateway race (which is fixed at source in this same tick).

## Symptom the principal sees

Assistant bubble appears, an execution step reads `sessions_yield {}`, and no
answer text ever renders. The turn never terminates — no error, no timeout, no
"something went wrong". Just a bubble that never fills. Indefinite, not slow.

## Observation (driver JSON, fresh session)

```
freshSession: true          composerPlaceholder: null
messagesBefore: 0           messagesAfter: 2
executionSteps: ["sessions_yield {}"]
toolNames: ["sessions_yield"]
degradeNoticeSeen: false    runErrorSeen: false
answerText: null            settled: false
verdict: TIMED_OUT_MID_TURN (300s budget)
```

Preconditions all clean, so none of the usual suspects apply:

| Precondition | State | How proven |
|---|---|---|
| Channel | `on-device`, four stores coherent | set via the composer pill (`pilot-set-channel.js`), CHANNEL_BEFORE online → CHANNEL_AFTER on-device |
| Gateway | stable, no bounce during the turn | `mode=restart result=applied pidAfter=140`, no degrade notice, no run error |
| Session | provably empty before the send | `--new-session`, `messagesBefore: 0` |
| Model | responsive | see below |

## The model is not the bottleneck

Direct generate against the same guest ollama, same model:

```
POST http://127.0.0.1:11434/api/generate  {"model":"qwen2.5:3b-instruct","prompt":"Reply with exactly: ready","stream":false}
OLLAMA_DIRECT_OK elapsed_s=8.2
RESPONSE=ready
EVAL_COUNT=2 EVAL_DURATION_S=0.1
```

8.2s wall (nearly all model load + prompt eval; 0.1s decode) against a 300s
turn budget. Corroborating: ollama pid 700 held only 58 CPU-seconds of
*lifetime* CPU — nowhere near 300s of generation on 4 vCPUs.

So the turn is stalled in the agent/tool loop, not waiting on tokens.

## Root cause

`sessions_yield` is session-control plumbing for a *spawned* sub-session: it
hands control back to the parent. The renderer models it exactly that way —
`src/pages/Chat/task-visualization.ts:147` treats a `sessions_yield` step as the
closer of the active branch (`activeBranchNodeId = null`).

At top level there is no branch and no parent to yield to. The 3B on-device
model picks the tool anyway on a plain question, and the turn parks forever.

This is the non-self-recovering variant of the known on-device tool-cascade
class. The previously observed residual was a spurious `exec`, which
self-recovers and was therefore triaged cosmetic. `sessions_yield` does not
self-recover: the turn has no terminal state at all.

## Why our own harness hid it

`windows-pilot/scripts/pilot-electron-cdp-probe.js:342` already prompts around
this defect:

> "Use only direct tools in this session; do not use sessions_spawn,
> sessions_yield, subagents, or background sessions."

That instruction lives only in a *test probe*. It is not in the product persona
or system prompt, so a principal typing an ordinary question is unprotected —
and every eval run through that probe was steering the model away from the
defect instead of measuring it. The turn driver used here carries no such
instruction, which is why it surfaced.

Lesson, same shape as the `skipGatewayRefresh` dead-code lesson from this tick:
a harness that prompts around a defect reports GREEN over a broken product.

## Falsifiable next step (not executed — see gating)

Predicted fix layers, cheapest first:

1. Trim session-control tools (`sessions_spawn`, `sessions_yield`, subagent
   tools) out of the catalog exposed to the on-device channel. Branch
   `fix/tool-catalog-trim` @ 7add864b already carries this work and is **under
   owner HOLD** — not unheld here.
2. Terminal turn watchdog so no tool-loop stall can render as an infinite
   spinner; the principal gets a plain "I couldn't finish that" instead.
3. Persona-level instruction mirroring the probe's, as defence in depth.

Falsifiability for any of them: re-run the same fresh-session no-tool prompt
with the fix reverted and the turn must again produce `sessions_yield` with no
answer; with the fix in place it must produce answer text.

## Scope note

Environment context, recorded so it is not mistaken for product behaviour: this
VM is 4 vCPU / 16 GB and CPU-starved. After a gateway restart the process needed
~2.5 minutes to answer its first RPC (`system-presence` probe failing
19:48:20 → 19:49:43, succeeding 19:50:13) and `chat.history` still timed out at
35s and 30s. That is VM slowness, not the stall above — the stall is unbounded
and reproduced with the gateway already responsive. It does, however, raise the
cost of any mid-session gateway restart, which is exactly what the
`skipGatewayRefresh` fix removes from the send path.
