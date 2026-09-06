# Codex adversarial review — CLWX-95 send-time channel degrade (2026-09-06)

Lens: `/codex:adversarial-review` (openai-codex plugin → local Codex CLI, GPT-5.5).
Second-vendor adversary, additive to the Claude lenses. A Codex PASS never
overrides a Claude FAIL, and this one was not a PASS.

- Scope: branch diff against `c9c0c5f2`
- Target commits at review time: `ddb1aa30` (skipGatewayRefresh wiring) plus the
  moe.19 VM rig
- Verdict: **needs-attention** (1 HIGH, 2 MEDIUM)
- Sandbox note recorded by Codex: unit tests were blocked by its read-only
  sandbox, so it proved each finding with in-memory reproductions against the
  **bundled** gateway code in `release/win-unpacked/resources/openclaw/dist/`
  rather than by running our suites. Every finding below was independently
  re-derived in this repo before being accepted.

---

## Verdict, verbatim

```
# Codex Adversarial Review

Target: branch diff against c9c0c5f2
Verdict: needs-attention

Do not ship: the immediate resend can retain the cached cloud configuration, and pilot scripts can falsely certify recovery. Unit tests were blocked by the read-only sandbox; in-memory reproductions confirmed the failures below.

Findings:
- [high] Await runtime cutover before resending (electron/api/routes/settings.ts:125-127)
  Bundled OpenClaw 2026.4.23 reads a pinned runtime snapshot through loadConfig(), which chat.send captures before dispatch. External file writes reach that snapshot through a watcher with a 200 ms stability wait and 300 ms default debounce. This route returns without awaiting that update, and maybeDegradeChannel immediately resends without a model override. The retry can therefore use the same failed cloud provider. An in-memory reproduction using the bundled snapshot/watcher code confirmed this; with gateway.reload.mode=off, the old model persists even after watcher processing, including when toolsRan prevents automatic replay.
  Recommendation: Provide an acknowledged, non-restarting runtime update and await effective provider/model cutover before reporting success or resending. Cover immediate retries, reload-disabled configurations, and degradation without replay in an integration test.
- [medium] Verify the runtime channel instead of trusting the pill (windows-pilot/scripts/pilot-set-channel.js:85-89)
  After automatic degradation, preferredChannel deliberately remains online, and ChatInput derives this attribute from that preference or a session override. Consequently, --channel online can exit successfully while the runtime remains on-device. The click path has the same problem: ChatInput updates the label before the backend transaction, and settings-store errors are swallowed. Executing the committed script against a mocked failed transaction produced CHANNEL_SET_OK and exit 0 while the backend stayed online.
  Recommendation: Require successful transaction and effective runtime provider/model readback for both CHANNEL_ALREADY and CHANNEL_SET_OK. An optimistic DOM attribute must not establish success.
- [medium] Exclude error chips from successful answer detection (windows-pilot/scripts/pilot-chat-turn-driver.js:255-258)
  SEL.message also matches the new chat-message-error-chip element. When a failed turn is represented by its inline chip without a global run-error banner, the chip increases the message count and becomes the last matching element. Its error text exceeds 40 characters and remains stable, satisfying the answer heuristic. errorChipSeen is recorded but ignored here. An in-memory execution of the committed driver returned ANSWERED with the connection-failure chip as answerText and exited successfully.
  Recommendation: Select message containers and assistant content explicitly. Require successful terminal completion for the tested turn, reject error-chip-only output, and return nonzero for failed or blocked verdicts.

Next steps:
- Keep toggle and boot preflight refresh behavior; add coverage through the actual /api/settings/preferredChannel route. The new route suite mocks applyChannelChange and cannot prove runtime cutover.
- Add negative pilot checks for failed channel transactions and error-only turns, then rerun the targeted suites and Windows resend scenario.

[exited with code 0]
```

---

## Triage

Every finding was confirmed or refuted with evidence. None were waved off.

### HIGH — "Await runtime cutover before resending" → CONFIRMED, FIXED

