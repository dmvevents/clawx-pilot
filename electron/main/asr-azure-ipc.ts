/**
 * IPC bridge for Azure Speech-to-Text (cloud fallback ASR).
 *
 * Channels:
 *   azure-speech:get-config        → { region, apiKey, locale }
 *   azure-speech:set-config(c)     → { ok }
 *   azure-speech:test              → { ok, text } | { ok: false, error }
 *
 * Streaming partials use the existing `asr:transcribe-stream` channel
 * (registered in asr-ipc.ts via wireAzureStreamingTo). Streaming partials are
 * emitted on the `asr:transcribe-partial` event channel (allow-listed in the
 * preload).
 *
 * Settings page consumes get-config / set-config / test. The Azure path is
 * never auto-attempted from the existing `asr:transcribe` handler unless the
 * `PREFER_AZURE_SPEECH` feature flag is true; otherwise native is primary and
 * Azure is only reachable via `azure-speech:test` or the streaming channel.
 */
import { BrowserWindow, ipcMain, app } from 'electron';
import path from 'node:path';
import { mkdtemp, writeFile, unlink } from 'node:fs/promises';
import { logger } from '../utils/logger';
import {
  getAzureSpeechConfig,
  setAzureSpeechConfig,
  isAzureSpeechConfigured,
  type AzureSpeechConfig,
} from '../services/azure-speech/store';
import {
  transcribeAzureShort,
  transcribeAzureStream,
  AzureSpeechNotConfigured,
  AzureSpeechAuthError,
  AzureSpeechTimeoutError,
  type AzureStreamingCallbacks,
} from './asr-azure';

let mainWindow: BrowserWindow | null = null;

export function setAzureSpeechWindow(window: BrowserWindow): void {
  mainWindow = window;
}

function classifyError(err: unknown): { code: string; message: string } {
  if (err instanceof AzureSpeechNotConfigured) {
    return { code: 'NOT_CONFIGURED', message: err.message };
  }
  if (err instanceof AzureSpeechAuthError) {
    return { code: 'AUTH', message: err.message };
  }
  if (err instanceof AzureSpeechTimeoutError) {
    return { code: 'TIMEOUT', message: err.message };
  }
  return {
    code: 'UNKNOWN',
    message: err instanceof Error ? err.message : String(err),
  };
}

/**
 * Build a 1-second silent 16-kHz mono WAV in memory. Used by the "Test
 * connection" button: Azure returns RecognitionStatus=NoMatch (with HTTP 200)
 * for clean silence, which is enough to prove that the region + key are valid
 * without sending any real audio.
 */
function buildSilentWavBuffer(): Buffer {
  const sampleRate = 16_000;
  const seconds = 1;
  const numSamples = sampleRate * seconds;
  const dataSize = numSamples * 2; // 16-bit mono
  const buffer = Buffer.alloc(44 + dataSize);
  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  // fmt chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);            // PCM
  buffer.writeUInt16LE(1, 22);            // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);            // block align
  buffer.writeUInt16LE(16, 34);           // bits per sample
  // data chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  // Samples already zeroed by Buffer.alloc().
  return buffer;
}

export function registerAzureSpeechHandlers(): void {
  ipcMain.handle('azure-speech:get-config', async () => {
    try {
      const config = await getAzureSpeechConfig();
      // We don't redact the key — the renderer is in the same trust domain and
      // already shows it in the settings input. If we later move to keychain
      // storage we should redact here.
      return { ok: true, data: config };
    } catch (err) {
      return { ok: false, error: classifyError(err) };
    }
  });

  ipcMain.handle(
    'azure-speech:set-config',
    async (_event, config: AzureSpeechConfig) => {
      try {
        if (!config || typeof config !== 'object') {
          return { ok: false, error: { code: 'BAD_ARGS', message: 'config object required' } };
        }
        await setAzureSpeechConfig({
          region: String(config.region ?? ''),
          apiKey: String(config.apiKey ?? ''),
          locale: String(config.locale ?? 'en-TT'),
        });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: classifyError(err) };
      }
    },
  );

  ipcMain.handle('azure-speech:test', async () => {
    let tmpFile: string | null = null;
    try {
      const config = await getAzureSpeechConfig();
      if (!isAzureSpeechConfigured(config)) {
        return {
          ok: false,
          error: {
            code: 'NOT_CONFIGURED',
            message: 'Set region and apiKey before testing',
          },
        };
      }
      const dir = await mkdtemp(path.join(app.getPath('temp'), 'clawx-azure-test-'));
      tmpFile = path.join(dir, 'silent.wav');
      await writeFile(tmpFile, buildSilentWavBuffer(), { mode: 0o600 });
      const result = await transcribeAzureShort(tmpFile, { timeoutMs: 15_000 });
      // For a silent clip we expect text='' but a successful round-trip — that
      // proves the credentials work. Surface it as "ok" with whatever Azure
      // returned (usually empty).
      return { ok: true, data: { text: result.text, language: result.language } };
    } catch (err) {
      logger.warn(`[asr-azure] test failed: ${(err as Error).message}`);
      return { ok: false, error: classifyError(err) };
    } finally {
      if (tmpFile) {
        try { await unlink(tmpFile); } catch { /* noop */ }
      }
    }
  });
}

/**
 * Used by asr-ipc's `asr:transcribe-stream` handler to run the Azure streaming
 * recogniser and forward partials over IPC. Kept here so all Azure-specific
 * code stays in this module.
 */
export async function runAzureStreamingForRenderer(
  audioPath: string,
  language: string | undefined,
): Promise<{ text: string; language: string }> {
  const callbacks: AzureStreamingCallbacks = {
    onPartial: (text) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('asr:transcribe-partial', {
          kind: 'partial',
          text,
        });
      }
    },
    onFinal: (text) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('asr:transcribe-partial', {
          kind: 'final',
          text,
        });
      }
    },
  };
  return transcribeAzureStream(audioPath, { language }, callbacks);
}
