/**
 * IPC bridge for the outlook-browser service.
 *
 * Channels (request/response, return the manager's native result shape so
 * renderer callers can treat them like the existing OutlookBrowserSection
 * test-connection flow does):
 *   outlook:open         → OutlookOpenResult
 *   outlook:readInbox    → ReadInboxResult        args: { top?: number }
 *   outlook:draft        → DraftEmailResult       args: DraftEmailArgs
 *   outlook:send         → SendEmailResult        args: SendEmailArgs
 *
 * Errors thrown by the manager surface as IPC rejections to the renderer
 * (caught by `invokeIpc` and turned into AppError objects).
 *
 * Hard rules preserved here (the manager re-checks them, but we never
 * bypass them):
 *  - outlook:send NEVER bypasses the manager's confirm-flag gate. We pass
 *    args through unchanged and let the manager refuse without confirm.
 *  - We log subject + recipient counts only — never message bodies, never
 *    full To/Cc/Bcc lists.
 *  - We always go through the singleton manager which is hard-wired to
 *    profile='user'. Managed-Chromium would be blocked by Conditional Access.
 */
import { ipcMain } from 'electron';
import { logger } from '../utils/logger';
import { OUTLOOK_BROWSER_V2 } from '../../shared/feature-flags';
import { outlookBrowserManager as outlookBrowserManagerV1 } from '../services/outlook-browser/manager';
import { outlookBrowserManagerV2 } from '../services/outlook-browser-v2/manager';
import type {
  DraftEmailArgs,
  SendEmailArgs,
} from '../services/outlook-browser/types';

/**
 * Pick implementation at module load time. CLAWX_OUTLOOK_V2=1 selects the
 * Playwright + Sonnet 4.5 vision grounder; default keeps v1 (hand-rolled
 * selectors via the openclaw browser plugin) so existing pilots don't see
 * a behaviour change without an explicit opt-in.
 */
const outlookBrowserManager = OUTLOOK_BROWSER_V2 ? outlookBrowserManagerV2 : outlookBrowserManagerV1;
if (OUTLOOK_BROWSER_V2) {
  logger.info('[outlook-ipc] OUTLOOK_BROWSER_V2 enabled — using Playwright/Sonnet manager');
}

function asArray(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v.filter(Boolean) : [v].filter(Boolean);
}

/**
 * Build a privacy-safe summary for logs. Subjects + recipient counts only.
 * Never the body, never raw addresses.
 */
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

export function registerOutlookBrowserHandlers(): void {
  ipcMain.handle('outlook:open', async () => {
    const result = await outlookBrowserManager.open();
    logger.info(`[outlook:open] status=${result.status}`);
    return result;
  });

  ipcMain.handle('outlook:readInbox', async (_event, args?: { top?: number }) => {
    const top =
      typeof args?.top === 'number' && Number.isFinite(args.top) && args.top > 0
        ? Math.floor(args.top)
        : 10;
    const result = await outlookBrowserManager.readInbox(top);
    logger.info(
      `[outlook:readInbox] status=${result.status} top=${top} count=${result.messages?.length ?? 0}`,
    );
    return result;
  });

  ipcMain.handle('outlook:draft', async (_event, args: DraftEmailArgs) => {
    // Subjects + counts only — bodies must never appear in logs.
    logger.info(`[outlook:draft] ${JSON.stringify(logSafeArgs(args))}`);
    const result = await outlookBrowserManager.draftEmail(args);
    logger.info(`[outlook:draft] result=${result.status}`);
    return result;
  });

  ipcMain.handle('outlook:send', async (_event, args: SendEmailArgs) => {
    // We deliberately do NOT enforce confirm here — the manager has the
    // hard gate. Doing it twice risks drift. We do, however, log that we
    // saw a send attempt (with confirm value) so audit trails capture it.
    logger.info(`[outlook:send] attempt ${JSON.stringify(logSafeArgs(args))}`);
    const result = await outlookBrowserManager.sendEmail(args);
    logger.info(`[outlook:send] result=${result.status}`);
    return result;
  });
}
