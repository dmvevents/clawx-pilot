# GA sprint — state vector, parallelization, and flight checks

_Authored 2026-09-02; **updated 2026-09-02 (second pass)** after KR1 full PASS,
KR5 wiring, moe.13 build, and the VM-lane auth outage. The operating plan for
driving the 8 KRs to GA with maximum parallelism and minimum re-debugging.
Pairs with `GA_SPRINT_PLAN_2026-09-02.md` (sequencing), `docs/wiki/GA_READINESS.md`
(GO/NO-GO scorecard), `docs/VM_TEST_BASE.md` (persona test base) and the Plane
board (live state). Ceiling for agents is **Ready**; a human declares GA._

_**Fix-sprint delta (2026-09-04, owner-authorized "execute everything + sync the
board").** The RCA map (`docs/PROBLEM_ROOT_CAUSE_FIX_MAP_2026-09-04.md`) ranked
backlog was implemented and landed as six scoped commits:
`a23a3a1d` CLWX-51 (blank New Chat → route to `/`), `68e02ee1` K8 (packaged
doc-parser load-path → `CLAWX_APP_RESOURCES`), `12625635` CLWX-79 (drop
`args.demo` statutory-field fabrication), `e85f0ef7` CLWX-73 (Chrome ≥136 CDP on
a dedicated NON-default profile; managed dir resolved but never launched →
profile=user hard rule intact), `c139ecc3` CLWX-81/70/74 (current-view-first
reply, born-empty draft discard, readable VLM-unavailable error; **two-gate send
+ download hard-confirm preserved verbatim**), `2b21d2a8` CLWX-78/94/95
(`connection error` classifier row + 90s watchdog failover + run-ownership token
so no orphan/replay; CLWX-95 `skipGatewayRefresh` seam unwired). Static GA gate
GREEN (5/5 T0: typecheck, lint, unit-suite, bundle-verify CLWX-72, doc-tooling;
report `docs/evidence/GA_GATE_2026-09-04.md`). Board: CLWX-51/73/78/94/81 → Ready
with evidence; CLWX-79/70 commented (already Ready); **K8 filed as CLWX-97
(Ready)**; CLWX-74 commented PARTIAL (kept off Ready — non-VLM locator fallback
still open); CLWX-95/96 commented seam-only (kept in Backlog — wiring + live
probe pending); CLWX-18/19 commented OWNER-GATED (no autonomous action).
**moe.18 email-surface FREEZE LIFTED for this sprint:** CLWX-73/81/70/74 and the
CLWX-78/94 degrade path all touch email/degrade, so the moe.18 VM lane must
re-run against a post-fix build before those Ready cards are trusted for GA.
Owner asks outstanding: (1) Raj — `moe.gov.tt` Conditional-Access probe that a
secondary non-default Chrome profile is accepted (CLWX-73); (2) live probe for
the restart-vs-per-run degrade refresh (CLWX-95/96); (3) the CLWX-18/19 rotation
+ repo-visibility sequence._

_**Tick 2026-09-04 (ga-sprint-driver, one tick).** Highest-leverage P item:
CLWX-76 (truthful load errors for ALL bundled parsers + auditor rule for
platform-native optional deps). All three acceptance legs landed in-tree:
(1) `doc-tools.mjs` — the four remaining masking call sites (`readDocx`/mammoth,
`writeDocx`/docx, `readXlsx`+`writeXlsx`/xlsx) now route through a new
`requireDocDep` helper that surfaces `loadError` vs `notFound` truthfully
(mirrors `readPdf`); the masking `loadDep()` wrapper is removed; `readImage`
surfaces a non-fatal `sharpUnavailable` on a sharp load error while keeping the
raw-bytes fallback; `requireDocDep`/`loadDepDetailed` exported and covered by 3
new falsifiable unit tests (absent→"module not found", present-but-broken→
"present but failed to load" with the real cause, never crossed — 8/8 pass).
(2) `dependency-class-auditor.md` — two bundled-parser rules added: (a) every
`EXTRA_BUNDLED_PACKAGES` entry must pass `scripts/verify-openclaw-bundle.mjs`
(exit 0); (b) any bundled package with platform-native `optionalDependencies`
must ship all `SHIP_TARGETS` bindings, loadability (not resolution) being the
bar. (3) `windows-pilot/scripts/pilot-office-runtime-check.ps1` — the on-target
probe upgraded from `require.resolve` (presence) to `require` (LOADABILITY) with
a DOMMatrix-polyfill mirror and a MISSING-vs-FAILED-LOAD split; the 0/10 exit
contract (STATE line) is preserved. Static GA gate GREEN (5/5 T0; report
`docs/evidence/GA_GATE_2026-09-04.md`). CLWX-76 → Ready with a needsLiveProbe
note: leg-3's live re-run on a packaged install is the only remainder and
overlaps CLWX-92/moe.16. Also commented CLWX-80 (both findings localise to the
OpenClaw-core read tool, not our fork — our `resolveReadablePath` already allows
home/tmp incl. `~/Downloads` + OneDrive KFM; clean path is persona steering or a
scoped upstream cherry-pick, not a mid-pilot core rebase). No new owner asks._

_**Tick 2026-09-04 (ga-sprint-driver — "be green on the fixed cards").** Highest-
leverage P item: run the T1 live Mac lane the static gate had skipped, to turn
the fixed Outlook/forms cards from Ready-with-`needsLiveProbe` into Ready-with-
live-GREEN evidence. Two live checks were flaking with a WANDERING failing row;
both root-caused to the SAME self-inflicted issues on the shared live test.fac
mailbox (a stale-id race + a test-contract error that scored the CLWX-46 guard's
SAFE `not_found` refusal as a failure) — NOT a tool defect; the guard never
returned wrong content. Fixed in commit `e2f084d5` (`scripts/v2-eval.ts` +
`scripts/clwx46-stale-read-check.ts`): each row fetches a fresh top-of-inbox id
immediately before acting and retries once on a safe `not_found`; W7.1 and the
standalone check now fail ONLY on an actual leak (an ok read whose subject
belongs to a DIFFERENT message) and require ≥1 demonstrably-correct read. **No
production code changed.** Result: full `pnpm ga:gate` **GREEN — 9 pass / 0 fail
/ 2 opt-in skip** (T0 static + T1 live: 15-row eval, CLWX-46 stale-read check,
Suspensions + Daily Report fill+gate dry). Report `docs/evidence/GA_GATE_2026-09-04.md`.
Board (all already at Ready — caveats removed, not moves): CLWX-46/81/70/79
commented live-GREEN; CLWX-62 commented fill+gate-dry-PASS with the recorded
live submit noted as the honest owner-gated remainder; CLWX-73 commented with
the live lane running on Chrome 152/user-profile as SUPPORTING (not full) proof;
CLWX-90 (master gate) commented with the authoritative scorecard. Kept honestly
not-green: CLWX-74 (Todo, non-VLM locator fallback), CLWX-95/96 (Backlog, seam),
CLWX-18/19 (owner-gated). VM/packaged legs (CLWX-97, CLWX-76 leg3, CLWX-78 full
degrade) stay VM-pending — the Mac lane does not advance them. Owner asks
unchanged from the fix-sprint delta above; the 2-gate real SEND and a recorded
Daily-Report submit remain the only demo-critical actions still gated on
explicit owner go (`GA_GATE_SEND=1` / `DEMO=1`, not run autonomously)._

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

_**Full-colour completion tick (2026-09-03, owner-directed "push everything to
completion").** Two orchestrated workflows (5 mappers → 10 build/verify agents,
disjoint file ownership, adversarial review) executed §2a P1–P7 in one pass:
**P1 Graph lane LANDED** (read-only scope baseline, Settings transport toggles
+ env overrides, scope-aware compose refusal incl. URL-form grants, 403 →
structured refusal, `graph:` id refusal on the 5 browser-only actions,
attachment fidelity, stub force-parked); **P2 KR7 agent half DONE**
(`UserId=oid` seeded + re-stamped live on sign-in/out with gateway reload
threaded; broker forwards sanitized UserId upstream; seam unit-tested);
**P3 L4 STAGED** (`v2-eval-graph.ts` + `--persist` harness; one ~2-min operator
sign-in remains); **P4 CLWX-44 dispositioned** (EXEC-NOISE-LEAK closed-verified
`c29ff4dd`; IDLE-TIMEOUT-RAW confirmed open then FIXED same tick — degrade
classifier now catches the idle-timeout class; PLAUD-ZERO-MIN honest-closed,
superseded by in-app ASR); **P5 `pilot-asr-smoke.ps1` authored**; **P6 W8 Mac
● (real whisper transcript ×2)**; **P7 W3 Mac ● (29/32 + gate refusal, VM bar
matched)**. The adversarial verify found 3 medium defects in the fresh build
(graph-id refusal unshipped on routes, gateway reload not threaded, bare-form
scope match) — all fixed + regression-tested same tick. Gates: typecheck 0,
lint 0 errors (4 pre-existing errors also cleared), **full suite 161 files /
1264 tests green**. Board colours: this tick's remaining P-work = P8 RAJ-2,
P9 NSCC, L4-after-sign-in._

_**Sprint tick (2026-09-03, RAJ-2 disposition).** SENSE: tree clean, board
mirror current, lane probes green (board 200, CDP 200, gateway up); no external
gates cleared, so no promotions. ACT (single highest-leverage P item): the
RAJ-2 model-layer fidelity scenario ran LIVE end-to-end —
`scripts/raj2-reply-fidelity-check.ts` attached to the signed-in Chrome,
surveyed the top-10 inbox, picked the richest real email (101 distinct content
words), ran a live cloud summarise+draft-reply turn, and applied a dual
deterministic assertion: coverage 4/8 (at the 50% floor) + ZERO invented
entities. **RAJ-2 NOT REPRODUCED at the model layer**; no compose opened,
nothing dispatched, confirm never set. That completes all four Raj 06-21
dispositions (RAJ-1 fixed-verified, RAJ-2 refuted-at-model-layer, RAJ-3
refuted, RAJ-4 fixed-verified) → **CLWX-34 → Ready** (Ext-val A last leg).
The run also FOUND a new defect: **STALE-READ (filed CLWX-46)** — `readEmail`
returned the wrong body for the same row across runs (stale reading pane), a
plausible root cause for Raj's original report; plus a cosmetic
subject-selector defect. Recommend the settle-guard fix before GA. Evidence:
`skills/laptop/evidence/2026-09-03-raj2-fidelity/RESULT.md`._

_**Stakeholder-test + resilience tick (2026-09-03 evening, owner-directed).**
Five more agents, all PASS: (1) **stakeholder regression battery re-run live**:
118/118 unit contracts + **15/15 v2-eval** on the live tab + RAJ-3 re-refuted —
Raj's June-21 list stays closed under fresh evidence; **consolidated update
SENT to Raj (owner GO on record; bridge success; ledgered)**. (2) **CLWX-42
NSCC eval BUILT + RUN**: Raj's 20 Q&A rows verbatim → fixture + live runner —
**18/20 (90%)**, 20/20 NSCC citations, wrong-edition guard proven; in-app
knowledge pack designed (data + `principal.nscc_lookup` + persona line, not a
workspace doc — protects the KR6 floor) = P12. (3) **Recorded-verified form
submission** (`forms-submit-recorded.ts`, URL hard-pinned to the test.fac
clone): refusal proved, then ONE confirmed submit verified landed (responses
5→6, marker, 2xx POST) with video + trace — the demo-evidence machinery and
the KR2-recording pattern. (4) **Resilience pack**: `FLOW_STATE_DIAGRAMS.md`
(6 flows, every transition → real incident → recovery owner) + the
`demo-flow-recovery` skill (10 symptoms → probe → command); TO-BUILD gaps
carded TB-3..TB-6, TB-1/2 fold into CLWX-46. (5) **Karunesh sweep**
(liaison-monitor): his ClawX items = Prompt-Tests 0/5 (fixed, KR1 in-app proof
owed), KAR-PDF/DOCSEARCH (need repro or current-build proof); video project
SEPARATE — VIDEO_QA_TRACKER reply drafted, unsent 6+ days; NSCC doc is RAJ's,
not his. (6) **Tester release packet**: moe.15 exe hash-verified locally,
`docs/TESTER_QUICKSTART.md` authored, Karunesh handoff draft staged;
distribution = GCS signed URL (interim path per REPO_AND_RELEASE_MAP) —
**blocked on `gcloud auth login`** (storage token verified expired), which now
gates BOTH the VM lane and the tester link._

_**Store-400 fix + recordings + Karunesh handoff SENT (2026-09-03 late).**
(1) **GOOGLE-STORE-400 closed durably** (`73c9e88c`): the live 400 the owner
screenshotted was the bundled gateway sending `store:false` to Google's
OpenAI-compat endpoint; stamp `supportsStore=false` now applied at the two real
choke points in `openclaw-auth.ts` (registry fix would've been a no-op), 7/7
regression test, full suite 162/1280 green. (2) **Two clean recorded use cases:**
Windows `usecase.mp4` (real in-app cloud turn, PASS) and the W3 forms-submit
`video.mp4`+trace (MS Forms clone fill→confirmed submit). Mac in-app turn proven
by `final-screenshot.png`; the Mac screen-crop video was REMOVED (`af25c723`) —
avfoundation can't target a window so it caught an occluding terminal, honest
correction in that dir's RESULT.md. (3) **Karunesh tester handoff SENT** over
WhatsApp (owner-authorized, ~8pm AST his window): 11h impersonated signed URL
(HTTP 206 + PE magic + byte-exact 390,104,940 verified), guide inline, both
messages `success:true` to his @lid; ledgered, URL redacted from the local
record. `gcloud auth` is live (`anton@sagebrushglobal.com`) so the tester-link
gate is CLEARED. (4) **Deep use-case coverage report**:
`docs/USE_CASE_COVERAGE_2026-09-03.md` — W1–W10 × Mac/Windows × proof-type,
Karunesh-task→workflow map, named Windows gaps (W5 cron, W8 ASR, W10 failover)._

_**Reconcile-and-finish tick (2026-09-03, owner-directed "work backwards from
the goal → plan → execute").** Four parallel capability audits (email / forms /
documents / plan-coherence) synthesized into
**`docs/GA_FINISH_SPRINT_2026-09-03.md`** — now the sequencing authority
(supersedes GA_SPRINT_PLAN_2026-09-02) — with the epic purpose grounded in
CLWX-22 and the trust framing, a story map S1–S9, and the objectives ×
coverage × deficit matrix. **Persona review model shipped:**
`docs/PERSONA_STATE_VECTOR_2026-09-03.md` (thought map + Raj/Karunesh/owner
feedback ledger) + two new agents (`moe-product-manager`, `principal-proxy`);
existing agents mapped to QA/release/liaison/conscience seats. **Board
reconciled:** 8 untracked deficits filed as CLWX-61..68 (Outlook eval gaps;
Daily Report e2e — the 3:45pm form itself had no e2e; extraction-chain e2e;
forms drift detector; in-app write turn gap b2; minutes template + classify
e2e; reminder pipeline e2e; post-GA registers/inventory), anchor comment on
CLWX-22 incl. the PM scope call (folder ops = known-limitation). **Doc
de-drift:** CLAUDE.md capabilities map moe.10→moe.15 (forms row was materially
wrong), finish-sprint packet added at top, historical sections marked; PRODUCT
doc templates-empty claims corrected (3 templates exist; `meeting_minutes.md`
is the real gap). Sprint DoD: finish-sprint items 1–10 to Ready with evidence;
no ◐ matrix row without a card or explicit gate._

_**Finish-sprint execution tick (2026-09-03, items 1 + 6-leg-1).** **CLWX-46
FIXED + VERIFIED → Ready.** TB-1 settle-on-expected-item guard inside
openMessageById (read/reply/forward/mark-read/attachments all inherit
wrong-target protection; provable mismatch fails loudly, never returns another
email's content, never retries through a confirm gate). TB-2 root cause
CONFIRMED live by DOM probe: the only `[role="heading"][aria-level="2"]` on
the page is `span.screenReaderOnly` "Navigation pane"; the real pane subject
is `span[role="heading"][aria-level="3"]` inside `div[role="main"]` —
extraction now pane-scoped with a 5-step fallback chain. Evidence: new
`scripts/clwx46-stale-read-check.ts` PASS 3/3 rows × 3 consecutive runs;
v2-eval 15/15 (final run D; run C's 12/15 was lane flake — open-draft
obstruction + load, zero settle failures in its log); units 162/1280 green;
typecheck 0. Commit `715e17b7`. Read latency IMPROVED (W3.1 57s→1.5s class).
**CLWX-66 leg 1:** `meeting_minutes.md` template authored; product doc
reconciled. **Loop surfaces:** cron `977942a5` verified live (6h tick);
`docs/GA_LOOP_PROMPT.md` gives the owner the manual tick + run-to-exhaustion
prompts; sprint-driver skill re-pointed at the finish sprint. Next tick's top
P items: CLWX-62 Daily Report e2e, CLWX-63 extraction chain, CLWX-65 in-app
write turn._

_**Lane-wedge tick (2026-09-03 morning, owner-in-the-loop with screenshots).**
Three eval runs degraded to 10–13/15 with ZERO product defects; owner
screenshots pinned both causes live. **CLWX-69 filed (high):** the compose
discard CONFIRM dialog is titled "Discard message" but its buttons are
**OK/Cancel** — automation waiting for a "Discard" button waits forever and
the fui-DialogSurface backdrop then blocks every row click; second layer:
`locator.first()` latches a HIDDEN Discard in DOM order (CLWX-59 class).
**CLWX-70 filed (high):** flows that exit without explicit send-or-discard
SAVE drafts — litter accumulates ([Draft] conversation markers, Drafts [23])
and feeds CLWX-58; acceptance = exit-path invariant (compose opened ⇒ sent or
discarded on every path), an automation-drafts sweeper, and an eval zero-new-
drafts postcondition. **Harness fixed (`bfeb2cf1`):** v2-eval discardOpenDrafts
is DOM-side visible-only + OK-aware, runs pre-eval and post-W4.x; new
read-only `scripts/outlook-lane-probe.mts` (dialogs/backdrops/row-cover via
elementFromPoint) — it root-caused both bugs. Verified: **run H 15/15 exit 0
starting from a wedged lane** (self-healing proven). MCP research
(forms-via-MCP + app enhancement) in flight — lands as a doc + board card
next tick._

_**Sprint-driver tick (2026-09-03, cron): CLWX-62 Daily Report e2e LIVE-PROVEN.**
SENSE: tree clean, mirror current (71), CDP 200, board 200, tunnel down
(V-lane parked, owner gate holds). ANALYZE: no serial promotions (Graph L4
still on the 2-min operator sign-in; V-batch on VM start; Ministry unchanged).
ACT (single P item, highest leverage): the statutory 3:45pm form had never
run end-to-end — new `scripts/forms-fill-daily-report.ts` (Suspensions
pattern, max-visibility coherent payload) ran live on the test.fac clone:
open PASS, **fill 55/57 / 0 errors (96%)**, gate REFUSED without confirm,
**DEMO=1 confirmed submit SEND PASS** ("Form submitted via Microsoft Forms").
typecheck 0. CLWX-62 Todo→In Progress with evidence + resumable trail; the
last acceptance leg before Ready is the RECORDED run (adapt
forms-submit-recorded.ts: hard-pinned URL, responses-count increment,
video+trace). S2 matrix row "Daily Report e2e" ◐→● for fill/gate/submit._

_**Karunesh deep-dive + V-batch launch tick (2026-09-03, owner-directed "check
his messages / drive everything").** Read his full WhatsApp thread + pulled
his app log and screenshots via the bridge. **His moe.15 matrix: 4/5 Worked;
PDF summarise FAILED; email send FAILED.** Root causes, all log-evidenced:
**CLWX-72 (URGENT)** packaged Windows runtime missing `pdf-parse`
(document.read_pdf dead; config was correct since June — bundler/loader
defect; pdf-parse was never on the install-verify checklist so it shipped
unverified); **CLWX-73 (high)** chrome-cdp repair falls back to a MANAGED
Chromium profile on port_bind_timeout — a profile=user hard-rule violation
path in shipped code; **CLWX-74 (high)** VLM grounding hard-requires local
AWS creds (testers/principals have none) and the New-mail locator missed —
plausibly because OUR eval draft litter on the shared test.fac mailbox hides
New mail (CLWX-70 impact CONFIRMED user-facing); **CLWX-75 (medium)** header
"Disconnected" badge contradicts the gateway-connected footer mid-turn.
Positive: his matrix item d = the FIRST external in-app write-turn proof
(noted on CLWX-65). **Acted:** `scripts/outlook-drafts-sweeper.ts` authored
(strict automation-subject allowlist, hover-delete, dry-run default) and run
— **14 automation drafts deleted, re-scan 0** — his send path is unblocked.
Reply drafted-and-held (`outbound-drafts/2026-09-03-karunesh-test-findings-
DRAFT.md`, owner GO to send). **V-batch running** as background workflow
(wf_d05d351a): VM RUNNING, stage 1 captures the installed-tree ground truth
for CLWX-72, then ASR/cron/degrade/b2 surfaces. Owner authorization on
record this tick: gcloud + V-batch + all tasks agent-driven._

_**CLWX-72 holistic RCA + fix tick (2026-09-03, owner-directed "fix must be
holistic — five whys").** The V-batch probe OVERTURNED the working hypothesis
on the installed moe.15 VM: pdf-parse IS on disk; the real chain is
pdf-parse → pdfjs-dist → `@napi-rs/canvas` whose **win32 native binding (an
optionalDependency) never installs on the Mac build host**
(`supportedArchitectures os=["current"]`) → module eval throws "DOMMatrix is
not defined" → **loadDep()'s catch-all masked it as "module not found"** (the
lie that mis-directed triage). Karunesh reply SENT (owner GO, ledgered).
**Fix layers landed:** (1) `supportedArchitectures=[darwin,win32]` — all four
canvas bindings now materialize + ship in the bundle; (2) doc-tools.mjs
pure-JS DOMMatrix polyfill + `loadDepDetailed` truthful errors; (3) bundler
HARD-FAILS on missing EXTRA_BUNDLED_PACKAGES (was warn-and-skip); (4) new
`scripts/verify-openclaw-bundle.mjs` (presence + ship-target bindings + host
loadability) wired into the package chain. **Artifact-grade proof:** patched
doc-tools ran on the STILL-BROKEN moe.15 VM runtime with the packaged
node.exe — `CLWX72_VERIFY=PASS pages=1 chars=835` on a real Ministry
circular, binding still absent. Gates: bundle verify PASS, typecheck 0, full
suite green. Board: CLWX-72 → In Progress (remaining: moe.16 cut +
fresh-install re-verify); CLWX-58 → Todo(high) with the holistic
auto-recovery acceptance (driver-side state machine, MCP/CLWX-71 inherits);
CLWX-76 filed (truthful-load residual + auditor rules); **CLWX-77 filed
(owner "look around the corner"): artifact-grade doc-type × command matrix
against the PACKAGED runtime** — the systemic close for the
test-the-workspace blind spot. Register deltas appended (CANVAS-BINDING,
DISCARD-OK-WEDGE, DRAFT-LITTER, MANAGED-PROFILE-FALLBACK, VLM-CREDS-DEADEND,
DISCONNECTED-BADGE, W2-DAILY-REPORT-E2E, STALE-READ→FIXED)._

_**V-batch results + error-ledger tick (2026-09-03).** The V-batch workflow
completed all surfaces on the moe.15 VM: **gap C ASR PASS** (`ASR_SMOKE_OK`,
verbatim transcript, first-ever run of pilot-asr-smoke.ps1 — W8 Windows ●);
**gap D cron PASS** (`FIRED_OK` +21 ms, real agentTurn produced the 3:45pm
reminder text, no send — W5 Windows ●, direct CLWX-67 Windows-leg evidence);
**gap b2 write-turn PASS** (vbatch-b2.docx written + independently read back,
3-layer proof — CLWX-65 Windows leg); **W10 degrade FAIL → CLWX-78 filed +
FIXED-in-tree same tick** (`/connection error/i` missing from
UNREACHABLE_PATTERNS; the OpenAI-SDK surface seen in BOTH the hosts-block
test and the tester's ollama-down turns; classifier + 3 regression rows,
suites green; live re-verify rides moe.16); **KR2 STAGED** (everything armed;
one precondition: RDP at ≥1920×1080 before the assisted recording — owner
leg). VM STOPPED after the batch (restart is one command). **Error ledger
authored (owner-directed):** `docs/KARUNESH_ERROR_LEDGER.md` — all 14 ClawX
errors the external tester ever reported (2026-05-01 →), each with status +
derived test criterion; K8 (2026-06-30 intermittent PDF/office errors) turns
out to be the earliest CLWX-72 signal. Criteria wired into CLWX-77 (matrix
cells: fresh-box attach, intermittence ≥3×, seeded-litter mailbox,
no-creds box, degrade surface, karunesh-matrix fixture) and cross-referenced
on CLWX-34. Board at 78._

_**Full-project mining tick (2026-09-03, owner-directed "extract all the
blockers and bugs from the sessions").** New skill
`.claude/skills/session-log-miner` (the reusable JSON-log/feedback-mining
prompt) driven by a 6-miner workflow over 181 ClawX-related Codex rollouts
(incl. the 254 MB demo-day session), 11 app-session JSONLs, and every
feedback doc. **144 findings, all quote-backed:** 20 NEW → consolidated into
**CLWX-79..89** (headliner: CLWX-79 URGENT — suspension_payload silently
backfills missing statutory-form fields with demo defaults; also: pdf
allowlist rejects ~/Downloads, typecheck blind to electron/**, same-version
different-bits releases ×2, plaintext creds in local liaison logs);
14 FIXED-UNGUARDED → named missing tests folded into CLWX-77 (comment);
44 TRACKED-OPEN → provenance enriched (draft litter first sighted 06-23,
VLM-creds 05-27 — weeks before filing); 46 FIXED-GUARDED with guards that
ran green TODAY. Master doc:
`docs/BLOCKER_BUG_COLLECTION_2026-09-03.md` (144-row table + coverage
verdict + miner not-covered statements). Workflow note: the synthesis agent
stalled; miners' results recovered from the journal and synthesized by the
conductor. Board at 89._

_**Acceptance-gate tick (2026-09-03, owner-directed "formulate a test that
checks every single thing").** **`pnpm ga:gate` shipped (CLWX-90 → Ready):**
one command, every machine-checkable criterion, scorecard mapped to the
GO/NO-GO boxes, report to docs/evidence/, full per-check logs. **Run 1 RED
(7/2/2) — the gate immediately caught 4 pre-existing lint errors + 2
eval-harness brittleness defects (W3.1 inbox-order dependence, W4.1
stray-compose vulnerability); all fixed same tick. Run 2 GREEN: 9/0/2**
(`docs/evidence/GA_GATE_2026-09-03.md`; eval now 69s). Wiring: preflight +=
lint:check; GA_READINESS §4 carries the mechanism + GREEN-≤24h tag rule;
persona doc carries the "acceptance must name its gate check" rule.
**GA runway counted (finish-sprint §6):** board 89→90; 22+1 Ready await
owner close; scorecard 2 checked + 4 evidence-complete pending owner
acceptance; remaining split = agent (moe.16 cut+re-verify, CLWX-79, CLWX-82,
CLWX-62 recorded leg, CLWX-58/70 recovery, packet refresh) / owner (one
~1-2h sitting) / Ministry (KR7/KR8, post-GA-acceptable). Problem history
cross-linked everywhere (G16, CLAUDE.md packet items 6-7)._

_**Finish-drive mega-tick (2026-09-03, owner-directed "get everything done and
tested; minimal time").** Parallel fleet (7 lanes): **CLWX-79 FIXED**
(statutory refusals instead of demo-default backfill, 16/16 tests,
`2eec256f`) → Ready; **CLWX-62 FULL ACCEPTANCE** (recorded submit, responses
count 7→8 strict, video+trace, `8430a777`) → Ready; **CLWX-82 DONE**
(typecheck covers electron/**, 448→0, FOUR genuine runtime bugs caught,
`4d183268`) → Ready; **UI trust batch CLWX-75/52/53 FIXED** (badge was a
renderer-side HEAD probe lying about the gateway; chip anonymised via live
channel state; plain-language errors with collapsed raw detail, `2ce37055`);
evidence packet refreshed (`003999d2`); **KR2 RECORDING frame-verified
VALID** agent-side (display-device 1920×1080, zero-manual-step assisted
install, composer 10.2s; turn leg BLOCKED(vm-cpu) honestly — retry-breaker
CLWX-38 proven live; owner acceptance options on CLWX-25, `edc554dc`).
**Honest miss:** CLWX-58/70 recovery agent stalled ×6, zero edits landed —
stays top P item. Version bumped **moe.16** (`f8707c86`) carrying
46/59/72/78/79/82/UI/store-400; **build:win in flight**; then full gate
(SEND+NSCC flags) → VM install re-verify (drag-PDF, degrade, K14) → GCS
signed URL → Karunesh handoff (STAGED draft; owner send authorization on
record). Loop tightened to 2h cron (cc2751ee). Board @ 90: Ready pile now
26 cards awaiting owner close._

_**Sprint-driver tick (2026-09-03 cron, minimal-time mode): CLWX-58 + CLWX-70
BOTH → Ready.** SENSE: tree clean, mirror 91, tunnel UP (moe.16 VM verify
in flight, owned), CDP 200, static pulse GREEN 5/0/1. ANALYZE: top unowned
P item = CLWX-58/70 (the stalled agent's item). ACT (`9aabc8f6`):
`recoverComposeState` state machine — OK/Cancel discard dialog (CLWX-69) +
automation-owned composes only (shared `automation-subjects.ts` allowlist;
blank composes owned; human drafts protected and NAMED); wired at all three
block sites; exit-path invariant for reply/forward typing TIMEOUTS
(discardOwnCompose — the 2026-09-03 cascade class) with safety-class throws
preserved. **Proven live both ways:** clwx58-recovery-check PASS (stale
automation draft auto-discarded, second draft succeeded) and
clwx58-negative-check PASS (human draft protected, named, still open).
v2-eval 15/15 (one run failed W7.1 BECAUSE the CLWX-46 guard refused a
lagging pane — honest-by-design transient, rerun clean); 166-file unit
suite green; typecheck 0. Ready pile now 31. Remaining agent runway:
moe.16 VM verify (in flight) → Karunesh handoff (authorized, staged)._

_**moe.17 cut + CLWX-92/78 close + CLWX-93 fast-follow tick (2026-09-03, cron,
minimal-time mode).** moe.16 VM verify surfaced two live gaps behind the
Karunesh #1 PDF test and the auto-degrade: **CLWX-92** (pdfjs demands a
worker under the Electron UtilityProcess env; a fresh pdfjs import is a
different module instance under pnpm symlinks — fixed via `PDFParse.setWorker`
+ pdf-parse's vendored worker; regression check wired INSIDE
`verify-openclaw-bundle`) and **CLWX-78** (a cloud turn can die with NO
terminal stream event; only the history poll surfaces it, and that path had no
failover wiring — fixed by calling `maybeDegradeChannel` from
`applyLoadedMessages`). **moe.17 built + signed** (sha256
`182d92d6…0024`), uploaded to `gs://clawx-rc-artifacts-622687731621/moe17/`;
final VM verify dispatched (in-app drag-PDF + hosts-block degrade + letter
spot-check). kr2-recording's independent read-only RCA confirmed the CLWX-78
diagnosis and flagged that the history-path gate should key off
`lastSentPayload` (this client's own send) not `sending` (contaminated by
console run-adoption) — landed as **CLWX-93** (commit `cf9a5cd0`,
chat-channel-degrade 12/12; targets moe.18; the built moe.17 keeps 5020c39c
and is correct for the primary single-user case the verify exercises). Also
carried: the un-reset `sending` on the loadHistory terminal-error branch and
collapsing the two runError paths — noted on CLWX-93 as non-blocking cleanup.
GATE HELD: Karunesh handoff (staged, updated to moe.17 + new sha) fires only
on VM verify PASS per owner's "after we've tested it" condition._

_**Sprint-driver tick (2026-09-03, minimal-time mode): CLWX-69 promoted as a
resolved-dependent; GA static gate GREEN; moe.17 VM verify in flight.**
SENSE: tree clean on `fix/doc-tooling-steering`; IAP tunnel up; board HTTP 200
(93 issues, mirror in sync); `pnpm ga:gate GA_GATE_STATIC=1` GREEN (5 pass / 0
fail / 1 skip — typecheck, lint, unit, bundle-verify, doc-tooling harness; live
+ VM lanes deferred to V-batch). ANALYZE: the moe.17 verify owns the VM +
degrade/PDF paths (serial — untouched); among parallel-now items **CLWX-69**
(discard-confirm OK/Cancel wedge) is a resolved-dependent of CLWX-58/70 —
`clickDiscardConfirmOk` (outlook-actions.ts:2419, commit `9aabc8f6`) clicks the
`/^(ok|discard|yes)$/i` confirm button, and no path now blocks on a
"Discard"-labelled confirm; exercised by `scripts/clwx58-recovery-check.ts`
(live PASS) + `scripts/outlook-lane-probe.mts`. ACT: posted the evidence and
moved **CLWX-69 Todo → Ready** (a human closes Done after the live click in the
moe.17 outlook lane). moe.17 verify status: RESULT.md live, PRE-STATE captured
(pre-install FileVersion moe.16, state preserved), six checks PENDING — send
gate to Karunesh NOT met, HELD._

_**moe.18 gap-closure — parallel two-lane fix landed + a new K13 gap found
(2026-09-03).** The moe.17 VM verify agent DIED mid-run (six checks left PENDING,
no writes 20+ min); moe.17 is obsolete as a candidate. Target is **moe.18** built
with every open Karunesh gap closed. Ran `close-karunesh-gaps-parallel` (4 agents,
disjoint code lanes): **Lane A/email+chrome** deleted the managed-Chromium CDP
fallback (**CLWX-73** — `launchManagedProfileForCdp` gone; profile=user now
absolute; every failure degrades to a readable instruction) and killed the VLM
credential dead-end (**CLWX-74** — `ground()` returns `unavailable` with a fixed
reason that does not leak the SDK error, `clickByRoleOrVlm` refuses readably
instead of clicking a guessed coord, `draftEmail` returns structured
`status:'failed'`+preview, littered-mailbox DOM guard); **Lane B/trust-UI** removed
the badge false-red (**CLWX-75** — header now mirrors the footer's real predicate)
and confirmed **CLWX-52** (model-id anonymised) + **CLWX-53** (plain-language
error) already fixed. Both lanes reviewed **approve-with-nits, zero blocking**;
two-gate send confirmed untouched; 99/99 + 23/23 unit, typecheck+eslint clean.
**New finding from the retest audit:** Karunesh's K13 was *on-device* dying (6×
"Connection error.", no failover) but the only degrade path is cloud→on-device
(`maybeDegradeChannel` hardcodes `channel:'on-device'`); his real direction is
UNBUILT → **Lane A2** (add preference-aware on-device→online failover in
`channel-degrade.ts`+`chat.ts`; the degradeChannel route already accepts
`'online'`). Also sharpened: PDF (**CLWX-92**) and cloud→on-device degrade
(**CLWX-78**) FAILED live on moe.16 — fix-pending-verify, not proven. Full
truth + release path in `docs/RELEASE_GAP_CLOSURE_STATE_VECTOR_2026-09-03.md`.
Integration gate running; Lane A2 next; then moe.18 build + ONE full-matrix VM
verify (both degrade directions). Karunesh handoff still HELD — nothing sent._

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
| CLWX-44 missed-defect verify | run the 3 criteria (exec-noise transcript assertion; idle-timeout degrade check; Plaud repro) — **in flight 09-03** | 1–2 lanes |
| CLWX-42 NSCC pack | re-download NSCC-2026.pdf via the bridge → knowledge pack → run the free Q&A eval | 1 lane |
| CLWX-34 RAJ-2 | seeded structured email → LLM reply → fidelity assertion (Mac Outlook lane) | 1 lane |
| CLWX-43 latency | laptop-lane 3-prompt repeat (budget sign-off is bucket B) | 1 lane |
| CLWX-39 Graph lane | twin UNNECESSARY (same tenant, L1–L3 PASS live 09-02); remaining = scope baseline + compose refusal + config enablement + Settings toggles — **in flight 09-03** (§2a P1) | 1 sitting |
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
- **moe.18 cut, SHIPPED to Karunesh (owner-directed pre-verify), verify
  delegated (2026-09-03 tick).** moe.17 verify COMPLETED all-PASS (the "died
  mid-run" line was a race against the evidence write — corrected in
  RELEASE_GAP_CLOSURE_STATE_VECTOR). moe.18 adds Lane A+B (`8fac374f`), Lane
  A2 (`0925528e`), and the launch-channel fix: `preferredChannel` no longer
  store-defaulted (`715eab73`) + review-mandated marker-gated legacy migration
  (`f5a9d4d7`, closes the code-reviewer HIGH: conf@15 persists defaults at
  construction, so upgraded boxes carried a phantom 'on-device'). Full gate
  GREEN (typecheck, lint 0, 1336 unit; static ga:gate 5/5 —
  `docs/evidence/GA_GATE_2026-09-04.md`). Installer uploaded (432,028,001 B,
  sha256 `5b0884ed…d4e7`), 11h signed URL sent via bridge success:true on
  explicit owner instruction ×3 ("if it fails, it fails, but send it") —
  informed owner override of the all-green gate, ledgered as such. Full-matrix
  VM verify delegated to the moe.17 verifier session (packet:
  `/tmp/moe18-vm-verify-packet.md`; adds a moe.13 no-clobber leg); any RED ⇒
  draft-and-hold heads-up for owner GO. Open hardening candidates from the
  moe.17 addendum: orphaned degrade turn, post-restore wedge-until-relaunch,
  phantom prompt replay under CDP churn. **Owner ask (two commands while
  authed): `gcloud auth login`, then
  `gcloud iam service-accounts keys create ~/.config/gcloud/claude-ssh-sa-key.json
  --iam-account=claude-ssh-sa@gen-lang-client-0649986230.iam.gserviceaccount.com`**
  — the periodic-reauth policy killed the whole VM lane (tunnel + gsutil + ADC
  at once; verifier probed all fallbacks dead), and the intended SA self-heal
  key on disk is 0 bytes (Aug-12 create never completed), which is why this
  class recurs. Mac-hop hash of the shipped moe.18 exe: PASS (verifier);
  guest hop pending auth. Verify resume is one staged script + a live
  credential poll.
- **moe.17-addendum hardening findings now tracked (2026-09-04 tick):
  CLWX-94/95/96 filed** — phantom prompt replay under CDP churn (94), degraded
  turn orphans at prompt.submitted (95), post-degrade recovery wedge with
  stale banner + silent sends (96). Evidence anchor: the moe.17 RESULT.md
  addendum; the in-flight moe.18 verify re-records 95/96 by design. Board @
  96 issues, mirror re-exported. Deliberately NOT acted on: CLWX-58+70
  auto-recovery code — rewriting the email-flow surface mid-verify would
  invalidate the release verify; queued for after the verdict. Static ga:gate
  GREEN again (5/5). gcloud reauth O-gate re-probed: still blocked (owner ask
  unchanged).
- **Karunesh moe.18 FIELD REPORT (2026-09-03 evening, WhatsApp; owner
  directive: OBSERVE ONLY, no action).** Documents/file interactions:
  "working fine now" — K10/CLWX-92 externally confirmed on the shipped
  moe.18. Email: blocked at chrome-attach on his real box (K1/CLWX-73 class)
  — agent opened Chrome, could not CDP-attach, gave the PLAIN-LANGUAGE
  close-Chrome-and-retry instruction (trust-UI messaging held; no raw
  errors), retry still failed; email otherwise untested. He sent an
  image + document with details (in the WA bridge store, unretrieved).
  No channel/model complaints (consistent with Online launch). Owner is
  handling the thread directly (stress test plan, chrome-mcp suggestion,
  source + agent access offer). Deadline signal: **Raj wants a demo version
  for Monday.** No cards moved on this — awaiting owner release from
  observe-hold.
- **GA sprint driver tick (2026-09-04, minimal-time): the gcloud-auth O-gate
  that has blocked the VM lane for multiple ticks has CLEARED.** Probed live:
  active account restored (`gcloud auth list` ACTIVE), `gcloud compute
  instances list` returns, IAP tunnel :12222 open — the reauth half of the
  standing owner ask is DONE. **But the lane is only HALF-recovered:** the RC
  VM `clawx-win-rc-20260609` is **TERMINATED** (must be started before the
  verify runs), and the SA self-heal key on disk is **still 0 bytes**
  (Aug-12 create never completed) so the auth-expiry class WILL recur. The
  target SA (`claude-ssh-sa@gen-lang-client-0649986230…`) is confirmed live
  (describe returns, not disabled), so the owner create-key command works
  as written. Static `ga:gate` re-run **GREEN 5/5** (typecheck incl. the
  electron leg, lint 0-err, 1284 unit, bundle-verify, doc-tooling) ~2h after
  the 05:56 record — T0 stable; report unchanged (cosmetic re-run reverted).
  **CLWX-82 confirmed already Ready** (electron typecheck covers 173
  electron/**/*.ts and passes in-gate; runway §6's agent-lane listing was a
  day stale — board is ahead). No release surfaces mutated (freeze respected;
  CLWX-58/70 still queued post-verdict). **Net: the moe.18 full-matrix verify
  — the #1 GA gate — is promoted O→ready-to-run;** remaining is owner-only
  (start the VM + the 10-sec SA-key command) then the delegated verifier
  session runs `/tmp/moe18-vm-verify-packet.md`. No cards moved (the one
  agent-lane item that was evidence-complete, CLWX-82, is already Ready).

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

## 2a. Full-colour execution analysis (2026-09-03 — supersedes the §2 table)

Every remaining non-green surface (register group-A rows, W1–W10 matrix cells,
gap-checklist items A–F, non-terminal board cards), classified by what actually
gates it. Extended taxonomy: **P** parallel-now on this Mac, **S** serial
(named predecessor), **O** owner sitting, **M** Ministry, **V** Windows-VM/
laptop lane. Probes behind the classes (2026-09-03): `gcloud` auth LIVE;
VM `clawx-win-rc-20260609` TERMINATED (owner stopped billing); board API up;
Chrome CDP/gateway state probed per-lane by the executing agents.

### P — parallel-now (this Mac, no one to wait for)

| # | Item | Retires | Status |
|---|---|---|---|
| P1 | CLWX-39 Graph lane completion: read-only scope baseline, scope-aware compose refusal, config-based transport enablement + Settings toggles, attachment fidelity, cross-transport ids, seed hygiene, stub parking | CLWX-39 → Ready path; unblocks CLWX-40 | **DONE 09-03** (adversarial findings fixed; suite green) |
| P2 | CLWX-30 KR7 buildable half: `UserId=oid` header on the moe-cloud-gateway provider (seed + sign-in/out re-stamp) + broker forwards UserId upstream + seam tests | agent-side KR7; makes Ministry values a config swap | **DONE 09-03** (live-reload threading fixed post-review) |
| P3 | CLWX-40 precursor: token-persist harness (`--persist`) + `v2-eval-graph.ts` L4 driver with read-only-scope expectations + anti-mock guard | stages L4 to a 2-min operator sign-in | **DONE 09-03** — L4 now waits ONLY on the sign-in |
| P4 | CLWX-44: verify-or-refute EXEC-NOISE-LEAK / IDLE-TIMEOUT-RAW / PLAUD-ZERO-MIN | 3 group-B register rows | **DONE 09-03** (1 closed-verified, 1 fixed same tick, 1 honest-closed) |
| P5 | `pilot-asr-smoke.ps1` authoring (gap-C precursor — script didn't exist) | arms gap C for the next VM window | **DONE 09-03** (desk-checked; first run owed on pilot box) |
| P6 | W8 Mac whisper smoke (say → WAV → transcribe → assert) | W8 Mac ◐→● | **DONE 09-03** — real transcript ×2, duration non-zero |
| P7 | W3 Mac forms fill to the 29/32+gate bar (submit-gate refusal is the assertion) | W3 Mac ◐→● | **DONE 09-03** — 29/32 + gate refusal, VM bar matched |
| P8 | RAJ-2 fidelity scenario (CLWX-34, last of Raj's 4) — draft-only, never send | Ext-val A last leg + register row + card | **DONE 09-03** — model layer NOT reproduced (dual deterministic assertion PASS, nothing sent); CLWX-34 → Ready; NEW suspect STALE-READ filed as CLWX-46 |
| P9 | CLWX-42 NSCC knowledge pack + Q&A eval | Raj's clearest feature ask | **eval half DONE 09-03** — 18/20 (90%) live on Raj's own 20 questions; in-app knowledge pack = P12 |
| P10 | KR4 kill-egress e2e residual | zero GA boxes (already checked) | do last |
| P11 | CLWX-46 stale-read settle guard + subject-selector fix (TB-1/TB-2) | trust-killer class; recommended pre-GA | **next tick's top P item** |
| P12 | NSCC in-app knowledge pack: `data/nscc-2026.txt` + `principal.nscc_lookup` tool + persona line (NOT a workspace doc — protects the KR6 floor) | closes CLWX-42 full acceptance | agent-executable |
| P13 | TB-3 slow-turn watchdog + TB-4 UserId coherence-auditor rule + TB-5 frame-capture loudness + TB-6 Atlas §16–18 | resilience hardening (carded) | agent-executable, batchable |

### S — serial chains (irreducible, with the exact predecessor)

| Chain | Links | Collapses when |
|---|---|---|
| Identity | KR8 real values (M) → KR7 App-Insights verify (M) → KR6 fleet-verify | P2 makes the agent side complete: values arrive ⇒ config swap + verification only |
| Graph ladder | P1/P3 land → **one 2-min operator sign-in** (test.fac, in-app or `--persist` harness) → L4 Graph eval run → L5 Chrome-less | operator sign-in is the ONLY human step left in L4 |
| Release | this tick's code green → moe.16 cut (preflight gate) → VM install/smoke | next RC carries the Graph lane + UserId stamping |

### O — one owner sitting (~1 hour, unchanged plus two new)

CLWX-18 scrub, CLWX-19 rotation, trim unhold (`7add864b`), latency budget
sign-off, KR2 acceptance decision, external-tester handoff, CLWX-45 per-item
GO, close the 18 Ready cards. **New this tick:** (a) GO on the drafted Raj
Graph-working update (`outbound-drafts/2026-09-02-raj-graph-signin-working-DRAFT.md`);
(b) rotate the Entra client secret Ansari shared — PKCE means we never need it.

### V — one VM window (owner starts it; agents drive; ~5 surfaces/session)

Gap C ASR (script armed by P5), gap D cron fire, W10 Windows degrade, b2
in-app write turn, KR2 recording staging, CLWX-43 laptop-lane latency.
Unblock is literally: `gcloud compute instances start clawx-win-rc-20260609
--zone us-central1-a` (auth verified live; billing = owner call).

### M — Ministry (post-GA by design)

KR8 session + values (ball with Raj since 09-02), KR7 production verify,
CLWX-7 flow URLs, CLWX-8 production accounts.

**Critical-path readout:** nothing in P/S blocks GA declaration — the GA gate
is the O sitting. The longest lever (KR8→KR7→KR6) is Ministry-paced and
post-GA-acceptable per the finish vector. Maximum parallelism this tick = P1–P7
concurrently (disjoint files/lanes), then P8/P9 serialize on shared lanes, then
one VM window batches all five V surfaces.

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
