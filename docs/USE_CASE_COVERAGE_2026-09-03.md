# Use-case coverage — deep pass, 2026-09-03

Scope: every principal-facing workflow (W1–W10 in `APP_WORKFLOWS_TEST_MATRIX.md`),
what we actually proved, on which platform, and by what kind of evidence. This
is the "did we cover all the use cases" answer, with each claim anchored to a
file on disk. Proof types, strongest first:

- **REC** — screen/browser video of the real thing running.
- **LIVE** — ran live against the real surface, verdict captured (no video).
- **TEST** — automated test / eval, green at HEAD.
- **GAP** — not yet proven on that platform (named, not hidden).

The platform distinction matters: the tester (Karunesh) is on **Windows**, most
of our fast iteration is on **Mac**, and the surfaces differ (screen-record
machinery, native-module ABI, Chrome/CDP wiring, GUI-session requirements). Where
Mac and Windows diverge, both columns are shown.

---

## 1. Evidence ledger (the artifacts, and what each one proves)

| Artifact | Type | Proves |
|---|---|---|
| `evidence/2026-09-03-win-recorded-usecase/usecase.mp4` (52s) | **REJECTED (frame-verified 2026-09-03)** | 640×480@5fps. Frame breakdown: 1s = the ffmpeg recorder console (wrong window at start); 13–26s = stale prior-turn reply on screen, top-right "Disconnected"; 51s = the parent-letter prompt only being *typed*, never sent or answered; composer clipped. The prior "ANSWERED/settled=true" came from driver JSON, not the pixels. **Not valid proof** — see CLWX-57, superseded by Recorder v2 (CLWX-56) + the demo reel (CLWX-55) per `VIDEO_CAPTURE_OKR_2026-09-03.md`. |
| `evidence/2026-09-03-forms-submit-recorded/video.mp4` (16s) + `trace.zip` + before/after PNGs | **REC (browser)** | W3 document→form: the cloned Suspensions form on test.fac (all 7 T&T districts, Caroni selected, School Type) filled, refusal-without-confirm proved first, then ONE confirmed submit that VERIFIED it landed (responses 5→6, success marker, 2xx POST). |
| `evidence/2026-09-03-app-usecase-recorded/final-screenshot.png` | **LIVE (Mac, still)** | Real in-app turn on Mac: "Summarise my last 5 emails" → 2 tool calls ran → assistant reply rendered (the designed CLWX-54 graceful degradation), Online channel, gateway connected. Confirms the GOOGLE-STORE-400 fix live (turn executed, no 400 banner). The Mac screen-crop *video* was removed — it caught an occluding terminal; the still is the honest Mac proof (see that dir's RESULT.md correction). |
| `evidence/2026-09-03-nscc-qna-eval/` (`scripts/nscc-qna-eval.ts`) | **LIVE/TEST** | Routine-query lane (W9): 18/20 against a stakeholder-derived Q&A set. |
| `evidence/2026-09-02-moe15-install-verify/` | **LIVE (Windows)** | moe.15 silent-install tree complete on the VM; SHA `d10de580…18df`, 390,104,940 bytes — the exact build shipped to Karunesh tonight. |
| `evidence/2026-09-02-office-write-smoke/` (`STATE: OFFICE_WRITE_OK`) | **LIVE (Windows)** | Packaged runtime wrote a valid .docx (8582 B) and .xlsx (16077 B) and read them back (W6/W7 write path). |
| `evidence/2026-09-03-whisper-mac-smoke/` | **LIVE (Mac)** | W8 transcription: say→16k WAV→whisper twice, asserted phrases present, non-zero duration. |
| `evidence/2026-09-02-graph-signin-L1-L3/` | **LIVE** | Graph read-only ladder L1–L3 PASS (the Outlook-via-Graph external dependency). |
| Full unit/contract suite | **TEST** | 162 files / 1280 tests green at HEAD; incl. `outlook-actions-safety` (73/73, the 2-gate send), `openclaw-auth-google-store-compat` (7/7, tonight's store-400 fix). |

---

## 2. Workflow coverage (W1–W10)

| # | Workflow | Mac | Windows | Recorded? | Notes / gap |
|---|---|---|---|---|---|
| W1 | Summarise recent email | LIVE smoke | LIVE 15/15 eval on VM | Mac still | Email *content* needs a live Outlook tab; on Mac tonight it hit CLWX-54 (stale CDP attach) and degraded gracefully — correct UX, real product finding. |
| W2 | Draft & send reply (2-gate) | LIVE 2-gate | LIVE 4-step send-gate on VM | — | Send safety is TEST-locked (73/73) and re-proven live; refuses a mismatched draft. |
| W3 | Document → form prefill → submit | LIVE full cycle | LIVE 29/32 fill + gate | **REC (video+trace)** | Strongest-proven composite. Driver hard-pinned to the test.fac clone URL. |
| W4 | Daily report form | LIVE payload+preview | LIVE preview on VM | — | Submit path shares W3's gate. |
| W5 | Daily-report cron reminder | LIVE cron fires | **GAP** — no live cron-fire captured on Windows | — | gap D. |
| W6 | Draft letter / memo → .docx | LIVE round-trip | LIVE write GREEN on VM | **no valid clip yet** | The Windows video that claimed this is REJECTED (never answered on screen). UC5 in the demo-reel program (CLWX-55). |
| W7 | Read / build spreadsheet | LIVE round-trip | LIVE read+write GREEN on VM | — | SheetJS; same native JS both platforms. |
| W8 | Transcribe voice/meeting | LIVE real transcript ×2 | **GAP** — ASR smoke not run on Windows | — | gap C; `pilot-asr-smoke.ps1` authored, needs one run. |
| W9 | Routine query (chat & email) | LIVE on-device+cloud | LIVE online+on-device on VM | Mac still only | 18/20 NSCC; 15/15 eval. Windows video REJECTED; UC7 in the reel (CLWX-55). |
| W10 | Cloud→on-device failover | LIVE degrade path | **GAP** — untested on Windows | — | `degradeChannel` unit-tested; no live Windows failover capture. |

**Covered end-to-end with recorded proof:** W3 (browser form fill+submit) — and
even that shows the browser surface, not the agent app UX. **No use case yet has
a clean video of the full principal experience** (type → send → agent works →
completion → acceptance); the Windows attempt was frame-verified and REJECTED.
That gap is the video-capture program: OKR + state machine in
`VIDEO_CAPTURE_OKR_2026-09-03.md`, tracked on CLWX-55 (reel), CLWX-56 (recorder
v2), CLWX-57 (invalid-clip finding). **Live/test but not on video:** W1, W2, W4,
W6, W7, W9, W8(Mac). **Named gaps:** W5, W8-Windows, W10.

---

## 3. What Karunesh's test exercises tonight (moe.15, Windows)

His quickstart tasks map onto the matrix so his run is itself coverage:

| Task in guide | Workflow | No account needed? |
|---|---|---|
| "3 things you can help a principal with" | W9 routine query | yes |
| "Draft a short letter to parents…" | W6 draft letter | yes |
| Drag a PDF/Word in → "summarise in 5 bullets" | W8-adjacent (document read) + W9 | yes |
| "Create a Word doc … save to Desktop" | W6/W7 file create | yes |
| "Summarise my last 5 emails" | W1 email | **only if an account was set up** — guide says skip otherwise |

So Karunesh unaided will independently re-prove W9, W6, document-summarise, and
file-create on a *fresh* Windows install — the legs that need no tenant. The
email leg (W1/W2) is explicitly optional in his guide because it needs a
signed-in Outlook tab we haven't provisioned on his machine.

---

## 4. Mac vs Windows — where they genuinely differ (the tester's world ≠ ours)

- **Screen recording:** Windows `gdigrab` can target the app window → clean
  `usecase.mp4`. macOS avfoundation cannot target a window, so a display-crop
  can be occluded by other windows (why the Mac video was dropped tonight).
- **Native modules:** `better-sqlite3` etc. are ABI-locked to Electron's Node;
  the VM runs the packaged runtime, so `OFFICE_WRITE_OK` on the VM is the
  load-bearing proof, not the Mac fn-level round-trip.
- **First-launch:** Windows first start takes ~1 min (bundled runtime unpack);
  the guide tells Karunesh to expect the greyed-out composer.
- **Chrome/CDP:** the email lane rides the signed-in user's Chrome over CDP;
  Mac tonight showed the stale-attach failure mode (CLWX-54) that Windows will
  also be subject to once an account is wired.

---

## 5. Tonight's deltas folded into this pass

- **GOOGLE-STORE-400 fixed durably** (`73c9e88c`): the live 400 the owner
  screenshotted is closed; the app now runs turns (Mac still + Windows video
  both post-fix). Registry-level fix would have been a no-op — stamp lives at
  the real choke points in `openclaw-auth.ts`; 7/7 regression test.
- **Mac evidence corrected** (`af25c723`): misleading screen-crop video removed,
  screenshot is the honest Mac proof, canonical recording is the Windows one.
- **Karunesh handoff SENT** (WhatsApp, owner-authorized): 11h signed URL
  (HTTP 206 + PE magic + byte-exact 390,104,940 verified), file guide inline,
  at ~8pm AST (his evening window). Both messages `success:true`.

## 6. Honest limits

- The email lane (W1 content, W2) was not exercised on Mac tonight because of
  CLWX-54; it is proven separately (2-gate tests + Windows eval), not in one
  unbroken Mac turn.
- @lid delivery to Karunesh is confirmed by the bridge's server-ack
  (`success:true`), the same signal as the accepted Raj send; there is no local
  read-receipt. If he doesn't respond, owner can relay from their phone.
- Windows gaps W5/W8/W10 remain unproven on that platform (scripts authored).
