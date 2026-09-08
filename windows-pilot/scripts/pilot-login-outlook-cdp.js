// pilot-login-outlook-cdp.js - sign the authorized QA test account into the
// already-running CDP Chrome profile on 127.0.0.1:18792 and VERIFY the result.
//
// CLWX-61 hardening: the original script certified OUTLOOK_ALREADY_SIGNED_IN /
// OUTLOOK_SIGNED_IN from the tab URL alone (any */mail* URL passed), could
// adopt an unrelated first tab or create a brand-new browser context, and
// clicked broad submit buttons on whatever page followed the password step.
// That is a false PASS: it never proved WHICH account was signed in, nor that
// a real inbox rendered. This version:
//   - only adopts a tab already on a real Microsoft login/Outlook mail origin
//     (strict origin allowlist, no substring URL matching); otherwise it opens
//     a NEW tab in the EXISTING user context. It never creates a new context
//     and never navigates an unrelated tab.
//   - reports success ONLY when the Outlook mail origin shows BOTH a positive
//     expected-account identity (account-manager labels containing the exact
//     expected address) AND rendered inbox controls (>=2 of message list,
//     folder pane, new-mail button).
//   - classifies MFA / consent / access-denied / unknown-identity pages as
//     BLOCKED or AMBIGUOUS with a non-zero exit code - never a PASS - and
//     never clicks approval/MFA/consent prompts. Only the positively
//     identified KMSI ("Stay signed in?") prompt is confirmed, once.
//   - closes only its own CDP connection; it creates no contexts and closes
//     no tabs, so the operator's browser state is preserved.
//
// Independent-review corrections (artifacts/INDEPENDENT_REVIEW.md, F1-F4),
// against the root-observed live DOM (artifacts/ROOT_AUTH_DOM_UPDATE.md):
//   - F1: identity is exact email-token equality (case-insensitive), never a
//     substring test; superstring local parts ("x<expected>") and superstring
//     domains ("<expected>.attacker.example") are different accounts.
//   - F2: on the live OWA header the accessible name of
//     #owa-me-control-container button is display-name-only; the exact email
//     renders asynchronously as a visible #mectrl_currentAccount_secondary
//     inside the role=dialog/#mectrl_main_body account card only after that
//     button is opened. When the verified mail origin shows insufficient
//     identity, the settle loop opens ONLY that observed button, once,
//     bounded by its existing 12x5s budget, then reads the visible dialog
//     identity. It restores menu state via a single Escape if it opened the
//     menu, and never clicks sign out / switch account / any approval.
//   - F3: OUTLOOK_WRONG_ACCOUNT_BLOCKED requires positive evidence of a
//     DIFFERENT full email token; display-name-only or absent labels are
//     insufficient identity (AMBIGUOUS), not a wrong-account claim.
//   - F4: identity labels are collected from visible nodes only; whole-body
//     text and display names are never accepted as identity.
//
// This is a QA fixture helper for the designated test mailbox. It does NOT
// establish installed-app acceptance, and no source test may claim a real
// principal's authentication works: principals sign into their own accounts
// per docs/USER_GUIDE.md. Browser profile/session ownership is a root-verified
// prerequisite.
//
// Inputs (mandatory):
//   PILOT_TEST_EMAIL
//   PILOT_TEST_PASSWORD
// Optional:
//   PILOT_CDP_ENDPOINT (default http://127.0.0.1:18792)
//
// Output never prints passwords, account values, mail bodies, tokens or URL
// query strings.
//
// STATE lines and exit codes:
//   OUTLOOK_SIGNED_IN_VERIFIED             0  identity match + inbox controls
//   LOGIN_SCRIPT_FAILED                    1  unexpected error
//   MISSING_CREDENTIAL_ENV                 2  env credentials absent
//   PASSWORD_FIELD_NOT_FOUND              10  credential form never offered a
//                                             password control
//   OUTLOOK_WRONG_ACCOUNT_BLOCKED         11  a DIFFERENT account is signed in
//   OUTLOOK_SIGNIN_UNVERIFIED_AMBIGUOUS   12  mail URL but identity unknown or
//                                             inbox controls missing
//   LOGIN_BLOCKED_MFA_OR_CONSENT          13  MFA/consent prompt (not clicked)
//   LOGIN_BLOCKED_ACCESS_DENIED           14  access denied / account error
//   LOGIN_BLOCKED_NO_BROWSER_CONTEXT      15  no existing context to attach to
//   LOGIN_AMBIGUOUS                       16  no positive terminal evidence
//   AUTH_REQUIRED                         17  credential form still pending

