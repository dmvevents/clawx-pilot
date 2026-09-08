// @vitest-environment node
/**
 * Owner RDP feedback 2026-09-08 (artifacts/ga-fable-20260908/graph-feedback):
 * asked "is the microsoft graph api installed", the agent probed a fictional
 * config path, reported "outlook config path does not exist" and treated that
 * as evidence about Microsoft Graph. Root cause: the plugin exposed NO
 * read-only readiness diagnosis — the only Outlook entry that reveals any
 * state is outlook.open, which navigates the principal's browser.
 *
 * Contract under test:
 *  A. Main owns the truth: POST /api/outlook/readiness reports the typed
 *     Graph state (signed_in / not_signed_in / not_configured / unknown),
 *     per-lane transport intent + actual selection (the SAME selection code
 *     real reads/composes use), Mail.Send grant, and an honest
 *     browser.state='unknown' — all WITHOUT opening a browser, navigating,
 *     or calling any Graph mailbox API.
 *  B. The plugin registers a read-only outlook.readiness tool over that
 *     route, parks readably on version-skewed installs, and disappears with
 *     the rest of the outlook family when host-API creds are absent.
 *
 * All fixture values are synthetic; no real addresses or tenant identifiers.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { parseJsonBody, sendJson } from '../../electron/api/route-utils';
import {
  draftEmailWithGraph,
  isGraphOutlookAvailable,
  readEmailWithGraph,
  readInboxWithGraph,
  searchInboxWithGraph,
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
    open: vi.fn(),
    readInbox: vi.fn(),
    draftEmail: vi.fn(),
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
const graphAvailableMock = vi.mocked(isGraphOutlookAvailable);
const graphConfigMock = vi.mocked(getMicrosoftGraphConfig);
const graphStatusMock = vi.mocked(getStatus);
const browserManagerMock = vi.mocked(outlookBrowserManagerV2);
const graphMailboxMocks = [
  vi.mocked(readInboxWithGraph),
  vi.mocked(searchInboxWithGraph),
  vi.mocked(readEmailWithGraph),
  vi.mocked(draftEmailWithGraph),
  vi.mocked(sendEmailWithGraph),
];

// Synthetic status builder — no real tenant identifiers or addresses.
function graphStatus(overrides: Partial<{
  configured: boolean;
  signedIn: boolean;
  mockMailbox: boolean;
  grantedScopes: string[];
}> = {}) {
  const signedIn = overrides.signedIn ?? false;
  return {
    configured: overrides.configured ?? false,
    signedIn,
    account: signedIn
      ? { accountId: 'acct-test-1', email: 'unit-test@invalid.test', tenantId: 'tenant-test-1' }
      : null,
    expiresAt: null,
    grantedScopes: overrides.grantedScopes ?? [],
    mockMailbox: overrides.mockMailbox ?? false,
    effectiveMock: (overrides.mockMailbox ?? false) || !signedIn,
  };
}

async function callReadiness(method = 'POST') {
  const { handleOutlookRoutes } = await import('../../electron/api/routes/outlook');
  const handled = await handleOutlookRoutes(
    { method } as IncomingMessage,
    {} as ServerResponse,
    new URL('http://127.0.0.1:13210/api/outlook/readiness'),
  );
  return handled;
}

function lastPayload() {
  const call = sendJsonMock.mock.calls.at(-1) as unknown[];
  return { status: call[1] as number, body: call[2] as Record<string, any> };
}

function expectNoMutation() {
  for (const fn of Object.values(browserManagerMock)) {
    expect(fn).not.toHaveBeenCalled();
  }
  for (const fn of graphMailboxMocks) {
    expect(fn).not.toHaveBeenCalled();
  }
}

describe('POST /api/outlook/readiness — read-only capability diagnosis (Main owns the truth)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CLAWX_GRAPH_OUTLOOK_READ;
    delete process.env.CLAWX_GRAPH_OUTLOOK_COMPOSE;
    parseBodyMock.mockResolvedValue({});
    graphConfigMock.mockResolvedValue(null);
    graphStatusMock.mockResolvedValue(graphStatus());
    graphAvailableMock.mockResolvedValue(false);
  });

  afterEach(() => {
    delete process.env.CLAWX_GRAPH_OUTLOOK_READ;
    delete process.env.CLAWX_GRAPH_OUTLOOK_COMPOSE;
  });

  it('graph lanes disabled + not configured: typed not_configured state, browser transports, no mutation', async () => {
    const handled = await callReadiness();
    expect(handled).toBe(true);
    const { status, body } = lastPayload();
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    const data = body.data;
    expect(data.status).toBe('ok');
    expect(data.graph.integrated).toBe(true);
    expect(data.graph.state).toBe('not_configured');
    expect(data.graph.configured).toBe(false);
    expect(data.graph.signedIn).toBe(false);
    expect(data.graph.read).toEqual({ enabled: false, transport: 'browser' });
    expect(data.graph.compose).toEqual({
      enabled: false,
      transport: 'browser',
      mailSendScopeGranted: false,
    });
    // The browser lane is honestly unknown — this endpoint never probes it.
    expect(data.browser.state).toBe('unknown');
    expect(typeof data.browser.note).toBe('string');
    expect(typeof data.summary).toBe('string');
    // Truthful messaging hooks: built-in integration, no local install story.
    expect(data.summary).toMatch(/built into/i);
    expect(data.summary).toMatch(/no local .*install/i);
    // No account identifiers leak into the summary.
    expect(data.summary).not.toMatch(/invalid\.test|acct-test|tenant-test/);
    expectNoMutation();
  });

  it('configured but not signed in: typed not_signed_in state, lanes stay browser even when enabled', async () => {
    graphConfigMock.mockResolvedValue({
      tenantId: 'tenant-test-1',
      clientId: 'client-test-1',
      graphOutlookRead: true,
      graphOutlookCompose: true,
    } as never);
    graphStatusMock.mockResolvedValue(graphStatus({ configured: true, signedIn: false }));
    graphAvailableMock.mockResolvedValue(false);

    const handled = await callReadiness();
    expect(handled).toBe(true);
    const { body } = lastPayload();
    const data = body.data;
    expect(data.graph.state).toBe('not_signed_in');
    expect(data.graph.configured).toBe(true);
    expect(data.graph.read).toEqual({ enabled: true, transport: 'browser' });
    expect(data.graph.compose.enabled).toBe(true);
    expect(data.graph.compose.transport).toBe('browser');
    expectNoMutation();
  });

  it('signed in with lanes enabled: typed signed_in state and graph transports (same selection code as real reads)', async () => {
    graphConfigMock.mockResolvedValue({
      tenantId: 'tenant-test-1',
      clientId: 'client-test-1',
      graphOutlookRead: true,
      graphOutlookCompose: true,
    } as never);
    graphStatusMock.mockResolvedValue(
      graphStatus({
        configured: true,
        signedIn: true,
        grantedScopes: ['User.Read', 'Mail.Read', 'https://graph.microsoft.com/Mail.Send'],
      }),
    );
    graphAvailableMock.mockResolvedValue(true);

    const handled = await callReadiness();
    expect(handled).toBe(true);
    const { body } = lastPayload();
    const data = body.data;
    expect(data.graph.state).toBe('signed_in');
    expect(data.graph.read).toEqual({ enabled: true, transport: 'graph' });
    // Resource-qualified grant must be recognised (same rule as the send gate).
    expect(data.graph.compose).toEqual({
      enabled: true,
      transport: 'graph',
      mailSendScopeGranted: true,
    });
    expectNoMutation();
  });

  it('signed in without Mail.Send scope: compose lane reports the missing grant', async () => {
    process.env.CLAWX_GRAPH_OUTLOOK_COMPOSE = '1';
    graphStatusMock.mockResolvedValue(
      graphStatus({ configured: true, signedIn: true, grantedScopes: ['Mail.Read'] }),
    );
    graphAvailableMock.mockResolvedValue(true);

    await callReadiness();
    const { body } = lastPayload();
    expect(body.data.graph.compose.mailSendScopeGranted).toBe(false);
    expect(body.data.graph.compose.transport).toBe('graph');
    expectNoMutation();
  });

  it('mock mailbox: reported explicitly and send-scope gate mirrors the send path (mock bypass)', async () => {
    process.env.CLAWX_GRAPH_OUTLOOK_READ = '1';
    graphStatusMock.mockResolvedValue(
      graphStatus({ configured: true, signedIn: false, mockMailbox: true }),
    );
    graphAvailableMock.mockResolvedValue(true);

    await callReadiness();
    const { body } = lastPayload();
    expect(body.data.graph.mockMailbox).toBe(true);
    expect(body.data.graph.read.transport).toBe('graph');
    expect(body.data.graph.compose.mailSendScopeGranted).toBe(true);
    expectNoMutation();
  });

  it('status read failure: typed unknown state — never inferred as absent/unconfigured', async () => {
    graphStatusMock.mockRejectedValue(new Error('secret store locked'));
    graphAvailableMock.mockResolvedValue(false);

    const handled = await callReadiness();
    expect(handled).toBe(true);
    const { status, body } = lastPayload();
    expect(status).toBe(200);
    expect(body.data.graph.state).toBe('unknown');
    expect(body.data.graph.integrated).toBe(true);
    expect(body.data.summary).not.toMatch(/not configured|not installed|absent/i);
    expectNoMutation();
  });

  it('non-POST readiness is refused like the rest of the family (405)', async () => {
    const handled = await callReadiness('GET');
    expect(handled).toBe(true);
    const { status } = lastPayload();
    expect(status).toBe(405);
    expectNoMutation();
  });
});

// ── Plugin side: outlook.readiness tool over the readiness route ───────────

const pluginConfig = {
  principalName: 'Mrs. Test',
  schoolName: 'Demo Primary',
  educationDistrict: 'Victoria',
  schoolType: 'Government',
};

interface RegisteredTool {
  name: string;
  description?: string;
  execute?: (toolCallId: string, params?: Record<string, unknown>) => Promise<unknown>;
  parameters?: unknown;
}

type StubResponse = { status: number; body: unknown };

function makeFetchStub(route: (method: string, pathname: string) => StubResponse | undefined) {
  const calls: Array<{ method: string; url: string }> = [];
  const fetchImpl = async (input: string, init?: { method?: string }) => {
    const method = init?.method ?? 'GET';
    const url = new URL(input);
    calls.push({ method, url: url.pathname });
    const match = route(method, url.pathname) ?? {
      status: 404,
      body: { success: false, error: `No route for ${method} ${url.pathname}` },
    };
    return {
      status: match.status,
      ok: match.status >= 200 && match.status < 300,
      text: async () => JSON.stringify(match.body),
      json: async () => match.body,
    };
  };
  return { fetchImpl, calls };
}

const READINESS_DATA = {
  status: 'ok',
  graph: {
    integrated: true,
    state: 'not_signed_in',
    configured: true,
    signedIn: false,
    mockMailbox: false,
    read: { enabled: false, transport: 'browser' },
    compose: { enabled: false, transport: 'browser', mailSendScopeGranted: false },
  },
  browser: { state: 'unknown', note: 'not probed' },
  summary: 'synthetic summary',
};

const FULL_INVENTORY = {
  status: 200,
  body: {
    success: true,
    data: {
      appVersion: '9.9.9-test',
      families: {
        browser: { present: true, enabled: true },
        outlook: { present: true, enabled: true },
        forms: { present: true, enabled: true },
      },
      routes: [
        'POST /api/browser/diagnose',
        'POST /api/browser/repair-chrome-cdp',
        'POST /api/outlook/readiness',
        'POST /api/outlook/open',
        'POST /api/outlook/read-inbox',
        'POST /api/outlook/draft',
        'POST /api/outlook/send',
        'POST /api/outlook/search-inbox',
        'POST /api/outlook/read-email',
        'POST /api/outlook/reply',
        'POST /api/outlook/forward',
        'POST /api/outlook/mark-read',
        'POST /api/outlook/list-attachments',
        'POST /api/outlook/download-attachment',
        'POST /api/forms/list',
        'POST /api/forms/preview-daily-report',
        'POST /api/forms/submit-daily-report',
        'POST /api/forms/preview-suspension',
        'POST /api/forms/submit-suspension',
      ],
    },
  },
};

async function registerPlugin() {
  const { register } = await import('../../extensions/moe-principal-assistant/index.mjs');
  const tools: RegisteredTool[] = [];
  register({
    pluginConfig,
    registerTool: (tool: RegisteredTool) => tools.push(tool),
    log: { info() {}, warn() {} },
  });
  return Object.fromEntries(tools.map((tool) => [tool.name, tool]));
}

describe('outlook.readiness plugin tool — read-only diagnosis surface', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CLAWX_HOST_API_PORT;
    delete process.env.CLAWX_HOST_API_TOKEN;
  });

  it('registers a read-only readiness tool and answers via POST /api/outlook/readiness only', async () => {
    process.env.CLAWX_HOST_API_PORT = '13299';
    process.env.CLAWX_HOST_API_TOKEN = 'unit-test-token';
    const { fetchImpl, calls } = makeFetchStub((method, pathname) => {
      if (method === 'GET' && pathname === '/api/capabilities') return FULL_INVENTORY;
      if (method === 'POST' && pathname === '/api/outlook/readiness') {
        return { status: 200, body: { success: true, data: READINESS_DATA } };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchImpl);

    const byName = await registerPlugin();
    const tool = byName['outlook.readiness'];
    expect(tool, 'outlook.readiness must be registered').toBeTruthy();
    expect(tool.parameters).toMatchObject({ type: 'object' });
    // The description is the agent's contract: read-only, no browser
    // navigation for a status question, no local-install misconception,
    // no config-file spelunking.
    expect(tool.description).toMatch(/read-only/i);
    expect(tool.description).toMatch(/built into/i);
    expect(tool.description).toMatch(/never needs a local/i);
    expect(tool.description).toMatch(/configuration file/i);

    const result = (await tool.execute?.('t1', {})) as typeof READINESS_DATA;
    expect(result).toEqual(READINESS_DATA);
    // Exactly one POST, to the readiness route — a diagnosis never opens,
    // reads, drafts or sends anything.
    const posts = calls.filter((c) => c.method === 'POST');
    expect(posts).toEqual([{ method: 'POST', url: '/api/outlook/readiness' }]);
  });

  it('self-parks readably on a version-skewed install that lacks the readiness route', async () => {
    process.env.CLAWX_HOST_API_PORT = '13299';
    process.env.CLAWX_HOST_API_TOKEN = 'unit-test-token';
    const inventoryWithoutReadiness = {
      status: 200,
      body: {
        success: true,
        data: {
          ...FULL_INVENTORY.body.data,
          routes: FULL_INVENTORY.body.data.routes.filter(
            (r) => r !== 'POST /api/outlook/readiness',
          ),
        },
      },
    };
    const { fetchImpl, calls } = makeFetchStub((method, pathname) => {
      if (method === 'GET' && pathname === '/api/capabilities') return inventoryWithoutReadiness;
      return undefined;
    });
    vi.stubGlobal('fetch', fetchImpl);

    const byName = await registerPlugin();
    const result = (await byName['outlook.readiness'].execute?.('t1', {})) as {
      status?: string;
      message?: string;
    };
    expect(result?.status).toBe('unavailable');
    expect(result?.message).toContain('Ministry of Education app update');
    expect(calls.filter((c) => c.method === 'POST')).toEqual([]);
  });

  it('is absent with the rest of the outlook family when host-API creds are missing', async () => {
    delete process.env.CLAWX_HOST_API_PORT;
    delete process.env.CLAWX_HOST_API_TOKEN;
    const byName = await registerPlugin();
    expect(byName['outlook.readiness']).toBeUndefined();
    expect(byName['outlook.open']).toBeUndefined();
  });

  it('persona directs Graph-availability questions to outlook.readiness, not config paths or browser opens', async () => {
    const { SYSTEM_PROMPT } = await import('../../extensions/moe-principal-assistant/persona.mjs');
    expect(SYSTEM_PROMPT).toContain('outlook.readiness');
    expect(SYSTEM_PROMPT).toMatch(/never (?:a |)requires? a local/i);
    expect(SYSTEM_PROMPT).toMatch(/configuration file|config file/i);
  });
});
