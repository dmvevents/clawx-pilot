/**
 * Unit tests for the outlook-browser service.
 *
 * Covers:
 *  - open() returns needs_signin when the snapshot looks like the Microsoft
 *    sign-in interstitial.
 *  - open() returns 'opened' when Outlook Web has loaded the inbox.
 *  - readInbox() parses the message-list snapshot into InboxMessage objects.
 *  - draftEmail() builds the right click+fill sequence and never sends.
 *  - sendEmail() refuses without confirm=true; sends only when confirm=true.
 *
 * The browser-plugin client is fully mocked — these tests never touch a
 * real Outlook session and never start a real Chrome.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OutlookBrowserManager,
  extractInboxMessages,
} from '../../electron/services/outlook-browser/manager';
import type { OutlookBrowserClient } from '../../electron/services/outlook-browser/browser-client';

interface ActLogEntry {
  kind: string;
  selector?: string;
  fields?: Array<{ selector?: string; value?: string }>;
}

interface MockClientState {
  statusCalls: number;
  startCalls: number;
  openCalls: Array<{ url: string; profile: string | undefined }>;
  acts: ActLogEntry[];
  /** Drives what snapshot() returns; tests overwrite per-case. */
  nextSnapshot: unknown;
  running: boolean;
}

function createMockClient(state: MockClientState): OutlookBrowserClient {
  return {
    status: vi.fn(async () => {
      state.statusCalls += 1;
      return {
        running: state.running,
        cdpReady: state.running,
        transport: 'cdp',
      };
    }),
    start: vi.fn(async () => {
      state.startCalls += 1;
      state.running = true;
      return { ok: true };
    }),
    open: vi.fn(async (url: string, profile?: string) => {
      state.openCalls.push({ url, profile });
      return { targetId: 'tab-1' };
    }),
    navigate: vi.fn(async () => ({ ok: true })),
    snapshot: vi.fn(async () => state.nextSnapshot),
    act: vi.fn(async (_targetId: string, request: Record<string, unknown>) => {
      state.acts.push(request as unknown as ActLogEntry);
      return { ok: true };
    }),
  };
}

function freshState(): MockClientState {
  return {
    statusCalls: 0,
    startCalls: 0,
    openCalls: [],
    acts: [],
    nextSnapshot: { url: 'https://outlook.office.com/mail/', tree: { children: [] } },
    running: true,
  };
}

describe('OutlookBrowserManager.open', () => {
  let state: MockClientState;
  let mgr: OutlookBrowserManager;

  beforeEach(() => {
    state = freshState();
    mgr = new OutlookBrowserManager(createMockClient(state));
  });

  it('returns needs_signin when DOM detects Microsoft sign-in by URL', async () => {
    state.nextSnapshot = {
      url: 'https://login.microsoftonline.com/common/oauth2/authorize?…',
      tree: { children: [] },
    };

    const result = await mgr.open();

    expect(result.status).toBe('needs_signin');
    expect(result.url).toContain('login.microsoftonline.com');
    expect(result.message).toMatch(/sign in/i);
  });

  it('returns needs_signin when DOM tree contains "Pick an account" heading', async () => {
    state.nextSnapshot = {
      url: 'https://outlook.office.com/mail/',
      tree: {
        children: [
          { role: 'heading', name: 'Pick an account' },
          { role: 'textbox', name: 'Email, phone, or Skype' },
        ],
      },
    };

    const result = await mgr.open();

    expect(result.status).toBe('needs_signin');
  });

  it('returns opened when the snapshot looks like the inbox', async () => {
    state.nextSnapshot = {
      url: 'https://outlook.office.com/mail/inbox',
      tree: {
        children: [
          { role: 'banner', name: 'Outlook' },
          { role: 'main', children: [] },
        ],
      },
    };

    const result = await mgr.open();

    expect(result.status).toBe('opened');
    expect(result.targetId).toBe('tab-1');
    expect(state.openCalls[0].profile).toBe('user');
    expect(state.openCalls[0].url).toBe('https://outlook.office.com/mail/');
  });
});

