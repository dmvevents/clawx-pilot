/**
 * Host-API routes for the forms-browser service.
 *
 * Exposes the FormsBrowserManager singleton over the auth-token-gated host-API
 * so the moe-principal-assistant gateway plugin can call it.
 *
 * Endpoints (all return JSON; allowlist-gated by PRINCIPAL_SKILL_ALLOWLIST):
 *   POST /api/forms/list                 -> { forms: [...] }
 *   POST /api/forms/preview-daily-report -> { status, filledCount, skippedCount, errors }
 *   POST /api/forms/submit-daily-report  -> SubmitResult, body: { confirm: boolean }
 *   POST /api/forms/preview-suspension   -> { status, filledCount, skippedCount, errors }
 *   POST /api/forms/submit-suspension    -> SubmitResult, body: { confirm: boolean }
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
import type { DailyReportPayload } from '../../services/forms-browser-v2/daily-report-actions';
import type { SuspensionsPayload } from '../../services/forms-browser-v2/suspensions-actions';
import { parseJsonBody, sendJson } from '../route-utils';
import { recordFormSubmitAudit } from '../../services/outbox-service';

function isFormsEnabled(): boolean {
  return PRINCIPAL_SKILL_ALLOWLIST.has('forms');
}

export async function handleFormsRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  // CLWX-86 drift-guard convention: endpoints in this family must dispatch
  // via single-quoted url.pathname equality literals - the inventory guard in
  // tests/unit/host-api-capabilities-route.test.ts parses exactly that shape.
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

    if (url.pathname === '/api/forms/preview-daily-report') {
      const body = await parseJsonBody<{ payload: DailyReportPayload }>(req);
      if (!body?.payload) {
        sendJson(res, 400, { success: false, error: 'payload required' });
        return true;
      }
      const result = await formsBrowserManagerV2.previewDailyReport(body.payload);
      logger.info(`[host-api forms/preview-daily-report] status=${result.status}`);
      sendJson(res, 200, { success: true, data: result });
      return true;
    }

    if (url.pathname === '/api/forms/submit-daily-report') {
      const body = await parseJsonBody<{ confirm?: boolean }>(req);
      const confirm = body?.confirm === true;
      logger.info(`[host-api forms/submit-daily-report] attempt confirm=${confirm}`);
      const result = await formsBrowserManagerV2.submitDailyReport({ confirm });
      logger.info(`[host-api forms/submit-daily-report] result=${result.status}`);
      if (result.status === 'submitted') {
        // Audit trail written first to the durable outbox (§5.3): the record
        // of a confirmed submission must survive offline/crash until replay.
        await recordFormSubmitAudit({ form: 'daily-report', status: result.status });
      }
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
      if (result.status === 'submitted') {
        await recordFormSubmitAudit({ form: 'suspension', status: result.status });
      }
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
