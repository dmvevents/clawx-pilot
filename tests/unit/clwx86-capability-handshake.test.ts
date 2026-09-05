// @vitest-environment node
/**
 * CLWX-86 — tool ↔ host-API capability handshake (plugin side).
 *
 * Three layers:
 *  A. Gate unit matrix (createHostApiCapabilityGate with injected fetch):
 *     tier-1 /api/capabilities interpretation, tier-2 legacy family probes,
 *     indeterminate fail-open + re-probe, memoization, skew logging hygiene.
 *  B. One unit row PER GATED TOOL (the card's acceptance): on a legacy app
 *     whose host-API serves none of the plugin-facing families, every
 *     registered browser./outlook./forms. tool self-parks with the readable
 *     update-the-app message and NO POST ever reaches the host-API.
 *  C. Facade 404 disambiguation + positive control: a skew-shaped global 404
 *     surfaces the readable message (never raw "No route for ..."), the
 *     allowlist-off 404 keeps its kill-switch wording, and with the
 *     capability inventory present the tools call straight through.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createHostApiCapabilityGate,
  gateHostApiFacade,
  hostApiSkewMessage,
  isNoRouteBody,
} from '../../extensions/moe-principal-assistant/capability-gate.mjs';

const pluginConfig = {
  principalName: 'Mrs. Test',
  schoolName: 'Demo Primary',
  educationDistrict: 'Victoria',
  schoolType: 'Government',
};

interface RegisteredTool {
  name: string;
  execute?: (toolCallId: string, params?: Record<string, unknown>) => Promise<unknown>;
}

async function loadPlugin() {
  return import('../../extensions/moe-principal-assistant/index.mjs');
}

type StubResponse = { status: number; body: unknown };
type FetchCall = { method: string; url: string };

/**
 * Minimal fetch stub. `route(method, pathname)` returns a StubResponse or
 * undefined (undefined → global-404 shape, exactly like server.ts:113).
 */
function makeFetchStub(
  route: (method: string, pathname: string) => StubResponse | undefined,
) {
  const calls: FetchCall[] = [];
  const fetchImpl = async (input: string, init?: { method?: string }) => {
    const method = init?.method ?? 'GET';
    const url = new URL(input);
    calls.push({ method, url: url.pathname });
    const match = route(method, url.pathname) ?? {
      status: 404,
      body: { success: false, error: `No route for ${method} ${url.pathname}` },
    };
    const text = JSON.stringify(match.body);
    return {
      status: match.status,
      ok: match.status >= 200 && match.status < 300,
      text: async () => text,
      json: async () => match.body,
    };
  };
  return { fetchImpl, calls };
}

