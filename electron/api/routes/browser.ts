import type { IncomingMessage, ServerResponse } from 'http';
import { diagnoseChromeCdp, ensureChromeCdpReady } from '../../services/chrome-cdp';
import { logger } from '../../utils/logger';
import { sendJson } from '../route-utils';

export async function handleBrowserRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (!url.pathname.startsWith('/api/browser/')) return false;
  if (req.method !== 'POST') {
    sendJson(res, 405, { success: false, error: 'Method not allowed' });
    return true;
  }

  try {
    if (url.pathname === '/api/browser/diagnose') {
      const result = await diagnoseChromeCdp();
      logger.info(`[host-api browser/diagnose] state=${result.state} action=${result.action}`);
      sendJson(res, 200, { success: true, data: result });
      return true;
    }

    if (url.pathname === '/api/browser/repair-chrome-cdp') {
      const result = await ensureChromeCdpReady();
      logger.info(`[host-api browser/repair-chrome-cdp] state=${result.state} action=${result.action}`);
      sendJson(res, 200, { success: true, data: result });
      return true;
    }

    sendJson(res, 404, { success: false, error: 'Unknown browser endpoint' });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`[host-api browser] ${url.pathname} failed: ${message}`);
    sendJson(res, 500, { success: false, error: message });
    return true;
  }
}
