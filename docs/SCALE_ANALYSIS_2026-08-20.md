# Scale analysis: the Ministry's constraints against a real fleet

**Status: analysis. 2026-08-20, against commit `c45c5bc4`.**

We are building a POC directly in production. That is a defensible choice for a
pilot, but it means the constraints in the Ministry's handoff
(`MOE Email AI Assistant Handoff.docx`, Ansari Khan, 2026-08-18) are not
theoretical limits to design against later — they are the limits we are already
inside.

This document takes each constraint they gave us, works out what it implies at
fleet scale (200 primary schools, the number our own
`docs/MSFORMS_AUTOMATION.md:97` costing already assumes), and states what we need
to change on our side versus what we need to ask for on theirs.

**The headline: the 100M token/month budget is not the generous allocation it
looks like. On our current per-turn cost it is exhausted at roughly 20 schools,
and about 71% of every turn is overhead we resend needlessly.** That is
overwhelmingly our problem to fix, not theirs, and it changes what we should ask
for.

---

## 1. The constraint set they handed us

| # | Constraint | Source |
|---|---|---|
| C1 | 100M tokens/month, prompt+completion, enforced at APIM; 429 when exhausted | §3.2 |
| C2 | No remaining-budget figure returned; only per-request `consumed-tokens` | §3.2 |
| C3 | `UserId` header **required** on authenticated requests, for App Insights grouping | §3.3 |
| C4 | One APIM subscription key = the only inference credential | §3.1 |
| C5 | DB firewall closed permanently; app server only; end-user machines never connect | §2.2 |
| C6 | No Redis. PgBouncer (transaction pooling) only *if* connection issues appear | §2.3 |
| C7 | No SSL required on DB connections (internal network path) | §2.1 |
| C8 | No admin/migration credential issued | §2.1 |
| C9 | Graph delegated + read-only: `Mail.Read`, `Calendars.Read`, `User.Read` | §5.2 |
| C10 | `Contacts.Read` deliberately refused (org-crawl / prompt-injection risk) | §5.3 |
| C11 | Docker image preferred for the app server; they deploy and operate it | §2.2 |

Most of these are sound and we should accept them. Four have real scale
consequences: **C1/C2 (budget), C3 (identity), C4 (shared bucket), C6 (pooling)**.

---

## 2. C1 — the token budget is the binding constraint

### 2.1 What a turn actually costs us

Measured against `extensions/moe-principal-assistant/index.mjs` and
`persona.mjs`:

| Component | Tokens | Notes |
|---|---|---|
| 31 tool descriptions | ~3,594 | `outlook.send_email` alone is ~286 tokens of prose |
| 31 tool schemas (185 properties) | ~1,918 | |
| Persona / system prompt | ~1,880 | |
| **Fixed floor, resent every turn** | **~7,550** | before the principal types anything |
| + conversation history (by turn 3–4) | ~2,500 | |
| + user text | ~200 | |
| + completion | ~400 | |
| **Realistic single turn** | **~10,650** | **71% of it is the fixed floor** |

Task shapes, since principals do tasks not turns:

- quick question (1 turn): ~10,650
- summarise 5 emails (3 turns + tool results): ~37,950
- document → extract 32 fields → prefill form (6 turns + doc content): ~75,900

### 2.2 The fleet math

At the "summarise 5 emails" shape (~37,950 tokens), 22 working days:

| Schools | Tasks/principal/day | Monthly tokens | % of 100M |
|---|---|---|---|
| 20 | 5 | 83.5M | 84% |
| 20 | 10 | 167M | **167%** |
| 50 | 10 | 417M | **417%** |
| 200 | 10 | 1.67B | **1,670%** |

**100M/month buys roughly 2,635 cloud tasks for the entire fleet per month.**
Across 200 principals over 22 days that is **0.6 cloud tasks per principal per
day**.

Put the other way: at 200 schools and 10 tasks/day, **only about 6% of tasks can
go to the cloud** before the budget is gone. Everything else must be on-device.

### 2.3 Why this is mostly our problem, not theirs