const path = require('node:path');

const cdp = process.env.PILOT_CDP_ENDPOINT || 'http://127.0.0.1:18792';

const STATE_EXIT_CODES = {
  OUTLOOK_SIGNED_IN_VERIFIED: 0,
  LOGIN_SCRIPT_FAILED: 1,
  MISSING_CREDENTIAL_ENV: 2,
  PASSWORD_FIELD_NOT_FOUND: 10,
  OUTLOOK_WRONG_ACCOUNT_BLOCKED: 11,
  OUTLOOK_SIGNIN_UNVERIFIED_AMBIGUOUS: 12,
  LOGIN_BLOCKED_MFA_OR_CONSENT: 13,
  LOGIN_BLOCKED_ACCESS_DENIED: 14,
  LOGIN_BLOCKED_NO_BROWSER_CONTEXT: 15,
  LOGIN_AMBIGUOUS: 16,
  AUTH_REQUIRED: 17,
};

// States that end the run immediately; none of them is a PASS except the
// verified sign-in itself.
const TERMINAL_BLOCKED_STATES = new Set([
  'OUTLOOK_WRONG_ACCOUNT_BLOCKED',
  'LOGIN_BLOCKED_MFA_OR_CONSENT',
  'LOGIN_BLOCKED_ACCESS_DENIED',
  'LOGIN_BLOCKED_NO_BROWSER_CONTEXT',
]);

// Real Microsoft origins only. Substring matching such as /outlook\./i is the
// original defect: it also matched lookalike hosts and unrelated paths.
const OUTLOOK_MAIL_HOSTS = new Set([
  'outlook.office.com',
  'outlook.office365.com',
  'outlook.cloud.microsoft',
]);
const MICROSOFT_LOGIN_HOSTS = new Set(['login.microsoftonline.com']);

function parseHttpsUrl(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === 'https:' ? u : null;
  } catch {
    return null;
  }
}

function isOutlookMailUrl(url) {
  const u = parseHttpsUrl(url);
  return Boolean(u && OUTLOOK_MAIL_HOSTS.has(u.hostname) && u.pathname.toLowerCase().startsWith('/mail'));
}

function isMicrosoftLoginUrl(url) {
  const u = parseHttpsUrl(url);
  return Boolean(u && MICROSOFT_LOGIN_HOSTS.has(u.hostname));
}

// Adopt only a tab that is already on an owned Microsoft surface. Never fall
// back to "first tab" - that adopted (and then navigated) unrelated pages.
function selectOwnedPage(pages) {
  for (const page of pages || []) {
    let url;
    try {
      url = page.url();
    } catch {
      continue;
    }
    if (isOutlookMailUrl(url) || isMicrosoftLoginUrl(url)) return page;
  }
  return null;
}

function redactUrl(url) {
  try {
    const u = new URL(String(url));
    return `${u.origin}${u.pathname}`;
  } catch {
    // Never echo unparseable input that could carry tokens/query fragments.
    return 'unparseable-url';
  }
}

