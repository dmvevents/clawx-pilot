import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// CLWX-102: an E2E spec that deletes/saves a provider reaches
// GatewayManager.debouncedRestart → restart → start → startProcess →
// prepareGatewayLaunchContext. The guard refuses there; this suite pins how
// the manager degrades that refusal: a typed rejection, "stopped" status with
// the reason attached, and no auto-reconnect loop.

const { mockPrepareLaunchContext, mockLaunchGatewayProcess, mockLoggerWarn } = vi.hoisted(() => ({
  mockPrepareLaunchContext: vi.fn(),
  mockLaunchGatewayProcess: vi.fn(),
  mockLoggerWarn: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp',
    isPackaged: false,
  },
  utilityProcess: {},
}));

vi.mock('@electron/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: mockLoggerWarn,
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@electron/utils/telemetry', () => ({
  captureTelemetryEvent: vi.fn(),
  trackMetric: vi.fn(),
}));

vi.mock('@electron/utils/device-identity', () => ({
  loadOrCreateDeviceIdentity: vi.fn(async () => ({ deviceId: 'test-device', publicKey: 'pk', privateKey: 'sk' })),
}));

vi.mock('@electron/gateway/reload-policy', async () => {
  const actual = await vi.importActual<typeof import('@electron/gateway/reload-policy')>('@electron/gateway/reload-policy');
  return {
    ...actual,
    loadGatewayReloadPolicy: vi.fn(async () => ({ ...actual.DEFAULT_GATEWAY_RELOAD_POLICY })),
  };
});

vi.mock('@electron/gateway/supervisor', () => ({
  findExistingGatewayProcess: vi.fn(async () => null),
  runOpenClawDoctorRepair: vi.fn(async () => false),
  terminateOwnedGatewayProcess: vi.fn(async () => undefined),
  unloadLaunchctlGatewayService: vi.fn(async () => undefined),
  waitForPortFree: vi.fn(async () => undefined),
  warmupManagedPythonReadiness: vi.fn(),
}));

// The real guard runs inside the real prepareGatewayLaunchContext; here the
// rest of that function (config sync, fs probes) is out of scope, so the mock
// runs only the guard.
vi.mock('@electron/gateway/config-sync', () => ({
  prepareGatewayLaunchContext: mockPrepareLaunchContext,
}));

vi.mock('@electron/gateway/process-launcher', () => ({
  launchGatewayProcess: mockLaunchGatewayProcess,
}));

vi.mock('@electron/gateway/startup-orchestrator', () => ({
  runGatewayStartupSequence: vi.fn(async (hooks: { startProcess: () => Promise<void> }) => {
    await hooks.startProcess();
    throw new Error('unit test: startup sequence must not continue past startProcess');
  }),
}));

type ManagerInternals = {
  status: { state: string; port: number; error?: string; pid?: number };
  startLock: boolean;
  shouldReconnect: boolean;
  reconnectTimer: NodeJS.Timeout | null;
  scheduleReconnect: () => void;
};

async function loadManager() {
  vi.resetModules();
  const guard = await import('@electron/utils/e2e-gateway-guard');
  mockPrepareLaunchContext.mockImplementation(async (port: number) => {
    guard.assertGatewayLaunchAllowed('gateway-launch', `port=${port}`);
    throw new Error('unit test: launch context prepared (guard passed)');
  });
  const { GatewayManager } = await import('@electron/gateway/manager');
  const manager = new GatewayManager();
  return { manager, internals: manager as unknown as ManagerInternals, guard };
}

describe('GatewayManager under the E2E gateway launch guard (CLWX-102)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.stubEnv('CLAWX_E2E', '1');
    vi.stubEnv('CLAWX_E2E_ALLOW_GATEWAY', '');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('start() rejects with the typed refusal, stays "stopped" with the reason, and never forks', async () => {
    const { manager, internals, guard } = await loadManager();

    await expect(manager.start()).rejects.toBeInstanceOf(guard.E2EGatewayLaunchRefusedError);

    expect(mockPrepareLaunchContext).toHaveBeenCalledTimes(1);
    expect(mockLaunchGatewayProcess).not.toHaveBeenCalled();
    expect(internals.status.state).toBe('stopped');
    expect(internals.status.error).toContain(guard.E2E_GATEWAY_LAUNCH_REFUSED_CODE);
    expect(internals.status.pid).toBeUndefined();
    expect(internals.reconnectTimer).toBeNull();
    expect(mockLoggerWarn).toHaveBeenCalledWith(expect.stringContaining('Gateway start refused'));
  });

  it('restart() does not schedule auto-reconnect after a refused launch', async () => {
    const { manager, internals, guard } = await loadManager();
    internals.status = { state: 'running', port: 18789 };
    internals.startLock = false;
    internals.shouldReconnect = true;
    vi.spyOn(manager, 'stop').mockImplementation(async () => {
      internals.shouldReconnect = false;
      internals.status = { state: 'stopped', port: 18789 };
    });
    const scheduleReconnectSpy = vi.spyOn(internals, 'scheduleReconnect');

    await expect(manager.restart()).rejects.toBeInstanceOf(guard.E2EGatewayLaunchRefusedError);

    expect(scheduleReconnectSpy).not.toHaveBeenCalled();
    expect(internals.reconnectTimer).toBeNull();
    expect(internals.status.state).toBe('stopped');
    expect(mockLaunchGatewayProcess).not.toHaveBeenCalled();
  });

  it('debouncedRestart (the provider:delete path) degrades to a logged no-op with no unhandled rejection', async () => {
    const { manager, internals } = await loadManager();
    internals.status = { state: 'running', port: 18789 };
    vi.spyOn(manager, 'stop').mockImplementation(async () => {
      internals.status = { state: 'stopped', port: 18789 };
    });
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled);

    try {
      manager.debouncedRestart(10);
      await vi.advanceTimersByTimeAsync(50);
      await vi.advanceTimersByTimeAsync(0);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }

    expect(unhandled).toEqual([]);
    expect(mockPrepareLaunchContext).toHaveBeenCalledTimes(1);
    expect(mockLaunchGatewayProcess).not.toHaveBeenCalled();
    expect(internals.status.state).toBe('stopped');
    expect(internals.reconnectTimer).toBeNull();
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'Debounced Gateway restart failed:',
      expect.objectContaining({ code: 'E2E_GATEWAY_LAUNCH_REFUSED' }),
    );
  });

  it('proceeds past the guard when the spec opts in with CLAWX_E2E_ALLOW_GATEWAY=1', async () => {
    vi.stubEnv('CLAWX_E2E_ALLOW_GATEWAY', '1');
    const { manager, internals, guard } = await loadManager();

    const rejection = await manager.start().catch((error: unknown) => error);

    expect(guard.isE2EGatewayLaunchRefusedError(rejection)).toBe(false);
    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).message).toContain('guard passed');
    expect(internals.status.state).toBe('error');
  });

  it('is unchanged outside E2E mode: a non-guard start failure still enters "error" and self-heals', async () => {
    vi.stubEnv('CLAWX_E2E', '');
    const { manager, internals } = await loadManager();

    const rejection = await manager.start().catch((error: unknown) => error);

    expect((rejection as Error).message).toContain('guard passed');
    expect(internals.status.state).toBe('error');
  });
});
