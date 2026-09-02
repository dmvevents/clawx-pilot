# Karunesh guided test — moe.15 Windows external-tester run (2026-09-03)

**Audience: the OWNER.** This is the companion script for guiding Karunesh through the
moe.15 run and capturing evidence. The tester's own document is
[`docs/TESTER_QUICKSTART.md`](./TESTER_QUICKSTART.md) — do not resend its content in chat;
send the file. This doc adds what the quickstart deliberately leaves out: expected
results, live-answer notes, the two defect-closure re-tests, and the evidence filing map.

---

## 1. Context snapshot

**Who he is.** Karunesh Ramdass, Raj's son, external tester for the ClawX
principal-assistant (he also tests the separate curriculum-video project — never conflate
the two; nothing video-related belongs in this run). Technically strong: reads raw error
messages and self-diagnoses (he correctly hypothesized the Chrome profile attach failure
in June), reruns identical prompts across builds for regression comparison, isolates by
bisection, and delivers structured per-test docx reports ("Attempted Prompt N" + verbatim
agent transcript + tool-call counts + screenshots). Tests evenings/nights AST on a
personal Windows machine with an OneDrive KFM-redirected Desktop and Chrome installed.
His exact Windows version and specs have never been captured — capture them this run.

**June RC experience (what to not repeat).** He was handed a GitHub prerelease link plus
manual provider setup; he hit the Chrome-profile email failure, then re-downloaded a
stale link and reproduced an already-fixed bug. Once given a fresh build he delivered a
complete structured pass in one same-night message and asked "Was there anything else in
particular that we needed to ensure was working?" — he wanted a checklist. The quickstart
is that checklist. Other frictions to avoid: plaintext credentials in chat (never),
synchronous late-night debugging (replace with async log capture), and our side losing
his attachments (his "Reply Function Errors.docx" was never preserved — confirm receipt
of every file he sends, immediately).

**What this run is for.**
1. **Check the EXT-TESTER GA box** (GA_READINESS §4, external validation): one tester
   completes download → install → first green turn **with no help**. Evidence: his
   report, filed on board card seq11. Do not coach during tasks 1-4; guidance in this doc
   is for answering questions, not steering.
2. **Optionally close KAR-PDF and DOCSEARCH** (defect register rows 63-64, both
   UNVERIFIED) via the two deliberate re-tests in §3 steps R1/R2. KR1 in-app proof
   passed 2026-09-02 on moe.12, but his original reports (intermittent PDF reads,
   Word/Excel creation failures, folder search) have never been re-verified by him.

---

## 2. Pre-handoff checklist (owner actions, in order)

1. **Build choice: moe.15, not moe.16.** The criteria audit's recommendation, verbatim:
   > PROCEED on moe.15 — the EXT-TESTER box tests install + first-turn UX, and moe.15
   > carries every fix on that path (boot channel-choice/EPERM 38085ba3, model-less
   > agents 61be816e, retry-loop breaker fee7294d, KFM Desktop 97004aa6, Outlook
   > subject-gate a8322ad9); the 09-03 fixes target email transport and fleet identity,
   > which tester tasks 1-4 never touch, and the quickstart is hash-pinned to moe.15 (a
   > recut forces re-verify + re-author). Mitigate instead of waiting: verify broker
   > /healthz + packaged cloud-gateway seed before sending the link, and pre-classify a
   > stuck-"thinking" first turn as the known f01bb43a defect.
2. **Verify the online lane before minting anything:** (a) broker health endpoint green;
   (b) confirm the moe.15 exe packages the cloud-gateway seed (repeat the
   `providerKeys=1` check from the 06-09 VM proof). His machine has no Ollama — every
   turn rides the online lane; if the seed is missing the run is dead on arrival.
3. **Mint the signed download URL — 12h TTL.** Coordinate timing with him on WhatsApp
   first: his window is evenings/nights AST, so mint shortly before he confirms he is
   ready, not in the morning. A dead link recreates the June stale-link confusion.
4. **Publish the hash in the carrier email.** The email must carry the exact filename
   (`Ministry of Education-0.4.3-moe.15-win-x64.exe`), byte size **390,104,940**, and
   SHA-256 `d10de5809b6888a9dbd4a82fea41d8dc20d8bd81193b306c68a163dfc6ce18df` (matches
   the quickstart footer pin). Attach `TESTER_QUICKSTART.md`.
5. **Send is owner-gated.** No agent sends this email. After sending, tell him on
   WhatsApp the link is live and the clock is running.