describe('OutlookBrowserManager.readInbox', () => {
  it('parses sample DOM into messages', async () => {
    const state = freshState();
    state.nextSnapshot = {
      url: 'https://outlook.office.com/mail/inbox',
      tree: {
        children: [
          {
            role: 'main',
            children: [
              {
                role: 'listbox',
                children: [
                  {
                    role: 'option',
                    ref: 'msg-aaa',
                    name: 'Maria Roberts, Term 3 reminders, 9:42 AM, Please confirm receipt of the daily report',
                    description: 'unread',
                  },
                  {
                    role: 'option',
                    ref: 'msg-bbb',
                    name: 'District Office, Suspensions form update, Tue 5/20, New URL effective 1 June',
                  },
                ],
              },
            ],
          },
        ],
      },
    };

    const mgr = new OutlookBrowserManager(createMockClient(state));
    const result = await mgr.readInbox(5);

    expect(result.status).toBe('ok');
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toMatchObject({
      sender: 'Maria Roberts',
      subject: 'Term 3 reminders',
      receivedAt: '9:42 AM',
      unread: true,
    });
    expect(result.messages[0].snippet).toContain('Please confirm');
    expect(result.messages[1]).toMatchObject({
      sender: 'District Office',
      subject: 'Suspensions form update',
      unread: false,
    });
  });

  it('caps results to the requested top N', async () => {
    const state = freshState();
    state.nextSnapshot = {
      url: 'https://outlook.office.com/mail/inbox',
      tree: {
        children: Array.from({ length: 25 }, (_, i) => ({
          role: 'option',
          ref: `m${i}`,
          name: `Sender ${i}, Subject ${i}, 9:0${i % 10} AM, snippet ${i}`,
        })),
      },
    };

    const mgr = new OutlookBrowserManager(createMockClient(state));
    const result = await mgr.readInbox(3);

    expect(result.messages).toHaveLength(3);
  });

  it('returns needs_signin when the inbox snapshot bounces to login', async () => {
    const state = freshState();
    state.nextSnapshot = {
      url: 'https://login.microsoftonline.com/common/oauth2/authorize',
      tree: { children: [] },
    };
    const mgr = new OutlookBrowserManager(createMockClient(state));
    // Pre-set targetId so readInbox doesn't try to open() first.
    (mgr as unknown as { targetId: string }).targetId = 'tab-1';

    const result = await mgr.readInbox(5);

    expect(result.status).toBe('needs_signin');
    expect(result.messages).toHaveLength(0);
  });
});

