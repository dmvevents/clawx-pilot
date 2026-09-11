// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { OutlookActions } from '@electron/services/outlook-browser-v2/outlook-actions';

type TestActions = OutlookActions & {
  looksLikeSignin: () => Promise<boolean>;
  ensureInboxFolder: (page: unknown) => Promise<void>;
  readInbox: (top?: number) => Promise<{
    status: 'ok' | 'needs_signin';
    messages: Array<{ id: string; subject: string; sender: string; receivedAt: string; hasDraft?: boolean; pseudoCompose?: boolean }>;
    scan?: { artifactSkippedCount: number; returnedCount: number };
  }>;
};

// CLWX-143 fixtures in the shape extractVisibleInboxRows now returns (already parsed).
const CONVERSATION_WITH_SAVED_DRAFT = {
  id: 'Corporate Communications|Media Release: Increased Student Attendance on the First Day of New Academic Ye|Tue 2:15 PM',
  sender: 'Corporate Communications',
  subject: 'Media Release: Increased Student Attendance on the First Day of New Academic Year 2026/2027',
  snippet: 'Dear Team MOE',
  received: 'Tue 2:15 PM',
  unread: false,
  hasDraft: true,
  pseudoCompose: false,
};
const PLAIN_OLDER_ROW = {
  id: 'Corporate Communications|Media Release: All 777 Schools Open for the Start of the 2026/2027 Academic Year|Mon 7 Sep',
  sender: 'Corporate Communications',
  subject: 'Media Release: All 777 Schools Open for the Start of the 2026/2027 Academic Year',
  snippet: 'Dear Team MOE',
  received: 'Mon 7 Sep',
  unread: true,
  hasDraft: false,
  pseudoCompose: false,
};

function createActions(rows: unknown[]) {
  const page = {
    url: () => 'https://outlook.office.com/mail/inbox',
    waitForSelector: vi.fn(async () => undefined),
    evaluate: vi.fn(async (script: string) => {
      if (script.includes('const limit =')) return rows;
      return ''; // fingerprint / __name probes
    }),
  };
  const driver = { ensureOutlookTab: vi.fn(async () => page) };
  const actions = new OutlookActions(driver as never, { ground: vi.fn() } as never) as unknown as TestActions;
  actions.looksLikeSignin = vi.fn(async () => false);
  actions.ensureInboxFolder = vi.fn(async () => undefined);
  return actions;
}

describe('readInbox and inbox rows that carry a saved draft (CLWX-143)', () => {
  it('returns the newest conversation even though its row is [Draft]-marked, flagged hasDraft, ahead of older plain rows', async () => {
    const actions = createActions([CONVERSATION_WITH_SAVED_DRAFT, PLAIN_OLDER_ROW]);
    const result = await actions.readInbox(2);
    expect(result.messages.map((m) => m.subject.slice(0, 40))).toEqual([
      'Media Release: Increased Student Attenda',
      'Media Release: All 777 Schools Open for ',
    ]);
    expect(result.messages[0].hasDraft).toBe(true);
    expect(result.messages[1].hasDraft).toBe(false);
    expect(result.scan?.artifactSkippedCount).toBe(0);
  });

  it('keeps the real message row when an open-compose pseudo row shadows it with the same id', async () => {
    const pseudo = { ...PLAIN_OLDER_ROW, snippet: '', hasDraft: true };
    const actions = createActions([pseudo, PLAIN_OLDER_ROW]);
    const result = await actions.readInbox(1);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({ id: PLAIN_OLDER_ROW.id, hasDraft: false });
    expect(result.scan?.returnedCount).toBe(1);
  });

  it('still drops rows whose sender or subject is nothing but the marker or is missing', async () => {
    const actions = createActions([
      { id: '[Draft]||', sender: '[Draft]', subject: '', snippet: '', received: '', unread: false, hasDraft: true, pseudoCompose: false },
      { id: 'x|[Draft]|', sender: 'Someone', subject: '[Draft]', snippet: '', received: '', unread: false, hasDraft: true, pseudoCompose: false },
      PLAIN_OLDER_ROW,
    ]);
    const result = await actions.readInbox(3);
    expect(result.messages).toHaveLength(1);
    expect(result.scan?.artifactSkippedCount).toBe(2);
  });

  /** Review lane A M1 (second pass): a flagged open-compose pseudo row is never a message. */
  it('drops a row the parser flagged as an open-compose pseudo row', async () => {
    const pseudo = {
      id: 'Karunesh Ramdass Meeting|Sure, how about 3pm|Mon 10:08 PM',
      sender: 'Karunesh Ramdass Meeting',
      subject: 'Sure, how about 3pm',
      snippet: '',
      received: 'Mon 10:08 PM',
      unread: false,
      hasDraft: true,
      pseudoCompose: true,
    };
    const actions = createActions([pseudo, PLAIN_OLDER_ROW]);
    const result = await actions.readInbox(2);
    expect(result.messages.map((m) => m.id)).toEqual([PLAIN_OLDER_ROW.id]);
    expect(result.scan?.artifactSkippedCount).toBe(1);
  });
});
