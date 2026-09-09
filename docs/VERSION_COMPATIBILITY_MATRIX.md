# Version compatibility matrix

Why this exists: on 2026-09-09 chat was found to be **impossible** on a fully
package-verified installer. The app pinned WebSocket protocol 3 while the bundled
gateway required 4, so every connect was refused and the composer never enabled
([CLWX-138](bugs/CLWX-138-gateway-ws-protocol-mismatch.md)). Nothing in the build
or the release gates compared those two numbers, and the defect surfaced only on an
installed machine.

This document records the contracts that must agree, the values per lineage, and
the gate that should fail a build when they do not.

## The coupled contracts

Each row is a pair of values that must agree. A build that changes one side without
the other is broken even when every other check is green.

| # | Contract | Where side A lives | Where side B lives | Failure if they disagree |
|---|---|---|---|---|
| 1 | **Gateway WS protocol** | `electron/gateway/ws-client.ts` — `minProtocol`/`maxProtocol` in the connect frame | the bundled `openclaw` version's required protocol | Composer permanently disabled; **no model turn is possible**. This is CLWX-138 |
| 2 | **Native module ABI** | Electron's Node ABI (NMV) for the packaged Electron | `better-sqlite3` and other native modules compiled per-runtime | Startup crash, `Cannot find module` or ABI mismatch |
| 3 | **On-device model id** | `LOCAL_MODEL_ID` in `electron/main/local-provider-seed.ts` | the tag a principal actually pulls (`docs/FIRST_RUN_GUIDE.md`), and any bundled weights | Model reported missing after a multi-gigabyte download. Found with four different names in play |
| 4 | **Runtime dependency classification** | `dependencies` vs `devDependencies` | what electron-builder keeps in the asar | `Cannot find module` at runtime; the moe.10 `playwright-core` class |
| 5 | **pnpm / Node toolchain** | `package.json#packageManager` | the toolchain a build host actually uses | Non-reproducible or subtly different compiled output |
| 6 | **Pricing-cache patch target** | `TARGET_OPENCLAW_VERSION` in `scripts/openclaw-pricing-cache-patch.mjs` | the bundled `openclaw` version | The patch throws, or silently targets a version that is not shipped |

## Contract 1 in detail — the one that broke

The gateway logs both sides of the negotiation in a single line, which is what made
the diagnosis certain:

```
[ws] protocol mismatch client=ClawX ui v0.1.0 min=3 max=3 expected=4 probeMin=3
```

Two properties of that line matter for gate design:

- **`expected=4`** — the bundled gateway states its requirement explicitly, so it is
  machine-extractable rather than a matter of inference.
- **`probeMin=3`** — the gateway's *liveness probe* still accepts the old protocol.
  So the TCP port opens, a port check passes, and an app-level readiness probe
  passes, while every real connect is refused. **Any acceptance signal derived from
  "a port is listening" is structurally incapable of detecting this class of
  defect**, including a hardened check that requires an owned, stable listener held
  for a contiguous window. Assert a real connect.

**The design defect is `min === max`.** Pinning the range to a single value turns
every gateway upgrade into a hard break instead of a negotiation. Offering a range
lets the gateway select the highest mutually supported version.

## Values by lineage

Two lineages are live and they differ. Confusing them is easy and has already caused
one wrong conclusion, so both are recorded.

| | Candidate `release/moe30-integration` @ `40cfe727` | Docs branch `fix/doc-tooling-steering` |
|---|---|---|
| App version | `0.4.3-moe.30` | `0.4.3-moe.21` |
| Bundled `openclaw` | **2026.9.2** | 2026.4.23 |
| WS protocol offered by app | **`[3, 3]`** — the defect | `[3, 4]` after the fix |
| WS protocol required by that gateway | **4** | 3 |
| Contract 1 satisfied? | **NO** | yes, trivially |
| Installed exe sha256 | `93f5a781…7fb411a8` | not built |
| Installer sha256 | `9f8a2dc5…0114aff7` | not built |
| `app.asar` sha256 | `366c3166…a7bfba02` | not built |
| On-device model id | `qwen2.5:3b-instruct` | `qwen2.5:3b-instruct` |

