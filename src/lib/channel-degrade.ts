/**
 * Send-time channel degradation.
 *
 * ## The problem this solves
 *
 * `preferredChannel` is sticky persisted state, changed only by an explicit user
 * toggle. The launch-time reconciliation in `channel-router.ts::runChannelPreflight`
 * does fall back, but only at boot and only when the desired channel has no
 * configured *account* — `listAvailableChannels()` classifies by account, never by
 * reachability. So a principal who has toggled to "Online" and then loses
 * connectivity gets a failed turn, not a degraded one: the assistant goes silent.
 *
 * Two separate incidents converge here, which is why this is one module:
 *
 *   1. Offline — a school network drops mid-afternoon and the 3:45pm daily report
 *      still has to go out (`docs/OFFLINE_ARCHITECTURE.md` §3.1).
 *   2. Fleet 429 — the Ministry's APIM budget is a single shared bucket with no
 *      remaining-budget figure, so exhaustion surfaces as *every* principal's
 *      assistant erroring at once (`docs/SCALE_ANALYSIS_2026-08-20.md` §3).
 *
 * In both cases the on-device model is present, works, and is proven to run with
 * the network cut (eval lane G). Degrading to it is strictly better than failing.
 *
 * ## Design rules
 *
 * - **Never rewrite the user's stored preference.** This is degradation for one
 *   turn, not preference-editing. The principal's explicit toggle stays
 *   authoritative and is restored when the cloud recovers. Silently flipping a
 *   persisted setting because a packet dropped is how you get "why did the AI
 *   change?" — the exact trust problem the anonymised-model-identity rule exists
 *   to prevent.
 * - **Only degrade on network-class failures.** A prompt that genuinely errored,
 *   a bad tool call, or an auth problem must surface to the user. Hiding a real
 *   error behind a quiet model swap is worse than the error.
 * - **Fail closed on ambiguity.** Unrecognised errors are NOT degraded. A wrong
 *   "degrade" hides a real defect; a wrong "surface" merely shows the error we
 *   would have shown anyway.
 * - **No raw model identity in user-facing strings.** Per the hard rules, the UI
 *   says "On this device" / "Online" and never a model ID.
 */

/** Why a turn failed, as far as degradation is concerned. */
export type FailureClass =
  /** No route to the provider: offline, DNS dead, connection refused/reset. */
  | 'unreachable'
  /** Provider reachable but refusing on volume: HTTP 429, quota/budget exhausted. */
  | 'rate-limited'
  /** Anything else — a real error that must surface unchanged. */
  | 'other';

export interface DegradeDecision {
  /** Whether to move the runtime onto the on-device channel. */
  degrade: boolean;
  /**
   * Whether it is safe to resend the failed message automatically.
   *
   * Deliberately narrower than `degrade`. A turn that already ran tools may
   * have had side effects before the model call died — replaying it could
   * re-open a compose pane or re-read a mailbox. The hard-confirm gates on
   * `outlook.send_email` / `download_attachment` mean nothing irreversible can
   * fire unattended, but "probably harmless" is not the standard for a
   * principal's mailbox. When tools ran, we degrade the channel and let the
   * principal resend.
   */
  resend: boolean;
  /** Why, for logging and for the user-facing notice. */
  reason: FailureClass;
}

/**
 * Network-unreachable signatures.
 *
 * Drawn from what actually appears in this tree and from Node/undici's real
 * error surface, not invented. Node's fetch collapses most transport failures
 * into the bare string "fetch failed", with the cause nested — so that string
 * has to count, even though it is frustratingly generic.
 */
const UNREACHABLE_PATTERNS: readonly RegExp[] = [
  /\bECONNREFUSED\b/i,
  /\bENOTFOUND\b/i,
  /\bETIMEDOUT\b/i,
  /\bENETUNREACH\b/i,
  /\bEHOSTUNREACH\b/i,
  /\bEAI_AGAIN\b/i,
  /\bECONNRESET\b/i,
  /\bEPIPE\b/i,
  /fetch failed/i,
  /failed to fetch/i,
  /network (?:error|request failed|is offline)/i,
  /(?:socket|connection) (?:hang up|closed|timeout)/i,
  /getaddrinfo/i,
  /dns lookup failed/i,
  /(?:provider|gateway|upstream|endpoint|host) unreachable/i,
  /unable to (?:reach|connect)/i,
  /offline/i,
  // The gateway's stalled-provider surface: "LLM idle timeout (Ns): no
  // response from model". A cloud model that stops answering mid-turn is a
  // provider failure from the principal's seat — degrade, don't show the
  // raw string (IDLE-TIMEOUT-RAW, first seen 2026-05-08).
  /llm idle timeout/i,
  /no response from model/i,
];

