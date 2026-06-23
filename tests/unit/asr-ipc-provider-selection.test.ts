import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { app, ipcMain } from 'electron';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';

const mocks = vi.hoisted(() => ({
  getAzureSpeechConfig: vi.fn(),
  isAzureSpeechConfigured: vi.fn(),
  runAzureStreamingForRenderer: vi.fn(),
  transcribeAzureShort: vi.fn(),
  transcribeMacNative: vi.fn(),
  transcribeWindowsNative: vi.fn(),
}));

vi.mock('@electron/services/azure-speech/store', () => ({
  getAzureSpeechConfig: mocks.getAzureSpeechConfig,
  isAzureSpeechConfigured: mocks.isAzureSpeechConfigured,
}));

vi.mock('@electron/main/asr-azure', () => ({
  AzureSpeechNotConfigured: class AzureSpeechNotConfigured extends Error {},
  transcribeAzureShort: mocks.transcribeAzureShort,
}));

vi.mock('@electron/main/asr-azure-ipc', () => ({
  runAzureStreamingForRenderer: mocks.runAzureStreamingForRenderer,
}));

vi.mock('@electron/main/asr-native-mac', () => ({
  MacAsrError: class MacAsrError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message);
    }
  },
  transcribeMacNative: mocks.transcribeMacNative,
}));

vi.mock('@electron/main/asr-native-windows', () => ({
  WINDOWS_ASR_ERROR_CODES: {
    BINARY_MISSING: 'MIC_BINARY_MISSING',
    PERMISSION_DENIED: 'MIC_PERMISSION',
    AUDIO_NOT_FOUND: 'NO_AUDIO',
    TIMEOUT: 'ASR_TIMEOUT',
    FAILED: 'ASR_FAILED',
    WRONG_PLATFORM: 'WRONG_PLATFORM',
  },
  WindowsAsrError: class WindowsAsrError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message);
    }
  },
  transcribeWindowsNative: mocks.transcribeWindowsNative,
}));

type IpcHandler = (_event: unknown, args: unknown) => Promise<unknown>;

const originalPlatform = process.platform;
const originalEnv = {
  CLAWX_PREFER_AZURE_SPEECH: process.env.CLAWX_PREFER_AZURE_SPEECH,
  CLAWX_PREFER_NATIVE_ASR: process.env.CLAWX_PREFER_NATIVE_ASR,
};

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    value: platform,
    configurable: true,
  });
}

