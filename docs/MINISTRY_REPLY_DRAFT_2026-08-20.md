# Ministry reply — DRAFT for Anton's review, 2026-08-20

**Status: DRAFT. Not sent. Anton reviews and sends.**

Responding to `MOE Email AI Assistant Handoff.docx` (Ansari Khan, MoE Information
Systems Support Specialist, 2026-08-18), forwarded by Raj over WhatsApp
2026-08-19 22:23, with the moevault secure-send link at 22:24.

**Decision taken (Anton, 2026-08-20): PostgreSQL runs in the Ministry's cloud
environment as provisioned.** We accept their architecture rather than argue for
on-device-only state. That means we owe them an app server, and the reply below
is built around delivering one.

**Constraint that shapes the whole design: the application has to keep working
offline.** A principal's laptop will lose connectivity — school networks drop, a
principal works from home or between sites. The app server can be in the path for
things that genuinely need the cloud, but it must not become a component that,
when unreachable, leaves a principal with a dead application. Section 1.1 below
sets out how we keep that true.

---

## Section 6 action list — our answers

| # | Ansari's ask | Our answer |
|---|---|---|
| 1 | Decide app-server deployment approach | **Docker image** (their preferred option). Partially built already — see below. |
| 2 | Submit developer IPs for DB whitelisting | Will send on confirmation. Needs a short exchange on which IPs. |
| 3 | Credentials into secret manager, no plaintext | Accepted. Link still unopened, so nothing to scrub yet. |
| 4 | Run the Section 4 Python smoke test | Ready to run as soon as credentials land. |
| 5 | `UserId` header on all authenticated requests | Accepted, stamped server-side from the authenticated session. One question on `oid` vs UPN — Section 4.2. |

We accept Section 2.2 as written: the database firewall stays closed, end-user
laptops never touch PostgreSQL, all traffic goes through the whitelisted app
server. We are not asking for a broader firewall opening. We also accept Section
2.1 (no SSL on the internal path), Section 2.3 (no Redis), Section 5.2 (read-only
delegated scopes) and Section 5.3 (`Contacts.Read` declined) as written.

**Three things we're raising that weren't on your list**, all in Section 4: the
token budget is tighter than it appears at rollout scale and most of that is our
overhead to fix; the single shared subscription key has a fleet-wide failure mode
worth a backstop; and we'd like to settle the migration mechanism before it blocks
a release.

---

## 1. App server: Docker, and we have a head start

We'll take the Docker route. Some of it already exists in our tree as
`services/model-broker` — a small Node service, already containerised, that:

- holds an upstream model credential **server-side** and never ships it to clients
- authenticates incoming callers by bearer token
- allow-lists which models may be called and rejects anything else
- exposes `/healthz` for liveness

It currently proxies inference. To become the app server Ansari describes it
needs two additions on our side: the PostgreSQL client and data layer, and the
Microsoft Graph token exchange. Both are our work, not the Ministry's.

**This turns out to solve a problem beyond the database.** Section 3.1 makes the
APIM subscription key the application's only inference credential. If ClawX
called APIM directly from each laptop, that key would ship inside the installer
and be extractable from every machine it lands on — the same exposure as a client
secret in a desktop binary. Routing inference through the app server means **the
APIM key lives in one place the Ministry controls**, and can be rotated without
touching a single laptop. It also gives a natural point to stamp the `UserId`
header from the authenticated session rather than trusting each client to send
it honestly, which makes the Application Insights attribution in Section 3.3
trustworthy instead of advisory.

So the revised shape is:

```
Principal's laptop (ClawX desktop)
   |                        |
   | on-device model        | when online
   | + local file tools     v
   | + local state     App server in MoE Azure ---> APIM ---> AI Foundry
   |   (always works)    (Docker, IP whitelisted)
   |                        |
   |<--- sync when back --->v
                        PostgreSQL
```

## 1.1 Offline behaviour — the part we want to be explicit about

The assistant runs an on-device model as its **default**, and the toggle between
"On this device" and "Online" is already shipped and in principals' hands. That
is not a fallback we are proposing; it is how the product works today. What
matters for this design is that adding an app server must not quietly undo it.

**Works with no connectivity at all.** This is tested, not asserted — we added
an automated check that runs the document path in a process with the network
deliberately blocked at the socket and DNS level, so a pass means it provably did
not reach out rather than merely happening not to. On-device inference answered a
question grounded in a local Word file in under three seconds with the network
cut. Details in `docs/OFFLINE_ARCHITECTURE.md`.

