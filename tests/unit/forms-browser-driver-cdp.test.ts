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
});
