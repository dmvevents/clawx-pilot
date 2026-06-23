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
  openMessageComposeViaShortcut: (page: FakeReplyPage, action: 'reply' | 'replyAll' | 'forward') => Promise<boolean>;
  hasAnyVisibleOpenDraft: (page: FakePage) => Promise<boolean>;
  hasVisibleOpenDraft: (page: FakePage) => Promise<boolean>;
  clickNewMail: (page: FakePage) => Promise<void>;
  fillField: (page: FakeFillPage, label: 'To' | 'Cc' | 'Bcc' | 'Subject', value: string) => Promise<void>;
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

type FakeReplyPage = FakePage & {
  waitForSelector?: (selector: string, options?: unknown) => Promise<unknown>;
};

type FakeLocator = {
  count: () => Promise<number>;
  first: () => FakeLocator;
  click: (options?: unknown) => Promise<void>;
  fill?: (value: string, options?: unknown) => Promise<void>;
};

type FakeFillPage = {
  getByLabel: (label: string, options?: unknown) => FakeLocator;
  locator: (selector: string) => FakeLocator;
  evaluate?: <TArg, TResult>(fn: (arg: TArg) => TResult, arg: TArg) => Promise<TResult>;
};

const matchingDraft: OpenDraftSnapshot = {
  to: ['recipient@example.invalid'],
  cc: [],
  bcc: [],
  subject: 'Demo subject',
  body: 'Body is not logged by this test.',
  searchableText: 'recipient@example.invalid Demo subject Body is not logged by this test.',
};

const firstReplyShortcut = process.platform === 'darwin' ? 'Meta+R' : 'Control+R';
const firstReplyAllShortcut = process.platform === 'darwin' ? 'Meta+Shift+R' : 'Control+Shift+R';

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
  actions.hasAnyVisibleOpenDraft = vi.fn(async () => false);
  return { actions, driver, grounder };
}

function createBareActions() {
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
  return { actions, driver, grounder };
}

