// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chromium } from 'playwright-core';
import { ensureChromeCdpReady, verifyCdpEndpointOwnershipForAttach } from '../../electron/services/chrome-cdp';
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
  verifyCdpEndpointOwnershipForAttach: vi.fn(async () => ({ allowed: true })),
}));

function allowAttach() {
  vi.mocked(verifyCdpEndpointOwnershipForAttach).mockReset();
  vi.mocked(verifyCdpEndpointOwnershipForAttach).mockResolvedValue({ allowed: true });
}

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
    allowAttach();
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
      allowManagedProfileFallback: true,
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

// This driver attaches to the PRINCIPAL'S own Chrome — profile=user is a hard
// rule, because Conditional Access blocks managed profiles on the tenant. So
// context.pages() is not a pool of scratch tabs: it is the principal's work.
// The original implementation took pages[0] when no Outlook tab existed, which
// navigated that work away. Proven live on the Mac lane 2026-09-06: pages[0]
// was a playing YouTube tab while an unused chrome://new-tab-page sat at
// index 2. These rows pin the boundary — a page is claimed only if this driver
// owns it or it is the browser's committed new-tab page. Two of them come
// straight from the Codex adversarial review (2026-09-07), which reproduced both
// failures the first fix still had: about:blank does not prove a page is empty
// (Playwright reports the last COMMITTED url, so a popup mid-navigation and a
// document.write() page both read as about:blank), and a sign-in redirect made
// every retry open another tab.
function fakePage(url: string) {
  let current = url;
  return {
    url: vi.fn(() => current),
    setUrl: (next: string) => { current = next; },
    // Real navigation commits the URL, so the fake must too — otherwise a page
    // stays "not Outlook" forever and every row silently exercises a state the
    // product never reaches.
    goto: vi.fn(async (next: string) => { current = next; return undefined; }),
    bringToFront: vi.fn(async () => undefined),
    on: vi.fn(),
    isClosed: vi.fn(() => false),
  };
}

function attachContext(pages: ReturnType<typeof fakePage>[], created = fakePage('')) {
  const context = {
    // newPage() joins the context in real Chrome; the earlier fake left it out,
    // which hid every "do we re-find our own tab?" question.
    pages: vi.fn(() => pages),
    newPage: vi.fn(async () => { pages.push(created); return created; }),
  };
  vi.mocked(chromium.connectOverCDP).mockResolvedValue(fakeBrowser([context]) as never);
  return { context, created };
}