Before asking for a bigger allocation, we should fix the waste, because asking for
a 16x increase to fund a 71%-overhead design is not a request that survives
scrutiny — and it would be the wrong thing to spend the Ministry's goodwill on.

Three fixes, in order of value:

1. **Trim the per-turn tool catalog.** 31 tools resent every turn, with prose
   descriptions written for reliability, not economy. A principal asking "what's
   in my inbox" does not need the Forms or document-write schemas in context.
   Branch `fix/tool-catalog-trim` (`7add864b`, **currently under HOLD**) already
   targets this. Cutting the floor from 7,550 → 2,000 raises affordable cloud
   tasks by ~78% for free. **This branch is now on the critical path for scale,
   which is a reason to get it reviewed rather than let it sit.**
2. **Route by default to on-device, escalate deliberately.** On-device is already
   the default (`electron/utils/store.ts:127`) and is proven to work offline
   (`docs/OFFLINE_ARCHITECTURE.md`, eval lane G). The budget math says this is not
   just a privacy/offline nicety — **it is the only thing that makes the economics
   work.** Cloud should be for vision-heavy grounding and genuinely hard turns.
3. **Prompt-cache the fixed prefix if APIM/Foundry supports it.** The floor is
   identical across turns and principals — exactly what caching is for. Worth
   asking: it could cut the effective floor cost substantially with no product
   change. **Open question for the call.**

### 2.4 What to ask the Ministry for

Not "more tokens" as an opening move. Instead:

- Confirm whether **prompt caching** is available on the Foundry deployment behind
  APIM, and whether cached prefix tokens are billed against the 100M.
- Agree the allocation is **reviewed against measured pilot usage** (§3.2 already
  says it can be increased). We supply the numbers.
- Flag the arithmetic honestly: at 200 schools with meaningful cloud use, the
  requirement is closer to **1.5–2B tokens/month**. Better they hear that now,
  from a measured model, than discover it at rollout.

---

## 3. C2 + C4 — one bucket, no gauge, fleet-wide blast radius

C4 means one subscription key for everyone. C2 means no remaining-budget figure.
Together they produce the worst failure mode in this design:

**A single principal bulk-processing a mailbox can consume the entire fleet's
monthly budget in roughly 13 heavy tasks, and the first symptom anyone sees is
every principal's assistant going silent with a 429 — with no warning gauge
beforehand.**

There is no per-user cap anywhere today. I grepped `electron`, `extensions`,
`services` for rate-limit/quota/throttle logic: the only hit is an unused
`RATE_LIMITED = -32006` protocol enum in `electron/gateway/protocol.ts:77`.
`services/model-broker/server.mjs` authenticates callers
(`MODEL_BROKER_CLIENT_KEYS`) and allow-lists models, but **does not meter or
account for usage at all**.

**This is the app server's job and it is our work.** Required in the broker before
fleet rollout:

1. **Per-user token accounting**, keyed on the same identity as the `UserId`
   header, summing the `consumed-tokens` response header.
2. **Per-user daily/monthly soft caps** with a fleet-level reserve, so one heavy
   user cannot starve 199 others. A principal hitting their own cap should degrade
   to on-device — not error.
3. **Our own running fleet total**, which is the gauge C2 doesn't give us. Once
   requests funnel through one place this is easy, and it converts "silent 429 at
   an unknown date" into a forecast.
4. **Graceful 429 handling**: on a fleet 429, degrade every client to on-device
   rather than failing turns. This depends on the send-time fallback gap in
   `docs/OFFLINE_ARCHITECTURE.md` §3.1 — **the same fix serves both**, which
   raises its priority further.

Worth stating plainly to the Ministry: we are asking to be *allowed* to enforce
caps on their behalf, because the alternative is a fleet-wide outage triggered by
one user's ordinary enthusiasm.

---

## 4. C3 — the `UserId` header has nothing to put in it yet

C3 is mandatory and reasonable: without it, App Insights cannot attribute usage,
which also means our per-user caps (§3) have no key.

