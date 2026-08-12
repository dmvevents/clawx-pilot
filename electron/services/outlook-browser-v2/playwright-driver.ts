/**
 * Playwright driver for the v2 Outlook integration.
 *
 * Owns one Browser/Context/Page bound to the user's existing Chrome session.
 *
 * ## Why CDP attach instead of `launchPersistentContext`
 *
 * `launchPersistentContext({ userDataDir: <user's Chrome Default> })` would
 * give us SSO out of the box, but it FAILS to launch if Chrome is already
 * running with that profile (Chromium can't open the same profile twice).
 * Principals will commonly have Chrome open already.
 *
 * Instead we attach to the user's running Chrome via CDP on a remote
 * debugging port. The existing openclaw browser plugin starts Chrome with
 * `--remote-debugging-port=18792` (or similar) under `profile=user`. We
 * connect to it with `chromium.connectOverCDP(...)` and grab the existing
 * BrowserContext, which means we inherit cookies, IndexedDB, and the user's
 * Outlook auth.
 *
 * If the browser plugin isn't running, we fall back to launching Chrome
 * ourselves with `--remote-debugging-port` AND `--user-data-dir=<user's
 * Default>`. If current Chrome blocks CDP on that default profile, ClawX can
 * launch a dedicated system-Chrome profile for the demo. We never use
 * Playwright's bundled Chromium — managed Chromium is blocked by Microsoft's
 * Conditional Access (hard rule).
 *
 * ## Single-tab discipline
 *
 * The driver maintains exactly one Outlook tab per session (`this.page`).
 * `ensureOutlookTab()` finds an existing Outlook tab (any URL under
 * outlook.office.com / outlook.office365.com) before opening a new one.
 * This avoids the "duplicate compose pane" failure mode that bit v1.
 */
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from 'playwright-core';
import { logger } from '../../utils/logger';
import {
  CHROME_CDP_ENDPOINT,
  CHROME_CDP_PORT,
  defaultChromeUserDataDir,
  ensureChromeCdpReady,
  resolveChromeExecutable,
} from '../chrome-cdp';

/**
 * Outlook entrypoints we'll consider "this is Outlook" for tab matching.
 * Microsoft is migrating outlook.office.com → outlook.cloud.microsoft;
 * both work today and we accept both. Some tenants may also redirect
 * through outlook.office365.com.
 */
const OUTLOOK_HOST_PATTERNS = [
  /^https:\/\/outlook\.office\.com\//i,
  /^https:\/\/outlook\.office365\.com\//i,
  /^https:\/\/outlook\.cloud\.microsoft\//i,
  /^https:\/\/outlook\.live\.com\//i,
];

export interface DriverConfig {
  /** CDP endpoint exposed by the running Chrome (e.g. http://127.0.0.1:18792). */
  cdpEndpoint?: string;
  /** Override the Chrome user data dir (default: OS-specific Chrome Default). */
  userDataDir?: string;
  /** Override the Chrome executable path (default: probe known locations). */
  chromeExecutable?: string;
  /** Action timeout in ms (per click / fill / navigate). 30s default. */
  actionTimeoutMs?: number;
  /** When ClawX launches system Chrome for CDP repair, the port it exposes. */
  selfLaunchDebugPort?: number;
}

export class PlaywrightDriver {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private readonly dialogHandledPages = new WeakSet<Page>();
  private readonly cfg: Required<DriverConfig>;

  constructor(cfg: DriverConfig = {}) {
    this.cfg = {
      cdpEndpoint: cfg.cdpEndpoint ?? CHROME_CDP_ENDPOINT,
      userDataDir: cfg.userDataDir ?? defaultChromeUserDataDir(),
      chromeExecutable: cfg.chromeExecutable ?? resolveChromeExecutable(),
      actionTimeoutMs: cfg.actionTimeoutMs ?? 30_000,
      selfLaunchDebugPort: cfg.selfLaunchDebugPort ?? CHROME_CDP_PORT,
    };
  }

  /** Connect to a running Chrome via CDP, falling back to self-launch. */
  async ensureBrowser(): Promise<void> {
    if (this.browser && this.browser.isConnected()) return;

    // Path 1: CDP attach — cheapest, preserves user's running session.
    try {
      logger.info(`[outlook-v2] Connecting via CDP at ${this.cfg.cdpEndpoint}`);
      this.browser = await chromium.connectOverCDP(this.cfg.cdpEndpoint, {
        timeout: 5_000,
      });
      const contexts = this.browser.contexts();
      this.context = contexts[0] ?? await this.browser.newContext();
      return;
    } catch (err) {
      logger.warn(
        `[outlook-v2] CDP attach failed (${err instanceof Error ? err.message : String(err)}) — attempting Chrome CDP repair`,
      );
    }

    // Path 2: product-owned CDP repair. We launch system Chrome with the
    // user's profile only when it is not already locked. This mirrors the
    // Windows pilot runbook and avoids the old loop where the agent told a
    // principal to manually add Chrome debugging flags.
    const status = await ensureChromeCdpReady({
      cdpEndpoint: this.cfg.cdpEndpoint,
      debugPort: this.cfg.selfLaunchDebugPort,
      userDataDir: this.cfg.userDataDir,
      chromeExecutable: this.cfg.chromeExecutable,
      waitMs: this.cfg.actionTimeoutMs,
      allowManagedProfileFallback: true,
    });
    if (status.state !== 'cdp_ready') {
      throw new Error(`[${status.state}] ${status.message}`);
    }

    this.browser = await chromium.connectOverCDP(this.cfg.cdpEndpoint, {
      timeout: 5_000,
    });
    const contexts = this.browser.contexts();
    this.context = contexts[0] ?? await this.browser.newContext();
  }

