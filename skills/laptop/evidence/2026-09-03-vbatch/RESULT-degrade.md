# STAGE 2c — W10: cloud→on-device degrade under cloud-unreachable (vbatch)

**Verdict: FAIL — degrade did NOT engage.** The failure was *visible* (red run-error banner, not silence), but the turn did not fail over to the on-device model even though ollama + qwen2.5:3b-instruct were up and warm. Root cause pinned to a classifier gap, confirmed offline against the exact production patterns.

- **Date:** 2026-09-03 04:00 UTC (VM clock)
- **Host:** GCP VM `clawx-win-rc-20260609`, guest `clawxtest`, over IAP; installed 0.4.3-moe.15; app in console session 1, CDP :9223
- **Raw logs in this dir:** `vbatch2-ollama-probe.log`, `vbatch2-ollama-start.log`, `vbatch2-hosts-block.log`, `vbatch2-degrade-out.log`, `vbatch2-hosts-restore.log`; screenshots + driver JSON in `degrade-artifacts/`

## Method

1. **On-device precondition:** ollama was installed (`%LOCALAPPDATA%\Programs\Ollama`) with `qwen2.5:3b-instruct` pulled but the server was NOT running (port 11434 closed). Started `ollama serve` via an interactive scheduled task; `/api/tags` OK; warm-up generate completed in **15 s** ("OK, I'm here") — so the on-device lane was warm and demonstrably able to answer *before* the test. Provider `ollama-ollamalo` (127.0.0.1:11434) is configured in `openclaw.json`.
2. **Cloud kill:** hosts-file block `127.0.0.1 clawx-litellm-gateway-eoydffbcrq-uc.a.run.app` (the custom-moecloud LiteLLM broker) + `ipconfig /flushdns`; verified resolution to 127.0.0.1 (`STATE: BLOCK_ACTIVE`). Hosts backed up first.
3. **One chat turn** driven through the real UI over CDP (`vbatch-degrade-driver.js`, a no-abort variant of the recorded-usecase driver): prompt "In one short sentence, what should a principal include in the daily report?", channel already `online`.
4. **Restore:** hosts restored from backup + flushdns; broker resolves publicly again (`STATE: RESTORED`).

## FACTS (driver JSON `degrade-artifacts/degrade-2026-09-03T04-00-31-107Z.json`)

| Observation | Value |
|---|---|
| channelBefore / channelFinal | `online` / `online` (no switch) |
| Run error banner | **SEEN** at ~15 s: **"Model call failed Connection error."** (`data-testid="chat-run-error"`) |
| Degrade notice (`chat-degrade-notice`) | **NEVER appeared** |
| On-device answer | none — no resend happened |
| Screenshot | `degrade-final-2026-09-03T04-00-31-107Z.png`: red "Model call failed / Connection error." banner, composer toggle still "Online" |

## ANALYSIS — root cause (confirmed, not speculation)

`src/stores/chat.ts::maybeDegradeChannel` short-circuits when `classifyFailure(errorMsg) === 'other'`. The gateway surfaces a TCP-refused provider on Windows as **"Model call failed Connection error."** ("Connection error." is the OpenAI-SDK `APIConnectionError` message, propagated by the openclaw gateway). Checked that exact string against the production pattern lists in `src/lib/channel-degrade.ts` (UNREACHABLE / RATE_LIMIT / NEVER_DEGRADE): **no pattern matches — classification = `other` → fail-closed → no degrade.** The nearest pattern, `/(?:socket|connection) (?:hang up|closed|timeout)/i`, does not cover "connection error".

So the fail-closed design worked as coded, but the pattern list is missing the *single most common* real-world unreachable signature this stack emits on Windows. The offline gap named in `docs/OFFLINE_ARCHITECTURE.md` §3.1 (bde78d94 was meant to close it) is still open on this build for the connection-refused case: the principal gets a dead "Online" turn with an error banner, and the warm on-device model sits unused.

**Fix direction (not applied):** add `/connection error/i` (and consider `/APIConnectionError/`) to `UNREACHABLE_PATTERNS`, ordered after NEVER_DEGRADE so 401/403 wins stay intact; re-run this exact scenario.

## Caveats

- One nuance vs the design intent: the failure is not *silent* — the banner shows. What is missing is the failover + notice + on-device answer.
- The driver's own `verdict=ANSWERED_NO_DEGRADE` / `answerText` is an artifact of a settle-heuristic misfire (it latched the echoed user message, "…just now"); the operative fields are `runErrorSeen/runErrorText`, `degradeNoticeSeen=false`, `channelFinal=online`, and the screenshots.
- Residual state on guest: ollama left RUNNING (scheduled task `VbatchOllamaServe`), hosts file RESTORED and verified, backup kept at `C:\Users\clawxtest\hosts.vbatch-backup`.
