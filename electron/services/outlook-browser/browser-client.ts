/**
 * Thin wrapper around the OpenClaw browser plugin's HTTP API
 * (http://127.0.0.1:18791/) — same shape as moe-form-filler/browser-client.ts.
 *
 * We deliberately keep this file separate rather than importing the form-filler
 * one, so the two services can evolve independently (the Outlook DOM is much
 * less stable than Microsoft Forms, and we'll likely add Outlook-specific
 * helpers here over time).
 *
 * Hard rule: every call defaults to profile='user'. The bundled browser plugin
 * attaches to the principal's existing Chrome session that way. Managed
 * Chromium is blocked by Conditional Access on the school tenant.
 */
import { getSetting } from '../../utils/store';

export type BrowserProfile = 'openclaw' | 'user';

const BROWSER_BASE = 'http://127.0.0.1:18791';

async function token(): Promise<string> {
  const t = await getSetting('gatewayToken');
  if (!t) throw new Error('Gateway token not set');
  return t;
}

async function request<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<T> {
  const t = await token();
  const url = `${BROWSER_BASE}${path}`;
  const resp = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${t}`,
      'content-type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    const err = new Error(
      `Browser plugin ${method} ${path} → ${resp.status}: ${text}`,
    );
    (err as Error & { status?: number }).status = resp.status;
    throw err;
  }
  if (resp.status === 204) return null as T;
  return (await resp.json()) as T;
}

export interface BrowserStatus {
  running: boolean;
  cdpReady: boolean;
  transport: 'cdp' | 'chrome-mcp' | string;
  pid?: number;
  userDataDir?: string;
}

export interface OutlookBrowserClient {
  status(profile?: BrowserProfile): Promise<BrowserStatus>;
  start(profile?: BrowserProfile): Promise<{ ok: boolean }>;
  open(url: string, profile?: BrowserProfile): Promise<{ targetId: string }>;
  navigate(targetId: string, url: string): Promise<{ ok: boolean }>;
  snapshot(
    targetId: string,
    opts?: {
      format?: 'ai' | 'aria';
      refs?: 'role' | 'aria';
      interactive?: boolean;
      compact?: boolean;
      depth?: number;
      labels?: boolean;
      selector?: string;
    },
  ): Promise<unknown>;
  act(targetId: string, request: Record<string, unknown>): Promise<unknown>;
}

export const browserClient: OutlookBrowserClient = {
  status: (profile: BrowserProfile = 'user') =>
    request<BrowserStatus>('GET', `/?profile=${profile}`),
  start: (profile: BrowserProfile = 'user') =>
    request<{ ok: boolean }>('POST', `/start`, { profile }),
  open: (url: string, profile: BrowserProfile = 'user') =>
    request<{ targetId: string }>('POST', `/tabs/open`, { url, profile }),
  navigate: (targetId: string, url: string) =>
    request<{ ok: boolean }>('POST', `/navigate`, { targetId, url }),
  snapshot: (targetId, opts = {}) =>
    request<unknown>('POST', `/snapshot`, { targetId, ...opts }),
  act: (targetId, request_) =>
    request<unknown>('POST', `/act`, { targetId, request: request_ }),
};