// Review F1: identity comparison must be EXACT email-token equality, never a
// substring test. A substring match passed superstring accounts such as
// "x<expected>" and "<expected>.attacker.example" - both are different
// accounts. Tokens are extracted as whole email atoms; the greedy domain tail
// means a superstring domain extracts as one longer token that fails equality.
function extractEmailTokens(value) {
  const text = String(value || '').toLowerCase();
  return text.match(/[a-z0-9._%+'-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/g) || [];
}

// Review F1+F3: tri-state identity evidence.
//   'match'             - some collected label carries a token exactly equal
//                         to the expected address (case-insensitive)
//   'different_account' - labels carry at least one full email token and NONE
//                         equals the expected address (positive evidence of a
//                         different account - the only WRONG_ACCOUNT trigger)
//   'insufficient'      - no email token at all (e.g. display-name-only
//                         labels, empty labels): unknown identity, never a
//                         match and never a wrong-account claim
function classifyIdentityEvidence(labels, expectedEmail) {
  const expected = String(expectedEmail || '').trim().toLowerCase();
  const expectedTokens = extractEmailTokens(expected);
  // The expected value must itself be exactly one clean email atom; otherwise
  // no label can ever "match" (fail closed, never loosen the comparison).
  const expectedValid = expectedTokens.length === 1 && expectedTokens[0] === expected;
  const observedTokens = [];
  for (const label of labels || []) {
    for (const token of extractEmailTokens(label)) observedTokens.push(token);
  }
  if (observedTokens.length === 0) return 'insufficient';
  if (expectedValid && observedTokens.some((token) => token === expected)) return 'match';
  return 'different_account';
}

// True only on exact-token identity match. Display names, partial addresses
// and superstrings never match.
function accountLabelMatches(labels, expectedEmail) {
  return classifyIdentityEvidence(labels, expectedEmail) === 'match';
}

// Runs INSIDE the page via page.evaluate: must stay self-contained (no outer
// closures). Also exercised directly against fake DOM fixtures in
// tests/unit/pilot-login-outlook-cdp.test.ts.
// Review F2 (root-observed 2026-09-08 DOM, artifacts/ROOT_AUTH_DOM_UPDATE.md):
// the live header control is `#owa-me-control-container button` whose
// accessible name is display-name-only; the exact email renders async inside
// role=dialog / #mectrl_main_body as #mectrl_currentAccount_secondary AFTER
// that button is opened. The collector therefore also reports whether the
// account control button is visible so the flow can boundedly open it.
// Review F4: identity is read from VISIBLE nodes only (hidden mectrl content
// is not root's evidence bar). The rect/offsetParent leg applies only in
// layout-capable environments (real browser); style/hidden/aria-hidden walks
// apply everywhere including jsdom fixtures.
function collectOutlookPageFactsInPage() {
  const doc = document;
  const q = (selector) => {
    try {
      return Array.from(doc.querySelectorAll(selector));
    } catch {
      return [];
    }
  };
  const present = (selector) => q(selector).length > 0;
  const clip = (value) => String(value || '').trim().slice(0, 200);

  let layoutCapable = false;
  try {
    layoutCapable = Boolean(doc.body && doc.body.getClientRects().length > 0);
  } catch {
    layoutCapable = false;
  }
  const isVisibleNode = (el) => {
    if (!el) return false;
    const win = doc.defaultView;
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      if (node.hidden) return false;
      if (node.getAttribute && node.getAttribute('aria-hidden') === 'true') return false;
      if (win && typeof win.getComputedStyle === 'function') {
        let style = null;
        try {
          style = win.getComputedStyle(node);
        } catch {
          style = null;
        }
        if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
      }
    }
    if (layoutCapable) {
      try {
        return el.getClientRects().length > 0 || el.offsetParent !== null;
      } catch {
        return false;
      }
    }
    return true;
  };
  const visibleOnly = (selector) => q(selector).filter(isVisibleNode);

  const accountLabels = [];
  const pushLabel = (value) => {
    const text = clip(value);
    if (text && accountLabels.length < 8 && !accountLabels.includes(text)) accountLabels.push(text);
  };
  for (const el of visibleOnly(
    '#meInitialsButton, #O365_MainLink_Me, #owa-me-control-container button, [aria-label*="Account manager" i]',
  )) {
    pushLabel(el.getAttribute('aria-label'));
    pushLabel(el.getAttribute('title'));
  }
  // Account-dialog identity nodes (root-verified evidence shape): visible
  // mectrl current-account entries, including #mectrl_currentAccount_secondary
  // which carries the exact email once the dialog has rendered.
  for (const el of visibleOnly('[id^="mectrl_currentAccount"]')) pushLabel(el.textContent);

  const hasMeControlButton = visibleOnly('#owa-me-control-container button').length > 0;

  const headingText = q('[role="heading"], h1, h2, .text-title, #loginHeader')
    .map((el) => clip(el.textContent))
    .join(' | ')
    .toLowerCase();

  return {
    accountLabels,
    hasMeControlButton,
    hasEmailInput: present('input[type="email"], input[name="loginfmt"], #i0116'),
    hasPasswordInput: present('input[type="password"], input[name="passwd"], #i0118'),
    hasMessageList: present('[aria-label="Message list" i], [data-app-section="MessageList"], #MailList'),
    hasFolderPane: present('[aria-label="Folder pane" i], [data-app-section="NavigationPane"]'),
    hasNewMailButton: present('button[aria-label*="New mail" i], [aria-label="New mail" i]'),
    hasKmsiPrompt:
      present('#KmsiCheckboxField, #KmsiDescription') || /stay signed in/.test(headingText),
    hasMfaOrConsentPrompt:
      present('#idDiv_SAOTCS_Title, #idDiv_SAOTCC_Title, #idDiv_SAASDS_Title') ||
      /verify your identity|approve sign in|approve a request|enter code|enter the code|permissions requested|more information required/.test(
        headingText,
      ),
    hasAccessDeniedError:
      present('#service_exception_message, #errorText') ||
      /access denied|you can't access|account has been locked|sign-in is blocked|aadsts/.test(headingText),
  };
}

// Pure verdict: URL + collected page facts + expected account -> typed state.
// Reasons carry only booleans/counts, never account values or page text.
function classifySignInState(url, facts, expectedEmail) {
  if (!facts) return { state: 'LOGIN_AMBIGUOUS', reasons: ['page_facts_unavailable'] };
  // MFA/consent and hard errors dominate everything else: they are BLOCKED,
  // never clicked through and never a PASS.
  if (facts.hasMfaOrConsentPrompt) {
    return { state: 'LOGIN_BLOCKED_MFA_OR_CONSENT', reasons: ['mfa_or_consent_prompt_present'] };
  }
  if (facts.hasAccessDeniedError) {
    return { state: 'LOGIN_BLOCKED_ACCESS_DENIED', reasons: ['access_denied_marker_present'] };
  }
  if (isMicrosoftLoginUrl(url)) {
    if (facts.hasKmsiPrompt) return { state: 'KMSI_CONFIRM_PENDING', reasons: ['kmsi_prompt_present'] };
    if (facts.hasEmailInput || facts.hasPasswordInput) {
      return { state: 'AUTH_REQUIRED', reasons: ['credential_form_present'] };
    }
    return { state: 'LOGIN_AMBIGUOUS', reasons: ['login_origin_without_known_controls'] };
  }
  if (isOutlookMailUrl(url)) {
    if (facts.hasEmailInput || facts.hasPasswordInput) {
      return { state: 'AUTH_REQUIRED', reasons: ['credential_form_on_mail_origin'] };
    }
    const inboxControlCount = [facts.hasMessageList, facts.hasFolderPane, facts.hasNewMailButton].filter(
      Boolean,
    ).length;
    const reasons = [`inbox_controls=${inboxControlCount}/3`];
    const labels = facts.accountLabels || [];
    const identity = classifyIdentityEvidence(labels, expectedEmail);
    if (identity === 'different_account') {
      // Review F3: only a positive DIFFERENT full email token means wrong
      // account. Display-name-only or absent labels are insufficient
      // identity, never a wrong-account claim.
      reasons.push('identity=different_account');
      return { state: 'OUTLOOK_WRONG_ACCOUNT_BLOCKED', reasons, identity };
    }
    if (identity === 'match') {
      reasons.push('identity=match');
      if (inboxControlCount >= 2) {
        return { state: 'OUTLOOK_SIGNED_IN_VERIFIED', reasons, identity };
      }
      reasons.push('inbox_controls_insufficient');
      return { state: 'OUTLOOK_SIGNIN_UNVERIFIED_AMBIGUOUS', reasons, identity };
    }
    reasons.push(labels.length === 0 ? 'identity=absent' : 'identity=insufficient');
    return { state: 'OUTLOOK_SIGNIN_UNVERIFIED_AMBIGUOUS', reasons, identity };
  }
  return { state: 'LOGIN_AMBIGUOUS', reasons: ['unrecognized_origin'] };
}

async function collectPageFacts(page) {
  try {
    return await page.evaluate(collectOutlookPageFactsInPage);
  } catch {
    return null;
  }
}

async function clickIfVisible(page, selectors, timeout = 2500) {
  for (const selector of selectors) {
    const loc = page.locator(selector).first();
    try {
      if (await loc.isVisible({ timeout })) {
        await loc.click({ timeout: 5000 });
        return selector;
      }
    } catch {
      // Try next selector.
    }
  }
  return null;
}

async function fillIfVisible(page, selectors, value, timeout = 5000) {
  for (const selector of selectors) {
    const loc = page.locator(selector).first();
    try {
      if (await loc.isVisible({ timeout })) {
        await loc.fill(value, { timeout: 10000 });
        return selector;
      }
    } catch {
      // Try next selector.
    }
  }
  return null;
}

// Credential entry runs ONLY on a positively identified Microsoft login
// origin page (checked by the caller). Submit clicks here advance the
// credential form; they are not post-login blind clicks.
async function performCredentialEntry(page, email, password) {
  const emailSelector = await fillIfVisible(
    page,
    ['input[type="email"]', 'input[name="loginfmt"]', '#i0116'],
    email,
    10000,
  );
  console.log(`EMAIL_FILLED: ${emailSelector ? 'yes' : 'no'}`);
  if (emailSelector) {
    await clickIfVisible(page, ['#idSIButton9', 'input[type="submit"]', 'button[type="submit"]'], 10000);
  }

  const passwordSelector = await fillIfVisible(
    page,
    ['input[type="password"]', 'input[name="passwd"]', '#i0118'],
    password,
    30000,
  );
  if (!passwordSelector) {
    // Passwordless/MFA-first tenants land here: classify instead of guessing.
    const verdict = classifySignInState(page.url(), await collectPageFacts(page), email);
    if (TERMINAL_BLOCKED_STATES.has(verdict.state)) return verdict;
    console.log(`PASSWORD_FIELD_NOT_FOUND url=${redactUrl(page.url())}`);
    return { state: 'PASSWORD_FIELD_NOT_FOUND', reasons: ['password_control_absent'] };
  }
  console.log('PASSWORD_FILLED: yes');
  await clickIfVisible(page, ['#idSIButton9', 'input[type="submit"]', 'button[type="submit"]'], 10000);
  return null;
}

// After credential entry (or on an already-open mail tab) poll the page and
// return only a positively classified terminal verdict. MFA/consent prompts
// are reported, never clicked. Only the positively identified KMSI prompt is
// confirmed, once.
// Review F2: on the live OWA DOM the exact email is hidden until the account
// control is opened (see collector note). When the verified mail origin shows
// insufficient/absent identity and the root-observed #owa-me-control-container
// button is visible, this loop opens THAT BUTTON ONLY, once, then keeps
// polling (bounded by the same 12x5s budget) for the visible account-dialog
// identity (#mectrl_currentAccount_secondary). It never clicks sign out,
// switch account, approval or any other menu item, and it restores the user's
// menu state afterwards with a single best-effort Escape - only if it opened
// the menu itself.
async function settleAndVerify(page, expectedEmail) {
  let kmsiConfirmed = false;
  let meControlOpened = false;
  let last = { state: 'LOGIN_AMBIGUOUS', reasons: ['no_settle_observation'] };
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await page.waitForTimeout(5000);
    const facts = await collectPageFacts(page);
    last = classifySignInState(page.url(), facts, expectedEmail);
    if (last.state === 'OUTLOOK_SIGNED_IN_VERIFIED' || TERMINAL_BLOCKED_STATES.has(last.state)) break;
    if (last.state === 'KMSI_CONFIRM_PENDING' && !kmsiConfirmed) {
      kmsiConfirmed = true;
      await clickIfVisible(page, ['#idSIButton9'], 5000);
      continue;
    }
    if (
      !meControlOpened &&
      last.state === 'OUTLOOK_SIGNIN_UNVERIFIED_AMBIGUOUS' &&
      last.identity === 'insufficient' &&
      facts &&
      facts.hasMeControlButton &&
      isOutlookMailUrl(page.url())
    ) {
      meControlOpened = true;
      console.log('ME_CONTROL_OPENED: yes');
      await clickIfVisible(page, ['#owa-me-control-container button'], 5000);
    }
  }
  if (meControlOpened) {
    // Preserve the user's menu state: close only the menu this helper opened,
    // via Escape (never a click that could land on sign-out/switch-account).
    try {
      await page.keyboard.press('Escape');
      console.log('ME_CONTROL_CLOSED: escape_sent');
    } catch {
      console.log('ME_CONTROL_CLOSED: escape_failed_menu_may_remain_open');
    }
  }
  console.log(`URL_AFTER: ${redactUrl(page.url())}`);
  if (last.state === 'KMSI_CONFIRM_PENDING' || last.state === 'AUTH_REQUIRED') {
    return { state: 'LOGIN_AMBIGUOUS', reasons: [...last.reasons, 'settle_timeout'] };
  }
  return last;
}

