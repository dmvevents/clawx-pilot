import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { generateHostApiToken } from './host-api-token';
import { getPort } from '../utils/config';
import { logger } from '../utils/logger';
import { extensionRegistry } from '../extensions/registry';
import type { HostApiContext } from './context';
import { handleAppRoutes } from './routes/app';
import { handleGatewayRoutes } from './routes/gateway';
import { handleSettingsRoutes } from './routes/settings';
import { handleProviderRoutes } from './routes/providers';
import { handleAgentRoutes } from './routes/agents';
import { handleChannelRoutes } from './routes/channels';
import { handleLogRoutes } from './routes/logs';
import { handleUsageRoutes } from './routes/usage';
import { handleSkillRoutes } from './routes/skills';
import { handleFileRoutes } from './routes/files';
import { handleSessionRoutes } from './routes/sessions';
import { handleCronRoutes } from './routes/cron';
import { handleDiagnosticsRoutes } from './routes/diagnostics';
import { handleBrowserRoutes } from './routes/browser';
import { handleCapabilitiesRoutes } from './routes/capabilities';
import { handleOutlookRoutes } from './routes/outlook';
import { handleFormsRoutes } from './routes/forms';
import { sendJson, setCorsHeaders, requireJsonContentType } from './route-utils';

type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
) => Promise<boolean>;

const coreRouteHandlers: RouteHandler[] = [
  handleAppRoutes,
  handleGatewayRoutes,
  handleSettingsRoutes,
  handleProviderRoutes,
  handleAgentRoutes,
  handleChannelRoutes,
  handleSkillRoutes,
  handleFileRoutes,
  handleSessionRoutes,
  handleCronRoutes,
  handleDiagnosticsRoutes,
  handleLogRoutes,
  handleUsageRoutes,
  // CLWX-86: capability handshake — the gateway plugin probes this once at
  // registration to detect tool<->host-API version skew.
  (req, res, url) => handleCapabilitiesRoutes(req, res, url),
  // Browser automation diagnostics/repair shared by Outlook and Forms.
  (req, res, url) => handleBrowserRoutes(req, res, url),
  // Outlook (browser-session) routes for the moe-principal-assistant plugin
  // running inside the OpenClaw gateway. Allowlist-gated inside the handler.
  (req, res, url) => handleOutlookRoutes(req, res, url),
  // Forms (browser-session) routes — same pattern as outlook. Allowlist-gated.
  (req, res) => handleFormsRoutes(req, res),
];

function buildRouteHandlers(): RouteHandler[] {
  const extensionHandlers = extensionRegistry.getRouteHandlers();
  return [...coreRouteHandlers, ...extensionHandlers];
}

// Token storage moved to ./host-api-token.ts so other modules (e.g.
// gateway/config-sync) can read the token without importing the entire
// host-API server file (and its full route-handler dependency chain).
// Re-export here so existing callers (ipc/host-api-proxy.ts) keep working.
export { getHostApiToken } from './host-api-token';

export function startHostApiServer(ctx: HostApiContext, port = getPort('CLAWX_HOST_API')): Server {
  // Generate a cryptographically random token for this session.
  const hostApiToken = generateHostApiToken();

  const server = createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url || '/', `http://127.0.0.1:${port}`);
      // ── CORS headers ─────────────────────────────────────────
      // Set origin-aware CORS headers early so every response
      // (including error responses) carries them consistently.
      const origin = req.headers.origin;
      setCorsHeaders(res, origin);

      // CORS preflight — respond before auth so browsers can negotiate.
      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
      }

      // ── Auth gate ──────────────────────────────────────────────
      // Every non-preflight request must carry a valid Bearer token.
      // Accept via Authorization header (preferred) or ?token= query
      // parameter (for EventSource which cannot set custom headers).
      const authHeader = req.headers.authorization || '';
      const bearerToken = authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : (requestUrl.searchParams.get('token') || '');
      if (bearerToken !== hostApiToken) {
        sendJson(res, 401, { success: false, error: 'Unauthorized' });
        return;
      }

      // ── Content-Type gate (anti-CSRF) ──────────────────────────
      // Mutation requests must use application/json to force a CORS
      // preflight, preventing "simple request" CSRF attacks.
      if (!requireJsonContentType(req)) {
        sendJson(res, 415, { success: false, error: 'Content-Type must be application/json' });
        return;
      }

      const routeHandlers = buildRouteHandlers();
      for (const handler of routeHandlers) {
        if (await handler(req, res, requestUrl, ctx)) {
          return;
        }
      }
      sendJson(res, 404, { success: false, error: `No route for ${req.method} ${requestUrl.pathname}` });
    } catch (error) {
      logger.error('Host API request failed:', error);
      sendJson(res, 500, { success: false, error: String(error) });
    }
  });

  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EACCES' || error.code === 'EADDRINUSE') {
      logger.error(
        `Host API server failed to bind port ${port}: ${error.message}. ` +
        'On Windows this is often caused by Hyper-V reserving the port range. ' +
        `Set CLAWX_PORT_CLAWX_HOST_API env var to override the default port.`,
      );
    } else {
      logger.error('Host API server error:', error);
    }
  });

  server.listen(port, '127.0.0.1', () => {
    logger.info(`Host API server listening on http://127.0.0.1:${port}`);
  });

  return server;
}