/**
 * Rate-limit / budget-exhaustion signatures.
 *
 * The Ministry's gateway returns a bare HTTP 429 for both per-second throttling
 * and monthly budget exhaustion (their §3.2), with no remaining-budget figure to
 * distinguish them. We treat both identically: degrade, because from the
 * principal's seat they are the same event.
 */
const RATE_LIMIT_PATTERNS: readonly RegExp[] = [
  /\b429\b/,
  /too many requests/i,
  /rate[ _-]?limit/i,
  /\bquota\b/i,
  /token budget (?:exhausted|exceeded)/i,
  /budget exhausted/i,
  /insufficient quota/i,
  /\bthrottl/i,
];

/**
 * Signatures that must NEVER be treated as network-class, checked FIRST.
 *
 * These exist because several of them contain substrings that would otherwise
 * match above. The clearest trap: a 401/403 from APIM means a missing or wrong
 * subscription key (the Ministry's §4.2 says exactly this) — a configuration
 * fault that degrading would mask indefinitely, turning "your key is wrong" into
 * "the assistant is oddly always on-device". Auth problems must be visible.
 */
const NEVER_DEGRADE_PATTERNS: readonly RegExp[] = [
  /\b401\b|\b403\b/,
  /unauthor(?:ized|ised)/i,
  /forbidden/i,
  /invalid (?:api[ _-]?key|subscription[ _-]?key|credential|token)/i,
  /missing (?:api[ _-]?key|subscription[ _-]?key|credential)/i,
  /authentication (?:failed|required)/i,
  /permission denied/i,
  /content (?:filter|policy)/i,
  /safety (?:filter|violation)/i,
  /model_not_allowed|MODEL_NOT_ALLOWED/,
  /context (?:length|window) exceeded/i,
  /\bmaximum context\b/i,
  /tool (?:call )?(?:error|failed)/i,
  /aborted by user/i,
];

/** Classify a failure string into a degradation class. */
export function classifyFailure(raw: string | null | undefined): FailureClass {
  if (!raw) return 'other';
  const text = String(raw);
  if (!text.trim()) return 'other';

  // Order matters: a hard "never degrade" signal wins over any network-looking
  // substring elsewhere in the same message.
  for (const p of NEVER_DEGRADE_PATTERNS) {
    if (p.test(text)) return 'other';
  }
  for (const p of RATE_LIMIT_PATTERNS) {
    if (p.test(text)) return 'rate-limited';
  }
  for (const p of UNREACHABLE_PATTERNS) {
    if (p.test(text)) return 'unreachable';
  }
  return 'other';
}

export interface DegradeContext {
  /** The channel the failed turn ran on. */
  activeChannel: 'online' | 'on-device';
  /** Whether an on-device account exists to degrade *to*. */
  onDeviceAvailable: boolean;
  /** Whether this turn has already been degraded once (prevents retry loops). */
  alreadyDegraded: boolean;
  /**
   * Whether any tool ran before the failure. Blocks automatic resend only —
   * the channel still degrades, so the principal's own resend lands on-device.
   */
  toolsRan?: boolean;
  /** Whether the failed message text is still available to resend. */
  haveMessageText?: boolean;
}

/**
 * Decide whether a failed turn should be retried on-device.
 *
 * Deliberately a pure function of (error, context) so the policy is unit-testable
 * without a gateway, a network, or a running Electron app.
 */
export function shouldDegradeToOnDevice(
  error: string | null | undefined,
  ctx: DegradeContext,
): DegradeDecision {
  const reason = classifyFailure(error);
  const no = { degrade: false, resend: false, reason };

  // Only a cloud turn can degrade. An on-device failure has nowhere to go, and
  // retrying it on the same channel would be a loop.
  if (ctx.activeChannel !== 'online') return no;

  // No on-device account: nothing to degrade to. Surface the real error rather
  // than swapping to a channel that would fail differently.
  if (!ctx.onDeviceAvailable) return no;

  // One degrade per turn. Without this a persistently failing local runtime and
  // a persistently failing cloud could ping-pong.
  if (ctx.alreadyDegraded) return no;

  const degrade = reason === 'unreachable' || reason === 'rate-limited';
  if (!degrade) return no;

  // Degrade the channel either way; only auto-resend when nothing has run yet
  // and we still hold the text.
  return {
    degrade: true,
    resend: ctx.toolsRan !== true && ctx.haveMessageText !== false,
    reason,
  };
}
