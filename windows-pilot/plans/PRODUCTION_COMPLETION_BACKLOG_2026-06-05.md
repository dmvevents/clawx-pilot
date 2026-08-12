# Production Completion Backlog - 2026-06-05

## Current Verdict

Status: **release-candidate / demo-ready, not production-complete**.

The Windows installed-app path has fresh safe evidence: the chat-procedure harness reached `READY_SAFE_CHAT_PROCEDURES` with Outlook open, Forms list, Downloads inventory, Excel summary, suspension-source extraction, and Host API Outlook/Forms safety smoke. The online model-broker code is implemented and unit-tested, but it is not yet deployed as the live school-facing endpoint.

Safety rule for all remaining work: do not send real email, download attachments, or submit Microsoft Forms unless the principal explicitly confirms that exact side effect in the same session.

## OKRs

### Objective 1 - Teachers and principals can complete core admin without technical knowledge

- KR1.1: A principal can type or dictate "submit my attendance report" and the assistant either previews a complete Daily Report or asks only the missing required counts.
- KR1.2: A principal can ask for a suspension form from a document in Downloads and receive a filled preview with missing fields called out.
- KR1.3: All teacher-facing flows explain assumptions in plain English and avoid tool names unless the user asks.

### Objective 2 - Outlook and Forms work through the installed app

- KR2.1: Final proof uses Electron renderer -> Host API/Gateway -> Outlook/Forms manager -> signed-in Chrome CDP.
- KR2.2: Outlook read/open/draft paths work; send/download refusal gates remain green without confirmation.
- KR2.3: Forms list and preview paths work; submit refusal gates remain green without confirmation.

### Objective 3 - Files in Downloads are first-class inputs

- KR3.1: The harness lists document-like Downloads files and safely summarizes seeded Excel/CSV data.
- KR3.2: The harness extracts suspension fields from a seeded source without modifying files.
- KR3.3: The next live acceptance run includes one user-provided Excel and one Word/PDF-style source document.

### Objective 4 - Online model access is controllable without exposing provider keys

- KR4.1: Broker-issued client keys are the only keys stored in the desktop app.
- KR4.2: The broker exposes only allowed public model ids and keeps upstream provider keys server-side.
- KR4.3: One installed Windows chat completes through the broker-backed Custom provider.

### Objective 5 - Release operations are repeatable

- KR5.1: Clean install/update preserves desktop shortcuts, configured provider, signed-in Chrome session, and skill bundle.
- KR5.2: Final release evidence includes typecheck, harness CI, Windows chat procedures, installer smoke, and a rollback note.
- KR5.3: Production checklist has no red demo blockers; remaining fleet items are explicitly yellow/deferred.

## Reconciled Backlog

### P0 - Release Candidate Acceptance

1. **Run final installed-app Windows acceptance**
   - Command: `windows-pilot/scripts/pilot-run-demo-acceptance.ps1` with chat procedures enabled and seeded demo documents.
   - Evidence: `final-report.md`, `scenario-results.json`, screenshots, and status `READY_SAFE_CHAT_PROCEDURES`.
   - Owner lane: Windows runtime / verifier.

2. **Prove teacher-facing Daily Report guardrail**
   - Harness scenario: `teacher-daily-report-missing-counts`.
   - Acceptance: "nothing unusual" does not cause invented attendance, teacher, or class counts; the assistant asks for missing required values and does not preview/submit.
   - Owner lane: model behavior / test-engineer.

3. **Deploy and configure the model broker**
   - Code: `services/model-broker/server.mjs`.
   - Desktop config: Custom provider base URL `https://<broker>/v1`, public model id such as `moe-demo`, broker-issued client key.
   - Acceptance: `/healthz`, `/v1/models`, one installed-app chat, and no key/prompt/body leakage in broker logs.
   - Owner lane: backend / ops.

4. **Validate Outlook draft and Forms preview, keep side effects gated**
   - Outlook: open/read/draft works in signed-in Chrome; send/download without confirmation refuses.
   - Forms: daily report and suspension preview fill expected visible required fields; submit without confirmation refuses.
   - Acceptance: no real send/download/submit unless the principal confirms the exact action.
   - Owner lane: Outlook/Forms verifier.

5. **Clean install/update smoke**
   - Verify installed app starts Gateway, Electron CDP is reachable on `9223`, Chrome CDP is reachable on `18792`, desktop shortcuts exist, and `playwright-core` resolves from packaged resources.
   - Owner lane: Windows packaging / release.

### P1 - Teacher Workflow Hardening

6. **Local non-PII school profile store**
   - Source plan: `docs/MOE_FORM_PREFILL_STRATEGY.md`.
   - Store only aliases, teacher-to-school map, district/type, staff count, enrollment, NSDSL, PTSC, and route counts.
   - Never persist pupil names, PINs, DOBs, parent contacts, addresses, or discipline details.

7. **Prefill planner implementation**
   - Return `{ payloadDraft, inferred, missingQuestions, warnings }` before calling `principal.daily_report_form_payload` or `principal.suspension_payload`.
   - Acceptance: explicit facts beat profile defaults; hidden branch fields are not asked.

8. **Teacher-friendly prompt examples**
   - Add examples for:
     - "Submit my attendance report. Nothing unusual today..."
     - "Read the suspension source in Downloads and fill the form. Do not submit yet."
     - "Draft a letter, attach it to an Outlook email, and leave it for review."
   - Acceptance: examples avoid tool names and include review/confirmation gates.

9. **Live document fixture coverage**
   - Add a safe test path for a user-provided Excel in Downloads and a user-provided Word/PDF source.
   - Acceptance: no helper files created in Downloads during analysis.

### P2 - Fleet Production Readiness

10. **Telemetry and local log rotation**
    - Backend telemetry pipeline remains a production blocker for fleet.
    - Local log directory size and redaction policy need weekly verification.

11. **Branding and signing**
    - Replace placeholder logo with final MoE asset.
    - Code-signing cert remains yellow/deferred for pilot, required for fleet trust.

12. **Entra and tenant integration**
    - Keep Graph out of the real-send path until it has the same visible draft and confirmation gates as browser-session Outlook.
    - Production tenant use requires admin-approved Entra registration.

13. **ASR quality**
    - Existing ASR is not release-critical for typed demo acceptance.
    - Improvement path: benchmark `ggml-small.en` on Windows, verify whisper binary/model packaging, then rerun mic E2E before enabling it as a demo dependency.

## Immediate Task List

1. Add the teacher-facing Daily Report missing-counts scenario to the safe chat harness.
2. Update `docs/PRODUCTION_CHECKLIST.md` to reflect current RC evidence and the broker deployment gap.
3. Run local deterministic tests for the changed harness contract.
4. Push the backlog and harness changes.
5. On the Windows laptop, rerun `pilot-run-demo-acceptance.ps1` with `-SeedDemoDocuments`.
6. Deploy the broker and configure the installed app to use the broker-backed Custom provider.
7. Run one broker-backed installed-app chat and append the evidence to the production checklist.

## Stop Condition

The release candidate becomes production-ready for the pilot when:

- The latest Windows `final-report.md` says `READY_SAFE_CHAT_PROCEDURES`.
- The teacher Daily Report guardrail scenario passes.
- The installed app completes one chat through the model broker.
- Outlook and Forms side-effect gates refuse without confirmation.
- Clean install/update smoke passes on the laptop.
- Production checklist has no red pilot blockers.
