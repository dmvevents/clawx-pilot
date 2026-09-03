# CLWX-62 — Recorded Daily Report submission (test.fac clone)

**Verdict: PASS (responses count incremented by exactly 1: 7 -> 8)**

- Date: 2026-09-03 (local), run duration 40.9s
- Harness: `scripts/forms-submit-recorded-daily.ts` (mirror of the Suspensions
  recorded harness `scripts/forms-submit-recorded.ts`)
- Command: `pnpm exec tsx scripts/forms-submit-recorded-daily.ts` (exit 0)
- Target: hard-pinned to the URL in
  `extensions/moe-principal-assistant/forms/daily-report-test-fac-url.txt`
  (host `forms.cloud.microsoft`, form id prefix `CbuQlSzO4kCB`). No CLI/env
  override exists; the form id is re-asserted after open, after re-open, and
  immediately before the confirmed submit.
- Lane: user Chrome via CDP `127.0.0.1:18792` (profile=user, test.fac
  signed-in session). Harness never launches a browser; CDP preflight gates
  the run.

## Steps (as executed)

1. CDP preflight OK; pinned form id verified against the allowlist file.
2. Attached to the clone tab; visible title
   "Primary School Daily Report: Term 3 2025/26" (duplicated once by the
   title-scrape, cosmetic only).
3. Responses count BEFORE = **7** (analysis page scrape,
   `view responses N` badge; same-origin formapi fetch did not yield a count).
4. Recording started: Playwright tracing + CDP screencast.
5. Form re-opened on camera; fill via production `DailyReportActions`:
   **filled=55 skipped=2 errors=0** (skips = `principal_name` auto-recorded
   by Forms + `reason_no_school` hidden by branching — expected).
6. Refusal proof: `submit({ confirm: false })` -> **status=refused**
   ("Submit blocked: confirm:true required..."). Body checked afterwards to
   confirm nothing was submitted.
7. ONE confirmed submit: `submit({ confirm: true })` -> **status=submitted**
   ("Form submitted via Microsoft Forms."). Single-submission latch enforced.
8. Independent success marker: **FOUND** via body text
   "response was submitted".
9. Responses count AFTER = **8** (same analysis-page scrape strategy) —
   increment by exactly 1, so the strict verification path passed; the
   success-marker fallback was not needed.

## Artifacts (this directory)

| File | What |
|---|---|
| `run-summary.json` | Machine-readable verdict, counts, strategies, timings |
| `run-log.txt` | Full stdout of the run |
| `before-submit.png` | Filled form immediately before the submit gate |
| `after-submit.png` | Thank-you page after the confirmed submit |
| `video.mp4` | Screencast (14 frames, ffmpeg-assembled, vfr) |
| `trace.zip` | Playwright trace (screenshots + snapshots) |

## Output tail

```
[t+30.5s] gate: refused as required ("Submit blocked: confirm:true required. Re-call with confirm:true after the princ...")
[t+30.5s] submit: confirm:true (exactly one submission this run)
[t+30.6s] submit: status=submitted Form submitted via Microsoft Forms.
[t+31.8s] verify: success marker FOUND via body text "response was submitted"
[t+40.8s] verify: AFTER count=8 via analysis page scrape (view responses\s+(\d[\d,]*)\b)
[t+40.9s] record: mp4 OK — /opt/homebrew/bin/ffmpeg assembled 14 frames

=== PASS (responses count incremented by exactly 1) ===
```
