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
  classifyIdentityEvidence: (labels: string[], expectedEmail: string) => string;
  extractEmailTokens: (value: string) => string[];
  classifySignInState: (
    url: string,
    facts: Record<string, unknown> | null,
    expectedEmail: string,
  ) => { state: string; reasons: string[]; identity?: string };
  settleAndVerify: (
    page: unknown,
    expectedEmail: string,
  ) => Promise<{ state: string; reasons: string[] }>;
  collectOutlookPageFactsInPage: () => {
    accountLabels: string[];
    hasMeControlButton: boolean;
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
  classifyIdentityEvidence,
  classifySignInState,
  collectOutlookPageFactsInPage,
  extractEmailTokens,
  isMicrosoftLoginUrl,
  isOutlookMailUrl,
  redactUrl,
  selectOwnedPage,
  settleAndVerify,
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
    expect(verdict.reasons).toContain('identity=different_account');
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

  it('F1: superstring local-part and domain accounts are DIFFERENT accounts, never a PASS', () => {
    // Review controls A3/A4: substring matching passed both of these.
    const superLocal = `x${EXPECTED_EMAIL}`; // xqa.fixture@example.edu.tt
    const superDomain = `${EXPECTED_EMAIL}.attacker.example`;
    for (const account of [superLocal, superDomain]) {
      expect(accountLabelMatches([`Account manager for ${account}`], EXPECTED_EMAIL)).toBe(false);
      const facts = factsFromBody(SIGNED_IN_INBOX_HTML.replace(EXPECTED_EMAIL, account));
      const verdict = classifySignInState(MAIL_URL, facts, EXPECTED_EMAIL);
      expect(verdict.state).toBe('OUTLOOK_WRONG_ACCOUNT_BLOCKED');
      expect(STATE_EXIT_CODES[verdict.state]).not.toBe(0);
    }
    // Exact token embedded in surrounding punctuation still matches exactly.
    expect(accountLabelMatches([`Account manager for ${EXPECTED_EMAIL}.`], EXPECTED_EMAIL)).toBe(true);
    expect(extractEmailTokens(`a ${EXPECTED_EMAIL} b`)).toEqual([EXPECTED_EMAIL]);
    expect(extractEmailTokens(`${EXPECTED_EMAIL}.attacker.example`)).toEqual([
      `${EXPECTED_EMAIL}.attacker.example`,
    ]);
  });

  it('F3: display-name-only labels are insufficient identity, NOT a wrong-account claim', () => {
    // Review control E2: the live me-control accessible name is display-name-only.
    const facts = factsFromBody(
      SIGNED_IN_INBOX_HTML.replace(
        `aria-label="Account manager for ${EXPECTED_EMAIL}"`,
        'aria-label="Account manager for Dana Q. Fixture"',
      ),
    );
    const verdict = classifySignInState(MAIL_URL, facts, EXPECTED_EMAIL);
    expect(verdict.state).toBe('OUTLOOK_SIGNIN_UNVERIFIED_AMBIGUOUS');
    expect(verdict.reasons).toContain('identity=insufficient');
    // Non-terminal: the settle loop may still resolve identity (account dialog).
    expect(helper.TERMINAL_BLOCKED_STATES.has(verdict.state)).toBe(false);
    expect(classifyIdentityEvidence(['Dana Q. Fixture'], EXPECTED_EMAIL)).toBe('insufficient');
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

describe('F4: visible identity nodes only', () => {
  const HIDDEN_DIALOG = (style: string) => `
    <div role="dialog" ${style}>
      <div id="mectrl_main_body">
        <div id="mectrl_currentAccount_secondary">${EXPECTED_EMAIL}</div>
      </div>
    </div>`;

  it('ignores display:none, hidden-attribute and aria-hidden identity nodes (review C3)', () => {
    for (const style of ['style="display:none"', 'hidden', 'aria-hidden="true"', 'style="visibility:hidden"']) {
      const facts = factsFromBody(
        `<div role="listbox" aria-label="Message list"></div>
         <div aria-label="Folder pane"></div>
         <button aria-label="New mail"></button>` + HIDDEN_DIALOG(style),
      );
      expect(facts.accountLabels).toEqual([]);
      const verdict = classifySignInState(MAIL_URL, facts, EXPECTED_EMAIL);
      expect(verdict.state).toBe('OUTLOOK_SIGNIN_UNVERIFIED_AMBIGUOUS');
      expect(STATE_EXIT_CODES[verdict.state]).not.toBe(0);
    }
  });

  it('accepts the same identity node once visible (root-verified evidence shape)', () => {
    const facts = factsFromBody(
      `<div role="listbox" aria-label="Message list"></div>
       <div aria-label="Folder pane"></div>` + HIDDEN_DIALOG(''),
    );
    const verdict = classifySignInState(MAIL_URL, facts, EXPECTED_EMAIL);
    expect(verdict.state).toBe('OUTLOOK_SIGNED_IN_VERIFIED');
  });

  it('never accepts whole-body text as identity', () => {
    const facts = factsFromBody(
      `<div role="listbox" aria-label="Message list"></div>
       <div aria-label="Folder pane"></div>
       <p>Signed in as ${EXPECTED_EMAIL}</p>`,
    );
    expect(facts.accountLabels).toEqual([]);
    expect(classifySignInState(MAIL_URL, facts, EXPECTED_EMAIL).state).toBe(
      'OUTLOOK_SIGNIN_UNVERIFIED_AMBIGUOUS',
    );
  });
});

describe('F2: root-observed OWA account control (artifacts/ROOT_AUTH_DOM_UPDATE.md)', () => {
  // Actual observed DOM: header is #owa-me-control-container button with a
  // display-name-only accessible name; the exact email renders async inside
  // role=dialog/#mectrl_main_body as #mectrl_currentAccount_secondary.
  const INBOX_CONTROLS = `
    <div role="listbox" aria-label="Message list"></div>
    <div aria-label="Folder pane"></div>
    <button aria-label="New mail"></button>`;
  const ME_CONTROL_CLOSED = `${INBOX_CONTROLS}
    <div id="owa-me-control-container"><button aria-label="Dana Fixture"></button></div>`;
  const dialog = (email: string, hidden: boolean) => `
    <div role="dialog"${hidden ? ' style="display:none"' : ''}>
      <div id="mectrl_main_body">
        <div id="mectrl_currentAccount_primary">Dana Fixture</div>
        <div id="mectrl_currentAccount_secondary">${email}</div>
      </div>
    </div>`;

  it('closed menu: identity insufficient (not wrong-account), me-control button reported', () => {
    const facts = factsFromBody(ME_CONTROL_CLOSED);
    expect(facts.hasMeControlButton).toBe(true);
    const verdict = classifySignInState(MAIL_URL, facts, EXPECTED_EMAIL);
    expect(verdict.state).toBe('OUTLOOK_SIGNIN_UNVERIFIED_AMBIGUOUS');
    expect(verdict.identity).toBe('insufficient');
  });

  it('open dialog with the expected email verifies; different email blocks as wrong account', () => {
    const good = classifySignInState(
      MAIL_URL,
      factsFromBody(ME_CONTROL_CLOSED + dialog(EXPECTED_EMAIL, false)),
      EXPECTED_EMAIL,
    );
    expect(good.state).toBe('OUTLOOK_SIGNED_IN_VERIFIED');
    const bad = classifySignInState(
      MAIL_URL,
      factsFromBody(ME_CONTROL_CLOSED + dialog('someone.else@example.edu.tt', false)),
      EXPECTED_EMAIL,
    );
    expect(bad.state).toBe('OUTLOOK_WRONG_ACCOUNT_BLOCKED');
  });

  // Fake page driving settleAndVerify: menu starts closed, the dialog renders
  // hidden first (delayed async content), then becomes visible. No live
  // requests, no browser.
  class FakeMailPage {
    clicks: string[] = [];
    keys: string[] = [];
    private opened = false;
    private waitsSinceOpen = 0;
    constructor(private readonly dialogEmail: string, private readonly identityVisibleFromStart = false) {}
    private currentHtml(): string {
      if (this.identityVisibleFromStart) return ME_CONTROL_CLOSED + dialog(this.dialogEmail, false);
      if (!this.opened) return ME_CONTROL_CLOSED;
      // One settle iteration of hidden (still-loading) dialog before visible.
      return ME_CONTROL_CLOSED + dialog(this.dialogEmail, this.waitsSinceOpen < 2);
    }
    private render() {
      document.body.innerHTML = this.currentHtml();
    }
    url() {
      return MAIL_URL;
    }
    async waitForTimeout() {
      if (this.opened) this.waitsSinceOpen += 1;
    }
    async evaluate<T>(fn: () => T): Promise<T> {
      this.render();
      return fn();
    }
    locator(selector: string) {
      return {
        first: () => ({
          isVisible: async () => {
            this.render();
            return document.querySelector(selector) !== null;
          },
          click: async () => {
            this.clicks.push(selector);
            if (selector === '#owa-me-control-container button') this.opened = true;
          },
        }),
      };
    }
    keyboard = {
      press: async (key: string) => {
        this.keys.push(key);
      },
    };
  }

  it('settle flow opens ONLY the observed me-control button, waits out delayed dialog visibility, verifies, then restores menu state', async () => {
    const page = new FakeMailPage(EXPECTED_EMAIL);
    const verdict = await settleAndVerify(page, EXPECTED_EMAIL);
    expect(verdict.state).toBe('OUTLOOK_SIGNED_IN_VERIFIED');
    // Bounded, exclusive click scope: the account control once, nothing else -
    // never sign out / switch account / #idSIButton9 / generic approvals.
    expect(page.clicks).toEqual(['#owa-me-control-container button']);
    // Menu it opened is closed afterwards via Escape only.
    expect(page.keys).toEqual(['Escape']);
  });

  it('settle flow reports WRONG_ACCOUNT from the opened dialog and still restores menu state', async () => {
    const page = new FakeMailPage('someone.else@example.edu.tt');
    const verdict = await settleAndVerify(page, EXPECTED_EMAIL);
    expect(verdict.state).toBe('OUTLOOK_WRONG_ACCOUNT_BLOCKED');
    expect(page.clicks).toEqual(['#owa-me-control-container button']);
    expect(page.keys).toEqual(['Escape']);
  });

  it('settle flow never touches the account control when identity is already visible', async () => {
    const page = new FakeMailPage(EXPECTED_EMAIL, true);
    const verdict = await settleAndVerify(page, EXPECTED_EMAIL);
    expect(verdict.state).toBe('OUTLOOK_SIGNED_IN_VERIFIED');
    expect(page.clicks).toEqual([]);
    expect(page.keys).toEqual([]);
  });
});
