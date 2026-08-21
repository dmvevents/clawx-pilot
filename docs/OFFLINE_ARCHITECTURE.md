# Offline architecture — what works, what doesn't, and what we're building

**Status: design doc. Written 2026-08-20 against commit `c9f1aa34`.**

The Ministry's infrastructure handoff (`MOE Email AI Assistant Handoff.docx`,
Ansari Khan, 2026-08-18) puts PostgreSQL and an app server in the Ministry's
Azure environment, and the decision taken on 2026-08-20 is to accept that
architecture. That makes a question load-bearing that was previously incidental:

> If the internet connection breaks, can the local model still run, can we
> persist things, and can we synchronise with the database?

This document answers each part with test evidence rather than intent, and
separates **what is true today** from **what we are committing to build**. The
short version:

| Question | Answer | Basis |
|---|---|---|
| Can the local model still run? | **Yes** | Proven under a blocked network — `eval` lane G |
| Can we persist locally? | **Yes, partially** | Local state exists; not everything routes through it |
| Can we synchronise with the database? | **No — does not exist** | Grepped the tree; no outbox/queue/retry/sync |
| Does a cloud turn degrade gracefully when offline? | **No — it fails** | Fallback is launch-time and reachability-blind |

The last two rows are the work. They are not hedges — they are named gaps with
owners and a design below.

---

## 1. Why this matters more than it looks

A principal's laptop loses connectivity routinely: school networks drop, and
principals work from home and between sites across seven districts. The 3:45pm
daily-report deadline does not move when the link does.

The failure mode we care about is not "some features are unavailable". It is
**a principal at 3:30pm on a dropped connection with an assistant that appears
broken**. That is a trust event, and trust is the pilot's actual deliverable.

There is a second, structural reason. Introducing an app server adds a component
between the laptop and everything cloud-shaped. If the app server is in the
critical path for the app to *function*, then every Ministry-side outage,
deployment or certificate expiry becomes a fleet-wide outage on principals'
laptops. The design rule that avoids this is stated in §4.

---

## 2. What works with no connectivity — tested, not asserted

### 2.1 The test

`eval/run.mjs` lane G (`pnpm eval:ci`) runs the document path in a child process
that has been **denied the network**. Before importing anything, it patches:

- `globalThis.fetch`
- `net.Socket.prototype.connect`
- `dns.lookup` / `resolve` / `resolve4` / `resolve6`

Every non-loopback target is **recorded and blocked**. This distinction is the
whole point: a pass means *"provably did not reach the network"*, not *"the
network happened to be unused"*. The latter is not evidence — it is a coincidence
that holds until someone adds a telemetry call.

Current result:

```
PASS  lane G offline — network-cut document path          4P 0F 0S
  G-doc-read     read 176 chars from .docx with the network blocked
  G-no-egress    zero non-loopback fetch/socket/DNS attempts during the document path
  G-guard-live   egress guard caught all 6 deliberate attempts — G-no-egress can go red
  G-model        on-device model answered from local file content in 2577ms (qwen2.5:3b-instruct)
```

### 2.2 Why `G-guard-live` exists (read this before trusting the lane)

The first version of this guard **reported zero violations while catching almost
nothing**, and looked green. `net.connect()` normalises its arguments and hands
`net.Socket.prototype.connect` a single *packed array* — `[[{host, port}, cb]]` —
so reading `args[0].host` returned `undefined`, defaulted to loopback, and every
raw socket connection sailed through unrecorded.

`G-no-egress` passed anyway. It had to: **an inert guard is indistinguishable
from a clean run.** Zero violations is the expected output of both a perfect
result and a broken instrument.

So the lane now makes six deliberate egress attempts *after* taking its
measurement — `fetch`, `net.connect(options)`, `net.connect(port, host)`,
`net.createConnection`, `dns.lookup`, `http.get` — and fails if it cannot record
all six. Mutation-tested by restoring the naive host read: the guard catches 3 of
6, the lane goes red, and `G-no-egress` **still reports PASS**. That is the
demonstration that the negative control, not the primary check, is what makes
this lane worth anything.

This is the same discipline lane B applies to tool selection: a metric that
cannot reproduce a known failure proves nothing when it passes.

### 2.3 What the test establishes

**The on-device model runs offline.** `qwen2.5:3b-instruct` answered a grounded
question about a local `.docx` in 0.5–2.6s across runs, over
`http://127.0.0.1:11434/v1/chat/completions` — the same endpoint the app uses
(`electron/main/local-provider-seed.ts:61-63`). On-device is already the
**default** channel (`electron/utils/store.ts:127`), not a fallback we are
proposing.

