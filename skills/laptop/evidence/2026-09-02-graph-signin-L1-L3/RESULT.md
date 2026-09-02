# Graph sign-in ladder L1–L3 — PASS live against the real Ministry tenant

**Date:** 2026-09-02
**Harness:** `scripts/graph-signin-smoke.ts` (auth-code + PKCE loopback), using the
shipped plugin modules `extensions/microsoft-graph/auth.mjs` + `graph-client.mjs`.
**Identity:** sandbox account `test.fac@fac.edu.tt` (never a `@moe.gov.tt` mailbox).
**Tenant:** `9590bb09-…-fad0a7edebfe` (moe.gov.tt + fac.edu.tt are one tenant).

## Trigger

The Ministry (Ansari) delivered the outstanding #355 / CLWX-39 prerequisites:
- real **Application (client) ID**
- **dev redirect URI** `http://localhost:53682/callback` registered on the app
- **read-only** admin-consented delegated scopes (profile + inbox read + offline_access)

Non-secret config stored in gitignored `~/openclaw-agent/secrets/graph.env`.
The **client secret is stored nowhere** — PKCE public-client needs none; the
secret only ever existed as a fallback and was never written to repo/log/board.

## Results

| Rung | Check | Result |
|---|---|---|
| L1 | consent → loopback callback → token exchange | **PASS** — token acquired via **pure PKCE, no client secret**; refresh token present (from `offline_access`) |
| — | granted scope | `Calendars.Read Mail.Read User.Read profile openid email` (superset of the requested read-only set — app's consented baseline) |
| L2 | token claims — `oid` present + stable (KR7 UserId key) | **PASS** — `oid=0e48d4db-…-ae905cd07817` (truncated here; full value only in the uncommitted run log), `tid=9590bb09…`, `upn=test.fac@fac.edu.tt` |
| L3a | one Graph read — `/me` | **PASS** — resolved *test fac* `<test.fac@fac.edu.tt>` |
| L3b | inbox list | **PASS** — 5 messages returned (subjects incl. a public MoE newsletter + our own smoke-test threads) |

`=== RESULT: GRAPH_SIGNIN_OK ===` · `pnpm typecheck` exit 0.

## Interpretation

- **#355 / CLWX-39 external blocker is cleared and the OAuth path is proven** end
  to end against the real tenant with the real app — not a twin. The tenant's
  Conditional Access / CAE behaviours did not block the sandbox account for this
  read-only flow.
- **KR7 (CLWX-30) core question answered:** a stable `oid` is available as the
  per-user metering key. Remaining KR7 work: stamp `UserId=oid` on broker/gateway
  calls + surface it in per-user metering (ladder L7).
- **Secret-free desktop flow confirmed:** the app can be a public client (PKCE);
  no confidential secret needs to ship on the laptop.

## Still open (why cards stay In Progress, not Ready)

- **In-app flag wiring** (`CLAWX_GRAPH_AUTH`) — the harness is a standalone proof,
  not the in-app sign-in path.
- **Host token wiring** — `bindToProviderStore()` is a no-op and the gateway does
  not yet expose `getAccessToken` to the plugin. Until that lands,
  `plugins.microsoft-graph.enabled` stays **false** (flipping it true crashes
  gateway boot: `register()` calls `createGraphClient({getAccessToken})` and
  throws when `getAccessToken` is undefined). This is the next atomic item — it
  makes the 6 parked Graph tools (`outlook.profile/list_messages/get_message/
  draft_reply/send_mail/list_events`) callable in-chat.
- **L4/L5** — transport eval + Chrome-less machine (CLWX-40), runs after the
  in-app path is wired.

## Reproduce

```
set -a; . ~/openclaw-agent/secrets/graph.env; set +a
pnpm exec tsx scripts/graph-signin-smoke.ts   # sign in as test.fac@fac.edu.tt
```

If Entra ever rejects PKCE-public (`AADSTS7000218`/`invalid_client`), the app was
registered under a "Web" platform; either add the redirect under "Mobile and
desktop applications" or `export AZURE_CLIENT_SECRET=…` in the shell for one run
(the harness auto-uses it as a confidential fallback; still never written to disk).
