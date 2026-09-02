# RAJ-2 reply-fidelity check (model layer) — CLWX-34

Investigation date: 2026-09-02. Branch `fix/doc-tooling-steering`.
Defect under disposition: Raj reported 2026-06-21 that the assistant's reply
feature misinterpreted email content (a meal-preferences email was read back
as shirt sizes). The tool layer had been verified faithful; this pass isolates
the remaining MODEL-layer fidelity scenario on current code.

## Verdict

**PASS** — a live LLM summarise + draft-reply turn over a real inbox email
was faithful to the source: coverage 4/8 (50%, at the floor) of the top-8
distinctive source content words, and ZERO invented entities (no proper noun,
weekday/month, or number in the model output that is absent from the source).
Exit code 0.

Safety invariants held: no email sent, `confirm:true` never set, NO compose
pane opened at any point (the draft-reply exists only as model TEXT; the
script's only Outlook actions are `readInbox` and `readEmail` — verified by
grep over the script: lines 270 and 281 are the only `actions.*` calls).

## FACTS

### Lane preconditions

```
$ curl http://127.0.0.1:18792/json/version
  Browser: Chrome/152.0.7977.65          # user's Chrome, CDP profile=user lane
$ aws sts get-caller-identity            # AWS_PROFILE=bedrock, AWS_REGION=us-east-2
  Arn: arn:aws:iam::058264135704:user/claude-code-local
```

### Commands

```
pnpm typecheck                                        # PASS (tsc --noEmit clean)
pnpm exec tsx scripts/raj2-reply-fidelity-check.ts    # exit 0
```

Model used for the live turn: `us.anthropic.claude-sonnet-4-5-20250929-v1:0`
(Bedrock, us-east-2) — the same client mechanism as `scripts/v2-chatbot-e2e.ts`.

### Inbox survey (final run; subjects <= 120 chars, distinct content words after
disclaimer-strip; NO bodies recorded anywhere in this evidence)

| Subject | Distinct content words | Correspondence-like |
|---|---|---|
| Join Us Live Today: Launch of Six New Learning Resources for Secondary Schools | 39 | no |
| MoE smoke 06:31:23 | 28 | no |
| MoE smoke 06:29:12 | 28 | no |
| MoE smoke 06:10:31 | 28 | no |
| eval 06:09:42 | 22 | no (bare test) |
| Monday Motivation (x2 rows) | 33 / 32 | no |
| Greetings: Happy Independence Day! | 28 (see stale-read note below) | no |
| Media Release: Ministry Advances Processing of 45,953 School Supplies and Book Grant Applications | 33 | yes |
| VOLUNTEER COACHES NEEDED | 101 | yes |

Chosen candidate: **"VOLUNTEER COACHES NEEDED"** (only message meeting the
>= 40 distinct-content-word bar AND correspondence-like; source stats:
3118 chars, 108 content tokens, 101 distinct).

### Live turn + assertion output (verbatim tail)

```
Step 4: live LLM summarise + draft-reply turn
  LLM (5448ms): summary=488 chars, reply=416 chars, formatParsed=true

Step 5: deterministic fidelity assertions
  top-8 distinctive source words: coaches, experience, volunteer, sport, lives, inter-american, certification, participation
  covered by summary: coaches, experience, volunteer, certification
  coverage: 4/8 = 50% (floor 50%)
  invented entities: <none>

=== verdict ===
  subject:   "VOLUNTEER COACHES NEEDED"
  source:    chars=3118 tokens=108 distinct=101
  coverage:  4/8 (50%) — ok
  invention: none — ok
  compose pane opened: no; emails sent: none
RAJ-2 VERDICT: PASS — model summary+draft are faithful to the source email on current code.
```

### Assertion semantics (deterministic, two-sided)

