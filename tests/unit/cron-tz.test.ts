/**
 * CLWX-99 regression: cron schedules must resolve in the principal's
 * wall-clock, not the gateway process's cached timezone.
 *
 * Live failure this guards against: the gateway caches its zone at first use,
 * so after a system timezone change (or on an imaged machine) an expr without
 * schedule.tz fired at the wrong wall-clock hour — the observed nextRun landed
 * a full YEAR out. Fix: every app-side creation surface pins schedule.tz at
 * creation time; the agent-side "at" rule (explicit UTC offset) lives in the
 * persona because zone-less ISO strings are stored as UTC by the gateway.
 */
import { describe, expect, it } from 'vitest';
import { Cron } from 'croner';
import {
  cronScheduleFrom,
  REMINDER_CRON_EXPR,
  reminderSchedule,
  systemTimeZone,
} from '../../electron/utils/cron-tz';
import { buildCronUpdatePatch } from '../../electron/api/routes/cron';
// @ts-expect-error untyped extension module outside the scripts project
import { SYSTEM_PROMPT } from '../../extensions/moe-principal-assistant/persona.mjs';

/** Wall-clock HH:MM of an instant in a zone, via Intl (independent of croner). */
function wallClock(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(instant);
}

describe('systemTimeZone', () => {
  it('returns a zone Intl accepts', () => {
    const zone = systemTimeZone();
    expect(zone).toBeTruthy();
    expect(() => new Intl.DateTimeFormat('en-US', { timeZone: zone })).not.toThrow();
  });
});

describe('creation-surface schedule shape', () => {
  it('cronScheduleFrom always pins tz to the system zone', () => {
    const schedule = cronScheduleFrom('30 15 * * 1-5');
    expect(schedule).toEqual({ kind: 'cron', expr: '30 15 * * 1-5', tz: systemTimeZone() });
  });

  it('the seeded fleet reminder carries the pinned tz', () => {
    const schedule = reminderSchedule();
    expect(schedule.expr).toBe(REMINDER_CRON_EXPR);
    expect(schedule.tz).toBe(systemTimeZone());
  });
});

describe('seeded 3:30pm reminder resolves at principal wall-clock', () => {
  // Trinidad & Tobago: fixed UTC-4, no DST — the fleet zone.
  const FLEET_TZ = 'America/Port_of_Spain';
  // A fixed Saturday noon UTC; next weekday firing is Monday.
  const NOW = new Date('2026-09-05T12:00:00Z');

  it('nextRun lands at 15:30 local within the week, not a year out', () => {
    const next = new Cron(REMINDER_CRON_EXPR, { timezone: FLEET_TZ }).nextRun(NOW);
    expect(next).not.toBeNull();
    expect(next!.toISOString()).toBe('2026-09-07T19:30:00.000Z'); // Mon 15:30 UTC-4
    expect(wallClock(next!, FLEET_TZ)).toBe('15:30');
    const deltaMs = next!.getTime() - NOW.getTime();
    expect(deltaMs).toBeGreaterThan(0);
    expect(deltaMs).toBeLessThan(7 * 24 * 3600 * 1000);
  });

  it('control: an unpinned zone shifts the firing instant (the defect mechanism)', () => {
    const pinned = new Cron(REMINDER_CRON_EXPR, { timezone: FLEET_TZ }).nextRun(NOW)!;
    const strayZone = new Cron(REMINDER_CRON_EXPR, { timezone: 'Asia/Calcutta' }).nextRun(NOW)!;
    expect(strayZone.getTime()).not.toBe(pinned.getTime());
    // The stray instant is NOT 15:30 on the principal's clock.
    expect(wallClock(strayZone, FLEET_TZ)).not.toBe('15:30');
  });
});

describe('buildCronUpdatePatch (PUT surface)', () => {
  it('adds tz when the schedule arrives as a bare expr string', () => {
    const patch = buildCronUpdatePatch({ schedule: '0 8 * * *' });
    expect(patch.schedule).toEqual({ kind: 'cron', expr: '0 8 * * *', tz: systemTimeZone() });
  });

  it('adds tz to a cron schedule object that lacks one', () => {
    const patch = buildCronUpdatePatch({ schedule: { kind: 'cron', expr: '0 8 * * *' } });
    expect(patch.schedule).toEqual({ kind: 'cron', expr: '0 8 * * *', tz: systemTimeZone() });
  });

  it('never overrides an explicit tz', () => {
    const patch = buildCronUpdatePatch({ schedule: { kind: 'cron', expr: '0 8 * * *', tz: 'UTC' } });
    expect(patch.schedule).toEqual({ kind: 'cron', expr: '0 8 * * *', tz: 'UTC' });
  });

  it('leaves non-cron schedules untouched', () => {
    const at = { kind: 'at', at: '2026-09-06T15:40:00-04:00' };
    const patch = buildCronUpdatePatch({ schedule: { ...at } });
    expect(patch.schedule).toEqual(at);
  });
});

describe('agent-side scheduling rule (persona)', () => {
  it('requires explicit UTC offsets on one-off timestamps and schedule.tz on exprs', () => {
    const prompt = String(SYSTEM_PROMPT);
    expect(prompt).toContain('explicit UTC offset');
    expect(prompt).toContain('schedule.tz');
    // The rule must state the failure mode so the model understands why.
    expect(prompt).toContain('stored as UTC');
  });
});
