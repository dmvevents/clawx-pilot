# Graph access test plan — from zero to a verified Ministry integration

*2026-09-02. The executable plan for testing the Ministry Graph/Entra access
("the MCP" in session shorthand). Companion to
`docs/MINISTRY_GRAPH_ACCESS_PLAN.md` (architecture + status) and
`docs/MINISTRY_ASKS_2026-09-02.md` (the session agenda). Cards: CLWX-39
(twin), CLWX-40 (transport eval), CLWX-30 (KR7), CLWX-31 (session).*

## Prerequisites matrix (who provides what)

| # | Prerequisite | Owner | Status | Effort |
|---|---|---|---|---|
| P1 | Dev redirect URI `http://localhost:53682/callback` registered on the Ministry Entra app | **Ansari** | ASKED — the 01b delta message (permissions list + URI, owner-executed send staged) | 5 min portal |
| P2 | `AZURE_TENANT_ID` + `AZURE_CLIENT_ID` | **Raj/Ansari** | owed with P1 (not secrets — chat-transmittable) | minutes |
| P3 | Delegated consent: `User.Read`, `Mail.Read`, `offline_access` (read-only baseline as agreed) | **Ansari** | part of P1 change | included |
| P4 | Ministry-designated TEST account for sign-in (never automation on personal `*@moe.gov.tt`) | **Raj** | pairs with the CLWX-8 production-accounts ask | minutes |
| P5 | Flag-gated sign-in flow wired (`CLAWX_GRAPH_AUTH=1`) | **us** | oauth flow + adapter BUILT; flag wiring = CLWX-39 | 1 sitting |
| P6 | Twin registration for pre-Ministry testing | **us (+owner assist)** | see "Twin tenant" below | 1 sitting |

## Twin tenant — test everything before the Ministry moves

**Best option: the `fac.edu.tt` sandbox tenant.** The test mailbox
(`test.fac@fac.edu.tt`) already lives there — if we hold (or can get) admin
on that tenant, we register a TWIN app (public client, loopback redirect,
same delegated scopes) and the ENTIRE ladder below runs today against the
same mailbox the browser-lane evidence used. Fallback: a free M365 developer
tenant (owner signup, ~15 min interactive).

What the twin proves: everything except Ministry tenant policy (Conditional
Access, CAE, consent policies). Those five percent are exactly what steps
L5–L6 verify when the real values land — by then it is a config swap
(`AZURE_TENANT_ID`/`AZURE_CLIENT_ID` env), not new code.

## The test ladder (each rung has a runnable check; stop at first failure)

| Rung | Test | Pass criterion |
|---|---|---|
| L1 | Sign-in round-trip (flag on, twin or Ministry values) | browser consent → loopback callback → token acquired; no secret anywhere client-side |
| L2 | Token claims | `oid` present + stable across two sign-ins (KR7's UserId key) |
| L3 | One Graph read | inbox list returns ≥1 message via `isGraphOutlookAvailable()`-gated path |
| L4 | **Transport eval** — the existing 14-row suite re-run with Graph active | 15/15, same bar the browser lane passed 09-02 (read/search/read-body/attachments rows; draft/send rows expected `refused/N-A` under read-only scopes — assert the graceful refusal, not silence) |
| L5 | Chrome-less machine | fresh install, NO Chrome session: L1–L4 all pass (the "any other system" proof) |
| L6 | Ministry tenant repeat | L1–L5 against real values + designated test account; CA/CAE behaviors observed and documented |
| L7 | KR7 tie-in | UserId=`oid` stamped on broker calls; visible in per-user metering (caps flag) |

## Stakeholder RACI

| Item | Responsible | Accountable | Consulted | Informed |
|---|---|---|---|---|
| 01b delta send | owner (guard-gated) | owner | — | Raj |
| P1–P3 portal changes | Ansari | Raj | us (exact strings provided) | — |
| Twin registration | agent | owner (admin creds if fac.edu.tt) | — | — |
| L1–L5 execution | agent (sprint-driver ticks) | owner | — | board CLWX-39/40 |
| L6 session test | agent + Ansari live | Raj | owner | CLWX-31 |
| Scope expansion (write/send via Graph) | deferred | owner | Raj | feature-tied, post-GA |

## Timeline

- **Now:** owner runs the staged 01b send; agent starts CLWX-39 twin work
  (needs the fac.edu.tt-admin yes/no from owner — the one decision).
- **This week (if Ansari adds the dev URI):** L1–L4 on Ministry values,
  pre-session.
- **At the 45-min session:** L6 live — the strongest possible demo that the
  integration is a config swap.
- **Post-GA:** scope expansion for Graph send when the browser send path
  retires (per the read-only baseline agreement).
