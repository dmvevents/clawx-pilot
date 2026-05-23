/**
 * Single-export module that owns the Host API auth token.
 *
 * This used to live as a `let hostApiToken` directly inside api/server.ts,
 * but importing it from there pulled in the full route handler chain, which
 * broke gateway-manager tests when the import order in vitest happened to
 * hoist a stale module instance. Splitting the token storage into its own
 * tiny module keeps the import surface small and side-effect-free, so any
 * caller (including the gateway config-sync code that threads the token
 * into the spawned gateway's env) can read it without dragging in the rest
 * of the host-API server.
 */
import { randomBytes } from 'crypto';

let hostApiToken: string = '';

/**
 * Generate a fresh per-session token. Called once at startHostApiServer().
 * Re-calling rotates the token, but that's never used today.
 */
export function generateHostApiToken(): string {
  hostApiToken = randomBytes(32).toString('hex');
  return hostApiToken;
}

/** Read the current token. Empty string until generateHostApiToken() runs. */
export function getHostApiToken(): string {
  return hostApiToken;
}
