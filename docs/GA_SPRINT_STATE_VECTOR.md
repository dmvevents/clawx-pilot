# GA sprint — state vector, parallelization, and flight checks

_Authored 2026-09-02; **updated 2026-09-02 (second pass)** after KR1 full PASS,
KR5 wiring, moe.13 build, and the VM-lane auth outage. The operating plan for
driving the 8 KRs to GA with maximum parallelism and minimum re-debugging.
Pairs with `GA_SPRINT_PLAN_2026-09-02.md` (sequencing), `docs/wiki/GA_READINESS.md`
(GO/NO-GO scorecard), `docs/VM_TEST_BASE.md` (persona test base) and the Plane
board (live state). Ceiling for agents is **Ready**; a human declares GA._

_Finish-vector execution log: 2026-09-02 audit tick — CLWX-10/41/23/45 to
Ready (GA packet assembled; stakeholder report complete; timeline current;
7 closeout drafts staged draft-and-hold). **moe.15 built + signed
(`d10de580…18df`), uploaded to GCS — one VM smoke from being the GA tag.**
Board: 18 Ready / 5 In Progress / 10 Todo / 0 Backlog._

_Graph-test thread (2026-09-02, owner-directed): `docs/GRAPH_TEST_PLAN.md`
published — P1–P6 prerequisites matrix, 7-rung ladder (L1 sign-in → L7
UserId), RACI, timeline. The 01b delta message (enumerated permissions +
dev redirect URI) is SEND-READY with owner GO on record; the guard hook
requires owner execution (`send-01b.sh`). Twin-tenant insight: fac.edu.tt
can host the twin registration against the existing test mailbox — ONE
owner answer needed (do we hold admin there?). CLWX-39/40 updated with the
ladder; session card carries the pre-session L1–L4 opportunity._

_01b SENT (owner-authorized, 09-02): the enumerated permissions list +
dev-redirect-URI ask delivered to Raj (bridge 200, ledgered). **The 07-20
owed deliverable is cleared — the ball is with the Ministry for the first
time since July.** Next trigger: Ansari registers the dev URI → ladder
L1–L4 runs pre-session._

_Deep-dive discovery (09-02): `moe.gov.tt` and `fac.edu.tt` are ONE Entra
tenant (`9590bb09-…ebfe`, public metadata + branded sign-in confirmation).
Tenant-ID placeholder solved; twin tenant unnecessary (test.fac lives in the
Ministry tenant); only the client id + dev-URI registration remain (asked in
01b). Portal self-verification blocked by the admin-portal MFA-enrollment
gate on test.fac — owner decision documented in GRAPH_TEST_PLAN (recommend:
don't enroll; zero lane risk path is Raj handing over the client id)._

_Office-write + preflight tick (2026-09-02): **Word/Excel WRITE is now GREEN on
Windows** — `pilot-office-write-smoke.ps1` drove the packaged VM node through the
real write path (write .docx 8582 B + .xlsx 16077 B to media/outbound, read both
back) → `STATE: OFFICE_WRITE_OK`; Mac fn-level round-trip 8/8. Gap-B leg b1
(runtime write) DONE; b2 (live in-app write turn) still open. The **enforced
preflight gate** (commit 617a6ceb) now fronts package:mac/package:win/build:win
(`typecheck && vitest run && harness:doc-tooling-e2e`, full run GREEN 5/5) and
caught + hardened one flaky harness test under CPU contention. moe.15 verified by
hash (`d10de580…18df`); Phase A (assisted install + Windows smoke incl. b2)
underway on the running VM. GHIP #354 (full-toolset laptop-verification card,
project `c6717c2c`, the GitHub-Issues project — NOT the CLWX board mirrored in
`docs/plane-board/`) moved Todo → In Progress with evidence._

_**moe.15 GA candidate INSTALLED + smoked on the VM (2026-09-02).**
`clawx-win-rc-20260609` over IAP: uploaded (SHA256 verified `d10de580…18df`),
silent `/S` install (no console session for the assisted GUI path; `quser`
empty), exe FileVersion `0.4.3-moe.15`, tree complete, docx/xlsx/mammoth/
playwright-core all present. **Gateway boot `RESULT=COMPLETE`** ready on 18789;
**office write `OFFICE_WRITE_OK`** (.docx 8582 B + .xlsx 16077 B round-trip).
Gap A DONE; W6/W7 GREEN on the GA build. Remaining moe.15 legs are
GUI-session-dependent (b2 in-app write turn, managed-CDP visual smoke) plus gap
C (ASR) and gap D (cron) — owner's assisted-GUI desktop validation. VM stopped
(TERMINATED) after the run. Evidence:
`skills/laptop/evidence/2026-09-02-moe15-install-verify/RESULT.md`._

