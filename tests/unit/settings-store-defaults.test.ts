/**
 * Regression guard for the "shipped build launched on the on-device model
 * despite seeding a working cloud gateway" bug (2026-09-03).
 *
 * Root cause: electron-store returns its configured `defaults` from `.get()`
 * even for keys that were never written to disk. `createDefaultSettings()` used
 * to default `preferredChannel: 'on-device'`, so `getSetting('preferredChannel')`
 * NEVER returned undefined. That silently killed the cloud-gateway seed's guard
 * (`cloud-gateway-provider-seed.ts`: "set Online only when no choice exists
 * yet"), which keys on `undefined` to mean "no choice yet". The seed made the
 * gateway the default *provider* but the launch *channel* stayed on-device.
 *
 * The invariant this pins: the defaults object must NOT carry preferredChannel.
 * The launch channel is decided by the seed (Online on a fresh gateway build)
 * or the preflight's explicit `?? 'on-device'` fallback (non-gateway builds) —
 * never masked by a store default. An explicit user toggle persists a concrete
 * value via the settings PUT, which then reads back as authoritative.
 */
import { describe, expect, it, vi } from 'vitest';

// store.ts imports `app` from electron at module load; mock it so the module
// can be imported in the node test env. createDefaultSettings itself does not
// touch `app`.
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp'),
    getAppPath: vi.fn(() => '/tmp'),
  },
}));

import { createDefaultSettings } from '@electron/utils/store';

describe('settings store defaults', () => {
  it('does NOT default preferredChannel (an absent value means "no choice yet")', () => {
    const defaults = createDefaultSettings();
    expect('preferredChannel' in defaults).toBe(false);
    expect(defaults.preferredChannel).toBeUndefined();
  });

  it('still provides the other launch-critical defaults', () => {
    // Sanity: removing the preferredChannel default must not have disturbed the
    // rest of the settings surface the app relies on at first boot.
    const defaults = createDefaultSettings();
    expect(defaults.setupComplete).toBe(false);
    expect(defaults.gatewayAutoStart).toBe(true);
    expect(defaults.gatewayPort).toBe(18789);
  });
});
