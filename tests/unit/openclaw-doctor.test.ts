import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const MAX_DOCTOR_OUTPUT_BYTES = 10 * 1024 * 1024;

const {
  mockExistsSync,
  mockFork,
  mockGetUvMirrorEnv,
  mockLoggerWarn,
  mockLoggerInfo,
  mockLoggerError,
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockFork: vi.fn(),
  mockGetUvMirrorEnv: vi.fn(),
  mockLoggerWarn: vi.fn(),
  mockLoggerInfo: vi.fn(),
  mockLoggerError: vi.fn(),
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
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

vi.mock('@electron/utils/logger', () => ({
  logger: {
    warn: mockLoggerWarn,
    info: mockLoggerInfo,
    error: mockLoggerError,
  },
}));

class MockUtilityChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
}

describe('openclaw doctor output handling', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();

    mockExistsSync.mockReturnValue(true);
    mockGetUvMirrorEnv.mockResolvedValue({});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('forks the doctor through the Node-mode entry shim and strips ELECTRON_RUN_AS_NODE (CLWX-136)', async () => {
    // Seed the parent env so the no-flag assertion is a real strip pin.
    vi.stubEnv('ELECTRON_RUN_AS_NODE', '1');
    const child = new MockUtilityChild();
    mockFork.mockReturnValue(child);

    const { runOpenClawDoctor } = await import('@electron/utils/openclaw-doctor');
    const resultPromise = runOpenClawDoctor();

    await vi.waitFor(() => {
      expect(mockFork).toHaveBeenCalledTimes(1);
    });
    const [entry, , forkOptions] = mockFork.mock.calls[0];
    expect(entry).toBe('/tmp/resources/gateway/clawx-gateway-node-mode-entry.mjs');
    expect(forkOptions.env.CLAWX_GATEWAY_REAL_ENTRY).toBe('/tmp/openclaw/openclaw-entry.js');
    expect(forkOptions.env).not.toHaveProperty('ELECTRON_RUN_AS_NODE');

    child.emit('exit', 0);
    const result = await resultPromise;
    expect(result.success).toBe(true);
  });

  it('collects normal output under the buffer limit', async () => {
    const child = new MockUtilityChild();
    mockFork.mockReturnValue(child);

    const { runOpenClawDoctor } = await import('@electron/utils/openclaw-doctor');
    const resultPromise = runOpenClawDoctor();

    await vi.waitFor(() => {
      expect(mockFork).toHaveBeenCalledTimes(1);
    });
    child.stdout.emit('data', Buffer.from('doctor ok\n'));
    child.emit('exit', 0);

    const result = await resultPromise;
    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('doctor ok\n');
    expect(result.stderr).toBe('');
    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });

  it('truncates output when stdout exceeds MAX_DOCTOR_OUTPUT_BYTES', async () => {
    const child = new MockUtilityChild();
    mockFork.mockReturnValue(child);

    const { runOpenClawDoctor } = await import('@electron/utils/openclaw-doctor');
    const resultPromise = runOpenClawDoctor();

    await vi.waitFor(() => {
      expect(mockFork).toHaveBeenCalledTimes(1);
    });
    child.stdout.emit('data', Buffer.from('a'.repeat(MAX_DOCTOR_OUTPUT_BYTES - 5)));
    child.stdout.emit('data', Buffer.from('b'.repeat(10)));
    child.stdout.emit('data', Buffer.from('c'.repeat(1000)));
    child.emit('exit', 0);

    const result = await resultPromise;
    expect(result.stdout.length).toBe(MAX_DOCTOR_OUTPUT_BYTES);
    expect(result.stdout.endsWith('bbbbb')).toBe(true);
    expect(result.stdout.includes('c')).toBe(false);
  });

  it('logs a warning when truncation occurs', async () => {
    const child = new MockUtilityChild();
    mockFork.mockReturnValue(child);

    const { runOpenClawDoctor } = await import('@electron/utils/openclaw-doctor');
    const resultPromise = runOpenClawDoctor();

    await vi.waitFor(() => {
      expect(mockFork).toHaveBeenCalledTimes(1);
    });
    child.stdout.emit('data', Buffer.from('x'.repeat(MAX_DOCTOR_OUTPUT_BYTES + 1)));
    child.emit('exit', 0);

    await resultPromise;
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      `OpenClaw doctor stdout exceeded ${MAX_DOCTOR_OUTPUT_BYTES} bytes; truncating additional output`,
    );
  });

  it('collects stdout and stderr independently', async () => {
    const child = new MockUtilityChild();
    mockFork.mockReturnValue(child);

    const { runOpenClawDoctor } = await import('@electron/utils/openclaw-doctor');
    const resultPromise = runOpenClawDoctor();

    await vi.waitFor(() => {
      expect(mockFork).toHaveBeenCalledTimes(1);
    });
    child.stdout.emit('data', Buffer.from('line-1\n'));
    child.stderr.emit('data', Buffer.from('warn-1\n'));
    child.stdout.emit('data', Buffer.from('line-2\n'));
    child.stderr.emit('data', Buffer.from('warn-2\n'));
    child.emit('exit', 1);

    const result = await resultPromise;
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('line-1\nline-2\n');
    expect(result.stderr).toBe('warn-1\nwarn-2\n');
  });

  it('runs plain doctor command without --json', async () => {
    const child = new MockUtilityChild();
    mockFork.mockReturnValue(child);

    const { runOpenClawDoctor } = await import('@electron/utils/openclaw-doctor');
    const resultPromise = runOpenClawDoctor();

    await vi.waitFor(() => {
      expect(mockFork).toHaveBeenCalledTimes(1);
    });
    child.stdout.emit('data', Buffer.from('doctor ok\n'));
    child.emit('exit', 0);

    const result = await resultPromise;
    expect(result.success).toBe(true);
    expect(result.command).toBe('openclaw doctor');
    expect(mockFork.mock.calls[0][1]).toEqual(['doctor']);
  });

  // CLWX-102: Developer Doctor actions fork a real OpenClaw process too.
  it('refuses to fork the doctor in E2E mode without the explicit opt-in and reports a typed failure', async () => {
    vi.stubEnv('CLAWX_E2E', '1');
    vi.stubEnv('CLAWX_E2E_ALLOW_GATEWAY', '');

    const { runOpenClawDoctor, runOpenClawDoctorFix } = await import('@electron/utils/openclaw-doctor');
    const diagnose = await runOpenClawDoctor();
    const fix = await runOpenClawDoctorFix();

    expect(mockFork).not.toHaveBeenCalled();
    expect(diagnose.success).toBe(false);
    expect(diagnose.exitCode).toBeNull();
    expect(diagnose.error).toContain('E2E_GATEWAY_LAUNCH_REFUSED');
    expect(diagnose.command).toBe('openclaw doctor');
    expect(fix.success).toBe(false);
    expect(fix.error).toContain('E2E_GATEWAY_LAUNCH_REFUSED');
    expect(fix.command).toBe('openclaw doctor --fix --yes --non-interactive');
    expect(mockLoggerError).toHaveBeenCalledWith(expect.stringContaining('E2E_GATEWAY_LAUNCH_REFUSED'));
  });

  it('forks the doctor in E2E mode when the spec opts in with CLAWX_E2E_ALLOW_GATEWAY=1', async () => {
    vi.stubEnv('CLAWX_E2E', '1');
    vi.stubEnv('CLAWX_E2E_ALLOW_GATEWAY', '1');
    const child = new MockUtilityChild();
    mockFork.mockReturnValue(child);

    const { runOpenClawDoctor } = await import('@electron/utils/openclaw-doctor');
    const resultPromise = runOpenClawDoctor();

    await vi.waitFor(() => {
      expect(mockFork).toHaveBeenCalledTimes(1);
    });
    child.emit('exit', 0);
    const result = await resultPromise;
    expect(result.success).toBe(true);
  });

  it('ignores the opt-in variable outside E2E mode', async () => {
    vi.stubEnv('CLAWX_E2E', '');
    vi.stubEnv('CLAWX_E2E_ALLOW_GATEWAY', '0');
    const child = new MockUtilityChild();
    mockFork.mockReturnValue(child);

    const { runOpenClawDoctor } = await import('@electron/utils/openclaw-doctor');
    const resultPromise = runOpenClawDoctor();

    await vi.waitFor(() => {
      expect(mockFork).toHaveBeenCalledTimes(1);
    });
    child.emit('exit', 0);
    const result = await resultPromise;
    expect(result.success).toBe(true);
  });
});