_**Graph/Entra unblock — L1–L3 PASS live (2026-09-02, sprint tick).** The
~6-week external gate CLEARED: the Ministry (Ansari) delivered the real
Application (client) ID + registered the dev redirect URI
`http://localhost:53682/callback` with read-only admin consent (profile + inbox
read + offline_access). Built `scripts/graph-signin-smoke.ts` (PKCE loopback over
the shipped `extensions/microsoft-graph` modules) and ran it with the sandbox
`test.fac@fac.edu.tt`: **L1 PASS** (token via PURE PKCE, no client secret;
refresh token from offline_access), **L2 PASS** (stable `oid` present = the KR7
UserId key; `tid=9590bb09`), **L3 PASS** (`/me` + inbox read, 5 msgs). typecheck
exit 0. Non-secret config in gitignored `~/openclaw-agent/secrets/graph.env`; the
client secret is stored NOWHERE (recommend rotation — it passed through chat).
This is an O→P promotion: **CLWX-39 (flag-gated sign-in) Todo→In Progress** and
**CLWX-30 (KR7 UserId) Todo→In Progress** — held below Ready because the in-app
`CLAWX_GRAPH_AUTH` flag wiring + host `getAccessToken`/token persistence are still
pending (`plugins.microsoft-graph.enabled` stays false: `register()` throws
without host wiring). Next atomic item: the host token wiring that lights up the
6 parked Graph tools in-chat. Evidence:
`skills/laptop/evidence/2026-09-02-graph-signin-L1-L3/RESULT.md`._

## THE FINISH VECTOR (2026-09-02 audit — the path to GA declaration)

Every non-terminal card, its closing action, and who closes it. Three
buckets; when bucket A is empty and bucket B is done in one sitting, a human
can defensibly declare GA (bucket C is post-GA by design).

### A. Agent-executable (finish order — no one to wait for)

| Card | Closing action | Size |
|---|---|---|
| CLWX-10 GA packet | ✅ assembled this audit (`docs/GA_EVIDENCE_PACKET.md`) → Ready | done |
| CLWX-41 stakeholder report | ✅ scope delivered (report + matrices + cards) → Ready | done |
| CLWX-23 timeline | ✅ 09-02 evidence-day appended → Ready | done |
| CLWX-45 closeout drafts | write the 7 draft-and-hold replies into outbound-drafts | 1 sitting |
| CLWX-44 missed-defect verify | run the 3 criteria (exec-noise transcript assertion; idle-timeout degrade check; Plaud repro) | 1–2 lanes |
| CLWX-42 NSCC pack | re-download NSCC-2026.pdf via the bridge → knowledge pack → run the free Q&A eval | 1 lane |
| CLWX-34 RAJ-2 | seeded structured email → LLM reply → fidelity assertion (Mac Outlook lane) | 1 lane |
| CLWX-43 latency | laptop-lane 3-prompt repeat (budget sign-off is bucket B) | 1 lane |
| CLWX-39 Graph dev twin | BFF-model flag-gated sign-in on a dev tenant | 1–2 sittings |
| moe.15 cut | build + hash + VM install/smoke (carries fee7294d, 97004aa6, a8322ad9) — the GA-tag candidate | 1 sitting |

### B. Owner sitting (~one hour, unblocks GA declaration)

| Item | Action |
|---|---|
| CLWX-18 | make repo private / split releases; scrub history (destructive — owner hands) |
| CLWX-19 | rotate `sk-clawx` (same sitting as 18) |
| Trim unhold | decide on `7add864b` — now tied to the quantified 103s latency miss |
| Latency budget | sign off p50/p90 (proposal: 15s/30s) or set another number |
| KR2 acceptance | accept silent+timed evidence OR schedule the assisted-GUI recording (human-at-screen) |
| External tester | hand the moe.15 installer + quick-start to one unaided tester |
| CLWX-45 GO | review the drafts, say GO per item (sends are gated on you) |
| Human closes | move the 14+ Ready cards to Done as you verify each |