- Chat with the on-device model — this is the default channel
- Reading, summarising and drafting from local Word, Excel, PowerPoint and PDF
  files, plus OCR of images. These tools are pure local file access with no
  network dependency of any kind
- Reading previously synced email and calendar content
- Reminders and scheduled prompts, which run from local state
- All existing app state, which lives on the device in `~/.openclaw/`

**Needs connectivity, and degrades honestly when it is absent:**

- Cloud model turns through APIM, for the harder or vision-heavy requests
- Fetching new email and calendar data through Graph
- Form submission to Ministry systems
- Writing the audit trail and preferences to PostgreSQL

Two things in that second list are ours to fix rather than inherent limits, and
we'd rather name them than let them surface in the field:

- **A cloud turn during an outage currently fails instead of falling back to the
  on-device model.** The on-device model is the default and works offline, but if
  a principal has switched to "Online" the app keeps trying the cloud route. We're
  making channel selection connectivity-aware so that turn completes on-device
  instead of going silent.
- **Anything that needs to reach the Ministry offline needs a local queue**, so it
  is held and sent when the link returns rather than lost. That queue is new work
  for us, alongside the data layer itself.

**The design rule we'll hold to: PostgreSQL is where records are *durably kept*,
not where the application *reads to function*.** The laptop keeps working from
local state and reconciles when the connection returns. Anything a principal does
offline that needs to reach the Ministry — a form submission, an audit record —
is queued locally and sent when connectivity is back, rather than lost or
blocking.

**One requirement this places on the Ministry side:** the app server needs to
tolerate replayed and out-of-order writes, because a laptop that has been offline
will send records late and may retry one it never saw acknowledged. In practice
that means accepting a client-generated idempotency key per record and deduping
on it. Cheap to design in now; awkward to retrofit once there is data.

The practical consequence for the Ministry: **the app server being briefly
unreachable is a degraded experience, not an outage.** That is worth designing
for deliberately, because a principal on a dropped school connection at 3:30pm
still needs to get their daily report done.

**What we need from the Ministry to proceed:**

- Whether the app server should be **internet-reachable over TLS** (principals
  work from schools across seven districts, on networks the Ministry does not
  control) or restricted to iGovTT-reachable networks only. This is the one
  answer that most shapes the build, so it's the first thing we'd like settled.
  Offline capability makes an iGovTT-only answer *survivable* rather than fatal —
  a principal off-network would still have the on-device assistant and their
  local documents, with cloud turns and syncing resuming on Ministry premises.
  But it would meaningfully narrow what the assistant can do away from a Ministry
  network, so it should be an explicit choice rather than a default.
- A hostname / DNS name and certificate for it, if it is internet-facing.
- Confirmation the container will be given the DB credentials as environment
  variables or via their secret store — we don't want them baked into the image.

**What we'd store there** (so the scope is concrete, not open-ended): per-
principal preferences, an audit trail of assistant actions, form-submission
records, and reminder/cron schedules. No email bodies at rest.

## 1.2 One consequence worth naming: sign-in when offline

Moving the client secret and token handling into the app server (Section 2) has
one cost we should be upfront about: **the interactive sign-in itself needs
connectivity**, because it goes through Entra. A principal who has never signed
in, or whose refresh token has expired while they were offline for an extended
period, will need a connection once to get back to a working authenticated state.

This is inherent to any Entra-backed design rather than something the app server
introduces, and it does not affect the offline capabilities listed above — the
on-device model and local document work do not depend on a Microsoft token at
all. Flagging it so token lifetimes get set with this in mind: **longer refresh
token lifetimes directly reduce how often a principal is forced online purely to
re-authenticate.** We'd rather agree that with ICT policy than discover the limit
in the field.

## 2. Client secret: the app server changes our answer

Our earlier position was that the client secret in Section 5.1 was unusable and
should be swapped for a public client with PKCE. **With an app server in the
picture, that objection goes away.** The secret can live in the app server, which
is exactly the confidential client it was issued for. The desktop app does the
interactive sign-in; the app server performs the code exchange and holds the
tokens. This is the standard backend-for-frontend pattern and it's a better
posture than a public client, because refresh tokens never sit on a laptop.

**Consequence for the redirect URI** — the item Raj has been asking us for since
2026-07-20. Under this design it becomes the app server's callback, i.e.
`https://<app-server-host>/auth/callback`, so **it depends on the hostname
decision above.** We can give the final value the moment that hostname exists. If
the Ministry would rather register something now and not block, the loopback
`http://localhost:53682/callback` can be added alongside it for local development
without weakening the production path.

