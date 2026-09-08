/**
 * Deterministic Microsoft Graph connection-state derivation.
 *
 * Kept as a pure module (no electron imports) so the state machine that
 * Settings renders is unit-testable and identical everywhere it is shown.
 * The inputs are the already-persisted facts from the Graph store — this
 * module invents nothing and never treats the mock mailbox as a connection.
 *
 * States (renderer-facing):
 *   unconfigured — no tenantId+clientId from store/env/disk. Administrator
 *                  action required; Outlook tools serve the demo mailbox.
 *   signed_out   — configured, no persisted token. User action: Sign in.
 *   expired      — configured + signed in, but the persisted access token is
 *                  past its expiry. Refresh is automatic on next use; the
 *                  state exists so the UI can say "sign in again" when the
 *                  automatic refresh is rejected instead of showing a stale
 *                  "connected" card. Not an error by itself.
 *   signed_in    — configured with a persisted, unexpired token.
 *
 * "authenticating" and "cancelled" are transient outcomes of the sign-in
 * IPC call (renderer-local + error code CANCELLED), not persisted states.
 */

export type MicrosoftGraphConnectionState =
  | 'unconfigured'
  | 'signed_out'
  | 'signed_in'
  | 'expired';

export interface ConnectionStateInput {
  configured: boolean;
  signedIn: boolean;
  /** Persisted access-token expiry (ms epoch) or null when signed out. */
  expiresAt: number | null;
}

export function deriveGraphConnectionState(
  input: ConnectionStateInput,
  now: number = Date.now(),
): MicrosoftGraphConnectionState {
  if (!input.configured) return 'unconfigured';
  if (!input.signedIn) return 'signed_out';
  if (typeof input.expiresAt === 'number' && input.expiresAt <= now) return 'expired';
  return 'signed_in';
}
