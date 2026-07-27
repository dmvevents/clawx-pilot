// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { parseJsonBody, sendJson } from '../../electron/api/route-utils';
import {
  draftEmailWithGraph,
  isGraphOutlookAvailable,
  readInboxWithGraph,
  sendEmailWithGraph,
} from '../../electron/services/microsoft-graph/outlook-adapter';
import { outlookBrowserManagerV2 } from '../../electron/services/outlook-browser-v2/manager';

vi.mock('../../electron/api/route-utils', () => ({
  parseJsonBody: vi.fn(),
  sendJson: vi.fn(),
}));

vi.mock('../../electron/services/microsoft-graph/outlook-adapter', () => ({
  draftEmailWithGraph: vi.fn(),
  isGraphOutlookAvailable: vi.fn(),
  readEmailWithGraph: vi.fn(),
  readInboxWithGraph: vi.fn(),
  searchInboxWithGraph: vi.fn(),
  sendEmailWithGraph: vi.fn(),
}));

vi.mock('../../electron/services/outlook-browser/manager', () => ({
  outlookBrowserManager: {
    readInbox: vi.fn(),
    sendEmail: vi.fn(),
  },
}));

vi.mock('../../electron/services/outlook-browser-v2/manager', () => ({
  outlookBrowserManagerV2: {
    open: vi.fn(),
    readInbox: vi.fn(),
    draftEmail: vi.fn(),
    sendEmail: vi.fn(),
    searchInbox: vi.fn(),
    readEmail: vi.fn(),
    reply: vi.fn(),
    forward: vi.fn(),
    markRead: vi.fn(),
    listAttachments: vi.fn(),
    downloadAttachment: vi.fn(),
  },
}));

const parseBodyMock = vi.mocked(parseJsonBody);
const sendJsonMock = vi.mocked(sendJson);
const graphDraftEmailMock = vi.mocked(draftEmailWithGraph);
const graphAvailableMock = vi.mocked(isGraphOutlookAvailable);
const graphReadInboxMock = vi.mocked(readInboxWithGraph);
const graphSendEmailMock = vi.mocked(sendEmailWithGraph);
const browserManagerMock = vi.mocked(outlookBrowserManagerV2);

