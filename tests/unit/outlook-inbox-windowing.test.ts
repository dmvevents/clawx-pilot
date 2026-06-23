// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { OutlookActions } from '@electron/services/outlook-browser-v2/outlook-actions';

type TestActions = OutlookActions & {
  looksLikeSignin: () => Promise<boolean>;
  ensureInboxFolder: (page: unknown) => Promise<void>;
  readInbox: (top?: number) => Promise<{ status: 'ok'; messages: Array<{ id: string; subject: string; sender: string; snippet: string; receivedAt: string; unread: boolean }> }>;
};

function createActions() {
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
  actions.ensureInboxFolder = vi.fn(async () => undefined);
  return { actions, page };
}

describe('Outlook inbox windowing', () => {
  it('readInbox evaluates the requested row window instead of the default window', async () => {
    const { actions, page } = createActions();

    const result = await actions.readInbox(37);

    expect(result.messages).toHaveLength(37);
    expect(page.evaluate).toHaveBeenCalledWith(expect.stringContaining('const limit = 37;'));
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
  });

  it('searchInbox caps the widened inbox read at 200 rows', async () => {
    const { actions } = createActions();
    actions.readInbox = vi.fn(async () => ({ status: 'ok', messages: [] }));

    await actions.searchInbox({ subjectContains: 'district', top: 90 });

    expect(actions.readInbox).toHaveBeenCalledWith(200);
  });
});