**Local document work is genuinely network-free.**
`extensions/moe-principal-assistant/doc-tools.mjs` imports only `node:fs`,
`node:fs/promises`, `node:module`, `node:os`, `node:path` — zero `fetch`, zero
HTTP. Lane G confirms this dynamically as well as by inspection, which matters
because the static property is one careless import away from being false.

### 2.4 The full offline surface

Works with no connectivity:

- Chat with the on-device model (the default channel)
- Read, summarise and draft from local Word, Excel, PowerPoint and PDF; OCR
- Reading previously synced mail and calendar content
- Reminders and scheduled prompts, which run from local state
- All existing app state in `~/.openclaw/`

Requires connectivity:

- Cloud model turns through APIM (harder or vision-heavy requests)
- Fetching new mail/calendar via Graph
- Form submission to Ministry systems
- Writing the audit trail and preferences to PostgreSQL
- Interactive Entra sign-in (see §6)

---

## 3. What does not work — the two real gaps

### 3.1 Gap 1: a cloud turn during an outage fails instead of degrading

This is the more urgent of the two, and it is not what I assumed before checking.

`preferredChannel` is **sticky persisted state** (`electron/utils/store.ts:69`,
default `'on-device'` at line 127), changed only by an explicit user toggle
through `runChannelTransaction`. **There is no send-time fallback from cloud to
on-device.**

There *is* a fallback, but it does not help here. `runChannelPreflight`
(`electron/services/providers/channel-router.ts:231`) falls back to another
channel when the desired one is unavailable — but:

1. it runs at **launch only**, not per turn; and
2. `listAvailableChannels()` (line 182) classifies availability by **configured
   account**, never by reachability — it maps accounts to channels through
   `classifyAccount` and returns the set.

So for a principal who has toggled to "Online", with a cloud account configured,
on a dead link: the online channel is considered available, preflight applies it,
and the turn fails at send time. The assistant goes silent — the exact symptom
the four-store coherence work was built to eliminate, arriving through a
different door.

**Fix (new work):** reachability-aware channel selection. On send failure with a
network-class error, degrade to on-device for that turn, surface it in the UI in
the product's existing vocabulary ("On this device" — no model IDs, per the
CLAUDE.md hard rule), and return to the user's preference when connectivity
comes back. The user's explicit toggle must remain authoritative; this is
degradation, not preference-editing, and `preferredChannel` should not be
silently rewritten.

**Test to write:** extend lane G with a cloud-turn-under-blocked-network check
asserting the turn completes on-device rather than erroring. Lane G already has
the harness for it — the network-cut child process — so this is a check, not new
infrastructure.

### 3.2 Gap 2: there is no synchronisation at all

Grepped `electron`, `extensions`, `src` and `services` for `outbox`,
`storeAndForward`, `pendingSync`, `syncQueue`, `retry`-queue and reconciliation
concepts. The only `reconcil*` hits are **config-store coherence** (
`channel-router.ts`, `gateway.ts`, `settings.ts`) — a different problem entirely,
concerned with which model is selected, not with durable delivery of records.

**There is no outbox, no queue, no retry ledger, no sync engine anywhere in the
tree.** Nor is there a PostgreSQL client: `pg` is not in `package.json`.

So "queued locally and sent when connectivity returns" is a **commitment we would
be making, not a capability we have**. §5 is the design; it is honest work, not a
small patch.

---

## 4. The design rule

> **PostgreSQL is where records are durably kept, not where the application reads
> to function.**

The laptop works from local state and reconciles later. Concretely:

- No read path on a principal's critical journey may block on the app server.
- Every write that must reach the Ministry goes to a **local durable queue
  first**, and is acknowledged to the principal from there.
- The app server being unreachable is a **degraded experience, not an outage**.

This is what makes the Ministry's architecture safe to accept rather than a
fleet-wide single point of failure. It is also the specific thing to confirm with
Ansari on the call, because it constrains their side too: it means the app server
must tolerate replayed, out-of-order, and delayed writes.

---

## 5. The solution: store-and-forward

### 5.1 Shape

```
Principal's laptop                             MoE Azure
  ┌──────────────────────────────┐
  │ on-device model  (always)    │
  │ local file tools (always)    │
  │ local state ~/.openclaw/     │
  │                              │
  │   ┌──────────────────────┐   │   when reachable
  │   │ outbox (durable)     │───┼──────────────────▶ app server ──▶ PostgreSQL
  │   │ append-only, w/ ids  │   │   idempotent replay      │
  │   └──────────────────────┘   │◀─────────────────────────┘
  │      drains in background    │      server ack clears entry
  └──────────────────────────────┘
```

### 5.2 Requirements the outbox must meet

These are not generic best practices; each maps to a hard rule or a real incident
in this repo.

1. **Atomic and idempotent writes.** Temp-file plus `rename()`, and calling twice
   produces identical state. This is an existing engineering invariant in
   CLAUDE.md, enforced by `state-idempotency-auditor`, and the outbox is exactly
   the class of writer that motivated it.
