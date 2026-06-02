import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { app, ipcMain } from 'electron';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { access, mkdtemp, writeFile } from 'node:fs/promises';

// Mock node:child_process before importing the module under test so that
// the real ffmpeg binary is never invoked. This keeps the test runnable on
// Windows hosts where the previous shell-script shim could not be exec'd
// (Node's CVE-2024-27980 mitigation refuses to launch .cmd/.bat via
// execFile without shell:true, and a plain .exe shim isn't available).
// The behaviour under test -- asr:saveBlob must not ask ffmpeg to overwrite
// its own input WAV (see WINDOWS_PROBLEMS_ATLAS §14) -- is platform-agnostic
// application logic, so a fake exec that asserts the invariant directly is
// stronger than spawning a real subprocess.
//
// vi.hoisted ensures the fake is created before vi.mock factories run, since
// vi.mock is hoisted above all imports. The require() inside the fake helper
// is necessary because static imports are not yet evaluated at hoist time;
// the resulting module is the same object the real production code receives.
const { fakeExecFile } = vi.hoisted(() => {
  type ExecFileCallback = (err: Error | null, stdout: string, stderr: string) => void;
  return {
    fakeExecFile: (
      _file: string,
      args: readonly string[] | undefined,
      options: unknown,
      callback?: ExecFileCallback,
    ): unknown => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted helper runs before imports are evaluated.
      const { copyFile } = require('node:fs/promises') as typeof import('node:fs/promises');
      const cb: ExecFileCallback | null =
        typeof callback === 'function'
          ? callback
          : typeof options === 'function'
            ? (options as ExecFileCallback)
            : null;
      const argv = Array.from(args ?? []);
      const inputIdx = argv.indexOf('-i');
      const input = inputIdx !== -1 ? argv[inputIdx + 1] : '';
      const output = argv[argv.length - 1] ?? '';
      if (!input || !output) {
        cb?.(new Error('missing input or output'), '', 'missing input or output');
        return {};
      }
      if (input === output) {
        cb?.(new Error('input and output must differ'), '', 'in-place edit blocked');
        return {};
      }
      copyFile(input, output)
        .then(() => cb?.(null, '', ''))
        .catch((err: unknown) => cb?.(err as Error, '', String(err)));
      return {};
    },
  };
});

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const stub = { ...actual, execFile: fakeExecFile as unknown as typeof actual.execFile };
  return { ...stub, default: stub };
});

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  const stub = { ...actual, execFile: fakeExecFile as unknown as typeof actual.execFile };
  return { ...stub, default: stub };
});

import { _resetAsrIpcCaches, registerAsrIpcHandlers } from '@electron/main/asr-ipc';

type IpcHandler = (_event: unknown, args: unknown) => Promise<unknown>;

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function getRegisteredHandler(channel: string): IpcHandler {
  const handleMock = ipcMain.handle as unknown as Mock;
  const call = handleMock.mock.calls.find(([name]) => name === channel);
  if (!call) throw new Error(`No IPC handler registered for ${channel}`);
  return call[1] as IpcHandler;
}

describe('ASR saveBlob IPC', () => {
  const originalFfmpegPath = process.env.FFMPEG_PATH;
  let tempRoot: string;
  let fakeFfmpegPath: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), 'clawx-asr-saveblob-test-'));
    fakeFfmpegPath = path.join(tempRoot, 'fake-ffmpeg-marker');
    // resolveFfmpegBinary() requires the path to exist on disk before it
    // accepts FFMPEG_PATH. The mocked execFile never actually runs it.
    await writeFile(fakeFfmpegPath, '');
    vi.mocked(app.getPath).mockReturnValue(tempRoot);
    vi.mocked(ipcMain.handle).mockClear();
    _resetAsrIpcCaches();
  });

  afterEach(() => {
    if (originalFfmpegPath == null) {
      delete process.env.FFMPEG_PATH;
    } else {
      process.env.FFMPEG_PATH = originalFfmpegPath;
    }
    _resetAsrIpcCaches();
  });

  it('normalizes renderer WAV captures without asking ffmpeg to overwrite the input file', async () => {
    process.env.FFMPEG_PATH = fakeFfmpegPath;
    _resetAsrIpcCaches();
    registerAsrIpcHandlers();

    const saveBlob = getRegisteredHandler('asr:saveBlob');
    const wavBytes = Buffer.from('RIFF----WAVEfmt data', 'ascii');
    const result = await saveBlob(null, {
      mime: 'audio/wav',
      suggestedExt: 'wav',
      base64: wavBytes.toString('base64'),
    }) as {
      ok: boolean;
      data?: { path: string; bytes: number; transcoded: boolean };
      error?: { message: string };
    };

    expect(result).toMatchObject({
      ok: true,
      data: {
        bytes: wavBytes.length,
        transcoded: true,
      },
    });
    expect(result.data?.path).toBe(path.join(path.dirname(result.data?.path ?? ''), 'clip.wav'));
    await expect(pathExists(path.join(path.dirname(result.data?.path ?? ''), 'clip-input.wav'))).resolves.toBe(false);
  });
});
