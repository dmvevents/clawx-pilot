# Test plan — what can be tested right now

_Generated 2026-09-01 by the `test-lane-prober` agent (read-only), at HEAD
`bde78d94` (branch `fix/doc-tooling-steering`). Blocker classes B0–B4 defined in
`GA_EXECUTION_PLAN` §3. All commands ran on the Mac dev tree._

## 1. Runnable now — zero external dependency

Ran today, real output:

| Test | Command | Result |
|---|---|---|
| Typecheck | `pnpm typecheck` | **0 errors** |
| Lint | `pnpm lint:check` | 0 errors, 49 cosmetic warnings |
| Unit suite | `pnpm test` | **1197 passed / 6 skipped / 0 failed** |
| Eval CI (6-lane) | `pnpm eval:ci` | **61 PASS / 0 FAIL / 9 SKIP** |
| Doc-tooling harness | `pnpm harness:doc-tooling-e2e` | **5/5 PASS** (P1–P5) |
| Fresh-install boot | `vitest run tests/unit/fresh-install-boot-chain.test.ts` | 3/3 |
| Degrade policy (KR4) | `vitest run tests/unit/chat-channel-degrade.test.ts` | 9/9 |
| On-device tool policy | `vitest run tests/unit/ondevice-tool-policy.test.ts` | 9/9 |

The 6 skipped units are benign pilot channel-filtering; the 9 eval skips are the
live-creds lanes. Neither is a failure.

## 2. Runnable after 2-min self-service (B0 — start the app)

ME app + ports `18789`/`13210` are down; launching the app clears it. Then:
`v2-chatbot-e2e.ts` (3-turn live Outlook), `v2-eval.ts` (14-row Outlook matrix),
`v2-send-test.ts` (hard-confirm gate proof), `clawx-selftest.mjs` (canaries).

**The single biggest KR1 gap: the in-app live-LLM turn.** Every eval lane is a
BM25 proxy; lane F (live tool-pick) always SKIPs. The Ministry's failure happened
*through a live LLM*, not through BM25 — so **KR1 is unproven end-to-end until a
Windows in-app run with real fixtures passes.**

## 3. Per-KR coverage and the smallest next test

| KR | State | What's proven | What's missing | Smallest next test | Gated by |
|---|---|---|---|---|---|
| **KR1** doc-tooling | 🔴 in-app unproven | harness 5/5, eval 61/61, units | live-LLM tool-pick (lane F skips); OneDrive KFM on real Windows | in-app P1–P6 + KFM discovery on the VM | **B2** gcloud |
| **KR2** clean-VM | 🟡 | silent `/S` install proven (moe.11 b01bb6c3, IAP verdict) | assisted GUI install never recorded | screen-record the double-click install | **B2** gcloud |
| **KR3** offline | 🟢 | lane G egress-guard + qwen2.5:3b turn | none (2 named future gaps = KR5) | — | — |
| **KR4** degrade | 🟢 | 25 units + `G-degrade-classify` | none | — | — |
| **KR5** outbox | 🔴 | nothing (design only) | no queue/ledger/retry code exists; no send-time reachability check | `G-outbox-{durable,idempotent,drain}` | **B3+B4** (needs a real write target) |
| **KR6** economics | 🔴 | floor measured ~7,550 tok; trim branch exists | trim on HOLD; per-user caps not built; no `UserId` | merge trim, unit-test cap logic behind a flag | **B3** owner + KR7 |
| **KR7** Entra/UserId | 🔴 | design only | stub identity; no MSAL flow; no `UserId` header stamp | mock MSAL flow against a *dev* Entra app | **B4** redirect URI |
| **KR8** infra | 🟡 | 459-line reply drafted | reply UNSENT; session unbooked | send the reply (owner action) | **B3** owner |

## 4. The one tooling gap worth closing (B2)

`gcloud` is **not installed** (`which gcloud` → not found). Installing it
(`brew install --cask google-cloud-sdk` + `gcloud auth login`) unlocks the GCP IAP
Windows lane (`clawx-win-rc-20260609`), which is the **only** available Windows lane
(home-pilot is unreachable, B4). That single ~5-min install moves **KR1 in-app** and
**KR2 assisted-screen** from blocked to runnable.

The moe.11 installer is already on disk (`release/…-moe.11-win-x64.exe`, sha256
`b01bb6c3…`) — so KR2 is **not** artifact-gated (B1 cleared), only tooling-gated.

## 5. Critical path

**Install `gcloud` (B2, ~5 min) → drive the IAP VM → KR1 in-app + KR2 recording move
to Ready.** Everything else is either already green (KR3/KR4) or owner/Ministry-gated
(KR5/KR6/KR7/KR8 — the Lane-C chain that the unsent reply unlocks).

_Ceiling is Ready. A human closes a card to Done._
