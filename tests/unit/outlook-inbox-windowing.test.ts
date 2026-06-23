// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { OutlookActions } from '@electron/services/outlook-browser-v2/outlook-actions';

type TestActions = OutlookActions & {
  looksLikeSignin: () => Promise<boolean>;
  ensureInboxFolder: (page: unknown) => Promise<void>;
  readInbox: (top?: number) => Promise<{
    status: 'ok' | 'needs_signin';
    messages: Array<{ id: string; subject: string; sender: string; snippet: string; receivedAt: string; unread: boolean }>;
    message?: string;
    scan?: unknown;
  }>;
};

function createActions(options: { mockEnsureInbox?: boolean } = {}) {
  const page = {
    url: () => 'https://outlook.office.com/mail/inbox',
    waitForSelector: vi.fn(async () => undefined),
    evaluate: vi.fn(async (script: string) => {
      const limit = Number(script.match(/const limit = (\d+);/)?.[1] ?? 0);
      return Array.from({ length: limit }, (_, i) => ({
        id: `sender-${i}|subject-${i}|9:${String(i).padStart(2, '0')} AM`,
        sender: `Sender ${i}`,
        subject: `Subject ${i}`,
        snippet: `Snippet ${i}`,
        received: `9:${String(i).padStart(2, '0')} AM`,
        unread: i % 2 === 0,
      }));
    }),
  };
  const driver = {
    ensureOutlookTab: vi.fn(async () => page),
  };
  const actions = new OutlookActions(driver as never, { ground: vi.fn() } as never) as unknown as TestActions;
  actions.looksLikeSignin = vi.fn(async () => false);
  if (options.mockEnsureInbox !== false) {
    actions.ensureInboxFolder = vi.fn(async () => undefined);
  }
  return { actions, page };
}

function createInboxGuardPage(
  initialUrl: string,
  options: { redirectUrl?: string; domConfirmed?: boolean; failGoto?: boolean } = {},
) {
  let currentUrl = initialUrl;
  const page = {
    url: () => currentUrl,
    goto: vi.fn(async (targetUrl: string) => {
      if (options.failGoto) throw new Error('navigation failed');
      currentUrl = options.redirectUrl ?? targetUrl;
    }),
    waitForLoadState: vi.fn(async () => undefined),
    waitForSelector: vi.fn(async () => undefined),
    evaluate: vi.fn(async () => options.domConfirmed ?? false),
  };
  return page;
}