- COVERAGE: source body lowercased, tokenised (length >= 4, stopwords and
  opaque tracking tokens out), legal/confidentiality footer stripped for
  scoring only, sender/recipient name tokens excluded from ranking,
  stem-folded frequency ranking (ties by length, then alpha). The summary
  must contain >= 50% of the top-8.
- NO-INVENTION: every mid-sentence capitalised proper noun, ALL-CAPS acronym,
  weekday/month name, and digit run in summary+draft must literally appear in
  the source (subject + sender + recipients + full body). Allowed non-source
  text: sender/recipient name tokens, today's date words, bracketed template
  placeholders ("[Your Name]"), possessive forms of sourced entities, and the
  harness's own persona system prompt (which names Trinidad & Tobago).

### Harness-calibration iterations (all four runs live; kept for honesty)

1. Run 1 FAILED spuriously: `readEmail`'s subject heuristic returned the UI
   heading "Navigation pane" for every message; the confidentiality footer
   dominated frequency ranking; "[Your Name]" placeholder flagged as invented.
2. Run 2 FAILED spuriously: possessives ("Tobago's", "Education's") of sourced
   entities flagged as invented. Coverage passed at 4/8.
3. Run 3 FAILED spuriously: 16-char opaque tracking token ranked as a
   "distinctive word" via the length tie-break; sender-organisation words
   dominated ranking; "Trinidad" (from the persona system prompt, not email
   content) flagged as invented.
4. Run 4 (final): all ranking/allowlist artifacts fixed in the harness;
   PASS as recorded above. No assertion floor was loosened: coverage floor
   stayed at 50% of top-8 and the invented-entity rule stayed at zero.

## ANALYSIS

- On current code, the model layer did NOT reproduce the RAJ-2 class for a
  real correspondence email: the summary tracked the actual ask (volunteer
  coaches / experience / certification) and neither summary nor draft-reply
  introduced any entity, date word, or number that is not in the source.
  Combined with the previously verified tool-layer fidelity, the shirt-sizes
  misinterpretation is not reproducible on this lane today.
- This is one live sample with a nondeterministic model; it is evidence of
  "not reproduced", not a proof of impossibility. The deterministic part is
  the assertion machinery, which is now reusable
  (`scripts/raj2-reply-fidelity-check.ts`) for regression reruns.
- Notable adjacent observation: across back-to-back runs, `readEmail` for the
  row "Greetings: Happy Independence Day!" returned a 2683-char body in one
  run and a 1090-char body (token stats identical to the "MoE smoke" mails)
  in the next — an intermittent STALE READING-PANE read at the tool layer.
  If that happens in a live agent turn, the model faithfully summarises the
  WRONG email, which is indistinguishable from "misinterpretation" to the
  user. This is a plausible root-cause hypothesis for Raj's original report
  that the model-layer test cannot see.

## OPEN QUESTIONS

1. Stale-read hypothesis: does `readEmail` (outlook-browser-v2) guarantee the
   reading pane it scrapes belongs to the id it was asked for? The observed
   run-3/run-4 divergence says sometimes no. A fingerprint check
   (sender|subject|received) exists in the action per its doc comment — why
   did it not reject the stale pane? Worth a dedicated tool-layer probe
   before closing CLWX-34 fully.
2. Coverage landed exactly at the 50% floor twice. With a richer seeded
   correspondence email (structured asks, named dates), the margin would be
   more informative. If the owner authorises one self-addressed sandbox seed
   email, rerun for a stronger sample.
3. `readEmail.subject` returning "Navigation pane" (UI heading) instead of
   the message subject is a live cosmetic defect in the subject heuristic
   (`outlook-actions.ts` readEmail heading selector); the agent-facing tool
   surface exposes it. Not fixed here (out of scope for this card).

## Re-run

```
pnpm exec tsx scripts/raj2-reply-fidelity-check.ts
```

Exit codes: 0 PASS, 1 FAIL, 2 lane/fatal, 3 BLOCKED-SEEDING, 4 BLOCKED-INFRA.
