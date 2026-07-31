# Clean-slate rebuild findings — 2026-07-31

**Purpose:** After the config-cascade incident (see `CASCADE-INCIDENT.md`), moved `~/.openclaw` and `%APPDATA%\Ministry of Education` aside and let the app rebuild from scratch. Hammered the fresh state to reproduce failure classes reliably.

## What clean-slate produced

| Config store | Result on fresh install |
|---|---|
| `settings.json` | ✅ Written with `setupComplete: true`, `preferredChannel: online`, `selectedBundles: [principal]`, `gatewayToken` |
| `openclaw.json` providers block | ✅ Both `custom-moecloud` and `ollama-ollamalo` written |
| `openclaw.json` **agents block** | ❌ **NOT WRITTEN** — this is the root cause of the cascade |
| `openclaw.json` **channels block** | ❌ **NOT WRITTEN** |
| `clawx-providers.json` | ✅ Written, but `defaultProvider` (top-level) is empty string; only `defaultProviderAccountId` populated |

## The single root-cause bug (BUG-012 / atlas §19)

**On fresh install, `openclaw.json` has NO `agents` block.** Gateway boots but has nothing to route with — `configuredChannelCount: 0` in every prelaunch metric.

**Chain of cause:**
1. `gateway-plugin-config-seed.ts` writes providers + plugin placeholders (good)
2. `runChannelPreflight()` runs at `electron/main/index.ts:564`
3. It calls `applyChannelChange()` which calls `setAllAgentsModel(modelRef)` at `electron/utils/agent-config.ts:696`
4. `setAllAgentsModel` reads config, calls `normalizeAgentsConfig` which sees `config.agents === undefined` and synthesizes a fake main entry (`syntheticMain: true`)
5. Lines 715-726: because `syntheticMain: true`, the code deliberately writes ONLY `agents.defaults`, NOT `agents.list`
6. Gateway reads config — `agents.list` empty → no channel → RPC router never comes up → chat.history times out → renderer stuck in loading

**Fix location:** `electron/utils/agent-config.ts:715-726` OR `electron/main/gateway-plugin-config-seed.ts` — one of these needs to also seed a minimal `agents.list = [{id: 'main', model: {primary: modelRef}, channel: 'online'}]` on first-run.

**Alt fix:** debug why the `agents.defaults.model.primary` write is not enough for Gateway to bind a channel. If it should be enough, then Gateway's config reader is the bug.

## Verified: patching agents block manually fixes the boot cycle

Ran step-33 (added `agents.defaults.model.primary = 'custom-moecloud/moe-demo-pro'` via no-BOM write):

- Gateway came up at t=60s (was NEVER before on clean-slate)
- Stayed steady for 200+ seconds until externally killed
- No crash cascade

## Other bugs observed during hammering

### BUG-009: RPC timeout: system-presence noise (non-fatal but log-spammy)

Even with the agents block present, the Gateway ready-fallback RPC probe fails ~10 times before `gateway.ready` fires normally. Every failure logs `RPC timeout: system-presence` with a stack trace. Adds 30-60s to visible boot time. Confusing to reviewers.

**Fix location:** the ready-fallback timeout / retry logic. Should either silently retry OR the probe should NOT run before the gateway.ready event fires normally.

### BUG-010: `Ministry context merge: 4 startup file(s) still missing after 5 retries`

On fresh install, 4 files (presumably AGENTS.md, TOOLS.md, or moe-principal-assistant scaffolding) are expected but missing. Related to atlas §17 (extension path change to `resources/extensions/` on Lane A).

**Fix location:** search for `Ministry context merge` in codebase; the file list is hardcoded somewhere.

### BUG-011: `chat.history` RPC times out (35s)

The renderer's initial `chat.history` request times out when Gateway is in the RPC-not-ready state. Would show as a permanent loading spinner. User-visible.

### BUG-013: CDP :9223 never bound on clean-slate boot

On the earlier "carried-over user state" install, CDP :9223 was open. After clean-slate, it never came up during the 6-minute probe. **Hypothesis:** the `--remote-debugging-port=9223` flag is only passed when the app detects a specific dev-mode marker in user state.

Impact: cannot drive the app remotely via CDP tunnel on a truly fresh install. Would need to launch with explicit env var or CLI flag.

## Recommendation: patch agents-block seeding in production code

The cleanest fix is at `electron/utils/agent-config.ts` — remove the `syntheticMain` guard and always materialize `agents.list = [{id: 'main', ...}]` on first-run. The comment at lines 715-726 says the guard exists to prevent "size-based last-good validator" rollback — that validator should be updated instead.

**Path forward:**
1. Read the size-based validator (grep `last-good`, `size-based`)
2. Understand why it rolls back a `smaller-than-expected` file
3. Fix the validator to distinguish "grew from empty" from "shrunk from populated"
4. Then remove the `syntheticMain` guard so first-run seeds a proper agents.list

**Or the quick fix:** in `runChannelPreflight`, BEFORE calling `applyChannelChange`, explicitly seed a minimal agents block via `setAllAgentsModel` with `forceListMaterialize: true` (new param). Then the size-validator concern goes away because the FIRST write is the one that materialises the list.

## What the user should know

1. **The Lane A install has a first-run bug.** Any fresh install (or any state-wipe followed by relaunch) will produce a broken openclaw.json missing the agents block. This is BUG-012.
2. **On installs that inherit prior state, the app works** (that's why our earlier session succeeded — we upgraded moe.10 → Lane A on an existing user profile that already had a valid agents.list).
3. **Ministry principals doing a fresh install would hit this.** This is a GA blocker.
4. **The workaround is documented above** (step-33 pattern) — but needs to be a code fix before shipping.

## Bugs fully-documented from this session

| # | Bug | Severity | Fix location |
|---|---|---|---|
| 001 | Hidden-launch Gateway self-restart trap | MED | `electron/main/index.ts` — guard start:finally on window visibility |
| 002 | localStorage not mirroring settings.json (§12 drift visible in UI) | LOW | renderer bootstrap IPC listener |
| 003 | Ollama not installed on laptop | FIXED | ScheduledTask installed |
| 006 | `moe-principal-assistant` path move breaks scripts | MED | `pilot-check-install-artifacts.ps1` |
| 007 | qwen2.5:3b hangs on tool-check loop | HIGH | swap to hermes3:8b as on-device default |
| 008 | PowerShell BOM write regression | FIXED | documented in memory |
| **009** | **RPC timeout: system-presence noise (non-fatal but confusing)** | **LOW** | **Gateway ready-fallback retry logic** |
| **010** | **Ministry context merge: 4 startup files missing** | **MED** | **hardcoded file list in seed path** |
| **011** | **chat.history RPC times out 35s** | **HIGH** | **cascades from BUG-012** |
| **012** | **Fresh install: agents block never seeded — root cause of RPC cascade** | **CRITICAL** | **electron/utils/agent-config.ts:715-726** |
| **013** | **CDP :9223 never binds on clean-slate boot** | **LOW** | **build config or dev-mode marker check** |

**Total: 11 bugs identified this session. 3 already fixed. 8 remaining.**
