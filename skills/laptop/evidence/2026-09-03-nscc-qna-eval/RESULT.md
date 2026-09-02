# CLWX-42 — NSCC stakeholder-authored Q&A eval: built + run live (2026-09-03)

The ONE stakeholder-authored test never yet built. Raj supplied
NSCC_2026__Test_QnA.docx (2026-05-14, 20 Q&A rows with expected answers and
page refs, "based only on the uploaded NSCC 2026 document"). This tick
converts it into a runnable eval fixture and runs it live against the cloud
model with the NSCC 2026 text as provided context.

**VERDICT: PASS — 18/20 rows (90%), floor 80%, exit 0.** Every one of the 20
answers named the NSCC as its source (20/20 citation), and 17/20 also cited
the stakeholder's expected page number.

## FACTS

### Inputs (located locally; nothing downloaded)

| Input | Path | sha256 |
|---|---|---|
| Stakeholder Q&A docx | `~/Downloads/NSCC_2026__Test_QnA.docx` (40,486 bytes, 2026-05-15) | `31b6eb72aaef1a3eb05dc95cddff0e19d4cca1eedb2b31975148e746104e3d2c` |
| NSCC 2026 full text (knowledge context) | `~/Github/moe-tt/moe-tt-voice/anton-claw-tt-voice/moe/data/nscc-2026.txt` (219,477 chars) | `e13fd2906cae1387a992ac9d6fc50196aeeac92df2dd1a9535429be5606ff84a` |
| NSCC **2018** PDF (found, REFUSED — see below) | `~/Projects/gencrawl/.../moe.gov.tt/National-School-Code-of-Conduct.pdf` (83 pp, "Revised May 25, 2018") | `aafc86d483be12aacd5ad01b4132fb5be55127af5e634f4ae4ab1fcd9748c9cf` |

