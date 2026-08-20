# Ministry reply — DRAFT for Anton's review, 2026-08-20

**Status: DRAFT. Not sent. Anton reviews and sends.**

Responding to `MOE Email AI Assistant Handoff.docx` (Ansari Khan, MoE Information
Systems Support Specialist, 2026-08-18), forwarded by Raj over WhatsApp
2026-08-19 22:23, with the moevault secure-send link at 22:24.

**Decision taken (Anton, 2026-08-20): PostgreSQL runs in the Ministry's cloud
environment as provisioned.** We accept their architecture rather than argue for
on-device-only state. That means we owe them an app server, and the reply below
is built around delivering one.

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
        |
        v
App server in MoE Azure  ---> APIM ---> AI Foundry
   (Docker, IP whitelisted)
        |
        v
   PostgreSQL
```

**What we need from the Ministry to proceed:**

- Whether the app server should be **internet-reachable over TLS** (principals
  work from schools across seven districts, on networks the Ministry does not
  control) or restricted to iGovTT-reachable networks only. This is the one
  answer that most shapes the build, so it's the first thing we'd like settled.
- A hostname / DNS name and certificate for it, if it is internet-facing.
- Confirmation the container will be given the DB credentials as environment
  variables or via their secret store — we don't want them baked into the image.

**What we'd store there** (so the scope is concrete, not open-ended): per-
principal preferences, an audit trail of assistant actions, form-submission
records, and reminder/cron schedules. No email bodies at rest.

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
2. **Confirm the backend-for-frontend approach**, then the redirect URI closes on
   the spot.
3. **Developer IPs** for the DB whitelist, and how the container receives its
   secrets.
4. Application Insights monthly-consumption visibility.

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
