/**
 * CLWX-86 — capability handshake endpoint for the gateway plugin.
 *
 * GET /api/capabilities returns the authoritative inventory of the
 * plugin-facing host-API surface (browser/outlook/forms routes), the
 * per-family allowlist state, and the installed app version. The
 * moe-principal-assistant plugin probes this once at registration so it can
 * self-park tools whose routes the installed app does not serve (tool ↔
 * host-API version skew — the moe.15 "No route for POST /api/browser/diagnose"
 * class) instead of surfacing a raw HTTP error to the agent.
 *
 * Installs that predate this endpoint 404 here by definition; the plugin
 * then downgrades to family-level GET probes (see
 * extensions/moe-principal-assistant/capability-gate.mjs).
 *
 * The inventory below is kept honest by a unit drift-guard that parses the
 * pathname literals out of browser.ts / outlook.ts / forms.ts and requires
 * set-equality with this list (tests/unit/host-api-capabilities-route.test.ts).
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { PRINCIPAL_SKILL_ALLOWLIST } from '../../../shared/feature-flags';
import { sendJson } from '../route-utils';

export const PLUGIN_FACING_HOST_API_ROUTES: readonly string[] = [
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
];

// Resolved lazily so this module stays importable under plain-node unit
// tests, where the electron package exports a binary path, not the API.
let cachedAppVersion: string | null | undefined;
async function resolveAppVersion(): Promise<string | null> {
  if (cachedAppVersion === undefined) {
    try {
      const electron = await import('electron');
      cachedAppVersion = electron?.app?.getVersion?.() ?? null;
    } catch {
      cachedAppVersion = null;
    }
  }
  return cachedAppVersion;
}

export async function handleCapabilitiesRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (url.pathname !== '/api/capabilities') return false;
  if (req.method !== 'GET') {
    sendJson(res, 405, { success: false, error: 'Method not allowed' });
    return true;
  }
  sendJson(res, 200, {
    success: true,
    data: {
      appVersion: await resolveAppVersion(),
      families: {
        browser: { present: true, enabled: true },
        outlook: { present: true, enabled: PRINCIPAL_SKILL_ALLOWLIST.has('outlook') },
        forms: { present: true, enabled: PRINCIPAL_SKILL_ALLOWLIST.has('forms') },
      },
      routes: PLUGIN_FACING_HOST_API_ROUTES,
    },
  });
  return true;
}