const CAPABILITIES_OK: StubResponse = {
  status: 200,
  body: {
    success: true,
    data: {
      appVersion: '0.4.3-moe.18',
      families: {
        browser: { present: true, enabled: true },
        outlook: { present: true, enabled: true },
        forms: { present: true, enabled: true },
      },
      routes: [
        'POST /api/browser/diagnose',
        'POST /api/browser/repair-chrome-cdp',
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

function collectLog() {
  const lines: string[] = [];
  return {
    lines,
    log: {
      info: (msg: string) => lines.push(String(msg)),
      warn: (msg: string) => lines.push(String(msg)),
    },
  };
}

describe('capability gate — unit matrix (CLWX-86)', () => {
  it('tier 1: allows listed routes, parks missing routes with the readable reason', async () => {
    const capped = structuredClone(CAPABILITIES_OK) as typeof CAPABILITIES_OK;
    (capped.body as { data: { routes: string[] } }).data.routes = (
      capped.body as { data: { routes: string[] } }
    ).data.routes.filter((r) => r !== 'POST /api/outlook/search-inbox');
    const { fetchImpl } = makeFetchStub((method, pathname) =>
      method === 'GET' && pathname === '/api/capabilities' ? capped : undefined,
    );
    const { log, lines } = collectLog();
    const gate = createHostApiCapabilityGate({ port: 13299, token: 't', log, fetchImpl });

    const okVerdict = await gate.check({ family: 'outlook', route: 'POST /api/outlook/open' });
    expect(okVerdict.ok).toBe(true);

    const parked = await gate.check({ family: 'outlook', route: 'POST /api/outlook/search-inbox' });
    expect(parked.ok).toBe(false);
    expect(parked.reason).toContain('Ministry of Education app update');
    expect(lines.join('\n')).toContain('route missing: POST /api/outlook/search-inbox');
  });

  it('tier 1: declared-absent family parks; allowlist-disabled family does NOT park', async () => {
    const shaped = structuredClone(CAPABILITIES_OK) as typeof CAPABILITIES_OK;
    const families = (
      shaped.body as {
        data: { families: Record<string, { present: boolean; enabled: boolean }> };
      }
    ).data.families;
    families.browser = { present: false, enabled: false };
    families.outlook = { present: true, enabled: false };
    const { fetchImpl } = makeFetchStub((method, pathname) =>
      method === 'GET' && pathname === '/api/capabilities' ? shaped : undefined,
    );
    const gate = createHostApiCapabilityGate({ port: 13299, token: 't', log: collectLog().log, fetchImpl });

    expect((await gate.check({ family: 'browser', route: 'POST /api/browser/diagnose' })).ok).toBe(false);
    // Kill-switch semantics unchanged: the call path surfaces the allowlist
    // wording, so the gate must not park a merely-disabled family.
    expect((await gate.check({ family: 'outlook', route: 'POST /api/outlook/open' })).ok).toBe(true);
  });

  it('tier 2 (legacy app): 405→present, disabled-404→open, no-route-404→parked', async () => {
    const { fetchImpl, calls } = makeFetchStub((method, pathname) => {
      if (pathname === '/api/capabilities') return undefined; // global 404
      if (pathname === '/api/outlook/capability-probe') {
        return { status: 405, body: { success: false, error: 'Method not allowed' } };
      }
      if (pathname === '/api/forms/capability-probe') {
        return { status: 404, body: { success: false, error: 'forms capability disabled' } };
      }
      return undefined; // browser probe → global 404 → absent
    });
    const { log, lines } = collectLog();
    const gate = createHostApiCapabilityGate({ port: 13299, token: 't', log, fetchImpl });

    expect((await gate.check({ family: 'outlook', route: 'POST /api/outlook/open' })).ok).toBe(true);
    expect((await gate.check({ family: 'forms', route: 'POST /api/forms/list' })).ok).toBe(true);
    const parked = await gate.check({ family: 'browser', route: 'POST /api/browser/diagnose' });
    expect(parked.ok).toBe(false);
    expect(parked.reason).toBe(hostApiSkewMessage('browser'));
    expect(lines.join('\n')).toContain('absent families: browser');
    // Definitive result memoized — no further probes on subsequent checks.
    const probeCount = calls.length;
    await gate.check({ family: 'browser', route: 'POST /api/browser/diagnose' });
    expect(calls.length).toBe(probeCount);
  });

  it('indeterminate (unreachable host-API): fails OPEN and re-probes on the next check', async () => {
    let reachable = false;
    const { fetchImpl, calls } = makeFetchStub(() => {
      if (!reachable) throw new Error('ECONNREFUSED');
      return CAPABILITIES_OK;
    });
    const gate = createHostApiCapabilityGate({ port: 13299, token: 't', log: collectLog().log, fetchImpl });

    const openVerdict = await gate.check({ family: 'outlook', route: 'POST /api/outlook/open' });
    expect(openVerdict).toMatchObject({ ok: true, indeterminate: true });
    const attemptsWhileDown = calls.length;
    expect(attemptsWhileDown).toBeGreaterThan(0);

    reachable = true;
    const later = await gate.check({ family: 'outlook', route: 'POST /api/outlook/open' });
    expect(later.ok).toBe(true);
    expect(later).not.toHaveProperty('indeterminate');
    expect(calls.length).toBeGreaterThan(attemptsWhileDown);
  });

  it('never logs the bearer token', async () => {
    const secret = 'ultra-secret-host-api-token';
    const { fetchImpl } = makeFetchStub(() => undefined); // everything absent
    const { log, lines } = collectLog();
    const gate = createHostApiCapabilityGate({ port: 13299, token: secret, log, fetchImpl });
    await gate.check({ family: 'outlook', route: 'POST /api/outlook/open' });
    await gate.check({ family: 'browser', route: 'POST /api/browser/diagnose' });
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('\n')).not.toContain(secret);
  });

  it('gateHostApiFacade parks methods without calling through', async () => {
    const underlying = { ping: vi.fn(async () => ({ status: 'ok' })) };
    const gate = {
      check: async () => ({ ok: false, reason: hostApiSkewMessage('outlook') }),
    };
    const wrapped = gateHostApiFacade(underlying, 'outlook', { ping: 'POST /api/outlook/ping' }, gate);
    const result = await wrapped.ping();
    expect(result).toEqual({ status: 'unavailable', message: hostApiSkewMessage('outlook') });
    expect(underlying.ping).not.toHaveBeenCalled();
  });

  it('isNoRouteBody matches the server global-404 shape only', () => {
    expect(isNoRouteBody('No route for POST /api/browser/diagnose')).toBe(true);
    expect(isNoRouteBody('outlook capability disabled')).toBe(false);
    expect(isNoRouteBody('Unknown browser endpoint')).toBe(false);
  });
});

describe('per-tool self-park rows on a skewed (legacy, family-less) app — CLWX-86 acceptance', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CLAWX_HOST_API_PORT;
    delete process.env.CLAWX_HOST_API_TOKEN;
    delete process.env.MOE_DEMO_DEFAULTS;
  });

  /** Tool name → minimal args that pass execute-level validation. */
  const PARK_ROWS: Array<[string, Record<string, unknown>]> = [
    ['browser.diagnose', {}],
    ['browser.repair_chrome_cdp', {}],
    ['outlook.open', {}],
    ['outlook.read_inbox', {}],
    ['outlook.draft_email', { to: 'someone@example.com', subject: 'Test', body: 'Body' }],
    ['outlook.send_email', { confirm: true }],
    ['outlook.search_inbox', {}],
    ['outlook.read_email', { id: 'msg-1' }],
    ['outlook.reply', { id: 'msg-1', body: 'Body' }],
    ['outlook.forward', { id: 'msg-1', to: 'someone@example.com' }],
    ['outlook.mark_read', { id: 'msg-1', read: true }],
    ['outlook.list_attachments', { id: 'msg-1' }],
    ['outlook.download_attachment', { id: 'msg-1', filename: 'a.pdf', confirm: true }],
    ['forms.list', {}],
    ['forms.preview_suspension', { payload: {} }],
    ['forms.preview_daily_report', { payload: { attendance: '250' } }],
    ['forms.submit_suspension', { confirm: true }],
    ['forms.submit_daily_report', { confirm: true }],
  ];

  it('all 18 host-API tools park readably and zero POSTs reach the host-API', async () => {
    process.env.CLAWX_HOST_API_PORT = '13299';
    process.env.CLAWX_HOST_API_TOKEN = 'unit-test-token';
    // preview_suspension must clear statutory normalization to reach the
    // gated facade; the operator demo flag is the sanctioned backfill path.
    process.env.MOE_DEMO_DEFAULTS = '1';

    const { fetchImpl, calls } = makeFetchStub(() => undefined); // legacy app: everything global-404
    vi.stubGlobal('fetch', fetchImpl);

    const { register } = await loadPlugin();
    const tools: RegisteredTool[] = [];
    register({
      pluginConfig,
      registerTool: (tool: RegisteredTool) => tools.push(tool),
      log: { info() {}, warn() {} },
    });
    const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));

    for (const [name, args] of PARK_ROWS) {
      const tool = byName[name];
      expect(tool, `tool ${name} should be registered`).toBeTruthy();
      const result = (await tool.execute?.('t1', args)) as { status?: string; message?: string };
      expect(result?.status, `tool ${name} should self-park`).toBe('unavailable');
      expect(result?.message, `tool ${name} park reason`).toContain('Ministry of Education app update');
      expect(result?.message).not.toMatch(/No route for/i);
    }

    const posts = calls.filter((c) => c.method === 'POST');
    expect(posts).toEqual([]);
    // The handshake itself is GET-only and ran at least once.
    expect(calls.some((c) => c.method === 'GET' && c.url === '/api/capabilities')).toBe(true);
  });
});

