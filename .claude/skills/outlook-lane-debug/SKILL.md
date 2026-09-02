---
name: outlook-lane-debug
description: Diagnose and repair the Outlook/browser automation lane by LOOKING at it — screenshot-first debugging over CDP. Use when drafts fail, gates refuse unexpectedly, tabs seem lost, sign-in breaks, or any browser-automation behavior contradicts the code's assumptions. Never theorize past two failed fixes without a screenshot.
---

# Outlook lane debugging — look first, theorize second

The 2026-09-02 stress session burned two wrong fixes on a "focus steal"
theory before ONE screenshot showed the draft was perfect and the *verifier*
was lying. Rule: **after any second consecutive failed fix, or any error that
contradicts what the code believes it did, take a screenshot before writing
another line.** Windows get opened, dialogs steal the surface, vendors rotate
DOMs — you cannot reason about what you have not seen.

## The lane (what must be true)

1. **System Chrome with CDP on :18792.** Modern Chrome REFUSES the debug port
   on the default profile — use the dedicated profile:
   `open -na "Google Chrome" --args --remote-debugging-port=18792
   --user-data-dir="$HOME/.clawx-demo-chrome" --no-first-run`
   (Chrome must be fully quit first; the singleton silently ignores flags.)
2. **Authed session in THAT profile.** One-time sign-in via
   `scripts/outlook-login-helper.ts` (sandbox `test.fac@fac.edu.tt` ONLY,
   password from `PILOT_TEST_PASSWORD` in local context, never printed).
3. **App running** (gateway :18789, host-API :13210) for tool-path tests.
4. Accept BOTH domains: `outlook.office.com` AND `outlook.cloud.microsoft`
   (tenant-by-tenant migration; ours flipped 2026-09-02).

## The toolkit (all in scripts/, all run with `pnpm exec tsx` from repo root —
/tmp copies cannot resolve playwright-core under pnpm)

| Script | Use |
|---|---|
| `outlook-shot.ts` | Screenshot the Outlook tab → `/tmp/outlook-state.png`. THE FIRST MOVE. |
| `outlook-cleanup-compose.ts` | Discard stacked compose panes (pile-up breaks field targeting). Run before every gate test. |
| `outlook-compose-dom-probe.ts` | Open a compose (keyboard `n`) and enumerate every editable field's tag/role/aria/rect. For selector-rotation triage. |
| `outlook-verify-probe.ts` | Replicate the verifier's recipient classification and print WHICH elements match. For false-positive triage. |
| `outlook-login-helper.ts` | One-time sandbox sign-in into the dedicated profile. |
| `v2-eval.ts` / `v2-send-test.ts` / `v2-chatbot-e2e.ts` | The acceptance suites: 14-row eval, 4-step gate proof, 3-turn LLM smoke. |

## Failure signatures already solved (do not re-debug)

| Symptom | Cause | Fix (shipped) |
|---|---|---|
| "message text appears in a recipient field" on a correct draft | verifier matched inbox LIST ROWS via `[aria-label*="To"]` substring; any row previewing the draft text false-positives | recipient wells now require editable fields (`a8322ad9`) |
| net::ERR_ABORTED navigating to `outlook.office.com/mail/...` | tab lives on `outlook.cloud.microsoft`; SPA aborts cross-origin gotos, and ANY goto during a compose dialog | origin-derived URLs + SPA sidebar-click navigation (`a8322ad9`) |
| Subject-drifted draft SENT (gate false negative) | changed-after-review branch allowed subject drift | subject drift now refuses; only body drift sendable (`a8322ad9`) |
| Body text typed twice | interim direct-click path typed, "failed" per broken verifier, heuristics typed again | path removed (`a8322ad9`) |
| CDP port never opens | Chrome launched while old instance alive (singleton), or default profile | full quit → verify dead → dedicated profile launch |
| Login helper hangs | first-run interstitials in a blank profile | drive login via `outlook-login-helper.ts` with step screenshots |

## Protocol for a NEW failure

1. `outlook-shot.ts` → READ the screenshot. What is actually on screen?
2. `outlook-cleanup-compose.ts` → re-run the failing step on clean state.
3. Still failing → the relevant DOM probe (compose fields or verifier match).
4. Fix the CODE's model of the DOM, not the DOM. Rotated selectors need the
   3-fallback rule (`dom-selector-regression-tester` agent audits this).
5. Re-prove with the acceptance suites, then commit fix + updated signature
   row in this table.

## Hard rules that bind this lane
Sandbox account only for automation sign-in; never `*@moe.gov.tt`. All sends
via the two-gate contract (confirm + subject match). No bodies/recipients/
passwords in logs or commits. profile=user (real Chrome) — managed Chromium
dies on Conditional Access.
