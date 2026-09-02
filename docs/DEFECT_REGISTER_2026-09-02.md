# Defect & feedback register — compiled 2026-09-02

*Compiled by the defect-registrar sweep (sources: WINDOWS_PROBLEMS_ATLAS §1–§15,
board mirror, docs/wiki/GA_READINESS.md gap ledger G1–G15, docs/wiki/LIAISON_LOG.md §C,
GA_SPRINT_STATE_VECTOR flight checks, evidence docs, repo-wide BUG- grep).
48 entries. **Read the "Register deltas" section first** — several group-A rows
were closed by work that landed the same day, after the sweep's read of the tree.*

## Register deltas (same-day, post-sweep — authoritative over the rows below)

| Register row | Delta |
|---|---|
| KR5 (CLWX-28) "no real action wired" | **CLOSED @ `ebc4be75`**: Outlook send + both form submits enqueue audit records; boot drain; restart + mid-send-crash + idempotent-replay tests. Card at Ready. |
| KR2 / BOOT-EMPTY "fix in tree only" | **moe.13 built + signed same day** (sha256 `a8494ec0…deb3ecf`) carrying `61be816e`. Remaining: recorded assisted fresh-VM install (gated on `gcloud auth login`, owner). |
| DRIVER-SETTLE "needs one green run under fixed driver" | Still owed — first Lane-2 run under moe.13 doubles as this regression proof. |
| CLWX-3 branding "final sweep unrecorded" | **CLOSED @ `dc30f9db`** — sweep run, 3 strings fixed, card at Ready. |
| CLWX-20 ffmpeg | Verified: packaged path maps exactly to the resolver's first candidate; card at Ready pending one voice-note smoke on the persona VM. |
| NEW: CH-CLOBBER (boot) | preferredChannel silently reverted to 'online' every boot — a principal's "On this device" choice never survived relaunch (cloud-gateway seed forced online whenever the setting differed). **FIXED@38085ba3** (default only when unset; ships moe.14). Found live on the KR2 moe.13 run; was blocking the KR2 on-device leg. |
| NEW: EPERM-RENAME (boot) | on-device provider missing from runtime config after first boot: Windows EPERM on the atomic rename while another process held openclaw.json open — the local-provider sync lost the race. **FIXED@38085ba3** (bounded retry on EPERM/EBUSY/EACCES; ships moe.14). Found live in the moe.13 first-boot log. |
| NEW: BOARD-EXPORT-STRIP | Exporter wrote empty description/comment bodies (titles-only mirror); both analyst agents hit it independently. **FIXED@414bd1d1 + e7ebe8a6** (HTML→text fallback, mandatory secret redaction, 429 backoff); re-export verified 35/35 descriptions + 0 secret hits. Card CLWX-35 at Ready. |
| GRAPH-GATE (G4/CLWX-39/CLWX-30) "blocked on Ministry client-id + dev URI since July" | **CLEARED 2026-09-02**: Ministry delivered real client-id + registered `http://localhost:53682/callback` with read-only consent. `scripts/graph-signin-smoke.ts` (PKCE loopback) ran L1–L3 PASS live on the real tenant with sandbox `test.fac` — token via pure PKCE (no secret), stable `oid` (KR7 key), `/me` + inbox read. CLWX-39 + CLWX-30 → In Progress. Remaining: in-app flag + host `getAccessToken` wiring (keeps `microsoft-graph.enabled=false`). Evidence: `skills/laptop/evidence/2026-09-02-graph-signin-L1-L3/`. |
| GRAPH-WIRING (CLWX-39) "in-app wiring pending" | **LANDED 2026-09-03**: read-only scope baseline, persisted transport toggles + Settings switches, scope-aware compose refusal (URL-form grants recognised), Graph-403→structured refusal, `graph:` id refusal on the 5 browser-only actions, attachment fidelity, stub force-parked. Adversarially reviewed (3 medium findings found AND fixed same tick); full suite 161 files green. L4 staged in `scripts/v2-eval-graph.ts`; one ~2-min operator sign-in remains before the L4 run. See APP_WORKFLOWS_TEST_MATRIX §5. |
| KR7 (CLWX-30) "no stable per-principal UserId" | **Agent-buildable half DONE 2026-09-03**: `UserId=<oid>` stamped on the moe-cloud-gateway provider at seed + re-stamped live on Graph sign-in/out (gateway reload threaded); broker forwards sanitized `UserId` upstream for APIM/App-Insights attribution; seam unit-tested end-to-end (headers → openclaw.json → outbound). Client-stamped header is trust-limited (pilot-acceptable); Ministry-side verification stays KR8-gated. |
| IDLE-TIMEOUT-RAW | **FIXED-in-tree 2026-09-03** (found CONFIRMED-STILL-OPEN by the CLWX-44 verify: the gateway's "LLM idle timeout (Ns): no response from model" matched no degrade pattern, so the raw string rendered). Degrade classifier now treats the idle-timeout class as unreachable → cloud turn degrades to on-device instead of surfacing the raw error; mutation rows added to channel-degrade tests. Live regression proof rides the next shipped RC. |
| EXEC-NOISE-LEAK | **CLOSED 2026-09-03 by verification** (CLWX-44): renderer structurally cannot leak tool frames into assistant bubbles since `c29ff4dd` (+ `fcba8b86`/`816a0e24`/`ef3cf644`/`ceb537f7` layers); unit-tested (chat-internal-message-filter 22/22). The 2026-05-08 sighting predated those filters. Evidence: `skills/laptop/evidence/2026-09-03-clwx44-verifies/`. |
| PLAUD-ZERO-MIN | **DISPOSITIONED 2026-09-03** (CLWX-44): CANNOT-REPRO in this tree — no plaud code exists in-repo (rode an external MCP server whose source we do not hold); the in-app ASR path computes durations correctly (whisper smoke reports 2.28 s non-zero). Honest-close matches the staged CLWX-45 draft 04. Needs the external server source or the 05-19 artifact to fully refute. |

## A. OPEN and blocking GA (unchecked boxes on the docs/wiki/GA_READINESS.md §4 gate / security floor)

| ID | Surface | Symptom | Root cause | Status | Blocking GA? | Evidence/source |
|---|---|---|---|---|---|---|
| RAJ-1 (G4, CLWX-34) | outlook | Send fails: "draft subject has been changed before it can be sent" (HIGH) | TWO-SIDED root cause found live 09-02: subject-gate FALSE NEGATIVE masked by post-dispatch verification failing (that refusal produced Raj's error text) | **FIXED-verified @ a8322ad9** — live 4-step gate proof PASS on outlook.cloud.microsoft; 73/73 contract units | was Yes — now evidence on file | STAKEHOLDER_REPORT matrix row 10a |
| RAJ-2 (G4, CLWX-34) | outlook | Reply misinterprets email content (meal preferences read as shirt sizes) (MED) | UNKNOWN — extraction/classification, untriaged | OPEN | Yes — same checkbox | docs/wiki/LIAISON_LOG.md §C |
| RAJ-3 (G4, CLWX-34) | outlook | Reply action archives the original email (MED) | — | **REFUTED 09-02**: scripts/raj3-reply-archive-check.ts — original remains in Inbox after the reply flow (exit 0) | closed by evidence | STAKEHOLDER_REPORT row 10c |
| RAJ-4 (G4, CLWX-34) | outlook | Draft response landed in the "To:" field (one-off) (LOW) | Verifier classified inbox LIST ROWS as recipient wells (loose aria-label substring selectors) — reproduced live 09-02 on the new domain | **FIXED-verified @ a8322ad9** — recipient wells require editable fields; 15/15 live eval | was Yes — evidence on file | STAKEHOLDER_REPORT row 10d |
| CLWX-18 (G12) | security | Public repo dmvevents/clawx-pilot hosts full source; plaintext test password was in 3 files | Fork pushed public with source instead of releases-only | OPEN (partial: working tree scrubbed at f99f2c1f, 0 literals; public-branch HISTORY scrub + source/releases split still owner-gated) | Yes — security-floor checkbox | Board CLWX-18; G12 |
| CLWX-19 (G13) | security | sk-clawx API key shared over WhatsApp (2026-06-05), never rotated | Key shared over insecure channel; rotation = owner action | OPEN | Yes — security-floor checkbox | Board CLWX-19; G13 |
| G9 / KR6 (CLWX-29) | infra | ~7,550-token fixed floor = ~71% of every turn; fleet-wide 429 at ~20 schools on shared 100M/mo | Oversized per-turn tool catalog/system floor; shared APIM key | OPEN — trim branch `7add864b` (~2,000 floor) ON HOLD (owner); per-user caps landed behind `CLAWX_PER_USER_CAPS` (`deff5c7d`); fleet-verify needs KR7 | Yes — KR6 checkbox | docs/SCALE_ANALYSIS_2026-08-20.md; G9 |
| KR7 (CLWX-30) | infra/security | No real Entra sign-in → no stable per-principal UserId in the APIM header | Ministry identity conflicts (secret vs PKCE, redirect URI unregistered); real values owed | OPEN — externally gated on KR8. Pull-forward available: build sign-in behind a flag on the dev-loopback redirect (G7) so real values = config swap | Yes — KR7 checkbox | docs/MINISTRY_INFRA_HANDOFF_2026-08-18.md |
| KR8 (CLWX-31, G8) | infra | All 20 Ministry handoff values are placeholders; credential link expired unopened | Ministry has not returned real values | OPEN — condensed reply SENT via WhatsApp 2026-09-01 (ledgered, `~/openclaw-agent/outbound-sent/`); awaiting Raj: session + values | Yes — KR8 checkbox; gates KR7→KR6 | GA_READINESS G7/G8; LIAISON_LOG §B |
| KR2 (CLWX-25) | boot/packaging | Fresh/empty-config install: composer disabled ~4–5 min (retryAfterMs≈285000) on moe.11 AND moe.12 | `ensureBootableAgentsConfig` skipped upgrading a model-less `agents.defaults` block | Fix `61be816e` **shipped in moe.13 artifact** (see deltas); recorded assisted clean-VM install still owed | Yes — KR2 checkbox | KR1_INAPP_RUN secondary #1–2 |
| ~~KR5 (CLWX-28, G10)~~ | offline | ~~no real action wired through outbox~~ | — | **CLOSED @ `ebc4be75`** (see deltas) | was Yes | OFFLINE_ARCHITECTURE §5; G10 |
| EXT-TESTER | packaging | No independent tester has completed download→install→first-turn from the public Release | Never run (original feedback card CLWX-11 Cancelled) | OPEN | Yes — external-validation checkbox | GA_READINESS §4 |

## B. OPEN, not blocking

| ID | Surface | Symptom | Root cause | Status | Source |
|---|---|---|---|---|---|
| CLWX-20 | asr | voice-note ffmpeg-not-found on user machines | ffmpeg historically not bundled | Bundled in moe.12+ (packaged-path verified 2026-09-02); one persona-VM voice smoke closes it | Board CLWX-20; Atlas §14 |
| BOARD-EXPORT-STRIP | tooling | Board mirror carried empty bodies | *_stripped fields empty on this Plane build | **FIXED@414bd1d1+e7ebe8a6** (fallback + redaction + backoff); CLWX-35 Ready | Both analyst sweeps, 2026-09-02 |
| EXEC-NOISE-LEAK | chat/trust | Raw Exec:/run-python internals rendered in stakeholder chat (Raj, 2026-05-08) | Tool frames leaked into assistant bubbles | OPEN — never registered, never confirmed fixed; MISSED-BY-REGISTER (stakeholder sweep 09-02) | STAKEHOLDER_REPORT §missed |
| IDLE-TIMEOUT-RAW | chat | Raw "model idle timeout" error surfaced to user (2026-05-08) | No user-facing degrade at the time; bde78d94 adjacent, unverified for this path | OPEN-unverified | STAKEHOLDER_REPORT §missed |
| PLAUD-ZERO-MIN | asr/notes | Recordings indexed at 0.0 minutes; fix promised in-thread, never confirmed (2026-05-19, reported 3x) | UNKNOWN — ingestion path | OPEN | STAKEHOLDER_REPORT §missed |
| LATENCY-UX | perf | "Taking real long to respond… thinking" — Raj's only twice-volunteered complaint; cost a Minister demo slot (05-27, 06-27) | Cause-side = KR6 token floor; no user-facing budget ever set | OPEN — **MEASURED 09-02**: median successful cloud turn ≈103s on the VM lane (evidence/LATENCY_BASELINE_2026-09-02.md); ~7× over the proposed p50 ≤15s budget; laptop measurement + owner budget sign-off remain | STAKEHOLDER_REPORT §missed |
| ONDEVICE-RETRY-LOOP | docs/agent | 3B on-device model retries an IDENTICAL failing tool call indefinitely (principal.summarise_circular with empty circular_text, 13+ min) — no per-turn cap | Agent loop has no identical-failure breaker; small model ignores the validation error text | OPEN — found live on moe.14 KR2 re-verify; needs plugin- or agent-side breaker | KR2_FRESH_INSTALL_RUN §moe.14 |
| VM-CPU-STARVE | infra/test | On-device qwen2.5:3b turns do not complete on the e2-standard-4 VM (incomplete-turn, 51-msg threads) | 4 vCPU, no GPU — CPU inference exceeds practical windows | OPEN (test-infra note, not product) — anchor on-device turn evidence to the laptop lane or a GPU VM | KR2_FRESH_INSTALL_RUN §moe.14 |
| ATLAS-15 | forms | forms.preview_* times out; redirect to login.microsoftonline.com | Chrome automation profile not signed in to tenant — auth state, not selectors | OPEN (partial: sign-in interstitial detection shipped; GA path gated on KR7/KR8) | Atlas §15 |
| KAR-PDF (G6a) | docs | PDF read inconsistencies (Karunesh via Raj, 2026-06-30) — no repro detail | UNKNOWN; mitigations shipped (steering c1b18125, KR1 PASS) | UNVERIFIED vs original report | LIAISON_LOG §C; G6 |
| DOCSEARCH (G6b) | docs | Document-search inconsistency (2026-07-17) — no repro detail | UNKNOWN | UNVERIFIED | LIAISON_LOG §C |
| ACPX-NOISE | boot | acpx runtime backend probe fails every boot; adds handshake latency | Codex ACP backend can't spawn on guest; non-fatal | OPEN | KR1_INAPP_RUN secondary #3 |
| STEER-READ | docs | On read_docx parse failure, agent falls back to generic workspace-rooted `read` instead of surfacing the parse error | Persona covers "no Python fallback" but not "no generic-read fallback" | OPEN (low) | KR1_INAPP_RUN follow-ups |
| FIXTURE-HYG | docs | Stale malformed fixture copies in Downloads/Documents shadow the valid Desktop copy (resolver prefers Downloads) | Multiple seeded copies across profile | OPEN (process: purge + re-seed via fixed seeder before demos) | KR1_INAPP_RUN re-run |
| G5-VERDICT | feedback | No post-demo verdict captured for 2026-06-23 principals demo; circulating "0/5" score has NO source | Feedback-loop gap | OPEN — never cite "0/5" without a source | G5; LIAISON_LOG §C |
| COMPOSER-OVERRIDE | boot | Chat picked Flash though config said Pro (2026-05-25) | UNKNOWN; likely absorbed by the four-store channel-router work | UNVERIFIED — likely stale, never explicitly closed | CLAUDE.md |
| UPSTREAM-GAP | infra | Fork ~102 commits behind upstream | Deliberate audit-then-cherry-pick posture | OPEN (accepted risk) | UPSTREAM_MERGE_ASSESSMENT_2026-08-20 |
| ATLAS-DOCGAP | docs | Atlas §16–§18 known but unwritten (hidden-launch trap; extension path move; firewall silent-drop) | Documentation backlog; behaviors codified as flight checks | OPEN (doc-only) | state vector IF-4 |

## C. FIXED, needing regression coverage in a shipped installer

| ID | Surface | Fix | Coverage owed |
|---|---|---|---|
| BOOT-EMPTY | boot | `61be816e` — upgrade model-less agents.defaults when modelRef resolves | In moe.13 artifact; clean-VM recorded install (CLWX-25) verifies live |
| DRIVER-SETTLE | test tooling | `ecf31c4b` — placeholder rejection + 9s stable window in chat-turn driver | One green Lane-2 run under the fixed driver |
| SEED-OOXML | test fixture | `1804aaab` + `128fcab6` — forward-slash ZIP entries + strict validator | **Already re-verified** (KR1 re-run PASS 02:13 UTC); keep FIXTURE-HYG purge in demo prep |
| KR5-WIRING | offline | `ebc4be75` — real actions through outbox + restart tests | Unit-level restart proof done; optional live kill-9 smoke on persona VM |

## D. MOOT / closed (22 entries — summary)

Atlas §1–§14 all FIXED or MOOT-by-design with named commits and guard agents
(playwright-core devDep→`e26a702`+auditor; enum reseed→`21bce2b`/`ef9801c`;
Mac-binaries-in-Win→`7040b24`; auto-update→`b1d2b8a`; mklink→`8cf30ab`;
AV cold-start→`ffdd04e`; vcruntime→`6581a9a`; AADSTS53003→profile=user rule;
Forms editor rotation→response-page pivot; CI Session 0→build+static only;
chflags/EPERM→canonical atomic writer; four-store drift→`applyChannelChange`
transaction; Gemini thinking/400→preflight override removal; Win ASR
helper→prep:win-binaries + two-file transcode). Plus: BUG-012 (`fc435c6b`),
doc-tooling steering (`c1b18125`, verified in-app), CLWX-KFM (moot — parse
error proved resolution), G11 tool-cascade (trim verified live), KR4 degrade
(`bde78d94`), G15 outbound ledger, EGRESS-GUARD (falsifiable lane G), and the
operational flight-check rules (IF-1..8, PF-2/3/8) codified in the state vector.

## Count summary (post-delta)

- **A. OPEN blocking GA: 11** — 4 Raj email defects (one lane, one session),
  2 security-floor (owner), KR2 recording (owner unblocks lane), KR6 floor
  (owner unhold), KR7 identity + KR8 values (Ministry), external tester run.
- **B. OPEN not blocking: 12** (4 UNVERIFIED for lack of repro detail).
- **C. FIXED needing shipped regression coverage: 4** (all covered by the
  first Lane-2 run under moe.13).
- **D. MOOT/closed: 22.**

**Highest-leverage next cycle:** one Lane-2 session under moe.13 retires the
KR2 recording, the DRIVER-SETTLE proof, the CLWX-20 voice smoke, and stages the
Raj-defect triage — four register rows for one VM window.
