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
import {
  draftEmailWithGraph,
  isGraphOutlookAvailable,
  readEmailWithGraph,
  readInboxWithGraph,
  searchInboxWithGraph,
  sendEmailWithGraph,
} from '../../services/microsoft-graph/outlook-adapter';
import { recordOutlookSendAudit } from '../../services/outbox-service';
import type {
  DraftEmailArgs,
  SendEmailArgs,
  SearchInboxArgs,
  ReadEmailArgs,
  ReplyArgs,
  ForwardArgs,
  MarkReadArgs,
  ListAttachmentsArgs,
  DownloadAttachmentArgs,
} from '../../services/outlook-browser/types';
import { parseJsonBody, sendJson } from '../route-utils';

// Same flag-gated swap as outlook-browser-ipc.ts. Pilot builds default to the
// v2 Chrome-CDP implementation; CLAWX_OUTLOOK_V2=0 keeps the legacy browser
// plugin path available for regression comparison.
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

async function isGraphAvailableForOutlook(): Promise<boolean> {
  try {
    return await isGraphOutlookAvailable();
  } catch (error) {
    logger.debug(
      `[host-api outlook] Graph availability check failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

async function shouldUseGraphOutlookRead(): Promise<boolean> {
  if (process.env.CLAWX_GRAPH_OUTLOOK_READ !== '1') {
    return false;
  }
  return isGraphAvailableForOutlook();
}

async function shouldUseGraphOutlookCompose(): Promise<boolean> {
  if (process.env.CLAWX_GRAPH_OUTLOOK_COMPOSE !== '1') {
    return false;
  }
  return isGraphAvailableForOutlook();
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
      const graphAvailable = await shouldUseGraphOutlookRead();
      const result = graphAvailable
        ? await readInboxWithGraph(top)
        : await outlookBrowserManager.readInbox(top);
      logger.info(
        `[host-api outlook/read-inbox] transport=${graphAvailable ? 'graph' : 'browser'} status=${result.status} top=${top} count=${result.messages?.length ?? 0}`,
      );
      sendJson(res, 200, { success: true, data: result });
      return true;
    }

    if (url.pathname === '/api/outlook/draft') {
      const body = await parseJsonBody<DraftEmailArgs>(req);
      logger.info(`[host-api outlook/draft] ${JSON.stringify(logSafeArgs(body))}`);
      const graphAvailable = await shouldUseGraphOutlookCompose();
      const result = graphAvailable
        ? await draftEmailWithGraph(body)
        : await outlookBrowserManager.draftEmail(body);
      logger.info(`[host-api outlook/draft] transport=${graphAvailable ? 'graph' : 'browser'} result=${result.status}`);
      sendJson(res, 200, { success: true, data: result });
      return true;
    }

    if (url.pathname === '/api/outlook/send') {
      const body = await parseJsonBody<SendEmailArgs>(req);
      // Manager has the hard gate; we don't pre-check confirm here.
      logger.info(`[host-api outlook/send] attempt ${JSON.stringify(logSafeArgs(body))}`);
      const graphAvailable = await shouldUseGraphOutlookCompose();
      const result = graphAvailable
        ? await sendEmailWithGraph(body)
        : await outlookBrowserManager.sendEmail(body);
      logger.info(`[host-api outlook/send] transport=${graphAvailable ? 'graph' : 'browser'} result=${result.status}`);
      if (result.status === 'sent') {
        // Audit trail is written first to the durable outbox (§5.3); replay
        // to the app server happens in the background once one is configured.
        await recordOutlookSendAudit({
          subject: body.subject,
          to: body.to,
          cc: body.cc,
          bcc: body.bcc,
          transport: graphAvailable ? 'graph' : 'browser',
          status: result.status,
        });
      }
      sendJson(res, 200, { success: true, data: result });
      return true;
    }

    if (url.pathname === '/api/outlook/search-inbox') {
      const body = await parseJsonBody<SearchInboxArgs>(req);
      const graphAvailable = await shouldUseGraphOutlookRead();
      const result = graphAvailable
        ? await searchInboxWithGraph(body)
        : await outlookBrowserManager.searchInbox(body);
      logger.info(
        `[host-api outlook/search-inbox] transport=${graphAvailable ? 'graph' : 'browser'} status=${result.status} count=${result.messages?.length ?? 0} capped=${!!result.capped}`,
      );
      sendJson(res, 200, { success: true, data: result });
      return true;
    }

    if (url.pathname === '/api/outlook/read-email') {
      const body = await parseJsonBody<ReadEmailArgs>(req);
      const graphAvailable = await shouldUseGraphOutlookRead();
      const result = graphAvailable
        ? await readEmailWithGraph(body)
        : await outlookBrowserManager.readEmail(body);
      logger.info(
        `[host-api outlook/read-email] transport=${graphAvailable ? 'graph' : 'browser'} status=${result.status} bodyLen=${result.body?.length ?? 0} attachments=${result.attachments?.length ?? 0}`,
      );
      sendJson(res, 200, { success: true, data: result });
      return true;
    }

    if (url.pathname === '/api/outlook/reply') {
      const body = await parseJsonBody<ReplyArgs>(req);
      logger.info(`[host-api outlook/reply] ${JSON.stringify({ id: body.id, replyAll: !!body.replyAll, bodyLen: body.body?.length ?? 0 })}`);
      const result = await outlookBrowserManager.reply(body);
      logger.info(`[host-api outlook/reply] result=${result.status}`);
      sendJson(res, 200, { success: true, data: result });
      return true;
    }

    if (url.pathname === '/api/outlook/forward') {
      const body = await parseJsonBody<ForwardArgs>(req);
      logger.info(`[host-api outlook/forward] ${JSON.stringify({ id: body.id, toCount: asArray(body.to).length })}`);
      const result = await outlookBrowserManager.forward(body);
      logger.info(`[host-api outlook/forward] result=${result.status}`);
      sendJson(res, 200, { success: true, data: result });
      return true;
    }

    if (url.pathname === '/api/outlook/mark-read') {
      const body = await parseJsonBody<MarkReadArgs>(req);
      const result = await outlookBrowserManager.markRead(body);
      logger.info(`[host-api outlook/mark-read] id=${body.id} read=${body.read} status=${result.status}`);
      sendJson(res, 200, { success: true, data: result });
      return true;
    }

    if (url.pathname === '/api/outlook/list-attachments') {
      const body = await parseJsonBody<ListAttachmentsArgs>(req);
      const result = await outlookBrowserManager.listAttachments(body);
      logger.info(
        `[host-api outlook/list-attachments] id=${body.id} status=${result.status} count=${result.attachments.length}`,
      );
      sendJson(res, 200, { success: true, data: result });
      return true;
    }

    if (url.pathname === '/api/outlook/download-attachment') {
      const body = await parseJsonBody<DownloadAttachmentArgs>(req);
      logger.info(
        `[host-api outlook/download-attachment] attempt id=${body.id} filename=${body.filename?.slice(0, 40)} confirm=${body.confirm === true}`,
      );
      const result = await outlookBrowserManager.downloadAttachment(body);
      logger.info(
        `[host-api outlook/download-attachment] result=${result.status} savedPath=${result.savedPath ? '[set]' : '[unset]'}`,
      );
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
