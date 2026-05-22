/**
 * IPC bridge for the moe-form-filler service.
 *
 * Channels:
 *   moeforms:status         → FillRunStatus | null
 *   moeforms:get-urls       → { dailyReport?, suspension? }
 *   moeforms:set-urls(urls) → { ok }
 *   moeforms:start(payload) → FillRunStatus
 *   moeforms:resume         → FillRunStatus  (after MS sign-in completes)
 *   moeforms:confirm        → FillRunStatus  (issue fill + submit)
 *   moeforms:cancel         → FillRunStatus
 *
 * Renderer events:
 *   moeforms:status         → FillRunStatus
 */
import { BrowserWindow, ipcMain } from 'electron';
import { moeFormFillerManager } from '../services/moe-form-filler/manager';
import { getFormUrls, setFormUrls } from '../services/moe-form-filler/store';
import type { FormPayload } from '../services/moe-form-filler/types';

let mainWindow: BrowserWindow | null = null;

export function setMoeFormFillerWindow(window: BrowserWindow): void {
  mainWindow = window;
}

function classifyError(err: unknown): { code: string; message: string } {
  return {
    code: 'UNKNOWN',
    message: err instanceof Error ? err.message : String(err),
  };
}

export function registerMoeFormFillerHandlers(): void {
  moeFormFillerManager.on('status', (status: unknown) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('moeforms:status', status);
    }
  });

  ipcMain.handle('moeforms:status', async () => {
    try {
      return { ok: true, data: moeFormFillerManager.status() };
    } catch (err) {
      return { ok: false, error: classifyError(err) };
    }
  });

  ipcMain.handle('moeforms:get-urls', async () => {
    try {
      return { ok: true, data: await getFormUrls() };
    } catch (err) {
      return { ok: false, error: classifyError(err) };
    }
  });

  ipcMain.handle('moeforms:set-urls', async (_event, urls: { dailyReport?: string; suspension?: string }) => {
    try {
      await setFormUrls(urls);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: classifyError(err) };
    }
  });

  ipcMain.handle('moeforms:start', async (_event, payload: FormPayload) => {
    try {
      const data = await moeFormFillerManager.start(payload);
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: classifyError(err) };
    }
  });

  ipcMain.handle('moeforms:resume', async () => {
    try {
      const data = await moeFormFillerManager.resumeAfterSignin();
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: classifyError(err) };
    }
  });

  ipcMain.handle('moeforms:confirm', async () => {
    try {
      const data = await moeFormFillerManager.confirm();
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: classifyError(err) };
    }
  });

  ipcMain.handle('moeforms:cancel', async () => {
    try {
      const data = await moeFormFillerManager.cancel();
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: classifyError(err) };
    }
  });
}
