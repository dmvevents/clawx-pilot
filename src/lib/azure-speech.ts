/**
 * Renderer-side client for the Azure Speech (cloud fallback ASR) IPC channels.
 * Mirrors the shape of `src/lib/microsoft-graph.ts` — thin typed wrappers
 * around the IPC envelope. All real work happens in the main process.
 */

type IpcEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

export interface AzureSpeechConfig {
  region: string;
  apiKey: string;
  locale: string;
}

export interface AzureSpeechTestResult {
  text: string;
  language: string;
}

function bridge() {
  const renderer = (window as { electron?: { ipcRenderer?: unknown } }).electron?.ipcRenderer as
    | {
        invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
      }
    | undefined;
  if (!renderer) {
    throw new Error('Azure Speech requires the Electron IPC bridge (renderer-only API)');
  }
  return renderer;
}

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const env = (await bridge().invoke(channel, ...args)) as IpcEnvelope<T>;
  if (!env || env.ok !== true) {
    const error = env && 'error' in env ? env.error : { code: 'UNKNOWN', message: 'IPC failed' };
    const err = new Error(error.message);
    (err as Error & { code?: string }).code = error.code;
    throw err;
  }
  return env.data;
}

export const azureSpeech = {
  getConfig: () => call<AzureSpeechConfig>('azure-speech:get-config'),
  setConfig: (config: AzureSpeechConfig) =>
    call<undefined>('azure-speech:set-config', config),
  test: () => call<AzureSpeechTestResult>('azure-speech:test'),
};