  /**
   * Find or create the Outlook tab. Idempotent — repeated calls return the
   * same Page instance until it's closed.
   */
  async ensureOutlookTab(opts?: { forceNavigate?: boolean }): Promise<Page> {
    await this.ensureBrowser();
    if (!this.context) {
      throw new Error('PlaywrightDriver: no browser context after ensureBrowser');
    }

    // Reuse an existing live page if we already have one.
    if (this.page && !this.page.isClosed()) {
      const url = this.page.url();
      if (OUTLOOK_HOST_PATTERNS.some((p) => p.test(url)) && !opts?.forceNavigate) {
        return this.page;
      }
    }

    // Walk all pages in the context, prefer one already on Outlook.
    const pages = this.context.pages();
    let outlookPage = pages.find((p) => OUTLOOK_HOST_PATTERNS.some((re) => re.test(p.url())));
    if (!outlookPage) {
      outlookPage = pages[0] ?? await this.context.newPage();
    }

    // Navigate if needed. We always go to /mail/ so subsequent actions
    // start from the inbox view.
    const targetUrl = 'https://outlook.office.com/mail/';
    if (!OUTLOOK_HOST_PATTERNS.some((re) => re.test(outlookPage.url())) || opts?.forceNavigate) {
      await outlookPage.goto(targetUrl, {
        timeout: this.cfg.actionTimeoutMs,
        waitUntil: 'domcontentloaded',
      });
    }

    this.page = outlookPage;
    this.installDialogHandler(outlookPage);
    return outlookPage;
  }

  private installDialogHandler(page: Page): void {
    if (this.dialogHandledPages.has(page)) return;
    this.dialogHandledPages.add(page);
    page.on('dialog', (dialog) => {
      const message = dialog.message();
      logger.warn(`[outlook-v2] Dismissing browser dialog from Outlook page: ${message.slice(0, 120)}`);
      dialog.dismiss().catch((err) => {
        logger.debug?.(
          `[outlook-v2] Outlook dialog dismiss race ignored: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    });
  }

  /** Returns the current Outlook page or throws — doesn't navigate. */
  requirePage(): Page {
    if (!this.page || this.page.isClosed()) {
      throw new Error('PlaywrightDriver: no Outlook tab — call ensureOutlookTab first');
    }
    return this.page;
  }

  /** Return all live Outlook tabs in the attached Chrome context. */
  async outlookPages(): Promise<Page[]> {
    await this.ensureBrowser();
    if (!this.context) return [];
    const pages = this.context
      .pages()
      .filter((page) => !page.isClosed() && OUTLOOK_HOST_PATTERNS.some((re) => re.test(page.url())));
    for (const page of pages) {
      this.installDialogHandler(page);
    }
    return pages;
  }

  /** Take a PNG screenshot of the visible viewport. Used by the VLM grounder. */
  async screenshotViewport(): Promise<{ png: Buffer; width: number; height: number }> {
    const page = this.requirePage();
    const png = await this.withTimeout(
      page.screenshot({ type: 'png', fullPage: false }),
      'screenshotViewport',
    );
    const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
    return { png, width: viewport.width, height: viewport.height };
  }

  /**
   * Evaluate a string JS expression in the page context with a timeout.
   * outlook-actions.ts uses this for the row-fingerprint walks and the
   * read-email body extraction — both can hang if the page is in a
   * weird state (auth challenge mid-load, modal block, etc). Wrapping
   * in withTimeout ensures the IPC chain can't be hung by a stuck
   * renderer.
   */
  async evaluate<T = unknown>(script: string, label = 'evaluate'): Promise<T> {
    const page = this.requirePage();
    return this.withTimeout(page.evaluate(script) as Promise<T>, label);
  }

  /**
   * Click at viewport-pixel coordinates. Used after VLM grounding returns
   * a bbox centre. Wraps Playwright's mouse.click with the configured
   * action timeout via Promise.race so a hung browser never hangs the
   * caller indefinitely.
   */
  async clickAt(x: number, y: number): Promise<void> {
    const page = this.requirePage();
    await this.withTimeout(
      page.mouse.click(x, y, { delay: 25 }),
      `clickAt(${x}, ${y})`,
    );
  }

  /** Type into the currently-focused element. */
  async typeText(text: string): Promise<void> {
    const page = this.requirePage();
    await this.withTimeout(page.keyboard.type(text, { delay: 8 }), 'typeText');
  }

  async pressKey(key: string): Promise<void> {
    const page = this.requirePage();
    await this.withTimeout(page.keyboard.press(key), `pressKey(${key})`);
  }

  /** Sleep for ms. Plain helper; the page object's waitForTimeout is fine but explicit is clearer. */
  async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Cleanly close everything. Safe to call when nothing is open. */
  async close(): Promise<void> {
    try {
      if (this.context) await this.context.close();
    } catch (err) {
      logger.warn(
        `[outlook-v2] context.close failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.context = null;
      this.page = null;
    }
    try {
      if (this.browser) await this.browser.close();
    } catch (err) {
      logger.warn(
        `[outlook-v2] browser.close failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.browser = null;
    }
  }

  /** Promise.race wrapper that throws a useful "timed out" error. */
  private async withTimeout<T>(p: Promise<T>, label: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        p,
        new Promise<T>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Outlook action "${label}" timed out after ${this.cfg.actionTimeoutMs}ms`)),
            this.cfg.actionTimeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
