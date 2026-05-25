/**
 * Host-API routes for the forms-browser service.
 *
 * Exposes the FormsBrowserManager singleton over the auth-token-gated host-API
 * so the moe-principal-assistant gateway plugin can call it.
 *
 * Endpoints (all return JSON; allowlist-gated by PRINCIPAL_SKILL_ALLOWLIST):
 *   POST /api/forms/list                 → { forms: [...] }
 *   POST /api/forms/preview-suspension   → { status, filledCount, skippedCount, errors }
 *   POST /api/forms/submit-suspension    → SubmitResult, body: { confirm: boolean }
 *
 * Hard rules:
 *  - Submit endpoint delegates straight to the manager which holds the
 *    confirm-flag gate. The route never bypasses it.
 *  - We never log the payload body — these contain student names, parent phone
 *    numbers, addresses. Log only field counts and error reasons.
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { PRINCIPAL_SKILL_ALLOWLIST } from '../../../shared/feature-flags';
import { logger } from '../../utils/logger';
import { formsBrowserManagerV2 } from '../../services/forms-browser-v2/manager';
import type { SuspensionsPayload } from '../../services/forms-browser-v2/suspensions-actions';
import { parseJsonBody, sendJson } from '../route-utils';

function isFormsEnabled(): boolean {
  return PRINCIPAL_SKILL_ALLOWLIST.has('forms');
}

export async function handleFormsRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (!url.pathname.startsWith('/api/forms/')) return false;

  if (!isFormsEnabled()) {
    sendJson(res, 404, { success: false, error: 'forms capability disabled' });
    return true;
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { success: false, error: 'Method not allowed' });
    return true;
  }

  try {
    if (url.pathname === '/api/forms/list') {
      const result = await formsBrowserManagerV2.listSupportedForms();
      sendJson(res, 200, { success: true, data: result });
      return true;
    }

    if (url.pathname === '/api/forms/preview-suspension') {
      const body = await parseJsonBody<{ payload: SuspensionsPayload }>(req);
      if (!body?.payload) {
        sendJson(res, 400, { success: false, error: 'payload required' });
        return true;
      }
      const result = await formsBrowserManagerV2.previewSuspension(body.payload);
      logger.info(`[host-api forms/preview-suspension] status=${result.status}`);
      sendJson(res, 200, { success: true, data: result });
      return true;
    }

    if (url.pathname === '/api/forms/submit-suspension') {
      const body = await parseJsonBody<{ confirm?: boolean }>(req);
      const confirm = body?.confirm === true;
      logger.info(`[host-api forms/submit-suspension] attempt confirm=${confirm}`);
      const result = await formsBrowserManagerV2.submitSuspension({ confirm });
      logger.info(`[host-api forms/submit-suspension] result=${result.status}`);
      sendJson(res, 200, { success: true, data: result });
      return true;
    }

    sendJson(res, 404, { success: false, error: 'Unknown forms endpoint' });
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[host-api forms] error: ${msg}`);
    sendJson(res, 500, { success: false, error: msg });
    return true;
  }
}
