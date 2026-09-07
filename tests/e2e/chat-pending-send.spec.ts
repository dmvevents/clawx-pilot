import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

test.describe('ClawX pending chat send acknowledgement', () => {
  test('keeps a slow current chat.send acknowledgement alive and adopts the answered run', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, connectedAt: Date.now() },
        gatewayRpc: {},
        hostApi: {
          [stableStringify(['/api/gateway/status', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { state: 'running', port: 18789, pid: 12345, connectedAt: Date.now() },
            },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { success: true, agents: [{ id: 'main', name: 'main' }] },
            },
          },
        },
      });

      await app.evaluate(async () => {
        const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
        let releaseSend: ((runId: string) => void) | null = null;
        const aborts: Array<Record<string, unknown>> = [];

        (globalThis as {
          __releasePendingChatSend?: (runId: string) => void;
          __pendingChatSendAborts?: Array<Record<string, unknown>>;
        }).__pendingChatSendAborts = aborts;
        (globalThis as {
          __releasePendingChatSend?: (runId: string) => void;
        }).__releasePendingChatSend = (runId: string) => {
          releaseSend?.(runId);
        };

        ipcMain.removeHandler('gateway:rpc');
        ipcMain.handle('gateway:rpc', async (_event: unknown, method: string, payload: unknown) => {
          if (method === 'sessions.list') {
            return { success: true, result: { sessions: [{ key: 'agent:main:main', displayName: 'main' }] } };
          }
          if (method === 'chat.history') {
            return { success: true, result: { messages: [] } };
          }
          if (method === 'chat.abort') {
            aborts.push((payload ?? {}) as Record<string, unknown>);
            return { success: true, result: {} };
          }
          if (method === 'chat.send') {
            return await new Promise((resolve) => {
              releaseSend = (runId: string) => resolve({ success: true, result: { runId } });
            });
          }
          return { success: true, result: {} };
        });
      });

      const page = await getStableWindow(app);
      try {
        await page.reload();
      } catch (error) {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) throw error;
      }

      await expect(page.getByTestId('main-layout')).toBeVisible();
      await page.clock.install();
      await page.getByTestId('chat-composer-input').fill('slow first on-device turn');
      await page.getByTestId('chat-composer-send').click();

      await page.clock.fastForward(96_000);
      await expect(page.getByTestId('chat-page')).toHaveAttribute('data-sending', 'true');
      await expect(page.getByTestId('chat-page')).toHaveAttribute('data-active-run-id-present', 'false');
      await expect(page.getByTestId('chat-run-error')).toHaveCount(0);

      await app.evaluate(() => {
        (globalThis as { __releasePendingChatSend?: (runId: string) => void })
          .__releasePendingChatSend?.('run-after-slow-ack');
      });
      await expect(page.getByTestId('chat-page')).toHaveAttribute('data-active-run-id-present', 'true');

      await page.clock.fastForward(80_000);
      await expect(page.getByTestId('chat-page')).toHaveAttribute('data-sending', 'true');
      await expect(page.getByTestId('chat-page')).toHaveAttribute('data-active-run-id-present', 'true');

      await app.evaluate(() => {
        const { BrowserWindow } = process.mainModule!.require('electron') as typeof import('electron');
        BrowserWindow.getAllWindows().forEach((window) => {
          window.webContents.send('gateway:chat-message', {
            state: 'final',
            runId: 'run-after-slow-ack',
            sessionKey: 'agent:main:main',
            message: {
              role: 'assistant',
              id: 'slow-ack-final',
              content: [{ type: 'text', text: 'Answer after delayed runtime preparation.' }],
            },
          });
        });
      });

      await expect(page.getByText('Answer after delayed runtime preparation.')).toBeVisible();
      await expect(page.getByTestId('chat-page')).toHaveAttribute('data-sending', 'false');
      const aborts = await app.evaluate(() => (
        (globalThis as { __pendingChatSendAborts?: Array<Record<string, unknown>> }).__pendingChatSendAborts ?? []
      ));
      expect(aborts).toEqual([]);
    } finally {
      await closeElectronApp(app);
    }
  });
});