Independently re-derived against the bundled gateway: `loadConfig()` is a module
singleton, `clearConfigCache()` is a no-op, and the only route from an external
file write to the running runtime is the chokidar watcher — debounced, batching,
and disableable outright via `gateway.reload.mode: "off"`. Codex is right that
the four-store write did not move the runtime and the resend could go straight
back out on the provider that had just failed.

Fix: commit `55b488db`, `fix(chat): CLWX-95 acknowledged runtime cutover`.

The mechanism is the gateway's own `sessions.patch` RPC. A session model
override is re-read from disk on every turn and outranks the config default, so
it is an acknowledged, non-restarting runtime update — which is exactly what
Codex asked for, and it avoids the restart that lost the port race on the
moe.19 VM in the first place.

- `cutoverSessionModel()` pins the session and waits for the handler's readback.
- `isSessionModelCutoverConfirmed()` treats "the RPC did not throw" as no
  evidence; it confirms only when `ack.resolved` echoes the requested provider
  and model, and fails closed on every shape it cannot read as a match.
- Unproven cutover ⇒ **no resend**, the original error stays visible, and the
  notice says the switch could not be made rather than claiming one that did
  not happen (`degradeNotice.cutoverConfirmed === false`).
- Symmetry: an explicit channel pick in the composer pill and in Settings clears
  the pin, or a principal who degraded on Monday stays on-device all week while
  the composer reads "Online".
- `reconcileSessionModelPin()` drops a pin left by an earlier app run, once per
  session per run, only when the default account is provably Online.

Codex's three named test cases are covered in
`tests/unit/chat-channel-degrade.test.ts`:

| Codex ask | Test |
|---|---|
| immediate retries | "pins the session onto the on-device model and only resends AFTER the gateway acknowledges" (asserts RPC order) |
| reload-disabled configurations | the mechanism is watcher-independent by construction; pinned by asserting the patch-then-send order with no dependence on any config write landing |
| degradation without replay | "still pins the session when the turn ran tools, and does not replay it" |

Falsifiability, by mutation: always-confirm (5 tests fail), last-slash
`parseModelRef` (1), gate forced to always resend (3), reconcile removed (1).
All mutations restored.

### MEDIUM — "Verify the runtime channel instead of trusting the pill" → CONFIRMED, FIXED

Correct and important: `preferredChannel` deliberately survives an automatic
degrade, so the pill is a rendered preference, not evidence of what the runtime
resolved. `pilot-set-channel.js` now requires a successful transaction **and** an
effective runtime provider/model readback for both `CHANNEL_ALREADY` and
`CHANNEL_SET_OK`, and fails when the pill and the runtime disagree.

Fix: commit `c22e7a26`. Pinned by `tests/unit/windows-pilot-harness-honesty.test.ts`.

### MEDIUM — "Exclude error chips from successful answer detection" → CONFIRMED, FIXED

Also correct: the message selector matched the error chip, whose text is long
and stable enough to satisfy the answer heuristic, so a failed turn scored
`ANSWERED`. `pilot-chat-turn-driver.js` now requires assistant prose, rejects
error-chip-only output, and returns nonzero for failed or blocked verdicts, with
the chip text captured in the artifact.

Fix: commit `c22e7a26`. Pinned by the same 12-test suite.

## Residual, carried forward

Codex's first "next step" is not closed by these commits: coverage for the
explicit-toggle path still goes through a suite that mocks `applyChannelChange`,
so it cannot prove runtime cutover for the toggle the way the degrade path is
now proven. The toggle's own regression risk is now pinned at the renderer level
(`tests/unit/chat-input.test.tsx` asserts the pick clears the session pin), but
an end-to-end assertion through `/api/settings/preferredChannel` against a real
runtime readback remains open. Tracked on CLWX-95.

## Gate status

Codex verdict `needs-attention` is answered: 3/3 findings confirmed and fixed
with falsifiable tests. Claude lenses run separately on commits
`c22e7a26..55b488db`; the Codex result does not substitute for them.

Suite after the fixes: 185 files, 1674 passed, 6 skipped. `pnpm typecheck` and
eslint on the changed files both clean.