We'd rather settle it on the call than guess and have it rejected — that has
already cost this item a month.

## 3. Graph scopes: agreed as granted

`Mail.Read`, `Calendars.Read`, `User.Read`. Read-only is workable and we're not
requesting more.

Worth stating plainly so nobody is surprised later: the assistant **can** send
email on a principal's behalf, but it does so through the principal's own
already-signed-in browser session, with an explicit on-screen confirmation before
anything leaves — not through Graph. It never needs `Mail.Send`.

**On `Contacts.Read` — we agree with the refusal and won't be asking for it.**
Ansari's reasoning in 5.3 is correct, and the prompt-injection path he describes
is the realistic one precisely because reading untrusted inbound mail is the
assistant's core function. Declining it is the right call.

## 4. Token budget: comfortable for the pilot, and we owe you the rollout number

100M tokens/month is fine for pilot scale. But we measured what a turn actually
costs us before answering, and the honest picture for a full rollout is worth
putting in front of you now rather than at go-live.

A single cloud turn currently costs us roughly **10,650 tokens** — and about
**71% of that is fixed overhead** we resend on every turn (the assistant's tool
definitions and instructions), before the principal has typed anything. A typical
task like "summarise my last five emails" runs three turns, so ~38,000 tokens.

That means 100M/month buys about **2,600 cloud tasks for the entire fleet** —
roughly 0.6 tasks per principal per day at 200 schools. At meaningful cloud usage
across 200 schools the requirement is closer to **1.5–2B tokens/month**.

**We are not asking for an increase yet, because the first fix is ours.** That
71% overhead is our design, not your limit, and we have work in progress to cut
it (trimming the per-turn tool catalog), which alone buys roughly 78% more
capacity for no change in what the assistant can do. The assistant also defaults
to its on-device model, which costs you nothing — the budget math is one more
reason that default is right.

What would help from your side:

- **Is prompt caching available on the Foundry deployment behind APIM, and are
  cached prefix tokens billed against the 100M?** Our fixed overhead is identical
  on every request from every user, which is exactly what caching is for. This is
  potentially the single highest-leverage answer available, and free if it exists.
- **Agreement to review the allocation against measured pilot telemetry**, which
  Section 3.2 already anticipates. We'll supply real numbers rather than estimates.

## 4.1 One risk in Section 3.2 + 3.1 worth naming: a shared bucket with no gauge

The subscription key is a single credential against a single monthly budget, and
the gateway returns per-request `consumed-tokens` but no remaining figure. Taken
together, one principal bulk-processing a mailbox could consume a large share of
the fleet's month, and **the first symptom would be every principal's assistant
returning 429 at once, with no warning beforehand.**

We'd like to prevent that on our side, and the app server is the right place:

- **Per-user token accounting**, keyed on the same identity as the `UserId`
  header, summing the per-request headers you already return.
- **Per-user soft caps with a fleet reserve**, so one heavy user cannot starve the
  other 199. A principal hitting their own cap degrades to the on-device model
  rather than getting an error.
- **Our own running fleet total** — the gauge Section 3.2 doesn't provide. This
  turns "429 on an unknown date" into a forecast we can act on.
- **Graceful 429 handling**: on a fleet-level 429, clients fall back to on-device
  rather than failing.

Flagging it rather than just building it, since it means the app server is
enforcing policy on your behalf and you should agree with that. If you'd rather
the cap live at APIM, that works too — we just don't want the only backstop to be
a fleet-wide outage.

If Application Insights can also surface monthly consumption to us, even weekly,
that's a useful independent check on our own accounting.

## 4.2 On the `UserId` header (Section 3.3) — accepted, with one question

Agreed, and the app server is the right place to enforce it: it will stamp
`UserId` **from the authenticated session rather than from anything the client
sends**, so the Application Insights attribution is trustworthy rather than
dependent on each laptop being honest. It's also the key our per-user caps above
need, so we want it as much as you do.

One question: **should `UserId` be the Entra object ID (`oid`) or the UPN?** We'd
suggest `oid` — it's opaque rather than PII-shaped, and it survives a name or
email change, which UPN doesn't. Your document says "identifier of the signed-in
user" without specifying, and it's much easier to agree now than to re-key metrics
later.

Being straight about sequencing: the assistant today identifies the principal
implicitly, by riding whichever account is signed into their Chrome session. That
works well for Outlook and is the only approach Conditional Access permits, but it
means the app never learns the user's identity in a form it can put in a header.
So `UserId` arrives with the interactive Entra sign-in described in Section 2 —
they're the same piece of work, not two.