---

## 3. The guided walk

Numbers track the quickstart sections. For each step: what he does, EXPECTED, and the
Windows-specific notes you need to answer questions live without debugging on the call.

**Step 1 — Download (quickstart §1).**
EXPECTED: file lands, Properties shows exactly 390,104,940 bytes.
Notes: link expires 12h after minting. Browser may warn "not commonly downloaded" —
Keep. If the size mismatches, stop; do not let him install a partial file.

**Step 2 — Install (quickstart §2).**
EXPECTED: SmartScreen blue "Windows protected your PC" interstitial (unregistered
publisher) → More info → Run anyway → installer with defaults → done in ~5 min.
Notes: he is the **first person to run the assisted GUI install of moe.15** — all prior
evidence is the silent `/S` diagnostic lane. If install fails with a cryptic error on a
fresh Windows 11 image, suspect missing `vcruntime140.dll` (atlas §7 class) — that is a
VC++ redistributable install, not a build defect. Do not offer `/S` as a workaround.

**Step 3 — First launch and first green turn (quickstart §3 + task 1).**
EXPECTED: composer greyed out ~1 minute (measured 50-51s on the VM; Defender cold-start
is why Windows is slower than Mac's ~1s), then his first prompt (quickstart task 1)
answers normally.
Notes: **internet is required** — no on-device model exists on his box, so there is no
offline fallback; do not ask him to test offline behavior. If Windows Firewall/Defender
prompts when the app first listens locally, the answer is **Allow** (Block kills local
RPC). If a turn sits in "thinking" past 5 minutes, pre-classify as the known idle-timeout
defect f01bb43a (fixed post-cut, not in moe.15): tester-side mitigation is close and
reopen once, capture the log, move on. No live debugging.

**Step 4 — Quickstart tasks 2-4 (letter, summarise, create file).**
EXPECTED: task 2 drafts a plausible parent letter in-chat; task 3 summarises a
dragged-in PDF/Word file in five bullets; task 4 creates a Word file and saves it to
Desktop.
Notes: task 4 exercises the OneDrive KFM Desktop path exactly (fix 97004aa6 is in
moe.15) — the file should appear under `OneDrive\Desktop`, which IS his Desktop. If he
reports "it says saved but I don't see it", have him check the OneDrive Desktop folder
before calling it a fail.

**Step R1 — DELIBERATE re-test: KAR-PDF (register row 63).**
His 06-30 report was (a) INTERMITTENT PDF read failures and (b) Word/Excel CREATION
failures. Both halves must be exercised. Ask him to use his own fixture folder
(`MoE Agent Testing Folder` on his Desktop, from the July Prompt Tests); if he no longer
has it, any local PDF plus any local xlsx substitutes.

- R1a, run **three times in the same chat session**, identical prompt each time:
  > Summarise the PDF "01_Ministry_Circular_ICT_Equipment_Audit.pdf" in the "MoE Agent
  > Testing Folder" on my Desktop so someone could read it in five minutes.
  PASS: 3/3 attempts return a real summary; zero "unable to read the pdf document"
  errors on any attempt. 2/3 is a FAIL (intermittency was the defect).
- R1b, Excel creation + save-as (the half the register dropped; Word creation is already
  covered by task 4):
  > From "Student Marks Gradebook.xlsx" in the MoE Agent Testing Folder, compute each
  > student's average and grade, and save the results as a NEW Excel file in the
  > Output_Files subfolder. Do not modify the original.
  PASS: new .xlsx exists on disk with plausible content, original untouched.

**Step R2 — DELIBERATE re-test: DOCSEARCH (register row 64).**
Use his own CHAT-001 opener, plus subfolder enumeration:
> Search the MoE Agent Testing Folder on my Desktop and list all Word, PDF, Excel and
> image files, including anything inside the Output_Files subfolder.
PASS: every fixture file listed by exact filename, subfolder contents included, no
invented files. Then have him run the same prompt a second time — results must be
consistent (his original complaint was inconsistency; provenance is weak, so consistent
2/2 output is the closure bar).

**Step 5 — Email (quickstart task 5).**
EXPECTED OUTCOME: "skipped — no email account". The browser lane needs a pre-signed-in
Chrome session and the Graph lane is not in moe.15. Do not count the skip against the
run and do not set up an account for this pass.

**Stretch (only if he offers — he usually does):** a full rerun of his five July
Prompt Tests prompts on moe.15 is the strongest possible closure of the 0/5 record,
since they are his own regression baseline. Optional; do not make it a condition.

---

## 4. Feedback capture — the exact minimal report

Matched to his known style (single structured same-night message; docx for batches).
Ask for exactly this, nothing more:

1. **One reply to the link email** (a WhatsApp copy is fine) containing, per step
   (1, 2, 3, task 2, task 3, task 4, R1a, R1b, R2, 5):
   `worked / partly / failed` + rough duration.
2. **For R1a, R1b, R2 only:** paste the full chat transcript verbatim, including the
   tool-call counts shown in the UI (his existing habit). These lines close defect
   register rows, so verbatim text is required, not a paraphrase.
3. **One screenshot per failure** (Win+Shift+S), plus a screenshot of the Desktop /
   Output_Files folder showing the files created in task 4 and R1b.
4. **The newest log file** from `%APPDATA%\Ministry of Education\logs` (attach it and
   state its filename). Remind him logs contain no message content or passwords.
5. **Download + install timing and anything confusing** — the "honest negatives" ask.
6. **His Windows version and machine model** (winver screenshot is enough) — never
   captured in any prior run.

**Owner intake duties, same day:** acknowledge and download EVERY attachment immediately
(we lost his June defect docx by not doing this); file the reply on **board card seq11**
(the GA box is uncheckable without it); copy the R1/R2 transcripts into defect register
rows 63-64 with a verified/still-open verdict.

---

## 5. Criteria mapping — GA box and defect closures

| Criterion | Proven by step | Evidence artifact |
|---|---|---|
| Download unaided (GA_READINESS §4) | Step 1 | His timing note + byte-size confirmation, filed on board card seq11 |
| Install unaided (GA_READINESS §4) | Step 2 | His install note (+ screenshot if anything odd); first GUI install of moe.15 on record |
| First green turn (GA_READINESS §4) | Step 3 | Transcript/screenshot of task 1 answer + time-to-ready note |
| Feedback captured (GA_READINESS §4) | Step 6 / §4 above | Reply email attached to board card seq11 |
| KAR-PDF closure (register row 63) — bonus | R1a + R1b (+ task 4) | 3/3 read transcript + new .xlsx/.docx on disk (screenshot) |
| DOCSEARCH closure (register row 64) — bonus | R2 | 2/2 consistent file-listing transcripts |

The two bonus rows are closures of HIS defects, not GA-box requirements: if R1/R2 fail,
the GA box can still check on steps 1-3 + feedback, and the register rows reopen with
fresh repro detail — which is also a good outcome.

---

## 6. Before you send — punch list (gaps the audit found)

- [ ] Mint the signed URL (12h TTL) and draft the carrier email with SHA-256 + byte
      size embedded — neither exists yet; owner send only.
- [ ] Reconcile GA_READINESS §4 wording ("from the public Release") with signed-URL
      delivery — amend the criterion or publish a Release, and do NOT point him at the
      public repo until the CLWX-18 scrub/split is done.
- [ ] Decide on the GUI-install gap: accept that he is the first assisted-GUI install of
      moe.15, or do one owner GUI install first (doubles as the open KR2
      recording/acceptance decision).
- [ ] Add a VC++ redistributable line to the quickstart (atlas §7: missing
      `vcruntime140.dll` fails install with a cryptic error on fresh Win11).
- [ ] Add one sentence to the quickstart: an internet connection is required (no
      on-device model on a tester box; the degrade path has no target).
- [ ] Verify before sending: (a) moe.15 exe packages the cloud-gateway seed
      (`providerKeys=1` check), (b) broker health green at send time.
- [ ] Pre-classify a stuck-"thinking" first turn as known defect f01bb43a in your triage
      notes; close-and-reopen is the only tester-side mitigation.
- [ ] Add an "if Windows Firewall asks, click Allow" line to the quickstart.
- [ ] Define intake: the reply email must be attached to board card seq11 or the box
      stays uncheckable.
- [ ] Set expectations now that task 5 (email) will almost certainly be "skipped — no
      email account"; do not count its absence against the run.
- [ ] From the tester record: capture his Windows version/specs this run (never
      recorded), and confirm receipt of every attachment the moment it arrives.

---

*Owner-facing internal doc. No credentials, keys, URLs, or hostnames belong in this file
or in any message to the tester. Companion to `docs/TESTER_QUICKSTART.md` (tester-facing)
and `docs/wiki/GA_READINESS.md` §4 (criteria).*
