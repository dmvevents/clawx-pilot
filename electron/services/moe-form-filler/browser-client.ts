/**
 * Thin wrapper over OpenClaw's browser plugin HTTP API on
 * `http://127.0.0.1:18791/`. We only call the endpoints we need to fill the
 * MoE forms; the full surface is documented in the openclaw deep-dive report.
 *
 * Auth: same gateway token used by the WebSocket. Reads from electron-store
 * settings each call so token rotation is transparent.
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
    const err = new Error(`Browser plugin ${method} ${path} → ${resp.status}: ${text}`);
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

export const browserClient = {
  status: (profile?: BrowserProfile) =>
    request<BrowserStatus>('GET', `/${profile ? `?profile=${profile}` : ''}`),
  start: (profile: BrowserProfile = 'openclaw') =>
    request<{ ok: boolean }>('POST', `/start`, { profile }),
  open: (url: string, profile: BrowserProfile = 'user') =>
    request<{ targetId: string }>('POST', `/tabs/open`, { url, profile }),
  navigate: (targetId: string, url: string) =>
    request<{ ok: boolean }>('POST', `/navigate`, { targetId, url }),
  snapshot: (
    targetId: string,
    opts: {
      format?: 'ai' | 'aria';
      refs?: 'role' | 'aria';
      interactive?: boolean;
      compact?: boolean;
      depth?: number;
      labels?: boolean;
      selector?: string;
    } = {},
  ) => request<unknown>('POST', `/snapshot`, { targetId, ...opts }),
  act: (
    targetId: string,
    request_: Record<string, unknown>,
  ) => request<unknown>('POST', `/act`, { targetId, request: request_ }),
};
