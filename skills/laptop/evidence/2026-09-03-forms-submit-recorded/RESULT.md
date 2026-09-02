# Screen-recorded, verified Suspensions form submission — RESULT

- Date (run): 2026-09-02 (local clock showed Sep 3 early AM; evidence dir named per task)
- Host: Mac dev machine, repo `/Users/antonalexander/Github/moe-tt/ClawX`, branch `fix/doc-tooling-steering`
- Harness: `scripts/forms-submit-recorded.ts` (new; reuses the production `FormsDriver` + `SuspensionsActions` from `electron/services/forms-browser-v2/`)
- Verdict: **PASS** — refusal path proved, exactly one confirmed submission per run, success marker verified independently, and the owner responses count incremented by exactly 1 (5 -> 6), all on video + Playwright trace.

## FACTS

1. Target guard: the ONLY submittable URL is read from `extensions/moe-principal-assistant/forms/suspensions-test-fac-url.txt` (test.fac clone, form id prefix `CbuQlSzO4kCB...`, host `forms.office.com`). The harness has no URL argument or env override; it exits non-zero if the file is missing, the host is not `forms.office.com`/`forms.cloud.microsoft`, or the live page's form id ever differs from the pinned id (checked after open, after re-open, and immediately before the confirmed submit).
2. Browser: attached to the user's already-running Chrome over CDP `127.0.0.1:18792` (`Chrome/152.0.7977.65`). Preflight aborts if CDP is down, so the driver's repair path (which could fall back to a managed profile) can never execute. No browser was launched; no sign-in was performed; no passwords used.
3. Two runs were executed; each run made exactly one confirmed submission to the clone form (two synthetic test responses total, the clone's 5th and 6th).
   - Run 1 (`run-01-pass-fallback/`): fill 29/32 (0 errors), refusal proved, confirmed submit landed, success marker found. Responses count unreadable both times -> verdict `PASS-FALLBACK`. Root cause of unreadability: the analysis URL redirects to `forms.cloud.microsoft` `subpage=design`, whose badge reads "View responses N" (number AFTER the word); the run-1 regexes expected the number before the word or in parens.
   - Run 2 (top-level artifacts, after fixing the count reader): full `PASS`, exit code 0.
4. Run 2 sequence and timings (total 42.3 s; `run-log.txt` is the verbatim stdout):
   - t+0.0s preflight CDP up; t+6.4s form open (visible title "Untitled form")
   - t+17.0s BEFORE responses count = 5 (strategy: analysis-page scrape, pattern `view responses\s+(\d[\d,]*)`)
   - t+17.0s recording ON (Playwright tracing + CDP `Page.startScreencast`); form re-opened on camera
   - t+30.9s fill done: filled=29 skipped=4 errors=0 (skips are payload-conditional optionals — same 29/32 profile as the W3 Mac and VM lanes)
   - t+31.3s submit WITHOUT confirm -> `status=refused` ("Submit blocked: confirm:true required...") and page verified NOT submitted afterward
   - t+32.2s submit WITH `confirm:true` (single-submission latch) -> `status=submitted` (driver confirms via 2xx POST to the Forms `/responses` API and/or confirmation copy)
   - t+33.1s independent success marker FOUND via body text "Your response was submitted." (fallback strategies available: `[data-automation-id="thankYouPage"]`, "Submit another response" text)
   - t+41.4s AFTER responses count = 6 -> incremented by exactly 1
   - t+42.3s MP4 assembled by `/opt/homebrew/bin/ffmpeg` from 28 screencast frames
5. Artifacts (this directory):
   - `video.mp4` — h264 1280x932, 16 s, 388 KB; shows only the test clone form: load, field-by-field fill, refusal moment, confirmed submit, thank-you page
   - `trace.zip` — Playwright trace (430 entries, screenshots+snapshots) from the CDP-connected context; open with `pnpm exec playwright show-trace trace.zip`
   - `before-submit.png` — filled form (questions 27-32 visible with synthetic values) pre-submit
   - `after-submit.png` — "Your response was submitted." thank-you page
   - `run-log.txt`, `run-summary.json` — run-2 stdout and machine-readable summary
   - `run-01-pass-fallback/` — run-1 artifacts preserved (same shape, count unreadable)
6. Verification tier achieved (run 2): the STRONG tier — owner responses count read before AND after in the signed-in test.fac session, increment of exactly 1 — plus the success marker and the driver's network-level confirmation. The count was read by scraping the owner design page badge; the `formapi` same-origin fetch strategy returned nothing usable (kept as first-try strategy, falls through cleanly).
7. Commands:
   - `pnpm exec tsx scripts/forms-submit-recorded.ts` (the harness; exit 0 = PASS)
   - `pnpm typecheck` — green (scripts/ is outside tsconfig include; the harness was additionally typechecked standalone under repo-equivalent compiler options: zero own-file errors)
8. No git commits were made. Raw screencast frames are deleted after successful MP4 assembly to keep the packet small.

## ANALYSIS

- The recording approach works on a CDP-connected context: `context.tracing.start({screenshots, snapshots})` succeeded, and `Page.startScreencast` delivered JPEG frames (throttled to >=300 ms spacing, capped at 720). ffmpeg concat-with-durations preserves real pacing at ~2-3 fps, which is adequate evidence quality at ~400 KB per run.
- The responses-count surface is vendor-rotated: `forms.office.com/Pages/DesignPageV2.aspx?subpage=analysis` redirects to `forms.cloud.microsoft` `subpage=design`. The harness now carries four count patterns ordered most-specific-first; if Microsoft rotates the badge copy again, the harness degrades gracefully to `PASS-FALLBACK` (success marker + screenshots) rather than failing or blocking the submit path.
- The confirmed submit passed the driver's second gate (visible title vs expected) via the question-fingerprint fallback, because the clone's visible title is "Untitled form" while the expected title is "Primary School Student Suspensions". The fingerprint (9 known question labels, >=4 required) matched. Renaming the clone form's title in the Forms editor would exercise the primary title gate instead.
- Demo-day utility: this harness is the evidence machine — one command produces video + trace + before/after screenshots + a count-verified submission against the clone, without touching any real MoE form (which has no submission path, by design).
- Safety note observed in passing: `FormsDriver.ensureBrowser` calls `ensureChromeCdpReady({ allowManagedProfileFallback: true })` on CDP attach failure. The harness's preflight guarantees that path is unreachable in this context, but the flag is worth revisiting for Microsoft-tenant flows generally (hard rule: never managed Chromium for tenant surfaces).

## OPEN QUESTIONS

1. The `formapi` `responseCount` fetch (strategy 1) returned nothing for this owner/session — is there a stable owner API worth wiring (e.g. tenant-scoped `/formapi/api/{tenant}/users/{user}/forms`), or is the badge scrape sufficient for pilot evidence?
2. Should the clone form's title be set to "Primary School Student Suspensions" in the Forms editor so the primary title gate (not the fingerprint fallback) is what a confirmed submit exercises?
3. `allowManagedProfileFallback: true` in `FormsDriver.ensureBrowser` — should this be flipped to `false` (or gated) so no code path can ever reach a managed profile for tenant flows, even outside this harness?
4. The clone now holds 6 synthetic responses; should the responses be cleared before the next stakeholder demo so the count tells a clean story?
