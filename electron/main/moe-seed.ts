/**
 * One-shot seed for the MoE principal-assistant deployment.
 *
 * Two responsibilities:
 *   1. moe:seed-cron — create a default 3:30pm-weekday cron job that opens a
 *      session with the daily-report end-of-day brief. Idempotent: re-running
 *      finds and updates the existing job by name.
 *   2. moe:set-form-urls — persist the daily-report and suspension form URLs
 *      into the moe-form-filler store so the agent knows where to navigate.
 *
 * Also wires a "desktop notification" listener that surfaces native OS toasts
 * when a cron's agentTurn fires. The default cron in this seed uses a
 * recognisable name ("MoE Daily Report 3:30pm reminder") so we can trigger a
 * Notification specifically for it without spamming users with toasts for
 * every gateway event.
 */
import { ipcMain, Notification } from 'electron';
import { logger } from '../utils/logger';
import { setFormUrls } from '../services/moe-form-filler/store';
import { reminderSchedule } from '../utils/cron-tz';
import type { GatewayManager } from '../gateway/manager';

const REMINDER_JOB_NAME = 'MoE Daily Report 3:30pm reminder';
const REMINDER_MESSAGE =
  'Daily Report end-of-day briefing.\n\nIt is 3:30pm. The Primary School Daily Report (Term 3) is due by 3:45pm.\n\nDictate or type today\'s numbers (teachers, pupils, NSDSL meals, discipline, transport) and I will fill the form for review before submitting.';

interface CronJobShape {
  id?: string;
  name?: string;
  enabled?: boolean;
  schedule?: { kind?: string; expr?: string; tz?: string };
}

async function findReminderJob(gatewayManager: GatewayManager): Promise<CronJobShape | null> {
  try {
    const result = await gatewayManager.rpc('cron.list', {});
    const jobs = (Array.isArray(result) ? result : (result as { jobs?: unknown[] } | null)?.jobs) ?? [];
    return (jobs as CronJobShape[]).find((j) => j?.name === REMINDER_JOB_NAME) ?? null;
  } catch (err) {
    logger.warn(`[moe-seed] cron.list failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export function registerMoeSeedHandlers(gatewayManager: GatewayManager): void {
  ipcMain.handle('moe:seed-cron', async () => {
    try {
      const existing = await findReminderJob(gatewayManager);
      if (existing) {
        // Repair already-seeded fleet jobs (CLWX-99): without schedule.tz the
        // gateway resolves the expr in its own cached zone, not the
        // principal's clock. Found-by-name idempotency would otherwise never
        // deliver the tz to existing installs.
        if (existing.id && existing.schedule?.kind === 'cron' && !existing.schedule.tz) {
          try {
            await gatewayManager.rpc('cron.update', {
              id: existing.id,
              patch: { schedule: reminderSchedule() },
            });
            return { ok: true, data: { id: existing.id, created: false, repairedTz: true } };
          } catch (err) {
            logger.warn(`[moe-seed] reminder tz repair failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        return { ok: true, data: { id: existing.id, created: false } };
      }
      const result = await gatewayManager.rpc('cron.add', {
        name: REMINDER_JOB_NAME,
        schedule: reminderSchedule(),
        payload: { kind: 'agentTurn', message: REMINDER_MESSAGE },
        enabled: true,
        wakeMode: 'next-heartbeat',
        sessionTarget: 'isolated',
        delivery: { mode: 'none', channel: '' },
      });
      return { ok: true, data: { id: (result as CronJobShape | null)?.id, created: true } };
    } catch (err) {
      return {
        ok: false,
        error: { code: 'SEED_FAILED', message: err instanceof Error ? err.message : String(err) },
      };
    }
  });

  ipcMain.handle(
    'moe:set-form-urls',
    async (_event, urls: { dailyReport?: string; suspension?: string }) => {
      try {
        await setFormUrls(urls ?? {});
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: { code: 'SAVE_FAILED', message: err instanceof Error ? err.message : String(err) },
        };
      }
    },
  );

  // Surface a desktop Notification whenever the daily-report reminder fires.
  // The gateway publishes cron-fired agent turns via the regular chat:message
  // stream; we sniff for messages whose origin matches the reminder job name.
  gatewayManager.on('chat:message', (data: unknown) => {
    if (!Notification.isSupported()) return;
    const msg = data as { meta?: { cron?: { name?: string } } } | null;
    const cronName = msg?.meta?.cron?.name;
    if (cronName !== REMINDER_JOB_NAME) return;
    try {
      new Notification({
        title: 'Daily Report due at 3:45pm',
        body: 'Open Ministry of Education to dictate today\'s numbers; the agent will fill and review before submitting.',
        urgency: 'normal',
      }).show();
    } catch (err) {
      logger.warn(`[moe-seed] notification failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}
