// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getStatus, graphCalls } from '../../electron/services/microsoft-graph/manager';
import {
  draftEmailWithGraph,
  isGraphOutlookAvailable,
  readEmailWithGraph,
  readInboxWithGraph,
  searchInboxWithGraph,
  sendEmailWithGraph,
} from '../../electron/services/microsoft-graph/outlook-adapter';

vi.mock('../../electron/services/microsoft-graph/manager', () => ({
  getStatus: vi.fn(),
  graphCalls: {
    listMessages: vi.fn(),
    getMessage: vi.fn(),
    createDraft: vi.fn(),
    sendMail: vi.fn(),
  },
}));

const mockStatus = vi.mocked(getStatus);
const mockGraphCalls = vi.mocked(graphCalls);

describe('Microsoft Graph Outlook adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStatus.mockResolvedValue({
      configured: true,
      signedIn: true,
      account: { accountId: 'user-1', email: 'principal@example.edu', tenantId: 'tenant-1' },
      expiresAt: Date.now() + 60_000,
      mockMailbox: false,
      effectiveMock: false,
    });
  });

  it('is available only when Graph is signed in or explicit mock mailbox is enabled', async () => {
    await expect(isGraphOutlookAvailable()).resolves.toBe(true);

    mockStatus.mockResolvedValueOnce({
      configured: true,
      signedIn: false,
      account: null,
      expiresAt: null,
      mockMailbox: true,
      effectiveMock: true,
    });
    await expect(isGraphOutlookAvailable()).resolves.toBe(true);

    mockStatus.mockResolvedValueOnce({
      configured: false,
      signedIn: false,
      account: null,
      expiresAt: null,
      mockMailbox: false,
      effectiveMock: true,
    });
    await expect(isGraphOutlookAvailable()).resolves.toBe(false);
  });

  it('maps Graph messages to the existing Outlook inbox result shape', async () => {
    mockGraphCalls.listMessages.mockResolvedValueOnce({
      value: [
        {
          id: 'AAMkAGI',
          subject: 'Suspension report',
          bodyPreview: 'Please submit today',
          receivedDateTime: '2026-06-06T12:00:00Z',
          isRead: false,
          from: { emailAddress: { name: 'District Office', address: 'district@example.edu' } },
        },
      ],
    });

    const result = await readInboxWithGraph(5);

    expect(result).toEqual({
      status: 'ok',
      messages: [
        {
          id: 'AAMkAGI',
          subject: 'Suspension report',
          sender: 'District Office <district@example.edu>',
          snippet: 'Please submit today',
          receivedAt: '2026-06-06T12:00:00Z',
          unread: true,
        },
      ],
      scan: {
        scope: 'graph_inbox',
        requestedTop: 5,
        scannedCount: 1,
        returnedCount: 1,
        exhaustive: true,
        note: 'Graph returned fewer messages than requested for this Inbox page.',
      },
    });
    expect(mockGraphCalls.listMessages).toHaveBeenCalledWith({ top: 5 });
  });

  it('filters Graph inbox rows for search requests', async () => {
    mockGraphCalls.listMessages.mockResolvedValueOnce({
      value: [
        {
          id: '1',
          subject: 'Daily attendance',
          bodyPreview: '',
          isRead: true,
          from: { emailAddress: { address: 'attendance@example.edu' } },
        },
        {
          id: '2',
          subject: 'Suspension report',
          bodyPreview: '',
          isRead: false,
          from: { emailAddress: { address: 'district@example.edu' } },
        },
      ],
    });

    const result = await searchInboxWithGraph({ subjectContains: 'suspension', unread: true });

    expect(result.messages.map((message) => message.id)).toEqual(['2']);
    expect(result).toMatchObject({
      capped: false,
      scan: {
        scope: 'graph_inbox',
        requestedTop: 25,
        fetchedTop: 25,
        scannedCount: 2,
        matchedCount: 1,
        returnedCount: 1,
        exhaustive: true,
      },
    });
  });

  it('marks Graph search as capped when the fetched page reaches the limit', async () => {
    mockGraphCalls.listMessages.mockResolvedValueOnce({
      value: Array.from({ length: 25 }, (_, i) => ({
        id: `message-${i}`,
        subject: i === 2 ? 'June workshop' : 'Routine circular',
        bodyPreview: '',
        isRead: true,
        receivedDateTime: i === 2 ? '2026-06-06T12:00:00Z' : '2026-05-20T12:00:00Z',
        from: { emailAddress: { address: 'district@example.edu' } },
      })),
    });

    const result = await searchInboxWithGraph({
      dateGte: '2026-06-01T00:00:00.000Z',
      dateLt: '2026-07-01T00:00:00.000Z',
      top: 25,
    });

    expect(result.messages.map((message) => message.id)).toEqual(['message-2']);
    expect(result.capped).toBe(true);
    expect(result.scan).toMatchObject({
      scope: 'graph_inbox',
      requestedTop: 25,
      fetchedTop: 25,
      scannedCount: 25,
      matchedCount: 1,
      returnedCount: 1,
      exhaustive: false,
    });
  });

  it('reads Graph email bodies as text and preserves recipients', async () => {
    mockGraphCalls.getMessage.mockResolvedValueOnce({
      id: '2',
      subject: 'Suspension report',
      receivedDateTime: '2026-06-06T12:00:00Z',
      from: { emailAddress: { address: 'district@example.edu' } },
      toRecipients: [{ emailAddress: { address: 'principal@example.edu' } }],
      ccRecipients: [{ emailAddress: { address: 'supervisor@example.edu' } }],
      body: { contentType: 'html', content: '<p>Hello&nbsp;Principal<br/>Please submit.</p>' },
    });

    const result = await readEmailWithGraph({ id: '2' });

    expect(result).toMatchObject({
      status: 'ok',
      id: '2',
      subject: 'Suspension report',
      body: 'Hello Principal\nPlease submit.',
      recipients: {
        to: ['principal@example.edu'],
        cc: ['supervisor@example.edu'],
        bcc: [],
      },
    });
  });

  it('creates a Graph draft without claiming a browser compose pane is open', async () => {
    mockGraphCalls.createDraft.mockResolvedValueOnce({ id: 'draft-1' });

    const result = await draftEmailWithGraph({
      to: 'teacher@example.edu',
      subject: 'Draft',
      body: 'Body',
    });

    expect(result.status).toBe('drafted');
    expect(result.draftLeftOpen).toBe(false);
    expect(result.preview.to).toEqual(['teacher@example.edu']);
    expect(mockGraphCalls.createDraft).toHaveBeenCalledWith({
      to: 'teacher@example.edu',
      subject: 'Draft',
      body: 'Body',
      cc: undefined,
      bcc: undefined,
    });
  });

  it('preserves the send confirmation gate for Graph sends', async () => {
    await expect(sendEmailWithGraph({
      to: 'teacher@example.edu',
      subject: 'Send',
      body: 'Body',
      confirm: false,
    })).resolves.toEqual({
      status: 'refused',
      reason: 'confirm flag required before sending through Microsoft Graph',
    });
    expect(mockGraphCalls.sendMail).not.toHaveBeenCalled();

    mockGraphCalls.sendMail.mockResolvedValueOnce({ ok: true });
    await expect(sendEmailWithGraph({
      to: 'teacher@example.edu',
      subject: 'Send',
      body: 'Body',
      confirm: true,
    })).resolves.toEqual({ status: 'sent', message: 'Sent through Microsoft Graph' });
  });
});
