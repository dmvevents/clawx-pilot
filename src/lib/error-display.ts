/**
 * Principal-facing error display mapping.
 *
 * Raw provider/transport strings ("Model call failed", "400 status code
 * (no body)") must never be the primary text a principal reads. This module
 * maps a raw failure string to a display kind; the Chat page renders the
 * plain-language message for that kind and tucks the raw string into a
 * collapsed details expander.
 *
 * Display-layer only: classification here never changes whether an error
 * surfaces. Config/auth failures still produce a visible banner (they must
 * not degrade silently — see channel-degrade.ts); only the wording changes.
 */
import { classifyFailure } from '@/lib/channel-degrade';

export type ErrorDisplayKind = 'unreachable' | 'rate-limited' | 'auth-config' | 'generic';

/**
 * Auth/config signatures, mirroring the "never degrade" class in
 * channel-degrade.ts closely enough to pick a more useful message. Kept
 * separate because that list also contains non-config entries (user aborts,
 * context overflows) that read better under the generic wording.
 */
const AUTH_CONFIG_PATTERNS: readonly RegExp[] = [
  /\b401\b|\b403\b/,
  /unauthor(?:ized|ised)/i,
  /forbidden/i,
  /invalid (?:api[ _-]?key|subscription[ _-]?key|credential|token)/i,
  /missing (?:api[ _-]?key|subscription[ _-]?key|credential)/i,
  /authentication (?:failed|required)/i,
  /permission denied/i,
];

export interface ErrorDisplay {
  kind: ErrorDisplayKind;
  /** The raw error string, for the collapsed technical-details expander. */
  detail: string;
}

/**
 * The SDK's transport wrapper ("Connection error.", optionally prefixed with
 * "Model call failed") carries zero diagnostic value beyond the classified
 * kind, and the moe.18 trust bar explicitly forbids surfacing it raw — even
 * behind the collapsed expander (Finding D2). Blank it so the expander does
 * not render; genuinely informative details are kept.
 */
const TRANSPORT_WRAPPER = /^(?:model call failed[.:]?\s*)?connection error\.?$/i;
const RAW_ERROR_FRAGMENT = /\s*rawError=connection error\.?/gi;

/**
 * Transport-class kinds are the ones the amber channel-degrade notice already
 * explains with channel-correct wording. When that notice is visible, a red
 * banner of one of these kinds is a duplicate telling of the SAME failure —
 * suppress it (moe.18 Findings D0/D1: three stacked banners read as "the app
 * is broken"). Auth/config and generic errors always surface.
 */
export function isTransportDisplayKind(kind: ErrorDisplayKind): boolean {
  return kind === 'unreachable' || kind === 'rate-limited';
}

/**
 * The one place the red-banner suppression rules live (moe.18 D0/D1), so the
 * page wiring stays a thin call and the rules are unit-testable:
 * - a degrade notice suppresses same-class transport banners ONLY while it is
 *   explaining a failure; a success-claiming notice (`resent: true`) never
 *   suppresses anything — a failed resend must stay visible;
 * - auth/config and generic banners always show;
 * - the bottom error bar never duplicates the callout verbatim.
 */
export function errorBannerVisibility(args: {
  runError: string | null;
  error: string | null;
  runErrorKind: ErrorDisplayKind;
  errorKind: ErrorDisplayKind;
  degradeNotice: { resent?: boolean } | null;
}): { showRunError: boolean; showErrorBar: boolean } {
  const noticeExplainsFailure = !!args.degradeNotice && args.degradeNotice.resent !== true;
  return {
    showRunError: !!args.runError
      && !(noticeExplainsFailure && isTransportDisplayKind(args.runErrorKind)),
    showErrorBar: !!args.error
      && args.error !== args.runError
      && !(noticeExplainsFailure && isTransportDisplayKind(args.errorKind)),
  };
}

export function principalErrorDisplay(raw: string | null | undefined): ErrorDisplay {
  const classified = String(raw ?? '').trim();
  if (!classified) return { kind: 'generic', detail: classified };

  // Classify on the full string; display a scrubbed detail.
  const detail = TRANSPORT_WRAPPER.test(classified)
    ? ''
    : classified.replace(RAW_ERROR_FRAGMENT, '').trim();

  if (AUTH_CONFIG_PATTERNS.some((pattern) => pattern.test(classified))) {
    return { kind: 'auth-config', detail };
  }

  const failureClass = classifyFailure(classified);
  if (failureClass === 'unreachable') return { kind: 'unreachable', detail };
  if (failureClass === 'rate-limited') return { kind: 'rate-limited', detail };
  return { kind: 'generic', detail };
}

/**
 * i18n keys (chat namespace) for each display kind — shared by the global
 * error banner/callout (src/pages/Chat/index.tsx) and the in-line error chip
 * on error-stopped assistant messages (ChatMessage.tsx, CLWX-105) so the
 * principal reads ONE wording for the same failure class everywhere.
 */
export const ERROR_DISPLAY_KEY: Record<ErrorDisplayKind, string> = {
  unreachable: 'errorDisplay.unreachable',
  'rate-limited': 'errorDisplay.rateLimited',
  'auth-config': 'errorDisplay.authConfig',
  generic: 'errorDisplay.generic',
};
