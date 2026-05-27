// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chromium } from 'playwright-core';
import { FormsDriver } from '../../electron/services/forms-browser-v2/forms-driver';

vi.mock('playwright-core', () => ({
  chromium: {
    connectOverCDP: vi.fn(),
  },
}));

function fakeBrowser({ connected, contexts }: { connected: boolean; contexts: unknown[] }) {
  return {
    isConnected: vi.fn(() => connected),
    contexts: vi.fn(() => contexts),
    close: vi.fn(async () => undefined),
  };
}

function fakePage(initialUrl: string) {
  let currentUrl = initialUrl;
  return {
    url: vi.fn(() => currentUrl),
    goto: vi.fn(async (nextUrl: string) => {
      currentUrl = nextUrl;
    }),
    waitForLoadState: vi.fn(async () => undefined),
    waitForSelector: vi.fn(async () => undefined),
    waitForTimeout: vi.fn(async () => undefined),
    bringToFront: vi.fn(async () => undefined),
  };
}

describe('FormsDriver CDP connection lifecycle', () => {
  beforeEach(() => {
    vi.mocked(chromium.connectOverCDP).mockReset();
  });

  it('reconnects when the cached CDP browser has no contexts', async () => {
    const stale = fakeBrowser({ connected: true, contexts: [] });
    const fresh = fakeBrowser({ connected: true, contexts: [{}] });
    vi.mocked(chromium.connectOverCDP).mockResolvedValue(fresh as never);

    const driver = new FormsDriver({ cdpEndpoint: 'http://127.0.0.1:18792' });
    (driver as unknown as { browser: unknown }).browser = stale;

    await driver.ensureBrowser();

    expect(stale.close).toHaveBeenCalledTimes(1);
    expect(chromium.connectOverCDP).toHaveBeenCalledWith('http://127.0.0.1:18792');
    expect((driver as unknown as { browser: unknown }).browser).toBe(fresh);
  });

  it('opens a fresh tab instead of reusing a different Forms response page', async () => {
    const suspensionsPage = fakePage('https://forms.office.com/Pages/ResponsePage.aspx?id=suspensions-form');
    const dailyPage = fakePage('about:blank');
    const context = {
      pages: vi.fn(() => [suspensionsPage]),
      newPage: vi.fn(async () => dailyPage),
    };
    const browser = fakeBrowser({ connected: true, contexts: [context] });

    const driver = new FormsDriver({ cdpEndpoint: 'http://127.0.0.1:18792' });
    (driver as unknown as { browser: unknown }).browser = browser;

    await driver.ensureFormsTab('https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=daily-report-form');

    expect(context.newPage).toHaveBeenCalledTimes(1);
    expect(suspensionsPage.goto).not.toHaveBeenCalled();
    expect(dailyPage.goto).toHaveBeenCalledWith(
      'https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=daily-report-form',
      expect.objectContaining({ waitUntil: 'domcontentloaded' }),
    );
    expect(dailyPage.waitForSelector).toHaveBeenCalledWith(
      '[data-automation-id="questionItem"], [role="listitem"]',
      expect.objectContaining({ state: 'visible' }),
    );
  });

  it('opens new Forms tabs in a Microsoft-authenticated context when available', async () => {
    const unauthPage = fakePage('about:blank');
    const targetPage = fakePage('about:blank');
    const unauthContext = {
      pages: vi.fn(() => [unauthPage]),
      newPage: vi.fn(async () => fakePage('about:blank')),
    };
    const microsoftContext = {
      pages: vi.fn(() => [fakePage('https://outlook.cloud.microsoft/mail/')]),
      newPage: vi.fn(async () => targetPage),
    };
    const browser = fakeBrowser({ connected: true, contexts: [unauthContext, microsoftContext] });

    const driver = new FormsDriver({ cdpEndpoint: 'http://127.0.0.1:18792' });
    (driver as unknown as { browser: unknown }).browser = browser;

    await driver.ensureFormsTab('https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=suspensions-form');

    expect(unauthContext.newPage).not.toHaveBeenCalled();
    expect(microsoftContext.newPage).toHaveBeenCalledTimes(1);
    expect(targetPage.goto).toHaveBeenCalledWith(
      'https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=suspensions-form',
      expect.objectContaining({ waitUntil: 'domcontentloaded' }),
    );
  });

  it('reloads a matching Forms response tab before previewing', async () => {
    const suspensionsPage = fakePage('https://forms.office.com/Pages/ResponsePage.aspx?id=suspensions-form');
    const context = {
      pages: vi.fn(() => [suspensionsPage]),
      newPage: vi.fn(async () => fakePage('about:blank')),
    };
    const browser = fakeBrowser({ connected: true, contexts: [context] });

    const driver = new FormsDriver({ cdpEndpoint: 'http://127.0.0.1:18792' });
    (driver as unknown as { browser: unknown }).browser = browser;

    await driver.ensureFormsTab('https://forms.office.com/Pages/ResponsePage.aspx?id=suspensions-form');

    expect(context.newPage).not.toHaveBeenCalled();
    expect(suspensionsPage.goto).toHaveBeenCalledWith(
      'https://forms.office.com/Pages/ResponsePage.aspx?id=suspensions-form',
      expect.objectContaining({ waitUntil: 'domcontentloaded' }),
    );
  });

  it('does not report hidden conditional fields as visible required fields', async () => {
    const hiddenItem = {
      isVisible: vi.fn(async () => false),
      innerText: vi.fn(async () => 'Additional infractions\nThis question is required.'),
      locator: vi.fn(),
    };
    const driver = new FormsDriver({ cdpEndpoint: 'http://127.0.0.1:18792' });
    (driver as unknown as { page: unknown }).page = {};
    (driver as unknown as { findQuestionItem: () => Promise<unknown> }).findQuestionItem = async () => hiddenItem;

    await expect(driver.inspectField('Additional infractions')).resolves.toEqual({
      visible: false,
      hasValue: false,
      required: false,
      text: 'Additional infractions\nThis question is required.',
    });
    expect(hiddenItem.locator).not.toHaveBeenCalled();
  });

  it('accepts the Microsoft Forms submitted response screen after clicking submit', async () => {
    let bodyText = 'Primary School Student Suspensions';
    let submitVisible = true;
    const submitButton = {
      count: vi.fn(async () => 1),
      first: vi.fn(function first() {
        return this;
      }),
      click: vi.fn(async () => {
        bodyText = 'Your response was submitted. Submit another response';
        submitVisible = false;
      }),
      isVisible: vi.fn(async () => submitVisible),
    };
    const driver = new FormsDriver({ cdpEndpoint: 'http://127.0.0.1:18792' });
    (driver as unknown as { page: unknown; getVisibleTitle: () => Promise<string> }).page = {
      getByRole: vi.fn(() => submitButton),
      locator: vi.fn((selector: string) => {
        if (selector === 'body') return { innerText: vi.fn(async () => bodyText) };
        return { evaluateAll: vi.fn(async () => []) };
      }),
      waitForLoadState: vi.fn(async () => undefined),
      waitForResponse: vi.fn(async () => {
        throw new Error('timeout');
      }),
      waitForTimeout: vi.fn(async () => undefined),
    };
    (driver as unknown as { getVisibleTitle: () => Promise<string> }).getVisibleTitle = async () => 'Primary School Student Suspensions';

    await expect(driver.submit({ confirm: true, expectedTitle: 'Primary School Student Suspensions' })).resolves.toEqual({
      status: 'submitted',
      message: 'Form submitted via Microsoft Forms.',
    });
  });

  it.each([
    'Your response has been submitted.',
    'Your response has been successfully submitted.',
    'Submit another response',
  ])('accepts Microsoft Forms confirmation text: %s', async (confirmationText) => {
    let bodyText = 'Primary School Student Suspensions';
    const submitButton = {
      count: vi.fn(async () => 1),
      first: vi.fn(function first() {
        return this;
      }),
      click: vi.fn(async () => {
        bodyText = confirmationText;
      }),
      isVisible: vi.fn(async () => false),
    };
    const driver = new FormsDriver({ cdpEndpoint: 'http://127.0.0.1:18792' });
    (driver as unknown as { page: unknown; getVisibleTitle: () => Promise<string> }).page = {
      getByRole: vi.fn(() => submitButton),
      locator: vi.fn((selector: string) => {
        if (selector === 'body') return { innerText: vi.fn(async () => bodyText) };
        return { evaluateAll: vi.fn(async () => []) };
      }),
      waitForLoadState: vi.fn(async () => undefined),
      waitForResponse: vi.fn(async () => {
        throw new Error('timeout');
      }),
      waitForTimeout: vi.fn(async () => undefined),
    };
    (driver as unknown as { getVisibleTitle: () => Promise<string> }).getVisibleTitle = async () => 'Primary School Student Suspensions';

    await expect(driver.submit({ confirm: true, expectedTitle: 'Primary School Student Suspensions' })).resolves.toEqual({
      status: 'submitted',
      message: 'Form submitted via Microsoft Forms.',
    });
  });

  it('accepts a successful Microsoft Forms response POST after clicking submit', async () => {
    const submitButton = {
      count: vi.fn(async () => 1),
      first: vi.fn(function first() {
        return this;
      }),
      click: vi.fn(async () => undefined),
      isVisible: vi.fn(async () => true),
    };
    const driver = new FormsDriver({ cdpEndpoint: 'http://127.0.0.1:18792' });
    (driver as unknown as { page: unknown; getVisibleTitle: () => Promise<string> }).page = {
      getByRole: vi.fn(() => submitButton),
      locator: vi.fn((selector: string) => {
        if (selector === 'body') return { innerText: vi.fn(async () => 'Primary School Student Suspensions') };
        return { evaluateAll: vi.fn(async () => []) };
      }),
      waitForLoadState: vi.fn(async () => undefined),
      waitForResponse: vi.fn(async (predicate: (response: unknown) => boolean) => {
        const response = {
          request: () => ({ method: () => 'POST' }),
          status: () => 201,
          url: () => 'https://forms.office.com/formapi/api/tenant/users/user/forms(%27demo%27)/responses',
        };
        if (predicate(response)) return response;
        throw new Error('no response match');
      }),
      waitForTimeout: vi.fn(async () => undefined),
    };
    (driver as unknown as { getVisibleTitle: () => Promise<string> }).getVisibleTitle = async () => 'Primary School Student Suspensions';

    await expect(driver.submit({ confirm: true, expectedTitle: 'Primary School Student Suspensions' })).resolves.toEqual({
      status: 'submitted',
      message: 'Form submitted via Microsoft Forms.',
    });
  });

  it('returns visible Microsoft Forms validation errors after clicking submit', async () => {
    const submitButton = {
      count: vi.fn(async () => 1),
      first: vi.fn(function first() {
        return this;
      }),
      click: vi.fn(async () => undefined),
      isVisible: vi.fn(async () => true),
    };
    const driver = new FormsDriver({ cdpEndpoint: 'http://127.0.0.1:18792' });
    (driver as unknown as { page: unknown; getVisibleTitle: () => Promise<string> }).page = {
      getByRole: vi.fn(() => submitButton),
      locator: vi.fn((selector: string) => {
        if (selector === 'body') return { innerText: vi.fn(async () => 'Primary School Student Suspensions') };
        return { evaluateAll: vi.fn(async () => ['This question is required.']) };
      }),
      waitForLoadState: vi.fn(async () => undefined),
      waitForResponse: vi.fn(async () => {
        throw new Error('timeout');
      }),
      waitForTimeout: vi.fn(async () => undefined),
    };
    (driver as unknown as { getVisibleTitle: () => Promise<string> }).getVisibleTitle = async () => 'Primary School Student Suspensions';

    const result = await driver.submit({ confirm: true, expectedTitle: 'Primary School Student Suspensions' });

    expect(result).toEqual({
      status: 'error',
      reason: 'Microsoft Forms kept the response open with validation errors: This question is required.',
    });
  });
});