async function runSignInFlow(browser, email, password) {
  const context = browser.contexts()[0];
  if (!context) {
    // Never create a context: an empty CDP browser is not the operator's
    // signed-in profile, and certifying against it would be meaningless.
    return { state: 'LOGIN_BLOCKED_NO_BROWSER_CONTEXT', reasons: ['no_existing_browser_context'] };
  }

  let page = selectOwnedPage(context.pages());
  if (!page) {
    // New tab in the EXISTING user context; unrelated tabs are never adopted
    // or navigated, and this script closes no tabs.
    page = await context.newPage();
  }
  if (!isOutlookMailUrl(page.url()) && !isMicrosoftLoginUrl(page.url())) {
    await page.goto('https://outlook.office.com/mail/inbox', {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });
  }
  await page.waitForLoadState('domcontentloaded', { timeout: 45000 }).catch(() => {});
  console.log(`URL_BEFORE: ${redactUrl(page.url())}`);

  const initial = classifySignInState(page.url(), await collectPageFacts(page), email);
  if (initial.state === 'OUTLOOK_SIGNED_IN_VERIFIED' || TERMINAL_BLOCKED_STATES.has(initial.state)) {
    console.log(`URL_AFTER: ${redactUrl(page.url())}`);
    return initial;
  }
  if (initial.state === 'AUTH_REQUIRED' && isMicrosoftLoginUrl(page.url())) {
    const failure = await performCredentialEntry(page, email, password);
    if (failure) return failure;
  }
  return settleAndVerify(page, email);
}

