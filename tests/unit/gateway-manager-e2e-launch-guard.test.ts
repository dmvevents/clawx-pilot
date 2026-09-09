import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// CLWX-102: an E2E spec that deletes/saves a provider reaches
// GatewayManager.debouncedRestart → restart → start. start() refuses at its
// top, before the orphan scan (findExistingGatewayProcess runs `lsof` on the
// fixed Gateway port and kills any listener it does not own), the Python
// warmup and the device-identity I/O. prepareGatewayLaunchContext keeps its
// own refusal as defence in depth. This suite pins both refusal points and how
// the manager degrades them: a typed rejection, "stopped" status with the
// reason attached, and no auto-reconnect loop.

const {
  mockPrepareLaunchContext,
  mockLaunchGatewayProcess,
  mockLoggerWarn,
  mockFindExistingGatewayProcess,
  mockWarmupManagedPythonReadiness,
  mockUnloadLaunchctlGatewayService,
  mockWaitForPortFree,
  mockRunOpenClawDoctorRepair,
  mockLoadOrCreateDeviceIdentity,
  mockRunGatewayStartupSequence,
} = vi.hoisted(() => ({
  mockPrepareLaunchContext: vi.fn(),
  mockLaunchGatewayProcess: vi.fn(),
  mockLoggerWarn: vi.fn(),
  mockFindExistingGatewayProcess: vi.fn(async () => null),
  mockWarmupManagedPythonReadiness: vi.fn(),
  mockUnloadLaunchctlGatewayService: vi.fn(async () => undefined),
  mockWaitForPortFree: vi.fn(async () => undefined),
  mockRunOpenClawDoctorRepair: vi.fn(async () => false),
  mockLoadOrCreateDeviceIdentity: vi.fn(async () => ({ deviceId: 'test-device', publicKey: 'pk', privateKey: 'sk' })),
  mockRunGatewayStartupSequence: vi.fn(),
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
  loadOrCreateDeviceIdentity: mockLoadOrCreateDeviceIdentity,
}));

vi.mock('@electron/gateway/reload-policy', async () => {
  const actual = await vi.importActual<typeof import('@electron/gateway/reload-policy')>('@electron/gateway/reload-policy');
  return {
    ...actual,
    loadGatewayReloadPolicy: vi.fn(async () => ({ ...actual.DEFAULT_GATEWAY_RELOAD_POLICY })),
  };
});