describe('PlaywrightDriver tab selection', () => {
  beforeEach(() => {
    vi.mocked(chromium.connectOverCDP).mockReset();
    vi.mocked(ensureChromeCdpReady).mockReset();
    allowAttach();
  });

  // BOUNDARY ROW, NOT A CLWX-118 PIN — do not count it as tab-theft coverage.
  // The four original assertions here all pass against the PRE-fix driver too
  // (falsifiability lens, 2026-09-07, confirmed by reading it): bfd55b90 already
  // did `pages.find(isOutlook)` first, and its goto was already guarded by
  // `if (!isOutlook(url) || forceNavigate)` (bfd55b90:195), so with an Outlook tab
  // in the context the old code also returned it and also skipped the goto. A row
  // that cannot fail against the defect it sits next to is a coverage claim the
  // suite has not earned. The actual theft pins are the two rows below —
  // 'claims the blank new-tab page...' and 'opens its own tab when every page
  // holds the principal's work' — both of which DO fail pre-fix, where `pages[0]`
  // was YouTube and got navigated.
  // What IS discriminating here is focus: a borrowed tab must never be pulled to
  // the front (focusIfOurs gates on createdPages), which no other row asserted.
  it('reuses an existing Outlook tab, navigating and focusing nothing', async () => {
    const outlook = fakePage('https://outlook.cloud.microsoft/mail/0/');
    const other = fakePage('https://www.youtube.com/watch?v=abc');
    const { context } = attachContext([other, outlook]);

    const page = await new PlaywrightDriver().ensureOutlookTab();

    expect(page).toBe(outlook);
    expect(outlook.goto).not.toHaveBeenCalled();
    expect(other.goto).not.toHaveBeenCalled();
    expect(context.newPage).not.toHaveBeenCalled();
    // Borrowed, so not ours to raise: yanking the principal's window to a tab
    // they did not ask for is the same trust violation as navigating it.
    expect(outlook.bringToFront).not.toHaveBeenCalled();
    expect(other.bringToFront).not.toHaveBeenCalled();
  });

  it('claims the blank new-tab page instead of the principal\'s first tab', async () => {
    const youtube = fakePage('https://www.youtube.com/watch?v=abc');
    const form = fakePage('https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=x');
    const blank = fakePage('chrome://new-tab-page/');
    const { context } = attachContext([youtube, form, blank]);

    const page = await new PlaywrightDriver().ensureOutlookTab();

    expect(page).toBe(blank);
    expect(blank.goto).toHaveBeenCalledWith('https://outlook.office.com/mail/', expect.anything());
    // The whole point: the principal's tabs are untouched.
    expect(youtube.goto).not.toHaveBeenCalled();
    expect(form.goto).not.toHaveBeenCalled();
    expect(context.newPage).not.toHaveBeenCalled();
    // Converse of the borrowed-tab row: this one IS ours, and the recovery copy
    // tells the principal to act in "the Chrome window that just opened", so it
    // has to actually come forward.
    expect(blank.bringToFront).toHaveBeenCalled();
    expect(youtube.bringToFront).not.toHaveBeenCalled();
  });

  it('opens its own tab when every page holds the principal\'s work', async () => {
    const youtube = fakePage('https://www.youtube.com/watch?v=abc');
    const casesearch = fakePage('https://casesearch.courts.state.md.us/casesearch/x');
    const mine = fakePage('');
    const { context } = attachContext([youtube, casesearch], mine);

    const page = await new PlaywrightDriver().ensureOutlookTab();

    expect(page).toBe(mine);
    expect(context.newPage).toHaveBeenCalledTimes(1);
    expect(mine.goto).toHaveBeenCalledWith('https://outlook.office.com/mail/', expect.anything());
    expect(youtube.goto).not.toHaveBeenCalled();
    expect(casesearch.goto).not.toHaveBeenCalled();
  });

  // BOUNDARY ROW, NOT A CLWX-118 PIN — tautological with respect to the defect.
  // An empty context reaches newPage under BOTH implementations (`pages[0] ??
  // newPage()` and `find() ?? newPage()` are identical when there are no pages),
  // so this row can only ever catch a regression in the empty case itself. Kept
  // for that, labelled so nobody counts it twice.
  it('opens its own tab when the context is empty', async () => {
    const mine = fakePage('');
    const { context } = attachContext([], mine);

    const page = await new PlaywrightDriver().ensureOutlookTab();

    expect(page).toBe(mine);
    expect(context.newPage).toHaveBeenCalledTimes(1);
    expect(mine.bringToFront).toHaveBeenCalled();
  });

  it('does not claim a page that merely reports about:blank', async () => {
    // A principal's popup loading somewhere else, or a document.write() page
    // holding unsaved input, both report about:blank. Emptiness is unprovable
    // from the URL, so we open our own tab instead.
    const youtube = fakePage('https://www.youtube.com/watch?v=abc');
    const popup = fakePage('about:blank');
    const mine = fakePage('');
    const { context } = attachContext([youtube, popup], mine);

    const page = await new PlaywrightDriver().ensureOutlookTab();

    expect(page).toBe(mine);
    expect(context.newPage).toHaveBeenCalledTimes(1);
    expect(popup.goto).not.toHaveBeenCalled();
    expect(youtube.goto).not.toHaveBeenCalled();
  });

  it('keeps ONE tab across the Microsoft sign-in redirect', async () => {
    // CAE revokes cookies within minutes on this tenant, so the redirect to the
    // sign-in wall is routine — not an edge case. Retries must reuse our tab.
    const newTab = fakePage('chrome://new-tab-page/');
    const { context } = attachContext([newTab]);
    const driver = new PlaywrightDriver();

    const first = await driver.ensureOutlookTab();
    expect(first).toBe(newTab);
    expect(newTab.goto).toHaveBeenCalledTimes(1);

    newTab.setUrl('https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=x');

    const second = await driver.ensureOutlookTab();
    const third = await driver.ensureOutlookTab();

    expect(second).toBe(newTab);
    expect(third).toBe(newTab);
    expect(context.newPage).not.toHaveBeenCalled();
    // Still one navigation: we did not restart the sign-in under the principal.
    expect(newTab.goto).toHaveBeenCalledTimes(1);
  });

  // ── Rows below pin the SECOND fix round (Claude review lane, 2026-09-07).
  // The first fix tracked "pages we have used" and added every page it matched,
  // including the principal's own Outlook tab. Chrome keeps the same CDP target
  // (so the same Page object) across same-tab navigations, so that grant never
  // expired: a tab claimable at 09:00 because it showed Outlook was still
  // claimable at 11:00 showing a half-written form. Rights come from CREATION.

  it('does not navigate a borrowed Outlook tab after the principal moves it elsewhere', async () => {
    const theirs = fakePage('https://outlook.cloud.microsoft/mail/0/');
    const mine = fakePage('');
    const { context } = attachContext([theirs], mine);
    const driver = new PlaywrightDriver();

    expect(await driver.ensureOutlookTab()).toBe(theirs);
    expect(theirs.goto).not.toHaveBeenCalled();

    // Same tab, same Page object, different work — a class list, say.
    theirs.setUrl('https://docs.google.com/spreadsheets/d/abc/edit');

    const next = await driver.ensureOutlookTab();

    expect(next).toBe(mine);
    expect(theirs.goto).not.toHaveBeenCalled();
    expect(context.newPage).toHaveBeenCalledTimes(1);
  });

  it('prefers a signed-in Outlook tab over our own tab parked on the sign-in wall', async () => {
    // The normal recovery on this tenant: the principal signs in themselves in
    // another tab. Returning our auth-parked tab strands every action at the wall
    // while a usable mailbox sits one index away.
    const newTab = fakePage('chrome://new-tab-page/');
    const { context } = attachContext([newTab]);
    const driver = new PlaywrightDriver();

    const ours = await driver.ensureOutlookTab();
    expect(ours).toBe(newTab);
    newTab.setUrl('https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=x');

    const signedIn = fakePage('https://outlook.office.com/mail/0/');
    context.pages.mockReturnValue([newTab, signedIn]);

    const page = await driver.ensureOutlookTab();

    expect(page).toBe(signedIn);
    expect(signedIn.goto).not.toHaveBeenCalled();
    expect(newTab.goto).toHaveBeenCalledTimes(1);
  });

  it('records and focuses the tab BEFORE navigating, so a failed goto leaks nothing', async () => {
    const mine = fakePage('');
    mine.goto.mockRejectedValueOnce(new Error('net::ERR_NAME_NOT_RESOLVED'));
    const { context } = attachContext([], mine);
    const driver = new PlaywrightDriver();

    await expect(driver.ensureOutlookTab()).rejects.toThrow('ERR_NAME_NOT_RESOLVED');
    expect(context.newPage).toHaveBeenCalledTimes(1);

    // The retry must find the tab we already opened, not orphan it and open another.
    const again = await driver.ensureOutlookTab();
    expect(again).toBe(mine);
    expect(context.newPage).toHaveBeenCalledTimes(1);
    // Focus first: if this lands on a sign-in wall the principal has to be able to
    // find the tab that is asking them to sign in.
    expect(mine.bringToFront.mock.invocationCallOrder[0])
      .toBeLessThan(mine.goto.mock.invocationCallOrder[0]);
  });

  it('forceNavigate re-homes an Outlook tab without gaining rights over it', async () => {
    const theirs = fakePage('https://outlook.office.com/mail/0/inbox');
    const youtube = fakePage('https://www.youtube.com/watch?v=abc');
    const mine = fakePage('');
    const { context } = attachContext([youtube, theirs], mine);
    const driver = new PlaywrightDriver();

    // scripts/v2-goto-inbox.ts: "go to the inbox" — intra-app, so allowed.
    expect(await driver.ensureOutlookTab({ forceNavigate: true })).toBe(theirs);
    expect(theirs.goto).toHaveBeenCalledWith('https://outlook.office.com/mail/', expect.anything());
    expect(youtube.goto).not.toHaveBeenCalled();

    // Rights did not transfer: once it is no longer Outlook, it is off limits.
    theirs.setUrl('https://www.bbc.com/news');
    expect(await driver.ensureOutlookTab()).toBe(mine);
    expect(theirs.goto).toHaveBeenCalledTimes(1);
    expect(context.newPage).toHaveBeenCalledTimes(1);
  });
});