### C. Ministry-gated (post-GA by design — late September earliest)

| Card | Waits on |
|---|---|
| CLWX-31 KR8 | the 45-min session (agenda v4 ready; opener = the 07-20 owed deliverable) |
| CLWX-30 KR7 | asks 1–2 (hostname + redirect) |
| CLWX-29 KR6 fleet-verify | KR7 + trim/caching answers |
| CLWX-7 / CLWX-8 | flow URLs / production accounts |
| CLWX-40 Graph eval | CLWX-39 + ask 1 |

**GA definition per this vector:** bucket A finished + bucket B sitting done
⇒ all 13 scorecard boxes either checked or explicitly owner-accepted with the
known-limitations sheet (`GA_EVIDENCE_PACKET.md` §5). Bucket C then becomes
the production-integration milestone, not a GA blocker.

---

## 0. Delta since first authoring (2026-09-02 second pass)

- **KR1 / CLWX-24 → Ready.** Full in-app PASS on shipped moe.12: tool-select +
  KFM resolve + parse + faithful summary. Root cause of the earlier fail was a
  malformed fixture (PS 5.1 backslash ZIP entries), not the product.
- **KR5 / CLWX-28 → Ready.** Outbox wired to real actions (Outlook send, both
  form submits), boot drain, restart test. Commit `ebc4be75`.
- **KR2 / CLWX-25:** slow-ready root cause found + fixed in code
  (`61be816e`); the fresh-install RECORDING is the remaining acceptance item
  and is VM-gated.
- **moe.13 built + signed** (sha256 `a8494ec0…deb3ecf`) carrying all fixes;
  1230/1230 unit tests, typecheck clean.
- **VM lane DOWN: `gcloud auth login` expired** (verified: token refresh
  fails, tunnel resets, no alternate creds). Owner action, ~2 min. Everything
  VM-dependent is pre-staged and documented on the cards.
- **Persona test-base designed** (`docs/VM_TEST_BASE.md`): L0/L1/L2 snapshot
  layers so tests stop running on a hand-tended mutable VM.
- **Full backlog triaged AND cleared (owner-authorized 2026-09-02).** Board:
  **11 Ready** (CLWX-3, 6, 12, 20, 24, 26, 27, 28, 32, 33, 35), 6 In Progress
  (22 anchor, 23 timeline, 25 KR2-recording, 29 KR6, 31 KR8, 10 GA-packet),
  **6 Todo** — every one dependency-tagged (7/8/30 Ministry-KR8/KR7 chain,
  34 VM+Outlook lane, 18/19 owner security sitting), **12 Cancelled**
  (superseded/obsolete per triage: 1, 2, 4, 5, 9, 11, 13–17, 21).
  **Backlog: zero.**
- **KR2 fresh-state run executed on moe.13 (VM lane restored).** Gateway
  ready in **51 s** on fresh state (vs ~285 s+ on moe.11/12) — `61be816e`
  proven live. Green first turn captured under the fixed driver. TWO new
  boot defects found live and fixed same-day (`38085ba3`): channel-choice
  clobber + EPERM rename race. moe.14 built as the re-verify RC. Evidence:
  `docs/evidence/KR2_FRESH_INSTALL_RUN_2026-09-02.md`. L2 snapshot
  `clawx-l2-moe12-kr1pass-20260902` READY.
- **moe.14 re-verify DONE (same day):** both boot fixes proven live (EPERM
  sync + channel persistence); fresh-install default channel is now
  on-device as designed (owner note: demo-default decision now explicit).
  On-device TURNS don't complete on the e2 VM (CPU starvation) — laptop
  lane remains the on-device turn anchor; new OPEN defect
  ONDEVICE-RETRY-LOOP (no cap on identical failing tool calls).
- **Sprint-driver tick (cron, 09-02): latency baseline landed (CLWX-43).**
  15 driver JSONs mined: median successful cloud turn ≈103s on the VM lane —
  ~7× the proposed p50 ≤15s budget. Raj's twice-volunteered complaint is now
  quantified (`docs/evidence/LATENCY_BASELINE_2026-09-02.md`); movers =
  prompt-caching ask #7, trim unhold (owner), routing. CLWX-38 (retry-loop
  breaker) moved to Ready — fix `fee7294d` had landed with 12/12 tests but
  the card was never moved.