function resolveChromium() {
  const playwrightPath = path.join(
    process.env.LOCALAPPDATA || '',
    'Programs',
    'Ministry of Education',
    'resources',
    'openclaw',
    'node_modules',
    'playwright-core',
  );
  // Installed-app runtime resolve on the Windows box only; kept out of module
  // scope so tests can require this file without Playwright present.
  return require(playwrightPath).chromium;
}

async function main() {
  const email = process.env.PILOT_TEST_EMAIL;
  const password = process.env.PILOT_TEST_PASSWORD;
  if (!email || !password) {
    console.error('STATE: MISSING_CREDENTIAL_ENV');
    process.exit(STATE_EXIT_CODES.MISSING_CREDENTIAL_ENV);
  }

  console.log(`CDP: ${cdp}`);
  const chromium = resolveChromium();
  const browser = await chromium.connectOverCDP(cdp, { timeout: 10000 });
  let outcome = { state: 'LOGIN_AMBIGUOUS', reasons: ['flow_did_not_complete'] };
  try {
    outcome = await runSignInFlow(browser, email, password);
  } finally {
    // This script creates no browser contexts, so close() only disconnects
    // the owned CDP connection; the operator's tabs and sessions survive.
    await browser.close().catch(() => {});
  }
  console.log(`STATE: ${outcome.state}`);
  if (outcome.reasons && outcome.reasons.length) {
    console.log(`REASONS: ${outcome.reasons.join(' ')}`);
  }
  process.exit(
    Object.prototype.hasOwnProperty.call(STATE_EXIT_CODES, outcome.state)
      ? STATE_EXIT_CODES[outcome.state]
      : STATE_EXIT_CODES.LOGIN_AMBIGUOUS,
  );
}

module.exports = {
  STATE_EXIT_CODES,
  TERMINAL_BLOCKED_STATES,
  accountLabelMatches,
  classifyIdentityEvidence,
  classifySignInState,
  collectOutlookPageFactsInPage,
  extractEmailTokens,
  isMicrosoftLoginUrl,
  isOutlookMailUrl,
  redactUrl,
  selectOwnedPage,
  settleAndVerify,
};

if (require.main === module) {
  main().catch((err) => {
    console.error('STATE: LOGIN_SCRIPT_FAILED');
    console.error(`ERROR: ${err && err.message ? err.message : String(err)}`);
    process.exit(STATE_EXIT_CODES.LOGIN_SCRIPT_FAILED);
  });
}