describe('Outlook Host API Graph routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CLAWX_GRAPH_OUTLOOK_READ;
    delete process.env.CLAWX_GRAPH_OUTLOOK_COMPOSE;
  });

  it('uses browser Outlook for read-inbox by default to keep DOM ids compatible with reply', async () => {
    parseBodyMock.mockResolvedValueOnce({ top: 3 });
    browserManagerMock.readInbox.mockResolvedValueOnce({
      status: 'ok',
      messages: [{ id: 'b1', subject: 'Browser', sender: 'IT', snippet: '', receivedAt: '', unread: false }],
    });

    const { handleOutlookRoutes } = await import('../../electron/api/routes/outlook');
    const handled = await handleOutlookRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/outlook/read-inbox'),
    );

    expect(handled).toBe(true);
    expect(browserManagerMock.readInbox).toHaveBeenCalledWith(3);
    expect(graphReadInboxMock).not.toHaveBeenCalled();
    expect(graphAvailableMock).not.toHaveBeenCalled();
    expect(sendJsonMock).toHaveBeenCalledWith(expect.anything(), 200, {
      success: true,
      data: expect.objectContaining({ status: 'ok' }),
    });
  });

  it('uses Microsoft Graph for read-inbox only when Graph read is explicitly enabled', async () => {
    process.env.CLAWX_GRAPH_OUTLOOK_READ = '1';
    graphAvailableMock.mockResolvedValueOnce(true);
    parseBodyMock.mockResolvedValueOnce({ top: 3 });
    graphReadInboxMock.mockResolvedValueOnce({
      status: 'ok',
      messages: [{ id: 'g1', subject: 'Graph', sender: 'IT', snippet: '', receivedAt: '', unread: false }],
    });

    const { handleOutlookRoutes } = await import('../../electron/api/routes/outlook');
    const handled = await handleOutlookRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/outlook/read-inbox'),
    );

    expect(handled).toBe(true);
    expect(graphReadInboxMock).toHaveBeenCalledWith(3);
    expect(browserManagerMock.readInbox).not.toHaveBeenCalled();
  });

  it('falls back to browser Outlook when explicit Graph read is unavailable', async () => {
    process.env.CLAWX_GRAPH_OUTLOOK_READ = '1';
    graphAvailableMock.mockResolvedValueOnce(false);
    parseBodyMock.mockResolvedValueOnce({ top: 2 });
    browserManagerMock.readInbox.mockResolvedValueOnce({
      status: 'ok',
      messages: [{ id: 'b1', subject: 'Browser', sender: 'IT', snippet: '', receivedAt: '', unread: false }],
    });

    const { handleOutlookRoutes } = await import('../../electron/api/routes/outlook');
    const handled = await handleOutlookRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/outlook/read-inbox'),
    );

    expect(handled).toBe(true);
    expect(browserManagerMock.readInbox).toHaveBeenCalledWith(2);
    expect(graphReadInboxMock).not.toHaveBeenCalled();
  });

  it('uses browser Outlook for draft when Graph is available by default', async () => {
    parseBodyMock.mockResolvedValueOnce({
      to: 'teacher@example.edu',
      subject: 'Visible draft',
      body: 'Body',
    });
    browserManagerMock.draftEmail.mockResolvedValueOnce({
      status: 'drafted',
      draftLeftOpen: true,
      preview: { to: ['teacher@example.edu'], cc: [], bcc: [], subject: 'Visible draft', body: 'Body' },
    });

    const { handleOutlookRoutes } = await import('../../electron/api/routes/outlook');
    const handled = await handleOutlookRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/outlook/draft'),
    );

    expect(handled).toBe(true);
    expect(browserManagerMock.draftEmail).toHaveBeenCalledWith(expect.objectContaining({ subject: 'Visible draft' }));
    expect(graphDraftEmailMock).not.toHaveBeenCalled();
    expect(graphAvailableMock).not.toHaveBeenCalled();
  });

  it('uses browser Outlook for send when Graph is available by default', async () => {
    parseBodyMock.mockResolvedValueOnce({
      to: 'teacher@example.edu',
      subject: 'Confirm',
      body: 'Body',
      confirm: false,
    });
    browserManagerMock.sendEmail.mockResolvedValueOnce({
      status: 'refused',
      reason: 'confirm flag not set',
    });

    const { handleOutlookRoutes } = await import('../../electron/api/routes/outlook');
    const handled = await handleOutlookRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/outlook/send'),
    );

    expect(handled).toBe(true);
    expect(browserManagerMock.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ confirm: false }));
    expect(graphSendEmailMock).not.toHaveBeenCalled();
    expect(graphAvailableMock).not.toHaveBeenCalled();
  });

  it('routes replies through browser Outlook so DOM message ids remain valid', async () => {
    const body = { id: 'sender|subject|today', body: 'OK' };
    parseBodyMock.mockResolvedValueOnce(body);
    browserManagerMock.reply.mockResolvedValueOnce({
      status: 'drafted',
      draftLeftOpen: true,
      message: 'Reply draft prepared',
      preview: { to: ['sender'], subject: 'Re: subject', body: 'OK' },
    });

    const { handleOutlookRoutes } = await import('../../electron/api/routes/outlook');
    const handled = await handleOutlookRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/outlook/reply'),
    );

    expect(handled).toBe(true);
    expect(browserManagerMock.reply).toHaveBeenCalledWith(body);
    expect(graphAvailableMock).not.toHaveBeenCalled();
    expect(sendJsonMock).toHaveBeenCalledWith(expect.anything(), 200, {
      success: true,
      data: expect.objectContaining({ status: 'drafted' }),
    });
  });

  it('preserves replyAll on browser Outlook reply routing', async () => {
    const body = { id: 'sender|subject|today', body: 'Reply all body', replyAll: true };
    parseBodyMock.mockResolvedValueOnce(body);
    browserManagerMock.reply.mockResolvedValueOnce({
      status: 'drafted',
      draftLeftOpen: true,
      message: 'Reply all draft prepared',
      preview: { to: ['sender'], subject: 'Re: subject', body: 'Reply all body' },
    });

    const { handleOutlookRoutes } = await import('../../electron/api/routes/outlook');
    const handled = await handleOutlookRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/outlook/reply'),
    );

    expect(handled).toBe(true);
    expect(browserManagerMock.reply).toHaveBeenCalledWith(expect.objectContaining({ replyAll: true }));
    expect(graphAvailableMock).not.toHaveBeenCalled();
  });

  it('routes forwards through browser Outlook instead of Graph compose routing', async () => {
    const body = {
      id: 'sender|subject|today',
      to: 'recipient@example.invalid',
      body: 'Forward body',
    };
    parseBodyMock.mockResolvedValueOnce(body);
    browserManagerMock.forward.mockResolvedValueOnce({
      status: 'drafted',
      draftLeftOpen: true,
      message: 'Forward draft prepared',
      preview: { to: ['recipient@example.invalid'], subject: 'Fw: subject', body: 'Forward body' },
    });

    const { handleOutlookRoutes } = await import('../../electron/api/routes/outlook');
    const handled = await handleOutlookRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/outlook/forward'),
    );

    expect(handled).toBe(true);
    expect(browserManagerMock.forward).toHaveBeenCalledWith(body);
    expect(graphAvailableMock).not.toHaveBeenCalled();
    expect(sendJsonMock).toHaveBeenCalledWith(expect.anything(), 200, {
      success: true,
      data: expect.objectContaining({ status: 'drafted' }),
    });
  });

  it('routes Graph sends through the same confirm-gated adapter only when compose Graph is explicitly enabled', async () => {
    process.env.CLAWX_GRAPH_OUTLOOK_COMPOSE = '1';
    graphAvailableMock.mockResolvedValueOnce(true);
    parseBodyMock.mockResolvedValueOnce({
      to: 'teacher@example.edu',
      subject: 'Confirm',
      body: 'Body',
      confirm: false,
    });
    graphSendEmailMock.mockResolvedValueOnce({
      status: 'refused',
      reason: 'confirm flag required before sending through Microsoft Graph',
    });

    const { handleOutlookRoutes } = await import('../../electron/api/routes/outlook');
    const handled = await handleOutlookRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/outlook/send'),
    );

    expect(handled).toBe(true);
    expect(graphSendEmailMock).toHaveBeenCalledWith(expect.objectContaining({ confirm: false }));
    expect(browserManagerMock.sendEmail).not.toHaveBeenCalled();
  });
});
