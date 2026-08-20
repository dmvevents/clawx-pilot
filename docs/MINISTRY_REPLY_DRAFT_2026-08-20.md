# Ministry reply — DRAFT for Anton's review, 2026-08-20

**Status: DRAFT. Not sent. Anton reviews and sends.**

Responding to `MOE Email AI Assistant Handoff.docx` (Ansari Khan, MoE Information
Systems Support Specialist, 2026-08-18), forwarded by Raj over WhatsApp
2026-08-19 22:23, with the moevault secure-send link at 22:24.

Ansari's Section 6 asks for five things. Two we can answer now, one is a real
architecture decision, and two are blocked on the first. The reply below leads
with the decision rather than burying it, because everything else depends on it.

---

## What we can answer without opening the credential link

| Section 6 item | Our answer |
|---|---|
| 3. Credentials into secret manager, no plaintext copies | Done by construction — link not opened, nothing to scrub. See "credential link" note below. |
| 5. `UserId` header on all authenticated gateway requests | Accepted, no objection. Wiring it is trivial once there is a gateway to call. |
| 1. App-server deployment approach | **Needs the conversation below.** ClawX is a desktop app; the premise differs. |
| 2. Developer IPs for DB whitelisting | Blocked on item 1 — and see "do we need the DB at all". |
| 4. Run the Python smoke test | Blocked: needs the credential values (see below). |

---

## The one thing worth a call: our app is a desktop app, not a hosted service

Ansari's Section 1.1 architecture is `Application -> App server -> PostgreSQL`,
with "end-user machines never connect to the database directly", and Section 2.2
asks us to hand over a Docker image or take a VM.

That is a sound design for a web service. ClawX is not one. It is a native
Electron application that installs on the principal's own Windows or Mac laptop
and keeps its state locally in `~/.openclaw/`. The principal's laptop **is** the
end-user machine, and there is no server tier between it and anything.

So the honest answer to "send us a Docker image" is: there isn't one to send,
and building an app server purely to satisfy the database path would add a
component the product does not otherwise need.

**Which raises the question we should settle first: does the pilot need the
PostgreSQL database at all?**

Our read is no, not for the pilot. Everything the assistant currently persists
is per-principal and already lives on the principal's device. We asked for a
datastore back on 2026-07-31 when the shape was still open; the desktop
architecture has since made it unnecessary. If that is right, then Section 2
(database) and the app-server provisioning both drop out of the pilot scope,
and items 1 and 2 of Section 6 close with no work on the Ministry's side.

Three options, in the order we'd recommend them:

1. **Drop PostgreSQL from the pilot.** State stays on-device. Nothing to
   provision, nothing to whitelist, no app server. Revisit if and when we need
   cross-device sync or central reporting — at which point the app-server
   design becomes the right answer rather than a workaround.
2. **Keep the DB, add a thin app server.** If the Ministry needs central
   persistence for audit or reporting reasons we haven't accounted for, we
   accept the Docker route. This is real scope, so it should be a decision made
   deliberately and not by default.
3. **Direct DB from the laptop.** We are **not** proposing this. Ansari
   explicitly rules it out and he is right to — it would mean a database
   credential shipped inside a desktop binary. Listing it only to confirm we
   are not asking for it.

## Three smaller items, all resolvable on a call

**a. `{{ AZURE_REDIRECT_URI }}` — still the item you asked us for.** Raj first
asked on 2026-07-20 and it is still a placeholder in Section 5.1. Ours is a
loopback: `http://localhost:53682/callback`. That is the standard pattern for a
native app and it is valid — but only if the app registration is a public
client, which runs into (b).

**b. Client secret vs public client.** Section 5.1 issues a client secret, which
makes this a confidential client. A desktop application cannot hold a secret
safely; anything shipped in the installer is extractable from every laptop it
lands on. The standard fix is well-trodden: register as a **public/native client
using PKCE, with no secret**. Same delegated permissions, same tenant-wide
consent, same read-only posture — the only change is dropping the secret and
enabling the loopback redirect. This also retires the Section 5.1
`{{ SECRET_EXPIRY_DATE }}` rotation task entirely.

**c. Read-only Graph scopes — confirming, not contesting.** `Mail.Read`,
`Calendars.Read`, `User.Read`. Understood and workable: the assistant's email
*sending* runs through the principal's already-signed-in browser session under
their own credentials, with an explicit on-screen confirmation before anything
goes out, so it never needs `Mail.Send`. Worth stating plainly so nobody is
surprised later that sending works — it works because a human authorises each
send in their own session, not because Graph grants it.

And **`Contacts.Read`: we agree with the refusal.** Ansari's reasoning in 5.3 is
correct, and the prompt-injection path he describes is the realistic one given
the assistant reads untrusted inbound mail. We are not going to ask for it.

## On the credential link

We have deliberately **not opened** the moevault link. It permits 5 accesses and
expires around 2026-08-26. Opening it before we know where the credentials
should land would spend a limited view for nothing, and there is no point
pulling production credentials anywhere until the questions above are settled
— particularly since the DB credentials may turn out to be unnecessary.

Once we've agreed the architecture, we'll open it once, move the values straight
into the secret manager, and run the Section 4 smoke test — including confirming
the `consumed-tokens` header behaves as documented.

**If the link lapses before then, no harm — please just reissue it.** Better a
reissued link than a spent access.

## Also worth flagging: token budget shape

100M tokens/month is generous for the pilot's size, so no concern there. One
practical note: Section 3.2 says the gateway returns no remaining-budget figure,
only per-request `consumed-tokens`. That means neither side sees the month's
trajectory until the 429 lands. We'll log every per-request header locally so we
can track our own consumption, but if Application Insights can surface a running
monthly total to us, even weekly, that would let us catch a runaway well before
it becomes a hard stop mid-day for a principal.

## What we'd like from the session

Ansari's document is the most complete handoff we've had on this project and
most of it we can just accept. Suggest 45 minutes, with Ansari present if
possible since Sections 2 and 5 are his:

1. **PostgreSQL: in or out of pilot scope?** (drives the app-server question)
2. **Public client + PKCE instead of client secret** — then we confirm the
   redirect URI on the spot and that item finally closes
3. Application Insights monthly-consumption visibility

---

## Notes for Anton — not part of the reply

- **Everything above is a draft.** Nothing sent. The Ministry send is your gate.
- **The moevault link is unopened.** 5 accesses, ~6 days left as of today.
- The old five-deliverable list from 2026-07-31 is **obsolete**: the Ministry
  picked the model themselves, so the Foundry short-list deliverable is dead,
  and the datastore-stack proposal is what the DB question above supersedes.
- The reply deliberately **concedes** `Contacts.Read` and read-only scopes
  rather than negotiating them. Both are correct calls on their side, and
  agreeing costs us nothing — our send path doesn't use Graph.
- Option 1 (drop PostgreSQL) is a scope *reduction* for the Ministry, so it
  should be easy to say yes to. But it is a product call, so it is written as a
  recommendation, not a decision.
- Related: `project_ministry_infra_handoff`, `reference_ministry_ict_working_session`,
  `reference_entra_packet`.
