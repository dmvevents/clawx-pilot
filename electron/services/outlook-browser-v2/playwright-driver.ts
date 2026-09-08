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
  verifyCdpEndpointOwnershipForAttach,
} from '../chrome-cdp';

/**
 * Outlook entrypoints we'll consider "this is Outlook" for tab matching.
 * Microsoft is migrating outlook.office.com → outlook.cloud.microsoft;
 * both work today and we accept both. Some tenants may also redirect
 * through outlook.office365.com.
 *
 * WORK accounts only. `outlook.live.com` (consumer Hotmail/Outlook.com) was
 * briefly listed here and is deliberately gone: this product is tenant-only
 * (`@moe.gov.tt` / `@fac.edu.tt`), and matching it meant a principal's personal
 * mailbox tab could be adopted as THE mailbox — reading, drafting, and running
 * the two-gate send against the wrong account. The wrong-mailbox hazard is worse
 * than opening one extra tab. `scripts/probe-outlook-tab.mjs` mirrors this exact
 * list and `tests/unit/probe-outlook-tab.test.ts` pins the parity.
 */
const OUTLOOK_HOST_PATTERNS = [
  /^https:\/\/outlook\.office\.com\//i,
  /^https:\/\/outlook\.office365\.com\//i,
  /^https:\/\/outlook\.cloud\.microsoft\//i,
];

/**
 * The browser's own new-tab page — a COMMITTED, definitely-empty target, so
 * navigating it destroys nothing. Everything else in the context belongs to the
 * principal: this driver attaches to THEIR Chrome by hard rule (profile=user),
 * so the page list is their real work, not a pool of scratch tabs.
 *
 * `about:blank` and '' are deliberately NOT here. Playwright reports the last
 * COMMITTED url, so a principal's popup that is mid-navigation somewhere else
 * still reads as about:blank, and a document.write() page keeps about:blank while
 * holding unsaved input. Claiming those is the same theft with extra steps
 * (Codex adversarial review, 2026-09-07). Ownership is tracked explicitly
 * instead — an unclaimable context just costs us one new tab, which is the
 * cheap side of this trade.
 */
const NEW_TAB_PAGE_PATTERNS = [
  /^chrome:\/\/new-?tab-?page\/?$/i,
  /^chrome:\/\/newtab\/?$/i,
  /^edge:\/\/newtab\/?$/i,
];

/**
 * Microsoft's sign-in wall. Outlook redirects here whenever the session expires
 * (CAE revokes cookies in minutes on this tenant), and a tab WE CREATED is still
 * ours while it sits there. Treating it as "not Outlook" made every following
 * tool call open another tab — three calls, three tabs — which is exactly the
 * duplicate-pane failure the single-tab discipline exists to prevent.
 *
 * Work-account sign-in hosts only, and used ONLY to keep a tab we created (never
 * to claim one). `login.live.com` is deliberately absent for the same reason
 * `outlook.live.com` is: consumer identity is not this product's business.
 */
const MICROSOFT_AUTH_HOST_PATTERNS = [
  /^https:\/\/login\.microsoftonline\.(com|us)\//i,
  /^https:\/\/device\.login\.microsoftonline\.com\//i,
  /^https:\/\/login\.microsoft\.com\//i,
  /^https:\/\/login\.windows\.net\//i,
  /^https:\/\/autologon\.microsoftazuread-sso\.com\//i,
];

/** Exported for the host-list parity test against scripts/probe-outlook-tab.mjs. */
export function isOutlookUrl(url: string): boolean {
  return OUTLOOK_HOST_PATTERNS.some((re) => re.test(url ?? ''));
}

/** Where we always land, so every action starts from the inbox view. */
const OUTLOOK_MAIL_URL = 'https://outlook.office.com/mail/';

function isNewTabPage(url: string): boolean {
  return NEW_TAB_PAGE_PATTERNS.some((re) => re.test((url ?? '').trim()));
}

