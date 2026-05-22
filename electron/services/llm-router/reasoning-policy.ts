/**
 * Reasoning policy resolver (main-process side).
 *
 * The renderer holds three reasoning visibility states (`hidden` | `condensed`
 * | `expanded`) and each has a corresponding OpenClaw thinking level. The
 * gateway's agent config / `chat.send` `thinkOnce` field accepts one of:
 *   off | minimal | low | medium | high | xhigh.
 *
 * This module is intentionally pure: it has no I/O and no Electron
 * dependencies so it can be unit-tested in isolation and re-used from any
 * future per-turn wiring (Tasks #46 / #47).
 */
import type { ReasoningVisibility } from '../../../shared/feature-flags';

/** OpenClaw thinking levels accepted by the gateway. */
export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

/**
 * Translates a renderer-side ReasoningVisibility into an OpenClaw thinking
 * level.
 *
 *   hidden    → 'off'      (don't request reasoning, don't pay tokens)
 *   condensed → 'medium'   (request but render condensed)
 *   expanded  → 'high'     (request and render inline)
 */
export function visibilityToThinkingLevel(v: ReasoningVisibility): ThinkingLevel {
  switch (v) {
    case 'hidden':
      return 'off';
    case 'condensed':
      return 'medium';
    case 'expanded':
      return 'high';
    default: {
      // Defensive: future ReasoningVisibility members fall back to 'medium'
      // rather than emitting an invalid level upstream. The exhaustive check
      // here keeps the type system honest.
      const _exhaustive: never = v;
      void _exhaustive;
      return 'medium';
    }
  }
}

/**
 * Per-user reasoning preference. `'auto'` defers to the global default; the
 * other three mirror ReasoningVisibility one-for-one.
 */
export type PerUserReasoningSetting = 'auto' | 'hidden' | 'condensed' | 'expanded';

/** Map a legacy chat-store `thinkingLevel` string onto a ReasoningVisibility. */
function legacyThinkingLevelToVisibility(
  level: string | null | undefined,
): ReasoningVisibility | undefined {
  if (level == null) return undefined;
  const normalized = String(level).trim().toLowerCase();
  if (!normalized) return undefined;
  switch (normalized) {
    case 'off':
    case 'none':
    case 'hidden':
      return 'hidden';
    case 'minimal':
    case 'low':
    case 'medium':
    case 'condensed':
      return 'condensed';
    case 'high':
    case 'xhigh':
    case 'expanded':
      return 'expanded';
    default:
      return undefined;
  }
}

export interface ResolveReasoningVisibilityOptions {
  /** Per-message brain-icon override from ChatInput. */
  perMessage?: ReasoningVisibility;
  /** Legacy chat-store `thinkingLevel` string (e.g. "off" | "low" | "high"). */
  perSession?: string | null;
  /** Per-user setting persisted in electron-store. */
  perUser?: PerUserReasoningSetting;
  /** Build-time default (e.g. DEFAULT_REASONING_VISIBILITY). */
  globalDefault: ReasoningVisibility;
}

/**
 * Resolve the precedence chain for a given message turn:
 *   per-message override → per-session level → per-user setting → global default
 *
 * The first non-undefined / non-`auto` value wins. The legacy per-session
 * field accepts OpenClaw thinking-level strings ("off" / "low" / "high" / …)
 * and is normalised back into ReasoningVisibility space here.
 */
export function resolveReasoningVisibility(
  opts: ResolveReasoningVisibilityOptions,
): ReasoningVisibility {
  if (opts.perMessage !== undefined) {
    return opts.perMessage;
  }

  const fromSession = legacyThinkingLevelToVisibility(opts.perSession);
  if (fromSession !== undefined) {
    return fromSession;
  }

  if (opts.perUser !== undefined && opts.perUser !== 'auto') {
    return opts.perUser;
  }

  return opts.globalDefault;
}
