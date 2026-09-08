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
