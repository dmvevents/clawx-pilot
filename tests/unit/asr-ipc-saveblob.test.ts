import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { app, ipcMain } from 'electron';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { access, mkdtemp, writeFile } from 'node:fs/promises';
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

async function writeFakeFfmpeg(dir: string): Promise<string> {
  const scriptPath = path.join(dir, 'fake-ffmpeg.sh');
  await writeFile(
    scriptPath,
    `#!/bin/sh
input=""
previous=""
output=""
for arg in "$@"; do
  if [ "$previous" = "-i" ]; then
    input="$arg"
  fi
  previous="$arg"
  output="$arg"
done
if [ -z "$input" ] || [ -z "$output" ]; then
  echo "missing input or output" >&2
  exit 2
fi
if [ "$input" = "$output" ]; then
  echo "input and output must differ" >&2
  exit 64
fi
cp "$input" "$output"
`,
    { mode: 0o755 },
  );
  return scriptPath;
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

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), 'clawx-asr-saveblob-test-'));
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

  // The fake ffmpeg shim is a POSIX shell script; execFile on Windows can't
  // launch shell scripts directly (the real prod ffmpeg is an .exe). The
  // behaviour exercised here -- not asking ffmpeg to overwrite its own input --
  // is platform-agnostic application logic, but the test harness needs a
  // POSIX-capable host to drive it.
  it.skipIf(process.platform === 'win32')('normalizes renderer WAV captures without asking ffmpeg to overwrite the input file', async () => {
    process.env.FFMPEG_PATH = await writeFakeFfmpeg(tempRoot);
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
