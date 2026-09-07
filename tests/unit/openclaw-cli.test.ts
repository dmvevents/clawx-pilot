import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalPlatform = process.platform;
const originalResourcesPath = process.resourcesPath;

const {
  mockExistsSync,
  mockIsPackagedGetter,
  mockSpawn,
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn<(path: string) => boolean>(),
  mockIsPackagedGetter: { value: false },
  mockSpawn: vi.fn(),
}));

function setPlatform(platform: string) {
  Object.defineProperty(process, 'platform', { value: platform, writable: true });
}

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return {
    ...actual,
    spawn: mockSpawn,
    default: {
      ...actual,
      spawn: mockSpawn,
    },
  };
});

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
    get isPackaged() {
      return mockIsPackagedGetter.value;
    },
    getName: () => 'ClawX',
  },
}));

vi.mock('@electron/utils/paths', () => ({
  getOpenClawDir: () => '/tmp/openclaw',
  getOpenClawEntryPath: () => 'C:\\Program Files\\ClawX\\resources\\openclaw\\openclaw.mjs',
}));

describe('getOpenClawCliCommand (Windows packaged)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    setPlatform('win32');
    mockIsPackagedGetter.value = true;
    Object.defineProperty(process, 'resourcesPath', {
      value: 'C:\\Program Files\\ClawX\\resources',
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true });
    Object.defineProperty(process, 'resourcesPath', {
      value: originalResourcesPath,
      configurable: true,
      writable: true,
    });
  });

  it('prefers bundled node.exe when present', async () => {
    mockExistsSync.mockImplementation((p: string) => /[\\/]cli[\\/]openclaw\.cmd$/i.test(p) || /[\\/]bin[\\/]node\.exe$/i.test(p));
    const { getOpenClawCliCommand } = await import('@electron/utils/openclaw-cli');
    const command = getOpenClawCliCommand();
    expect(command.replace(/\\/g, '/')).toBe(
      "& 'C:/Program Files/ClawX/resources/cli/openclaw.cmd'",
    );
  });

  it('falls back to bundled node.exe when openclaw.cmd is missing', async () => {
    mockExistsSync.mockImplementation((p: string) => /[\\/]bin[\\/]node\.exe$/i.test(p));
    const { getOpenClawCliCommand } = await import('@electron/utils/openclaw-cli');
    const command = getOpenClawCliCommand();
    expect(command.replace(/\\/g, '/')).toBe(
      "& 'C:/Program Files/ClawX/resources/bin/node.exe' 'C:/Program Files/ClawX/resources/openclaw/openclaw.mjs'",
    );
  });

  it('falls back to ELECTRON_RUN_AS_NODE command when wrappers are missing', async () => {
    mockExistsSync.mockReturnValue(false);
    const { getOpenClawCliCommand } = await import('@electron/utils/openclaw-cli');
    const command = getOpenClawCliCommand();
    expect(command.startsWith('$env:ELECTRON_RUN_AS_NODE=1; & ')).toBe(true);
    expect(command.endsWith("'C:\\Program Files\\ClawX\\resources\\openclaw\\openclaw.mjs'")).toBe(true);
  });
});

describe('generateCompletionCache', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockIsPackagedGetter.value = true;
    mockExistsSync.mockReturnValue(true);
    mockSpawn.mockReturnValue({ on: vi.fn() });
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true });
  });

  it('does not spawn the completion cache child on Windows startup', async () => {
    setPlatform('win32');
    const { generateCompletionCache } = await import('@electron/utils/openclaw-cli');

    generateCompletionCache();

    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('still spawns completion cache generation on supported packaged platforms', async () => {
    setPlatform('linux');
    const { generateCompletionCache } = await import('@electron/utils/openclaw-cli');

    generateCompletionCache();

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const [execPath, args, options] = mockSpawn.mock.calls[0];
    expect(execPath).toBe(process.execPath);
    expect(args).toEqual(['C:\\Program Files\\ClawX\\resources\\openclaw\\openclaw.mjs', 'completion', '--write-state']);
    expect(options).toEqual(expect.objectContaining({
      stdio: 'ignore',
      detached: false,
      windowsHide: true,
    }));
    expect(options.env.ELECTRON_RUN_AS_NODE).toBe('1');
    expect(options.env.OPENCLAW_NO_RESPAWN).toBe('1');
    expect(options.env.OPENCLAW_EMBEDDED_IN).toBe('ClawX');
  });
});
