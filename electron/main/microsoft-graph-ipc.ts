/**
 * IPC bridge for the Microsoft Graph capability.
 *
 * Channel layout:
 *   msgraph:status                → MicrosoftGraphStatus
 *   msgraph:get-config            → MicrosoftGraphConfig | null
 *   msgraph:set-config(config)    → { ok }
 *   msgraph:sign-in(opts)         → { ok, account }              (non-blocking: emits manual-code if needed)
 *   msgraph:sign-out              → { ok }
 *   msgraph:submit-manual-code    → { ok }                       (renderer's response to msgraph:code event)
 *   msgraph:rpc(method, args)     → result of a graphCalls.method
 *
 * Renderer-bound events (sent via webContents.send):
 *   msgraph:code            → { authorizationUrl, reason }       (manual-paste prompt)
 *   msgraph:signed-in       → { accountId, email, tenantId }
 *   msgraph:signed-out      → {}
 *   msgraph:error           → { message }
 */
import { BrowserWindow, ipcMain } from 'electron';
import { logger } from '../utils/logger';
import {
  getMicrosoftGraphConfig,
  setMicrosoftGraphConfig,
  setMockMailboxEnabled,
  type MicrosoftGraphConfig,
} from '../services/microsoft-graph/store';
import {
  getStatus,
  signIn,
  signOut,
  graphCalls,
  MicrosoftGraphAuthRequired,
  MicrosoftGraphNotConfigured,
} from '../services/microsoft-graph/manager';

let mainWindow: BrowserWindow | null = null;
let pendingManualCodeResolve: ((value: string) => void) | null = null;
let pendingManualCodeReject: ((reason?: unknown) => void) | null = null;

function emit(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function resetPendingManualCode(): void {
  pendingManualCodeResolve = null;
  pendingManualCodeReject = null;
}

function classifyError(err: unknown): { code: string; message: string } {
  if (err instanceof MicrosoftGraphNotConfigured) {
    return { code: 'NOT_CONFIGURED', message: err.message };
  }
  if (err instanceof MicrosoftGraphAuthRequired) {
    return { code: 'AUTH_REQUIRED', message: err.message };
  }
  return {
    code: 'UNKNOWN',
    message: err instanceof Error ? err.message : String(err),
  };
}

export function setMicrosoftGraphWindow(window: BrowserWindow): void {
  mainWindow = window;
}

export function registerMicrosoftGraphHandlers(): void {
  ipcMain.handle('msgraph:status', async () => {
    try {
      return { ok: true, data: await getStatus() };
    } catch (err) {
      return { ok: false, error: classifyError(err) };
    }
  });

  ipcMain.handle('msgraph:get-config', async () => {
    try {
      return { ok: true, data: await getMicrosoftGraphConfig() };
    } catch (err) {
      return { ok: false, error: classifyError(err) };
    }
  });

  ipcMain.handle(
    'msgraph:set-config',
    async (_event, config: MicrosoftGraphConfig | null) => {
      try {
        await setMicrosoftGraphConfig(config);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: classifyError(err) };
      }
    },
  );

  ipcMain.handle(
    'msgraph:sign-in',
    async (_event, opts?: { promptSelectAccount?: boolean }) => {
      try {
        const account = await signIn({
          promptSelectAccount: opts?.promptSelectAccount,
          onManualCodeRequired: (payload) => {
            emit('msgraph:code', payload);
          },
          onManualCodeInput: () =>
            new Promise<string>((resolve, reject) => {
              pendingManualCodeResolve = resolve;
              pendingManualCodeReject = reject;
            }),
        });
        emit('msgraph:signed-in', account);
        return { ok: true, data: account };
      } catch (err) {
        const classified = classifyError(err);
        logger.error('[msgraph] sign-in failed:', classified.message);
        emit('msgraph:error', { message: classified.message });
        return { ok: false, error: classified };
      } finally {
        resetPendingManualCode();
      }
    },
  );

  ipcMain.handle('msgraph:sign-out', async () => {
    try {
      await signOut();
      if (pendingManualCodeReject) {
        pendingManualCodeReject(new Error('Sign-in cancelled'));
        resetPendingManualCode();
      }
      emit('msgraph:signed-out', {});
      return { ok: true };
    } catch (err) {
      return { ok: false, error: classifyError(err) };
    }
  });

  ipcMain.handle(
    'msgraph:submit-manual-code',
    async (_event, code: string) => {
      const value = (code ?? '').trim();
      if (!value || !pendingManualCodeResolve) {
        return { ok: false, error: { code: 'NO_PENDING', message: 'No pending manual code request' } };
      }
      pendingManualCodeResolve(value);
      resetPendingManualCode();
      return { ok: true };
    },
  );

  ipcMain.handle(
    'msgraph:set-mock-mailbox',
    async (_event, enabled: boolean) => {
      try {
        await setMockMailboxEnabled(Boolean(enabled));
        return { ok: true };
      } catch (err) {
        return { ok: false, error: classifyError(err) };
      }
    },
  );

  ipcMain.handle(
    'msgraph:rpc',
    async (_event, method: keyof typeof graphCalls, args: unknown) => {
      const fn = graphCalls[method];
      if (typeof fn !== 'function') {
        return {
          ok: false,
          error: { code: 'BAD_METHOD', message: `Unknown msgraph method: ${String(method)}` },
        };
      }
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = await (fn as any)(args ?? {});
        return { ok: true, data };
      } catch (err) {
        return { ok: false, error: classifyError(err) };
      }
    },
  );
}
