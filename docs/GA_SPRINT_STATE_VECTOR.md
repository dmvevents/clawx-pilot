# GA sprint — state vector, parallelization, and flight checks

_Authored 2026-09-02; **updated 2026-09-02 (second pass)** after KR1 full PASS,
KR5 wiring, moe.13 build, and the VM-lane auth outage. The operating plan for
driving the 8 KRs to GA with maximum parallelism and minimum re-debugging.
Pairs with `GA_SPRINT_PLAN_2026-09-02.md` (sequencing), `docs/wiki/GA_READINESS.md`
(GO/NO-GO scorecard), `docs/VM_TEST_BASE.md` (persona test base) and the Plane
board (live state). Ceiling for agents is **Ready**; a human declares GA._

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
- **Full backlog triaged (all 34 cards).** Board now: **10 Ready** (CLWX-3, 6,
  12, 20, 24, 26, 27, 28, 32, 33), 6 In Progress (22 anchor, 23 timeline,
  25 KR2-recording, 29 KR6, 31 KR8, 10 GA-packet), 17 Backlog each carrying a
  triage disposition (superseded-by / Ministry-gated / non-blocking), 1
  Cancelled. Duplicate-close recommendations (human decision): CLWX-2→25,
  CLWX-4→25, CLWX-5→34, CLWX-17→25/10.
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
