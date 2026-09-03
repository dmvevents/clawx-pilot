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

export function principalErrorDisplay(raw: string | null | undefined): ErrorDisplay {
  const detail = String(raw ?? '').trim();
  if (!detail) return { kind: 'generic', detail };

  if (AUTH_CONFIG_PATTERNS.some((pattern) => pattern.test(detail))) {
    return { kind: 'auth-config', detail };
  }

  const failureClass = classifyFailure(detail);
  if (failureClass === 'unreachable') return { kind: 'unreachable', detail };
  if (failureClass === 'rate-limited') return { kind: 'rate-limited', detail };
  return { kind: 'generic', detail };
}
