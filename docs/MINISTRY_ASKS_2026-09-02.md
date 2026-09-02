# Ministry asks — the minimal set to reach fully functional production

*2026-09-02. The working-session-ready list. Every handoff placeholder
dispositioned: what we can relax/self-serve versus what only the Ministry can
provide. Sources: docs/MINISTRY_INFRA_HANDOFF_2026-08-18.md (verbatim
placeholders), docs/MINISTRY_GRAPH_ACCESS_PLAN.md, docs/CAPABILITY_STATE_2026-09-02.md.*

## Is anything Ministry-side active today?

**No.** All ~20 handoff values are `{{ PLACEHOLDERS }}` including hostnames —
nothing to connect to, nothing to probe. What IS active: **our own stack**
(green "Online" = our Cloud Run broker, proven with live turns today; Outlook
+ Forms lanes proven live on the sandbox tenant today). The product is fully
demonstrable without the Ministry; the Ministry values buy *production
economics, identity, and governance*, not core function.

## Placeholder disposition (can they be relaxed/replaced?)

| Group | Values | Relax/replace ourselves? | Production ask |
|---|---|---|---|
| **APIM / Foundry** (cloud LLM) | `APIM_GATEWAY_URL`, `APIM_SUBSCRIPTION_KEY`, `DEPLOYMENT_NAME`, `API_VERSION`, `MODEL_NAME` | **YES for GA** — our LiteLLM broker is a drop-in OpenAI-compatible equivalent, live-proven today. The Ministry APIM matters for THEIR token budget (100M/mo) + governance | ASK 2 |
| **UserId header** | `{{ id of the signed-in user }}` | Partially — we can stamp a device-local ID today; a REAL per-principal ID needs Entra sign-in (KR7) | ASK 1 |
| **PostgreSQL** | `POSTGRES_HOST/PORT/DB/APP_USER/APP_PASSWORD` | **YES for GA** — "resolvable from the app server only," and there is no app server; the KR5 outbox holds records durably client-side until a sync target exists. Dev Postgres self-servable for schema work | ASK 3 decides whether these values ever matter as specified |
| **Entra** | `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_REDIRECT_URI` | Dev-tenant twin self-servable NOW (card CLWX-39) — proves everything except tenant policy | ASK 1 |
| **Entra secret** | `AZURE_CLIENT_SECRET`, `SECRET_EXPIRY_DATE` | **DROP — should never exist.** A desktop app cannot hold a secret; PKCE public client eliminates it (and its rotation calendar) | ASK 1 |

## THE ASKS (ordered by leverage; each self-contained for the session agenda)

### ASK 1 — Entra app registration, corrected for a desktop client
*Unblocks: Graph email (replaces all browser-DOM risk), KR7 identity, per-user
APIM attribution. Effort for Raj's team: ~30 min in the Entra portal.*
1. Enable **"Allow public client flows"** on the existing registration (or
   register a desktop platform) — authorization-code + **PKCE**, no client
   secret. (Consequence: `AZURE_CLIENT_SECRET` and `SECRET_EXPIRY_DATE` are
   dropped from the handoff entirely.)
2. Add the loopback **Redirect URI**: `http://localhost:53682/auth/callback`
   (the dev-loopback we offered in G7; final port negotiable — say the word
   and we pin it).
3. Grant **delegated** (not application) scopes: `Mail.Read`,
   `Mail.ReadWrite`, `Mail.Send`, `offline_access`, `User.Read`. Send-as-user
   only; no tenant-wide mail rights.
4. Hand over just TWO values: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` (no
   secrets to transmit — that is the point).

### ASK 2 — APIM/Foundry real values + the throttling contract
*Unblocks: Ministry-budget cloud turns (KR6/KR8). Effort: reading them out.*
1. `APIM_GATEWAY_URL`, `APIM_SUBSCRIPTION_KEY`, `DEPLOYMENT_NAME`,
   `API_VERSION` — actual values.
2. Confirm the **429 policy**: is throttling per-UserId or per-subscription-
   key? (Fleet analysis showed a shared key 429s fleet-wide at ~20 schools —
   this answer shapes KR6.)
3. Confirm `UserId` header semantics: is the Entra `oid` acceptable? (Pairs
   with ASK 1 — one decision.)

### ASK 3 — Ratify the desktop-direct architecture (decision, not values)
*Unblocks: PostgreSQL question, outbox sync target, KR8 closure.*
The handoff assumes an always-on app server; the shipped product is a desktop
app. Decide: (a) **desktop-direct** — Entra token per user, APIM called from
the desktop, records sync later when a server exists (our recommendation; the
KR5 outbox already buffers durably), or (b) Ministry hosts a thin relay, in
which case the PostgreSQL values move behind it and we integrate against the
relay contract instead.

### ASK 4 — Forms production destination
*Unblocks: capability 2 to production (fill lane proven live today, 29/32 on
the clone). Effort: one Power Automate flow per form.*
1. **Power Automate flow URLs** for the real Suspensions + Daily Report forms
   (Tier C — recommended; immune to the office.com → cloud.microsoft DOM
   migration that hit us live this week), OR explicit sign-off to run Tier A
   browser automation against the real forms.
2. Freeze the production form versions (or agree to notify on edit) — our
   field schemas are captured snapshots (32 + 57 fields).

### ASK 5 — Working-session logistics (already owed from B4)
Date/time for the session; the four ASK-1 decisions can be executed live in
it. Production teacher/support accounts (CLWX-8) ride along.

## What we do WITHOUT waiting (already carded)

- CLWX-39: dev-tenant Entra twin behind a flag → Raj's values become a
  config swap (agent-executable now).
- CLWX-40: Chrome-less Graph eval (behind CLWX-39 + ASK 1).
- Continue GA on our broker + sandbox tenant — every capability lane is
  provable there, as today's Outlook/Forms/doc-tooling evidence shows.
