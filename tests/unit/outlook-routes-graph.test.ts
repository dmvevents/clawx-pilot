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
import { getMicrosoftGraphConfig } from '../../electron/services/microsoft-graph/store';
import { getStatus } from '../../electron/services/microsoft-graph/manager';
import { outlookBrowserManagerV2 } from '../../electron/services/outlook-browser-v2/manager';

vi.mock('../../electron/api/route-utils', () => ({
  parseJsonBody: vi.fn(),
  sendJson: vi.fn(),
}));

vi.mock('../../electron/services/microsoft-graph/outlook-adapter', () => ({
  draftEmailWithGraph: vi.fn(),
  isGraphOutlookAvailable: vi.fn(),
  // Real prefix logic: the route's graph-id refusal is behavior under test,
  // not a collaborator to be stubbed out.
  isGraphMessageId: (id: unknown) => typeof id === 'string' && id.startsWith('graph:'),
  readEmailWithGraph: vi.fn(),
  readInboxWithGraph: vi.fn(),
  searchInboxWithGraph: vi.fn(),
  sendEmailWithGraph: vi.fn(),
}));

vi.mock('../../electron/services/microsoft-graph/store', () => ({
  getMicrosoftGraphConfig: vi.fn(),
}));

vi.mock('../../electron/services/microsoft-graph/manager', () => ({
  getStatus: vi.fn(),
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
const graphConfigMock = vi.mocked(getMicrosoftGraphConfig);
const graphStatusMock = vi.mocked(getStatus);
const browserManagerMock = vi.mocked(outlookBrowserManagerV2);

// Builders (not inline literals) so the objects stay structurally assignable
// while contracts C1 (grantedScopes) / C2 (graphOutlook* flags) land in the
// service files in parallel.
function graphStatus(grantedScopes: string[]) {
  return {
    configured: true,
    signedIn: true,
    account: {
      accountId: 'acct-1',
      email: 'principal@example.edu',
      tenantId: '00000000-0000-0000-0000-000000000001',
    },
    expiresAt: null,
    mockMailbox: false,
    effectiveMock: false,
    grantedScopes,
  };
}

function graphConfig(flags: { graphOutlookRead?: boolean; graphOutlookCompose?: boolean }) {
  return {
    tenantId: 'moe.gov.tt',
    clientId: '00000000-0000-0000-0000-000000000001',
    ...flags,
  };
}

describe('Outlook Host API Graph routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CLAWX_GRAPH_OUTLOOK_READ;
    delete process.env.CLAWX_GRAPH_OUTLOOK_COMPOSE;
    // Defaults: no persisted transport flags; a signed-in account whose grant
    // includes Mail.Send so compose tests exercise the transport, not the gate.
    graphConfigMock.mockResolvedValue(null);
    graphStatusMock.mockResolvedValue(
      graphStatus(['offline_access', 'User.Read', 'Mail.Read', 'Mail.Send']),
    );
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

  it('uses Microsoft Graph for read-inbox when the persisted config flag enables it', async () => {
    graphConfigMock.mockResolvedValue(graphConfig({ graphOutlookRead: true }));
    graphAvailableMock.mockResolvedValueOnce(true);
    parseBodyMock.mockResolvedValueOnce({ top: 4 });
    graphReadInboxMock.mockResolvedValueOnce({
      status: 'ok',
      messages: [{ id: 'g2', subject: 'Graph', sender: 'IT', snippet: '', receivedAt: '', unread: false }],
    });

    const { handleOutlookRoutes } = await import('../../electron/api/routes/outlook');
    const handled = await handleOutlookRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/outlook/read-inbox'),
    );

    expect(handled).toBe(true);
    expect(graphReadInboxMock).toHaveBeenCalledWith(4);
    expect(browserManagerMock.readInbox).not.toHaveBeenCalled();
  });

  it('falls back to browser Outlook when the config flag is on but Graph is unavailable', async () => {
    graphConfigMock.mockResolvedValue(graphConfig({ graphOutlookRead: true }));
    graphAvailableMock.mockResolvedValueOnce(false);
    parseBodyMock.mockResolvedValueOnce({ top: 2 });
    browserManagerMock.readInbox.mockResolvedValueOnce({
      status: 'ok',
      messages: [{ id: 'b2', subject: 'Browser', sender: 'IT', snippet: '', receivedAt: '', unread: false }],
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

  it('uses Graph compose when the persisted config flag enables it and Mail.Send is granted', async () => {
    graphConfigMock.mockResolvedValue(graphConfig({ graphOutlookCompose: true }));
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

  it('refuses Graph send with a structured reason when Mail.Send is not granted', async () => {
    process.env.CLAWX_GRAPH_OUTLOOK_COMPOSE = '1';
    graphAvailableMock.mockResolvedValueOnce(true);
    graphStatusMock.mockResolvedValue(graphStatus(['offline_access', 'User.Read', 'Mail.Read']));
    parseBodyMock.mockResolvedValueOnce({
      to: 'teacher@example.edu',
      subject: 'Confirm',
      body: 'Body',
      confirm: true,
    });

    const { handleOutlookRoutes } = await import('../../electron/api/routes/outlook');
    const handled = await handleOutlookRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/outlook/send'),
    );

    expect(handled).toBe(true);
    // Refuse loudly: no Graph call, no silent browser fallback, no 500.
    expect(graphSendEmailMock).not.toHaveBeenCalled();
    expect(browserManagerMock.sendEmail).not.toHaveBeenCalled();
    expect(sendJsonMock).toHaveBeenCalledWith(expect.anything(), 200, {
      success: true,
      data: expect.objectContaining({
        status: 'refused',
        reason: expect.stringContaining('Mail.Send'),
      }),
    });
  });

  it('routes Graph draft with Mail.ReadWrite when Mail.Send is not granted', async () => {
    graphConfigMock.mockResolvedValue(graphConfig({ graphOutlookCompose: true }));
    graphAvailableMock.mockResolvedValueOnce(true);
    graphStatusMock.mockResolvedValue(graphStatus(['offline_access', 'User.Read', 'Mail.ReadWrite']));
    parseBodyMock.mockResolvedValueOnce({
      to: 'teacher@example.edu',
      subject: 'Read-only tenant',
      body: 'Body',
    });
    graphDraftEmailMock.mockResolvedValueOnce({
      status: 'drafted',
      draftLeftOpen: false,
      preview: { to: ['teacher@example.edu'], cc: [], bcc: [], subject: 'Read-only tenant', body: 'Body' },
    });

    const { handleOutlookRoutes } = await import('../../electron/api/routes/outlook');
    const handled = await handleOutlookRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/outlook/draft'),
    );

    expect(handled).toBe(true);
    expect(graphDraftEmailMock).toHaveBeenCalledWith(expect.objectContaining({ subject: 'Read-only tenant' }));
    expect(browserManagerMock.draftEmail).not.toHaveBeenCalled();
    expect(sendJsonMock).toHaveBeenCalledWith(expect.anything(), 200, {
      success: true,
      data: expect.objectContaining({
        status: 'drafted',
      }),
    });
  });

  it('accepts a resource-qualified Mail.Send grant for Graph compose', async () => {
    process.env.CLAWX_GRAPH_OUTLOOK_COMPOSE = '1';
    graphAvailableMock.mockResolvedValueOnce(true);
    // Entra sometimes returns URL-form grants; the gate must not mis-read
    // them as a read-only tenant.
    graphStatusMock.mockResolvedValue(
      graphStatus(['offline_access', 'https://graph.microsoft.com/Mail.Send']),
    );
    graphSendEmailMock.mockResolvedValueOnce({ status: 'ok' } as never);
    parseBodyMock.mockResolvedValueOnce({
      to: 'teacher@example.edu',
      subject: 'Qualified grant',
      body: 'Body',
      confirm: true,
    });

    const { handleOutlookRoutes } = await import('../../electron/api/routes/outlook');
    const handled = await handleOutlookRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/outlook/send'),
    );

    expect(handled).toBe(true);
    expect(graphSendEmailMock).toHaveBeenCalled();
  });

  it('lets the explicit mock mailbox exercise Graph compose without a Mail.Send grant', async () => {
    process.env.CLAWX_GRAPH_OUTLOOK_COMPOSE = '1';
    graphAvailableMock.mockResolvedValueOnce(true);
    graphStatusMock.mockResolvedValue({
      ...graphStatus([]),
      signedIn: false,
      account: null,
      mockMailbox: true,
      effectiveMock: true,
    });
    graphDraftEmailMock.mockResolvedValueOnce({ status: 'ok' } as never);
    parseBodyMock.mockResolvedValueOnce({
      to: 'teacher@example.edu',
      subject: 'Demo mock',
      body: 'Body',
    });

    const { handleOutlookRoutes } = await import('../../electron/api/routes/outlook');
    const handled = await handleOutlookRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/outlook/draft'),
    );

    expect(handled).toBe(true);
    // The adapter's mock layer handles the compose; no scope refusal fires.
    expect(graphDraftEmailMock).toHaveBeenCalled();
    expect(sendJsonMock).toHaveBeenCalledWith(expect.anything(), 200, {
      success: true,
      data: expect.objectContaining({ status: 'ok' }),
    });
  });

  const graphIdRefusalCases: Array<{ route: string; body: Record<string, unknown>; manager: keyof typeof browserManagerMock }> = [
    { route: 'reply', body: { id: 'graph:AAMk-test', body: 'Thanks' }, manager: 'reply' },
    { route: 'forward', body: { id: 'graph:AAMk-test', to: 'teacher@example.edu' }, manager: 'forward' },
    { route: 'mark-read', body: { id: 'graph:AAMk-test', read: true }, manager: 'markRead' },
    { route: 'list-attachments', body: { id: 'graph:AAMk-test' }, manager: 'listAttachments' },
    {
      route: 'download-attachment',
      body: { id: 'graph:AAMk-test', filename: 'report.pdf', confirm: true },
      manager: 'downloadAttachment',
    },
  ];

  for (const { route, body, manager } of graphIdRefusalCases) {
    it(`refuses ${route} for a graph:-prefixed message id instead of hunting the DOM`, async () => {
      parseBodyMock.mockResolvedValueOnce(body);

      const { handleOutlookRoutes } = await import('../../electron/api/routes/outlook');
      const handled = await handleOutlookRoutes(
        { method: 'POST' } as IncomingMessage,
        {} as ServerResponse,
        new URL(`http://127.0.0.1:13210/api/outlook/${route}`),
      );

      expect(handled).toBe(true);
      expect(browserManagerMock[manager]).not.toHaveBeenCalled();
      expect(sendJsonMock).toHaveBeenCalledWith(expect.anything(), 200, {
        success: true,
        data: expect.objectContaining({
          status: 'refused',
          reason: expect.stringContaining('Microsoft cloud'),
        }),
      });
    });
  }

  it('still routes browser-lane ids through the browser manager for reply', async () => {
    parseBodyMock.mockResolvedValueOnce({ id: 'sender|subject|Tue 9:42 AM', body: 'Thanks' });
    browserManagerMock.reply.mockResolvedValueOnce({ status: 'ok' } as never);

    const { handleOutlookRoutes } = await import('../../electron/api/routes/outlook');
    const handled = await handleOutlookRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/outlook/reply'),
    );

    expect(handled).toBe(true);
    expect(browserManagerMock.reply).toHaveBeenCalled();
  });
});
