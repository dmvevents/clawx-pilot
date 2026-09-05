// @vitest-environment node
/**
 * CLWX-86 — capability handshake endpoint (host-API side).
 *
 * Covers: handler dispatch (path claim, GET-only), response shape the plugin
 * gate consumes, and the drift guard that keeps PLUGIN_FACING_HOST_API_ROUTES
 * honest against the actual pathname literals in browser.ts/outlook.ts/forms.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const sendJsonMock = vi.fn();

vi.mock('@electron/api/route-utils', () => ({
  setCorsHeaders: vi.fn(),
  parseJsonBody: vi.fn().mockResolvedValue({}),
  sendJson: (...args: unknown[]) => sendJsonMock(...args),
  sendNoContent: vi.fn(),
  requireJsonContentType: vi.fn().mockReturnValue(true),
}));

const REPO_ROOT = path.resolve(__dirname, '..', '..');

async function loadHandler() {
  return import('@electron/api/routes/capabilities');
}

describe('handleCapabilitiesRoutes (CLWX-86)', () => {
  beforeEach(() => {
    sendJsonMock.mockReset();
  });

  it('does not claim other paths', async () => {
    const { handleCapabilitiesRoutes } = await loadHandler();
    const handled = await handleCapabilitiesRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/outlook/open'),
    );
    expect(handled).toBe(false);
    expect(sendJsonMock).not.toHaveBeenCalled();
  });

  it('refuses non-GET with 405', async () => {
    const { handleCapabilitiesRoutes } = await loadHandler();
    const handled = await handleCapabilitiesRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/capabilities'),
    );
    expect(handled).toBe(true);
    expect(sendJsonMock).toHaveBeenCalledWith(expect.anything(), 405, {
      success: false,
      error: 'Method not allowed',
    });
  });

  it('serves the inventory shape the plugin gate consumes', async () => {
    const { handleCapabilitiesRoutes, PLUGIN_FACING_HOST_API_ROUTES } = await loadHandler();
    const handled = await handleCapabilitiesRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/capabilities'),
    );
    expect(handled).toBe(true);
    expect(sendJsonMock).toHaveBeenCalledTimes(1);
    const [, status, payload] = sendJsonMock.mock.calls[0] as [
      unknown,
      number,
      {
        success: boolean;
        data: {
          appVersion: string | null;
          families: Record<string, { present: boolean; enabled: boolean }>;
          routes: readonly string[];
        };
      },
    ];
    expect(status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.data.routes).toEqual(PLUGIN_FACING_HOST_API_ROUTES);
    for (const family of ['browser', 'outlook', 'forms']) {
      expect(payload.data.families[family]).toMatchObject({ present: true });
      expect(typeof payload.data.families[family].enabled).toBe('boolean');
    }
    // Under vitest the setup file mocks electron's app.getVersion; on a
    // plain-node import the handler degrades to null. Either way it must be
    // string-or-null, never a crash.
    expect(payload.data.appVersion === null || typeof payload.data.appVersion === 'string').toBe(
      true,
    );
  });

  it('drift guard: inventory set-equals the pathname literals in the route files', async () => {
    const { PLUGIN_FACING_HOST_API_ROUTES } = await loadHandler();
    const fromSource = new Set<string>();
    for (const family of ['browser', 'outlook', 'forms']) {
      const src = readFileSync(
        path.join(REPO_ROOT, 'electron', 'api', 'routes', `${family}.ts`),
        'utf8',
      );
      // Strip line comments so documentation mentioning the dispatch shape
      // is never counted as a live route.
      const code = src.replace(/^\s*\/\/.*$/gm, '');
      for (const match of code.matchAll(/url\.pathname === '(\/api\/[^']+)'/g)) {
        // All three family handlers are POST-only (non-POST → 405).
        fromSource.add(`POST ${match[1]}`);
      }
    }
    expect(fromSource.size).toBeGreaterThanOrEqual(18);
    expect(new Set(PLUGIN_FACING_HOST_API_ROUTES)).toEqual(fromSource);
  });

  it('drift guard: the plugin-side route maps in index.mjs set-equal the inventory', async () => {
    // The three gateHostApiFacade maps in the plugin are a third copy of the
    // route list; the tier-1 gate does an exact Set.has() on these strings,
    // so a single-character typo would permanently false-park a working tool
    // on up-to-date apps (adversarial-review MAJOR, 2026-09-05). This leg
    // closes the drift triangle: inventory == route files == plugin maps.
    const { PLUGIN_FACING_HOST_API_ROUTES } = await loadHandler();
    const src = readFileSync(
      path.join(REPO_ROOT, 'extensions', 'moe-principal-assistant', 'index.mjs'),
      'utf8',
    );
    const fromPlugin = new Set<string>();
    for (const match of src.matchAll(/'(POST \/api\/[^']+)'/g)) {
      fromPlugin.add(match[1]);
    }
    expect(fromPlugin.size).toBeGreaterThanOrEqual(18);
    expect(fromPlugin).toEqual(new Set(PLUGIN_FACING_HOST_API_ROUTES));
  });

  it('drift guard: server.ts wires the capabilities handler', () => {
    const src = readFileSync(path.join(REPO_ROOT, 'electron', 'api', 'server.ts'), 'utf8');
    expect(src).toContain('handleCapabilitiesRoutes');
  });
});
