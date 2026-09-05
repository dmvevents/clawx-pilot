/**
 * Timezone handling for cron schedules (CLWX-99).
 *
 * The gateway resolves a cron expr's timezone from `schedule.tz` when present,
 * otherwise from the timezone its OWN process cached at first use — which is
 * not reliably the principal's clock (observed live: gateway stuck on the
 * pre-change zone after a system timezone change, pushing a nextRun a full
 * year out). Every creation surface must therefore pin `schedule.tz` at
 * creation time.
 *
 * `kind: "at"` timestamps are a separate class: the gateway appends "Z" to
 * zone-less ISO strings (naive = UTC; `tz` is never consulted), so writers of
 * one-off schedules must carry an explicit UTC offset. The agent-side rule
 * for that lives in the moe-principal-assistant persona.
 */
import { readlinkSync } from 'node:fs';

function isValidIanaZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The system IANA timezone, read fresh per call.
 *
 * `Intl.DateTimeFormat().resolvedOptions().timeZone` is cached for the
 * lifetime of the process, so a long-running Electron main would keep serving
 * a stale zone after the OS timezone changes. On macOS/Linux the
 * /etc/localtime symlink is the live OS truth; Windows (no symlink) falls
 * back to Intl, which is still creation-time-in-main — strictly fresher than
 * the gateway's boot-time cache the fix replaces.
 */
export function systemTimeZone(): string {
  if (process.platform !== 'win32') {
    try {
      const target = readlinkSync('/etc/localtime');
      const match = target.match(/zoneinfo\/(.+)$/);
      if (match?.[1] && isValidIanaZone(match[1])) return match[1];
    } catch {
      // not a symlink / unreadable — fall through to Intl
    }
  }
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export interface CronScheduleWithTz {
  kind: 'cron';
  expr: string;
  tz: string;
}

/** The schedule shape every app-side creation surface must produce. */
export function cronScheduleFrom(expr: string): CronScheduleWithTz {
  return { kind: 'cron', expr, tz: systemTimeZone() };
}

/** 3:30pm Mon-Fri in the principal's wall-clock (tz pinned at creation). */
export const REMINDER_CRON_EXPR = '30 15 * * 1-5';

export function reminderSchedule(): CronScheduleWithTz {
  return cronScheduleFrom(REMINDER_CRON_EXPR);
}