function fakeSigninPage(options: {
  url?: string;
  headings?: string[];
  authControlVisible?: boolean;
  evaluateResult?: boolean;
} = {}) {
  return {
    url: () => options.url ?? 'https://outlook.cloud.microsoft/mail/inbox',
    evaluate: vi.fn(async (fn: () => boolean) => options.evaluateResult ?? fn()),
    getByRole: vi.fn(() => ({
      allTextContents: vi.fn(async () => options.headings ?? []),
    })),
    locator: vi.fn(() => ({
      first() { return this; },
      isVisible: vi.fn(async () => options.authControlVisible ?? false),
    })),
  };
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

function createVerifyingBodyFillPage(html: string) {
  document.body.innerHTML = html;
  const clicks: string[] = [];
  document.querySelectorAll<HTMLElement>('[aria-label="Message body"]').forEach((element, index) => {
    element.addEventListener('click', () => {
      clicks.push(element.dataset.clickId ?? `body-${index}`);
    });
  });
  const emptyLocator: FakeLocator = {
    count: vi.fn(async () => 0),
    first: () => emptyLocator,
    click: vi.fn(async () => undefined),
  };
  const bodyLocator: FakeLocator = {
    count: vi.fn(async () => 1),
    first: () => bodyLocator,
    click: vi.fn(async () => {
      const target = document.querySelector<HTMLElement>('[aria-label="Message body"]');
      target?.focus();
      target?.click();
    }),
  };
  const page: FakeFillPage = {
    getByLabel: vi.fn((label: string) => (label === 'Message body' ? bodyLocator : emptyLocator)),
    locator: vi.fn((selector: string) => (/Message body|body/i.test(selector) ? bodyLocator : emptyLocator)),
    evaluate: vi.fn(async (fn, arg) => fn(arg)),
  };
  return { page, clicks };
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
    expect(actions.readOpenDraftProbe).toHaveBeenCalledTimes(1);
    expect(actions.clickSendInCurrentReviewedDraft).toHaveBeenCalledWith(expect.anything(), { confirm: true });
    expect(actions.clickSendInCurrentReviewedDraft).toHaveBeenCalledTimes(1);
    expect(actions.clickSendInVerifiedDraft).not.toHaveBeenCalled();
  });

  it('refuses confirmed send when multiple reviewed drafts are open', async () => {
    const { actions } = createActions();
    actions.readOpenDraftProbe = vi.fn(async () => ({
      snapshot: matchingDraft,
      clickedSend: false,
      draftCount: 2,
      sendableDraftCount: 2,
    }));
    actions.clickSendInCurrentReviewedDraft = vi.fn(async () => false);

    const result = await actions.sendEmail({ confirm: true });

    expect(result).toMatchObject({ status: 'refused' });
    expect(result.reason).toMatch(/multiple open drafts/i);
    expect(actions.clickSendInCurrentReviewedDraft).toHaveBeenCalledTimes(1);
  });

  it('refuses subject-mismatched confirmed send when another sendable draft is open', async () => {
    const { actions } = createActions();
    actions.readOpenDraftProbe = vi.fn(async () => ({
      snapshot: {
        ...matchingDraft,
        subject: 'Edited subject after review',
        searchableText: 'recipient@example.invalid Edited subject after review Body is not logged by this test.',
      },
      clickedSend: false,
      draftCount: 2,
      sendableDraftCount: 2,
    }));
    actions.clickSendInCurrentReviewedDraft = vi.fn(async () => false);

    const result = await actions.sendEmail({
      to: 'recipient@example.invalid',
      subject: 'Demo subject',
      body: 'Body is not logged by this test.',
      confirm: true,
    });

    expect(result).toMatchObject({ status: 'refused' });
    expect(result.reason).toMatch(/multiple open drafts/i);
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

  it('does not claim a reply draft when body text is composed in the To field', async () => {
    const { actions, driver } = createActions();
    const { page } = createVerifyingBodyFillPage(`
      <div role="dialog">
        <div aria-label="To" role="textbox" contenteditable="true">Testing the reply feature</div>
        <input aria-label="Subject" value="Re: Meeting" />
        <div aria-label="Message body" contenteditable="true"></div>
      </div>
    `);
    const replyPage = {
      ...page,
      waitForSelector: vi.fn(async () => undefined),
    } as unknown as FakeReplyPage & FakeFillPage;
    driver.ensureOutlookTab.mockResolvedValue(replyPage);
    actions.clickOpenMessageToolbarButton = vi.fn(async () => true);

    await expect(actions.reply({ id: 'message-1', body: 'Testing the reply feature' }))
      .rejects.toThrow(/recipient field/i);

    expect(actions.readOpenDraftProbe).not.toHaveBeenCalled();
  });

  it('does not claim a reply draft when body verification cannot confirm the text', async () => {
    const { actions, driver } = createActions();
    const { page } = createVerifyingBodyFillPage(`
      <div role="dialog">
        <div aria-label="To" role="textbox" contenteditable="true">Karunesh Ramdass</div>
        <input aria-label="Subject" value="Re: Meeting" />
        <div aria-label="Message body" contenteditable="true"></div>
      </div>
    `);
    const replyPage = {
      ...page,
      waitForSelector: vi.fn(async () => undefined),
    } as unknown as FakeReplyPage & FakeFillPage;
    driver.ensureOutlookTab.mockResolvedValue(replyPage);
    actions.clickOpenMessageToolbarButton = vi.fn(async () => true);

    await expect(actions.reply({ id: 'message-1', body: 'Testing the reply feature' }))
      .rejects.toThrow(/message text was not found in the compose body/i);

    expect(actions.readOpenDraftProbe).not.toHaveBeenCalled();
  });

  it('does not report drafted when the reply draft probe finds body text in recipients', async () => {
    const { actions } = createActions();
    actions.clickOpenMessageToolbarButton = vi.fn(async () => true);
    actions.fillBody = vi.fn(async () => undefined);
    actions.readOpenDraftProbe = vi.fn(async () => ({
      snapshot: {
        ...matchingDraft,
        to: ['Testing the reply feature'],
        subject: 'Re: Meeting',
        body: '',
        searchableText: 'Testing the reply feature Re: Meeting',
      },
      clickedSend: false,
      draftCount: 1,
      sendableDraftCount: 0,
    }));

    const result = await actions.reply({ id: 'message-1', body: 'Testing the reply feature' });

    expect(result).toMatchObject({ status: 'not_found', draftLeftOpen: true });
    expect(result.message).toMatch(/recipient field/i);
  });

  it('does not report drafted when a short reply body is in a recipient field', async () => {
    const { actions } = createActions();
    actions.clickOpenMessageToolbarButton = vi.fn(async () => true);
    actions.fillBody = vi.fn(async () => undefined);
    actions.readOpenDraftProbe = vi.fn(async () => ({
      snapshot: {
        ...matchingDraft,
        to: ['OK'],
        subject: 'Re: Meeting',
        body: 'OK',
        searchableText: 'OK Re: Meeting',
      },
      clickedSend: false,
      draftCount: 1,
      sendableDraftCount: 1,
    }));

    const result = await actions.reply({ id: 'message-1', body: 'OK' });

    expect(result).toMatchObject({ status: 'not_found', draftLeftOpen: true });
    expect(result.message).toMatch(/recipient field/i);
  });

  it('does not report drafted when the reply draft probe cannot verify body text', async () => {
    const { actions } = createActions();
    actions.clickOpenMessageToolbarButton = vi.fn(async () => true);
    actions.fillBody = vi.fn(async () => undefined);
    actions.readOpenDraftProbe = vi.fn(async () => ({
      snapshot: {
        ...matchingDraft,
        to: ['Karunesh Ramdass'],
        subject: 'Re: Meeting',
        body: '',
        searchableText: 'Karunesh Ramdass Re: Meeting',
      },
      clickedSend: false,
      draftCount: 1,
      sendableDraftCount: 0,
    }));

    const result = await actions.reply({ id: 'message-1', body: 'Testing the reply feature' });

    expect(result).toMatchObject({ status: 'not_found', draftLeftOpen: true });
    expect(result.message).toMatch(/could not verify the message text/i);
  });

  it('does not type a reply when Outlook already has a visible open draft', async () => {
    const { actions, driver } = createActions();
    const { page } = createDomPage('<section role="region" aria-label="Reading pane"><article>Meeting</article></section>');
    const replyPage = {
      ...page,
      waitForSelector: vi.fn(async () => undefined),
    } as unknown as FakeReplyPage;
    driver.ensureOutlookTab.mockResolvedValue(replyPage);
    actions.hasAnyVisibleOpenDraft = vi.fn(async () => true);
    actions.clickOpenMessageToolbarButton = vi.fn(async () => true);
    actions.fillBody = vi.fn(async () => undefined);

    const result = await actions.reply({ id: 'message-1', body: 'Testing the reply feature' });

    expect(result).toMatchObject({ status: 'not_found', draftLeftOpen: true });
    expect(result.message).toMatch(/already has an open draft/i);
    expect(actions.clickOpenMessageToolbarButton).not.toHaveBeenCalled();
    expect(actions.fillBody).not.toHaveBeenCalled();
  });

  it('does not report a new email as drafted when the compose pane is not reviewable', async () => {
    const { actions, driver } = createActions();
    const page = {
      evaluate: vi.fn(async (fnOrScript: unknown) => {
        if (typeof fnOrScript === 'string') return undefined;
        return false;
      }),
    } as unknown as FakePage;
    driver.ensureOutlookTab.mockResolvedValue(page);
    actions.clickNewMail = vi.fn(async () => undefined);
    actions.waitForComposePane = vi.fn(async () => undefined);
    actions.fillField = vi.fn(async () => undefined);
    actions.fillBody = vi.fn(async () => undefined);
    actions.readOpenDraftProbe = vi.fn(async () => ({
      snapshot: null,
      clickedSend: false,
      draftCount: 0,
      sendableDraftCount: 0,
    }));

    const result = await actions.draftEmail({
      to: 'recipient@example.invalid',
      subject: 'Demo subject',
      body: 'Body is not logged by this test.',
    });

    expect(result).toMatchObject({ status: 'failed', draftLeftOpen: false });
    expect(result.message).toMatch(/not visible for review/i);
    expect(actions.clickNewMail).toHaveBeenCalledTimes(1);
  });

  it('falls back to Outlook reply keyboard shortcut when the Reply button is hidden', async () => {
    const { actions, driver } = createActions();
    const { page } = createDomPage(`
      <section role="region" aria-label="Reading pane">
        <article>Meeting</article>
      </section>
    `);
    const replyPage = {
      ...page,
      waitForSelector: vi.fn(async () => undefined),
    } as unknown as FakeReplyPage;
    driver.ensureOutlookTab.mockResolvedValue(replyPage);
    actions.clickOpenMessageToolbarButton = vi.fn(async () => false);
    actions.fillBody = vi.fn(async () => undefined);
    actions.readOpenDraftProbe = vi.fn(async () => ({
      snapshot: {
        ...matchingDraft,
        to: ['Karunesh Ramdass'],
        subject: 'Re: Meeting',
        body: 'Testing the reply feature',
        searchableText: 'Karunesh Ramdass Re: Meeting Testing the reply feature',
      },
      clickedSend: false,
      draftCount: 1,
      sendableDraftCount: 1,
    }));

    const result = await actions.reply({ id: 'message-1', body: 'Testing the reply feature' });

    expect(result).toMatchObject({ status: 'drafted', draftLeftOpen: true });
    expect(driver.pressKey).toHaveBeenCalledWith(firstReplyShortcut);
    expect(actions.fillBody).toHaveBeenCalledWith(replyPage, 'Testing the reply feature');
  });

  it('prepares Chrome for callback evaluate before using reply keyboard shortcuts', async () => {
    const { actions, driver } = createActions();
    const calls: unknown[] = [];
    let helperInstalled = false;
    const page = {
      evaluate: vi.fn(async (fnOrScript: unknown, _arg: unknown) => {
        calls.push(fnOrScript);
        if (typeof fnOrScript === 'string') {
          helperInstalled = fnOrScript.includes('__name');
          return undefined;
        }
        if (!helperInstalled) throw new Error('__name is not defined');
        return true;
      }),
      waitForSelector: vi.fn(async () => undefined),
    } as unknown as FakeReplyPage;

    const opened = await actions.openMessageComposeViaShortcut(page, 'reply');

    expect(opened).toBe(true);
    expect(String(calls[0])).toContain('__name');
    expect(driver.pressKey).toHaveBeenCalledWith(firstReplyShortcut);
  });

  it('uses Outlook Reply all shortcut when replyAll is requested', async () => {
    const { actions, driver } = createActions();
    const { page } = createDomPage(`
      <section role="region" aria-label="Reading pane">
        <article>Meeting</article>
      </section>
    `);
    const replyPage = {
      ...page,
      waitForSelector: vi.fn(async () => undefined),
    } as unknown as FakeReplyPage;
    driver.ensureOutlookTab.mockResolvedValue(replyPage);
    actions.clickOpenMessageToolbarButton = vi.fn(async () => false);
    actions.fillBody = vi.fn(async () => undefined);
    actions.readOpenDraftProbe = vi.fn(async () => ({
      snapshot: {
        ...matchingDraft,
        to: ['Karunesh Ramdass'],
        subject: 'Re: Meeting',
        body: 'Testing the reply feature',
        searchableText: 'Karunesh Ramdass Re: Meeting Testing the reply feature',
      },
      clickedSend: false,
      draftCount: 1,
      sendableDraftCount: 1,
    }));

    const result = await actions.reply({
      id: 'message-1',
      body: 'Testing the reply feature',
      replyAll: true,
    });

    expect(result).toMatchObject({ status: 'drafted', draftLeftOpen: true });
    expect(driver.pressKey).toHaveBeenCalledWith(firstReplyAllShortcut);
    expect(actions.clickOpenMessageToolbarButton).not.toHaveBeenCalled();
    expect(actions.fillBody).toHaveBeenCalledWith(replyPage, 'Testing the reply feature');
  });

  it('does not run toolbar fallback or click Archive when the reply shortcut opens compose', async () => {
    const { actions, driver } = createActions();
    const { clicks, page } = createDomPage(`
      <section role="region" aria-label="Reading pane">
        <button aria-label="Archive" data-click-id="archive">Archive</button>
        <button aria-label="Delete" data-click-id="delete">Delete</button>
      </section>
    `);
    const replyPage = {
      ...page,
      waitForSelector: vi.fn(async () => undefined),
    } as unknown as FakeReplyPage;
    driver.ensureOutlookTab.mockResolvedValue(replyPage);
    actions.clickOpenMessageToolbarButton = vi.fn(async () => {
      clicks.push('toolbar-fallback');
      return false;
    });
    actions.fillBody = vi.fn(async () => undefined);
    actions.readOpenDraftProbe = vi.fn(async () => ({
      snapshot: {
        ...matchingDraft,
        to: ['Karunesh Ramdass'],
        subject: 'Re: Meeting',
        body: 'Testing the reply feature',
        searchableText: 'Karunesh Ramdass Re: Meeting Testing the reply feature',
      },
      clickedSend: false,
      draftCount: 1,
      sendableDraftCount: 1,
    }));

    const result = await actions.reply({ id: 'message-1', body: 'Testing the reply feature' });

    expect(result).toMatchObject({ status: 'drafted', draftLeftOpen: true });
    expect(driver.pressKey).toHaveBeenCalledWith(firstReplyShortcut);
    expect(actions.clickOpenMessageToolbarButton).not.toHaveBeenCalled();
    expect(clicks).toEqual([]);
  });

  it('reports not_found when both Reply button detection and shortcut fallback miss', async () => {
    const { actions, driver } = createActions();
    const page = {
      evaluate: vi.fn(async () => undefined),
      waitForSelector: vi.fn(async () => {
        throw new Error('compose pane did not open');
      }),
    } as unknown as FakeReplyPage;
    driver.ensureOutlookTab.mockResolvedValue(page);
    actions.clickOpenMessageToolbarButton = vi.fn(async () => false);
    actions.waitForComposePane = vi.fn(async () => {
      throw new Error('compose pane did not open');
    });
    actions.fillBody = vi.fn(async () => undefined);

    const result = await actions.reply({ id: 'message-1', body: 'Testing the reply feature' });

    expect(result).toMatchObject({ status: 'not_found', draftLeftOpen: false });
    expect(driver.pressKey).not.toHaveBeenCalled();
    expect(actions.clickOpenMessageToolbarButton).toHaveBeenCalled();
    expect(actions.fillBody).not.toHaveBeenCalled();
  });

  it('reply resets to Inbox before opening the requested message id', async () => {
    const { actions } = createActions();
    const order: string[] = [];
    actions.ensureInboxFolder = vi.fn(async () => { order.push('inbox'); });
    actions.openMessageById = vi.fn(async () => { order.push('open'); return true; });
    actions.clickOpenMessageToolbarButton = vi.fn(async () => true);
    actions.fillBody = vi.fn(async () => undefined);
    actions.readOpenDraftProbe = vi.fn(async () => ({
      snapshot: {
        ...matchingDraft,
        to: ['Karunesh Ramdass'],
        subject: 'Re: Meeting',
        body: 'Testing the reply feature',
        searchableText: 'Karunesh Ramdass Re: Meeting Testing the reply feature',
      },
      clickedSend: false,
      draftCount: 1,
      sendableDraftCount: 1,
    }));

    const result = await actions.reply({ id: 'message-1', body: 'Testing the reply feature' });

    expect(result).toMatchObject({ status: 'drafted', draftLeftOpen: true });
    expect(order).toEqual(['inbox', 'open']);
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

  it('does not classify signed-in Outlook content that merely mentions sign in as auth', async () => {
    const { actions } = createBareActions();
    document.body.innerHTML = `
      <main>
        <h1>Inbox message</h1>
        <p>Please sign in to the school portal with your Microsoft account before Friday.</p>
      </main>
    `;

    const result = await actions.looksLikeSignin(fakeSigninPage() as never);

    expect(result).toBe(false);
  });

  it('classifies scoped Microsoft auth controls as sign-in', async () => {
    const { actions } = createBareActions();

    const result = await actions.looksLikeSignin(fakeSigninPage({
      headings: ['Sign in'],
      authControlVisible: true,
    }) as never);

    expect(result).toBe(true);
  });

  it('retries compose field locators before falling back to VLM', async () => {
    const { actions, driver, grounder } = createActions();
    const emptyLocator: FakeLocator = {
      count: vi.fn(async () => 0),
      first: () => emptyLocator,
      click: vi.fn(async () => undefined),
      fill: vi.fn(async () => undefined),
    };
    const subjectLocator: FakeLocator = {
      count: vi.fn()
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(1),
      first: () => subjectLocator,
      click: vi.fn(async () => undefined),
      fill: vi.fn(async () => undefined),
    };
    const page: FakeFillPage = {
      getByLabel: vi.fn((label: string) => (label === 'Subject' ? subjectLocator : emptyLocator)),
      locator: vi.fn(() => emptyLocator),
    };

    await actions.fillField(page, 'Subject', 'Delayed subject');

    expect(subjectLocator.fill).toHaveBeenCalledWith('Delayed subject', { timeout: 2000 });
    expect(driver.sleep).toHaveBeenCalledWith(250);
    expect(grounder.ground).not.toHaveBeenCalled();
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

  it('verifies body text landed in the compose body after filling', async () => {
    const { actions, driver } = createActions();
    const { page, clicks } = createVerifyingBodyFillPage(`
      <div role="dialog">
        <button aria-label="Send">Send</button>
        <div aria-label="To" role="textbox" contenteditable="true">Karunesh Ramdass</div>
        <input aria-label="Subject" value="Re: Meeting" />
        <div aria-label="Message body" contenteditable="true">Testing the reply feature</div>
      </div>
    `);

    await actions.fillBody(page, 'Testing the reply feature');

    expect(clicks).toEqual(['body-0']);
    expect(driver.typeText).toHaveBeenCalledWith('Testing the reply feature');
  });

  it('targets the compose body when the reading pane exposes Message body first', async () => {
    const { actions, driver } = createActions();
    const { page, clicks } = createVerifyingBodyFillPage(`
      <section role="region" aria-label="Reading pane">
        <div aria-label="Message body" data-click-id="reading-body">
          Original message content should not receive the reply body.
        </div>
      </section>
      <div role="dialog" aria-label="Reply draft">
        <button aria-label="Send">Send</button>
        <div aria-label="To" role="textbox" contenteditable="true">Karunesh Ramdass</div>
        <input aria-label="Subject" value="Re: Meeting" />
        <div aria-label="Message body" data-click-id="compose-body" contenteditable="true"></div>
      </div>
    `);
    driver.typeText.mockImplementation(async (text: string) => {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.textContent = `${document.activeElement.textContent ?? ''}${text}`;
      }
    });

    await actions.fillBody(page, 'Testing the reply feature');

    expect(clicks).toEqual(['compose-body']);
    expect(document.querySelector('[data-click-id="reading-body"]')?.textContent)
      .not.toContain('Testing the reply feature');
    expect(document.querySelector('[data-click-id="compose-body"]')?.textContent)
      .toContain('Testing the reply feature');
  });

  it('fails loudly when body text appears in a recipient field instead of the compose body', async () => {
    const { actions } = createActions();
    const { page } = createVerifyingBodyFillPage(`
      <div role="dialog">
        <button aria-label="Send">Send</button>
        <div aria-label="To" role="textbox" contenteditable="true">Testing the reply feature</div>
        <input aria-label="Subject" value="Re: Meeting" />
        <div aria-label="Message body" contenteditable="true"></div>
      </div>
    `);

    await expect(actions.fillBody(page, 'Testing the reply feature')).rejects.toThrow(/recipient field/i);
  });

  it('fails loudly when a short reply body appears in a recipient field', async () => {
    const { actions } = createActions();
    const { page } = createVerifyingBodyFillPage(`
      <div role="dialog">
        <button aria-label="Send">Send</button>
        <div aria-label="To" role="textbox" contenteditable="true">OK</div>
        <input aria-label="Subject" value="Re: Meeting" />
        <div aria-label="Message body" contenteditable="true"></div>
      </div>
    `);

    await expect(actions.fillBody(page, 'OK')).rejects.toThrow(/recipient field/i);
  });

  it('refuses VLM body fallback before typing when focus lands in the To field', async () => {
    const { actions, driver, grounder } = createActions();
    document.body.innerHTML = `
      <div role="dialog">
        <div aria-label="To" role="textbox" contenteditable="true">Karunesh Ramdass</div>
        <div aria-label="Message body" contenteditable="true"></div>
      </div>
    `;
    const emptyLocator: FakeLocator = {
      count: vi.fn(async () => 0),
      first: () => emptyLocator,
      click: vi.fn(async () => undefined),
    };
    const page: FakeFillPage = {
      getByLabel: vi.fn(() => emptyLocator),
      locator: vi.fn(() => emptyLocator),
      evaluate: vi.fn(async (fn, arg) => fn(arg)),
    };
    grounder.ground = vi.fn(async () => ({
      found: true,
      confidence: 0.9,
      reasoning: 'message body editor',
      question: 'body',
      bbox: { x: 10, y: 20, width: 100, height: 40 },
    }));
    driver.clickAt.mockImplementation(async () => {
      document.querySelector<HTMLElement>('[aria-label="To"]')?.focus();
    });

    await expect(actions.fillBody(page, 'Testing the reply feature')).rejects.toThrow(/recipient field/i);
    expect(driver.typeText).not.toHaveBeenCalled();
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

  it('ignores reading-pane Message body nodes when locating reviewed drafts', async () => {
    const { actions } = createActions();
    const { clicks, page } = createDomPage(`
      <section role="region" aria-label="Reading pane">
        <div aria-label="Message body">Body is not logged by this test.</div>
      </section>
      <div role="dialog">
        <button aria-label="Send" data-click-id="send-1">Send</button>
        <input aria-label="To" value="recipient@example.invalid" />
        <input aria-label="Subject" value="Demo subject" />
        <div aria-label="Message body" contenteditable="true">Body is not logged by this test.</div>
      </div>
    `);

    const result = await actions.evaluateOpenDraftDom(page, expectedDraft);

    expect(result.clickedSend).toBe(true);
    expect(result.draftCount).toBe(1);
    expect(clicks).toEqual(['send-1']);
  });

  it('reads inline reply text from the editable body inside the Outlook reading pane', async () => {
    const { actions } = createActions();
    const { page } = createDomPage(`
      <section role="region" aria-label="Reading pane">
        <article aria-label="Message body">Original email body must not be treated as the reply draft.</article>
        <button aria-label="Send" data-click-id="send-1">Send</button>
        <div aria-label="To" role="textbox" contenteditable="true">Corporate Communications</div>
        <div aria-label="Message body" role="textbox" contenteditable="true">ClawX reply matrix body</div>
      </section>
    `);

    const result = await actions.evaluateOpenDraftDom(page, null);

    expect(result.snapshot).toMatchObject({
      to: ['Corporate Communications'],
      body: 'ClawX reply matrix body',
    });
    expect(result.snapshot?.body).not.toContain('Original email body');
    expect(result.draftCount).toBe(1);
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

  it('sends the complete reviewed draft when a stale incomplete draft is also open', async () => {
    const { actions } = createActions();
    const { clicks, page } = createDomPage(`
      <div role="dialog" aria-label="Old draft">
        <button aria-label="Send" data-click-id="stale-send">Send</button>
        <input aria-label="To" value="old@example.invalid" />
        <input aria-label="Subject" value="Old draft" />
        <div aria-label="Message body" contenteditable="true"></div>
      </div>
      <div role="dialog" aria-label="Reviewed draft">
        <button aria-label="Send" data-click-id="reviewed-send">Send</button>
        <input aria-label="To" value="recipient@example.invalid" />
        <input aria-label="Subject" value="Demo subject edited by reviewer" />
        <div aria-label="Message body" contenteditable="true">Body edited by reviewer.</div>
      </div>
    `);

    const result = await actions.evaluateOpenDraftDom(page, { mode: 'current-reviewed' });

    expect(result.clickedSend).toBe(true);
    expect(result.draftCount).toBe(2);
    expect(result.sendableDraftCount).toBe(1);
    expect(clicks).toEqual(['reviewed-send']);
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

  it('sends a reviewed reply draft when Outlook hides the subject field', async () => {
    const { actions } = createActions();
    const { clicks, page } = createDomPage(`
      <div role="dialog">
        <button aria-label="Send" data-click-id="send-1">Send</button>
        <div aria-label="To" role="textbox" contenteditable="true">Karunesh Ramdass</div>
        <div aria-label="Message body" contenteditable="true">Testing the reply feature</div>
      </div>
    `);

    const result = await actions.evaluateOpenDraftDom(page, { mode: 'current-reviewed' });

    expect(result.clickedSend).toBe(true);
    expect(result.draftCount).toBe(1);
    expect(result.sendableDraftCount).toBe(1);
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

  it('clicks Reply to sender without clicking Reply all', async () => {
    const { actions } = createActions();
    const { clicks, page } = createDomPage(`
      <section role="region" aria-label="Reading pane">
        <button aria-label="Reply all" data-click-id="reply-all">Reply all</button>
        <button aria-label="Reply to sender" data-click-id="reply">Reply</button>
      </section>
    `);

    const clicked = await actions.clickOpenMessageToolbarButton(page, /^reply$/i);

    expect(clicked).toBe(true);
    expect(clicks).toEqual(['reply']);
  });

  it('clicks an icon-only Reply button identified by automation id', async () => {
    const { actions } = createActions();
    const { clicks, page } = createDomPage(`
      <section role="region" aria-label="Reading pane">
        <button aria-label="Archive" data-click-id="archive">Archive</button>
        <button data-automationid="Reply" data-click-id="reply">
          <span aria-hidden="true"></span>
        </button>
      </section>
    `);

    const clicked = await actions.clickOpenMessageToolbarButton(page, /^reply$/i);

    expect(clicked).toBe(true);
    expect(clicks).toEqual(['reply']);
  });

  it('clicks a reading-pane command bar Reply near the opened message', async () => {
    const { actions } = createActions();
    const { clicks, page } = createDomPage(`
      <section role="region" aria-label="Reading pane">
        <article aria-label="Message body">Opened message body</article>
      </section>
      <div role="toolbar" aria-label="Message actions">
        <button aria-label="Archive" data-click-id="archive">Archive</button>
        <button aria-label="Reply" data-click-id="reply">Reply</button>
      </div>
    `);

    const clicked = await actions.clickOpenMessageToolbarButton(page, /^reply$/i);

    expect(clicked).toBe(true);
    expect(clicks).toEqual(['reply']);
  });

  it('opens the message More actions menu when Reply is only available there', async () => {
    const { actions } = createActions();
    const { clicks, page } = createDomPage(`
      <section role="region" aria-label="Reading pane">
        <article aria-label="Message body">Opened message body</article>
        <button aria-label="More actions" data-click-id="more">More actions</button>
      </section>
      <div role="menu" id="message-menu" style="display: none">
        <button role="menuitem" aria-label="Archive" data-click-id="archive">Archive</button>
        <button role="menuitem" aria-label="Reply" data-click-id="reply">Reply</button>
      </div>
    `);
    document.querySelector('[data-click-id="more"]')?.addEventListener('click', () => {
      const menu = document.querySelector<HTMLElement>('#message-menu');
      if (menu) menu.style.display = 'block';
    });

    const clicked = await actions.clickOpenMessageToolbarButton(page, /^reply$/i);

    expect(clicked).toBe(true);
    expect(clicks).toEqual(['more', 'reply']);
  });

  it('opens the Respond overflow menu when Reply is nested there', async () => {
    const { actions } = createActions();
    const { clicks, page } = createDomPage(`
      <section role="region" aria-label="Reading pane">
        <article aria-label="Message body">Opened message body</article>
        <button aria-label="Respond" data-click-id="respond">Respond</button>
      </section>
      <div role="menu" id="respond-menu" style="display: none">
        <button role="menuitem" aria-label="Reply" data-click-id="reply">Reply</button>
      </div>
    `);
    document.querySelector('[data-click-id="respond"]')?.addEventListener('click', () => {
      const menu = document.querySelector<HTMLElement>('#respond-menu');
      if (menu) menu.style.display = 'block';
    });

    const clicked = await actions.clickOpenMessageToolbarButton(page, /^reply$/i);

    expect(clicked).toBe(true);
    expect(clicks).toEqual(['respond', 'reply']);
  });

  it('chooses the message More actions button when another nearby More button exists', async () => {
    const { actions } = createActions();
    const { clicks, page } = createDomPage(`
      <section role="region" aria-label="Reading pane">
        <article aria-label="Message body">Opened message body</article>
        <button aria-label="More actions" data-click-id="message-more">More actions</button>
      </section>
      <button aria-label="More actions" data-click-id="global-more">More actions</button>
      <div role="menu" id="message-menu" style="display: none">
        <button role="menuitem" aria-label="Reply" data-click-id="reply">Reply</button>
      </div>
    `);
    document.querySelector('[data-click-id="message-more"]')?.addEventListener('click', () => {
      const menu = document.querySelector<HTMLElement>('#message-menu');
      if (menu) menu.style.display = 'block';
    });

    const clicked = await actions.clickOpenMessageToolbarButton(page, /^reply$/i);

    expect(clicked).toBe(true);
    expect(clicks).toEqual(['message-more', 'reply']);
  });

  it('clicks Reply from a menu item identified by data automation id', async () => {
    const { actions } = createActions();
    const { clicks, page } = createDomPage(`
      <section role="region" aria-label="Reading pane">
        <article aria-label="Message body">Opened message body</article>
        <button aria-label="More actions" data-click-id="more">More actions</button>
      </section>
      <div role="menu" id="message-menu" style="display: none">
        <button role="menuitem" data-automation-id="Reply" data-click-id="reply">Answer</button>
      </div>
    `);
    document.querySelector('[data-click-id="more"]')?.addEventListener('click', () => {
      const menu = document.querySelector<HTMLElement>('#message-menu');
      if (menu) menu.style.display = 'block';
    });

    const clicked = await actions.clickOpenMessageToolbarButton(page, /^reply$/i);

    expect(clicked).toBe(true);
    expect(clicks).toEqual(['more', 'reply']);
  });

  it('refuses ambiguous Reply candidates inside the open message surface', async () => {
    const { actions } = createActions();
    const { clicks, page } = createDomPage(`
      <section role="region" aria-label="Reading pane">
        <button aria-label="Reply" data-click-id="reply-1">Reply</button>
        <button aria-label="Reply" data-click-id="reply-2">Reply</button>
      </section>
    `);

    const clicked = await actions.clickOpenMessageToolbarButton(page, /^reply$/i);

    expect(clicked).toBe(false);
    expect(clicks).toEqual([]);
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
