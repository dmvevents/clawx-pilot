/**
 * Copy selection for the channel-degrade notice.
 *
 * Pure and unit-tested for the same reason the banner-suppression rules live in
 * `error-display.ts`: the page wiring stays a thin call, and the precedence
 * between four mutually-exclusive states (switch running / switch failed /
 * replayed / moved-but-not-replayed) is provable without rendering the Chat
 * page. Anonymised per the hard rules — channel vocabulary only, never a model
 * id, never a vendor name.
 */

export type DegradeNoticeState = {
  reason: 'unreachable' | 'rate-limited';
  resent: boolean;
  to: 'online' | 'on-device';
  cutoverConfirmed?: boolean;
  inProgress?: boolean;
};

export type DegradeNoticeCopy = {
  titleKey: string;
  hintKey: string;
  /** Which glyph the page renders; 'spinner' is the only animated one. */
  icon: 'spinner' | 'cloud' | 'laptop';
  /**
   * False only while the failover is still running: there is nothing to
   * dismiss yet, and the notice replaces itself with the outcome.
   */
  dismissible: boolean;
};

export function degradeNoticeCopy(notice: DegradeNoticeState): DegradeNoticeCopy {
  // A dead on-device turn. Nothing moved — sending on-device data to the cloud
  // stays the principal's explicit choice — so this is an actionable prompt,
  // never a progress line.
  if (notice.to === 'online') {
    return {
      titleKey: 'degradeNotice.onlineSwitchNeeded',
      hintKey: 'degradeNotice.onlineSwitchHint',
      icon: 'cloud',
      dismissible: true,
    };
  }

  const rateLimited = notice.reason === 'rate-limited';

  // Highest precedence: the failover is still running. The config transaction
  // and the acknowledged session cutover (15s budget) are both in flight, and
  // that window used to be dead air behind a frozen error — which a principal
  // out of time reads as a hung app (principal-proxy trust lens, 2026-09-06).
  // The line carries the root cause as well, so suppressing the red transport
  // banner underneath loses nothing.
  if (notice.inProgress === true) {
    return {
      titleKey: rateLimited ? 'degradeNotice.switchingRateLimited' : 'degradeNotice.switchingUnreachable',
      hintKey: 'degradeNotice.switchingHint',
      icon: 'spinner',
      dismissible: false,
    };
  }

  // The stores moved but the gateway never acknowledged the cutover, so the next
  // send may still run on the channel that just failed. Say that plainly rather
  // than "switched to this device", a promise we cannot keep.
  if (notice.cutoverConfirmed === false) {
    return {
      titleKey: rateLimited ? 'degradeNotice.cutoverFailedRateLimited' : 'degradeNotice.cutoverFailedUnreachable',
      hintKey: 'degradeNotice.cutoverFailedHint',
      icon: 'laptop',
      dismissible: true,
    };
  }

  if (notice.resent) {
    return {
      titleKey: rateLimited ? 'degradeNotice.resentRateLimited' : 'degradeNotice.resentUnreachable',
      hintKey: 'degradeNotice.restoreHint',
      icon: 'laptop',
      dismissible: true,
    };
  }

  return {
    titleKey: rateLimited ? 'degradeNotice.switchedRateLimited' : 'degradeNotice.switchedUnreachable',
    hintKey: 'degradeNotice.restoreHint',
    icon: 'laptop',
    dismissible: true,
  };
}
