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
  ensureInboxFolder: (page: unknown) => Promise<void>;
  openMessageById: (page: unknown, id: string) => Promise<boolean>;
  dismissBlockingDialog: (page: unknown) => Promise<void>;
  waitForComposePane: (page: unknown) => Promise<void>;
  readOpenDraftSnapshot: () => Promise<OpenDraftSnapshot | null>;
  readOpenDraftProbe: () => Promise<OpenDraftDomProbe>;
  clickSendInVerifiedDraft: () => Promise<boolean>;
  clickSendInCurrentReviewedDraft: () => Promise<boolean>;
  clickOpenMessageToolbarButton: (page: FakePage, nameRegex: RegExp) => Promise<boolean>;
  fillBody: (page: FakeFillPage, body: string) => Promise<void>;
  evaluateOpenDraftDom: (page: FakePage, expected: DraftSendProbeInput) => Promise<OpenDraftDomProbe>;
  clickByRoleOrVlm: () => Promise<void>;
};

type ExpectedDraftForSend = {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
};

type CurrentReviewedDraftForSend = {
  mode: 'current-reviewed';
  to?: string[];
  cc?: string[];
  bcc?: string[];
};

type DraftSendProbeInput = ExpectedDraftForSend | CurrentReviewedDraftForSend | null;

type OpenDraftDomProbe = {
  snapshot: OpenDraftSnapshot | null;
  clickedSend: boolean;
  draftCount: number;
  sendableDraftCount: number;
};

type FakePage = {
  evaluate: <TArg, TResult>(fn: (arg: TArg) => TResult, arg: TArg) => Promise<TResult>;
};

type FakeLocator = {
  count: () => Promise<number>;
  first: () => FakeLocator;
  click: (options?: unknown) => Promise<void>;
};

type FakeFillPage = {
  getByLabel: (label: string, options?: unknown) => FakeLocator;
  locator: (selector: string) => FakeLocator;
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
    pressKey: vi.fn(),
    sleep: vi.fn(),
    typeText: vi.fn(),
  };
  const grounder = {
    ground: vi.fn(),
  };
  const actions = new OutlookActions(driver as never, grounder as never) as unknown as TestActions;
  actions.looksLikeSignin = vi.fn(async () => false);
  actions.ensureInboxFolder = vi.fn(async () => undefined);
  actions.openMessageById = vi.fn(async () => true);
  actions.dismissBlockingDialog = vi.fn(async () => undefined);
  actions.waitForComposePane = vi.fn(async () => undefined);
  actions.readOpenDraftSnapshot = vi.fn(async () => matchingDraft);
  actions.readOpenDraftProbe = vi.fn(async () => ({
    snapshot: matchingDraft,
    clickedSend: false,
    draftCount: 1,
    sendableDraftCount: 1,
  }));
  actions.clickSendInVerifiedDraft = vi.fn(async () => true);
  actions.clickSendInCurrentReviewedDraft = vi.fn(async () => true);
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