**Today the app has no signed-in-user identity.** The only `userPrincipalName` in
the tree is a hardcoded stub — `'principal@school.example'` at
`electron/services/microsoft-graph/manager.ts:257`. The live Outlook path
(`outlook-browser-v2`) identifies the principal only *implicitly*, by riding
whichever account is signed into their Chrome profile over CDP. That is
deliberate and correct for Conditional Access, but it means **the app never
learns who the user is in a form it could put in a header.**

So C3 is not a one-line addition. It requires:

- Real interactive Entra sign-in producing a stable identifier (`oid` preferred
  over UPN — it survives name changes and is not PII-shaped).
- The app server stamping `UserId` **from the authenticated session**, never from
  a client-supplied value. A client-trusted header is both spoofable and makes the
  metrics worthless. This is an argument *for* the backend-for-frontend design,
  not merely a consequence of it.
- A decision on identifier choice to confirm with the Ministry: **`oid` (opaque
  GUID) rather than email**, which is better for privacy and stable across
  renames. Their document says "identifier of the signed-in user" without
  specifying.

Note the ordering dependency: **per-user caps (§3) cannot exist before identity
(§4) does.** This makes sign-in a scale blocker, not just a feature.

---

## 5. C5–C8 — data path at scale

**C5 (closed firewall, app server only): accept without argument.** It is the
right posture and our offline design (`OFFLINE_ARCHITECTURE.md` §4) already
assumes laptops never touch the DB.

**C6 (no Redis, PgBouncer only if needed): fine, with one caveat.** At 200
principals the connection count is not the issue — a modest pool per app-server
instance handles it. The thing to raise is that **the absence of Redis removes the
obvious home for the token-accounting counters in §3**. Options, in preference
order:

1. Keep counters in PostgreSQL. Simplest, one datastore, durable, and at 200
   principals the write volume is trivial. **Recommended.**
2. In-process counters. Fails as soon as they run more than one container
   instance — counters diverge and caps become advisory. Only acceptable
   single-instance, and worth saying so explicitly so nobody scales it silently.

If we go with (1), we should say so, because it puts a small write on the hot path
and they should know what the DB is being used for. **If they later add
horizontal scaling, PgBouncer transaction pooling (their stated fallback) is
compatible with this** — but note transaction-mode pooling breaks session-level
features (prepared statements, `SET`, advisory locks), so our data layer must not
rely on them. Cheap to honour now, painful to retrofit.

**C7 (no SSL): accept, but note it.** Their reasoning — internal network path,
not publicly exposed — is sound for the current topology. It is worth one line on
the record that this assumes the app server and DB stay on that internal path; if
the app server is ever internet-facing (the open hostname question), the hop from
it to the DB should be revisited.

**C8 (no migration credential): this will block us, and soon.** A data layer needs
schema creation on day one, and migrations on every subsequent release. Their doc
says to request elevated privileges through the infrastructure owner. **We should
request the migration path now rather than at first deploy**, and propose the
mechanism: either a separate migration credential used only by a gated job, or
they run our reviewed migration SQL. Either is fine; discovering we need it during
a release is not.

---

## 6. C9–C10 — the security posture is right, and it constrains scale usefully

Read-only delegated Graph plus the `Contacts.Read` refusal is a better posture
than we would have asked for. Two scale observations:

- **`Mail.Read` at fleet scale is a large ingest surface.** 200 mailboxes being
  classified means the assistant processes a lot of untrusted inbound text. That
  is exactly the prompt-injection surface Ansari names in §5.3, and his reasoning
  generalises beyond contacts. Our mitigation should be explicit: **tool
  allow-listing per turn, the existing hard-confirm gates on
  `outlook.send_email` / `download_attachment`, and never letting email content
  reach a tool argument without a confirmation step.** These gates already exist
  (CLAUDE.md hard rules) — the point is that they are load-bearing security
  controls at scale, not just UX politeness, and should be described to the
  Ministry as such.
