import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

test.describe('chat microphone capture', () => {
  test('hands WAV audio to ASR IPC and inserts transcript', async ({ launchElectronApp }) => {
    const electronApp = await launchElectronApp({ skipSetup: true });
    const gatewayStatus = { state: 'running', port: 18789, pid: 12345, gatewayReady: true };
    try {
      await installIpcMocks(electronApp, {
        gatewayStatus,
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: { sessions: [{ key: 'agent:main:main', displayName: 'main' }] },
          },
          [stableStringify(['chat.history', { sessionKey: 'agent:main:main', limit: 200 }])]: {
            success: true,
            result: { messages: [] },
          },
          [stableStringify(['chat.history', { sessionKey: 'agent:main:main', limit: 1000 }])]: {
            success: true,
            result: { messages: [] },
          },
        },
        hostApi: {
          [stableStringify(['/api/gateway/status', 'GET'])]: {
            ok: true,
            data: { status: 200, ok: true, json: gatewayStatus },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { success: true, agents: [{ id: 'main', name: 'main' }] },
            },
          },
          [stableStringify(['/api/provider-accounts', 'GET'])]: {
            ok: true,
            data: { status: 200, ok: true, json: [] },
          },
          [stableStringify(['/api/provider-accounts/key-info', 'GET'])]: {
            ok: true,
            data: { status: 200, ok: true, json: [] },
          },
          [stableStringify(['/api/provider-vendors', 'GET'])]: {
            ok: true,
            data: { status: 200, ok: true, json: [] },
          },
          [stableStringify(['/api/provider-accounts/default', 'GET'])]: {
            ok: true,
            data: { status: 200, ok: true, json: { accountId: null } },
          },
        },
      });
      await electronApp.evaluate(async () => {
        const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
        ipcMain.removeHandler('asr:saveBlob');
        ipcMain.removeHandler('asr:transcribe');
        (globalThis as { __asrSaveArgs?: unknown }).__asrSaveArgs = undefined;
        ipcMain.handle('asr:saveBlob', async (_event: unknown, args: unknown) => {
          (globalThis as { __asrSaveArgs?: unknown }).__asrSaveArgs = args;
          return {
            ok: true,
            data: { path: 'C:\\Temp\\clawx-e2e.wav', bytes: 44, transcoded: false },
          };
        });
        ipcMain.handle('asr:transcribe', async () => ({
          ok: true,
          data: { text: 'send the circular tomorrow' },
        }));
      });

      const page = await getStableWindow(electronApp);
      try {
        await page.reload();
      } catch (error) {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) {
          throw error;
        }
      }
      await expect(page.getByTestId('main-layout')).toBeVisible();

      await page.evaluate(() => {
        class FakeAudioContext {
          sampleRate = 16000;
          destination = {};

          createMediaStreamSource() {
            return { connect() {}, disconnect() {} };
          }

          createScriptProcessor() {
            const processor: {
              onaudioprocess: null | ((event: { inputBuffer: { getChannelData: () => Float32Array } }) => void);
              connect: () => void;
              disconnect: () => void;
            } = {
              onaudioprocess: null,
              connect() {
                setTimeout(() => {
                  processor.onaudioprocess?.({
                    inputBuffer: { getChannelData: () => new Float32Array(4096).fill(0.2) },
                  });
                }, 0);
              },
              disconnect() {},
            };
            return processor;
          }

          createGain() {
            return { gain: { value: 1 }, connect() {}, disconnect() {} };
          }

          async resume() {}

          async close() {}
        }

        Object.defineProperty(window, 'AudioContext', { value: FakeAudioContext, configurable: true });
        Object.defineProperty(navigator, 'mediaDevices', {
          value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) },
          configurable: true,
        });
      });

      const mic = page.getByTestId('chat-composer-mic');
      await mic.click();
      await expect(mic).toHaveAttribute('aria-pressed', 'true');
      await mic.click();

      await expect(page.getByTestId('chat-composer-input')).toHaveValue('send the circular tomorrow');
      const saveArgs = await electronApp.evaluate(() => (globalThis as { __asrSaveArgs?: {
        mime?: string;
        suggestedExt?: string;
      } }).__asrSaveArgs);
      expect(saveArgs).toMatchObject({ mime: 'audio/wav', suggestedExt: 'wav' });
    } finally {
      await closeElectronApp(electronApp);
    }
  });
});
