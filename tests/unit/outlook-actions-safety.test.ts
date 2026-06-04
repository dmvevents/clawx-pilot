// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OutlookActions } from '@electron/services/outlook-browser-v2/outlook-actions';

type OpenDraftSnapshot = {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  searchableText: string;
};

type TestActions = OutlookActions & {
  looksLikeSignin: () => Promise<boolean>;
  readOpenDraftSnapshot: () => Promise<OpenDraftSnapshot | null>;
  clickSendInVerifiedDraft: () => Promise<boolean>;
  evaluateOpenDraftDom: (page: FakePage, expected: ExpectedDraftForSend | null) => Promise<OpenDraftDomProbe>;
  clickByRoleOrVlm: () => Promise<void>;
};

type ExpectedDraftForSend = {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
};

type OpenDraftDomProbe = {
  snapshot: OpenDraftSnapshot | null;
  clickedSend: boolean;
};

type FakePage = {
  evaluate: <T>(fn: (arg: ExpectedDraftForSend | null) => T, arg: ExpectedDraftForSend | null) => Promise<T>;
};

const matchingDraft: OpenDraftSnapshot = {
  to: ['recipient@example.invalid'],
  cc: [],
  bcc: [],
  subject: 'Demo subject',
  body: 'Body is not logged by this test.',
  searchableText: 'recipient@example.invalid Demo subject Body is not logged by this test.',
};

function createActions() {
  const driver = {
    ensureOutlookTab: vi.fn(async () => ({ url: () => 'https://outlook.office.com/mail/inbox' })),
    screenshotViewport: vi.fn(async () => ({ png: Buffer.alloc(0), width: 1, height: 1 })),
    clickAt: vi.fn(),
  };
  const grounder = {
    ground: vi.fn(),
  };
  const actions = new OutlookActions(driver as never, grounder as never) as unknown as TestActions;
  actions.looksLikeSignin = vi.fn(async () => false);
  actions.readOpenDraftSnapshot = vi.fn(async () => matchingDraft);
  actions.clickSendInVerifiedDraft = vi.fn(async () => true);
  actions.clickByRoleOrVlm = vi.fn(async () => undefined);
  return { actions, driver, grounder };
}

function createDomPage(html: string): { page: FakePage; clicks: string[] } {
  document.body.innerHTML = html;
  const clicks: string[] = [];
  document.querySelectorAll<HTMLButtonElement>('button[data-click-id]').forEach((button) => {
    button.addEventListener('click', () => clicks.push(button.dataset.clickId ?? 'unknown'));
  });
  return {
    clicks,
    page: {
      evaluate: async (fn, arg) => fn(arg),
    },
  };
}

