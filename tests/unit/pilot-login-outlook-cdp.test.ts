// CLWX-61: the pilot Outlook login helper certified sign-in from the tab URL
// alone (any */mail* URL => OUTLOOK_SIGNED_IN), without expected-account
// identity or real inbox controls, and could adopt an unrelated first tab.
// These tests pin the hardened verdict path against fake DOM pages only - no
// live requests, no browser attach. The QA mailbox is a fixture; nothing here
// claims a real principal's authentication works.
import { beforeEach, describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- the helper is a CommonJS Windows CLI script.
const helper = require('../../windows-pilot/scripts/pilot-login-outlook-cdp.js') as {
  STATE_EXIT_CODES: Record<string, number>;
  TERMINAL_BLOCKED_STATES: Set<string>;
  accountLabelMatches: (labels: string[], expectedEmail: string) => boolean;
  classifySignInState: (
    url: string,
    facts: Record<string, unknown> | null,
    expectedEmail: string,
  ) => { state: string; reasons: string[] };
  collectOutlookPageFactsInPage: () => {
    accountLabels: string[];
    hasEmailInput: boolean;
    hasPasswordInput: boolean;
    hasMessageList: boolean;
    hasFolderPane: boolean;
    hasNewMailButton: boolean;
    hasKmsiPrompt: boolean;
    hasMfaOrConsentPrompt: boolean;
    hasAccessDeniedError: boolean;
  };
  isMicrosoftLoginUrl: (url: string) => boolean;
  isOutlookMailUrl: (url: string) => boolean;
  redactUrl: (url: string) => string;
  selectOwnedPage: (pages: Array<{ url: () => string }>) => { url: () => string } | null;
};

const {
  STATE_EXIT_CODES,
  accountLabelMatches,
  classifySignInState,
  collectOutlookPageFactsInPage,
  isMicrosoftLoginUrl,
  isOutlookMailUrl,
  redactUrl,
  selectOwnedPage,
} = helper;

// Deliberately fake fixture identity - never a real credential.
const EXPECTED_EMAIL = 'qa.fixture@example.edu.tt';
const MAIL_URL = 'https://outlook.office.com/mail/inbox';
const LOGIN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';

function factsFromBody(html: string) {
  document.body.innerHTML = html;
  return collectOutlookPageFactsInPage();
}

const SIGNED_IN_INBOX_HTML = `
  <button id="meInitialsButton" aria-label="Account manager for ${EXPECTED_EMAIL}"></button>
  <div role="listbox" aria-label="Message list"></div>
  <div aria-label="Folder pane"></div>
  <button aria-label="New mail"></button>
`;

const LOGIN_FORM_HTML = `
  <div role="heading">Sign in</div>
  <input type="email" name="loginfmt" id="i0116" />
  <input type="submit" id="idSIButton9" value="Next" />
`;

const MFA_HTML = `
  <div id="idDiv_SAOTCS_Title" role="heading">Verify your identity</div>
  <div>Approve a request on my Microsoft Authenticator app</div>
`;

const KMSI_HTML = `
  <div role="heading">Stay signed in?</div>
  <input type="checkbox" id="KmsiCheckboxField" />
  <input type="submit" id="idSIButton9" value="Yes" />
`;

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('regression pin: the original false PASS', () => {
  it('a bare Outlook mail URL with no identity and no inbox controls is NEVER signed in', () => {
    // Original behavior: /outlook\.(office|cloud|office365)\.com\/mail/ on the
    // URL alone printed STATE: OUTLOOK_SIGNED_IN / OUTLOOK_ALREADY_SIGNED_IN.
    const facts = factsFromBody('<div>loading...</div>');
    const verdict = classifySignInState(MAIL_URL, facts, EXPECTED_EMAIL);
    expect(verdict.state).toBe('OUTLOOK_SIGNIN_UNVERIFIED_AMBIGUOUS');
    expect(verdict.reasons).toContain('identity=absent');
    expect(STATE_EXIT_CODES[verdict.state]).not.toBe(0);
  });

  it('unavailable page facts never classify as signed in', () => {
    const verdict = classifySignInState(MAIL_URL, null, EXPECTED_EMAIL);
    expect(verdict.state).toBe('LOGIN_AMBIGUOUS');
    expect(STATE_EXIT_CODES[verdict.state]).not.toBe(0);
  });
});

describe('login form page', () => {
  it('classifies a Microsoft login page with credential controls as AUTH_REQUIRED, not signed in', () => {
    const facts = factsFromBody(LOGIN_FORM_HTML);
    expect(facts.hasEmailInput).toBe(true);
    const verdict = classifySignInState(LOGIN_URL, facts, EXPECTED_EMAIL);
    expect(verdict.state).toBe('AUTH_REQUIRED');
    expect(STATE_EXIT_CODES[verdict.state]).not.toBe(0);
  });

  it('credential controls rendered on the mail origin still mean AUTH_REQUIRED', () => {
    const facts = factsFromBody(LOGIN_FORM_HTML);
    const verdict = classifySignInState(MAIL_URL, facts, EXPECTED_EMAIL);
    expect(verdict.state).toBe('AUTH_REQUIRED');
  });
});

describe('wrong account', () => {
  it('blocks when a DIFFERENT account is signed into a fully rendered inbox', () => {
    const facts = factsFromBody(
      SIGNED_IN_INBOX_HTML.replace(EXPECTED_EMAIL, 'someone.else@example.edu.tt'),
    );
    const verdict = classifySignInState(MAIL_URL, facts, EXPECTED_EMAIL);
    expect(verdict.state).toBe('OUTLOOK_WRONG_ACCOUNT_BLOCKED');
    expect(verdict.reasons).toContain('identity=mismatch');
    expect(STATE_EXIT_CODES[verdict.state]).not.toBe(0);
    // Output hygiene: reasons must never leak account values.
    expect(verdict.reasons.join(' ')).not.toMatch(/@/);
  });

  it('accountLabelMatches requires the full expected address, case-insensitively', () => {
    expect(accountLabelMatches([`Account manager for ${EXPECTED_EMAIL.toUpperCase()}`], EXPECTED_EMAIL)).toBe(true);
    expect(accountLabelMatches(['Account manager for other@example.edu.tt'], EXPECTED_EMAIL)).toBe(false);
    expect(accountLabelMatches(['Account manager for qa.fixture'], EXPECTED_EMAIL)).toBe(false);
    expect(accountLabelMatches([], EXPECTED_EMAIL)).toBe(false);
    expect(accountLabelMatches([`Account manager for ${EXPECTED_EMAIL}`], '')).toBe(false);
  });
});

describe('MFA / consent / access denial', () => {
  it('classifies an MFA prompt as BLOCKED, never signed in, even with inbox-like controls present', () => {
    const facts = factsFromBody(MFA_HTML + SIGNED_IN_INBOX_HTML);
    const verdict = classifySignInState(MAIL_URL, facts, EXPECTED_EMAIL);
    expect(verdict.state).toBe('LOGIN_BLOCKED_MFA_OR_CONSENT');
    expect(helper.TERMINAL_BLOCKED_STATES.has(verdict.state)).toBe(true);
    expect(STATE_EXIT_CODES[verdict.state]).not.toBe(0);
  });

  it('distinguishes the benign KMSI prompt from MFA: KMSI is confirm-pending, MFA wins if both match', () => {
    const kmsi = classifySignInState(LOGIN_URL, factsFromBody(KMSI_HTML), EXPECTED_EMAIL);
    expect(kmsi.state).toBe('KMSI_CONFIRM_PENDING');
    // If any MFA/consent marker is present alongside KMSI text, block - do not click.
    const both = classifySignInState(LOGIN_URL, factsFromBody(KMSI_HTML + MFA_HTML), EXPECTED_EMAIL);
    expect(both.state).toBe('LOGIN_BLOCKED_MFA_OR_CONSENT');
  });

  it('classifies access-denied markers as BLOCKED', () => {
    const facts = factsFromBody('<div id="service_exception_message">AADSTS53003</div>');
    const verdict = classifySignInState(LOGIN_URL, facts, EXPECTED_EMAIL);
    expect(verdict.state).toBe('LOGIN_BLOCKED_ACCESS_DENIED');
    expect(STATE_EXIT_CODES[verdict.state]).not.toBe(0);
  });
});

describe('verified sign-in (the only PASS)', () => {
  it('passes only with expected-account identity AND rendered inbox controls', () => {
    const facts = factsFromBody(SIGNED_IN_INBOX_HTML);
    expect(facts.accountLabels.length).toBeGreaterThan(0);
    const verdict = classifySignInState(MAIL_URL, facts, EXPECTED_EMAIL);
    expect(verdict.state).toBe('OUTLOOK_SIGNED_IN_VERIFIED');
    expect(verdict.reasons).toContain('identity=match');
    expect(STATE_EXIT_CODES[verdict.state]).toBe(0);
  });

  it('identity match WITHOUT inbox controls stays ambiguous', () => {
    const facts = factsFromBody(
      `<button id="meInitialsButton" aria-label="Account manager for ${EXPECTED_EMAIL}"></button>`,
    );
    const verdict = classifySignInState(MAIL_URL, facts, EXPECTED_EMAIL);
    expect(verdict.state).toBe('OUTLOOK_SIGNIN_UNVERIFIED_AMBIGUOUS');
    expect(verdict.reasons).toContain('inbox_controls_insufficient');
  });

  it('inbox controls on a NON-Microsoft origin never pass', () => {
    const facts = factsFromBody(SIGNED_IN_INBOX_HTML);
    const verdict = classifySignInState('https://evil.example/outlook.office.com/mail', facts, EXPECTED_EMAIL);
    expect(verdict.state).toBe('LOGIN_AMBIGUOUS');
    expect(verdict.reasons).toContain('unrecognized_origin');
  });
});

describe('tab selection scoping', () => {
  const fakePage = (url: string) => ({ url: () => url });

  it('adopts only real Microsoft login/Outlook mail origins, never the first unrelated tab', () => {
    const unrelated = fakePage('https://news.example/outlook.office.com/mail');
    const lookalike = fakePage('https://outlook.office.com.evil.example/mail/inbox');
    const http = fakePage('http://outlook.office.com/mail/inbox');
    const real = fakePage(MAIL_URL);
    expect(selectOwnedPage([unrelated, lookalike, http, real])).toBe(real);
    expect(selectOwnedPage([unrelated, lookalike, http])).toBeNull();
    expect(selectOwnedPage([])).toBeNull();
  });

  it('recognizes only strict Microsoft origins', () => {
    expect(isOutlookMailUrl('https://outlook.office365.com/mail/')).toBe(true);
    expect(isOutlookMailUrl('https://outlook.cloud.microsoft/mail/inbox')).toBe(true);
    expect(isOutlookMailUrl('https://outlook.office.com/calendar/view')).toBe(false);
    expect(isOutlookMailUrl('https://outlook.office.com.evil.example/mail')).toBe(false);
    expect(isMicrosoftLoginUrl('https://login.microsoftonline.com/common')).toBe(true);
    expect(isMicrosoftLoginUrl('https://login.microsoftonline.com.evil.example/')).toBe(false);
    expect(isMicrosoftLoginUrl('not a url')).toBe(false);
  });
});

describe('output hygiene', () => {
  it('redactUrl strips query strings and fragments and never echoes unparseable input', () => {
    expect(redactUrl('https://outlook.office.com/mail/inbox?token=SECRET#frag')).toBe(
      'https://outlook.office.com/mail/inbox',
    );
    expect(redactUrl('login?code=SECRET')).toBe('unparseable-url');
  });
});