- The original `NSCC-2026.pdf` binary (Raj, 2026-06-27) is **absent from this
  machine** (searched openclaw-agent attachments/inbound/liaison-archive,
  incoming-tests, docs, Downloads, Spotlight by name and content). What exists
  locally instead: (a) the 2018-revision PDF from a moe.gov.tt crawl, and
  (b) a full-text extraction of the 2026 revised edition in the sibling
  moe-tt-voice repo (self-identifies: "This revised edition (2026) of the
  NSCC ... merges the 2018 NSCC, the School Discipline Matrix ...").
- The 2026 extraction was verified against the stakeholder answer set before
  use: distinctive 2026-only content is present ("more than five (5) days
  without reasonable excuse within a four-week period (20 days)", "comb
  knives", "Productivity and Performance", "automatic recommendation",
  "Examination Committee", artificial-intelligence policy, "marks deducted",
  "Children's Authority"). The 2018 PDF lacks the attendance rule and the AI
  policy entirely.

### Artifacts built (this tick)

| Artifact | What | sha256 |
|---|---|---|
| `eval/fixtures/nscc-qna.json` | 20-row fixture. `question` / `expected_answer` / `expected_page` are VERBATIM from the docx (extracted via mammoth, the dep behind `document.read_docx`); re-extraction diff confirmed all 40 verbatim fields byte-identical. `key_points` are curated deterministic match groups (row passes when EVERY group matches, ANY variant within a group; word-boundary, case/quote/dash/whitespace-normalized). | `54ff186c799acc7e14217786612eccf8187dac03e779247fcf025b82f3ee2cd9` |
| `scripts/nscc-qna-eval.ts` | Live runner. Same Bedrock client mechanism as `scripts/v2-chatbot-e2e.ts` / `scripts/raj2-reply-fidelity-check.ts` (`InvokeModelCommand`, `us.anthropic.claude-sonnet-4-5-20250929-v1:0`, us-east-2). Per row: asks the question with the full NSCC 2026 text in-context, then asserts (a) all key-point groups and (b) an NSCC citation. Page-cite accuracy reported but non-gating. Exit non-zero below 80%. Also supports `NSCC_PDF_PATH` through the repo's own `document.read_pdf` path (`extensions/moe-principal-assistant/doc-tools.mjs`). | `1cb268e0ba0687ab2d070ae4c1c4b5b7fcd14842c98fb3761b5dde45ae4c9518` |

### Live run (this dir)

- `run-live.log` — full console output; `nscc-qna-eval-report.json` — per-row
  JSON incl. full answers and latencies.
- model `us.anthropic.claude-sonnet-4-5-20250929-v1:0`, region us-east-2,
  2026-09-03, 20 sequential turns, avg latency 7,561 ms/turn.
- Summary: **18/20 PASS (90% >= 80% floor) | nscc-cited 20/20 | page-cited
  17/20 | exit 0.**
- FAIL rows (both genuine model misses, not matcher bugs — the expected
  content IS in the provided context):
  - **NSCC-Q11** (exam cheating sanction, expected "paper cancelled, or marks
    deducted", p. 29): the model answered from the Discipline Matrix Level-2
    progression (p. 86) instead; it included "cancellation of exam paper(s)"
    but omitted "marks deducted". Source line exists verbatim: "may have that
    examination paper cancelled, or marks deducted".
  - **NSCC-Q20** (suspected child abuse, expected reporting "to the police and
    the Children's Authority", p. 62): the model correctly said mandated
    reporting and cited the statutes, but named neither the police nor the
    Children's Authority. Both appear in the source ("Children's Authority via
    their hotline number 800-2014").

### Guard proofs (negative lanes, no model calls burned)

- Missing knowledge text → `VERDICT: BLOCKED-INPUT ... not found`, exit 3.
- 2018 PDF passed as `NSCC_PDF_PATH` → extracted via the repo `read_pdf` path,
  then refused: `BLOCKED-INPUT — Knowledge text is the 2018 NSCC revision; the
  stakeholder Q&A is based ONLY on the 2026 edition.`, exit 3.

### Gates

- `pnpm typecheck` exit 0.
- No sends of any kind (no browser, no Outlook, no compose; read-only script).
- No secrets in files or logs (grep-audited this dir + fixture + script; only
  benign hits are Q18's own "device password" policy content).
- Nothing committed (orchestrator commits).

## ANALYSIS

- **What this proves:** the stakeholder's Q&A set is now a runnable,
  deterministic eval, and the production cloud model answers it at 90% with a
  100% NSCC-citation rate WHEN the NSCC 2026 text is provided as context. The
  harness discriminates: both failures are real key-point omissions, exactly
  the "retrieve accurate answers ... avoid adding information" behaviour the
  stakeholder said he wanted tested.
- **What this does NOT prove (card acceptance gap):** CLWX-42 acceptance is
  "fresh session, NO file attached, in-app". That additionally requires the
  NSCC knowledge pack shipped inside the app. Checked: the extension has NO
  knowledge/persona-knowledge dir today — only `data/schools.json` (consumed
  by the `principal.find_school` tool) and `templates/`. Final wiring is NOT a
  trivial file drop, so per instructions it was not built here. Two viable
  paths: (1) ship `extensions/moe-principal-assistant/data/nscc-2026.txt` +
  register a `principal.nscc_lookup` tool (identical pattern to
  `find_school`'s data read) + one persona line steering Code-of-Conduct
  questions to it — keeps the 7,550-token/turn floor intact; or (2) workspace
  bootstrap doc (the `copyBootstrapFiles` SOUL.md/AGENTS.md family in
  `electron/utils/agent-config.ts`) — simpler but pushes ~55k tokens of NSCC
  into every turn's context, which collides head-on with the KR6 token-floor
  ceiling; (1) is the right shape. The runner's default knowledge path
  already looks at `extensions/moe-principal-assistant/data/nscc-2026.txt`
  first, so the same eval re-runs unchanged once the pack ships.
- Q11-class misses (answer drawn from a different-but-related section of a
  120k-char doc) suggest the in-app lookup tool should return SECTION-scoped
  text, not the whole document.

## OPEN QUESTIONS

- The original `NSCC-2026.pdf` binary should be re-pulled from the bridge for
  archival (card CLWX-42 provenance); the eval knowledge text came from the
  sibling moe-tt-voice repo's 2026 extraction (hash above), which predates
  Raj's 06-27 send — content-verified against his Q&A set but not regenerated
  from his exact binary.
- Page-citation gating: 17/20 informational accuracy came free from printed
  page numbers surviving extraction; if the knowledge pack ships with explicit
  page markers, the page assertion could be promoted to gating.
- Q11/Q20: leave as failing rows (they are the eval earning its keep), or
  soften the stakeholder key to accept matrix-sourced answers? Stakeholder's
  own wording says answers are page-specific — leaving strict.