- **Delegated-only permissions mean no background fleet processing.** Every Graph
  call needs a signed-in user context. There is no service-principal path to
  "process all 200 mailboxes overnight." That is a real product constraint on
  anything cron-shaped and we should confirm we accept it rather than design
  around it.

---

## 7. What POC-in-production means for rollout

Because we are in production already, the sequencing matters more than usual.
Ranked by "what breaks first at scale":

| # | Item | Why it's this rank | Owner |
|---|---|---|---|
| 1 | Send-time cloud→on-device fallback | Without it, the first fleet 429 is a fleet-wide silent outage. Also the 429 mitigation. | Us |
| 2 | Tool-catalog trim (`fix/tool-catalog-trim`, HOLD) | 71% of every turn is overhead; ~78% more capacity for no product change | Us |
| 3 | Real Entra sign-in + stable `oid` | C3 is mandatory; also the key for per-user caps | Us + Ministry |
| 4 | Per-user metering + caps in the broker | Prevents one user starving 199 | Us |
| 5 | Migration credential / process (C8) | Blocks the first schema deploy | Ministry |
| 6 | Store-and-forward outbox | Needed for durable records; can follow the above | Us |
| 7 | Prompt-caching answer | Could materially change the budget math | Ministry |

Items 1 and 2 need nothing from the Ministry and together transform the
economics. **Item 2's branch is under HOLD pending review — that HOLD is now
blocking scale work, which is worth raising rather than working around.** I am not
proposing we push or self-merge it; it needs the reviewer pass it is waiting for.

---

## 8. How we should respond — recommended posture

The tone that fits: **accept their architecture, bring them arithmetic, and ask
for the two things that actually unblock us.**

Specifically:

1. **Accept C5, C7, C9, C10, C11 as written.** Say so plainly; their document is
   the most complete handoff we have had and most of it is better than what we
   would have specified.
2. **Do not open with a request for more tokens.** Show the measured per-turn
   cost, state that we are cutting our own overhead first, and propose reviewing
   the allocation against real pilot telemetry. Give them the honest 200-school
   figure (~1.5–2B/month with meaningful cloud use) as a forecast, not a demand.
3. **Ask for prompt-caching confirmation** — potentially the highest-leverage
   answer available, and free if it exists.
4. **Tell them we will enforce per-user caps** on their behalf, and why: C4 plus
   C2 means one user can silently spend the fleet's month.
5. **Request the migration path (C8) now**, with a proposed mechanism, before it
   blocks a release.
6. **Confirm the `UserId` identifier should be `oid`**, and that the app server
   will stamp it from the authenticated session rather than trusting the client.
7. **Confirm PostgreSQL is an acceptable home for token counters** given no Redis,
   and that our data layer will avoid session-level features so PgBouncer
   transaction pooling stays available to them.

The through-line: their constraints are mostly reasonable, and the uncomfortable
number — 100M tokens against a 200-school fleet — is one we made worse ourselves
with a 7,550-token per-turn floor. Fixing our side first is both the honest move
and the one that makes the eventual ask credible.

---

## 9. Open questions

1. Prompt caching on the Foundry deployment behind APIM — available? billed?
2. Expected fleet size and timeline. Our costing assumes 200 schools; the pilot is
   far smaller. **The budget is adequate for a small pilot and inadequate for
   rollout, so knowing the intended curve changes the priority order.**
3. Is a per-user cap enforced by our app server acceptable to them, or do they
   want it at APIM?
4. `UserId` = `oid` or UPN?
5. Migration credential mechanism (C8).
6. App server reachability / hostname — still the open item from 2026-07-20, still
   blocking the redirect URI.

---

## Related

- `docs/OFFLINE_ARCHITECTURE.md` — offline design; §3.1 fallback gap is item 1 here
- `docs/MINISTRY_REPLY_DRAFT_2026-08-20.md` — the reply (**unsent**)
- `services/model-broker/server.mjs` — where metering and caps belong
- `extensions/moe-principal-assistant/index.mjs` — the 31-tool catalog
- `CLAUDE.md` — hard rules, including the send/download confirmation gates
