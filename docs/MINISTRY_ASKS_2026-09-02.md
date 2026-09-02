# Ministry asks — the minimal set to reach fully functional production

*2026-09-02, v3 — reconciled against the FULL liaison archive by the
ministry-liaison-monitor sweep. v1 of this doc proposed desktop-direct PKCE;
the archive shows the sent 2026-09-01 reply already confirmed the
**Docker / backend-for-frontend (app server)** architecture with a
server-held confidential client — that agreement stands and this version is
aligned to it. Sources: docs/MINISTRY_INFRA_HANDOFF_2026-08-18.md,
docs/wiki/LIAISON_LOG.md, the outbound ledger, docs/CAPABILITY_STATE_2026-09-02.md.*

## Is anything Ministry-side active today?

**No.** All ~20 handoff values are `{{ PLACEHOLDERS }}`; the credential link
expired unopened (deliberately — 0 of 5 accesses used, preserved for when the
app server exists). What IS active: our own stack — the Cloud Run broker plus
the Outlook and Forms lanes, all live-proven this week. **Single-school GA
does not require Ministry connectivity**; the earliest realistic Ministry
connectivity is **late September 2026** (session → 1–2 wks decisions → 2–4
wks provisioning).

## The agreed architecture (settled — do not re-open)

Desktop app → **app server** (Docker, Ministry-hosted; holds the Entra client
secret; performs OAuth; stamps `UserId` server-side) → APIM/Foundry + Graph +
PostgreSQL. Confirmed in the 2026-09-01 reply. Consequences: the Entra
CONFIDENTIAL client is correct (the secret lives on the server, never the
desktop); PostgreSQL sits behind the app server as the handoff assumed; the
KR5 outbox drains to the app server.

## Placeholder disposition (updated)

| Group | Values | GA impact | Production path |
|---|---|---|---|
| APIM/Foundry (5) | URL, key, deployment, api-version, model | Not needed for GA — our broker is the drop-in | Ask 3 (reissued link) + Ask 1 |
| UserId header | signed-in user id | Not needed for GA | Entra `oid`, stamped by the app server (Ask 5) |
| PostgreSQL (5) | host/port/db/user/password | Not needed for GA — outbox buffers durably | Behind the app server; migration mechanism = Ask 6 |
| Entra (5) | client id, tenant id, secret, redirect, expiry | Not needed for GA | Secret stays SERVER-side; redirect gated on Ask 1 |

## THE ASKS (authoritative nine, ordered by leverage — full sweep text)

1. **App-server hostname + reachability model** — decide internet-facing TLS
   with public DNS/cert vs iGovTT-network-only. Principals work across 7
   districts on networks the Ministry doesn't control; private-only means no
   cloud turns/Graph/sync off Ministry premises. **Gates asks 2, 4 (Docker
   handoff), KR7/KR6.** Effort: decision + Ansari DNS/cert coordination.
2. **Redirect URI registration** — production
   `https://<app-server-host>/auth/callback` (after ask 1); dev/local
   `http://localhost:53682/callback` **can be added now without waiting**.
   Raj has been waiting on US for this value since 2026-07-20 (~6 weeks) —
   it was blocked on ask 1, and the 09-01 reply made it deterministic.
   Effort: 5-minute Entra portal change once the hostname is known.
3. **Reissue the moevault credential link** — original expired unopened;
   the 5 real values (APIM key, PostgreSQL password, client secret, expiry,
   metadata). Unblocks the §4.1 Python smoke test, real OAuth test, real DB
   test. Effort: ~2 minutes.
4. **Per-user token caps at the app server + fleet counter** — agree
   soft per-user daily/monthly caps with a fleet reserve. Without it, one
   principal's bulk task (~13 heavy tasks ≈ 100M tokens) 429s the whole
   fleet at once. Measured turn: ~10,650 tokens, 71% fixed floor. 200
   schools ⇒ ~1.5–2B tokens/mo; 100M is pilot-adequate, rollout-tight.
   Effort: conceptual agreement (code is ours) + optional weekly App
   Insights consumption visibility.
5. **UserId = Entra `oid`** — opaque, stable across name/email changes,
   server-stamped (never client-supplied). Effort: confirmation only.
6. **Migration credential mechanism** — (a) separate elevated migration
   credential for a gated job, or (b) we submit reviewed SQL and Ansari's
   team applies with a turnaround SLA. Schema creation is a day-one need.
7. **Prompt caching on APIM/Foundry** — is it available, and are cached
   prefix tokens billed against the 100M? **Potentially the
   highest-leverage answer available**: the identical 7,550-token prefix on
   every turn is exactly what caching is for; could transform the economics
   with zero product change.
8. **Idempotency/replay tolerance** — app server accepts client-generated
   idempotency keys, dedupes, tolerates late/out-of-order records (a laptop
   returning from a 3-day outage must not break, and a daily report must
   never submit twice). Unblocks the KR5 drain schema.
9. **Book the 45-minute working session, Ansari present** — items 1–8 are
   decision-gate or confirmation-only; the session unblocks the whole
   KR7→KR6→KR8 chain.

### Scope note (email write path)
The agreed Graph scopes are **read-only delegated** (Contacts.Read refusal
agreed). Draft/send via Graph would need a scope expansion — per the
handoff's own principle, request it tied to the concrete feature when the
browser-lane send is retired. Until then the two-gate browser send path
(live-proven, hardened this week) remains the send path.

## The reverse queue — what RAJ awaits from US

| # | Ask from Raj | Status | Next step |
|---|---|---|---|
| 1 | Dev machine IPs for DB whitelist | Open | Confirm IPs, submit to Ansari |
| 2 | Run the §4.1 Python smoke test | Blocked | Needs ask 3 (reissued link) |
| 3 | Credentials in secret manager, no plaintext | Partial | Nothing to scrub yet (link unopened); OUR side: the public-repo password leak is CLWX-18 (owner sitting) |
| 4 | Docker image handoff | Blocked | ~1 week after asks 1–8 resolve; `services/model-broker` is the seed |
| 5 | `UserId` header on all authenticated requests | Blocked | Needs KR7 (no signed-in identity exists yet) |

Closed: deployment approach (Docker, 09-01), Graph scopes (read-only
delegated), client-secret question (confidential client, server-held).

## What we do WITHOUT waiting (carded)

- CLWX-39 — **corrected scope:** dev-tenant Entra twin now models the BFF
  flow (confidential client on a dev app server / local broker) rather than
  desktop PKCE; the dev-loopback redirect (ask 2's dev half) still applies.
- CLWX-40 — Chrome-less Graph eval behind CLWX-39 + the scope-expansion note.
- GA continues on our broker + sandbox tenant.
