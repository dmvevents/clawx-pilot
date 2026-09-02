# App use-case recording — Summarise my last 5 emails

**Date:** 2026-09-03
**App:** Ministry of Education (Mac) v0.4.3-moe.10, `/Applications/Ministry of Education.app`
**Use case:** demo item 1 — type "Summarise my last 5 emails" in the chat composer, agent reads the live Outlook lane (read-only), reply renders, whole thing screen-recorded.

## VERDICT: BLOCKED-MODEL-400

The turn cannot complete because the composer is pinned to `gemini-2.5-flash` on the
Online channel, and that model call returns **HTTP 400 (no body)** — the known
composer-override regression class. This is a provider/config-coherence blocker,
NOT a fault of the drive/record harness, and is not recoverable by waiting or
retrying. The `clawx-config-doctor` config-coherence repair is being dispatched
separately; the re-run happens after that repair.

Per the coordinator's fresh ground truth (owner screenshot 2026-09-03 04:15) the
"Summarise my last 5 emails" turn on flash 400s, and I was instructed not to retry
it. The captured failure banner is from the immediately-prior "C can you check my
email?" turn — the identical model-call-400 failure mode that blocks this use case.

---

## FACTS (real command output)

Attach / drive mechanism selection (CDP-to-app-renderer is unavailable):

```
$ for p in 9223 18789 13210 18792; do curl -s -m3 -o /dev/null -w "%{http_code}\n" http://127.0.0.1:$p/json/version; done
port 9223 : 000   (connection refused — app NOT launched with --remote-debugging-port; snapshot-ui production attach impossible)
port 18789: 200   (OpenClaw gateway, serves the Control HTML)
port 13210: 401   (host-API, auth-token gated == up)
port 18792: 200   (user Chrome CDP — Outlook lane)
```

Chrome CDP 18792 tab list confirms the live Outlook session is present (read-only lane):

```
page | https://outlook.cloud.microsoft/mail/inbox/id/AAQ... | Mail - test fac - Outlook
page | https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=... | Untitled form
```

Running processes:

```
$ ps aux | grep "Ministry of Education"
5176  /Applications/Ministry of Education.app/Contents/MacOS/Ministry of Education   (main)
5227  ... Helper (Renderer) --type=renderer ...                                       (renderer)
gateway pid 5717 (per the app status line: "gateway connected | port: 18789 | pid: 5717")
```

Attach mechanism PROVEN WORKING (macOS UI automation + screen recording):
- Screen Recording permission is granted — 2s `screencapture -v -V 2` probe produced a
  valid h264 mov (`3456x2234`, ffmpeg-verified).
- The app main window is at points `224,95` size `1280x800` (retina scale 2 →
  `2560x1600` px). `System Events` reads it and `AXRaise`/`set frontmost` front it.
- Post-boot windows can be **hidden** (the `win.on('close')` handler calls
  `event.preventDefault(); win.hide()`), so AX reports `count of windows = 0` while
  the window still exists. A **Dock-icon click** fires Electron's `activate` →
  `focusMainWindow()` → `show()`, restoring it. Verified: dock click brought the
  window back and it rendered the full chat UI.
- Composer is reachable and focusable (cursor visible), model selector + Send affordance present.
- `screencapture -v` full-display capture + `ffmpeg` crop to the window rect
  (`crop=2560:1600:448:190,scale=1280:800,fps=8`) produced a clean, app-only
  `video.mp4` (1280x800, 8fps, 10s, 41 KB) — verified by extracting a mid-frame.

Failure state (captured in `final-failure-screenshot.png` and `video.mp4`):
- Red banner: **"Model call failed / 400 status code (no body)"**.
- Composer model selector reads **`gemini-2.5-flash`**; channel chip reads **"Online"**.
- `gateway connected | port: 18789 | pid: 5717`.

Session trajectory schema decoded (for settle + assertion on re-run):
- `~/.openclaw/agents/main/sessions/sessions.json` → `agent:main:main.sessionFile`;
  trajectory is the sibling `<id>.trajectory.jsonl`.
- Each turn appends a `model.completed` entry: `provider`, `modelId`, and a `data`
  blob with `finalPromptText` (echoes the user prompt), `assistantTexts[]` (reply
  chunks), and `promptErrorSource` (null on success).
