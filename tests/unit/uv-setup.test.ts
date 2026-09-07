// @vitest-environment node
import { EventEmitter } from 'events';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type SpawnCall = {
  command: string;
  args: string[];
};

function createMockChild(code: number, stdout?: string) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();

  process.nextTick(() => {
    if (stdout) {
      child.stdout.emit('data', Buffer.from(stdout));
    }
    child.emit('close', code);
  });

  return child;
}

describe('uv managed Python setup', () => {
  let spawnCalls: SpawnCall[];
  let spawnMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    spawnCalls = [];
    spawnMock = vi.fn();

    vi.doMock('electron', () => ({
      app: {
        isPackaged: false,
        getPath: vi.fn().mockReturnValue('/tmp/clawx-test'),
        getAppPath: vi.fn().mockReturnValue(process.cwd()),
        whenReady: vi.fn().mockResolvedValue(undefined),
        isReady: vi.fn().mockReturnValue(true),
      },
    }));

    vi.doMock('fs', async () => {
      const actual = await vi.importActual<typeof import('fs')>('fs');
      return {
        ...actual,
        existsSync: vi.fn().mockReturnValue(true),
      };
    });

    vi.doMock('child_process', async () => {
      const actual = await vi.importActual<typeof import('child_process')>('child_process');
      return {
        ...actual,
        execSync: vi.fn(),
        spawn: spawnMock,
      };
    });

    vi.doMock('@electron/utils/uv-env', () => ({
      getUvMirrorEnv: vi.fn().mockResolvedValue({}),
    }));

    vi.doMock('@electron/utils/logger', () => ({
      logger: {
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
      },
    }));

    vi.doMock('@electron/utils/paths', () => ({
      needsWinShell: vi.fn().mockReturnValue(false),
      quoteForCmd: (value: string) => value,
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('deduplicates concurrent Python setup calls', async () => {
    spawnMock.mockImplementation((command: string, args: string[]) => {
      spawnCalls.push({ command, args });

      if (args.join(' ') === 'python find 3.12' && spawnCalls.length === 1) {
        return createMockChild(1);
      }
      if (args.join(' ') === 'python install 3.12') {
        return createMockChild(0);
      }
      if (args.join(' ') === 'python find 3.12') {
        return createMockChild(0, path.join('/tmp', 'python', 'python.exe'));
      }

      return createMockChild(1);
    });

    const { setupManagedPython } = await import('@electron/utils/uv-setup');

    await Promise.all([
      setupManagedPython(),
      setupManagedPython(),
    ]);

    const installCalls = spawnCalls.filter((call) => call.args.join(' ') === 'python install 3.12');
    expect(installCalls).toHaveLength(1);
  });

  it('skips install when managed Python is already available', async () => {
    spawnMock.mockImplementation((command: string, args: string[]) => {
      spawnCalls.push({ command, args });
      return createMockChild(0, path.join('/tmp', 'python', 'python.exe'));
    });

    const { setupManagedPython } = await import('@electron/utils/uv-setup');

    await setupManagedPython();

    expect(spawnCalls.map((call) => call.args.join(' '))).toEqual(['python find 3.12']);
  });
});