describe('Outlook inbox windowing', () => {
  it('readInbox evaluates the requested row window instead of the default window', async () => {
    const { actions, page } = createActions();

    const result = await actions.readInbox(37);

    expect(result.messages).toHaveLength(37);
    expect(result.scan).toMatchObject({
      scope: 'recent_inbox_window',
      requestedTop: 37,
      scannedCount: 37,
      returnedCount: 37,
      exhaustive: false,
    });
    expect(page.evaluate).toHaveBeenCalledWith(expect.stringContaining('const limit = 49;'));
  });

  it('readInbox skips open-draft pseudo rows before selecting reply targets', async () => {
    const { actions, page } = createActions();
    page.evaluate = vi.fn(async (script: string) => {
      if (!script.includes('const limit =')) return false;
      return [
        {
          id: '[Draft]|Karunesh Ramdass Meeting|Mon 10:08 PM',
          sender: '[Draft]',
          subject: 'Karunesh Ramdass Meeting',
          snippet: '',
          received: 'Mon 10:08 PM',
          unread: false,
        },
        {
          id: 'Karunesh Ramdass|Meeting|Mon 10:08 PM',
          sender: 'Karunesh Ramdass',
          subject: 'Meeting',
          snippet: 'Do you wanna have a meeting tomorrow?',
          received: 'Mon 10:08 PM',
          unread: true,
        },
      ];
    });

    const result = await actions.readInbox(1);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      id: 'Karunesh Ramdass|Meeting|Mon 10:08 PM',
      sender: 'Karunesh Ramdass',
      subject: 'Meeting',
    });
    expect(result.scan).toMatchObject({
      requestedTop: 1,
      scannedCount: 1,
      returnedCount: 1,
      artifactSkippedCount: 1,
    });
  });

  it('searchInbox reads a wider inbox window before applying a small result cap', async () => {
    const { actions } = createActions();
    actions.readInbox = vi.fn(async (top = 10) => ({
      status: 'ok',
      messages: Array.from({ length: top }, (_, i) => ({
        id: `message-${i}`,
        sender: 'District Office',
        subject: i === 42 ? 'Suspension report' : 'Routine circular',
        snippet: '',
        receivedAt: '2026-06-06T12:00:00Z',
        unread: false,
      })),
    }));

    const result = await actions.searchInbox({ subjectContains: 'suspension', top: 5 });

    expect(actions.readInbox).toHaveBeenCalledWith(50);
    expect(result.messages.map((message) => message.id)).toEqual(['message-42']);
    expect(result.scan).toMatchObject({
      scope: 'recent_inbox_window',
      requestedTop: 5,
      fetchedTop: 50,
      scannedCount: 50,
      matchedCount: 1,
      returnedCount: 1,
      exhaustive: false,
    });
  });

  it('searchInbox caps the widened inbox read at 200 rows', async () => {
    const { actions } = createActions();
    actions.readInbox = vi.fn(async () => ({ status: 'ok', messages: [] }));

    await actions.searchInbox({ subjectContains: 'district', top: 90 });

    expect(actions.readInbox).toHaveBeenCalledWith(200);
  });

  it('searchInbox reports incomplete scope when the widened read reaches the fetch limit', async () => {
    const { actions } = createActions();
    actions.readInbox = vi.fn(async (top = 10) => ({
      status: 'ok',
      messages: Array.from({ length: top }, (_, i) => ({
        id: `message-${i}`,
        sender: i % 50 === 0 ? 'Raj Ramdass' : 'Corporate Communications',
        subject: i % 50 === 0 ? 'June workshop' : 'Routine circular',
        snippet: '',
        receivedAt: i % 50 === 0 ? '2026-06-09T12:00:00Z' : '2026-05-30T12:00:00Z',
        unread: false,
      })),
    }));

    const result = await actions.searchInbox({
      dateGte: '2026-06-01T00:00:00.000Z',
      dateLt: '2026-07-01T00:00:00.000Z',
      top: 200,
    });

    expect(actions.readInbox).toHaveBeenCalledWith(200);
    expect(result.messages).toHaveLength(4);
    expect(result.capped).toBe(true);
    expect(result.scan).toMatchObject({
      scope: 'recent_inbox_window',
      requestedTop: 200,
      fetchedTop: 200,
      scannedCount: 200,
      matchedCount: 4,
      returnedCount: 4,
      exhaustive: false,
    });
    expect(result.scan?.note).toMatch(/do not claim/i);
  });

  it('searchInbox can match an older June message near the widened 200-row boundary', async () => {
    const { actions } = createActions();
    actions.readInbox = vi.fn(async (top = 10) => ({
      status: 'ok',
      messages: Array.from({ length: top }, (_, i) => ({
        id: `message-${i}`,
        sender: 'District Office',
        subject: i === 199 ? 'June safety notice' : 'Routine circular',
        snippet: '',
        receivedAt: i === 199 ? '2026-06-03T12:00:00Z' : '2026-05-30T12:00:00Z',
        unread: false,
      })),
    }));

    const result = await actions.searchInbox({
      dateGte: '2026-06-01T00:00:00.000Z',
      dateLt: '2026-07-01T00:00:00.000Z',
      top: 50,
    });

    expect(actions.readInbox).toHaveBeenCalledWith(200);
    expect(result.messages.map((message) => message.id)).toEqual(['message-199']);
    expect(result.scan).toMatchObject({
      fetchedTop: 200,
      scannedCount: 200,
      matchedCount: 1,
      exhaustive: false,
    });
  });

  it('readInbox confirms Inbox scope before evaluating visible rows', async () => {
    const { actions, page } = createActions();
    const order: string[] = [];
    actions.ensureInboxFolder = vi.fn(async () => { order.push('inbox'); });
    page.evaluate = vi.fn(async (script: string) => {
      if (script.includes('const limit =')) {
        order.push('rows');
        return [];
      }
      order.push('list-probe');
      return false;
    });

    await actions.readInbox(5);

    expect(order[0]).toBe('inbox');
    expect(order).toContain('rows');
    expect(order.indexOf('inbox')).toBeLessThan(order.indexOf('rows'));
  });

  it('readInbox reports sign-in when Inbox navigation lands on an auth shell', async () => {
    const { actions, page } = createActions();
    let signInChecks = 0;
    actions.looksLikeSignin = vi.fn(async () => {
      signInChecks += 1;
      return signInChecks > 1;
    });
    actions.ensureInboxFolder = vi.fn(async () => {
      throw new Error('Outlook Inbox folder could not be confirmed after navigation.');
    });

    const result = await actions.readInbox(5);

    expect(result.status).toBe('needs_signin');
    expect(result.messages).toEqual([]);
    expect(result.message).toMatch(/sign in/i);
    expect(page.evaluate).not.toHaveBeenCalledWith(expect.stringContaining('const limit ='));
  });

  it('accepts Outlook cloud Inbox URLs without navigating away from the signed-in host', async () => {
    const { actions } = createActions({ mockEnsureInbox: false });
    const page = createInboxGuardPage('https://outlook.cloud.microsoft/mail/0/inbox');

    await actions.ensureInboxFolder(page as never);

    expect(page.goto).not.toHaveBeenCalled();
  });

  it('navigates away from Sent Items before reading folder-scoped rows', async () => {
    const { actions } = createActions({ mockEnsureInbox: false });
    const page = createInboxGuardPage('https://outlook.cloud.microsoft/mail/sentitems', {
      redirectUrl: 'https://outlook.cloud.microsoft/mail/inbox',
    });

    await actions.ensureInboxFolder(page as never);

    expect(page.goto).toHaveBeenCalledWith('https://outlook.office.com/mail/inbox', expect.any(Object));
  });

  it.each([
    ['Drafts', 'https://outlook.cloud.microsoft/mail/drafts'],
    ['Archive', 'https://outlook.cloud.microsoft/mail/archive'],
    ['Search', 'https://outlook.cloud.microsoft/mail/search/id/AAMkAGVj/search'],
  ])('navigates away from %s before reading folder-scoped rows', async (_folder, url) => {
    const { actions } = createActions({ mockEnsureInbox: false });
    const page = createInboxGuardPage(url, {
      redirectUrl: 'https://outlook.cloud.microsoft/mail/inbox',
    });

    await actions.ensureInboxFolder(page as never);

    expect(page.goto).toHaveBeenCalledWith('https://outlook.office.com/mail/inbox', expect.any(Object));
  });

  it('refuses to parse visible rows when Inbox cannot be confirmed after navigation', async () => {
    const { actions } = createActions({ mockEnsureInbox: false });
    const page = createInboxGuardPage('https://outlook.cloud.microsoft/mail/sentitems', {
      redirectUrl: 'https://outlook.cloud.microsoft/mail/sentitems',
      domConfirmed: false,
    });

    await expect(actions.ensureInboxFolder(page as never)).rejects.toThrow(/Inbox folder could not be confirmed/i);
  });

  it('accepts a selected Inbox nav item when Outlook redirects to a neutral mail URL', async () => {
    const { actions } = createActions({ mockEnsureInbox: false });
    const page = createInboxGuardPage('https://outlook.cloud.microsoft/mail/sentitems', {
      redirectUrl: 'https://outlook.cloud.microsoft/mail/',
      domConfirmed: true,
    });

    await expect(actions.ensureInboxFolder(page as never)).resolves.toBeUndefined();
  });
});