2. **Client-generated idempotency key per entry.** The server must dedupe on it.
   Without this, "retry until acked" means a principal's daily report can be
   submitted twice — worse than not submitting it.
3. **Append-only with explicit terminal states** (`pending` → `sent` → `acked`,
   plus `failed-permanent`). A queue that silently drops is worse than no queue,
   because it manufactures false confidence.
4. **Bounded, visible retry.** Exponential backoff with a cap, and a surfaced
   count of pending items. A principal must be able to see "3 items waiting to
   sync" rather than discover it at an audit.
5. **No secrets and no email bodies in the queue.** The log rules apply: subject
   truncated to 120 chars, recipient counts only, no bodies, no credentials.
   Queue entries live on disk longer than log lines do, so the bar is higher.
6. **Never lose an evidence-grade record to a cleanup path.** Draining and
   pruning are separate operations; pruning only removes `acked` entries.

### 5.3 What lands where

| Record | Local outbox | PostgreSQL |
|---|---|---|
| Per-principal preferences | authoritative | mirrored |
| Assistant action audit trail | written first | durable record |
| Form-submission records | written first, replayed | durable record |
| Reminder / cron schedules | authoritative | mirrored |
| Email bodies | never | never |

### 5.4 Testing it

Lane G is the harness. The additional checks, in dependency order:

- **G-outbox-durable** — enqueue under a blocked network, kill the process, and
  assert the entry survives a restart. Persistence claims that are not
  crash-tested are not persistence claims.
- **G-outbox-idempotent** — replay the same entry twice against a stub server;
  assert one logical record.
- **G-outbox-drain** — unblock the network and assert entries reach the stub and
  transition to `acked`.
- **G-cloud-degrades** — the §3.1 check.

Each needs its own negative control, for the reason §2.2 documents: a queue test
that cannot fail when the queue is inert is not a test. Specifically,
G-outbox-durable must be shown to go red when persistence is stubbed out.

---

## 6. Sign-in is the one honest exception

Interactive Entra sign-in requires connectivity, because it goes through Entra. A
principal who has never signed in — or whose refresh token expired during an
extended offline period — needs a connection once to reach a working
authenticated state.

This is inherent to any Entra-backed design and is not introduced by the app
server. It does not touch the §2 offline surface: the on-device model and local
document work need no Microsoft token at all.

The mitigation is policy, not code: **longer refresh-token lifetimes directly
reduce how often a principal is forced online purely to re-authenticate.** Worth
agreeing with ICT rather than discovering the limit in the field.

Note the backend-for-frontend design *improves* this posture: refresh tokens live
in the app server, not on laptops.

---

## 7. Status summary

| Item | State | Evidence / next step |
|---|---|---|
| On-device model runs offline | **Done** | lane G `G-model` |
| Local document path is network-free | **Done** | lane G `G-doc-read` + `G-no-egress` |
| Egress guard is falsifiable | **Done** | lane G `G-guard-live`, mutation-tested |
| Local state persists | **Partial** | `~/.openclaw/`; not all writes route through it |
| Cloud turn degrades when offline | **Not built** | §3.1 — reachability-aware selection |
| Store-and-forward outbox | **Not built** | §5 |
| PostgreSQL data layer | **Not built** | no `pg` in `package.json` |
| App server container | **Partial** | `services/model-broker` + Dockerfile exist, tested |

**Ordering recommendation:** §3.1 before §5. The cloud-turn fallback is smaller,
removes a silent-failure mode principals would hit in the pilot, and needs no
Ministry-side dependency. The outbox needs the app server's write API to exist
before it can be tested against anything real.

---

## 8. Open questions for the Ministry

1. **App server reachability** — internet-facing over TLS, or iGovTT-only?
   Offline capability makes an iGovTT-only answer *survivable* rather than fatal,
   but it meaningfully narrows what the assistant can do away from a Ministry
   network. This should be an explicit choice.
2. **Does the app server tolerate replayed and out-of-order writes?** §4 requires
   it, and it constrains their schema (idempotency keys, client timestamps).
3. **Refresh-token lifetimes** (§6).
4. **Application Insights monthly consumption visibility** — the gateway returns
   per-request `consumed-tokens` but no remaining budget, so neither side sees the
   month's trajectory until a 429 surfaces as an assistant going silent mid-day.

---

## Related

- `docs/MINISTRY_REPLY_DRAFT_2026-08-20.md` — the reply built on this analysis
  (**unsent**; Ministry sends are Anton's gate)
- `docs/PRODUCT_PRINCIPAL_ASSISTANT.md` — feature-by-feature status
- `eval/run.mjs` — lane G
- `CLAUDE.md` — engineering invariants, including atomic/idempotent state writers