// Every helper here touches the host environment (lsof/kill, launchctl, uv,
// port probes). The E2E rows assert they are never invoked.
vi.mock('@electron/gateway/supervisor', () => ({
  findExistingGatewayProcess: mockFindExistingGatewayProcess,
  runOpenClawDoctorRepair: mockRunOpenClawDoctorRepair,
  terminateOwnedGatewayProcess: vi.fn(async () => undefined),
  unloadLaunchctlGatewayService: mockUnloadLaunchctlGatewayService,
  waitForPortFree: mockWaitForPortFree,
  warmupManagedPythonReadiness: mockWarmupManagedPythonReadiness,
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

// Mirrors the real sequence's order: orphan scan first, then the spawn.
vi.mock('@electron/gateway/startup-orchestrator', () => ({
  runGatewayStartupSequence: mockRunGatewayStartupSequence,
}));

type StartupHooks = {
  port: number;
  findExistingGateway: (port: number) => Promise<unknown>;
  startProcess: () => Promise<void>;
};

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
  mockRunGatewayStartupSequence.mockImplementation(async (hooks: StartupHooks) => {
    await hooks.findExistingGateway(hooks.port);
    await hooks.startProcess();
    throw new Error('unit test: startup sequence must not continue past startProcess');
  });
  mockPrepareLaunchContext.mockImplementation(async (port: number) => {
    guard.assertGatewayLaunchAllowed('gateway-launch', `port=${port}`);
    throw new Error('unit test: launch context prepared (guard passed)');
  });
  const { GatewayManager } = await import('@electron/gateway/manager');
  const manager = new GatewayManager();
  return { manager, internals: manager as unknown as ManagerInternals, guard };
}

function expectNoEnvironmentWork(): void {
  expect(mockFindExistingGatewayProcess).not.toHaveBeenCalled();
  expect(mockUnloadLaunchctlGatewayService).not.toHaveBeenCalled();
  expect(mockWaitForPortFree).not.toHaveBeenCalled();
  expect(mockWarmupManagedPythonReadiness).not.toHaveBeenCalled();
  expect(mockLoadOrCreateDeviceIdentity).not.toHaveBeenCalled();
  expect(mockRunGatewayStartupSequence).not.toHaveBeenCalled();
  expect(mockRunOpenClawDoctorRepair).not.toHaveBeenCalled();
  expect(mockPrepareLaunchContext).not.toHaveBeenCalled();
  expect(mockLaunchGatewayProcess).not.toHaveBeenCalled();
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

  it('start() refuses before the orphan scan or any other environment-touching helper runs', async () => {
    const { manager, internals, guard } = await loadManager();

    await expect(manager.start()).rejects.toBeInstanceOf(guard.E2EGatewayLaunchRefusedError);

    expectNoEnvironmentWork();
    expect(internals.status.state).toBe('stopped');
    expect(internals.status.error).toContain(guard.E2E_GATEWAY_LAUNCH_REFUSED_CODE);
    expect(internals.status.pid).toBeUndefined();
    expect(internals.startLock).toBe(false);
    expect(internals.reconnectTimer).toBeNull();
    expect(mockLoggerWarn).toHaveBeenCalledWith(expect.stringContaining('Gateway start refused'));
  });

  it('restart() does not schedule auto-reconnect after a refused launch and does not scan the port', async () => {
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

    expectNoEnvironmentWork();
    expect(scheduleReconnectSpy).not.toHaveBeenCalled();
    expect(internals.reconnectTimer).toBeNull();
    expect(internals.status.state).toBe('stopped');
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
    expectNoEnvironmentWork();
    expect(internals.status.state).toBe('stopped');
    expect(internals.reconnectTimer).toBeNull();
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'Debounced Gateway restart failed:',
      expect.objectContaining({ code: 'E2E_GATEWAY_LAUNCH_REFUSED' }),
    );
  });

  it('keeps the deep refusal in prepareGatewayLaunchContext as defence in depth with the same degradation', async () => {
    // Opt in so start()'s own guard passes, then make the launch-context
    // refusal fire anyway, as it would if the two checks ever disagreed.
    vi.stubEnv('CLAWX_E2E_ALLOW_GATEWAY', '1');
    const { manager, internals, guard } = await loadManager();
    mockPrepareLaunchContext.mockImplementation(async (port: number) => {
      throw new guard.E2EGatewayLaunchRefusedError('gateway-launch', `port=${port}`);
    });
    internals.status = { state: 'running', port: 18789 };
    vi.spyOn(manager, 'stop').mockImplementation(async () => {
      internals.status = { state: 'stopped', port: 18789 };
    });
    const scheduleReconnectSpy = vi.spyOn(internals, 'scheduleReconnect');

    await expect(manager.restart()).rejects.toBeInstanceOf(guard.E2EGatewayLaunchRefusedError);

    expect(mockPrepareLaunchContext).toHaveBeenCalledTimes(1);
    expect(mockLaunchGatewayProcess).not.toHaveBeenCalled();
    expect(mockRunOpenClawDoctorRepair).not.toHaveBeenCalled();
    expect(scheduleReconnectSpy).not.toHaveBeenCalled();
    expect(internals.status.state).toBe('stopped');
    expect(internals.status.error).toContain(guard.E2E_GATEWAY_LAUNCH_REFUSED_CODE);
    expect(internals.startLock).toBe(false);
  });

  it('runs the normal startup sequence, orphan scan included, when the spec opts in with CLAWX_E2E_ALLOW_GATEWAY=1', async () => {
    vi.stubEnv('CLAWX_E2E_ALLOW_GATEWAY', '1');
    const { manager, internals, guard } = await loadManager();

    const rejection = await manager.start().catch((error: unknown) => error);

    expect(guard.isE2EGatewayLaunchRefusedError(rejection)).toBe(false);
    expect((rejection as Error).message).toContain('guard passed');
    expect(mockRunGatewayStartupSequence).toHaveBeenCalledTimes(1);
    expect(mockFindExistingGatewayProcess).toHaveBeenCalledTimes(1);
    expect(mockFindExistingGatewayProcess).toHaveBeenCalledWith({ port: 18789, ownedPid: undefined });
    expect(mockWarmupManagedPythonReadiness).toHaveBeenCalledTimes(1);
    expect(mockLoadOrCreateDeviceIdentity).toHaveBeenCalledTimes(1);
    expect(mockPrepareLaunchContext).toHaveBeenCalledTimes(1);
    expect(internals.status.state).toBe('error');
  });

  it('is unchanged outside E2E mode: scans for an existing Gateway and a start failure still enters "error"', async () => {
    vi.stubEnv('CLAWX_E2E', '');
    const { manager, internals } = await loadManager();

    const rejection = await manager.start().catch((error: unknown) => error);

    expect((rejection as Error).message).toContain('guard passed');
    expect(mockRunGatewayStartupSequence).toHaveBeenCalledTimes(1);
    expect(mockFindExistingGatewayProcess).toHaveBeenCalledTimes(1);
    expect(mockWarmupManagedPythonReadiness).toHaveBeenCalledTimes(1);
    expect(mockLoadOrCreateDeviceIdentity).toHaveBeenCalledTimes(1);
    expect(internals.status.state).toBe('error');
  });
});