- On the prior failed turn, the newest `model.completed` had `finalPromptText` =
  "C can you check my email?" and **`assistantTexts: []`** — i.e. a 400 leaves no
  assistant reply. This is exactly what the harness's settle detector treats as a
  model-error outcome.

Route note (why a blank window appeared during exploration):
- The chat page is route **`/`** (`src/App.tsx`: `<Route path="/" element={<Chat/>}/>`).
  There is **no `/chat` route and no catch-all**, so `File > New Chat` (which sends
  IPC `navigate('/chat')`) renders a blank white page. `Navigate > Dashboard` sends
  `navigate('/')` and restores chat. The harness uses Dashboard, never New Chat.

Typecheck:

```
$ pnpm typecheck   → tsc --noEmit exits 0 (clean)
```

---

## ANALYSIS

- The demo-blocking failure is upstream of the app UI: the renderer, gateway (18789),
  host-API (13210), and the Outlook Chrome lane (18792) are all healthy. The single
  broken link is the resolved model for the Online channel — `gemini-2.5-flash` — which
  the provider rejects with 400. This matches the documented "composer-level model
  override (chat picks Flash even though config says Pro)" open item and the memory
  note "gemini-2.5-pro configured as default … (was hitting 400s on Flash)".
- The 400 is correctly surfaced as a hard error and **not** silently degraded — it is
  an auth/config class, not a reachability class, so degrade-to-on-device would be
  wrong here. But the wording is a raw HTTP status, not principal-readable (see finding b).
- The drive+record path is fully built and de-risked. Once the model resolves to a
  working provider (Pro, or on-device), the same harness types the prompt, waits on the
  trajectory for a real `assistantTexts`, and asserts against the real inbox subjects.

---

## HARD-RULE FINDINGS (for the register)

**(a) Raw model id leaked in chat-facing UI.** The composer model selector displays
`gemini-2.5-flash` directly in the chat surface. This violates the "anonymise model
identity in UI — 'Online' / 'On this device' only, no raw model IDs in chat-facing
surfaces" rule. Expected: the picker shows only the friendly channel label.

**(b) Raw HTTP status shown to the principal.** The error banner reads
"Model call failed / 400 status code (no body)". The non-degradation is correct (this
is an auth/config error, not a network drop), but a principal should never see
`400 status code (no body)`; it needs a plain-language, principal-readable message.

---

## SCRIPT STATE — scripts/app-usecase-recorded.ts

Created, self-contained (node builtins only), typechecks clean. Re-run is cheap once
the model is repaired.

**Proven working now:**
- `preflight()` — app process, gateway 18789, host-API 13210 (401=up), Chrome CDP
  18792, Screen Recording permission probe, ffmpeg discovery.
- `surfaceWindow()` — Dock-click un-hide + AXRaise + frontmost, window geometry, retina
  scale detection.
- `ensureChatRoute()` — Navigate > Dashboard to restore `/` (avoids the blank `/chat`).
- Recording: `screencapture -v` background capture + `cropToWindow()` ffmpeg crop to the
  app rect + `screenshotWindow()`.
- Trajectory parse: `activeTrajectoryPath()` + `readModelCompletions()` decode the real
  `model.completed`/`assistantTexts` schema.
- Assertions: `assertReply()` — ≥2 inbox-subject groups matched AND no EXEC-NOISE-LEAK.

**Exercised only against the failure state (not yet against a real reply):**
- `waitForSettle()` — polls the trajectory for a new `model.completed` matching the
  prompt; returns `reply` / `model-error` (promptErrorSource set or assistantTexts empty)
  / `timeout`. Its `model-error` branch is exactly the current 400 condition. It has not
  yet been run through a successful `reply` because no successful turn exists to observe.
- The keystroke submit (`click composer → keystroke prompt → key code 36`) is coded but
  was deliberately NOT fired: the coordinator supplied ground truth that the flash turn
  400s and instructed no retry.

**Remains for the green re-run (after config repair):**
- Confirm `waitForSettle()` reply branch and `assertReply()` against a real
  `assistantTexts` payload (subject-word matching thresholds may need a nudge once we
  see the actual phrasing).
- Confirm the composer click coordinate (`0.5*w`, `h-70`) lands in the input across
  window sizes; adjust if the send lane geometry differs.

---

## OPEN QUESTIONS