// ── CLWX-130 attach boundary ─────────────────────────────────────────────────
// The independent review reproduced that this driver called connectOverCDP
// FIRST and only consulted the ownership check when the connect failed — so a
// REACHABLE endpoint owned by another Windows session was attached and driven,
// bypassing the new guard entirely. The gate must run BEFORE any connect.
describe('PlaywrightDriver attach ownership gate (CLWX-130)', () => {
  beforeEach(() => {
    vi.mocked(chromium.connectOverCDP).mockReset();
    vi.mocked(ensureChromeCdpReady).mockReset();
    allowAttach();
  });

  it('refuses to connect when the endpoint is owned by another Windows session — connectOverCDP is never called', async () => {
    vi.mocked(verifyCdpEndpointOwnershipForAttach).mockResolvedValue({
      allowed: false,
      status: {
        state: 'foreign_endpoint_owner',
        cdpEndpoint: 'http://127.0.0.1:18792',
        debugPort: 18792,
        userDataDir: 'x',
        chromeExecutable: 'x',
        chromeProcessCount: 0,
        targetProfileProcessCount: 0,
        remoteDebugProcessCount: 0,
        message: 'The Chrome automation connection on this computer is in use by a different Windows user\'s session.',
        action: 'resolve_port_conflict',
      },
    });

    const driver = new PlaywrightDriver();

    await expect(driver.ensureBrowser()).rejects.toThrow('[foreign_endpoint_owner]');
    // The whole point: a reachable wrong-session endpoint must not be attached,
    // and a refusal must not be "repaired" into an attach either.
    expect(chromium.connectOverCDP).not.toHaveBeenCalled();
    expect(ensureChromeCdpReady).not.toHaveBeenCalled();
  });

  it('runs the ownership gate BEFORE the first connect attempt', async () => {
    const context = { pages: vi.fn(() => []) };
    vi.mocked(chromium.connectOverCDP).mockResolvedValue(fakeBrowser([context]) as never);

    await new PlaywrightDriver().ensureBrowser();

    expect(verifyCdpEndpointOwnershipForAttach).toHaveBeenCalledTimes(1);
    expect(vi.mocked(verifyCdpEndpointOwnershipForAttach).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(chromium.connectOverCDP).mock.invocationCallOrder[0]);
    // Ownership and readiness must describe ONE endpoint identity: the gate is
    // handed the same endpoint (and self-launch port) the connect uses.
    expect(verifyCdpEndpointOwnershipForAttach).toHaveBeenCalledWith(expect.objectContaining({
      cdpEndpoint: 'http://127.0.0.1:18792',
      debugPort: 18792,
    }));
  });
});

