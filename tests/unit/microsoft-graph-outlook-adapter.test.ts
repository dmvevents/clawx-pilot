// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getStatus, graphCalls } from '../../electron/services/microsoft-graph/manager';
import {
  draftEmailWithGraph,
  isGraphMessageId,
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
    listAttachments: vi.fn(),
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
      grantedScopes: ['offline_access', 'User.Read', 'Mail.Read'],
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
      grantedScopes: [],
      mockMailbox: true,
      effectiveMock: true,
    });
    await expect(isGraphOutlookAvailable()).resolves.toBe(true);

    mockStatus.mockResolvedValueOnce({
      configured: false,
      signedIn: false,
      account: null,
      expiresAt: null,
      grantedScopes: [],
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
          hasAttachments: true,
          from: { emailAddress: { name: 'District Office', address: 'district@example.edu' } },
        },
      ],
    });

    const result = await readInboxWithGraph(5);

    expect(result).toEqual({
      status: 'ok',
      messages: [
        {
          id: 'graph:AAMkAGI',
          graphId: 'AAMkAGI',
          subject: 'Suspension report',
          sender: 'District Office <district@example.edu>',
          snippet: 'Please submit today',
          receivedAt: '2026-06-06T12:00:00Z',
          unread: true,
          hasAttachments: true,
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

  it('emits graph-prefixed ids so browser-lane ops can detect and refuse them', async () => {
    mockGraphCalls.listMessages.mockResolvedValueOnce({
      value: [
        {
          id: 'AAMkAGI',
          subject: 'Suspension report',
          bodyPreview: '',
          isRead: false,
          from: { emailAddress: { address: 'district@example.edu' } },
        },
      ],
    });

    const result = await readInboxWithGraph(1);

    // The browser lane's sender|subject|renderedDate fingerprint cannot be
    // rebuilt from Graph fields, so the id is marked instead of imitated.
    expect(isGraphMessageId(result.messages[0].id)).toBe(true);
    expect(isGraphMessageId('District Office|Suspension report|Tue')).toBe(false);
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

    expect(result.messages.map((message) => message.id)).toEqual(['graph:2']);
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

    expect(result.messages.map((message) => message.id)).toEqual(['graph:message-2']);
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

    const result = await readEmailWithGraph({ id: 'graph:2' });

    // The graph: prefix is stripped before the REST call and re-applied on
    // the way out so follow-up Graph reads round-trip cleanly.
    expect(mockGraphCalls.getMessage).toHaveBeenCalledWith('2');
    expect(result).toMatchObject({
      status: 'ok',
      id: 'graph:2',
      graphId: '2',
      subject: 'Suspension report',
      body: 'Hello Principal\nPlease submit.',
      recipients: {
        to: ['principal@example.edu'],
        cc: ['supervisor@example.edu'],
        bcc: [],
      },
      attachments: [],
    });
    expect(mockGraphCalls.listAttachments).not.toHaveBeenCalled();
  });

  it('fetches attachment metadata when the Graph message has attachments', async () => {
    mockGraphCalls.getMessage.mockResolvedValueOnce({
      id: '3',
      subject: 'Suspension report with form',
      hasAttachments: true,
      from: { emailAddress: { address: 'district@example.edu' } },
      body: { contentType: 'html', content: '<p>See attached.</p>' },
    });
    mockGraphCalls.listAttachments.mockResolvedValueOnce({
      value: [
        { name: 'suspension-form.pdf', size: 34567, contentType: 'application/pdf' },
        { name: 'photo.png', contentType: 'image/png' },
      ],
    });

    const result = await readEmailWithGraph({ id: 'graph:3' });

    expect(mockGraphCalls.listAttachments).toHaveBeenCalledWith('3');
    expect(result).toMatchObject({
      status: 'ok',
      attachments: [
        { filename: 'suspension-form.pdf', sizeBytes: 34567, mimeType: 'application/pdf' },
        { filename: 'photo.png', sizeBytes: undefined, mimeType: 'image/png' },
      ],
    });
  });

  it('filters Graph search rows by hasAttachment', async () => {
    mockGraphCalls.listMessages.mockResolvedValueOnce({
      value: [
        {
          id: '1',
          subject: 'No attachment',
          bodyPreview: '',
          isRead: true,
          hasAttachments: false,
          from: { emailAddress: { address: 'district@example.edu' } },
        },
        {
          id: '2',
          subject: 'With attachment',
          bodyPreview: '',
          isRead: true,
          hasAttachments: true,
          from: { emailAddress: { address: 'district@example.edu' } },
        },
      ],
    });

    const result = await searchInboxWithGraph({ hasAttachment: true });

    expect(result.messages.map((message) => message.id)).toEqual(['graph:2']);
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

  it('maps a Graph 403 on draft to a structured refusal instead of throwing', async () => {
    mockGraphCalls.createDraft.mockRejectedValueOnce(
      Object.assign(new Error('Access is denied.'), { status: 403, code: 'ErrorAccessDenied' }),
    );

    const result = await draftEmailWithGraph({
      to: 'teacher@example.edu',
      subject: 'Draft',
      body: 'Body',
    });

    expect(result).toMatchObject({ status: 'refused' });
    expect((result as { reason?: string }).reason).toContain('Mail.ReadWrite');
    expect((result as { reason?: string }).reason).not.toContain('Mail.Send');
  });

  it('maps a Graph 403 on send to a structured refusal instead of throwing', async () => {
    mockGraphCalls.sendMail.mockRejectedValueOnce(
      Object.assign(new Error('Access is denied.'), { status: 403, code: 'ErrorAccessDenied' }),
    );

    const result = await sendEmailWithGraph({
      to: 'teacher@example.edu',
      subject: 'Send',
      body: 'Body',
      confirm: true,
    });

    expect(result).toMatchObject({ status: 'refused' });
    expect(result.reason).toContain('Mail.Send');
    expect(result.reason).not.toContain('Mail.ReadWrite');
  });

  it('rethrows non-403 Graph write failures', async () => {
    mockGraphCalls.sendMail.mockRejectedValueOnce(
      Object.assign(new Error('Service unavailable'), { status: 503 }),
    );

    await expect(sendEmailWithGraph({
      to: 'teacher@example.edu',
      subject: 'Send',
      body: 'Body',
      confirm: true,
    })).rejects.toThrow('Service unavailable');
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