describe('OutlookBrowserManager.draftEmail', () => {
  it('builds the click+fill payload and leaves the draft open', async () => {
    const state = freshState();
    const mgr = new OutlookBrowserManager(createMockClient(state));
    (mgr as unknown as { targetId: string }).targetId = 'tab-1';

    const result = await mgr.draftEmail({
      to: 'principal@school.example',
      subject: 'Daily report submitted',
      body: 'The Term 3 daily report has been filed.',
    });

    expect(result.status).toBe('drafted');
    expect(result.draftLeftOpen).toBe(true);
    expect(result.preview).toMatchObject({
      to: ['principal@school.example'],
      subject: 'Daily report submitted',
    });

    // Verify we clicked "New mail" and then filled To/Subject/Body.
    const clicks = state.acts.filter((a) => a.kind === 'click').map((a) => a.selector ?? '');
    expect(clicks.some((s) => s.includes('New mail'))).toBe(true);

    const fills = state.acts.filter((a) => a.kind === 'fill');
    const fillSelectors = fills
      .flatMap((a) => a.fields ?? [])
      .map((f) => f.selector ?? '');
    expect(fillSelectors.some((s) => s.includes('"To"'))).toBe(true);
    expect(fillSelectors.some((s) => s.includes('"Subject"'))).toBe(true);

    // No "Send" click — drafts must stay drafts.
    expect(clicks.some((s) => /"Send"/.test(s))).toBe(false);
  });

  it('handles array recipients and CC/BCC', async () => {
    const state = freshState();
    const mgr = new OutlookBrowserManager(createMockClient(state));
    (mgr as unknown as { targetId: string }).targetId = 'tab-1';

    const result = await mgr.draftEmail({
      to: ['a@school.example', 'b@school.example'],
      cc: 'district@school.example',
      bcc: ['archive@school.example'],
      subject: 'Suspension notice',
      body: 'Body text.',
    });

    expect(result.preview.to).toEqual(['a@school.example', 'b@school.example']);
    expect(result.preview.cc).toEqual(['district@school.example']);
    expect(result.preview.bcc).toEqual(['archive@school.example']);
  });

  it('throws when required fields are missing', async () => {
    const state = freshState();
    const mgr = new OutlookBrowserManager(createMockClient(state));
    (mgr as unknown as { targetId: string }).targetId = 'tab-1';

    await expect(
      mgr.draftEmail({ to: '', subject: 'x', body: 'y' } as unknown as {
        to: string;
        subject: string;
        body: string;
      }),
    ).rejects.toThrow(/recipient/);
    await expect(
      mgr.draftEmail({ to: 'a@b', subject: '', body: 'y' }),
    ).rejects.toThrow(/subject/);
  });
});

describe('OutlookBrowserManager.sendEmail', () => {
  it('refuses to send without confirm=true', async () => {
    const state = freshState();
    const mgr = new OutlookBrowserManager(createMockClient(state));
    (mgr as unknown as { targetId: string }).targetId = 'tab-1';

    const result = await mgr.sendEmail({
      to: 'a@school.example',
      subject: 's',
      body: 'b',
      confirm: false,
    });

    expect(result.status).toBe('refused');
    expect(result.reason).toMatch(/confirm/i);
    // Crucially, no Send click was issued.
    const clicks = state.acts.filter((a) => a.kind === 'click').map((a) => a.selector ?? '');
    expect(clicks.some((s) => /"Send"/.test(s))).toBe(false);
  });

  it('refuses when confirm is omitted entirely', async () => {
    const state = freshState();
    const mgr = new OutlookBrowserManager(createMockClient(state));
    (mgr as unknown as { targetId: string }).targetId = 'tab-1';

    const result = await mgr.sendEmail({
      to: 'a@school.example',
      subject: 's',
      body: 'b',
    } as unknown as {
      to: string;
      subject: string;
      body: string;
      confirm: boolean;
    });

    expect(result.status).toBe('refused');
  });

  it('sends only when confirm=true', async () => {
    const state = freshState();
    const mgr = new OutlookBrowserManager(createMockClient(state));
    (mgr as unknown as { targetId: string }).targetId = 'tab-1';

    const result = await mgr.sendEmail({
      to: 'a@school.example',
      subject: 's',
      body: 'b',
      confirm: true,
    });

    expect(result.status).toBe('sent');
    const clicks = state.acts.filter((a) => a.kind === 'click').map((a) => a.selector ?? '');
    expect(clicks.some((s) => /"Send"/.test(s))).toBe(true);
  });
});

describe('extractInboxMessages', () => {
  it('returns an empty array when the tree has no rows', () => {
    expect(extractInboxMessages({ children: [] })).toEqual([]);
    expect(extractInboxMessages(null)).toEqual([]);
    expect(extractInboxMessages(undefined)).toEqual([]);
  });

  it('skips rows whose accessible name is too short to parse', () => {
    const tree = {
      children: [
        { role: 'option', ref: 'a', name: 'Just one part' },
        { role: 'option', ref: 'b', name: 'Sender, Subject' },
        {
          role: 'option',
          ref: 'c',
          name: 'Sender, Subject, 9:00 AM, preview text',
        },
      ],
    };
    const out = extractInboxMessages(tree);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('c');
  });
});
