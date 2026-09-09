import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockExistsSync, mockFork, mockGetUvMirrorEnv } = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockFork: vi.fn(),
  mockGetUvMirrorEnv: vi.fn(),
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: mockExistsSync,
    default: {
      ...actual,
      existsSync: mockExistsSync,
    },
  };
});

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
  },
  utilityProcess: {
    fork: mockFork,
  },
}));

vi.mock('@electron/utils/paths', () => ({
  getGatewayNodeModeEntryPath: () => '/tmp/resources/gateway/clawx-gateway-node-mode-entry.mjs',
  getOpenClawDir: () => '/tmp/openclaw',
  getOpenClawEntryPath: () => '/tmp/openclaw/openclaw-entry.js',
}));

vi.mock('@electron/utils/uv-env', () => ({
  getUvMirrorEnv: mockGetUvMirrorEnv,
}));

vi.mock('@electron/utils/uv-setup', () => ({
  isPythonReady: vi.fn(async () => true),
  setupManagedPython: vi.fn(async () => undefined),
}));

vi.mock('@electron/utils/env-path', () => ({
  prependPathEntry: vi.fn((env: Record<string, string | undefined>) => ({ env })),
}));

vi.mock('@electron/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@electron/gateway/ws-client', () => ({
  probeGatewayReady: vi.fn(async () => false),
}));

class MockUtilityChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
}

describe('runOpenClawDoctorRepair Gateway Node-mode contract (CLWX-136)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();

    mockExistsSync.mockReturnValue(true);
    mockGetUvMirrorEnv.mockResolvedValue({});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('forks the startup-failure doctor repair through the Node-mode entry shim and strips ELECTRON_RUN_AS_NODE', async () => {
    // The doctor repair fires exactly when Gateway startup fails, and its
    // chain spawns process.execPath children (SQLite read-only worker); a
    // raw-entry fork would boot the GUI app as a grandchild. Seed the parent
    // env so the no-flag assertion is a real strip pin.
    vi.stubEnv('ELECTRON_RUN_AS_NODE', '1');
    const child = new MockUtilityChild();
    mockFork.mockReturnValue(child);

    const { runOpenClawDoctorRepair } = await import('@electron/gateway/supervisor');
    const resultPromise = runOpenClawDoctorRepair();

    await vi.waitFor(() => {
      expect(mockFork).toHaveBeenCalledTimes(1);
    });
    const [entry, args, forkOptions] = mockFork.mock.calls[0];
    expect(entry).toBe('/tmp/resources/gateway/clawx-gateway-node-mode-entry.mjs');
    expect(args).toEqual(['doctor', '--fix', '--yes', '--non-interactive']);
    expect(forkOptions.env.CLAWX_GATEWAY_REAL_ENTRY).toBe('/tmp/openclaw/openclaw-entry.js');
    expect(forkOptions.env).not.toHaveProperty('ELECTRON_RUN_AS_NODE');
    expect(forkOptions.env.OPENCLAW_NO_RESPAWN).toBe('1');

    child.emit('exit', 0);
    await expect(resultPromise).resolves.toBe(true);
  });

  it('fails closed when the Node-mode entry shim is missing', async () => {
    mockExistsSync.mockImplementation(
      (candidate: string) => !String(candidate).includes('clawx-gateway-node-mode-entry.mjs'),
    );

    const { runOpenClawDoctorRepair } = await import('@electron/gateway/supervisor');

    await expect(runOpenClawDoctorRepair()).resolves.toBe(false);
    expect(mockFork).not.toHaveBeenCalled();
  });
});