## 4.3 One item we'd like to settle early: migrations (Section 2.1)

Section 2.1 notes no admin or migration credential is issued, and to request
elevated privileges through the infrastructure owner if schema migrations need
them. **They will** — the data layer needs schema creation on day one and
migrations on most releases afterwards.

We'd rather agree the mechanism now than discover it during a deployment. Either
works for us:

- a migration credential used only by a gated migration job, not by the running
  app; or
- we submit reviewed migration SQL and your team applies it.

The second is more conservative and we're happy with it; it just needs a turnaround
expectation attached so releases don't stall.

## 4.4 Connection management (Section 2.3) — agreed, one consequence

No Redis is the right call at this scale and we're not asking for it. One
consequence worth flagging: it removes the obvious home for the per-user token
counters above, so **we plan to keep them in PostgreSQL**. At 200 principals the
write volume is negligible, and it keeps everything in one durable store.

Related, so it stays true if you later enable PgBouncer as Section 2.3
anticipates: **our data layer will avoid session-level features** (server-side
prepared statements, session `SET`, advisory locks) so transaction-mode pooling
stays available to you. Cheap to honour now, awkward to retrofit.

## 5. On the credential link

We have deliberately **not opened** the moevault link. It allows 5 accesses and
expires around 2026-08-26. We'd rather open it once, when the app server exists
and we know exactly where each value lands, than spend accesses reading values we
can't yet use.

**If it lapses before then, please just reissue it** — a reissued link costs
nothing; a spent access can't be recovered.

## What we'd like from the session

Ansari's document is the most complete handoff we've had on this project, and we
accept nearly all of it as written. Suggest 45 minutes, with Ansari present if
possible since Sections 2 and 5 are his:

1. **App server hostname and reachability** — internet-facing over TLS, or
   iGovTT-only? Everything else keys off this.
2. **Confirm the offline posture in Section 1.1 is acceptable to the Ministry** —
   specifically that the laptop keeps working from local state and reconciles
   later, rather than requiring a live connection to function. The one thing we
   need agreed on their side is that the app server accepts **replayed and
   out-of-order writes with a client-supplied idempotency key**, since a laptop
   returning from an outage will send records late and may retry.
3. **Confirm the backend-for-frontend approach**, then the redirect URI closes on
   the spot. Worth covering refresh token lifetimes here too (Section 1.2).
4. **Developer IPs** for the DB whitelist, and how the container receives its
   secrets.
5. **Prompt caching behind APIM** — available, and billed against the 100M? This
   is the cheapest possible win on the budget math in Section 4.
6. **Per-user caps enforced by the app server** — agree the approach, or would you
   rather it sat at APIM? Either way we want a backstop that isn't a fleet-wide
   429.
7. **`UserId` = `oid` or UPN** (Section 4.2), and the **migration mechanism**
   (Section 4.3). Both are small decisions that block larger work.
8. Application Insights monthly-consumption visibility.

On fleet size: our arithmetic assumes ~200 primary schools because that's what our
existing costing uses. **If the intended rollout curve is different, tell us — the
budget is comfortable for a small pilot and tight for a full rollout, so the
expected number changes what we prioritise.**

We'll have the Docker image ready to hand over once item 1 is settled.

---

## Notes for Anton — not part of the reply

- **Nothing sent. The Ministry send is your gate.**
- **The moevault link is unopened.** 5 accesses, ~6 days left as of today.
- **This draft reverses my earlier recommendation** to drop PostgreSQL, per your
  call that it runs in their cloud. The reversal is a net win: accepting their
  app server also fixes the APIM-key-on-every-laptop exposure and the client-
  secret problem, both of which were awkward under the desktop-only design.
- **Real work this commits us to**, so worth knowing before you send: a
  PostgreSQL data layer and Graph token exchange in `services/model-broker`
  (no `pg` client in `package.json` yet), plus routing ClawX inference through
  the broker instead of calling providers directly. The container and its auth
  and model allow-listing already exist and pass tests.
