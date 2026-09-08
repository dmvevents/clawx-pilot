// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { deriveGraphConnectionState } from '../../electron/services/microsoft-graph/connection-state';

const NOW = 1_757_300_000_000; // fixed clock for determinism

describe('Microsoft Graph connection state derivation', () => {
  it('reports unconfigured on a vanilla install regardless of token facts', () => {
    // configured:false is exactly what the installed-build read-only status
    // showed on 2026-09-08 (bridge present, no tenant defaults shipped).
    expect(
      deriveGraphConnectionState({ configured: false, signedIn: false, expiresAt: null }, NOW),
    ).toBe('unconfigured');
    // Defensive: stale tokens without config still surface the admin gap.
    expect(
      deriveGraphConnectionState({ configured: false, signedIn: true, expiresAt: NOW + 1 }, NOW),
    ).toBe('unconfigured');
  });

  it('reports signed_out once configured but before any sign-in', () => {
    expect(
      deriveGraphConnectionState({ configured: true, signedIn: false, expiresAt: null }, NOW),
    ).toBe('signed_out');
  });

  it('reports signed_in while the persisted access token is still valid', () => {
    expect(
      deriveGraphConnectionState({ configured: true, signedIn: true, expiresAt: NOW + 60_000 }, NOW),
    ).toBe('signed_in');
  });

  it('reports expired at and after the persisted expiry instant', () => {
    expect(
      deriveGraphConnectionState({ configured: true, signedIn: true, expiresAt: NOW }, NOW),
    ).toBe('expired');
    expect(
      deriveGraphConnectionState({ configured: true, signedIn: true, expiresAt: NOW - 1 }, NOW),
    ).toBe('expired');
  });

  it('treats a signed-in status with no recorded expiry as signed_in, not expired', () => {
    expect(
      deriveGraphConnectionState({ configured: true, signedIn: true, expiresAt: null }, NOW),
    ).toBe('signed_in');
  });

  it('never derives a connected state from mock-mailbox facts (they are not inputs)', () => {
    // The derivation deliberately takes only configured/signedIn/expiresAt;
    // effectiveMock can never flip an unconfigured install to "connected".
    const state = deriveGraphConnectionState(
      { configured: false, signedIn: false, expiresAt: null },
      NOW,
    );
    expect(state).toBe('unconfigured');
  });
});
