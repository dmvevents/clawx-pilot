import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp',
    isPackaged: false,
  },
  utilityProcess: {
    fork: vi.fn(),
  },
}));

describe('GatewayManager heartbeat recovery', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-19T00:00:00.000Z'));
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('restarts after consecutive heartbeat misses reach threshold', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });

    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();

    const ws = {
      readyState: 1, // WebSocket.OPEN
      ping: vi.fn(),
      terminate: vi.fn(),
      on: vi.fn(),
    };

    (manager as unknown as { ws: typeof ws }).ws = ws;
    (manager as unknown as { shouldReconnect: boolean }).shouldReconnect = true;
    (manager as unknown as { status: { state: string; port: number } }).status = {
      state: 'running',
      port: 18789,
    };
    const restartSpy = vi.spyOn(manager, 'restart').mockResolvedValue();

    (manager as unknown as { startPing: () => void }).startPing();

    vi.advanceTimersByTime(120_000);

    expect(ws.ping).toHaveBeenCalledTimes(3);
    expect(ws.terminate).not.toHaveBeenCalled();
    expect(restartSpy).toHaveBeenCalledTimes(1);

    (manager as unknown as { connectionMonitor: { clear: () => void } }).connectionMonitor.clear();
  });

  it('defers heartbeat restart while initial gateway.ready is still within grace', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });

    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();

    const ws = {
      readyState: 1,
      ping: vi.fn(),
      terminate: vi.fn(),
      on: vi.fn(),
    };

    const connectedAt = Date.now();
    (manager as unknown as { ws: typeof ws }).ws = ws;
    (manager as unknown as { shouldReconnect: boolean }).shouldReconnect = true;
    (manager as unknown as { status: { state: string; port: number; connectedAt: number; gatewayReady: boolean } }).status = {
      state: 'running',
      port: 18789,
      connectedAt,
      gatewayReady: false,
    };
    const restartSpy = vi.spyOn(manager, 'restart').mockResolvedValue();

    (manager as unknown as { startPing: () => void }).startPing();

    vi.advanceTimersByTime(120_000);
    expect(restartSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(179_999);
    expect(restartSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(restartSpy).toHaveBeenCalledTimes(1);

    (manager as unknown as { connectionMonitor: { clear: () => void } }).connectionMonitor.clear();
  });

  it('does not restart when heartbeat is recovered by incoming messages', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });

    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();

    const ws = {
      readyState: 1, // WebSocket.OPEN
      ping: vi.fn(),
      terminate: vi.fn(),
      on: vi.fn(),
    };

    (manager as unknown as { ws: typeof ws }).ws = ws;
    (manager as unknown as { shouldReconnect: boolean }).shouldReconnect = true;
    (manager as unknown as { status: { state: string; port: number } }).status = {
      state: 'running',
      port: 18789,
    };
    const restartSpy = vi.spyOn(manager, 'restart').mockResolvedValue();

    (manager as unknown as { startPing: () => void }).startPing();

    vi.advanceTimersByTime(30_000); // ping #1
    vi.advanceTimersByTime(30_000); // miss #1 + ping #2
    (manager as unknown as { handleMessage: (message: unknown) => void }).handleMessage('alive');

    vi.advanceTimersByTime(30_000); // recovered, ping #3
    vi.advanceTimersByTime(30_000); // miss #1 + ping #4
    vi.advanceTimersByTime(30_000); // miss #2 + ping #5

    expect(ws.terminate).not.toHaveBeenCalled();
    expect(restartSpy).not.toHaveBeenCalled();
    // Sanity-check the timing scaffolding: with the non-Windows constants, the
    // 150_000ms window above must drive at least 4 pings. If the Windows
    // constants ever leak in, ping count would drop and this assertion would
    // catch the regression instead of the test passing vacuously.
    expect(ws.ping.mock.calls.length).toBeGreaterThanOrEqual(4);

    (manager as unknown as { connectionMonitor: { clear: () => void } }).connectionMonitor.clear();
  });

  it('skips heartbeat recovery when auto-reconnect is disabled', async () => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();

    const ws = {
      readyState: 1,
      ping: vi.fn(),
      terminate: vi.fn(),
      on: vi.fn(),
    };

    (manager as unknown as { ws: typeof ws }).ws = ws;
    (manager as unknown as { shouldReconnect: boolean }).shouldReconnect = false;
    (manager as unknown as { status: { state: string; port: number } }).status = {
      state: 'running',
      port: 18789,
    };
    const restartSpy = vi.spyOn(manager, 'restart').mockResolvedValue();

    (manager as unknown as { startPing: () => void }).startPing();

    vi.advanceTimersByTime(120_000);

    expect(restartSpy).not.toHaveBeenCalled();

    (manager as unknown as { connectionMonitor: { clear: () => void } }).connectionMonitor.clear();
  });

  // ---------------------------------------------------------------------------
  // CLWX-95: post-ready Windows heartbeat loss must be corroborated by a
  // bounded real Gateway RPC before any recovery.  Windows heartbeat constants
  // are interval=60s, timeout=25s, maxMisses=5, so the first heartbeat timeout
  // callback fires at t=360s (ping #1 at 60s, misses at 120..360s).
  // ---------------------------------------------------------------------------

  const WIN_FIRST_TIMEOUT_MS = 360_000;
  const WIN_PROBE_TIMEOUT_MS = 10_000;
  const WIN_PROBE_RETRY_MS = 15_000;

  type WindowsInternals = {
    ws: unknown;
    shouldReconnect: boolean;
    ownsProcess: boolean;
    status: Record<string, unknown>;
    startPing: () => void;
    handleHeartbeatTimeout: (context: { consecutiveMisses: number; timeoutMs: number }) => void;
    connectionMonitor: { clear: () => void; getConsecutiveMisses: () => number };
    lifecycleController: { bump: (reason: string) => number };
    rpc: (method: string, params?: unknown, timeoutMs?: number) => Promise<unknown>;
  };

  function createDeferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  async function setupPostReadyWindowsManager() {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();
    const internals = manager as unknown as WindowsInternals;

    const ws = {
      readyState: 1,
      ping: vi.fn(),
      send: vi.fn(),
      terminate: vi.fn(),
      on: vi.fn(),
    };

    internals.ws = ws;
    internals.shouldReconnect = true;
    // Owned process: stop() must not issue a "shutdown" RPC through the mock.
    internals.ownsProcess = true;
    internals.status = {
      state: 'running',
      port: 18789,
      connectedAt: Date.now(),
      gatewayReady: true,
    };
    const restartSpy = vi.spyOn(manager, 'restart').mockResolvedValue();
    const rpcSpy = vi.spyOn(internals, 'rpc');
    return { manager, internals, ws, restartSpy, rpcSpy };
  }

  it('restarts a post-ready windows gateway once when missed pongs are corroborated by a failed bounded health probe', async () => {
    const { manager, internals, ws, restartSpy, rpcSpy } = await setupPostReadyWindowsManager();
    rpcSpy.mockRejectedValue(new Error('RPC timeout: health'));
    // Realistic restart: stop() tears down the socket and lifecycle epoch.
    restartSpy.mockImplementation(async () => {
      internals.ws = null;
      internals.status = { ...internals.status, state: 'stopped' };
      internals.lifecycleController.bump('test-restart');
    });

    internals.startPing();

    await vi.advanceTimersByTimeAsync(WIN_FIRST_TIMEOUT_MS);
    expect(ws.ping).toHaveBeenCalledTimes(5);
    // First probe failed; recovery must wait for the confirming probe.
    expect(rpcSpy).toHaveBeenCalledTimes(1);
    expect(rpcSpy).toHaveBeenCalledWith('health', { probe: false }, WIN_PROBE_TIMEOUT_MS);
    expect(restartSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(WIN_PROBE_RETRY_MS);
    expect(rpcSpy).toHaveBeenCalledTimes(2);
    expect(restartSpy).toHaveBeenCalledTimes(1);
    expect(ws.terminate).not.toHaveBeenCalled();

    const diagnostics = manager.getDiagnostics();
    expect(diagnostics.lastHeartbeatCorroborationResult).toBe('unhealthy');
    expect(diagnostics.lastHeartbeatCorroborationAt).toBe(Date.now());

    internals.connectionMonitor.clear();
  });

  it('does not restart a post-ready windows gateway whose health probe answers while pongs are missing, and probes again when it later hangs', async () => {
    const { manager, internals, restartSpy, rpcSpy } = await setupPostReadyWindowsManager();
    rpcSpy.mockResolvedValue({ ok: true });

    internals.startPing();

    await vi.advanceTimersByTimeAsync(WIN_FIRST_TIMEOUT_MS);
    expect(rpcSpy).toHaveBeenCalledTimes(1);
    expect(restartSpy).not.toHaveBeenCalled();
    // Healthy corroboration re-arms the heartbeat instead of leaving the
    // one-shot timeout latched.
    expect(internals.connectionMonitor.getConsecutiveMisses()).toBe(0);
    expect(manager.getDiagnostics().consecutiveHeartbeatMisses).toBe(0);
    expect(manager.getDiagnostics().lastHeartbeatCorroborationResult).toBe('healthy');

    // Still no pongs, but the probe keeps answering: no restart across a
    // second full miss window.
    await vi.advanceTimersByTimeAsync(WIN_FIRST_TIMEOUT_MS);
    expect(rpcSpy).toHaveBeenCalledTimes(2);
    expect(restartSpy).not.toHaveBeenCalled();

    // The gateway now hangs for real: the next miss window is corroborated
    // again and recovery fires exactly once.
    rpcSpy.mockRejectedValue(new Error('RPC timeout: health'));
    await vi.advanceTimersByTimeAsync(WIN_FIRST_TIMEOUT_MS + WIN_PROBE_RETRY_MS);
    expect(rpcSpy).toHaveBeenCalledTimes(4);
    expect(restartSpy).toHaveBeenCalledTimes(1);

    internals.connectionMonitor.clear();
  });

  it('treats a gateway-declared rpc error as a responsive gateway and does not restart', async () => {
    const { internals, restartSpy, rpcSpy } = await setupPostReadyWindowsManager();
    rpcSpy.mockRejectedValue(new Error('unknown method: health'));

    internals.startPing();

    await vi.advanceTimersByTimeAsync(WIN_FIRST_TIMEOUT_MS + WIN_PROBE_RETRY_MS);
    expect(rpcSpy).toHaveBeenCalledTimes(1);
    expect(restartSpy).not.toHaveBeenCalled();
    expect(internals.connectionMonitor.getConsecutiveMisses()).toBe(0);

    internals.connectionMonitor.clear();
  });

  it('runs one corroboration at a time when heartbeat timeouts overlap', async () => {
    const { internals, restartSpy, rpcSpy } = await setupPostReadyWindowsManager();
    const first = createDeferred<unknown>();
    rpcSpy.mockReturnValueOnce(first.promise).mockRejectedValue(new Error('RPC timeout: health'));

    internals.startPing();
    await vi.advanceTimersByTimeAsync(WIN_FIRST_TIMEOUT_MS);
    expect(rpcSpy).toHaveBeenCalledTimes(1);

    // A second timeout arriving while the first probe is still pending must
    // not start a second probe sequence.
    internals.handleHeartbeatTimeout({ consecutiveMisses: 6, timeoutMs: 25_000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(rpcSpy).toHaveBeenCalledTimes(1);

    first.reject(new Error('RPC timeout: health'));
    await vi.advanceTimersByTimeAsync(WIN_PROBE_RETRY_MS);
    expect(rpcSpy).toHaveBeenCalledTimes(2);
    expect(restartSpy).toHaveBeenCalledTimes(1);

    internals.connectionMonitor.clear();
  });

  it('cannot restart from a late failed probe after manual stop', async () => {
    const { manager, internals, restartSpy, rpcSpy } = await setupPostReadyWindowsManager();
    const pending = createDeferred<unknown>();
    rpcSpy.mockReturnValue(pending.promise);

    internals.startPing();
    await vi.advanceTimersByTimeAsync(WIN_FIRST_TIMEOUT_MS);
    expect(rpcSpy).toHaveBeenCalledTimes(1);

    await manager.stop();
    expect(internals.shouldReconnect).toBe(false);

    pending.reject(new Error('RPC timeout: health'));
    await vi.advanceTimersByTimeAsync(WIN_PROBE_RETRY_MS + WIN_PROBE_TIMEOUT_MS);
    expect(rpcSpy).toHaveBeenCalledTimes(1);
    expect(restartSpy).not.toHaveBeenCalled();
    expect(manager.getDiagnostics().lastHeartbeatCorroborationResult).toBe('aborted');
  });

  it('cannot restart from a late failed probe once a new connection replaced the probed socket', async () => {
    const { internals, restartSpy, rpcSpy } = await setupPostReadyWindowsManager();
    const pending = createDeferred<unknown>();
    rpcSpy.mockReturnValue(pending.promise);

    internals.startPing();
    await vi.advanceTimersByTimeAsync(WIN_FIRST_TIMEOUT_MS);
    expect(rpcSpy).toHaveBeenCalledTimes(1);

    // A reconnect completed underneath the probe: new socket, new connectedAt.
    internals.ws = { readyState: 1, ping: vi.fn(), send: vi.fn(), terminate: vi.fn(), on: vi.fn() };
    internals.status = { ...internals.status, connectedAt: Date.now() + 1 };

    pending.reject(new Error('RPC timeout: health'));
    await vi.advanceTimersByTimeAsync(WIN_PROBE_RETRY_MS + WIN_PROBE_TIMEOUT_MS);
    expect(rpcSpy).toHaveBeenCalledTimes(1);
    expect(restartSpy).not.toHaveBeenCalled();

    internals.connectionMonitor.clear();
  });

  it('re-arms rechecking when an unhealthy corroboration does not produce a restart', async () => {
    const { internals, restartSpy, rpcSpy } = await setupPostReadyWindowsManager();
    rpcSpy.mockRejectedValue(new Error('RPC timeout: health'));
    // restart() resolving without changing lifecycle models a governor
    // suppression / joined in-flight restart: same socket, still running.

    internals.startPing();

    await vi.advanceTimersByTimeAsync(WIN_FIRST_TIMEOUT_MS + WIN_PROBE_RETRY_MS);
    expect(restartSpy).toHaveBeenCalledTimes(1);

    // The one-shot heartbeat timeout must not stay latched.  After re-arm the
    // monitor sends one ping on the next tick and counts the miss on the tick
    // after, so re-corroboration and a second restart() request follow within
    // two intervals plus the probe retry delay.
    await vi.advanceTimersByTimeAsync(2 * 60_000 + WIN_PROBE_RETRY_MS);
    expect(rpcSpy).toHaveBeenCalledTimes(4);
    expect(restartSpy).toHaveBeenCalledTimes(2);

    internals.connectionMonitor.clear();
  });

  it('restarts on windows when initial gateway.ready never arrives and heartbeat times out', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });

    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();

    const ws = {
      readyState: 1,
      ping: vi.fn(),
      terminate: vi.fn(),
      on: vi.fn(),
    };

    (manager as unknown as { ws: typeof ws }).ws = ws;
    (manager as unknown as { shouldReconnect: boolean }).shouldReconnect = true;
    (manager as unknown as { status: { state: string; port: number; connectedAt: number; gatewayReady: boolean } }).status = {
      state: 'running',
      port: 18789,
      connectedAt: Date.now(),
      gatewayReady: false,
    };
    const restartSpy = vi.spyOn(manager, 'restart').mockResolvedValue();

    (manager as unknown as { startPing: () => void }).startPing();

    vi.advanceTimersByTime(400_000);

    expect(restartSpy).toHaveBeenCalledTimes(1);

    (manager as unknown as { connectionMonitor: { clear: () => void } }).connectionMonitor.clear();
  });
});