const expectedDraft: ExpectedDraftForSend = {
  to: ['recipient@example.invalid'],
  cc: [],
  bcc: [],
  subject: 'Demo subject',
  body: 'Body is not logged by this test.',
};

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    bottom: 20,
    height: 20,
    left: 0,
    right: 120,
    toJSON: () => ({}),
    top: 0,
    width: 120,
    x: 0,
    y: 0,
  } as DOMRect);
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('OutlookActions safety gates', () => {
  it('refuses send without confirm before touching Outlook', async () => {
    const { actions, driver } = createActions();

    const result = await actions.sendEmail({
      to: 'recipient@example.invalid',
      subject: 'Demo subject',
      body: 'Body is not logged by this test.',
      confirm: false,
    });

    expect(result).toMatchObject({ status: 'refused' });
    expect(result.reason).toMatch(/confirm/i);
    expect(driver.ensureOutlookTab).not.toHaveBeenCalled();
    expect(actions.clickByRoleOrVlm).not.toHaveBeenCalled();
  });

  it('refuses confirmed send with invalid body before touching Outlook', async () => {
    const { actions, driver } = createActions();

    const result = await actions.sendEmail({
      to: 'recipient@example.invalid',
      subject: 'Demo subject',
      body: '',
      confirm: true,
    });

    expect(result).toMatchObject({ status: 'refused' });
    expect(result.reason).toMatch(/body is required/i);
    expect(driver.ensureOutlookTab).not.toHaveBeenCalled();
    expect(actions.clickSendInVerifiedDraft).not.toHaveBeenCalled();
  });

  it('refuses confirmed send when no draft subject is open', async () => {
    const { actions } = createActions();
    actions.readOpenDraftSnapshot = vi.fn(async () => null);

    const result = await actions.sendEmail({
      to: 'recipient@example.invalid',
      subject: 'Demo subject',
      body: 'Body is not logged by this test.',
      confirm: true,
    });

    expect(result).toMatchObject({ status: 'refused' });
    expect(result.reason).toMatch(/No open draft/i);
    expect(actions.clickSendInVerifiedDraft).not.toHaveBeenCalled();
  });

  it('refuses confirmed send when open draft subject differs', async () => {
    const { actions } = createActions();
    actions.readOpenDraftSnapshot = vi.fn(async () => ({
      ...matchingDraft,
      subject: 'Different subject',
      searchableText: 'recipient@example.invalid Different subject Body is not logged by this test.',
    }));

    const result = await actions.sendEmail({
      to: 'recipient@example.invalid',
      subject: 'Demo subject',
      body: 'Body is not logged by this test.',
      confirm: true,
    });

    expect(result).toMatchObject({ status: 'refused' });
    expect(result.reason).toMatch(/subject does not match/i);
    expect(actions.clickSendInVerifiedDraft).not.toHaveBeenCalled();
  });

  it('refuses confirmed send when open draft recipients differ', async () => {
    const { actions } = createActions();
    actions.readOpenDraftSnapshot = vi.fn(async () => ({
      ...matchingDraft,
      to: ['other@example.invalid'],
      searchableText: 'other@example.invalid Demo subject Body is not logged by this test.',
    }));

    const result = await actions.sendEmail({
      to: 'recipient@example.invalid',
      subject: 'Demo subject',
      body: 'Body is not logged by this test.',
      confirm: true,
    });

    expect(result).toMatchObject({ status: 'refused' });
    expect(result.reason).toMatch(/To recipients/i);
    expect(actions.clickSendInVerifiedDraft).not.toHaveBeenCalled();
  });

  it('refuses confirmed send when open draft body differs', async () => {
    const { actions } = createActions();
    actions.readOpenDraftSnapshot = vi.fn(async () => ({
      ...matchingDraft,
      body: 'Different body.',
      searchableText: 'recipient@example.invalid Demo subject Different body.',
    }));

    const result = await actions.sendEmail({
      to: 'recipient@example.invalid',
      subject: 'Demo subject',
      body: 'Body is not logged by this test.',
      confirm: true,
    });

    expect(result).toMatchObject({ status: 'refused' });
    expect(result.reason).toMatch(/body does not match/i);
    expect(actions.clickSendInVerifiedDraft).not.toHaveBeenCalled();
  });

  it('refuses confirmed send when the matching draft send button is not found', async () => {
    const { actions } = createActions();
    actions.clickSendInVerifiedDraft = vi.fn(async () => false);

    const result = await actions.sendEmail({
      to: 'recipient@example.invalid',
      subject: 'Demo subject',
      body: 'Body is not logged by this test.',
      confirm: true,
    });

    expect(result).toMatchObject({ status: 'refused' });
    expect(result.reason).toMatch(/Send button inside the verified open draft/i);
  });

  it('sends confirmed mail only when the verified open draft matches', async () => {
    const { actions } = createActions();

    const result = await actions.sendEmail({
      to: 'recipient@example.invalid',
      subject: ' Demo subject ',
      body: 'Body is not logged by this test.',
      confirm: true,
    });

    expect(result).toEqual({ status: 'sent', message: 'Email sent via Outlook Web.' });
    expect(actions.clickSendInVerifiedDraft).toHaveBeenCalledTimes(1);
    expect(actions.clickByRoleOrVlm).not.toHaveBeenCalled();
  });

  it('refuses attachment download without confirm before touching Outlook', async () => {
    const { actions, driver } = createActions();

    const result = await actions.downloadAttachment({
      id: 'message-1',
      filename: 'report.pdf',
      confirm: false,
    });

    expect(result).toMatchObject({ status: 'refused', filename: 'report.pdf' });
    expect(result.reason).toMatch(/confirm/i);
    expect(driver.ensureOutlookTab).not.toHaveBeenCalled();
  });
});

