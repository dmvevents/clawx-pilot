/**
 * Host-API routes for the outlook-browser service.
 *
 * The moe-principal-assistant plugin runs inside the OpenClaw gateway
 * (separate process) and cannot share JS object references with the
 * Electron main process. To give it `host.outlook` capability we expose
 * the same OutlookBrowserManager singleton over the authenticated Host
 * API the gateway already uses for other host-side calls.
 *
 * Endpoints (all return JSON; allowlist-gated by PRINCIPAL_SKILL_ALLOWLIST):
 *   POST /api/outlook/open         → OutlookOpenResult
 *   POST /api/outlook/read-inbox   → ReadInboxResult         body: { top?: number }
 *   POST /api/outlook/draft        → DraftEmailResult        body: DraftEmailArgs
 *   POST /api/outlook/send         → SendEmailResult         body: SendEmailArgs
 *
 * Hard rules preserved here:
 *  - All four endpoints delegate to the same singleton manager that the
 *    IPC bridge uses, so the manager's confirm-flag gate on send is never
 *    bypassed.
 *  - We log subject + recipient counts only; never bodies, never raw addresses.
 *  - The whole surface is feature-gated: when 'outlook' is removed from
 *    PRINCIPAL_SKILL_ALLOWLIST, every endpoint returns 404 — the plugin
 *    sees the same shape as if the host hadn't wired outlook at all.
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { OUTLOOK_BROWSER_V2, PRINCIPAL_SKILL_ALLOWLIST } from '../../../shared/feature-flags';
import { logger } from '../../utils/logger';
import { outlookBrowserManager as outlookBrowserManagerV1 } from '../../services/outlook-browser/manager';
import { outlookBrowserManagerV2 } from '../../services/outlook-browser-v2/manager';
import type {
  DraftEmailArgs,
  SendEmailArgs,
} from '../../services/outlook-browser/types';
import { parseJsonBody, sendJson } from '../route-utils';

// Same flag-gated swap as outlook-browser-ipc.ts. Both surfaces (IPC and
// host-API HTTP) point at the same singleton implementation, so the manager
// is shared across renderer + agent calls.
const outlookBrowserManager = OUTLOOK_BROWSER_V2 ? outlookBrowserManagerV2 : outlookBrowserManagerV1;

function asArray(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v.filter(Boolean) : [v].filter(Boolean);
}

function logSafeArgs(
  args: Partial<DraftEmailArgs> & { confirm?: boolean },
): Record<string, unknown> {
  return {
    subject: typeof args.subject === 'string' ? args.subject.slice(0, 120) : undefined,
    toCount: asArray(args.to).length,
    ccCount: asArray(args.cc).length,
    bccCount: asArray(args.bcc).length,
    bodyLength: typeof args.body === 'string' ? args.body.length : 0,
    confirm: args.confirm === true,
  };
}

function isOutlookEnabled(): boolean {
  return PRINCIPAL_SKILL_ALLOWLIST.has('outlook');
}

export async function handleOutlookRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (!url.pathname.startsWith('/api/outlook/')) return false;

  // Feature gate. When 'outlook' is not in the allowlist we behave as if
  // the route surface doesn't exist — same effect as never registering.
  if (!isOutlookEnabled()) {
    sendJson(res, 404, { success: false, error: 'outlook capability disabled' });
    return true;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { success: false, error: 'Method not allowed' });
    return true;
  }

  try {
    if (url.pathname === '/api/outlook/open') {
      const result = await outlookBrowserManager.open();
      logger.info(`[host-api outlook/open] status=${result.status}`);
      sendJson(res, 200, { success: true, data: result });
      return true;
    }

    if (url.pathname === '/api/outlook/read-inbox') {
      const body = await parseJsonBody<{ top?: number }>(req);
      const top =
        typeof body.top === 'number' && Number.isFinite(body.top) && body.top > 0
          ? Math.floor(body.top)
          : 10;
      const result = await outlookBrowserManager.readInbox(top);
      logger.info(
        `[host-api outlook/read-inbox] status=${result.status} top=${top} count=${result.messages?.length ?? 0}`,
      );
      sendJson(res, 200, { success: true, data: result });
      return true;
    }

    if (url.pathname === '/api/outlook/draft') {
      const body = await parseJsonBody<DraftEmailArgs>(req);
      logger.info(`[host-api outlook/draft] ${JSON.stringify(logSafeArgs(body))}`);
      const result = await outlookBrowserManager.draftEmail(body);
      logger.info(`[host-api outlook/draft] result=${result.status}`);
      sendJson(res, 200, { success: true, data: result });
      return true;
    }

    if (url.pathname === '/api/outlook/send') {
      const body = await parseJsonBody<SendEmailArgs>(req);
      // Manager has the hard gate; we don't pre-check confirm here.
      logger.info(`[host-api outlook/send] attempt ${JSON.stringify(logSafeArgs(body))}`);
      const result = await outlookBrowserManager.sendEmail(body);
      logger.info(`[host-api outlook/send] result=${result.status}`);
      sendJson(res, 200, { success: true, data: result });
      return true;
    }

    return false;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`[host-api outlook] ${url.pathname} failed: ${message}`);
    sendJson(res, 500, { success: false, error: message });
    return true;
  }
}