function restoreEnv(): void {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function getRegisteredHandler(channel: string): IpcHandler {
  const handleMock = ipcMain.handle as unknown as Mock;
  const call = handleMock.mock.calls.find(([name]) => name === channel);
  if (!call) throw new Error(`No IPC handler registered for ${channel}`);
  return call[1] as IpcHandler;
}

describe('ASR provider selection', () => {
  let tempRoot: string;
  let audioPath: string;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    setPlatform('win32');
    process.env.CLAWX_PREFER_AZURE_SPEECH = '1';
    process.env.CLAWX_PREFER_NATIVE_ASR = '1';

    tempRoot = await mkdtemp(path.join(tmpdir(), 'clawx-asr-provider-test-'));
    audioPath = path.join(tempRoot, 'clip.wav');
    await writeFile(audioPath, Buffer.from('RIFF----WAVEfmt data', 'ascii'));

    vi.mocked(app.getPath).mockReturnValue(tempRoot);
    vi.mocked(ipcMain.handle).mockClear();
    mocks.getAzureSpeechConfig.mockResolvedValue({
      region: 'eastus',
      apiKey: 'test-key',
      locale: 'en-TT',
    });
    mocks.isAzureSpeechConfigured.mockReturnValue(true);
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
    setPlatform(originalPlatform);
    restoreEnv();
    vi.resetModules();
  });

  it('uses configured Azure Speech when it returns transcript text', async () => {
    mocks.transcribeAzureShort.mockResolvedValue({
      text: '  Prepare the morning briefing.  ',
      language: 'en-TT',
    });

    const { registerAsrIpcHandlers } = await import('@electron/main/asr-ipc');
    registerAsrIpcHandlers();
    const transcribe = getRegisteredHandler('asr:transcribe');

    const result = await transcribe(null, { audioPath, language: 'en-TT' });

    expect(result).toEqual({
      ok: true,
      data: {
        text: 'Prepare the morning briefing.',
        language: 'en-TT',
        backend: 'azure-speech',
      },
    });
    expect(mocks.transcribeWindowsNative).not.toHaveBeenCalled();
  });

  it('falls back to Windows native ASR when Azure returns no text', async () => {
    mocks.transcribeAzureShort.mockResolvedValue({
      text: ' ',
      language: 'en-TT',
    });
    mocks.transcribeWindowsNative.mockResolvedValue({
      text: 'Open the daily attendance form.',
      language: 'en-US',
    });

    const { registerAsrIpcHandlers } = await import('@electron/main/asr-ipc');
    registerAsrIpcHandlers();
    const transcribe = getRegisteredHandler('asr:transcribe');

    const result = await transcribe(null, { audioPath, language: 'en-TT' });

    expect(result).toEqual({
      ok: true,
      data: {
        text: 'Open the daily attendance form.',
        language: 'en-US',
        backend: 'windows-native',
      },
    });
    expect(mocks.transcribeWindowsNative).toHaveBeenCalledWith(audioPath, {
      language: 'en-TT',
      timeoutMs: 30_000,
    });
  });

  it('falls back to Windows native ASR when Azure throws', async () => {
    mocks.transcribeAzureShort.mockRejectedValue(new Error('Azure request failed'));
    mocks.transcribeWindowsNative.mockResolvedValue({
      text: 'Open Outlook and read my inbox.',
      language: 'en-US',
    });

    const { registerAsrIpcHandlers } = await import('@electron/main/asr-ipc');
    registerAsrIpcHandlers();
    const transcribe = getRegisteredHandler('asr:transcribe');

    const result = await transcribe(null, { audioPath, language: 'en-TT' });

    expect(result).toEqual({
      ok: true,
      data: {
        text: 'Open Outlook and read my inbox.',
        language: 'en-US',
        backend: 'windows-native',
      },
    });
    expect(JSON.stringify(result)).not.toContain('test-key');
  });

  it('preserves Windows microphone permission errors instead of masking them with Whisper fallback', async () => {
    const { WindowsAsrError } = await import('@electron/main/asr-native-windows');
    mocks.transcribeAzureShort.mockResolvedValue({
      text: '',
      language: 'en-TT',
    });
    mocks.transcribeWindowsNative.mockRejectedValue(
      new WindowsAsrError('MIC_PERMISSION', 'Microphone access is blocked in Windows privacy settings'),
    );

    const { registerAsrIpcHandlers } = await import('@electron/main/asr-ipc');
    registerAsrIpcHandlers();
    const transcribe = getRegisteredHandler('asr:transcribe');

    const result = await transcribe(null, { audioPath, language: 'en-TT' });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'MIC_PERMISSION',
        message: 'Microphone access is blocked in Windows privacy settings',
      },
    });
  });

  it('returns an actionable Windows ASR packaging error when native and Whisper are unavailable', async () => {
    const { WindowsAsrError } = await import('@electron/main/asr-native-windows');
    mocks.transcribeAzureShort.mockResolvedValue({
      text: '',
      language: 'en-TT',
    });
    mocks.transcribeWindowsNative.mockRejectedValue(
      new WindowsAsrError('MIC_BINARY_MISSING', 'WinSpeechRecognize.exe missing'),
    );

    const { registerAsrIpcHandlers } = await import('@electron/main/asr-ipc');
    registerAsrIpcHandlers();
    const transcribe = getRegisteredHandler('asr:transcribe');

    const result = await transcribe(null, { audioPath, language: 'en-TT' });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'NO_WHISPER',
        message: expect.stringContaining('Rebuild with pnpm run prep:win-binaries'),
      },
    });
    expect(JSON.stringify(result)).toContain('WinSpeechRecognize.exe');
    expect(JSON.stringify(result)).not.toContain('test-key');
  });
});
