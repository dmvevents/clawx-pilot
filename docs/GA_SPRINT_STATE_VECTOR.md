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

_**Tick 2026-09-04 (ga-sprint-driver, one tick — minimal-time mode).** SENSE:
tree clean on `fix/doc-tooling-steering`, static gate GREEN (5/5 T0), board no
drift, Windows RC VM `clawx-win-rc-20260609` TERMINATED (VM legs unrunnable).
ANALYZE: CLWX-82 (electron typecheck non-vacuous) already landed `4d183268`;
highest-leverage remaining P item = CLWX-58 (compose auto-recovery), which had
NO live proof — the eval clears any open compose BEFORE drafting, so it never
exercised the runtime `recoverComposeState` pre-flight. ACT (commit `3512f02f`):
added `scripts/clwx58-compose-recovery-check.ts`, a durable draft-only live
verifier proving BOTH halves — RECOVER (stale automation-OWNED compose →
next draft SUCCEEDS = auto-recovered, not a wedge) and PROTECT (human-looking
draft → automation draft REFUSES cleanly, names the untouched draft, never
clobbers it) — and wired it as a permanent T1 lane row in `scripts/ga-gate.mjs`
(exit 0/1/2, mirrors the CLWX-46 check). The check PASSED live standalone twice
(both legs, exit 0) on the test.fac session; root + electron typecheck GREEN. The
full `ga:gate` end-to-end re-green is PENDING a Chrome/CDP recovery: the shared
Outlook renderer tab crashed mid-run (`Page crashed` → `connectOverCDP` timeout
on the stale target), which fails ALL T1 live checks equally until the signed-in
Chrome is restarted — a lane condition, not a product or wiring defect (T0 GREEN,
new row parses/executes, CLWX-58 + CLWX-46 both passed standalone pre-crash).
CLWX-58 stays at Ready (was already there); no card moved. NEW owner ask:
restart the signed-in Chrome on `:18792` to clear the wedged CDP target so the
full T1 live lane re-greens end-to-end (owner action — it closes the principal's
unrelated open tabs). Prior owner asks unchanged._

_**Tick 2026-09-05 (ga-sprint-driver, one tick — minimal-time mode, concurrent
with the owner-directed GA-breadth push).** SENSE: static gate GREEN (5/0/1 T0,
report `docs/evidence/GA_GATE_2026-09-05.md`); board no drift (mirror delta =
export timestamp only); CDP wedge RE-CONFIRMED live (`connectOverCDP` timeout on
the same stale target `f0300805…` despite `/json/version` 200 — the clwx46 probe
is the truth test, not the HTTP endpoint); `:12222` tunnel process still up but
the VM remains TERMINATED (stale local listener, not a lane). Direction: the
owner reviewed `docs/GA_DEMO_READINESS_ASSESSMENT_2026-09-05.md` (authored this
session — two-bar analysis, demo vs GA) and chose the **GA-breadth push**:
CLWX-61/63/65/66/67. Two sub-agents are IN FLIGHT (61+63 test-surface authoring,
lane-blocked halves marked authored-not-proven; 65 live in-app write turn via
the running app — no Chrome dependency); 67 then 66-classification queue behind
65 on a serialized live-app lane. ANALYZE: no serial promotions (62 = DEMO=1
owner-gate; 61/63 live halves = Chrome-restart owner-gate; VM legs = terminated
VM). ACT (bounded, non-colliding): CLWX-66 scope-narrowing verification —
acceptance item 1 VERIFIED done (`meeting_minutes.md` authored with agenda /
attendees / decisions / action items + pupil-anonymity note) and item 3 VERIFIED
done (PRODUCT doc rows already reconciled 2026-09-03, lines 92/102/142); only
item 2 (classification e2e over 3 fixtures) remains, queued on the live lane.
CLWX-66 Todo → In Progress with evidence comment. Owner asks unchanged; the
Chrome restart on `:18792` remains the single highest-value unlock (it un-blocks
the 61/63 live halves AND the full-gate re-green AND any pre-demo email
dry-run)._

_**GA-breadth landing 1 of 2 (2026-09-05): CLWX-61 + CLWX-63 test surfaces
authored, static-verified, lane-blocked for live proof.** The authoring agent
delivered: (a) `scripts/v2-eval.ts` — W5.2 forward row (drafted+pane-verified
via FW:/FWD: subject overlap, then discarded; dispatch gates untouched), W8.3
download refusal-FIRST row (gate fires pre-browser, always runs), W8.4 seeded
confirm leg (loud SKIP when nothing seeded), W3.2 per-entry attachment-metadata
hard-asserts; (b) `scripts/clwx63-extract-chain-e2e.ts` — the full
letter→writeDocx→readDocx→Bedrock-extraction (registered tool contract)→
`principal.suspension_payload`→`forms.preview_suspension`→live fill→diff (≤3
misses)→confirm:false refusal chain over PRODUCTION surfaces with only the
host-API HTTP hop shimmed; the shim HARD-THROWS on any truthy confirm (verified
at line 170) so the harness structurally cannot submit; (c) fixtures
(`tests/e2e/fixtures/clwx63/` — Student A invented data, 31 expected normalized
values). Evidence: ad-hoc strict tsc + eslint exit 0 (NOTE: `pnpm typecheck`
does not cover `scripts/` — follow-up worth a scripts tsconfig); plugin units
20/20; probe-only run reproduces the exact CDP wedge and exits 2 cleanly. Both
cards Todo → In Progress (live-proof halves owner-gated on the Chrome restart;
W3.2/W8.4 additionally need a seeded .pdf attachment in test.fac). **NEW DEFECT
CLWX-98 (+ register row INFRACTION-ALIAS):** the Suspensions normalizer rewrites
"Fight without Weapon" → "Fight with Weapon" (`index.mjs:196-197`, alias order —
`/fight.*weapon/i` matches " without "); wrong-answer rewrite on a statutory
field, verified against source before filing. CLWX-65 agent still in flight;
67 + 66-classification queued behind it on the serialized live-app lane._

_**GA-breadth landings 2+3 (2026-09-05): CLWX-65 live-proven to Ready; CLWX-98
fixed 6-wide with a falsifiable round-trip guard.** CLWX-65 (`ec162252`): a real
live in-app turn produced `sports-day-letter.docx` via `document.write_docx`
(host-API chat relay over the app's gateway connection — composer-equivalent
`chat.send` RPC; osascript keystroke lane TCC-blocked, documented honestly);
`demo-office-analysis-e2e.mjs --write-check` added (writeDocx+writeXlsx 8/8,
re-run independently, exit 0); matrix gap b2 CLOSED on Mac; renderer verified to
strip leading think-blocks (`message-utils.ts:67`) so the observed `<think>` in
finalText never reaches the principal; Windows leg queued for V-batch. CLWX-98:
the filed alias defect turned out to be 1 of SIX silent statutory rewrites (the
worst: WHEN "During class time (unsupervised)" → "(member of staff present)", a
supervision-fact flip). Fix = negative-lookahead carve-outs + row reordering in
`index.mjs` + NEW `tests/unit/moe-suspensions-option-roundtrip.test.ts` driving
all 140 canonical option texts through the real `forms.preview_suspension` with
identity asserted (falsifiability: with the fix stashed the test lists exactly
the 6 rewrites). 21/21 units green, independently re-run by the main session;
free-text mapping improved as a side effect ("threatened a classmate, without a
weapon" now maps correctly). Register row INFRACTION-ALIAS updated to FIXED
in-tree. In flight: CLWX-67 cron-reminder e2e (live-app lane) + CLWX-66
classification e2e (plugin-direct, collision-isolated); scripts-tsconfig
scope-add still open with the CLWX-98 agent._

_**GA-breadth landing 4 (2026-09-05): scripts/ typecheck coverage — the
vacuous bar is closed (`c4e11d4f`).** `pnpm typecheck` covered only src/ +
electron/, so every eval/gate script (v2-eval, clwx\*-checks, forms drivers)
shipped type-unchecked. New `tsconfig.scripts.json` (extends tsconfig.node.json,
noEmit, allowImportingTsExtensions for tsx-style imports) + `typecheck:scripts`
+ appended to `pnpm typecheck` — ga-gate T0 runs `pnpm typecheck`, so the GA
gate inherits it with no gate edit. Census: 74 errors → 51 were config
artifacts, 10 genuine fixed with zero behavior change (honest `as unknown as`
casts on LLM-produced args; dead `confirm:false` removed from draftEmail
literals — `DraftEmailArgs` never had the field, SEND gate untouched), 11 legacy
one-off probes excluded with reasons, `clwx66-classify-e2e.ts` excluded as
in-flight (include once it lands — it has a real arity error at :182 the new
check unmasked). `scripts/types/mjs-modules.d.ts` declares `*.mjs` as any
(scripts project only) so plugin-importing scripts keep their other coverage.
Falsifiability independently re-proven by the main session: injected TS2322
fails `typecheck:scripts`, reverted exit 0. Byproduct register row:
RAJ3-FROM-NOOP (subject-only matching masquerading as subject+from). Full
typecheck green across all three projects; 21/21 units; eslint clean._

_**GA-breadth landing 5 (2026-09-05): CLWX-66 to Ready — classification e2e
PASS 3/3, all three acceptance items now proven (`fdefb23f`).** Production
surface stated honestly: there is NO document.classify tool — the taxonomy is
persona/product-doc-encoded, so the harness (`scripts/clwx66-classify-e2e.ts`)
drives the plugin's real persona SYSTEM_PROMPT (imported live from persona.mjs)
+ the product-doc taxonomy as a closed answer set, over text that came through
the PRODUCTION document reader (writeDocx → readDocx/mammoth — the classifier
sees reader output, not raw fixture bytes), same Bedrock lane as clwx63.
Plugin-direct; no app session (live app owned by the CLWX-67 lane); nothing
sent. Fixtures: 3 documents from 3 distinct classes (MoE_circular,
staff_leave_application, meeting_minutes), invented data, Teacher A/B, no pupil
names; raw replies were exact class tokens. Falsifiability: flipped-expectation
negative control FAILS exit 1. Independently re-run by the main session (PASS
3/3); `typecheck:scripts` green with the script now INCLUDED (temporary exclude
removed; the :182 arity error the new check unmasked was fixed in-lane).
Caveat, same class as CLWX-65's mechanism note: this proves persona+model
routing, not an in-app chat turn doing it. Still in flight: CLWX-67
cron-reminder e2e (live-app lane; `scripts/clwx67-reminder-e2e.ts` appeared in
tree, report pending)._

_**GA-breadth landing 6 (2026-09-05): CLWX-67 to Ready — first-ever e2e proof
of the agentTurn cron path (`2c71f20f`) — and it found CLWX-99 (cron tz).**
One live SCHEDULED fire (12ms after its minute, never force-triggered), the
principal-facing reminder visible in-app and asserted via the window AX tree
(this context holds TCC assistive access, unlike the clwx65 lane); defer path
PASS and chat-only (only session_status + cron tools — asserted against a
send/submit denylist), with a GENUINE re-schedule (one-shot `kind:"at"`,
`deleteAfterRun:true`) — the reminder loop closes for real. Hygiene verified
independently: cron store empty on disk afterward, DELETE-verified, harness
finally-block sweeps its run window. All 11 assertions green;
`typecheck:scripts` green with the harness included. THE FIND: **CLWX-99** —
neither creation surface sets `schedule.tz`, so exprs parse in the gateway's
boot-time tz (observed Asia/Calcutta vs system Asia/Dubai; first `nextRun`
landed in 2027); the seeded 3:30pm fleet reminder fires at gateway tz, not the
principal's clock, and the agent defer write stores naive ISO as UTC (4h late
observed). Register row CRON-TZ. Trust cosmetics recorded on the card: raw
`[cron:<uuid>]` prefix + internal instruction + tz header in the user bubble;
think-block render in the defer reply (existing class); dev composer shows a
raw model id in the evidence screenshot (pilot-build anonymisation to confirm
on the RC). Windows leg = V-batch (gap D unchanged). **All five GA-breadth
cards are now landed: 65/66/67/98 Ready this session; 61/63 In Progress with
only their live halves owner-gated on the Chrome :18792 restart.**_

