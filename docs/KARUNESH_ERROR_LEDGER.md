# Karunesh error ledger — every error he ever reported, and the test each one owes us

*Compiled 2026-09-03 from the full WhatsApp history (2026-05-01 → 2026-09-03,
192 messages) plus his attached test documents. Owner directive: "create a
collection of every error we ever had... include all of it in our testing
criteria." Each ClawX row derives a criterion for the artifact-grade matrix
(CLWX-77) / regression suites. Liaison rule respected: his VIDEO-generator QA
is a SEPARATE project — those rows are tagged and pointed at the video
tracker, never folded into ClawX criteria.*

## A. ClawX errors (chronological) → derived test criteria

| # | Date | What he hit (his words where short) | Class / today's card | Status | Derived test criterion (must live in the suite) |
|---|---|---|---|---|---|
| K1 | 06-05 | "Chrome MCP existing-session attach failed for profile 'user'" on first install | CDP attach / onboarding; ancestors of CLWX-73/74 | Path redesigned since (chrome-cdp repair), but repair falls to managed profile (CLWX-73 OPEN) | Fresh-box scenario: Chrome installed but NOT running with the debug port → app surfaces a principal-readable instruction; NEVER a managed-profile sign-in for tenant flows; email tools degrade readably |
| K2 | 06-09 | Same attach failure on the updated build ("same issue with accessing the emails") | Same | same | Regression rerun of K1 on every RC (it recurred once already) |
| K3 | 06-09 | PASS baseline: install, online default, gateway ~2 min, file scan + email read OK | — | — | Keep as the smoke baseline: install→first-turn→file-scan→email-read must stay green on every RC (Ext-val B shape) |
| K4 | 06-22 | Voice note failed: `clip-input.wav (raw audio; ffmpeg ffmpeg-not-found)` | ASR packaging; CLWX-20 | FIXED (ffmpeg bundled, moe.12+); Windows ASR proven ASR_SMOKE_OK 09-03 | Voice-note transcription e2e on the PACKAGED build (both OS) stays in the matrix — the fix regressed from a packaging change once already |
| K5 | 06-23 | "Reverted to the original issues" after an update | Release regression | — | The known-failure regression matrix (ga-e2e-regression) runs on every RC — no fix ships unguarded |
| K6 | 06-23 | "Replying: the body is placed on the To: field" + "the email being replied to is moved to the archive folder" (+ Reply Function Errors.docx) | RAJ-3/RAJ-4 family; CLWX-34 | RAJ-4 FIXED-verified `a8322ad9`; RAJ-3 refuted (targeted scenario) | v2-eval W5.1 + raj3-reply-archive-check + recipient-well classifier tests stay pinned |
| K7 | 06-23 | Demo day: "everything was working besides the reply feature" | Reply flow | fixed since (see K6) | covered by K6 rows |
| K8 | 06-30 | "SOMETIMES the agent reads the pdf documents well and other times it gives an error... same behavior when we make requests to create word or excel documents" | **Earliest signal of the CLWX-72 class** (load-path-dependent parser resolution) + write flakiness | Root-caused 09-03 (canvas binding + masking); fix layers landed | INTERMITTENCE criterion: doc read/write exercised REPEATEDLY (≥3×) per run on the packaged runtime, from every load context (chat turn, host-API, cold gateway); CLWX-77 matrix + verify-openclaw-bundle gate |
| K9 | 07-21 | `ClawX Agent Tests.zip` — Raj's 5-prompt Ministry suite scored 0/5 | KR1 origin; CLWX-24 | KR1 in-app PASS (moe.12); Prompt-Tests fixed | The 5-prompt suite is a permanent regression fixture (in-app, packaged build), not a one-time gate |
| K10 | 09-02 | "Error when trying to read PDF Document" (NSCC-2026.pdf; log + screenshot) | CLWX-72 | Fixed-in-tree + artifact-verified on the VM; moe.16 re-verify owed | Drag-PDF→summarise on a FRESH INSTALL joins the release smoke; scanned/protected/large PDF variants in CLWX-77 |
| K11 | 09-02 | Email send chain: "trouble locating New mail" → "saved draft without a recipient" → timeouts | CLWX-70 litter + CLWX-74 VLM-creds + CLWX-58 recovery | Litter swept (14 drafts); recovery + creds fixes carded | Draft/reply/send e2e run on a mailbox SEEDED WITH LITTER (stale draft + confirm dialog + docked chip) and on a box with NO AWS creds — both must pass or refuse readably |
| K12 | 09-02 | Red "Disconnected" badge while turns visibly worked (2 screenshots) | CLWX-75 | OPEN | UI-state assertion in the recorded use-case harness: header badge must agree with gateway/turn state through a full turn |
| K13 | 09-02 | On-device turns dead: `ollama ... Connection error.` ×6 + no failover | CLWX-78 (degrade pattern) | Classifier fixed + regression rows; live re-verify owed | Degrade matrix: cloud-down→on-device AND on-device-down→cloud, on Windows, with the OpenAI-SDK "Connection error." surface specifically |
| K14 | 09-02 | His 5-prompt matrix result: a,b,d,e Worked / c Failed | External tester matrix | — | His exact 5 prompts become a named fixture (karunesh-matrix) run per RC alongside Raj's suite (K9) |

## B. Video-generator QA (SEPARATE project — do not fold into ClawX criteria)

His videgen reports (2026-08-09 → 08-25 test docs; tracked in the video
project's VIDEO_QA_TRACKER, not here): narration mispronounces large numbers
and many-decimal values (0.00075, 86,465); fractions render merged or not at
all; alignment/contrast/readability issues (partially fixed across builds);
animation coverage thin on longer videos; long-form prompts flow well with
element-positioning issues. Fixture docs: `Test 1..7 — *.docx` (2026-08-25
batch converted under `~/openclaw-agent/inbound-docs/`).

## C. How this feeds the suites

1. **CLWX-77 (artifact-grade matrix)** — rows K1, K8, K10, K11, K13 define
   matrix cells; the intermittence rule (≥3 repetitions) and the
   seeded-litter mailbox come from this ledger.
2. **ga-e2e-regression known-failure matrix** — every FIXED row (K4, K6, K9,
   K10, K13) is a pinned regression with its named script/eval row.
3. **Release smoke (Ext-val B shape)** — K3's baseline + K14's five prompts
   run on every RC before it reaches a tester.
4. **Recorded use-case harness** — K12's UI-state assertion.

*Nothing in this ledger contains credentials or message bodies beyond the
error text itself. Chat source: local bridge store; evidence files in the
liaison archive.*