- **Outlook lane: gate false-negative CLOSED + migration survived +
  3/4 Raj defects dispositioned (owner-directed stress session).** The
  outlook.cloud.microsoft tenant redirect hit us mid-session and exposed:
  a subject-gate FALSE NEGATIVE (a drifted draft went out — self-addressed
  sandbox; fixed `a8322ad9`, contract tests inverted), the RAJ-4 verifier
  false positive (list rows classified as recipient wells), and hardcoded
  navigation dying on the new domain. RAJ-1 root-caused (accidental-refusal
  error text), RAJ-3 REFUTED by targeted scenario, RAJ-2 remaining
  (model-layer fidelity scenario designed). Live proof: 4-step gate PASS,
  15/15 eval, 73/73 units on the new domain. New skill:
  `.claude/skills/outlook-lane-debug`. Graph plan:
  `docs/MINISTRY_GRAPH_ACCESS_PLAN.md` + cards CLWX-39/40.
- **Self-driving loop live:** `.claude/skills/ga-sprint-driver/SKILL.md`
  (universal tick: sense→analyze→act→sync→report) + durable cron `977942a5`
  every 6 h (7-day auto-expiry; renew or re-arm via /ga-sprint-driver).
- **Branding sweep done** (CLWX-3, commit `dc30f9db`): last user-visible
  ClawX/OpenClaw strings removed.

---

## 1. How we drive this: OMC teams + sub-agents in parallel

We already have a fleet of purpose-built sub-agents in `.claude/agents/`. The
sprint is organized so **independent lanes run as concurrent `Agent` calls in a
single message**, each with an explicit context packet (sub-agents start empty —
never ask one to "search the conversation"). The main loop stays the conductor:
it decomposes, dispatches, collects evidence, and moves cards.

**Rule of thumb:** if two cards touch different files/subsystems and neither
consumes the other's output, they run in the same batch. If B needs A's artifact
(a value, a build, a sent message), B waits.

### Sub-agent → work mapping (who runs what)

| Lane | Work | Sub-agent(s) | R/W |
|---|---|---|---|
| Build/verify | typecheck, unit, eval:ci, harness at HEAD | `production-readiness`, `ga-e2e-regression-verifier` | RO |
| Config safety | 4-store coherence, boot-agents seed | `config-coherence-auditor` → `clawx-config-doctor` | RO→RW |
| Dep safety | devDep-in-asar class | `dependency-class-auditor` | RO |
| Selector safety | MS/Google/Apple rotated selectors | `dom-selector-regression-tester` | RO |
| State safety | atomic+idempotent writers | `state-idempotency-auditor` | RO |
| Windows lane | install, smoke, in-app turn | `windows-smoke`, `test-lane-prober` | RO/Bash |
| Gateway | boot crash-loop repair | `gateway-recovery` | RW |
| Skills | bundle drift | `skill-audit` | RW |
| Liaison | Raj/Karunesh asks (read-only) | `ministry-liaison-monitor` | RO |
| Release | GA readiness pass | `ga-release-conductor` | RO+delegate |

---

## 2. State vector — every card, its KR, and its dependency class

Legend: **P** = parallel-now (no unmet dependency), **S** = serial (blocked by a
named predecessor), **O** = owner-gated (needs a human decision/action).

