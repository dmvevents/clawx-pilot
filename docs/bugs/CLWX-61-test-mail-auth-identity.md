# CLWX-61 dossier: QA mail-auth helper false PASS (identity never verified)

**Status:** source fix landed, unit-proven; live Windows/account verification root-owned and OPEN.
**Owned surface:** `windows-pilot/scripts/pilot-login-outlook-cdp.js`, `tests/unit/pilot-login-outlook-cdp.test.ts`, this dossier.
**Defect class:** QA harness false PASS — a state token treated as sign-in acceptance was derived from the tab URL alone.

## 1. Original false-PASS reproduction (source inspection)

Reproduced by inspection at pre-fix revision `7e1f9417ae3f57096a7799d9a433ea9745604e5f`,
`windows-pilot/scripts/pilot-login-outlook-cdp.js` (no live run needed; the defect is structural):

| Line(s) | Behavior | Why it is a false PASS / hazard |
|---|---|---|
| 91–94 | `if (/outlook\.(office\|cloud\|office365)\.com\/mail/i.test(page.url()))` → `STATE: OUTLOOK_ALREADY_SIGNED_IN`, exit 0 | URL-only. No expected-account identity, no inbox controls. Passes for ANY signed-in account, a half-loaded shell, or an error interstitial parked on a `/mail` URL. The regex is an unanchored substring test: `https://evil.example/outlook.office.com/mail` also matches. |
| 148–154 | Same regex → `STATE: OUTLOOK_SIGNED_IN`; else `LOGIN_BLOCKED_OR_NEEDS_INTERACTION` / `LOGIN_AMBIGUOUS` — **all three exit 0** | A wrapper checking the exit code sees PASS even for the helper's own blocked/ambiguous outcomes. Only missing-env (2), password-not-found (10) and thrown errors (1) were non-zero. |
| 77 | `browser.contexts()[0] \|\| await browser.newContext()` | Creates a fresh managed context when none exists — not the operator's signed-in profile; anything "verified" there is meaningless, and it violates the user-profile invariant. |
| 78–86 | First tab matching loose regex, else `context.pages()[0]`, then `page.goto(...)` | Adopts and **navigates an unrelated tab**, destroying the principal's page state. |
| 126–140 | After password: blind clicks on `input[type="submit"]`, `button[type="submit"]`, `text=/^Yes$/i`, `text=/^Stay signed in$/i` on whatever page follows | On an MFA/consent page these selectors can press approval buttons — automated consent, never authorized. |

Net effect: `OUTLOOK_SIGNED_IN`/`OUTLOOK_ALREADY_SIGNED_IN` could be logged (and exit 0 returned)
without ever proving which account was signed in or that a real inbox rendered. This cannot certify
the end-user mail workflow.

## 2. Root cause