function isMicrosoftAuthUrl(url: string): boolean {
  return MICROSOFT_AUTH_HOST_PATTERNS.some((re) => re.test(url ?? ''));
}

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
  /**
   * Tabs this driver CREATED (context.newPage) or claimed while they were the
   * browser's committed new-tab page, mapped to the URL we navigated them to.
   * Membership is the ONLY thing that authorizes navigating a page away from what
   * it currently shows.
   *
   * Deliberately not "pages we have used": the first fix added every page it
   * matched — including a pre-existing Outlook tab of the principal's — and
   * Chrome keeps the same CDP target (so the same Page object) across same-tab
   * navigations. A tab granted rights because it was on Outlook at 09:00 stayed
   * grantable at 11:00 when the principal had moved it to a half-written form,
   * which resurrects the exact theft this fix exists to stop.
   *
   * The grant is also not permanent, for the same reason pointed the other way
   * (Claude correctness lens, 2026-09-07): we open our tab AND bring it to the
   * front, so the tab we would hold rights over forever is precisely the one the
   * principal is now looking at and liable to type a URL into. `stillOurs` spends
   * the grant the moment the tab no longer holds what we put there.
   *
   * Known limit, recorded rather than papered over: a WeakMap is per-Page-object,
   * so ownership does not survive a CDP reconnect (fresh Page objects) or another
   * process. The failure mode of forgetting is conservative — we open a new tab.
   */
  private readonly createdPages = new WeakMap<Page, string>();
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

    // Every path below establishes a NEW connection, which means new Page objects.
    // Anything this.page still points at belongs to the dead one, and whether
    // isClosed() flips on a CDP disconnect is not something we should bet a
    // navigation on — so forget it here rather than operate a stale handle. Losing
    // it is conservative: ensureOutlookTab re-finds a real Outlook tab, or opens
    // one. (The createdPages grants are per-Page-object and lapse for free.)
    this.page = null;

    // Attach boundary (CLWX-130): a REACHABLE loopback endpoint is not proof it
    // is this user's Chrome — on a multi-session Windows server the port can be
    // answered by a Chrome in another user's session, and connecting first
    // would drive it. Verify ownership BEFORE any connectOverCDP; a refusal
    // here must not be "repaired" into an attach either.
    const attachGate = await verifyCdpEndpointOwnershipForAttach({
      cdpEndpoint: this.cfg.cdpEndpoint,
      debugPort: this.cfg.selfLaunchDebugPort,
      userDataDir: this.cfg.userDataDir,
      chromeExecutable: this.cfg.chromeExecutable,
    });
    if (!attachGate.allowed) {
      throw new Error(`[${attachGate.status.state}] ${attachGate.status.message}`);
    }

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
    const ctx = this.context;
    if (!ctx) {
      throw new Error('PlaywrightDriver: no browser context after ensureBrowser');
    }
    const force = opts?.forceNavigate === true;
    const live = () => ctx.pages().filter((p) => !p.isClosed());
    const usable = (p: Page | null): p is Page => p !== null && !p.isClosed();

    // ── Phase 1: is a usable Outlook tab already open? ─────────────────────
    // Order matters. The scan for a live Outlook tab must come BEFORE the
    // fast path for our own tab parked on the sign-in wall: the reverse order
    // stranded every call on that sign-in page while a signed-in Outlook tab sat
    // one index away in the same context (the principal signs in themselves in
    // another tab, which is the normal recovery on this tenant).
    if (!force) {
      if (usable(this.page) && isOutlookUrl(this.page.url())) return await this.attachTo(this.page);
      const open = live().find((p) => isOutlookUrl(p.url()));
      if (open) return await this.attachTo(open);
      // Our own tab mid-sign-in. Retries must land back on it, not stack tabs.
      if (usable(this.page) && this.stillOurs(this.page) && isMicrosoftAuthUrl(this.page.url())) {
        return await this.attachTo(this.page);
      }
    }

    // ── Phase 2: pick a tab we are ALLOWED to navigate ─────────────────────
    // Taking pages[0] here navigated whatever the principal happened to have in
    // their first tab away from under them — proven live 2026-09-06 on the Mac
    // lane, where pages[0] was a playing YouTube tab and an unused
    // chrome://new-tab-page sat at index 2. The principal loses a half-written
    // form or a class list and reads it as the assistant breaking their browser,
    // which is exactly the trust the profile=user rule exists to protect.
    //
    // So navigation rights come from creation, never from what a page reports.
    // The one exception is forceNavigate (a dev entrypoint: scripts/v2-goto-inbox
    // .ts) re-homing a tab that is already inside Outlook — intra-app, and what
    // that script means by "go to the inbox".
    // `live().includes` and not just `!isClosed()`: ensureBrowser can have replaced
    // the connection under us, and a Page from the dead one does not necessarily
    // report closed. It nulls this.page on reconnect, and this is the belt to that
    // brace — an operation on a stale handle is worse than opening a tab.
    const own = live();
    const reusableOwn = usable(this.page) && own.includes(this.page) && this.stillOurs(this.page)
      ? this.page
      : own.find((p) => this.stillOurs(p));
    // Under forceNavigate, prefer OUR Outlook tab: `find` over the page list would
    // re-home the principal's tab while ours sat untouched, which is single-tab
    // discipline pointed at the wrong tab.
    const borrowedOutlook = force
      ? (usable(this.page) && isOutlookUrl(this.page.url())
        ? this.page
        : own.find((p) => isOutlookUrl(p.url())))
      : undefined;
    const claimable = own.find((p) => isNewTabPage(p.url()));

    let target: Page;
    if (reusableOwn) {
      target = reusableOwn;                                  // already ours
    } else if (borrowedOutlook) {
      target = borrowedOutlook;                              // stays the principal's — NOT recorded
    } else if (claimable) {
      target = claimable;
      this.createdPages.set(target, OUTLOOK_MAIL_URL);       // a committed empty tab, ours now
    } else {
      target = await ctx.newPage();
      this.createdPages.set(target, OUTLOOK_MAIL_URL);
    }

    // Register the tab BEFORE navigating. Doing it after meant a goto rejection
    // (timeout, sign-in interstitial, network drop) left a tab we had created
    // unrecorded and unreferenced — one orphan per failed call — while this.page
    // still pointed at the stale previous tab. Same reason the dialog handler and
    // the focus go first: a beforeunload prompt is raised DURING the navigation, so
    // a handler installed afterwards never sees it, and if we are about to park on a
    // sign-in wall the principal has to be able to find the tab asking them to sign
    // in.
    this.page = target;
    this.installDialogHandler(target);
    await this.focusIfOurs(target);
    await target.goto(OUTLOOK_MAIL_URL, {
      timeout: this.cfg.actionTimeoutMs,
      waitUntil: 'domcontentloaded',
    });
    return target;
  }

  /**
   * Is this tab still ours to NAVIGATE? Creation grants that right; the grant is
   * spent as soon as the tab stops holding what we put there, because the same
   * Page object survives the principal typing a new URL into it.
   *
   * `about:blank` counts as still-ours here even though it is deliberately
   * unclaimable in NEW_TAB_PAGE_PATTERNS. The two rules answer different
   * questions: we can never know that SOMEONE ELSE's about:blank page is empty,
   * but a page we created ourselves and whose goto has not committed yet
   * definitely is — and treating it as forfeited would leak one orphan tab per
   * failed navigation, the exact bug the register-before-goto ordering fixed.
   */
  private stillOurs(page: Page): boolean {
    const granted = this.createdPages.get(page);
    if (granted === undefined) return false;
    const url = (page.url() ?? '').trim();
    if (
      url === granted
      || url === '' || url === 'about:blank'
      || isOutlookUrl(url)
      || isMicrosoftAuthUrl(url)
      || isNewTabPage(url)
    ) {
      return true;
    }
    // The principal has repurposed it. Forget it rather than navigate their work
    // away — forgetting costs one extra tab, the cheap side of this trade.
    this.createdPages.delete(page);
    return false;
  }

  /**
   * Drive an already-usable tab: remember it and make its dialogs ours, without
   * navigating it. Used for a tab we created AND for a pre-existing Outlook tab
   * of the principal's — driving their open Outlook is the intended design; only
   * navigating it away is not.
   */
  private async attachTo(page: Page): Promise<Page> {
    this.page = page;
    this.installDialogHandler(page);
    await this.focusIfOurs(page);
    return page;
  }

  /**
   * Bring a tab forward only when it is one of OURS.
   *
   * Ours needs it: the caller's recovery text tells the principal "sign in in
   * Chrome and retry" (outlook-actions.ts:589), and every retry after the first
   * used to return through a path that never focused, so the tab they were being
   * asked to act on stayed in the background (Claude correctness lens, 2026-09-07).
   * A borrowed tab must NOT be focused: yanking the principal's own window to the
   * front mid-task is the disturbance the trust lens objects to, and we do not need
   * focus to drive a tab.
   */
  private async focusIfOurs(page: Page): Promise<void> {
    if (!this.createdPages.has(page)) return;
    try {
      await page.bringToFront();
    } catch {
      // Cosmetic only — never fail an email action because focus could not move.
    }
  }

  private installDialogHandler(page: Page): void {
    if (this.dialogHandledPages.has(page)) return;
    this.dialogHandledPages.add(page);
    page.on('dialog', (dialog) => {
      const message = dialog.message();
      // `beforeunload` is not a prompt to dismiss — it asks "leave this page?", so
      // dismiss() CANCELS our own navigation. Playwright's unhandled default is
      // accept (node_modules/playwright-core/lib/server/dialog.js:61-66), and the
      // blanket dismiss silently inverted it: a goto that Outlook guarded because a
      // compose was unsent quietly did not happen, the caller swallowed the
      // rejection at debug level, and the next inbox-scoped action read the compose
      // view as the mailbox. Verified from Playwright source, 2026-09-07.
      //
      // So answer it by OWNERSHIP, which is the only honest split: our own tab's
      // unsent draft is ours to discard, and a silently-cancelled navigation there
      // costs a misread mailbox. The principal's borrowed tab is not — cancelling
      // our navigation is the correct outcome when the alternative is discarding
      // their unsaved work, and it is logged at warn so it cannot pass unnoticed.
      if (dialog.type() === 'beforeunload') {
        const ours = this.createdPages.has(page);
        logger.warn(
          ours
            ? '[outlook-v2] beforeunload on our own tab — accepting (navigation proceeds; any unsent draft of OURS is discarded)'
            : '[outlook-v2] beforeunload on the principal\'s own tab — DISMISSING, so our navigation is cancelled rather than discard their unsaved work. The caller must treat this navigation as not-performed',
        );
        (ours ? dialog.accept() : dialog.dismiss()).catch((err) => {
          logger.debug?.(
            `[outlook-v2] beforeunload answer race ignored: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
        return;
      }
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

  /**
   * The ONLY compose surface the send/draft gates may trust: the tab this
   * driver is currently bound to (`this.page`), re-validated as live, still a
   * member of the current context, and still on Outlook (CLWX-121, MEDIUM-7).
   *
   * Compose state — "is a draft open", "does the pane carry the reviewed
   * subject" — is meaningful only on the tab the driver drives. A pane on any
   * OTHER tab is the principal's own work: matching a subject there, or
   * counting their half-written email as "our draft is still open", binds the
   * send contract to a pane nobody reviewed. Returns null rather than ever
   * silently re-binding to some other Outlook tab.
   */
  composeSurface(): Page | null {
    const bound = this.page;
    if (!bound || bound.isClosed()) return null;
    if (!this.context || !this.context.pages().includes(bound)) return null;
    return isOutlookUrl(bound.url()) ? bound : null;
  }

  /**
   * The pages the draft-visibility scan may inspect.
   *
   * READ-ONLY by contract: the only caller is outlook-actions'
   * `hasAnyVisibleOpenDraft`, which evaluates a visibility predicate to protect
   * the two-gate send.
   *
   * NARROWED to the bound tab (CLWX-121, MEDIUM-8) and deliberately DERIVED
   * from `composeSurface()` — the subject-match binding — so the scan cannot be
   * narrowed without that binding being in place; the coupling the card names
   * is structural, not conventional. It used to return every Outlook tab in
   * the context, which made the principal's own compose pane in another tab
   * count as compose state of ours: it blocked legitimate drafting ("a draft
   * is already open" about a pane we do not drive) and it was the only thing
   * accidentally masking the unbound subject match. When the driver holds no
   * usable bound tab this returns [] — the caller falls back to the page it
   * already holds, never to someone else's tab.
   *
   * What this does NOT buy, stated plainly because the first version of this
   * comment claimed it (Claude correctness lens, 2026-09-07): it does not hand the
   * principal back their own dialogs. Outlook's "Discard draft?" is a DOM dialog,
   * not a browser one (see `clickDiscardConfirmOk`), so no page.on('dialog')
   * handler ever saw it; and for real native dialogs, un-subscribing does not opt
   * out — with no handler attached Playwright closes the dialog itself
   * (dialog.js:76-88), context-wide, for as long as we are attached over CDP.
   * Removing our handler swapped "we answer it and log it" for "Playwright answers
   * it and nobody logs it". That is a CDP-attach property we cannot change from
   * here; it is recorded so nobody re-derives it as a fix.
   */
  async outlookPages(): Promise<Page[]> {
    await this.ensureBrowser();
    const surface = this.composeSurface();
    return surface ? [surface] : [];
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