describe('OutlookActions verified draft DOM probe', () => {
  it('clicks Send only for one exact matching compose pane', async () => {
    const { actions } = createActions();
    const { clicks, page } = createDomPage(`
      <div role="dialog">
        <button aria-label="Send" data-click-id="send-1">Send</button>
        <input aria-label="To" value="recipient@example.invalid" />
        <input aria-label="Subject" value="Demo subject" />
        <div aria-label="Message body" contenteditable="true">Body is not logged by this test.</div>
      </div>
    `);

    const result = await actions.evaluateOpenDraftDom(page, expectedDraft);

    expect(result.clickedSend).toBe(true);
    expect(clicks).toEqual(['send-1']);
    expect(result.snapshot).toMatchObject({ to: ['recipient@example.invalid'], subject: 'Demo subject' });
  });

  it('does not let body text satisfy the recipient bucket check', async () => {
    const { actions } = createActions();
    const { clicks, page } = createDomPage(`
      <div role="dialog">
        <button aria-label="Send" data-click-id="send-1">Send</button>
        <input aria-label="To" value="other@example.invalid" />
        <input aria-label="Subject" value="Demo subject" />
        <div aria-label="Message body" contenteditable="true">
          Body is not logged by this test. Mentioning recipient@example.invalid here must not satisfy To.
        </div>
      </div>
    `);

    const result = await actions.evaluateOpenDraftDom(page, {
      ...expectedDraft,
      body: 'Body is not logged by this test. Mentioning recipient@example.invalid here must not satisfy To.',
    });

    expect(result.clickedSend).toBe(false);
    expect(clicks).toEqual([]);
  });

  it('refuses extra body content instead of using substring matching', async () => {
    const { actions } = createActions();
    const { clicks, page } = createDomPage(`
      <div role="dialog">
        <button aria-label="Send" data-click-id="send-1">Send</button>
        <input aria-label="To" value="recipient@example.invalid" />
        <input aria-label="Subject" value="Demo subject" />
        <div aria-label="Message body" contenteditable="true">Body is not logged by this test. Extra text.</div>
      </div>
    `);

    const result = await actions.evaluateOpenDraftDom(page, expectedDraft);

    expect(result.clickedSend).toBe(false);
    expect(clicks).toEqual([]);
  });

  it('refuses ambiguous matching compose panes', async () => {
    const { actions } = createActions();
    const { clicks, page } = createDomPage(`
      <div role="dialog">
        <button aria-label="Send" data-click-id="send-1">Send</button>
        <input aria-label="To" value="recipient@example.invalid" />
        <input aria-label="Subject" value="Demo subject" />
        <div aria-label="Message body" contenteditable="true">Body is not logged by this test.</div>
      </div>
      <div role="dialog">
        <button aria-label="Send" data-click-id="send-2">Send</button>
        <input aria-label="To" value="recipient@example.invalid" />
        <input aria-label="Subject" value="Demo subject" />
        <div aria-label="Message body" contenteditable="true">Body is not logged by this test.</div>
      </div>
    `);

    const result = await actions.evaluateOpenDraftDom(page, expectedDraft);

    expect(result.clickedSend).toBe(false);
    expect(clicks).toEqual([]);
  });
});