| Card | KR | What "done→Ready" needs | Class | Blocked by |
|---|---|---|---|---|
| ~~CLWX-1/24 doc-tooling~~ | KR1 | ✅ **READY 2026-09-02** — full in-app PASS on moe.12: tool-select + KFM resolve + valid-docx parse + faithful summary. Evidence `docs/evidence/KR1_INAPP_RUN_2026-09-02.md`; card in Ready | — | done (human closes) |
| ~~CLWX-KFM~~ (MOOT) | KR1 | ~~resolver handles OneDrive KFM~~ — already works; parse error proved the file was found+opened | — | closed by evidence, not code |
| CLWX-2 clean-VM | KR2 | code fix ✅ (61be816e, ships in moe.13); fresh-install RECORDING on persona base | **S** | `gcloud auth login` (owner) |
| CLWX-4 degrade | KR4 | ✅ landed (bde78d94); optional kill-egress e2e | **P** | none |
| ~~CLWX-5 outbox~~ | KR5 | ✅ **READY 2026-09-02** — real actions wired (send + both form submits), boot drain, restart test (`ebc4be75`) | — | done (human closes); drain URL waits on KR8 |
| CLWX-6 economics | KR6 | trim floor ≤2,500 + per-user caps behind flag | **S/O** | trim unhold (owner) + KR7 for fleet |
| CLWX-8 ministry | KR8 | ✅ reply sent; working session + real values | **O/S** | Raj (B4) |
| CLWX-7 identity | KR7 | Entra sign-in → stable UserId in APIM header | **S** | KR8 real values |
| CLWX-bug | ext-val | Raj's 4 June-21 defects reproduced-or-refuted | **S** | VM lane (gcloud auth) + Outlook session (PILOT_TEST_PASSWORD local) |
| CLWX-18 | security | public-branch scrub + source/releases split | **O** | owner (destructive) |
| CLWX-19 | security | rotate `sk-clawx` | **O** | owner |

### The three lanes

- **Parallel-now (fan out today):** CLWX-2 (clean VM), CLWX-5 (outbox
  app-wiring), CLWX-bug (defect triage), CLWX-4 optional hardening.
  These share no artifacts and can each be a concurrent agent.
  (KR1 / CLWX-24 landed in Ready 2026-09-02 — full in-app PASS.)
- **Serial chain (irreducible):** `CLWX-8 (real values) → CLWX-7 (UserId) →
  CLWX-6 fleet-verify`. Nothing collapses this — it waits on Raj, then on a real
  Entra token, then on fleet attribution. Build KR6/KR7 **behind a flag now** so
  the day values arrive is a verification, not a build.