_**CLWX-99 fixed (2026-09-05, owner-directed next block): cron schedules now
pin the principal's wall-clock at every creation surface (`6b446d13`); card to
Ready.** Root cause confirmed live before fixing: the running gateway (up since
Sep 3, no TZ env) still resolves Asia/Calcutta — a boot-time ICU cache from
before the system zone changed to Asia/Dubai (the "laptop tz change without app
restart" path, live on this machine); separately the gateway appends Z to
zone-less "at" ISO strings (naive = UTC unconditionally). Fix: new
`electron/utils/cron-tz.ts` — `systemTimeZone()` reads `/etc/localtime` FRESH
per call (validated, Intl fallback on Windows), deliberately not the
process-cached Intl zone; POST pins tz, PUT (`buildCronUpdatePatch`) pins bare
strings and untz'd cron objects without overriding explicit tz, the seeded
3:30pm fleet reminder carries tz plus a REPAIR path for already-seeded installs
(found-by-name idempotency would otherwise never deliver it); persona rule
requires explicit UTC offsets on agent "at" writes (the cron tool is upstream
gateway code — prompt-level is the fork lever, stated honestly). Evidence: NEW
`tests/unit/cron-tz.test.ts` 10/10 with demonstrated falsifiability (5
fix-dependent tests fail with the fix stashed); NEW `scripts/clwx99-tz-check.ts`
live two-leg check — leg A documents the defect on the RUNNING pre-fix build
(job would fire 22:29 instead of 23:59 local, 90min early; flips to regression
proof on the next build), leg B proves the gateway honors explicit tz
end-to-end today (23:59 exact), self-cleaning with removal verified. Full suite
1371 passed; typecheck green; eslint clean. Trust cosmetics from the CLWX-67/65
evidence filed as **CLWX-100** (low): cron user-bubble plumbing leak,
think-block render, RC-composer model-id confirmation, noisy delivery error.
NOTE: the RUNNING app carries the defect until the next build+restart — the
Monday demo build must include `6b446d13` for the reminder to fire on the
principal's clock._

_**CLWX-100 fixed (2026-09-05, monitor-directed tick): cron trust cosmetics to
Ready (`566a7504`).** Items 1+2 fixed in the renderer
(`src/pages/Chat/message-utils.ts`): a `[cron:<uuid> <name>]`-prefixed user
turn now collapses to its headline paragraph (UUID prefix, instruction block,
and injected "Current time:" header all hidden, display-only, job-name
fallback), and think blocks are stripped anywhere in an assistant reply (was
leading-only; unclosed mid-text openers truncate, `<final>`-recovery
preserved). Item 3 (raw model id in composer) CLOSED dev-only by code — the
raw-id dropdown is gated behind `devModeUnlocked` (default false,
`settings.ts:101`; gate at `ChatInput.tsx:308-311`); no RC exposure. Item 4
(spurious "Channel is required" in the run journal) reclassified UPSTREAM —
thrown by gateway dist `channel-selection` even for delivery-none runs; fork
already clears it at every fork-owned surface; flagged for the next upstream
merge pass (dist patching mid-pilot rejected on CLWX-99). Evidence:
`docs/evidence/CLWX100_2026-09-05.md`; 6 new units (13/13, 5 fail with the fix
stashed); full suite 1377 passed; typecheck + lint green. Same next-build gate
as CLWX-99: re-run the `scripts/clwx67-reminder-e2e.ts` UI assertions on the
build carrying `566a7504`._

_**Driver tick 2026-09-05 (afternoon): CLWX-80 fork-side half to Ready
(`148c4e53`); static GA gate GREEN; Chrome wedge re-verified live.** Pulse:
`GA_GATE_STATIC=1 pnpm ga:gate` GREEN — 5 pass / 0 fail (typecheck, lint,
units, bundle-verify, doc-tooling harness; report
`docs/evidence/GA_GATE_2026-09-05.md`, committed). Probe discipline paid off
twice: Chrome :18792 answers HTTP and even completes the CDP WebSocket
connect, but the attach handshake still times out (clwx63 probe-only leg) —
the wedge PERSISTS, the owner restart ask stands, CLWX-61/63 live halves stay
owner-gated (NOT promoted); gcloud reauth still required, VM lane still
owner-gated. Act: CLWX-80 — persona now explicitly bans the generic core read
tool on .pdf/.docx/.xlsx/.pptx (the raw PK/ZIP-bytes path was never named
before, only Python skills and exec), and carves out .pptx honestly (no
document.read_pptx exists; the old blanket "never say tooling is unavailable"
cornered the model into raw bytes for PowerPoint — it now offers a PDF export
or pasted text). Acceptance 1 (Downloads/OneDrive allowlist) verified already
true fork-side (`doc-tools.mjs` RELATIVE_SEARCH_DIRS); acceptance 2 (core
read-tool OOXML refusal) reclassified UPSTREAM, flagged for the merge pass.
Guard unit in `moe-principal-assistant-plugin.test.ts` (21/21; guard alone
fails with the edit stashed). §6 lane-list drift noted: CLWX-79/82/58 already
Ready, version already moe.18 — the Sep 3 runway count is stale._

_**Driver increment 2026-09-05 (evening): monitor-reported Chrome recovery
DISPROVEN — no live half run, no cards moved.** The monitor promoted the
CLWX-61/63 live halves on ":18792 is back". Probe discipline: the clwx63
probe-only leg still reports NOT attachable (HTTP 200, ws connected to the
same browser target `f0300805…`, attach handshake timeout at 8s), and a
manual `connectOverCDP` retry with a 30s timeout fails identically — so the
signal was ping-level, third independent confirmation of the
ping-up/attach-down wedge. `lsof` shows no visible foreign client holding
the port (nothing to clear on our side); Chrome helper processes still carry
`remote-debugging-port=18792`. Conclusion: the wedge is inside Chrome's
browser-target DevTools session; the ONLY fix remains the owner restart of
the signed-in Chrome. CLWX-61/63 stay In Progress / owner-gated; no work
manufactured per the driver guardrail._

_**Driver increment 2026-09-05 (night): CLWX-85 version-bits hash-manifest
gate to Ready (`a5db3b1f` + review pass `5dd5f26f`).** Monitor directed one
non-Chrome increment from CLWX-74/84/85; picked 85 (in-tree only, no
evidence-mutation risk, and it directly serves Monday's build — the demo
build must verifiably carry `6b446d13`+`566a7504`+`148c4e53`).
`scripts/release-hash-manifest.mjs` generate/publish/verify + auto-run
after every electron-builder invocation; unpublished rebuild = loud
supersededBuilds history, PUBLISHED rebuild with different bits = hard stop
(exit 3, "bump moe.N" — convention now enforced); install-side diff via
`--only/--path`. Adversarial 3-lens/10-agent review CONFIRMED 7/7 findings
(critical: version-blind tree discovery bound moe.10-era mac bits into the
moe.18 manifest and could have spuriously hard-stopped a legitimate
`package:mac`); all fixed — trees are now version-checked by reading
package.json out of the asar (no new dep), drift merges instead of
replacing, a manifest-script crash can never fail a build (only the policy
stop can). Committed moe.18 manifest is honest: win set recorded (asar
verifies moe.18), both stale mac trees skipped (asar reads moe.10), 86-min
exe/tree staleness warning preserved. Guards 14/14; falsifiability proven
twice (hard-stop off → 1 fails; version check off → 2 fail). Full suite
1387 pass, typecheck+lint green, checklist row 8.8. OWNER: run
`pnpm release:manifest:publish` after shipping the demo build to arm the
gate._

_**Driver increment 2026-09-05 (morning): CLWX-84 credential-hygiene sweep
to Ready.** Picked 84 over 74 (74's remaining leg needs the live e2e draft
flow — Chrome attach-wedged, owner-gated; 84 was fully executable). All
three acceptance legs landed. LEG 1 (redact + forward): 12 plaintext hits
across SEVEN files (card said 5+) — the two live liaison logs, both
SHA-pinned archive copies, and three fleet-mailbox note files; a SECOND
credential surfaced during the sweep (a Raj temp password from 2026-05-22,
"Class B") beyond the known sandbox password. All redacted in place with a
chain-of-custody sidecar (before/after sha256; archive pin verified equal
to the before-hash and left unmodified):
`~/openclaw-agent/liaison-archive/REDACTION_2026-09-05_CLWX-84.md`. The
monitor writer (`raj-kiran-monitor.sh`) now pipes captures through a
shape-based `redact_creds` filter (LC_ALL=C, open-ended digit runs) before
both the log and the pushed mailbox note. LEG 2 (probe argv): the pilot CDP
probe carries recipient/subject/body via a BOM-less JSON temp file
(`--email-payload-file`, GUID name, unlinked right after read, ps1 finally
cleanup) — argv flags removed from BOTH the ps1 and the js, laptop-pack
mirrors resynced; error-path re-parse skips payload resolution so a
vanished file can't swallow the failure artifact; summary subject now
truncated to the 120-char floor. LEG 3 (gate):
`scripts/security-credential-grep.sh` scans ~/openclaw-agent +
~/fleet-mailbox for six credential shapes printing counts ONLY (never
matched text), env-indirection excusal scoped to the password-kv pattern
only; wired into PRODUCTION_CHECKLIST row 4.6 + the owner-sitting bucket;
live run RESULT: clean. Separate-lane 4-agent adversarial review (1 PASS /
3 FAIL) caught what mattered and all fix-now findings were closed same
tick: (a) CRITICAL — the first guard-test draft embedded both credentials
as trivially reversible bracket-class regexes (replaced with generic-shape
assertions); (b) MAJOR — `scripts/plane-board-export.mjs:78` had the Class
A literal embedded as its own REDACT_PATTERNS regex on this unpushed
branch (replaced with a generic word@NNNN shape, now guard-tested); (c)
probe error-path/lifetime/locale minors (all fixed). Guards 10/10; gate
clean; full suite 1401 pass + typecheck + lint green. RESIDUALS
(owner-gated, recorded in the sidecar addendum + card): fleet-mailbox
REMOTE TIP + git history still carry both classes (private repo; local
redaction committed as `4ad272b6` but master is ~459 behind origin — the
pull/push/scrub is the owner's, folds into CLWX-19); public clawx-pilot
still carries Class A in 3 files on pilot/main (CLWX-18, pre-existing);
row 4.1's git-grep now length-quantified so it means what it says. NOTE:
whatsapp-local/agent-comms MCPs were NOT connected in this session (tool
registry lacks both); not needed for this card._

_**Tick 2026-09-05 (ga-sprint-driver, minimal-time): CLWX-74 deterministic
recipient tier → Ready.** SENSE: tree clean @ a2e8e766; board == mirror;
static gate GREEN (5/0/1, report `docs/evidence/GA_GATE_2026-09-05.md`);
Chrome :18792 wedge RE-CONFIRMED with a REAL CDP attach probe (HTTP ping
200, websocket attach 10s timeout — 4th confirmation; pings alone remain
insufficient evidence, per standing rule); gateway/host-API down (app not
running — T1 needs an app start); gcloud not even on PATH (VM lane
unchanged, owner). ANALYZE: 74 ranked highest — its leg 2 was already
satisfied by c139ecc3's readable degrade, leg 1's button half by the N/C
shortcut fallback; the true remainder was field grounding: Body and
Subject had DOM-heuristic tiers, To/Cc/Bcc fell straight to VLM (dead on
credless boxes). ACT: `focusComposeRecipientField` added to
dom-heuristics.ts (self-contained/serializable; naming-attrs-only,
exact+prefix-only matching; send-button compose anchor with a
DEEPEST-ANCHOR discriminator) and wired into fillField before the VLM
tier; value typed with real keystrokes so picker/chips behave;
commitRecipientField unchanged; two-gate send + download hard-confirm
untouched. Separate-lane review (2 agents): send-gates PASS; heuristic
FAIL with a CONFIRMED major — the naive ancestor anchor is vacuous under
Outlook's single SPA root (jsdom repro: exact-labelled decoy outside the
pane beat the real prefix-labelled well) — fixed same tick via the
anchor-depth sort + 4 adversarial pins (SPA-root discrimination,
chip-text refusal, icon-only "Send (Ctrl+Enter)" anchor, 'search' deep in
a long well label). Falsifiability: sort flipped → exactly the
discrimination pin fails; restored → 13/13. Safety suite 84/84 incl. a
tier-order proof (grounder stays COLD while typeText fires). Board:
CLWX-74 → Ready with the honest leg-3 remainder (live credless-box e2e)
named as Chrome-restart-gated. Residuals on the card: forward() lacks a
post-fill recipient probe (pre-existing, CLWX-61 family);
aria-labelledby-wrapper wells are false negatives that degrade to the
readable error; multi-compose tie-break is DOM-order (pre-existing
class); tsx-lane dependence on the __name shim ordering documented._

_**Tick 2026-09-05 (ga-sprint-driver, minimal-time): CLWX-77 slice 1 — the
artifact-grade harness exists and is GREEN.** SENSE: static gate GREEN (5/0/1
T0, report `docs/evidence/GA_GATE_2026-09-05.md` refreshed); tree clean at
`211865e7`; board reachable (201s on the correct project path). ACT:
`pnpm harness:artifact` shipped (commits `19343f95` + review pass `8a57ff4b`)
— stages the shipped plugin source + the REAL gateway bundle
(`build/openclaw/node_modules`, APFS clonefile ~2s) in a temp dir OUTSIDE the
repo tree and runs each doc-type×command row in a child whose only dep roots
are the staged bundle via the `CLAWX_APP_RESOURCES` seam, closing the
test-the-workspace masking class (moe.15 canvas / CLWX-72 pdf-parse; moe.9
playwright-core is asar-side, stays with dependency-class-auditor). Fresh full
run: **14 rows — 9 PASS / 4 REFUSED-READABLY / 0 FAIL / 1 NO-TOOL**
(`docs/evidence/HARNESS_ARTIFACT_2026-09-05.md`). Negative control proven:
hiding mammoth in the STAGED bundle only flipped docx.read_docx to FAIL while
repo node_modules still carried it. Separate-lane adversarial review:
isolation SOUND (re-proven independently two ways), 3 MAJOR false-GREEN paths
found and FIXED same tick (infra outcomes — timeout/spawn/no-verdict — now
FAIL instead of grading REFUSED-READABLY, sentinel-framed verdict protocol;
--stage-dir reuse now refreshes the bundle every run with --reuse-bundle as a
loud opt-out; new png-sharp-binding row proves the shipped native binding
decodes). Guards 18/18; typecheck+lint green. Gap filed per acceptance 4:
**CLWX-101** (readDocx surfaces jszip internals for legacy .doc/.rtf — wrong
language for the principal bar). Card moves: CLWX-77 Todo → In Progress
(acceptance 1 substantially met for doc-tools; resumable trail on the card —
packaged-node parity, password/large pdf rows, outlook/forms registration
smoke, gateway transport, preflight wiring, K-ledger rows, Windows-lane run).
ANALYZE: no serial promotions; owner gates unchanged (Chrome :18792 restart
remains the single highest-value unlock). Ceiling respected: nothing moved to
Ready this tick._

_**Tick 2026-09-05 (ga-sprint-driver, minimal-time): CLWX-101 fixed +
review-hardened → Ready (`e737af5a` + `1a4f08bd`).** SENSE: tree clean at
`da5c220f`; board reachable (the .agent-token env var is `PLANE_API_KEY`, not
`PLANE_API_TOKEN`); owner gates unchanged, not re-probed (Chrome wedge is
owner-gated; pings are not evidence). ACT: readDocx now refuses non-docx
containers in principal language — container sniff (OLE2 → legacy .doc;
OLE2+EncryptedPackage → password-protected, the MS-OFFCRYPTO shared-magic
catch; `{\rtf` → RTF; non-PK → not-a-Word-doc; 0 bytes → failed-download)
each naming the cause + the way out, plus a renamed-format tier (.odt class)
and a catch-ALL damaged-or-incomplete fallback so raw jszip/xmldom text can
never reach the principal (error CLASS logged, never parser text). Harness
bar tightened: isReadableRefusal v2.1 (rejects URLs, "[xmldom error]"-style
tags, "@#[line:" artifacts), per-row refusalCheck in classifyRow, doc-legacy/
rtf/odt rows pinned to the new wording (old jszip text now FAILs them — pin
unit proves it), NEW rows docx-badxml + docx-password (hand-rolled STORED-zip
fixture builder, no new dep). Separate-lane adversarial review (3 lenses)
FAILed the first commit with two demonstrated MAJORs — the xmldom rethrow
leak and the password-docx "legacy Word 97-2003" misdiagnosis — both fixed
same tick with falsifiability proven on both passes (5 then 4 guards fail
with the fix stashed). Evidence: harness 16 rows — 9 PASS / 6
REFUSED-READABLY / 0 FAIL / 1 NO-TOOL (report regenerated in place); guards
41/41; full suite 1446; typecheck+lint clean. Board: CLWX-101 Backlog →
Ready with evidence; CLWX-77 commented (matrix 14→16, trail updated:
password-pdf row still open, pdf-corrupt's URL-free "Invalid PDF structure."
flagged as the next readable-refusal candidate). Same next-build gate class
as CLWX-99/100: the running app carries the old wording until a build ships
these commits. Owner asks unchanged._

_**Tick 2026-09-05 (ga-sprint-driver, minimal-time): CLWX-86 capability
handshake fixed + review-hardened → Ready (`1fba3f44` + `e6795d04`).** SENSE:
tree clean at `88518dd2`; board 200; owner gates unchanged (Chrome :18792
wedge not re-probed — owner-gated, pings are not evidence). ANALYZE: ranked
86 over a CLWX-77 sub-step (whole card retired vs partial advance; unit-
seamable, non-Chrome). ACT: tool↔host-API version-skew class closed — new
`capability-gate.mjs` probes ONCE at plugin registration (tier 1: new
authoritative `GET /api/capabilities` endpoint with app version + per-family
allowlist state, drift-triangle-guarded; tier 2 for legacy installs:
side-effect-free family GET probes — 405 present / 404-disabled allowlist
(NOT parked, kill-switch unchanged) / global-404 absent); all 18 host-API
tools gated at the facade seam — parked calls return principal-readable
"update the app" with ZERO HTTP (dispatch/download hard-confirm gates
untouched); indeterminate probes fail OPEN + re-probe (no false parks on
boot races); facade 404 handling flipped so only an explicit "capability
disabled" body keeps the allowlist wording — previously outlook/forms
misdiagnosed skew as disabled and browser leaked the raw "No route for POST
/api/browser/diagnose" (the card's verbatim moe.15 finding). Separate-lane
adversarial review (3 lenses, 1 PASS / 2 FAIL): deduplicated CONFIRMED MAJOR
— the index.mjs route maps were an unguarded third copy (a one-char typo
would permanently false-park a working tool with all tests green, proven by
mutation) — closed with an index.mjs drift-guard leg + 18-row tier-1
positive control + one-POST assertion; reviewer's exact mutation now fails
3 guards. Evidence: 44/44 across three suites; full suite 1469/6 skipped;
typecheck + lint green; falsifiability proven twice (wiring stash → 3 fail;
mutation → 3 fail). Board: CLWX-86 Todo → Ready with evidence. NEXT-BUILD
GATE (CLWX-99/100/101 class): running app + seeded plugin carry old behavior
until a build ships these commits; tier 1 ships app-side with the same
build, so current installs exercise tier 2 by design. Owner asks unchanged._

_**Tick 2026-09-05 (ga-sprint-driver, minimal-time): CLWX-64 forms
schema-drift detector → Ready (`4ba98d76`).** SENSE: tree clean at
`ab5960b1`; static gate GREEN (5/0/1, report refreshed); board mirror in
sync (101 issues); gcloud auth still BLOCKED (owner), :12222 listener stale
(VM TERMINATED), app not running locally; Chrome wedge not re-probed
(owner-gated). ANALYZE: §6 agent lane fully consumed (known drift); ranked
64 over CLWX-77 sub-steps / 83 / 87 / 91 (whole card, statutory-form
trust class, fully in-tree). ACT: new pure `schema-fingerprint.ts` —
fingerprints (count + sha256 of normalized ordered labels) STAMPED into
both driver-consumed schema JSONs and verified at fill time (stored-hash
integrity + live-structure match) BEFORE any fillField; refusals are
readable `__form_schema__`/`__form_structure__` rows; strict only on
definitive drift (missing unconditional question, order regression,
un-stamped schema edit) because a false park would brick the demo-proven
fill; re-stamp CLI `scripts/forms-stamp-fingerprint.ts` (idempotent,
referenced from refusal messages). Separate-lane adversarial review (3
lenses vs the REAL schemas + the recorded live traces): 3× PASS on
brick-the-demo (fresh-form simulation passes on both real forms); its
confirmed MAJOR — the CSS `[role="listitem"]` fallback matches ZERO
elements on the real page (implicit ARIA invisible to CSS), so the old
classification certified a dead fallback — closed with a 3-tier
`questionItemsLocator` (CSS union → Playwright role engine → automation-id
prefix variant) + checkbox aria fallback + trace-verified classification
pinned in units and the auditor doc; empty-live-list misreport,
short-label exemption, no-page throw, doc scope all fixed same tick.
Evidence: 24-row new suite + updated submit-gate stub (30/30);
falsifiability (label edit without re-stamp → 3 fail, restored green);
full suite 1493/6 skipped; typecheck + lint green. Board: CLWX-64 Todo →
Ready with evidence. Residuals on the card: live-form run of the gate is
Chrome-restart-gated; prefix-40 blind spot documented (no mis-map
follows); NEXT-BUILD GATE as usual. Owner asks unchanged._

_**Tick 2026-09-06 (ga-sprint-driver, minimal-time): CLWX-91 blank-window
e2e class root-caused + fixed → Ready; e2e tier wired into the gate;
baseline debt filed as CLWX-102.** SENSE: tree clean at `4854e8f3` (6
untracked pilot scripts/evidence dirs, known); static gate GREEN (5/0/1,
report `docs/evidence/GA_GATE_2026-09-06.md`); board reachable, mirror
delta = timestamp only; :12222 listener up but VM remains TERMINATED
(stale listener, not a lane); Chrome :18792 wedge not re-probed
(owner-gated, pings are not evidence). ANALYZE: agent-lane P = {83, 91,
77-substeps, 71}; ranked 91 (whole card + it feeds the CLWX-90 master
gate — the e2e tier was absent, which is why this debt class was
invisible). ACT: root cause CONFIRMED live via a console/pageerror probe —
the e2e ipc-mock fallback answers unmocked hostapi routes with `json: {}`;
`fetchProviderSnapshot` kept the truthy non-array (`?? []` can't catch
`{}`), and ChatInput's `pickAccountForChannel` useMemo threw
`e.filter is not a function` at render; the app ErrorBoundary swallowed it
into 'Something went wrong' — `main-layout` never mounts. Fix =
`asArrayPayload` boundary normalization in `src/lib/provider-accounts.ts`
(accounts + vendors; loud warn, never crash) — production-relevant (a
version-skewed Host API answering 200 with a non-array body blanked the
whole window the same way; CLWX-86 family). Evidence: 3/3 target specs
PASS (10.5s); new falsifiable unit suite (3 tests; 2 fail with fix
stashed, proven); units 1496/6 skipped; typecheck + lint green. Gate:
`GA_GATE_E2E=1` now runs `pnpm test:e2e` as a T0 row (default = loud SKIP
naming the baseline). Full-suite baseline run honestly: 32 green / 13 red
/ 2 skip — reds are PRE-EXISTING fork-decision drift (deleted locales ×5,
anonymised provider labels ×3, channels/app-smoke copy ×5), verified not
caused by this fix (failing cards render with data loaded); filed as
**CLWX-102** (Backlog) with per-class disposition notes. Board: CLWX-91
Todo → Ready with evidence. Owner asks unchanged (Chrome :18792 restart
remains the highest-value unlock)._

_**Tick 2026-09-06 (ga-sprint-driver, minimal-time): CLWX-92 In Progress →
Ready — the COMPLETED moe.17 VM verify evidence was on disk, untracked and
never synced.** SENSE: tree clean at `b639df65` (6 known untracked); board
re-exported, mirror in sync; Chrome :18792 + gcloud/VM lanes unchanged
(owner-gated, not re-probed per standing rule). ANALYZE: probing the
untracked evidence dirs caught a serial promotion — the 2026-09-03 entry
"moe.17 VM verify agent DIED mid-run" was superseded the SAME day by a
completed run (RESULT.md 15:07 + an independent same-day re-run addendum)
that nobody synced; CLWX-92's only remainder (in-app K10 PDF turn on an
installed build) is met by it. ACT (evidence promotion, no code): committed
`skills/laptop/evidence/2026-09-03-moe17-verify/` (RESULT.md + turn-evidence,
matching the moe16-verify convention; `logs/` stays local per the repo-wide
logs ignore — the decisive differential-repro lines are quoted verbatim in
RESULT.md) + the moe18-verify staged prep record (gcloud-block documentation)
+ the four pilot driver scripts that produced them; CLWX-92 → Ready with the
evidence comment — K10/A
fresh-session PASS (document.read_pdf toolCall + real 5-bullet summary,
verdict ANSWERED, zero workerSrc failures) confirmed TWICE (original +
independent re-run), ELECTRONLIKE differential repro PASS on the INSTALLED
moe.17 tree (`ELECTRONLIKE_VERIFY=PASS pages=1 chars=835` — the exact
moe.16 FAIL shape), guard wired inside verify-openclaw-bundle since
9619a920. Honesty notes carried onto the card: path-prompt + attachment-chip
mechanism (a literal drag-gesture variant stays a CLWX-77 K10 matrix cell);
the contaminated-session first attempt NOT counted; intermittent LEG A
hallucination caveat (fix itself holds); phantom-replay = CLWX-94 (fixed
2b21d2a8, VM re-proof pending); LEG B degrade addendum findings = CLWX-78/95;
the moe.18 full-matrix K10 row stays gcloud-gated (release verify, not this
card's remainder — moe.18 carries the same fix). Bonus facts mined from the
same RESULT: moe.17 silent-upgrade install PASS with state preserved and the
canvas native binding present (CLWX-72 holds on the upgrade path); CLWX-78
degrade notice rendered at 14.6s, anonymised. Owner asks unchanged._

_**Tick 2026-09-06 (ga-sprint-driver, minimal-time): CLWX-83 test-infra batch
→ Ready — all three legs landed review-hardened, and the new doctor caught a
LIVE stale pin on its first run.** SENSE: tree clean at `b6c990ae`; board 200,
mirror in sync; static gate GREEN (5/0/2-skip, report refreshed twice —
pre- and post-fix); Chrome :18792 + gcloud/VM lanes owner-gated, not re-probed
(standing rule). ANALYZE: agent lane P = {77-substeps, 83, 87, 71}; 87 needs
the TERMINATED Windows VM for System.Speech, 71 is post-GA with live-lane
acceptance legs; ranked 83 — whole-card retirement, fully local, closes two
repeat-burn classes. ACT: LEG 1 — the June-era combined-Outlook OOM does NOT
reproduce (vitest 4.1.1/Node 26.7: 11 suites/199 tests, 12.6s); heap bounded
via TOP-LEVEL `test.execArgv` after the review's empirical MAJOR proved
`poolOptions.forks.execArgv` is deprecated-and-IGNORED in Vitest 4 (the first
green was machine-default luck; a worker-side probe now proves the flag
reaches forks); named target `pnpm test:outlook`. LEG 2 — `pnpm lint:ps`:
pwsh 7.6.5 user-local (no sudo) + PSScriptAnalyzer 1.25.0 over the 50-file
windows-pilot surface, PSUseCompatibleSyntax pinned 5.1+7.0; review MAJORs
closed — statement-terminating analyzer errors (missing/malformed settings,
moved dir, zero files) used to print silent GREEN with pwsh exit 0; now
try/catch + input preflight + analyzed-file-count assertion, every path
fail-closed and proven live (ternary scratch → FAIL naming 5.1; settings
hidden → exit 2; malformed → loud fail; restored → GREEN 130/0-gating). The 2
pre-existing Error findings = scoped suppressions with justification, narrowed
from script scope to a helper per review. LEG 3 — repo pin audit CLEAN (6
tomls: no pins; 20 agent mds: all tier aliases); `pnpm doctor:agents` +
committed allowlist + 10-test guard in every `pnpm test`; the doctor found the
LIVE `gpt-5.3-codex-spark` pin still in ~/.codex/config.toml (the exact
finding-#4 model) — removed with backup, codex config re-verified parsing;
bonus audit fact: codex ≥0.153 refuses legacy [profiles.*] tables outright and
codex doctor flags none of it (9 dead tables WARN-only, owner fleet call);
review MAJORs closed — single-quoted/dotted-key/inline-table pins were
invisible (false-CLEAN on the spark model itself), frontmatter
trailing-comment/BOM/quoted-alias mis-parses, zero-surface CLEAN, symlink
no-op — all fixed with fixtures. Separate-lane 3-lens adversarial review
verdicts: 2 FAIL + 1 PASS-with-MAJOR, 4 demonstrated MAJORs, ALL fixed same
tick. Evidence: full suite 1506/6-skip (178 files); typecheck + lint 0
errors; falsifiability proven per gate incl. a bogus pin appended to a REAL
toml failing exactly 1 guard. Board: CLWX-83 Todo → Ready with evidence.
Register rows added: VITEST-OOM / PWSH-LINT-GAP / MODEL-PIN-STALE. Owner asks
unchanged (Chrome :18792 restart remains the highest-value unlock)._

_**Tick 2026-09-06 (ga-sprint-driver, owner-directive first): Codex
cross-model adversary lens WIRED + PROVEN on its first live run; CLWX-77
slice 2 (pdf password/large rows) landed; CLWX-83 review-hardened 5-for-5.**
SENSE: tree clean at `d79a89b9`; Chrome :18792 + gcloud/VM lanes owner-gated,
not re-probed (standing rule). OWNER DIRECTIVE: `/codex:setup` verified
`ready:true` (codex-cli 0.153.4, apiKey auth); the separate-lane review
protocol now has a codified §3b in the ga-sprint-driver skill — Claude lenses
required as before, Codex/GPT-5.5-family lens ADDITIVE (a Codex PASS never
overrides a Claude FAIL, no gate loosened, unavailable = proceed on Claude
lenses and say so); interop doc gained the dev-tooling layer row; plugin-plan
§1.4 acceptance MET. PROOF: one real `/codex:adversarial-review` on the
CLWX-83 diff (`--base b6c990ae`) — verdict needs-attention, 5 findings (3
high / 2 medium), Codex mechanically demonstrated two itself (comment-hidden
TOML pin `model = "x" # \"\"\"` skipped as multiline; `gpt-5.55-typo` active
pin passing without --strict). ALL 5 confirmed + fixed same tick: (1) lint:ps
+ doctor:agents wired into `preflight` AND ga-gate T0 (fail-open-by-omission
closed; PR-CI lint:ps step = named residual, unit guard already rides `pnpm
test`); (2) ACTIVE unknown user pins now FAIL by default while dead
[profiles.*] pins stay WARN (owner fleet call honored) — first live run then
caught REAL drift, top-level `gpt-5.6-sol`, verified live via codex exec and
allowlisted; (3) quote-aware comment strip + all-frontmatter-keys parsing
with duplicate-key failure + 3 regression fixtures (fix stashed → exactly 3
fail, proven); (4) `$ErrorActionPreference=Stop` + `-ErrorAction Stop` closes
the partial-analysis false GREEN (re-run GREEN 130/0-gating); (5) committed
worker-side heap probe (`clwx83-vitest-heap-execargv.test.ts`) — the ad-hoc
claim is now a durable per-run assertion. Evidence:
`docs/evidence/CODEX_ADVERSARIAL_REVIEW_2026-09-06.md`. CLWX-77 slice 2
(the trail's named next sub-step): readPdf now maps PasswordException /
InvalidPDFException / zero-byte to principal language naming cause + way out
(mirrors CLWX-101 docx tiers; parser text never reaches the principal, error
CLASS logged only); harness matrix 16→18 rows — NEW pdf-password
(REFUSED-READABLY) + pdf-large (>10MB, PASS 325ms), pdf-corrupt pinned to the
new wording (old "Invalid PDF structure." now FAILs it, proven by stash →
exact-row FAIL). Fresh full artifact run: **18 rows — 10 PASS / 7
REFUSED-READABLY / 0 FAIL / 1 NO-TOOL**
(`docs/evidence/HARNESS_ARTIFACT_2026-09-06.md`). Gates: full suite 1517/6
skipped (179 files); typecheck + eslint clean; doctor exit 0; NEXT-BUILD GATE
(CLWX-99/100/101 class): readPdf wording ships with the next build. Board:
CLWX-77 stays In Progress (trail updated: packaged-node parity,
outlook/forms registration smoke, gateway transport, K-ledger rows remain);
CLWX-83 stays Ready (hardening commented). Owner asks unchanged (Chrome
:18792 restart remains the highest-value unlock)._

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
- **moe.18 full-matrix verify RAN live on the VM (2026-09-06) — NOT ALL-GREEN.**
  Owner restored gcloud auth; VM started, tunnels rebuilt with the control leg.
  Steps 1–7 + K14 executed with screenshots + app-log evidence
  (`skills/laptop/evidence/2026-09-03-moe18-verify/RESULT.md`): install /
  launch / migration-headline / K10-PDF / K13-dir1-core all **PASS**; end state
  clean (hosts clean, ollama RUNNING, channel reasserted Online, banners
  cleared). **K13 direction 2 = PARTIAL FAIL:** the correct anonymised
  on-device-outage prompt fires ("the model on this device isn't responding →
  switch to Online"), but the generic `chat-run-error` component co-renders with
  online-centric copy that CONTRADICTS it, and its "Technical details" expander
  surfaces raw "Connection error." (no model IDs/cost/provider/IP — mildest leak
  class, opt-in — but the packet bar says NOT raw "Connection error."). Same
  stacked-banner behaviour seen in dir 1 (three error banners at once). This is a
  degrade-UX finding for the **CLWX-78 / CLWX-95** family (the Lane-A2 degrade
  path itself works; the run-error notice de-dup + channel-agnostic copy is the
  gap). K14 answered 5/5 with 0 raw errors but content-shallow — **NSCC pack
  proven ABSENT from the installed moe.18 tree** (CLWX-42 / gap P12). Steps 8
  (K11 email), 9 (K12 badge), the no-clobber leg, and the full trust sweep were
  **not run this session** — so ALL-GREEN is not achievable and the Karunesh
  handoff does NOT fire; those are the next tick. VM left RUNNING (owner testing).
- **moe.18 verify matrix COMPLETED + gate pulse caught live pin drift
  (2026-09-06 second tick).** The tick's SENSE gate run came back **RED**:
  `doctor:agents` FAILed on a fresh ACTIVE pin `gpt-6-astra` in
  `~/.codex/config.toml` (changed since yesterday's `gpt-5.6-sol`) — verified
  live via `codex exec` (returned "ok"), allowlisted, doctor exit 0, 13/13
  guards, **gate re-run GREEN 7/0/2** (`docs/evidence/GA_GATE_2026-09-06.md`).
  Second live catch by the CLWX-83 strict default in two days. Then the queued
  verify legs ran: **K12 PASS** (badge lifecycle truthful through kill→restart:
  connected pid 1836 → starting pid 3216 +8s, Reconnecting pill, disabled
  composer → connected pid 3216), **no-clobber PASS** (explicit on-device
  survived `ClawXApp`-task relaunch; migrationLogLines 1→1), **trust sweep
  PASS-with-the-one-recorded-exception** (D2). **K11 = new finding:** on-device
  qwen never reached the email tools' readable refusal — it hallucinated
  `read {"path":"C:\\openclaw\\workspace\\email\\…\\reply-to-next-meeting.tex"}`
  and looped it ~15× with no loop-breaker (zero outlook lines in the log; NO
  sends; K1/K5 tool-cascade class → strengthens the owner's trim-unhold call on
  7add864b); cloud-path K11 unverifiable on the VM (placeholder gateway) — that
  bar moves to the Mac live lane. Stale run-error banner persisted across new
  chats AND a gateway restart, clearing only on app relaunch (D0/D1 sharpened).
  RESULT.md matrix complete; VM RUNNING; board-mirror comment lag from tick 1
  still unreconciled (export drops newest comments — tooling defect to file).
- **Board-mirror "comment lag" ROOT-CAUSED — prior hypothesis falsified; 5 lost
  comments reconciled (2026-09-06 third tick, CLWX-103).** The "export drops
  newest comments" theory is WRONG: a full-board audit (live comment lists vs a
  fresh export, all 102 issues) found **0 mismatches** — `plane-board-export.mjs`
  and its pagination are faithful. The real defect: the token file
  (`~/issues-agent-runtime/plane/.agent-token`) also exports
  `PLANE_PROJECT=c6717c2c…` — the **GHIP** GitHub-sync project — and the tick-1/2
  posting one-liners built their URL from it. This Plane build **accepts the
  cross-project create** (201; row persisted with the URL's GHIP project_id
  while issue_id is CLWX) and every CLWX read path filters by project → the five
  moe.18-verify evidence comments (CLWX-42/78/83/92/95) existed in Postgres
  (deleted_at NULL) but were invisible/orphaned; direct GET by id under CLWX =
  404. Fix landed: `scripts/plane-comment-post.mjs` — the only sanctioned
  comment path (ignores `PLANE_PROJECT` with a warning, resolves the card under
  the CLWX project before writing, READBACK-VERIFIES detail+list after POST,
  exits non-zero "ORPHANED" otherwise; negative paths proven). Reconcile
  executed: 5 comments re-posted via the new script (readback-verified), 5 GHIP
  orphans deleted via API under their actual project path (5×204; DB live-row
  count 0), mirror re-exported and now carries the evidence. SKILL.md board row
  documents the trap. Filed as **CLWX-103** (In Progress → Ready after the
  separate-lane review). Raw probes + ids:
  `docs/evidence/CLWX-103_BOARD_COMMENT_ORPHAN_2026-09-06.md`. Separate-lane
  review ran ALL THREE additive lanes: Codex cross-model (gpt-6-astra,
  needs-attention, 3 findings all mechanically demonstrated — malformed-key
  credential leak via Headers.append, foreign-prefix cross-post GHIP-83→CLWX-83,
  stdin multibyte corruption; verdict verbatim in
  `docs/evidence/CODEX_ADVERSARIAL_REVIEW_2026-09-06_CLWX-103.md`), Claude
  lenses ×3 with per-finding adversarial verify (18 agents: 12 confirmed /
  3 refuted-with-evidence — incl. --file-value fallthrough to stdin,
  ORPHANED-vs-transient readback conflation, JSON.parse payload echo, dead
  "(!)" marker, docs-falsifiability gaps), and graph lenses (code-review-graph
  blast radius 0 changed functions/flows; scoped graphify AST graph confirms
  the poster's helpers have no external dependents). Every confirmed finding
  fixed same tick and re-proven (synthetic-key leak grep = 0, GHIP-83 refused
  exit 1, multibyte reassembly PASS, full negative-path battery green); the
  ORPHANED branch's proof is the Codex mocked-fetch run — recorded as the
  honest limit (a live re-proof would re-pollute GHIP). No gate loosened.
- **Run-error-dedup fast-follow LANDED as CLWX-104 → Ready (2026-09-06 fourth
  tick, owner-directed).** The moe.18 D0/D1/D2 degrade-UX findings are fixed
  at the display layer (degrade/failover logic untouched): D0 — loadHistory
  seeds/clears the red banner only for an ACTIVE own-send turn in this window
  (payload presence; idle-window reloads/session re-opens never repaint;
  mirrored into the dormant modular store copy); D1 —
  `errorBannerVisibility()` suppresses same-class transport banners only
  while the amber notice is EXPLAINING a failure (a success-claiming
  `resent:true` notice never suppresses and is cleared by a newer terminal
  error; auth-config/generic always show; error bar never duplicates the
  callout); D2 — transport-wrapper "Connection error." blanked from the
  Technical-details expander, `rawError=` fragments stripped, channel-neutral
  unreachable/rate-limited copy. Commits `f37ec9a6` + `4bdc2dcd`. The 3-lane
  review EARNED ITS KEEP: Codex (gpt-6-astra) reproduced 2 HIGHs on round 1
  (attachment-only own send's silent death became invisible — no in-line
  surface exists for empty-content error messages; a failed on-device resend
  hid behind the stale success notice) and the Claude lenses (18 agents)
  independently converged on both, plus the vacuous K12 row, the dormant-copy
  D0, untested D1 wiring, and an e2e pinning the forbidden behavior — ALL
  fixed same tick, mutation-probed (reverted seed-gate fails exactly the 4
  guard rows), e2e re-pinned and run live (1 passed). Full suite 1535/6-skip;
  gate pulse GREEN 7/0/2 at SENSE. Gap card filed: **CLWX-105** (in-line
  error chip for error-stopped messages — historical failures on re-open
  currently surface nowhere; active-turn failures always do). NEXT-BUILD
  GATE: live re-verify on the next cut's VM matrix. Evidence:
  `docs/evidence/CLWX-104_RUN_ERROR_DEDUP_2026-09-06.md` +
  `CODEX_ADVERSARIAL_REVIEW_2026-09-06_CLWX-104.md`.
- **CLWX-77 registration-smoke leg landed (2026-09-06 fifth tick) — artifact
  matrix 18 → 22 rows, full run GREEN.** New `register` child mode: the
  harness imports the STAGED plugin entry and calls register() with a mock
  gateway API collecting tool names; fetch is stubbed before the plugin loads
  (every attempt recorded + rejected — no socket), so the CLWX-86 probe
  deterministically fails open, listener-independent. Four rows pin the
  activation contract: full 31-tool inventory (set-equality + duplicate
  detection), skillAllowlist kill-switch (outlook family suppressed exactly),
  no-hostapi honest degradation, no-config early-return (BUG-012-adjacent).
  Commits `91f1c588` + `38fee5c6` (review hardening). 3-lane review: Codex
  2 MED both reproduced and closed same tick (async-crash-after-verdict
  graded PASS → foldChildExit discards framed verdicts on nonzero exit;
  assumed-closed port → fetch stub, re-proven with an ACTIVE listener
  receiving zero connections); Claude lenses 8 confirmed minors / 0 refuted
  (duplicate-registration hole, fast-lane inventory drift guard now parses
  index.mjs literals 31/31 in vitest, killswitch row, honest-coverage
  wording); graph risk 0.35 / 0 flows. 22 rows: 14 PASS / 7 REFUSED-READABLY
  / 0 FAIL / 1 NO-TOOL (`docs/evidence/HARNESS_ARTIFACT_2026-09-06.md`).
  Unit guards 39/39; gate pulse GREEN 7/0/2 at SENSE. Card stays In Progress
  — remaining trail: packaged-node/electron-env spawn parity,
  gateway-process transport, package preflight wiring, K-ledger rows,
  Windows-lane run.
- **CLWX-77 trail: FOUR of five remaining legs landed (2026-09-06 sixth
  tick) — matrix 22 → 45 rows, full run GREEN 30/14/0/1.** Commits
  `96da61f1` + `30a3d46f`. (1) ELECTRON-ENV SPAWN PARITY: every doc/register
  row runs an `@electronlike` twin (child fakes process.versions.electron +
  process.type='utility' pre-import — the packaged gateway's real
  utilityProcess shape, the CLWX-92/moe.16 failure env); `--node-bin` wired
  for packaged-node runs; falsifiability = setWorker fix neutered in a
  STAGED copy → electronlike row FAILs while plain node passes. (2)
  GATEWAY-PROCESS TRANSPORT: stage carries the FULL build/openclaw; rows
  boot the STAGED gateway CLI (plugins inspect --json) with hermetic
  OPENCLAW_STATE_DIR → the plugin loads through the REAL gateway
  plugin-host, toolNames pinned (13 no-hostapi / 31 full); staged-rename
  falsifiability proven. (3) PACKAGE FAST LANE: `--fast` (8 pinned rows)
  wired into the `package` script after verify-openclaw-bundle — every
  package/build/release path inherits it (8/8 PASS ~43s). (4) K-LEDGER:
  K8 intermittence rows (3× fresh children per shape, disagreement = FAIL
  INTERMITTENT, never averages out) + K10 tags + honest not-here mapping
  (K1/2/11/12/13 Outlook/VM lanes, K4 ASR, K9/14 in-app). Review lanes:
  **Codex needs-attention 3-for-3 confirmed + fixed same tick** (HIGH
  OPENCLAW_CONFIG_PATH bleed → env ALLOWLIST + checkTransportSource
  realpath stage gate; MED fast-subset silent shrink →
  validateFastSelection pre-spawn; MED respawn-survives-SIGKILL →
  OPENCLAW_NO_RESPAWN=1); graph risk 0.50 / 0 flows; graphify scripts/-scope
  corroborates containment. **Claude lenses IN FLIGHT at tick close** (3
  deep + 2 bounded spawned, none returned in-window — CLWX-58/70 stall
  class); no Ready move this tick so the before-Ready lens gate is intact.
  **RESOLVED SAME SESSION:** all three deep lenses returned post-sync —
  verdicts FAIL/FAIL/FAIL on 96da61f1; every surviving MAJOR fixed in
  `67543cd1` (falsifiability: the electronlike fake was UNVERIFIED
  PLUMBING — child now echoes the observed env and checkEnvShapeApplied
  FAILs an unapplied fake, neutered-fake probe re-proven; isolation: HOME
  → stage-local fake home so the real ~/.openclaw/workspace can no longer
  reach the plugin-load context on release builds, and the
  symlink-sensitive entry guard that silently skipped main() (exit 0, no
  output — with validateFastSelection trapped inside) is realpath-fixed
  and proven live; correctness: its config-bleed MAJOR confirmed already
  closed by 30a3d46f non-vacuously, Windows env allowlist completed).
  9 minors folded (spread order, stage-dir equality rm -rf hazard,
  note sanitization + home redaction, dangling fold note,
  networkAttempts>=1, net-stub load-sentinel REQUIRED, cp -Rc fallback,
  timeout knob, honest report prose); residuals recorded in the evidence
  addendum. Post-hardening gates: guards 66/66, full suite 1576/6-skip,
  typecheck+lint clean, fast 8/8, full matrix 45 rows 30/14/0/1. Evidence:
  `docs/evidence/CLWX-77_TRAIL_TICK_2026-09-06.md` (+ addendum). Card
  stays In Progress — remaining trail: Windows-lane run (NODE_OPTIONS
  backslash nuance recorded; un-stubbed Electron lane now fails loudly via
  the sentinel), in-app K10 drag-gesture cell.
- **CLWX-42 NSCC knowledge pack SHIPPED in-tree (2026-09-06 seventh tick) —
  Raj's clearest explicit ask + the K14 substance gap, built +
  review-hardened + live-proven on both lanes (`ae4779c5` + `d215ebe0`).**
  SENSE promotions this tick: **gcloud auth RESTORED** (instance list
  works — VM lane unblocked pending an owner VM-start spend decision);
  Windows RC VM is actually **TERMINATED** (the resume brief's "VM still
  RUNNING" is stale; :12222 is a dead local listener — SSH banner timeout
  proven); the local app IS running (gateway 18789 + host-API 13210 up).
  Gate pulse GREEN 7/0/2. WHAT SHIPPED: the content-verified nscc-2026.txt
  (sha256 e13fd290… = the recorded eval hash) inside the plugin dir;
  `principal.nscc_lookup` deterministic retrieval (top-8 passages ≤~12KB —
  the KR6 token-floor decision, NOT a bootstrap doc); persona steering
  (call the tool, cite the NSCC, never ask for the file, retry-then-report
  on a miss — never "the Code lacks it"); NSCC_EVAL_LANE=tool re-runs the
  stakeholder eval over the REAL retrieval; inventory contract 31→32
  consciously updated + re-proven through the mock-API row AND the
  real-gateway transport row. REVIEW: Codex needs-attention 2 HIGH + 1 MED
  all fixed same tick (excerpt truncation discarded scored tails;
  page-break split the 4-part suspension/expulsion safeguards; colloquial
  miss mislabelled as absent policy → synonym bridge + honest note);
  follow-on scoring fixes (informative-bigram df cut, corpus-frequent term
  down-weighting, heading-match bonus). EVIDENCE: tool lane 17/20 = 85%
  (floor 80) with 20/20 NSCC citations; context lane on the shipped file
  18/20 = 90% (identical rows to the 2026-09-03 baseline); deterministic
  fixture coverage 20/20; Q20 now PASSES on the tool lane (fails
  full-context — retrieval beats it there). Guards 105/105; suite
  1590/6-skip; typecheck+lint clean. Card stays In Progress on two named
  items: the Claude-lens verdicts (2 bounded reviewers in flight at tick
  close — the before-Ready bar; fold = next action) and the
  NEXT-BUILD/RESTART gate for the literal fresh-session in-app turn (the
  running gateway predates the tool; owner restart or next build).
  NEW OWNER ASK: start `clawx-win-rc-20260609` (spend, ~$0.13/hr) when
  ready to unlock CLWX-87 System.Speech + the CLWX-77 Windows-lane run —
  gcloud auth is no longer the blocker.
  **SAME-SESSION FOLD:** the Claude correctness lens returned FAIL on
  ae4779c5 (4 MAJOR) — all closed/corrected in `b547601b`: (1) the
  eval-only integrity assertion moved to the PRODUCTION path (broken data
  file → readable update/reinstall message, never "the Code doesn't cover
  it", never ENOENT/paths); (2) RECORD CORRECTION — Q20's police (39×) AND
  children's-authority (curly apostrophe, offset 89,320) key points are
  both IN the text; every straight-quote grep missed the curly form; Q20
  was a retrieval-ranking miss, now retrieving both halves and passing
  live; (3) 1-3-char terms word-boundary matched ("pe" noise); (4) the
  tool lane got its own honest system prompt (excerpts-may-be-incomplete —
  never "the NSCC lacks it"). Minors: TOC dot-leaders dropped, tiny
  fragments folded back, stale 31-tool doc pin → 32. Post-hardening: tool
  lane 17/20 = 85% SUSTAINED live, fixture coverage 20/20, guards 110/110,
  suite 1599/6-skip, typecheck+lint clean. Ready move still held on the
  principal-proxy trust-lens fold (review complete, report not yet
  relayed) + the next-build/restart in-app gate.
  **TRUST LENS FOLDED → CLWX-42 In Progress → READY (`ebe73bea`).** Its
  VETO (raw ENOENT + bundle path on a missing data file) was already
  closed by b547601b; its ADJACENT catch (find_school's unwrapped roster
  read — same class) fixed with the same readable message; its MAJOR (the
  NSCC steering could override the not-a-lawyer boundary on suspension/
  corporal-punishment questions) fixed in the persona — boundary applies
  unchanged, live-case/statutory questions get passages AND the
  district-office referral, persona guard added. All four review lanes
  complete (Codex 3, correctness 4, trust 2, graph 0-flows) — every
  finding fixed and re-proven. NEXT-BUILD GATE for the human close: one
  fresh-session no-file K14 question on the first build/restart carrying
  these commits. NOTEs on the card: ~+12KB per Code question (CLWX-43
  ledger), tool-lane page citations informational-only.
- **CLWX-87 WER bench built + Mac legs measured (2026-09-06 eighth tick,
  `610779dd`) — card Todo → In Progress.** Gate pulse GREEN 7/0/2; VM
  still TERMINATED (owner start = the unlock). WHAT SHIPPED:
  `scripts/clwx87-wer-bench.mjs` (pure word-level WER, 8 unit guards;
  deterministic `say` fixtures from `eval/fixtures/clwx87-asr-manifest.json`
  — 8 MoE/Trinidad-vocabulary clips, no committed audio; engines: whisper
  local / transcripts-file for the Windows leg / azure loud-skip exit 3
  proven) + `windows-pilot/scripts/pilot-asr-wer.ps1` (System.Speech
  synthesis + SHIPPED recognition, BOM-less JSON, STATE line, lint:ps
  GREEN). MEASURED: whisper tiny 13.5% / base 13.5% aggregate clean-audio
  floor; Trinidadian place names are the visible weakness ("Tuna Pune" →
  Tunapuna 30.8%); number-format artifacts recorded (fair between
  engines). Transcripts-lane wiring proven both directions (perfect stub
  0.0%, corrupted clip caught). Bundling-cost groundwork on the evidence
  (whisper.cpp tiny ≈75MB / base ≈142MB vs System.Speech 0MB). Suite
  1608/6-skip; typecheck+lint+lint:ps clean. Honest scope: review = unit
  guards + falsifiability probes only (test-infra, no production code, no
  Ready move) — the multi-lens lane runs at the Ready move after the
  System.Speech row. TRAIL: owner starts the VM → `pilot-asr-wer.ps1` →
  `--engine transcripts` grade → decision recorded; optional owner ask:
  Trinidadian-accent `source:"real"` rows. Evidence:
  `docs/evidence/CLWX87_WER_2026-09-06.md`.
- **Stale In Progress pile worked (2026-09-06 ninth tick, owner-directed
  "last real work was Sept 3"; `b159d13c`).** Classification of all 11
  In Progress cards: 87/77 active this session; 61/63 Chrome-gated (Sept 5
  authored); 39 (L4 operator sign-in) / 30 (Ministry values) / 31 (session)
  / 29 (trim-unhold) / 25 (KR2 acceptance) owner- or Ministry-gated —
  re-verified, no gate cleared, no comment spam added; 22 = anchor. The
  ONE agent-executable stale card was **CLWX-43** (last real work Sept 2):
  `scripts/clwx43-latency-mac-lane.ts` fired 3 demo-shaped REAL in-app
  turns over the CLWX-65 relay on the running install — routine no-tool
  **8.8s** (WITHIN the proposed p50 ≤15s), draft+write_docx **17.1s**
  (near budget) on gemini-2.5-pro, vs the ~103s VM baseline median. THE
  FIND: the read_pdf turn died silently TWICE — root-caused live as the
  installed app being **0.4.3-moe.10** (May build): the turn hard-kills
  the moe.10 gateway ~2min in (boot lines 16:31:46/16:38:20, no crash
  lines) — the fixed CLWX-72/92 class reproduced on the pre-fix install,
  silent-death surface = fixed-in-tree CLWX-78/104. No new card;
  corroborates the Monday-build ask (and this dev Mac needs the new
  install). Card stays In Progress: laptop-lane repeat now best on the
  NEXT BUILD, owner budget sign-off (today's numbers suggest the proposal
  is attainable), GA-packet row after sign-off. Evidence:
  `docs/evidence/CLWX43_LATENCY_MAC_LANE_2026-09-06.md`.
- **Owner gate flag folded (2026-09-06, `995ae457`):** the CLWX-42
  content-retention guard's 0.9→0.85 loosening left 4.7 points of slack
  (measured 0.897) — tightened to 0.89 AND replaced-in-spirit with a
  structural drop-only-noise assertion (every non-noise source line must
  survive into some passage; a dropped body line fails BY NAME).
  Falsifiability: a lossy splitter dropping 111 "suspension" body lines
  lands at ratio exactly 0.850 — the old floor passed it silently; both
  new guards catch it. Guards 46/46.
- **KR5 CHECKED + scorecard reconciled against the board (2026-09-06,
  owner-directed "KR5 ahead of any more cards"; `7d9fca04`).** The three
  G-outbox tests re-run **9/9** (durable + stubbed-persistence negative
  control, idempotent, drain incl. bounded-retry/backoff/concurrency);
  wiring re-verified in source (audit-first outlook/forms writes, boot
  drain main:603; landed `ebc4be75`, CLWX-28 Ready since 09-02). The
  GA_READINESS G10 row still said "designed, not built" — 4 days stale;
  fixed. Reconcile: KR1 (CLWX-24 Ready + moe.12/moe.17 in-app proofs),
  Ext-val A (CLWX-34 Ready) and the GA packet (CLWX-10 Ready) checked
  with inline evidence; Ext-val B annotated honestly (seq11 Cancelled;
  Karunesh moe.15 run = nearest evidence; qualifiers unmet → owner
  acceptance call); tag-time hygiene box annotated (cannot pre-check).
  **Product KRs 2/8 → 4/8; scorecard 6 checked; every remaining unchecked
  box is an owner/Ministry call or at-the-tag** — no agent-executable
  scorecard box remains.
- **CLWX-71 MCP adapter BUILT + live-proven; its review lane found and
  fixed a PRODUCTION two-gate hole (2026-09-06 tenth tick; `0d8b0fbb` +
  `1e3a9170` + `61fb895e`); card Todo → In Progress.** Built: stdio MCP
  server proxying the host-API's nine forms/outlook tools verbatim (gates
  stay server-side), env-only token + fail-fast, stderr counts-only
  logging, docs incl. the browser-MCPs-are-dev/debug-only warning, SDK in
  dependencies. Live: SDK-client handshake OK, 9/9 exact inventory,
  no-confirm send REFUSED end-to-end with the exact gate reason; moe.10
  realities recorded honestly (forms routes 404; Chrome-wedge read).
  **THE FIND (Codex HIGH, source-confirmed):** sendEmail's
  current-reviewed branch dropped args.subject and validate didn't require
  one — bare `{confirm:true}` sent the open draft with NO second-gate
  check (in-app reachable too). Fixed 3 layers (required assertion +
  snapshot match + click-time DOM filter); legacy tests that encoded the
  vulnerable contract updated; safety 87/87; register row
  SEND-GATE-SUBJECT-SKIP; NEXT-BUILD gate. Codex 5-for-5 closed (unknown-
  outcome + cancellation on mutating tools, key-name log hygiene, exact-
  reason gate proof, token-free launcher — no argv secret). Suite
  1627/6-skip; typecheck+lint clean. Remaining for Ready: sandbox positive
  legs + Claude-Code client leg + full lenses (Chrome/build/operator-
  gated). NEXT QUEUED: CLWX-105 (in-line error chip).
- 2026-09-06 thirteenth tick (gate probe honesty, CLWX-90): the health pulse
  itself was the finding. `GA_GATE_STATIC=1 pnpm ga:gate` came back GREEN (7
  pass / 0 fail / 2 skip) with T2 reading "IAP tunnel up - run the V-batch
  workflow" - while the same tick's SENSE probes showed `gcloud compute
  instances list` demanding reauth. Control leg: `nc -z localhost 12222`
  succeeded, real ssh returned `kex_exchange_identification: read: Connection
  reset by peer`. So the gate's VM row was a FALSE-GREEN: `nc -z` proves only
  that a LOCAL listener is bound, and a tunnel with dead credentials keeps that
  listener up while resetting every connection - nc false-POSITIVES, the inverse
  of the known Windows-Firewall false negative. A GO/NO-GO reader takes that row
  as "VM surfaces are runnable"; they are owner-blocked. FIXED @ `578b23de`:
  three distinguishable states (handshake verified -> INFO; bound but handshake
  fails -> SKIP "NOT USABLE ... BLOCKED, not available" naming `gcloud auth
  login`; no listener -> SKIP tunnel down) plus a PF-3 negative control that
  voids the verdict if port 9999 also answers. Falsifiability both ways: leg A
  (handshake pointed at a succeeding command) -> row flips to INFO "tunnel up,
  handshake verified", proving the BLOCKED reading is a real measurement and not
  a hard-wired skip; leg B (listener on 9999) -> row becomes "probe method
  UNTRUSTWORTHY"; script restored identical to the pre-mutation fix, diff vs
  HEAD removes only the old nc-only block, eslint clean. Gate after fix: GREEN 7
  pass / 0 fail / 3 skip - the extra skip is the VM row telling the truth.
  Register row GATE-TUNNEL-FALSE-GREEN added: this is the THIRD
  harness-integrity finding after VERIFY-VACUOUS-PACKAGES and
  PROBE-STEERS-PAST-DEFECT, and the pattern is now explicit - the harness, not
  the product, and each one made a GO/NO-GO row read greener than the truth. The
  repo already carried the right answer (`vm-verify-moe19.sh:100-116` control
  leg, three stale-`:12222` incidents in this file, PF-3); the gate was the one
  place never taught it, so the lesson was documented but unenforced where it
  decided a release. Also this tick: CLWX-95's carried residual re-examined and
  NOT closed - the main-process host-API routes cannot clear a session pin
  because the pin is keyed by a renderer-held session key the main process never
  sees, so that residual is architectural, not an oversight; recorded here rather
  than left implying an agent could just fix it.
- 2026-09-06 twelfth tick (late lens fold, CLWX-95): four lens verdicts arrived
  AFTER the first fold was committed, so they were triaged separately. ONE was a
  real hole and is fixed @ `f136dc01`: `runChannelPreflight`
  (`channel-router.ts:287`) passes no options to `applyChannelChange` — correct
  behaviour, nothing pinning it. The degrade route deliberately passes
  `{ skipGatewayRefresh: true }` (`settings.ts:129`) because it runs inside a
  failed turn the renderer resends at once; boot preflight is the OPPOSITE case
  (nothing refreshes the gateway after it), so a refactor copying that call site
  into the boot path would have left the four stores right on disk and the live
  gateway serving the old model — the silence-on-send shape itself — and shipped
  green. One row added; mutation proof: `{ skipGatewayRefresh: true }` at :287 →
  exactly that row failed (1/14), source restored byte-identical → 15 passed;
  four related suites 39 passed; typecheck + eslint clean; no product code
  touched. The other three closed without new code, each with a reason rather
  than a pass: trust-lens HIGH (15s silent wait) was ALREADY fixed @ `a4282f1a`
  and that lens reviewed `ce7d7ba2..HEAD`, a range predating it (stale window);
  its MEDIUM (two error surfaces) REFUTED against `errorBannerVisibility`
  (`src/lib/error-display.ts:70-85`, tested in `error-display.test.ts`) which
  suppresses transport-class banners behind a notice that does not claim
  success, auth-config deliberately excepted; its ask to shorten the 15s cutover
  budget DECLINED with evidence — the silence was the defect, not the duration,
  and the moe.19 VM needed minutes for the gateway's first post-restart RPC on 4
  vCPUs, which is why background reconcile already runs the short 3s budget
  (`RECONCILE_PATCH_TIMEOUT_MS`) against the 15s foreground one
  (`SESSION_PATCH_TIMEOUT_MS`); its LOW (both notices advise retrying) accepted
  as open copy judgement for the CLWX-105 pass. Coherence lens ACCEPT/YELLOW
  with its race largely superseded by the acknowledged-cutover readback — watch
  item carried: re-check Windows port-race recurrence on moe.20+. The CLWX-105
  trust FAIL was already folded (tense-neutral `errorDisplayInline.*`). CLWX-95
  STAYS In Progress for the same two unchanged reasons: unit-level proof only,
  and `electron/api/routes/settings.ts` (~:86-88, :182-184) still does not clear
  session pins.
- **CLWX-95 review lane CLOSED — both remaining Claude lenses triaged, every
  confirmed finding fixed and mutation-proven (2026-09-06 eleventh tick;
  `c46b141e`); card deliberately stays In Progress.** Verdicts: lens-code
  **FAIL** (2 HIGH / 3 MEDIUM / 2 LOW), lens-refute **SURVIVED with gaps**.
  Neither lens disputed the cutover mechanism — the acknowledged
  `sessions.patch` is genuine post-write re-resolution and the confirmation
  gate fails closed. Every confirmed finding was about the pin's **scope**:
  HIGH-1 an explicit channel pick cleared only the current session while the
  once-per-run memo blocked every OTHER session from repairing itself (fix:
  `clearSessionModelPin` resets the whole memo); HIGH-2/refute-C the pre-send
  reconcile could delete the pin the degrade had just installed and replay onto
  the provider that just failed under a notice saying otherwise (fix:
  `_degradeResendInFlight` fence + post-cutover provider-snapshot refresh);
  refute-E a pre-write memo burned the session's one attempt against a merely
  restarting gateway (fix: success-only memo, `RECONCILE_MAX_ATTEMPTS=3`,
  in-flight guard); MEDIUM-3 composer pill and Settings read "Online" over an
  on-device runtime (fix: new `runtimeChannelPin` — a FACT about the runtime,
  set only on a proven cutover, deliberately NOT the dismissible degradeNotice
  and never written to `preferredChannel`); MEDIUM-4 Providers "Set as default"
  didn't clear the pin (fix + a **source-discovered contract row** that walks
  `src/` and fails if any future `setPreferredChannel`/`setDefaultAccount`
  caller omits the clear); MEDIUM-5 a 15s blocking write in front of the run's
  first send, invisible to the 30s and 90s watchdogs (fix:
  `RECONCILE_PATCH_TIMEOUT_MS=3s`, cutover keeps 15s, both budgets asserted);
  LOW-6 pin/resend targets resolved independently; refute-B `restoreHint`
  promised an automatic Online return that nothing implements (copy now says
  what is true). **Carried openly on the card:** LOW-7 (fixture ref shape —
  cosmetic, the gate compares ack to request) and refute-A (the gate is blind
  to an allowlist rewrite mapping a ref onto itself — inert today, re-arms if
  an allowlist is added). Falsifiability: **9 code mutations + 1 contract
  mutation, applied one at a time against pristine copies, each caught,
  sources restored byte-identical**; the harness ack now ECHOES the requested
  ref, so M7 (swap provider/model inside `cutoverSessionModel`) fails 9 rows
  where it previously failed none — closing refute-D's vacuous-ack gap. Rows
  37→48 (degrade) and 16→18 (chat-input); full suite **1697 pass / 6 skipped /
  186 files**; typecheck + eslint clean. **Not Ready, for two unchanged
  reasons:** the proof is unit-level only (a runtime-cutover defect needs a new
  Windows build on the VM, parked behind owner-only `gcloud auth login`), and
  the main-process host-API channel routes (`electron/api/routes/settings.ts`)
  still change the channel without clearing session pins — all *renderer*
  surfaces are covered as of this commit.
- **Stakeholder-gap fold: 11 cards filed, and the board grew a sanctioned card
  creator (2026-09-06 eleventh tick).** `docs/STAKEHOLDER_GAP_ANALYSIS_2026-09-06.md`
  §5 proposed 12 cards; the 11 unconditional ones are now agent-filed
  **Backlog** rows — **CLWX-106** ga:gate skip-fail semantics (high),
  **CLWX-107** Monday demo dress rehearsal (high, time-sensitive),
  **CLWX-108** Mac RC cut (high, owner-only steps inside), **CLWX-109** AI Tool
  Usage Agreement conformance (high), **CLWX-110** 20-principal rollout answer
  to Raj, **CLWX-111** forms corpus inventory, **CLWX-112** email-roadmap
  review, **CLWX-113** KR3 offline re-run, **CLWX-114** DOCSEARCH
  repro-or-disposition, **CLWX-115** RAJ-2 fidelity fixture, **CLWX-116**
  Minister/2000-laptop disposition (low). Item 12 was deliberately NOT filed —
  it is conditional and already carded as CLWX-49/56, so it is recorded there
  as a pull-forward flag instead of a duplicate. Fold status table appended to
  the gap doc §5b. **New tooling:** `scripts/plane-card-create.mjs`, sibling of
  `plane-comment-post.mjs` and carrying the identical safety contract —
  `PLANE_PROJECT` IGNORED (the GHIP cross-project trap that swallowed five
  comments), key-format validation + output scrubbing, 429 backoff,
  pagination, **title de-dup against the live board (SKIP and name, never
  merge)**, refusal to create into a completed/cancelled state so a fold cannot
  fabricate closed work, and a per-card readback verify (fetch by id AND
  present in the list) that reports an orphan rather than assuming success.
  Dry-run first, then 11 created / 0 duplicates, every one readback-verified.
  **Note for the owner:** CLWX-106 says the gate can score GREEN while a
  required tier SKIPs entirely — so CLWX-90's Ready describes the harness, not
  the coverage.
- **moe.19 verify findings carded and registered (2026-09-06 eleventh tick,
  same sync).** The RED row from the moe.19 VM run that had no card is now
  **CLWX-117** (Backlog, high): an on-device turn **parks forever** on a
  top-level `sessions_yield` — bubble appears, one execution step, then
  `answerText: null` / `settled: false` / no notice / no error; the 300s verdict
  came from the *driver's* budget, not from the product terminating. Model ruled
  out (direct ollama generate on the same guest and model answered in 8.2s with
  0.1s decode; the process held 58 CPU-**seconds** of lifetime CPU). Cause:
  `sessions_yield` is sub-session plumbing that hands control to a *parent* —
  the renderer models it that way at `src/pages/Chat/task-visualization.ts:147`
  — and at top level there is no parent, so the loop never terminates. This is
  the **non-self-recovering** variant of the tool-cascade class (the earlier
  residual was a spurious `exec`, which self-recovers and was triaged
  cosmetic). Fix layers named, none executed: trim session-control tools from
  the on-device catalog (that work already sits on the owner-held
  `fix/tool-catalog-trim` @ `7add864b` — commented on CLWX-29, **not**
  unheld), a **terminal** turn watchdog (recommended into CLWX-47: 30s
  reassurance is this card's existing scope, but an unterminated turn needs a
  hard bound, and a reassurance notice on an unbounded turn makes the app look
  *more* broken), and a persona instruction as defence in depth.
  **The transferable finding is the harness one:**
  `windows-pilot/scripts/pilot-electron-cdp-probe.js:342` instructs the model
  not to use `sessions_yield`/`sessions_spawn`/subagents — steering that lives
  ONLY in a test probe, not in the product persona. Every eval through that
  probe was steering the model *away* from this defect instead of measuring it,
  while a principal typing an ordinary question is unprotected; the stall
  surfaced only because this run's driver carries no such instruction. Same
  shape as the `skipGatewayRefresh` dead-code lesson. Register updated with
  four delta rows + one group-A row (A: 11 → 12, and CLWX-117 is the only one
  of the twelve that is a plain product defect with no owner/Ministry gate in
  front of it): ONDEVICE-YIELD-STALL, PROBE-STEERS-PAST-DEFECT, **K10
  re-classified FAIL-as-seen but INVALID as an *Online* test** (both runs had
  already auto-degraded to on-device, so the run does not test the path the K10
  fix targets — and the earlier CDP-viewport legs had scored the same turn
  `ANSWERED`, which is precisely why the desktop-screen VLM leg exists), and
  VERIFY-VACUOUS-PACKAGES (our own verify scraped the package list by regex
  from a file that only *imports* the constant → `all present (0 checked)`
  logged as a PASS; fixed @ `30f97164`, verified in-tree at
  `scripts/vm-verify-moe19.sh:168-175`, an empty list now FAILS). Also
  commented: CLWX-42 (the NSCC pack is present on the *installed* moe.19
  tree — ship leg has installed-binary evidence; Windows retrieval turn still
  owed, and the caveat above is recorded on the card), CLWX-49 + CLWX-56
  (pull-forward flag for gap item 12 instead of a duplicate card).

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
