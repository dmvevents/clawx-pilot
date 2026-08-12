// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { OutlookActions } from '@electron/services/outlook-browser-v2/outlook-actions';

type FakeLocator = {
  count: () => Promise<number>;
  first: () => FakeLocator;
  click: (options?: unknown) => Promise<void>;
  fill?: (value: string, options?: unknown) => Promise<void>;
};

type FakePage = {
  evaluate: <TArg, TResult>(fn: (arg: TArg) => TResult, arg: TArg) => Promise<TResult>;
  getByLabel: (label: string, options?: unknown) => FakeLocator;
  locator: (selector: string) => FakeLocator;
  waitForSelector?: (selector: string, options?: unknown) => Promise<unknown>;
};

type TestActions = OutlookActions & {
  looksLikeSignin: (page: unknown) => Promise<boolean>;
  ensureInboxFolder: (page: unknown) => Promise<void>;
  ensureInboxFolderOrSignin: (page: unknown) => Promise<boolean>;
  openMessageById: (page: unknown, id: string) => Promise<boolean>;
  dismissBlockingDialog: (page: unknown) => Promise<void>;
  waitForComposePane: (page: unknown) => Promise<void>;
  readOpenDraftProbe: (page?: unknown) => Promise<{
    snapshot: {
      to: string[];
      cc: string[];
      bcc: string[];
      subject: string;
      body: string;
      searchableText: string;
    } | null;
    clickedSend: boolean;
    draftCount: number;
    sendableDraftCount: number;
  }>;
  readOpenSubject: (page: unknown) => Promise<string>;
  clickOpenMessageToolbarButton: (page: FakePage, nameRegex: RegExp) => Promise<boolean>;
  openMessageComposeViaShortcut: (page: unknown, action: 'reply' | 'replyAll' | 'forward') => Promise<boolean>;
  hasAnyVisibleOpenDraft: (page: FakePage) => Promise<boolean>;
  fillField: (page: unknown, label: 'To' | 'Cc' | 'Bcc' | 'Subject', value: string) => Promise<void>;
};

function visibleRect() {
  return {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 120,
    bottom: 32,
    width: 120,
    height: 32,
    toJSON: () => ({}),
  } as DOMRect;
}

function makeVisible(element: Element) {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => visibleRect(),
  });
}

function createActions() {
  const driver = {
    ensureOutlookTab: vi.fn(),
    screenshotViewport: vi.fn(async () => ({ png: Buffer.alloc(0), width: 1, height: 1 })),
    clickAt: vi.fn(),
    pressKey: vi.fn(),
    sleep: vi.fn(),
    typeText: vi.fn(),
  };
  const grounder = { ground: vi.fn() };
  const actions = new OutlookActions(driver as never, grounder as never) as unknown as TestActions;

  actions.looksLikeSignin = vi.fn(async () => false);
  actions.ensureInboxFolder = vi.fn(async () => undefined);
  actions.ensureInboxFolderOrSignin = vi.fn(async () => true);
  actions.openMessageById = vi.fn(async () => true);
  actions.dismissBlockingDialog = vi.fn(async () => undefined);
  actions.waitForComposePane = vi.fn(async () => undefined);
  actions.readOpenSubject = vi.fn(async () => 'Re: Meeting');
  actions.readOpenDraftProbe = vi.fn(async () => ({
    snapshot: {
      to: ['Karunesh Ramdass'],
      cc: [],
      bcc: [],
      subject: 'Re: Meeting',
      body: 'Testing the reply feature',
      searchableText: 'Karunesh Ramdass Re: Meeting Testing the reply feature',
    },
    clickedSend: false,
    draftCount: 1,
    sendableDraftCount: 1,
  }));
  actions.openMessageComposeViaShortcut = vi.fn(async () => false);
  actions.hasAnyVisibleOpenDraft = vi.fn(async () => false);

  return { actions, driver };
}

function createComposePageWithBodyTextInToField(body: string): FakePage {
  document.body.innerHTML = `
    <div role="dialog">
      <button aria-label="Send">Send</button>
      <div aria-label="To" role="textbox" contenteditable="true">${body}</div>
      <input aria-label="Subject" value="Re: Meeting" />
      <div aria-label="Message body" contenteditable="true" tabindex="0"></div>
    </div>
  `;
  document.querySelectorAll('*').forEach(makeVisible);

  const emptyLocator: FakeLocator = {
    count: vi.fn(async () => 0),
    first: () => emptyLocator,
    click: vi.fn(async () => undefined),
    fill: vi.fn(async () => undefined),
  };
  const bodyLocator: FakeLocator = {
    count: vi.fn(async () => 1),
    first: () => bodyLocator,
    click: vi.fn(async () => {
      document.querySelector<HTMLElement>('[aria-label="Message body"]')?.focus();
    }),
  };

  return {
    evaluate: async (fn, arg) => fn(arg),
    getByLabel: vi.fn((label: string) => (label === 'Message body' ? bodyLocator : emptyLocator)),
    locator: vi.fn((selector: string) => (/Message body|body/i.test(selector) ? bodyLocator : emptyLocator)),
    waitForSelector: vi.fn(async () => undefined),
  };
}

describe('Outlook reply/reply-all/forward field targeting', () => {
  it('does not claim a reply draft when body text is composed in the To field', async () => {
    const body = 'Testing the reply feature';
    const { actions, driver } = createActions();
    const page = createComposePageWithBodyTextInToField(body);
    driver.ensureOutlookTab.mockResolvedValue(page);
    actions.clickOpenMessageToolbarButton = vi.fn(async () => true);

    await expect(actions.reply({ id: 'message-1', body })).rejects.toThrow(/recipient field/i);

    expect(actions.readOpenDraftProbe).not.toHaveBeenCalled();
  });

  it('does not claim a reply-all draft when body text is composed in the To field', async () => {
    const body = 'Testing the reply-all feature';
    const { actions, driver } = createActions();
    const page = createComposePageWithBodyTextInToField(body);
    driver.ensureOutlookTab.mockResolvedValue(page);
    actions.clickOpenMessageToolbarButton = vi.fn(async () => true);

    await expect(actions.reply({ id: 'message-1', body, replyAll: true })).rejects.toThrow(/recipient field/i);

    expect(actions.clickOpenMessageToolbarButton).toHaveBeenCalledWith(page, /^reply all$/i);
    expect(actions.readOpenDraftProbe).not.toHaveBeenCalled();
  });

  it('does not claim a forward draft when body text is composed in the To field', async () => {
    const body = 'Testing the forward feature';
    const { actions, driver } = createActions();
    const page = createComposePageWithBodyTextInToField(body);
    driver.ensureOutlookTab.mockResolvedValue(page);
    actions.clickOpenMessageToolbarButton = vi.fn(async () => true);
    actions.fillField = vi.fn(async () => undefined);

    await expect(actions.forward({ id: 'message-1', to: 'teacher@example.invalid', body }))
      .rejects.toThrow(/recipient field/i);

    expect(actions.clickOpenMessageToolbarButton).toHaveBeenCalledWith(page, /^forward$/i);
    expect(actions.fillField).toHaveBeenCalledWith(page, 'To', 'teacher@example.invalid');
  });
});
