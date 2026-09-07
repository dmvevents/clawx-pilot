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
  isGraphMessageId,
  isGraphOutlookAvailable,
  readEmailWithGraph,
  readInboxWithGraph,
  searchInboxWithGraph,
  sendEmailWithGraph,
} from '../../services/microsoft-graph/outlook-adapter';
import { getMicrosoftGraphConfig } from '../../services/microsoft-graph/store';
import { getStatus as getMicrosoftGraphStatus } from '../../services/microsoft-graph/manager';
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

// The extended surface (search/read-email/reply/forward/mark-read/attachments)
// only exists on the v2 driver. On the legacy v1 path these endpoints have
// always failed (method missing -> caught -> 500); keep that behavior but make
// the failure explicit instead of a TypeError.
function requireV2Manager(op: string): typeof outlookBrowserManagerV2 {
  if (!OUTLOOK_BROWSER_V2) {
    throw new Error(`outlook ${op} requires the v2 browser driver (CLAWX_OUTLOOK_V2=0 active)`);
  }
  return outlookBrowserManagerV2;
}

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

// Config-based transport enablement (contract C2): the persisted Graph config
// carries graphOutlookRead / graphOutlookCompose booleans that Settings
// toggles write. The env vars stay as operator overrides.
async function isGraphOutlookFlagConfigured(
  flag: 'graphOutlookRead' | 'graphOutlookCompose',
): Promise<boolean> {
  try {
    const cfg = await getMicrosoftGraphConfig();
    return cfg?.[flag] === true;
  } catch (error) {
    logger.debug(
      `[host-api outlook] Graph config read failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

async function shouldUseGraphOutlookRead(): Promise<boolean> {
  const enabled =
    process.env.CLAWX_GRAPH_OUTLOOK_READ === '1' ||
    (await isGraphOutlookFlagConfigured('graphOutlookRead'));
  if (!enabled) {
    return false;
  }
  return isGraphAvailableForOutlook();
}

async function shouldUseGraphOutlookCompose(): Promise<boolean> {
  const enabled =
    process.env.CLAWX_GRAPH_OUTLOOK_COMPOSE === '1' ||
    (await isGraphOutlookFlagConfigured('graphOutlookCompose'));
  if (!enabled) {
    return false;
  }
  return isGraphAvailableForOutlook();
}

// Compose via Graph additionally requires the Mail.Send delegated scope
// (contract C1). When the compose lane is enabled but the tenant grant is
// read-only we refuse loudly with the adapter's structured refused shape
// (contract C4) instead of a raw 500 or a silent browser fallback — silent
// fallback would hide the misconfiguration from the operator.
const GRAPH_COMPOSE_READ_ONLY_REASON =
  'Your Microsoft 365 connection is read-only, so email cannot be drafted or sent through the Microsoft cloud. ' +
  'Ask your IT administrator to allow sending for this app, or compose the email in the Outlook window instead.';

// Entra returns scopes in bare form ("Mail.Send") on some flows and
// resource-qualified form ("https://graph.microsoft.com/Mail.Send") on
// others; compare against both so a qualified grant is never mis-read as
// read-only.
function grantIncludesScope(grantedScopes: string[], scope: string): boolean {
  const want = scope.toLowerCase();
  return grantedScopes.some((entry) => {
    const bare = entry.toLowerCase().replace(/^https:\/\/graph\.microsoft\.com\//, '');
    return bare === want;
  });
}

async function refuseGraphComposeWithoutSendScope(
  route: string,
): Promise<{ status: 'refused'; reason: string } | null> {
  let grantedScopes: string[] = [];
  try {
    const status = await getMicrosoftGraphStatus();
    if (status.mockMailbox) {
      // Explicit demo mock: the adapter's mock layer handles compose without
      // touching Graph, so the real tenant's scope grant is irrelevant here.
      return null;
    }
    grantedScopes = status.grantedScopes;
  } catch (error) {
    logger.debug(
      `[host-api outlook] Graph status check failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (grantIncludesScope(grantedScopes, 'Mail.Send')) {
    return null;
  }
  logger.warn(
    `[host-api outlook/${route}] Graph compose enabled but Mail.Send scope not granted; refusing`,
  );
  return { status: 'refused', reason: GRAPH_COMPOSE_READ_ONLY_REASON };
}

// The reply/forward/mark-read/attachment actions run only in the browser
// lane, whose message ids are DOM fingerprints. A graph:-prefixed id from
// the Graph read lane can never match one — scrolling the inbox hunting for
// it fails slowly and opaquely, so refuse it loudly instead (contract C4).
const GRAPH_ID_BROWSER_OP_REASON =
  'This message was read through the Microsoft cloud, and this action runs in the Outlook window, ' +
  'which uses a different message reference. Read the inbox again with cloud reading turned off in ' +
  'Settings, then retry this action on the freshly listed message.';

function refuseBrowserOpOnGraphId(
  id: unknown,
  route: string,
): { status: 'refused'; reason: string } | null {
  if (typeof id !== 'string' || !isGraphMessageId(id)) {
    return null;
  }
  logger.warn(`[host-api outlook/${route}] browser-lane action refused for Graph message id`);
  return { status: 'refused', reason: GRAPH_ID_BROWSER_OP_REASON };
}

export async function handleOutlookRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  // CLWX-86 drift-guard convention: endpoints in this family must dispatch
  // via single-quoted url.pathname equality literals - the inventory guard in
  // tests/unit/host-api-capabilities-route.test.ts parses exactly that shape.
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
      if (graphAvailable) {
        const refusal = await refuseGraphComposeWithoutSendScope('draft');
        if (refusal) {
          sendJson(res, 200, { success: true, data: refusal });
          return true;
        }
      }
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
      if (graphAvailable) {
        const refusal = await refuseGraphComposeWithoutSendScope('send');
        if (refusal) {
          sendJson(res, 200, { success: true, data: refusal });
          return true;
        }
      }
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
        : await requireV2Manager('search-inbox').searchInbox(body);
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
        : await requireV2Manager('read-email').readEmail(body);
      logger.info(
        `[host-api outlook/read-email] transport=${graphAvailable ? 'graph' : 'browser'} status=${result.status} bodyLen=${result.body?.length ?? 0} attachments=${result.attachments?.length ?? 0}`,
      );
      sendJson(res, 200, { success: true, data: result });
      return true;
    }

    if (url.pathname === '/api/outlook/reply') {
      const body = await parseJsonBody<ReplyArgs>(req);
      logger.info(`[host-api outlook/reply] ${JSON.stringify({ id: body.id, replyAll: !!body.replyAll, bodyLen: body.body?.length ?? 0 })}`);
      const graphIdRefusal = refuseBrowserOpOnGraphId(body.id, 'reply');
      if (graphIdRefusal) {
        sendJson(res, 200, { success: true, data: graphIdRefusal });
        return true;
      }
      const result = await requireV2Manager('reply').reply(body);
      logger.info(`[host-api outlook/reply] result=${result.status}`);
      sendJson(res, 200, { success: true, data: result });
      return true;
    }

    if (url.pathname === '/api/outlook/forward') {
      const body = await parseJsonBody<ForwardArgs>(req);
      logger.info(`[host-api outlook/forward] ${JSON.stringify({ id: body.id, toCount: asArray(body.to).length })}`);
      const graphIdRefusal = refuseBrowserOpOnGraphId(body.id, 'forward');
      if (graphIdRefusal) {
        sendJson(res, 200, { success: true, data: graphIdRefusal });
        return true;
      }
      const result = await requireV2Manager('forward').forward(body);
      logger.info(`[host-api outlook/forward] result=${result.status}`);
      sendJson(res, 200, { success: true, data: result });
      return true;
    }

    if (url.pathname === '/api/outlook/mark-read') {
      const body = await parseJsonBody<MarkReadArgs>(req);
      const graphIdRefusal = refuseBrowserOpOnGraphId(body.id, 'mark-read');
      if (graphIdRefusal) {
        sendJson(res, 200, { success: true, data: graphIdRefusal });
        return true;
      }
      const result = await requireV2Manager('mark-read').markRead(body);
      logger.info(`[host-api outlook/mark-read] id=${body.id} read=${body.read} status=${result.status}`);
      sendJson(res, 200, { success: true, data: result });
      return true;
    }

    if (url.pathname === '/api/outlook/list-attachments') {
      const body = await parseJsonBody<ListAttachmentsArgs>(req);
      const graphIdRefusal = refuseBrowserOpOnGraphId(body.id, 'list-attachments');
      if (graphIdRefusal) {
        sendJson(res, 200, { success: true, data: graphIdRefusal });
        return true;
      }
      const result = await requireV2Manager('list-attachments').listAttachments(body);
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
      const graphIdRefusal = refuseBrowserOpOnGraphId(body.id, 'download-attachment');
      if (graphIdRefusal) {
        sendJson(res, 200, { success: true, data: graphIdRefusal });
        return true;
      }
      const result = await requireV2Manager('download-attachment').downloadAttachment(body);
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