// ── CLWX-121: compose state binds to the OWNED tab (MEDIUM-7 before MEDIUM-8) ─
// The two send_email gates evaluate compose panes. A pane on a tab this driver
// does not drive is the principal's own work: matching a reviewed subject
// there, or counting their half-written email as "our draft", binds the send
// contract to a pane nobody reviewed. Guard (a): the only trustable compose
// surface is the bound tab (composeSurface). Guard (b): the draft scan
// (outlookPages) is DERIVED from that same binding, so the scan cannot be
// narrowed without the binding — the coupling CLWX-121 names is structural.
describe('PlaywrightDriver owned compose surface (CLWX-121)', () => {
  beforeEach(() => {
    vi.mocked(chromium.connectOverCDP).mockReset();
    vi.mocked(ensureChromeCdpReady).mockReset();
    allowAttach();
  });

  it('MEDIUM-7 pin: the compose surface is exactly the tab the driver drives, never another Outlook tab', async () => {
    // The principal's own Outlook tab (with their compose pane) sits at a lower
    // index than ours. A subject match may only ever be evaluated against the
    // tab ensureOutlookTab bound — the same Page object it returned.
    const theirs = fakePage('https://outlook.office.com/mail/0/');
    const { context } = attachContext([theirs]);
    const driver = new PlaywrightDriver();

    const bound = await driver.ensureOutlookTab();

    expect(driver.composeSurface()).toBe(bound);
    // And the draft scan exposes ONLY that same surface object — no cross-tab
    // pane can reach the gates through the scan.
    const another = fakePage('https://outlook.office365.com/mail/1/');
    context.pages.mockReturnValue([theirs, another]);
    expect(await driver.outlookPages()).toEqual([bound]);
  });

  it('MEDIUM-8 pin: the draft scan no longer sees the principal\'s other Outlook tabs', async () => {
    const newTab = fakePage('chrome://new-tab-page/');
    const theirsA = fakePage('https://outlook.office.com/mail/0/');
    const theirsB = fakePage('https://outlook.cloud.microsoft/mail/deeplink/compose');
    const { context } = attachContext([theirsA, newTab]);
    const driver = new PlaywrightDriver();

    // forceNavigate:false would borrow theirsA; force our own claimed tab so the
    // row exercises tabs that are genuinely NOT the bound one.
    const bound = await driver.ensureOutlookTab({ forceNavigate: true });
    context.pages.mockReturnValue([theirsA, bound, theirsB] as never);

    const scanned = await driver.outlookPages();

    // Pre-fix this returned every Outlook tab in the context (theirsA, theirsB
    // included) — the principal's own compose pane counted as our draft state.
    expect(scanned).toEqual([bound]);
  });

  it('exposes NO compose surface when its bound tab is gone, instead of silently rebinding to someone else\'s tab', async () => {
    const theirs = fakePage('https://outlook.office.com/mail/0/');
    const { context } = attachContext([theirs]);
    const driver = new PlaywrightDriver();

    const bound = await driver.ensureOutlookTab();
    expect(driver.composeSurface()).toBe(bound);

    // The bound tab closes; another Outlook tab (the principal's) remains.
    (bound as unknown as ReturnType<typeof fakePage>).isClosed.mockReturnValue(true);
    const survivor = fakePage('https://outlook.office.com/mail/0/');
    context.pages.mockReturnValue([survivor] as never);

    expect(driver.composeSurface()).toBeNull();
    expect(await driver.outlookPages()).toEqual([]);
  });

  it('spends the compose binding when the bound tab leaves Outlook', async () => {
    const newTab = fakePage('chrome://new-tab-page/');
    attachContext([newTab]);
    const driver = new PlaywrightDriver();

    const bound = await driver.ensureOutlookTab();
    expect(driver.composeSurface()).toBe(bound);

    // The principal repurposes the tab: it is no longer a compose surface, and
    // the scan must not treat whatever is there as draft state.
    (bound as unknown as ReturnType<typeof fakePage>).setUrl('https://docs.google.com/spreadsheets/d/abc/edit');

    expect(driver.composeSurface()).toBeNull();
    expect(await driver.outlookPages()).toEqual([]);
  });

  it('keeps driving ITS bound tab when another Outlook tab appears at a lower index', async () => {
    // Subject binding across calls: once bound, repeated ensureOutlookTab calls
    // must return the SAME tab — not whichever Outlook tab happens to be found
    // first — or the gates would evaluate a pane on a tab nobody reviewed.
    const newTab = fakePage('chrome://new-tab-page/');
    const { context } = attachContext([newTab]);
    const driver = new PlaywrightDriver();

    const bound = await driver.ensureOutlookTab();
    const theirs = fakePage('https://outlook.office.com/mail/0/');
    context.pages.mockReturnValue([theirs, bound] as never);

    const again = await driver.ensureOutlookTab();

    expect(again).toBe(bound);
    expect(theirs.goto).not.toHaveBeenCalled();
    expect(theirs.bringToFront).not.toHaveBeenCalled();
  });
});
