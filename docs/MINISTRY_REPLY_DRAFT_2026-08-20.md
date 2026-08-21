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
| 5 | `UserId` header on all authenticated requests | Accepted, and the app server is the right place to enforce it. |

We accept Section 2.2 as written: the database firewall stays closed, end-user
laptops never touch PostgreSQL, all traffic goes through the whitelisted app
server. We are not asking for a broader firewall opening.

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

## 4. Token budget and metrics

100M tokens/month is comfortable for pilot scale, so no concern about the
allocation itself. One practical note on Section 3.2: the gateway returns
per-request `consumed-tokens` but no remaining-budget figure, so neither side
sees the month's trajectory until a 429 arrives — which would surface as a
principal's assistant going silent mid-day. Two mitigations, both cheap:

- We'll log every per-request header in the app server and track our own running
  total (easy now that requests funnel through one place).
- If Application Insights can surface monthly consumption to us, even weekly,
  we'd catch a runaway well before it becomes a hard stop.

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
5. Application Insights monthly-consumption visibility.

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
