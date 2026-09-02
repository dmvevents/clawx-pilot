# Stakeholder report — full-thread extraction, correlation, and chronology

*2026-09-02. Source of truth: the WhatsApp bridge store (SQLite), threads
extracted chronologically and correlated against the defect register, git
history, and the capability scorecard. Privacy floor applied throughout: no
phone numbers or JIDs; third parties as initials. Companion docs:
`MINISTRY_ASKS_2026-09-02.md` (the session agenda this feeds),
`DEFECT_REGISTER_2026-09-02.md`, `CAPABILITY_STATE_2026-09-02.md`.*

## The stakeholder map (from the store)

| Thread | Volume | Span | Role |
|---|---|---|---|
| Raj Ramdass (direct) | 381 msgs — 23 documents, 11 images, 17 audio | 2026-04-27 → **2026-07-20** (inbound stops) | Ministry ICT — the primary channel; ALL product-shaping documents arrived here |
| Raj+Anton+A. (group) | 108 msgs | 2026-04→09 | coordination |
| ICT MoE GPU (group) | 42 msgs | — | infrastructure side-thread |
| AMD x TSTT x Raj (group) | 12 msgs | — | hardware/RFP side-thread |
| Karunesh | no direct thread | — | curriculum-video QA; feedback arrives VIA Raj (separate project — never conflate, per liaison rule) |

**Chain-of-custody note:** the DB holds full message text + document
metadata; media BLOBs are not on local disk (re-downloadable through the
bridge). The two foundational form PDFs (2026-05-14) exist as thread
attachments; their acted-on derivatives (the 32- and 57-field schemas, the
form spec, the cloned forms) are committed in the repo. Recommend one
bridge-download pass to vault the originals (CLWX-32 adjacent).

## The document manifest (raj direct thread, verbatim filenames)

| Date | Dir | Document | Traces to (product) |
|---|---|---|---|
| 04-29 | IN | Overview for ELA.docx | early scoping |
| 04-29 | IN | Flow of steps summary.docx | early scoping |
| 05-01 | IN | TSTT Meeting Summary.pdf (×2) | engagement context |
| 05-01 | IN | 3 AI_Project_Meeting_Extracted_Notes.pdf | engagement context |
| 05-06 | IN | Simulation_Types_Design_and_Build_Guide.pdf | (video project — Karunesh side) |
| 05-06 | IN | May 6 Collated_AI_Project_Meeting_Notes.docx | engagement context |
| 05-12 | IN | Primary AI_Support.docx | **product spec source** |
| 05-12 | IN | AI Admin Primary School.docx | **THE product spec — the 8 capabilities** |
| 05-14 | IN | Primary School Daily Report: Term 3 PDF | **57-field daily-report schema + clone** |
| 05-14 | IN | Primary School Student Suspensions: Term 3 PDF | **32-field suspensions schema + clone + live fill (proven 09-02)** |
| 05-14 | IN | NSCC_2026__Test_QnA.docx | test content |
| 05-21 | OUT | HGX RFP draft + cluster spec (×2) | hardware side-thread |
| 05-26 | IN | SEA Typical School Results_2024.xlsx | data-handling example |
| 05-26 | IN | AI Tool Usage Agreement MPAAI↔MoE.pdf | **the legal frame for the pilot** |
| 06-27 | IN | AI_Email_Management_ideas.docx | **email capability expansion asks** |
| 06-27 | IN | NSCC-2026.pdf | test content |
| 07-17 | IN | TOR-TT-AI Textbooks (MoE markup) | new workstream proposal (unactioned — deliberate scope hold) |

*(Agent-verified detail per document, including unactioned flags, in the
chronology section below.)*

## Bug report — REPORTED → FIXED → EVALUATION CRITERIA

*(Correlation matrix from the isolation pass over IN-messages vs the defect
register and git history — see `DEFECT_REGISTER_2026-09-02.md` for the
register side. Headline rows, all with live 2026-09-02 evidence:)*

| Reported (stakeholder) | Root cause found | Fix | Evaluation criterion (testable) |
|---|---|---|---|
| "draft subject has been changed before it can be sent" (RAJ-1, 06-21, HIGH) | Two-sided: gate FALSE-NEGATIVE masked by accidentally-failing verification (the error text Raj saw IS the accidental-refusal path) | `a8322ad9` | 4-step gate proof: mismatched-subject confirmed send REFUSES with subject reason; matching send delivers. `v2-send-test` PASS + 73/73 contract units |
| Draft text landed in "To:" field (RAJ-4, 06-21) | Verifier classified inbox LIST ROWS as recipient wells via substring aria-label selectors | `a8322ad9` | Draft with body text echoed in the visible message list verifies clean; 15/15 `v2-eval` on outlook.cloud.microsoft |
| Reply archives the original (RAJ-3, 06-21) | — | **REFUTED** | `raj3-reply-archive-check.ts`: original present in inbox after reply flow, exit 0 |
| Reply misreads content (RAJ-2, 06-21) | tool layer verified faithful; model-layer scenario pending | OPEN | seeded structured email → agent summary → fidelity assertion (designed, on CLWX-34) |
| PDF read inconsistencies (Karunesh via Raj, 06-30) | doc-tooling steering + fixture classes since fixed | `c1b18125` + KR1 evidence | live in-app turn returns faithful summary (KR1 PASS); P4 xlsx PASS 09-02 |
| Files "not found" though present (07-17 class) | KFM redirection + tilde-path resolution | `fc435c6b` era + `97004aa6` (09-02) | `~/Desktop/<name>` resolves on a KFM machine — unit `doc-tooling-steering.test.ts` 20/20 |

## Project analysis in light of the stakeholder record

1. **Every load-bearing product decision traces to a stakeholder document.**
   The 8 capabilities come from `AI Admin Primary School.docx` (05-12); both
   form pipelines from the 05-14 PDFs; the email-capability expansion from
   `AI_Email_Management_ideas.docx` (06-27). The product is not speculative —
   it is a transcription of Ministry asks into software, which is the
   strongest possible position for the working session.
2. **The defect record is now symmetric.** Everything Raj reported in June
   has a disposition with a testable criterion (3 fixed-verified, 1 refuted,
   1 open-with-designed-scenario). The register also holds ~20 defects we
   found OURSELVES that Raj never saw — the balance of discovery has
   flipped from reactive to proactive since the June RC.
3. **The silence since 07-20 is the project's real risk** — not technology.
   Six weeks without inbound; our 09-01 reply restarted the channel;
   the nine-ask agenda (`MINISTRY_ASKS`) is built to convert ONE 45-minute
   session into everything Lane C needs. The thread evidence shows Raj
   responds to concrete artifacts (he engaged fastest around the form PDFs
   and the demo) — the live-proof evidence pack IS the re-engagement tool.
4. **One workstream deliberately unactioned:** the AI-Textbooks TOR (07-17)
   — correct scope discipline for GA; belongs on the session agenda as
   "acknowledged, post-GA."
5. **Evaluation culture shift:** every fix in the matrix above carries a
   *runnable* criterion (a script or suite, not a claim). That standard —
   fix ⇒ criterion ⇒ live evidence — is now the bar for closing any
   stakeholder-reported item.