function createFillPage(options: { bodyCandidateCount?: number; toCandidateCount?: number } = {}) {
  const clicks: string[] = [];
  const { bodyCandidateCount = 1, toCandidateCount = 1 } = options;
  const emptyLocator: FakeLocator = {
    count: vi.fn(async () => 0),
    first: () => emptyLocator,
    click: vi.fn(async () => undefined),
  };
  const bodyLocator: FakeLocator = {
    count: vi.fn(async () => bodyCandidateCount),
    first: () => bodyLocator,
    click: vi.fn(async () => { clicks.push('body'); }),
  };
  const toLocator: FakeLocator = {
    count: vi.fn(async () => toCandidateCount),
    first: () => toLocator,
    click: vi.fn(async () => { clicks.push('to'); }),
  };
  const page: FakeFillPage = {
    getByLabel: vi.fn((label: string) => (label === 'Message body' ? bodyLocator : emptyLocator)),
    locator: vi.fn((selector: string) => {
      if (/aria-label.*Message body/i.test(selector) || /aria-label.*body/i.test(selector)) return bodyLocator;
      if (/aria-label.*To/i.test(selector) || /role="textbox"/i.test(selector)) return toLocator;
      return emptyLocator;
    }),
  };
  return { page, clicks, bodyLocator, toLocator };
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

  it('refuses confirmed send with an empty supplied body assertion before touching Outlook', async () => {
    const { actions, driver } = createActions();

    const result = await actions.sendEmail({
      to: 'recipient@example.invalid',
      subject: 'Demo subject',
      body: '',
      confirm: true,
    });

    expect(result).toMatchObject({ status: 'refused' });
    expect(result.reason).toMatch(/body assertion is empty/i);
    expect(driver.ensureOutlookTab).not.toHaveBeenCalled();
    expect(actions.clickSendInVerifiedDraft).not.toHaveBeenCalled();
  });

  it('refuses confirmed send when no draft subject is open', async () => {
    const { actions } = createActions();
    actions.readOpenDraftProbe = vi.fn(async () => ({
      snapshot: null,
      clickedSend: false,
      draftCount: 0,
      sendableDraftCount: 0,
    }));

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

  it('sends the single reviewed draft when subject changed after review', async () => {
    const { actions } = createActions();
    actions.readOpenDraftProbe = vi.fn(async () => ({
      snapshot: {
        ...matchingDraft,
        subject: 'Different subject',
        searchableText: 'recipient@example.invalid Different subject Body is not logged by this test.',
      },
      clickedSend: false,
      draftCount: 1,
      sendableDraftCount: 1,
    }));

    const result = await actions.sendEmail({
      to: 'recipient@example.invalid',
      subject: 'Demo subject',
      body: 'Body is not logged by this test.',
      confirm: true,
    });

    expect(result).toEqual({ status: 'sent', message: 'Email sent via Outlook Web.' });
    expect(actions.clickSendInCurrentReviewedDraft).toHaveBeenCalledTimes(1);
  });

  it('refuses confirmed send when open draft recipients differ', async () => {
    const { actions } = createActions();
    actions.readOpenDraftProbe = vi.fn(async () => ({
      snapshot: {
        ...matchingDraft,
        to: ['other@example.invalid'],
        searchableText: 'other@example.invalid Demo subject Body is not logged by this test.',
      },
      clickedSend: false,
      draftCount: 1,
      sendableDraftCount: 1,
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
    expect(actions.clickSendInCurrentReviewedDraft).not.toHaveBeenCalled();
  });

  it('sends the single reviewed draft when body changed after review', async () => {
    const { actions } = createActions();
    actions.readOpenDraftProbe = vi.fn(async () => ({
      snapshot: {
        ...matchingDraft,
        body: 'Different body.',
        searchableText: 'recipient@example.invalid Demo subject Different body.',
      },
      clickedSend: false,
      draftCount: 1,
      sendableDraftCount: 1,
    }));

    const result = await actions.sendEmail({
      to: 'recipient@example.invalid',
      subject: 'Demo subject',
      body: 'Body is not logged by this test.',
      confirm: true,
    });

    expect(result).toEqual({ status: 'sent', message: 'Email sent via Outlook Web.' });
    expect(actions.clickSendInCurrentReviewedDraft).toHaveBeenCalledTimes(1);
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
    expect(result.reason).toMatch(/exactly one complete reviewed draft/i);
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

  it('sends the current reviewed draft without asking the model to repeat recipient fields', async () => {
    const { actions } = createActions();

    const result = await actions.sendEmail({ confirm: true });

    expect(result).toEqual({ status: 'sent', message: 'Email sent via Outlook Web.' });
    expect(actions.clickSendInCurrentReviewedDraft).toHaveBeenCalledTimes(1);
    expect(actions.clickSendInVerifiedDraft).not.toHaveBeenCalled();
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

  it('reply result tells the model Outlook pre-filled recipients and send should be confirm-only', async () => {
    const { actions } = createActions();
    actions.clickOpenMessageToolbarButton = vi.fn(async () => true);
    actions.fillBody = vi.fn(async () => undefined);
    actions.readOpenDraftProbe = vi.fn(async () => ({
      snapshot: {
        ...matchingDraft,
        to: ['Karunesh Ramdass'],
        subject: 'Re: Testing scheduled emails',
        body: 'Testing the reply feature',
        searchableText: 'Karunesh Ramdass Re: Testing scheduled emails Testing the reply feature',
      },
      clickedSend: false,
      draftCount: 1,
      sendableDraftCount: 1,
    }));

    const result = await actions.reply({ id: 'message-1', body: 'Testing the reply feature' });

    expect(result).toMatchObject({
      status: 'drafted',
      draftLeftOpen: true,
      preview: {
        to: ['Karunesh Ramdass'],
        subject: 'Re: Testing scheduled emails',
        body: 'Testing the reply feature',
      },
    });
    expect(result.message).toMatch(/Outlook pre-filled the reply recipient/i);
    expect(result.message).toMatch(/\{ confirm: true \} only/i);
  });

  it('mark read resets to Inbox before opening a message id', async () => {
    const { actions } = createActions();
    const order: string[] = [];
    actions.ensureInboxFolder = vi.fn(async () => { order.push('inbox'); });
    actions.openMessageById = vi.fn(async () => { order.push('open'); return true; });

    const result = await actions.markRead({ id: 'message-1', read: true });

    expect(result).toMatchObject({ status: 'ok' });
    expect(order).toEqual(['inbox', 'open']);
  });

  it('confirmed attachment download resets to Inbox before opening a message id', async () => {
    const { actions } = createActions();
    const order: string[] = [];
    actions.ensureInboxFolder = vi.fn(async () => { order.push('inbox'); });
    actions.openMessageById = vi.fn(async () => { order.push('open'); return false; });

    const result = await actions.downloadAttachment({
      id: 'message-1',
      filename: 'report.pdf',
      confirm: true,
    });

    expect(result).toMatchObject({ status: 'not_found', filename: 'report.pdf' });
    expect(order).toEqual(['inbox', 'open']);
  });

  it('fills the labelled message body instead of the recipient textbox', async () => {
    const { actions, driver } = createActions();
    const { page, clicks } = createFillPage({ bodyCandidateCount: 1, toCandidateCount: 1 });

    await actions.fillBody(page, 'Testing the reply feature');

    expect(clicks).toEqual(['body']);
    expect(driver.typeText).toHaveBeenCalledWith('Testing the reply feature');
  });

  it('does not use a generic To contenteditable as the body fallback', async () => {
    const { actions, driver, grounder } = createActions();
    const { page, clicks } = createFillPage({ bodyCandidateCount: 0, toCandidateCount: 1 });
    grounder.ground = vi.fn(async () => ({
      found: true,
      confidence: 0.9,
      reasoning: 'message body editor',
      question: 'body',
      bbox: { x: 10, y: 20, width: 100, height: 40 },
    }));

    await actions.fillBody(page, 'Testing the reply feature');

    expect(clicks).toEqual([]);
    expect(driver.clickAt).toHaveBeenCalledWith(60, 40);
    expect(driver.typeText).toHaveBeenCalledWith('Testing the reply feature');
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

  it('uses the real message body instead of a generic To contenteditable textbox', async () => {
    const { actions } = createActions();
    const { page } = createDomPage(`
      <div role="dialog">
        <button aria-label="Send" data-click-id="send-1">Send</button>
        <div aria-label="To" role="textbox" contenteditable="true">recipient@example.invalid</div>
        <input aria-label="Subject" value="Demo subject" />
        <div aria-label="Message body" contenteditable="true">Body is not logged by this test.</div>
      </div>
    `);

    const result = await actions.evaluateOpenDraftDom(page, null);

    expect(result.snapshot).toMatchObject({
      to: ['recipient@example.invalid'],
      subject: 'Demo subject',
      body: 'Body is not logged by this test.',
    });
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

  it('sends exactly one complete current reviewed draft', async () => {
    const { actions } = createActions();
    const { clicks, page } = createDomPage(`
      <div role="dialog">
        <button aria-label="Send" data-click-id="send-1">Send</button>
        <input aria-label="To" value="recipient@example.invalid" />
        <input aria-label="Subject" value="Demo subject edited by reviewer" />
        <div aria-label="Message body" contenteditable="true">Body edited by reviewer.</div>
      </div>
    `);

    const result = await actions.evaluateOpenDraftDom(page, { mode: 'current-reviewed' });

    expect(result.clickedSend).toBe(true);
    expect(result.draftCount).toBe(1);
    expect(result.sendableDraftCount).toBe(1);
    expect(clicks).toEqual(['send-1']);
  });

  it('sends a reviewed reply draft when Outlook shows a contact chip without an email address', async () => {
    const { actions } = createActions();
    const { clicks, page } = createDomPage(`
      <div role="dialog">
        <button aria-label="Send" data-click-id="send-1">Send</button>
        <div aria-label="To" role="textbox" contenteditable="true">Karunesh Ramdass</div>
        <input aria-label="Subject" value="Re: Testing scheduled emails" />
        <div aria-label="Message body" contenteditable="true">Testing the reply feature</div>
      </div>
    `);

    const result = await actions.evaluateOpenDraftDom(page, { mode: 'current-reviewed' });

    expect(result.clickedSend).toBe(true);
    expect(clicks).toEqual(['send-1']);
  });

  it('still refuses a recipient assertion when Outlook shows the wrong contact chip', async () => {
    const { actions } = createActions();
    const { clicks, page } = createDomPage(`
      <div role="dialog">
        <button aria-label="Send" data-click-id="send-1">Send</button>
        <div aria-label="To" role="textbox" contenteditable="true">Different Person</div>
        <input aria-label="Subject" value="Re: Testing scheduled emails" />
        <div aria-label="Message body" contenteditable="true">Testing the reply feature</div>
      </div>
    `);

    const result = await actions.evaluateOpenDraftDom(page, {
      mode: 'current-reviewed',
      to: ['karuneshramdass22@gmail.com'],
    });

    expect(result.clickedSend).toBe(false);
    expect(clicks).toEqual([]);
  });

  it('refuses to send current reviewed draft when multiple sendable drafts are open', async () => {
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
        <input aria-label="To" value="other@example.invalid" />
        <input aria-label="Subject" value="Other subject" />
        <div aria-label="Message body" contenteditable="true">Other body.</div>
      </div>
    `);

    const result = await actions.evaluateOpenDraftDom(page, { mode: 'current-reviewed' });

    expect(result.clickedSend).toBe(false);
    expect(result.draftCount).toBe(2);
    expect(result.sendableDraftCount).toBe(2);
    expect(clicks).toEqual([]);
  });

  it('clicks Reply without clicking adjacent Archive controls', async () => {
    const { actions } = createActions();
    const { clicks, page } = createDomPage(`
      <section role="region" aria-label="Reading pane">
        <button aria-label="Archive" data-click-id="archive">Archive</button>
        <button aria-label="Reply" data-click-id="reply">Reply</button>
        <button aria-label="Delete" data-click-id="delete">Delete</button>
      </section>
    `);

    const clicked = await actions.clickOpenMessageToolbarButton(page, /^reply$/i);

    expect(clicked).toBe(true);
    expect(clicks).toEqual(['reply']);
  });

  it('refuses a global Reply fallback when the reading pane lacks one safe match', async () => {
    const { actions } = createActions();
    const { clicks, page } = createDomPage(`
      <section role="region" aria-label="Reading pane">
        <button aria-label="Archive" data-click-id="archive">Archive</button>
        <button aria-label="Delete" data-click-id="delete">Delete</button>
      </section>
      <nav aria-label="Global mail toolbar">
        <button aria-label="Reply" data-click-id="global-reply">Reply</button>
      </nav>
    `);

    const clicked = await actions.clickOpenMessageToolbarButton(page, /^reply$/i);

    expect(clicked).toBe(false);
    expect(clicks).toEqual([]);
  });
});
