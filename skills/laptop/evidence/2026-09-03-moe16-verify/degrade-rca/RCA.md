# CLWX-78 auto-degrade non-firing — root-cause analysis (moe.16, read-only)

**Date:** 2026-09-03  **Build:** 0.4.3-moe.16 (FileVersion confirmed on VM)
**VM:** clawx-win-rc-20260609 (us-central1-a), app left RUNNING, no patching, no renderer edits.
**Method:** repo code-path tracing on the Mac checkout + read-only VM probes (app log, gateway stderr, session JSONL, live provider-accounts snapshot via the app's own IPC bridge). No sends.

---

## Verdict

The auto-degrade was **already dead on the chat surface in both moe.15 and moe.16**. The CLWX-53 wording change (`error-display.ts`) did **not** cause it and did **not** fix it — that change is purely presentational and never touched the degrade wiring.

The real cause is a **path split**: the turn failure reaches the renderer through the **history-poll path** (`loadHistory` → `runError`), which has no degrade wiring, and **wins the race** every time against the streaming-`error` path in `handleChatEvent` where `maybeDegradeChannel` is actually called. On this failure mode the streaming-`error` path never fires a client-visible event at all.

The pure policy is **not** the blocker — it would say "degrade". The call site is simply never reached.

---

## The precise call chain (what actually happened, with timestamps)

Two identical W10 test turns were run (08:28:43 and 08:37:45). Both are the same story; timestamps below are the first.

1. Renderer `sendMessage` posts `chat.send` (deliver:false), sets `sending:true`, `lastSentPayload={text,…}`, `degradedThisTurn:false`. Starts a history poll (first tick +3s, then every 4s) and a 30s stuck-check. `src/stores/chat.ts:2607-2648`.
2. Gateway runs the turn on `custom-moecloud/moe-demo-pro`, hits the hosts-blocked provider, and **retries internally 4×**, persisting a **terminal-error assistant message on the very first failure**:
   - session JSONL: `role:"assistant", content:[], stopReason:"error", errorMessage:"Connection error."` at **08:28:55.873Z** — only **1.4s after the prompt**.
   - gateway stderr (into app log): `embedded run agent end … isError=true … rawError=Connection error.` at 08:28:55 / :59 / 08:29:04 / :13.
3. The renderer's **history poll** fires loadHistory during that window. `applyLoadedMessages` finds the last assistant message after the user boundary, sees `stopReason==='error'`, and sets **`runError = "Connection error."` directly** — `src/stores/chat.ts:2286-2295`. It does **not** call `maybeDegradeChannel` and does **not** reset `sending`.
4. The banner renders: `principalErrorDisplay("Connection error.")` → `classifyFailure` matches `/connection error/i` → kind `unreachable` → *"The online assistant could not be reached. Your work is safe — try again, or switch to 'On this device'."* — this is exactly the text the driver captured, and the driver saw it at **elapsed 18.7s (≈08:29:02)**, i.e. **before** the gateway run even ended (08:29:13).
5. Gateway makes its own terminal call at 08:29:13: `embedded run failover decision … decision=surface_error reason=timeout`. **No client-visible streaming `error` event corresponds to a `maybeDegradeChannel` invocation** — see below.

**Proof the degrade hook never ran:** the `degradeChannel` POST would log `[settings] Degraded channel without persisting preference` (`electron/api/routes/settings.ts:120`). That line is **absent at every timestamp**, including 08:29:13. So `maybeDegradeChannel` never reached its POST (`src/stores/chat.ts:1718`).

---

## Which condition failed, and where

`maybeDegradeChannel` is invoked from **exactly one place**: the streaming-`error` case of `handleChatEvent`, gated on `hadLocalSendInFlight` — `src/stores/chat.ts:3153-3154`. That case is what sets `runError` **and** kicks the failover (`3123-3134` then `3153`).

But `runError` can also be set from a **second, independent place** that has no failover wiring: `loadHistory`'s `applyLoadedMessages` — `src/stores/chat.ts:2286-2295`.

On this VM the gateway surfaces the failure by **persisting a terminal-error message fast** (1.4s) and lets the run keep retrying; it does **not** emit a per-retry client-visible streaming `error` event, and by the time the run ends the turn is already visibly errored via the poll path. So:

- The **policy inputs are all satisfied** (verified live, not assumed):
  - `preferredChannel = "online"` (IPC read: `{"value":"online"}`).
  - online account present: `moe-cloud-gateway` (`vendorId:"custom"`, remote baseUrl → classifies **online**).
  - on-device account present, enabled, **with a model**: `ollama-local-qwen2.5-3b-instruct` → `model:"qwen2.5:3b-instruct"`, localhost baseUrl → classifies **on-device**. So `onDeviceAvailable = true`.
  - Therefore `shouldDegradeToOnDevice("Connection error.", {activeChannel:"online", onDeviceAvailable:true, alreadyDegraded:false, toolsRan:false, haveMessageText:true})` returns **`{degrade:true, resend:true, reason:"unreachable"}`**.
- **The failed condition is not in the policy — it is that the call site is never reached.** The surfacing path that wins (loadHistory) has no `maybeDegradeChannel` call.

**Was auto-switch already dead pre-moe.16?** Yes. In moe.15 the V-batch showed the RAW banner + no degrade. That raw banner was the *same* `runError` set by the *same* loadHistory path (rendered raw because `error-display.ts` did not yet exist). CLWX-53 only changed how `runError` is *rendered*; it never changed which path *sets* it, and never added a degrade call to that path. So the degrade hook has been on the losing path in both builds.

---

## Recommended fix (one-line-ish, single location)

Wire the degrade trigger into the **history-surfacing path** so both paths that set `runError` also give the failover a chance. In `applyLoadedMessages`, immediately after the `set({ …, runError: latestTerminalAssistantErrorMessage })` at `src/stores/chat.ts:2291-2296`:

```ts
// A cloud turn can also surface its terminal error via the history poll (the
// gateway persists the error message before/without a streaming `error`
// event). Give the failover the same chance it gets in handleChatEvent.
// Gated on lastSentPayload (this client owns the turn — mirrors the
// hadLocalSendInFlight intent, and unlike `sending` it is never set for a
// run adopted from the console). maybeDegradeChannel is idempotent per turn
// via `degradedThisTurn`, so repeated polls cannot double-fire.
if (latestTerminalAssistantErrorMessage && get().lastSentPayload?.text?.trim()) {
  const toolsRan = postBoundaryMessages.some((m) =>
    Array.isArray(m.content) && (m.content as Array<{ type?: string }>)
      .some((b) => b.type === 'toolCall' || b.type === 'tool_use'));
  void maybeDegradeChannel(set, get, latestTerminalAssistantErrorMessage, toolsRan);
}
```

Why this is safe and sufficient:
- `maybeDegradeChannel` already claims `degradedThisTurn` synchronously before any await (`chat.ts:1715`), so the 4s poll cannot fire it twice for one turn, and it can't collide with the handleChatEvent path if that ever also fires.
- Gating on `lastSentPayload` (not `sending`) matches the existing "don't replay a console-typed turn" guard — `sending` is set true for adopted runs (`chat.ts:2829/2839`), `lastSentPayload` is only ever set by this client's `sendMessage`.
- The policy already blocks auto-resend when tools ran; passing a computed `toolsRan` preserves that (channel still degrades, principal resends).

Scope note: this is the surgical fix for the observed defect. The deeper cleanup (collapsing the two `runError`-setting paths into one, or resetting `sending` in the loadHistory terminal-error branch so the composer doesn't stay in a sending state alongside the error) is worth a follow-up but is not required to close CLWX-78's auto-degrade leg.

---

## Evidence files (this dir)
- `vm-logs-scan.txt` — app log windows, all-day chat/failover markers, and the two newest session JSONL tails (the persisted `Connection error.` terminal messages + `failover decision … surface_error`).
- `vm-accounts-snapshot.txt` — live `/api/provider-accounts` + `preferredChannel` read through the renderer's own IPC bridge (secrets masked); proves onDeviceAvailable=true and preferredChannel=online.
- Turn-level driver JSON + screenshots are one level up in `../turn-evidence/w10/` (both runs: `channelSwitched:false`, `degradeNoticeSeen:false`, `runErrorSeen:true`, verdict `ABORTED_ERROR_BANNER`).