The candidate's `openclaw` pin matches its shipped bundle exactly — **there is no
version drift in packaging**. The break came from commit `ad88d71c`, which bumped
OpenClaw to 2026.9.2 inside the candidate lineage while leaving the protocol pin at
`[3, 3]`.

**Consequence for the fix.** The protocol fix authored as `2e6cce24` is on the docs
branch and is **not an ancestor of the candidate**, so the lineage that carries the
fix does not need it and the lineage that needs it does not have it. Worse, the docs
branch bundles `openclaw` 2026.4.23, which speaks protocol 3 — so its unit tests
**cannot exercise the protocol-4 path at all**. Those tests passing is true and
irrelevant. The fix has to land on a candidate lineage that bundles 2026.9.2, and be
verified by an installed run.

## A gap in the artifact verification already performed

The moe.30 package verification proved the shipped compiled output byte-identical to
an independent compile of the same revision — but only for `dist` (169 files) and
`dist-electron` (3 files), which is what the build's own receipt hashes.
**`build/openclaw` is shipped through `extraResources` and was never hash-compared
to source.** So the reproducible-compile result covers the application code and not
the bundled gateway. The matrix must cover the gateway bundle's identity too, not
only the app's.

## The gate this document argues for

A preflight assertion, run where the bundled gateway is available:

1. Read the app's offered range from `electron/gateway/ws-client.ts`.
2. Extract the bundled gateway's required protocol from the bundle.
3. **FAIL** when the required version is outside the offered range, naming both.
4. **FAIL as indeterminate** when the required version cannot be extracted — a check
   that silently passes when it cannot see the answer is worse than no check, which
   is precisely how this defect survived.

Sequencing note: `pnpm run preflight` currently runs typecheck, lint, PowerShell
lint, agent doctor, vitest and the doc-tooling harness — all *before* the gateway is
bundled. Contract 1 therefore belongs with `scripts/verify-openclaw-bundle.mjs`,
which already runs immediately after `bundle-openclaw.mjs` in the `package` script
and is where the bundled gateway first exists on disk.

## Gate status — contract 1 is implemented and proven

Implemented in `scripts/verify-openclaw-bundle.mjs`, which runs immediately after
`bundle-openclaw.mjs` in the `package` script and inside `ga-gate.mjs`. It extracts
the offered range from `electron/gateway/ws-client.ts` and the gateway's requirement
from the bundle, using two signals read from real bundles rather than assumed:

1. `expected=(\d+)` in a dist file that mentions `protocol mismatch` — the gateway
   naming its own requirement. Present in 2026.9.2.
2. Fallback: the modal `maxProtocol ?? N` across dist. 2026.4.23 carries 3;
   2026.9.2 carries 4.
3. Neither found → **INDETERMINATE and FAIL**, never a pass.

It also fails when `minProtocol === maxProtocol`, because pinning is the underlying
defect rather than a stylistic choice.

Proven with both controls:

| Control | Setup | Result |
|---|---|---|
| Positive | app offers `[3,4]`, bundled 2026.4.23 requires 3 | **PASS** — "gateway protocol contract satisfied" |
| Negative | the candidate's real `ws-client.ts` (`[3,3]`) against the shipped 2026.9.2 dist | **FAIL** — names `dist/message-handler-BVsRq2bA.js`, both numbers, and the pin |

The negative control is the one that matters: it reproduces CLWX-138 from the exact
files that shipped, so this gate would have failed `ad88d71c` at build time.

**Contracts 2–6 remain unguarded.** Contract 3 was found broken by inspection today
(four model names in play) and corrected, but nothing asserts it.

## Rules

- A change to either side of any contract above requires the other side to be
  re-verified in the same change, not in a follow-up.
- Record the matrix row for a candidate before claiming installed acceptance.
- Never treat a listening port, a liveness probe, or a green upload step as evidence
  that the contract holds.
- Keep lineages distinct in every claim: name the branch and the commit, because the
  candidate and the docs branch legitimately differ.