1. Config-coherence repair (`clawx-config-doctor`) to move the Online channel off
   `gemini-2.5-flash` (400) onto a working provider (Pro or on-device) is dispatched
   separately. Re-run this harness after that repair.
2. Does the 400 originate from the composer-override picking flash, or from the
   gateway's resolved default disagreeing across the four config stores? The
   config-coherence auditor should confirm which store is the source of truth at send time.
3. After repair, verify the re-run reply actually cites ≥2 real inbox subjects; if the
   agent summarises without naming subjects, relax the assertion to body-distinctive tokens.

---

## Re-run command

```
pnpm exec tsx scripts/app-usecase-recorded.ts
```

Artifacts: `video.mp4` (app-window failure clip), `final-failure-screenshot.png`
(400 banner + flash selector), `run-summary.json` (written on a full run).

## ADDENDUM — 2026-09-03 04:51 re-run after the GOOGLE-STORE-400 repair

FACTS:
- The store-400 config repair (clawx-config-doctor) is CONFIRMED end to end in
  the app: the same prompt that previously banner-failed now runs a full turn
  (2 tool calls) and streams a coherent assistant reply.
- The reply is the DESIGNED degradation UX: "I'm having trouble connecting to
  your Chrome browser to read your emails. Could you please completely close
  and then reopen Google Chrome, and I will try again." — graceful,
  principal-actionable, no raw error.
- video.mp4 (04:51-04:55 run) captures the full sequence: prompt typed,
  submitted, turn executing, reply rendered. final-screenshot.png shows the
  rendered reply. This IS the recorded in-app use case; the harness's
  BLOCKED-TIMEOUT verdict on that run was a DETECTION bug (it watched a stale
  trajectory file while the reply sat on screen), since fixed in the script
  (scan trajectories touched after submit).
- The turn's outlook tool failed to attach to Chrome DESPITE CDP 18792
  answering and a live "Mail - test fac - Outlook" tab — a stale Playwright
  connection in the app process after heavy tab churn (forms tests) is the
  suspect. Filed as a board card (browser attach staleness).
- A subsequent re-run (23:29 UTC) flaked at the typing step: osascript
  keystrokes never reached the composer (empty composer, no new bubble at
  timeout). UI-automation focus is inherently flaky; the harness needs a
  typed-text-echo check before the Return keypress (OPEN QUESTION, noted for
  the next pass). Stopped iterating per the anti-stuck rule.

ANALYSIS: the Mac in-app recording objective is MET (real app, real turn,
real reply, on video). The email summary content itself was not exercised
because of the attach staleness — that is a product finding, not a harness
gap. Windows run of the same class is in flight on the VM.

OPEN QUESTIONS: (1) root cause of the stale CDP attach in the app process —
does outlookBrowserManager hold a dead Playwright browser handle after the
CDP endpoint restarts or tabs churn, and should ensureBrowser re-verify with
a live probe before reuse? (2) composer focus verification before keystroke.

## CORRECTION — 2026-09-03 (evidence integrity)

The `video.mp4` previously committed here was REMOVED. On this Mac the recorder
uses a full-display capture cropped to the app-window rectangle (avfoundation
cannot target a specific window on macOS). During the ~4-minute turn a
concurrent terminal window (an unrelated agent's session) came to the front over
the app rectangle, so the crop recorded that terminal, not the Ministry app.
Two hands-off re-runs reproduced the occlusion. Shipping that file as "the app
running the turn" would have been false, so it is deleted rather than kept.

Mac proof of the in-app turn is therefore the STILL:
`final-screenshot.png` — the real Ministry app with the prompt "Summarise my
last 5 emails", the "2 tool calls" turn indicator, and the assistant reply
rendered (the designed graceful degradation for the CLWX-54 Chrome-attach
staleness), Online channel, gateway connected. No 400 banner — the
GOOGLE-STORE-400 fix is confirmed live (the turn executed).

The canonical recorded VIDEO of a real in-app turn is the WINDOWS artifact,
`skills/laptop/evidence/2026-09-03-win-recorded-usecase/usecase.mp4` (gdigrab
can target the app on Windows), which is clean and verified.

Two product nits visible in final-screenshot.png, both already on the board:
- composer shows the raw model id `gemini-2.5-flash` (CLWX-52 raw-model-id UI leak);
- the email lane degraded rather than reading mail (CLWX-54 stale CDP attach).