The helper conflated **transport arrival** (a URL under an Outlook-looking host) with
**authenticated-state acceptance** (the expected account's rendered inbox). It had no identity
probe, no inbox-control probe, no typed blocked states with distinct exit codes, and its page
selection/click scoping was written for convenience rather than ownership. Same defect family as
the CLWX-90/eval-verdict fail-open (verdict inferred from a proxy of the outcome instead of the
outcome itself).

## 3. Fix

Corrected revision: **`02ff4b99b939153c197a1aabf5cca96921fbbb37`** (branch `lane/qa-mail-auth-20260908`).

- Only PASS is `OUTLOOK_SIGNED_IN_VERIFIED` (exit 0), requiring **all** of: strict Outlook mail
  origin (URL-parsed hostname allowlist `outlook.office.com` / `outlook.office365.com` /
  `outlook.cloud.microsoft`, path `/mail…`), a positive account-manager label containing the exact
  expected `PILOT_TEST_EMAIL`, and ≥2 rendered inbox controls (message list, folder pane, new-mail).
- Typed non-PASS outcomes with distinct non-zero exit codes: wrong account (11), unknown
  identity / controls absent (12), MFA/consent (13, **never clicked**), access denied (14),
  no existing browser context (15, **never `newContext()`**), ambiguous (16), auth still required (17).
- Tab adoption scoped to real Microsoft origins; otherwise a new tab in the **existing** user
  context. Unrelated tabs are never adopted or navigated; no tabs are closed; `browser.close()`
  only drops the owned CDP connection (the script creates no contexts).
- Credential fill only on a positively identified `login.microsoftonline.com` form; post-password
  the loop classifies and stops on MFA/consent; only the positively identified KMSI
  ("Stay signed in?") prompt is confirmed, once. Old PASS tokens `OUTLOOK_ALREADY_SIGNED_IN` /
  bare `OUTLOOK_SIGNED_IN` are gone so stale wrappers fail closed.
- Output hygiene preserved and tightened: no passwords, accounts, mail bodies, tokens or query
  strings; unparseable URLs are not echoed; verdict reasons carry booleans/counts only.
- Decision logic extracted and exported for tests (`classifySignInState`,
  `collectOutlookPageFactsInPage`, `selectOwnedPage`, `isOutlookMailUrl`, `isMicrosoftLoginUrl`,
  `accountLabelMatches`, `redactUrl`, `STATE_EXIT_CODES`); env/playwright resolution moved out of
  module scope. No new dependencies, no framework.

## 4. Test evidence (source lane)

- `pnpm exec vitest run tests/unit/pilot-login-outlook-cdp.test.ts` → **15/15 PASS**
  (fake DOM fixtures only; no live requests, no browser attach). Covers: regression pin
  (mail URL with no identity/controls must not pass), login-form page, wrong account,
  MFA-vs-KMSI discrimination, access denied, verified expected-account inbox (the only exit-0
  state), identity-without-controls ambiguity, lookalike-origin rejection, tab-selection scoping,
  URL redaction, no-`@` leakage in reasons.
- Mutation check (falsifiability): reintroducing URL-only success in `classifySignInState`
  → **5/15 tests fail**; restored byte-identical → 15/15 green.
- Adjacent suites unaffected: `windows-pilot-electron-cdp-probe` + `windows-pilot-harness-honesty`
  + this suite = 98/98 PASS (2026-09-08).
- `pnpm exec eslint` on both owned files: clean. Repo `tsc` lanes do not cover
  `windows-pilot/` or `tests/` (root/electron/scripts tsconfigs), so typecheck is N/A for this diff.

## 5. Remaining verification (root-owned, OPEN)

1. **Live Windows run** against the real CDP Chrome (127.0.0.1:18792) with the designated QA
   mailbox: expected-account PASS, plus negative controls (wrong account signed in → 11;
   signed-out → non-zero; MFA prompt → 13 with no click). Browser profile/session ownership is a
   root-verified prerequisite; the known ping-up/attach-down Chrome wedge gates this lane.
2. **Selector durability on live OWA:** account-manager (`#meInitialsButton`, `mectrl_*`,
   `#O365_MainLink_Me`) and inbox-control markers were written against known OWA DOM ids but not
   re-verified live in this lane; a live FAIL here is expected to surface as AMBIGUOUS (fail-closed),
   not as a false PASS.
3. **Unowned duplicate:** `skills/laptop/scripts/pilot-login-outlook-cdp.js` still carries the
   original false-PASS behavior (old `OUTLOOK_ALREADY_SIGNED_IN`/`OUTLOOK_SIGNED_IN` tokens).
   Root decision needed: sync or retire it. Not edited — outside this lane's ownership.
4. **Independent review** of this diff (author must not approve).

**Boundary statement:** the QA mailbox is a fixture. This helper and its tests certify nothing
about real principals, who sign into their own accounts per `docs/USER_GUIDE.md` (root-owned).
No source test may claim their authentication works, and this lane does not establish
installed-app acceptance.

## 6. Independent review round 1 (artifacts/INDEPENDENT_REVIEW.md, 2026-09-08): CHANGES_REQUIRED

The review of `02ff4b99` confirmed the original defect class was killed (baseline repro, tab/context
ownership, MFA restraint, fail-closed exit contract, redaction all verified sound) but found four
residual defects via adversarial controls against the exported functions. Retained verbatim as the
exact failing checks:

| Review control | Behavior at 02ff4b99 | Finding |
|---|---|---|
| A3: superstring account `x<expected>` in label + full inbox | `OUTLOOK_SIGNED_IN_VERIFIED` exit 0 | **F1 false PASS** — `accountLabelMatches` used substring `includes` |
| A4: superstring domain `<expected>.attacker.example` | `OUTLOOK_SIGNED_IN_VERIFIED` exit 0 | **F1 false PASS** |
| C3: hidden (`display:none`) `#mectrl_currentAccount_secondary` w/ expected email, dialog closed | `OUTLOOK_SIGNED_IN_VERIFIED` exit 0 | **F4** — no visibility gate on identity nodes |
| E1: root-observed live shape — `#owa-me-control-container button` with display-name-only accessible name, dialog closed, full inbox | AMBIGUOUS exit 12 forever | **F2** — the only PASS unreachable on the actually observed live DOM (collector never opened the account control) |
| E2: `"Account manager for <Display Name>"` label (no email) | `OUTLOOK_WRONG_ACCOUNT_BLOCKED` exit 11, terminal | **F3** — wrong-account overclaim on insufficient identity |

Root's live observation (artifacts/ROOT_AUTH_DOM_UPDATE.md, 2026-09-08 15:01 UTC): the current OWA
header control is `#owa-me-control-container button` (accessible name = display name only); the
exact expected email appears as a **visible `#mectrl_currentAccount_secondary` inside
`role=dialog`/`#mectrl_main_body` only after opening that button** and letting its async content
render. Root sanctioned boundedly opening only that observed control, and forbade loosening
identity to whole-body text or display names.

## 7. Corrections (this revision; fix commit referenced in artifacts/CORRECTION_RECEIPT.md)

- **F1 — exact email-token equality.** `extractEmailTokens` pulls whole email atoms
  (greedy domain tail, so `<expected>.attacker.example` extracts as one longer token);
  `classifyIdentityEvidence` requires a token case-insensitively **equal** to
  `PILOT_TEST_EMAIL`, which must itself normalize to exactly one clean email atom (else nothing
  can match — fail closed). Superstring local/domain labels are now positive *different accounts*
  → exit 11, never 0. Negative controls A3/A4 are unit-pinned.
- **F2 — bounded open of only the observed account control.** New collector fact
  `hasMeControlButton` (visible `#owa-me-control-container button`). When the verified mail origin
  classifies `identity=insufficient`, the settle loop clicks **only that selector, once**, within
  the existing 12×5s budget, then keeps polling for the visible dialog identity
  (`#mectrl_currentAccount_secondary`, root's E3 evidence shape). It never clicks sign out /
  switch account / any approval, and restores menu state afterwards with a single Escape —
  only if it opened the menu itself (`ME_CONTROL_OPENED`/`ME_CONTROL_CLOSED` log lines, no values).
- **F3 — WRONG_ACCOUNT needs positive evidence.** Tri-state identity: `match` /
  `different_account` (≥1 full email token, none equal) / `insufficient` (no email token, e.g.
  display-name-only). Only `different_account` yields `OUTLOOK_WRONG_ACCOUNT_BLOCKED`;
  `insufficient` is AMBIGUOUS and non-terminal so the settle loop can open the account dialog.
  Reason tokens: `identity=match|different_account|insufficient|absent` (never account values).
- **F4 — visible identity nodes only.** The in-page collector filters identity sources through a
  visibility walk (hidden attribute, `aria-hidden`, computed `display:none`/`visibility:hidden` on
  the node and ancestors) plus a rects/offsetParent leg that applies only in layout-capable
  environments (real browser; jsdom fixtures exercise the style walk). Whole-body text and display
  names are never accepted as identity (unit-pinned).

## 8. Test evidence for the corrections

- `pnpm exec vitest run tests/unit/pilot-login-outlook-cdp.test.ts` → **25/25 PASS** (was 15).
  New pins: A3/A4 superstrings (F1), display-name-only ≠ wrong account + non-terminal (F3),
  hidden/aria-hidden/visibility-hidden identity ignored + whole-body text never identity (F4),
  root-observed closed-menu/open-dialog shapes, and a fake-page `settleAndVerify` drive with
  **delayed dialog visibility**: opens exactly `['#owa-me-control-container button']`, presses
  exactly `['Escape']`, verifies expected account; wrong-account-in-dialog variant still restores
  menu state; identity-visible-from-start variant clicks nothing. No live requests, no browser.
- Mutation checks: F1 reverted to substring `includes` → 2 tests fail; F4 visibility gate removed
  → 1 test fails; restored → 25/25.
- Adjacent suites unaffected (108/108 across this + electron-cdp-probe + harness-honesty).
- `pnpm exec eslint` on both owned files: clean. Repo `tsc` lanes still do not cover these paths.

## 9. Remaining verification after round 1 (root-owned, still OPEN)

Unchanged from §5, plus: live confirmation that the bounded me-control open/Escape-restore behaves
on real OWA (menu animation/focus handling), and that `#owa-me-control-container button` +
`#mectrl_currentAccount_secondary` remain the live selectors. The `skills/laptop` duplicate remains
outside scope and still defective — reported separately, not edited. All live work stays
root-owned; this helper ran only against fake DOM fixtures in this lane (live: NOT_RUN).

## Root integration and native controls — September 8, 15:34 UTC

Independent corrective review APPROVE at `59465b57` / `6d47b879` reproduced all 25 tests and its own wrong/superstring account, visible delayed-menu, restricted-click and menu-restore controls. Root integrated the four reviewed commits as `a39dae76`, `605eb29b`, `1ab55df8` and `bbc23ad3`. The separately distributed `skills/laptop/scripts/pilot-login-outlook-cdp.js` now matches the reviewed canonical helper byte-for-byte, SHA256 `aeb85a19f8b1fca112382ba56616133eb91fceb415db21a6cd14044bff824978`; syntax check passes. This operations repair is separate from the already frozen moe.26 build source.

Root copied the helper into an owned test directory on the original Windows VM, verified its hash, and ran it using **the installed moe.25 Node and Playwright runtime**. The SSH operator called it against the verified standard-user Session 2 user Chrome endpoint; this is not a standard-user process-launch attestation. Credential values were supplied privately through SSH stdin/environment and omitted from logs, arguments, board and git.

| Native control | Result | Duration |
|---|---|---|
| Existing signed-in inbox, deliberately different expected account | `OUTLOOK_WRONG_ACCOUNT_BLOCKED`; actual child exit 11 | 18,401 ms |
| Same inbox, exact expected QA account | `OUTLOOK_SIGNED_IN_VERIFIED`; actual child exit 0 | 18,085 ms |

The first root wrapper reported SSH exit 1 for the correctly refused child, so it stopped before the positive control. That failed receipt is retained. Root then recorded `$LASTEXITCODE` explicitly: Windows' outer SSH/PowerShell invocation collapses the nonzero child to SSH 1, while the helper's actual code is 11. No source assertion or exit behavior was weakened. Private proof: `artifacts/ga-fable-20260908/windows-lab/native-auth-helper-controls.json`, `attempt1-native-auth-helper-controls.json`, and the corresponding private native output receipts. The live account-menu behavior now works on actual Outlook. Signed-out credential entry, MFA/consent and final-artifact/end-user acceptance remain separate; these two controls exercised already-authenticated state.