- **Owner-gated (park + note, don't self-execute):** CLWX-18, CLWX-19, trim
  unhold, outbound sends. Agents prepare; a human pulls the trigger.

---

## 3. Pre-flight / in-flight / post-flight checks (grounded in real incidents)

Every check below has a scar behind it. Run pre-flight before a lane starts,
in-flight while it runs, post-flight before reporting a card to Ready.

### PRE-FLIGHT (before a lane starts)

| # | Check | Why (incident) |
|---|---|---|
| PF-1 | `git status --short --branch` + confirm cwd + branch after any resume/compaction | wrong-branch work after compaction |
| PF-2 | VM lane: `gcloud compute instances describe … --format='value(status)'` — expect RUNNING, not TERMINATED | 8h auto-shutdown (`shutdown /s /t 28800`) silently kills the VM |
| PF-3 | Tunnel: launch `nohup … start-iap-tunnel … & disown`, wait for "Listening", then a **control-leg** probe (a port that must FAIL) | tunnel wrapper exit killed children; stale child held :12222 |
| PF-4 | 4-store config coherence (`config-coherence-auditor`) before any channel work | silent-on-send hit 3+ times |
| PF-5 | Dependency-class audit before a build/tag | moe.9 shipped broken (playwright-core in devDeps) |
| PF-6 | Ollama up + model present (`/api/tags` shows qwen2.5:3b-instruct) | on-device turns silently fail if ollama is down |
| PF-7 | Artifacts-on-disk / IAM dry-run before declaring a lane "waiting on a human" | two multi-week stalls were self-inflicted |
| PF-8 | Build chain deps present (dotnet on PATH for win-asr): `PATH=$HOME/.dotnet:$PATH DOTNET_ROOT=$HOME/.dotnet` | `pnpm build:win` fails on WinSpeechRecognize.csproj without dotnet |

### IN-FLIGHT (while a lane runs)

| # | Check | Why (incident) |
|---|---|---|
| IF-1 | Never `cmd \| tail -N` to judge success — use `cmd > log 2>&1; echo "EXIT=$?"` then read the log | pipe-exit trap reported tail's exit 0 over a failed build (burned 2×, again this session) |
| IF-2 | Never inline `powershell -c` with paths containing **spaces** or loop vars / `$(...)` — scp a `.ps1`, run `-ExecutionPolicy Bypass -File` | quoting through ssh→bash→powershell broke ~5× this session |
| IF-3 | Single-quote the whole `ssh pilot 'powershell -c "…"'` arg | bash+zsh expand `$env:`/`$_.` differently |
| IF-4 | Windows app launch: `Invoke-CimMethod Win32_Process Create`, **visible** (never `-WindowStyle Hidden`) | hidden launch kills Gateway via deferred-start restart |
| IF-5 | Wait for the **composer enabled** (`isDisabled()==false`), not just port :18789 bound | gateway ready-fallback loop takes ~4–5 min (`retryAfterMs≈285000`) on cold/empty config; the composer is disabled that whole window (confirmed 2026-09-02) |
| IF-6 | SHA256 verify at **every** transfer hop (build→GCS→guest) | integrity; caught nothing bad yet because we check |
| IF-7 | PowerShell file writes for `*.json` config: `[System.IO.File]::WriteAllText` + `UTF8Encoding($false)`, never `Set-Content -Encoding UTF8` | PS5.1 BOM crashes electron-store JSON.parse |
| IF-8 | Turn-settle detection must handle threaded "N tool calls" answer blocks | driver reported TIMED_OUT_MID_TURN on a turn that actually settled (2026-09-02) |

### POST-FLIGHT (before reporting a card → Ready)

| # | Check | Why |
|---|---|---|
| PT-1 | Read the actual evidence (log/JSON), not the command's tail | see IF-1 |
| PT-2 | No fake completion: grep changed files for `test.skip`/`.only`/TODO/stub before claiming done | placeholder ≠ evidence |
| PT-3 | Every Ready transition carries an **evidence comment** (file paths, pass counts, trace lines) | board protocol |
| PT-4 | No secrets/bodies/recipients/passwords in any log, comment, or committed file | hard rule; whatsapp-send-guard hook |
| PT-5 | Outbound sends recorded in `~/openclaw-agent/outbound-sent/` ledger | we couldn't always prove what we told Raj (G15) |
| PT-6 | **Never** move a card to Done — ceiling is Ready; a human closes it | standing authority |
| PT-7 | State writers verified atomic+idempotent (call twice → identical state) | gateway re-seed loop / chflags band-aid |

---

## 4. Autonomous drive protocol

1. **Batch the parallel lane** (§2) as concurrent `Agent` calls, each with a
   context packet + the relevant pre-flight checks inline.
2. **Collect evidence**, run post-flight, move each card to Ready with an
   evidence comment. Park owner-gated items with a note; don't self-execute.
3. **Advance the serial chain** only as predecessors land real artifacts.
4. **Re-export the board backup** (`node scripts/plane-board-export.mjs`) and
   commit after each batch so the board and repo never drift.
5. **Stop conditions (the only three):** don't loosen a quality gate to pass;
   outbound stakeholder comms stay draft-and-hold unless the owner opens the
   gate; destructive/irreversible actions park for a human.
6. GA is declared by a human when every box in `docs/wiki/GA_READINESS.md` §4 is checked.

---

## 5. This session's concrete next actions

- **CLWX-24 KR1 (P):** the resolver already resolves OneDrive KFM Desktop (proven
  live 2026-09-02 — the "Could not find main document part" was a docx PARSE
  error, so the file WAS found+opened). The real blocker was a **malformed seed
  fixture**: `pilot-seed-demo-documents.ps1` emitted ZIP entries with backslash
  names (`word\document.xml`) because `[ZipFile]::CreateFromDirectory` on PS 5.1
  uses the OS separator, violating OPC/ZIP APPNOTE 4.4.17. **Fixed this session**
  (hand-built `New-ZipFromDirectory` + strict backslash-reject in the validator).
  Next: re-seed on the guest, re-run the moe.12 turn → expect a real summary =
  full KR1 in-app PASS (`docs/evidence/KR1_INAPP_RUN_2026-09-02.md`).
- **CLWX-2 (P):** the clean-VM install + recorded green on-device turn — same VM,
  but seed a coherent on-device channel first (the empty-config slow-boot is a
  KR2 finding in its own right).
- **CLWX-5 (P):** wire one real app action through the outbox + app-restart test.
- **Serial chain** stays parked on Raj (KR8) — build KR6/KR7 behind flags (done
  for KR6; KR7 pending real values).