- **The offline story is now half tested and half promised, and the draft says
  which is which.** Full analysis in `docs/OFFLINE_ARCHITECTURE.md`.
  - **Tested:** `eval` lane G runs the document path in a child process with
    egress blocked at the fetch, socket and DNS level, and fails on any attempt.
    On-device inference answered a question grounded in a local `.docx` in
    0.5–2.6s with the network cut. So "works offline" is a measured property now.
  - **Worth knowing about that test:** my first version of it was green and
    worthless — it caught none of the raw socket connections, because
    `net.connect()` packs its arguments into an array and the guard was reading
    the wrong field. Zero violations looks identical whether the guard is perfect
    or inert. It now makes six deliberate egress attempts and fails if it can't
    catch all six; I mutation-tested that by reintroducing the bug, and the lane
    goes red. Flagging it because it's the same trap as the tool-selection lanes.
  - **Not built, and I found one of these by checking rather than assuming:**
    (a) there is **no send-time cloud→on-device fallback** — `preferredChannel` is
    sticky, and the launch-time fallback in `channel-router.ts` keys off whether an
    *account* is configured, never reachability. So a principal switched to
    "Online" on a dead link gets silence, not degradation. (b) No outbox, queue,
    retry or sync exists anywhere in `electron`, `extensions`, `src` or `services`,
    and there's no `pg` client. Both are named in the reply as our work.
  - **My recommendation on sequencing:** the fallback fix before the outbox. It's
    smaller, it removes a silent-failure mode principals would actually hit during
    the pilot, and it needs nothing from the Ministry. The outbox can't be tested
    against anything real until the app server's write API exists.
  - If you'd rather not commit to store-and-forward before we've scoped it, the
    paragraph in 1.1 is the one to soften — but the idempotency-key ask on the
    Ministry side is worth keeping either way, since it's much cheaper to design
    in now than to retrofit.
- **The token budget is tighter than it looks, and that's on us.** Full working in
  `docs/SCALE_ANALYSIS_2026-08-20.md`. Measured from our own code: 31 tool
  definitions (~3,594 tok) + their schemas (~1,918) + persona (~1,880) = a
  **~7,550-token floor resent on every single turn**, which is ~71% of a typical
  10,650-token turn. So 100M/month is ~2,600 cloud tasks for the whole fleet, or
  0.6 tasks per principal per day at 200 schools. Only ~6% of tasks can go to the
  cloud at that scale.
  - I deliberately did **not** open the reply with a request for more tokens.
    Asking for a 16x increase to fund a 71%-overhead design wouldn't survive
    scrutiny, and it would spend goodwill on the wrong thing. The draft shows the
    measurement, commits us to fixing our side first, and gives them the ~1.5–2B
    rollout figure as a forecast.
  - **This puts `fix/tool-catalog-trim` (`7add864b`) on the critical path for
    scale.** It's under HOLD awaiting a reviewer pass, and I haven't touched it —
    flagging that the HOLD is now blocking scale work rather than routing around
    it. Trimming the floor to ~2,000 buys ~78% more capacity with no product
    change. Your call on whether to unblock the review.
  - **Prompt caching is the free win if it exists** — our fixed prefix is identical
    across every turn and every user. Worth pushing on in the call.
- **The shared-bucket risk is the one I'd most want fixed before rollout.** One key,
  one budget, no remaining-budget figure returned. One principal bulk-processing
  could burn a large share of the fleet's month, and the first symptom is *every*
  principal getting 429 simultaneously. There is no cap anywhere today — the only
  hit in the tree is an unused `RATE_LIMITED` enum in `gateway/protocol.ts:77`, and
  `model-broker/server.mjs` authenticates but does no accounting at all. Note the
  429 mitigation and the offline fallback from `OFFLINE_ARCHITECTURE.md` §3.1 are
  **the same fix**, which is why I'd rank it first overall.
- **`UserId` is not a one-liner.** The app has no signed-in-user identity today —
  the only `userPrincipalName` in the tree is the stub `'principal@school.example'`
  at `microsoft-graph/manager.ts:257`, and the real Outlook path identifies the
  principal only implicitly via their Chrome session. So C3 arrives with Entra
  sign-in, and **per-user caps can't exist before identity does.** That dependency
  chain is why sign-in is a scale blocker, not just a feature.
- **Delegated-only Graph means no overnight fleet processing.** Every Graph call
  needs a signed-in user context; there's no service-principal path to "classify
  all 200 mailboxes overnight." I think we accept that rather than design around
  it, but it's a real constraint on anything cron-shaped and worth you knowing
  before someone promises it in a demo.
- **The hostname question is the real blocker**, not the credentials. Principals
  are in schools across seven districts on networks the Ministry doesn't control,
  so an iGovTT-only app server would mean the assistant only works on Ministry
  premises. If that's the answer, we need to know early — it's a product
  constraint, not a detail.
- The 2026-07-31 five-deliverable list is **obsolete**: the Ministry chose their
  own model, killing the Foundry shortlist, and the datastore proposal is now
  settled by their provisioning.
- Related: `project_ministry_infra_handoff`,
  `reference_ministry_ict_working_session`, `reference_entra_packet`.
