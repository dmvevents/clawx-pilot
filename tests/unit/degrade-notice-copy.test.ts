/**
 * Copy precedence for the channel-degrade notice (CLWX-95).
 *
 * The notice has four mutually-exclusive on-device states and one online state,
 * and the wrong precedence is a trust bug, not a cosmetic one: a "switched to
 * this device" line over an unconfirmed cutover is a promise the app cannot
 * keep, and a terminal line over a switch that is still running leaves the
 * principal with no sign the app is doing anything (principal-proxy trust lens,
 * 2026-09-06 — the 15s acknowledgement wait was silent).
 *
 * Every key asserted here is also checked against the shipped en/chat.json, so
 * a renamed or misspelled key fails the suite instead of rendering the key path
 * to a principal.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { degradeNoticeCopy, type DegradeNoticeState } from '@/lib/degrade-notice';

const CHAT_STRINGS = JSON.parse(
  readFileSync(resolve(__dirname, '../../src/i18n/locales/en/chat.json'), 'utf-8'),
) as Record<string, Record<string, string>>;

/** Resolve a 'degradeNotice.x' key against the shipped English bundle. */
function stringFor(key: string): string | undefined {
  const [ns, leaf] = key.split('.');
  return CHAT_STRINGS[ns]?.[leaf];
}

const base: DegradeNoticeState = { reason: 'unreachable', resent: false, to: 'on-device' };

describe('degradeNoticeCopy', () => {
  it('shows a spinning progress line while the switch is still running', () => {
    const copy = degradeNoticeCopy({ ...base, inProgress: true });
    expect(copy.titleKey).toBe('degradeNotice.switchingUnreachable');
    expect(copy.hintKey).toBe('degradeNotice.switchingHint');
    expect(copy.icon).toBe('spinner');
    // Nothing to dismiss yet: the notice replaces itself with the outcome.
    expect(copy.dismissible).toBe(false);
  });

  it('uses the busy wording for a rate-limited switch in progress', () => {
    expect(degradeNoticeCopy({ ...base, reason: 'rate-limited', inProgress: true }).titleKey)
      .toBe('degradeNotice.switchingRateLimited');
  });

  it('in-progress OUTRANKS every terminal state, so a stale outcome cannot mask a running switch', () => {
    // Defensive: the store never sets these together, but if a future edit did,
    // the running switch is what is true right now.
    expect(degradeNoticeCopy({ ...base, inProgress: true, cutoverConfirmed: false }).icon).toBe('spinner');
    expect(degradeNoticeCopy({ ...base, inProgress: true, resent: true }).icon).toBe('spinner');
  });

  it('says the switch could not be made when the cutover was not acknowledged', () => {
    const copy = degradeNoticeCopy({ ...base, cutoverConfirmed: false });
    expect(copy.titleKey).toBe('degradeNotice.cutoverFailedUnreachable');
    expect(copy.hintKey).toBe('degradeNotice.cutoverFailedHint');
    expect(copy.icon).toBe('laptop');
    expect(copy.dismissible).toBe(true);
  });

  it('reports a replayed turn, and a moved-but-not-replayed turn, differently', () => {
    expect(degradeNoticeCopy({ ...base, resent: true }).titleKey).toBe('degradeNotice.resentUnreachable');
    expect(degradeNoticeCopy({ ...base, resent: false }).titleKey).toBe('degradeNotice.switchedUnreachable');
  });

  it('keeps the on-device -> online direction an actionable prompt, never a progress line', () => {
    // Nothing moved in this direction: sending on-device data to the cloud stays
    // the principal's explicit choice, so there is no switch to report progress on.
    const copy = degradeNoticeCopy({ reason: 'unreachable', resent: false, to: 'online', inProgress: true });
    expect(copy.titleKey).toBe('degradeNotice.onlineSwitchNeeded');
    expect(copy.icon).toBe('cloud');
    expect(copy.dismissible).toBe(true);
  });

  it('every key it can return exists in the shipped English bundle', () => {
    const states: DegradeNoticeState[] = [];
    for (const reason of ['unreachable', 'rate-limited'] as const) {
      states.push({ reason, resent: false, to: 'online' });
      states.push({ reason, resent: false, to: 'on-device', inProgress: true });
      states.push({ reason, resent: false, to: 'on-device', cutoverConfirmed: false });
      states.push({ reason, resent: true, to: 'on-device' });
      states.push({ reason, resent: false, to: 'on-device' });
    }
    for (const state of states) {
      const copy = degradeNoticeCopy(state);
      expect(stringFor(copy.titleKey), `missing string: ${copy.titleKey}`).toBeTruthy();
      expect(stringFor(copy.hintKey), `missing string: ${copy.hintKey}`).toBeTruthy();
    }
  });

  it('leaks no model id, vendor, or cost in any notice string (anonymised-identity hard rule)', () => {
    const banned = /gemini|sonnet|opus|qwen|ollama|bedrock|gpt-|llama|\$\d|token/i;
    for (const [key, value] of Object.entries(CHAT_STRINGS.degradeNotice)) {
      expect(banned.test(value), `${key} leaks runtime identity: ${value}`).toBe(false);
    }
  });
});