describe('facade 404 disambiguation + positive control — CLWX-86', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CLAWX_HOST_API_PORT;
    delete process.env.CLAWX_HOST_API_TOKEN;
  });

  async function registerWithStub(
    route: (method: string, pathname: string) => StubResponse | undefined,
  ) {
    process.env.CLAWX_HOST_API_PORT = '13299';
    process.env.CLAWX_HOST_API_TOKEN = 'unit-test-token';
    const { fetchImpl, calls } = makeFetchStub(route);
    vi.stubGlobal('fetch', fetchImpl);
    const { register } = await loadPlugin();
    const tools: RegisteredTool[] = [];
    register({
      pluginConfig,
      registerTool: (tool: RegisteredTool) => tools.push(tool),
      log: { info() {}, warn() {} },
    });
    return { byName: Object.fromEntries(tools.map((t) => [t.name, t])), calls };
  }

  it('positive control: with the inventory present, tools call straight through', async () => {
    const { byName } = await registerWithStub((method, pathname) => {
      if (method === 'GET' && pathname === '/api/capabilities') return CAPABILITIES_OK;
      if (method === 'POST' && pathname === '/api/outlook/open') {
        return { status: 200, body: { success: true, data: { status: 'opened', url: 'https://outlook' } } };
      }
      return undefined;
    });
    const result = (await byName['outlook.open'].execute?.('t1', {})) as { status: string };
    expect(result.status).toBe('opened');
  });

  it('endpoint-level skew on a legacy app: outlook surfaces the readable message, not raw HTTP', async () => {
    // Gate sees the route as present (inventory lists it) but the POST 404s
    // with the global no-route shape — the facade must translate it.
    const { byName } = await registerWithStub((method, pathname) => {
      if (method === 'GET' && pathname === '/api/capabilities') return CAPABILITIES_OK;
      return undefined; // every POST → global 404
    });
    const result = (await byName['outlook.search_inbox'].execute?.('t1', {})) as {
      status: string;
      message: string;
    };
    expect(result.status).toBe('unavailable');
    expect(result.message).toContain('Ministry of Education app update');
    expect(result.message).not.toMatch(/No route for/i);
  });

  it('allowlist-off 404 keeps the kill-switch wording (outlook)', async () => {
    const { byName } = await registerWithStub((method, pathname) => {
      if (method === 'GET' && pathname === '/api/capabilities') return CAPABILITIES_OK;
      if (method === 'POST' && pathname === '/api/outlook/read-inbox') {
        return { status: 404, body: { success: false, error: 'outlook capability disabled' } };
      }
      return undefined;
    });
    await expect(byName['outlook.read_inbox'].execute?.('t1', {})).rejects.toThrow(
      /capability disabled/,
    );
  });

  it('forms and browser translate the no-route 404 into the readable skew error', async () => {
    const { byName } = await registerWithStub((method, pathname) => {
      if (method === 'GET' && pathname === '/api/capabilities') return CAPABILITIES_OK;
      return undefined; // every POST → global 404
    });
    await expect(byName['forms.list'].execute?.('t1', {})).rejects.toThrow(
      /Ministry of Education app update/,
    );
    await expect(byName['browser.diagnose'].execute?.('t1', {})).rejects.toThrow(
      /Ministry of Education app update/,
    );
  });
});
