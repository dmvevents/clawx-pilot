// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chromium } from 'playwright-core';
import { ensureChromeCdpReady } from '../../electron/services/chrome-cdp';
import { PlaywrightDriver } from '../../electron/services/outlook-browser-v2/playwright-driver';

vi.mock('playwright-core', () => ({
  chromium: {
    connectOverCDP: vi.fn(),
  },
}));

vi.mock('../../electron/services/chrome-cdp', () => ({
  CHROME_CDP_ENDPOINT: 'http://127.0.0.1:18792',
  CHROME_CDP_PORT: 18792,
  defaultChromeUserDataDir: vi.fn(() => 'C:\\Users\\Teacher\\AppData\\Local\\Google\\Chrome\\User Data'),
  ensureChromeCdpReady: vi.fn(),
  resolveChromeExecutable: vi.fn(() => 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'),
}));

function fakeBrowser(contexts: unknown[]) {
  return {
    isConnected: vi.fn(() => true),
    contexts: vi.fn(() => contexts),
    newContext: vi.fn(async () => ({ pages: vi.fn(() => []) })),
    close: vi.fn(async () => undefined),
  };
}

describe('PlaywrightDriver CDP repair', () => {
  beforeEach(() => {
    vi.mocked(chromium.connectOverCDP).mockReset();
    vi.mocked(ensureChromeCdpReady).mockReset();
  });

  it('repairs Chrome CDP when the initial attach fails', async () => {
    const context = { pages: vi.fn(() => []) };
    const browser = fakeBrowser([context]);
    vi.mocked(chromium.connectOverCDP)
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(browser as never);
    vi.mocked(ensureChromeCdpReady).mockResolvedValue({
      state: 'cdp_ready',
      cdpEndpoint: 'http://127.0.0.1:18792',
      debugPort: 18792,
      userDataDir: 'C:\\Users\\Teacher\\AppData\\Local\\Google\\Chrome\\User Data',
      chromeExecutable: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      chromeProcessCount: 0,
      targetProfileProcessCount: 0,
      remoteDebugProcessCount: 0,
      message: 'ready',
      action: 'none',
    });

    const driver = new PlaywrightDriver();

    await driver.ensureBrowser();

    expect(ensureChromeCdpReady).toHaveBeenCalledWith(expect.objectContaining({
      cdpEndpoint: 'http://127.0.0.1:18792',
      debugPort: 18792,
      allowManagedProfileFallback: false,
    }));
    expect(chromium.connectOverCDP).toHaveBeenCalledTimes(2);
  });

  it('throws the actionable CDP state when repair cannot safely continue', async () => {
    vi.mocked(chromium.connectOverCDP).mockRejectedValue(new Error('ECONNREFUSED'));
    vi.mocked(ensureChromeCdpReady).mockResolvedValue({
      state: 'profile_locked_close_chrome',
      cdpEndpoint: 'http://127.0.0.1:18792',
      debugPort: 18792,
      userDataDir: 'C:\\Users\\Teacher\\AppData\\Local\\Google\\Chrome\\User Data',
      chromeExecutable: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      chromeProcessCount: 2,
      targetProfileProcessCount: 1,
      remoteDebugProcessCount: 0,
      message: 'Close Chrome and retry.',
      action: 'close_chrome_then_retry',
    });

    const driver = new PlaywrightDriver();

    await expect(driver.ensureBrowser()).rejects.toThrow('[profile_locked_close_chrome] Close Chrome and retry.');
  });
});
