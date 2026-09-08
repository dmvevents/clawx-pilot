import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

const ONLINE_ACCOUNT = {
  id: 'google',
  vendorId: 'google',
  label: 'Online',
  authMode: 'api_key',
  model: 'gemini-2.5-pro',
  isDefault: true,
  enabled: true,
  createdAt: '2026-09-08T00:00:00.000Z',
  updatedAt: '2026-09-08T00:00:00.000Z',
};

const LOCAL_ACCOUNT = {
  id: 'ollama',
  vendorId: 'ollama',
  label: 'On this device',
  authMode: 'local',
  baseUrl: 'http://127.0.0.1:11434',
  model: 'qwen2.5:3b-instruct',
  enabled: true,
  createdAt: '2026-09-08T00:00:00.000Z',
  updatedAt: '2026-09-08T00:00:00.000Z',
};

const AGENTS_SNAPSHOT = {
  success: true,
  agents: [{
    id: 'main',
    name: 'main',
    isDefault: true,
    modelRef: 'google/gemini-2.5-pro',
    inheritedModel: true,
    mainSessionKey: 'agent:main:main',
    channelTypes: [],
  }],
  defaultModelRef: 'google/gemini-2.5-pro',
};

test.describe('ClawX pending chat send acknowledgement', () => {
  test('does not switch channels or resend when a silent accepted Online run reaches the watchdog timeout', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, connectedAt: Date.now() },
        gatewayRpc: {},
        hostApi: {},
      });

      await app.evaluate(async ({ app: _app }, mockData) => {
        const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
        const degradeRequests: Array<Record<string, unknown>> = [];
        const patchRequests: Array<Record<string, unknown>> = [];
        const aborts: Array<Record<string, unknown>> = [];
        let sendCount = 0;

        Object.assign(globalThis, {
          __silentOnlineDegradeRequests: degradeRequests,
          __silentOnlinePatchRequests: patchRequests,
          __silentOnlineAborts: aborts,
          __silentOnlineSendCount: () => sendCount,
        });

        ipcMain.removeHandler('hostapi:fetch');
        ipcMain.handle('hostapi:fetch', async (_event: unknown, request: { path?: string; method?: string; body?: string }) => {
          const path = String(request?.path ?? '');
          if (path === '/api/settings/degradeChannel') {
            degradeRequests.push({
              method: request?.method,
              body: request?.body,
            });
            return {
              ok: true,
              data: {
                status: 200,
                ok: true,
                json: { success: true, channel: 'on-device', accountId: 'ollama', modelRef: 'ollama/qwen2.5:3b-instruct' },
              },
            };
          }
          if (path === '/api/gateway/status') {
            return { ok: true, data: { status: 200, ok: true, json: { state: 'running', port: 18789, pid: 12345, connectedAt: Date.now() } } };
          }
          if (path === '/api/settings') {
            return { ok: true, data: { status: 200, ok: true, json: { setupComplete: true, preferredChannel: 'online' } } };
          }
          if (path === '/api/agents') {
            return { ok: true, data: { status: 200, ok: true, json: mockData.agentsSnapshot } };
          }
          if (path === '/api/provider-accounts') {
            return {
              ok: true,
              data: {
                status: 200,
                ok: true,
                json: [mockData.onlineAccount, mockData.localAccount],
              },
            };
          }
          if (path === '/api/provider-accounts/key-info') {
            return {
              ok: true,
              data: {
                status: 200,
                ok: true,
                json: [
                  { accountId: mockData.onlineAccount.id, hasKey: true, keyMasked: 'sk-***' },
                  { accountId: mockData.localAccount.id, hasKey: true, keyMasked: 'local' },
                ],
              },
            };
          }
          if (path === '/api/provider-vendors') {
            return { ok: true, data: { status: 200, ok: true, json: [] } };
          }
          if (path === '/api/provider-accounts/default') {
            return { ok: true, data: { status: 200, ok: true, json: { accountId: mockData.onlineAccount.id } } };
          }
          if (path === '/api/provider-accounts/default/probe') {
            return { ok: true, data: { status: 200, ok: true, json: { success: true, valid: true, accountId: mockData.onlineAccount.id, channel: 'online', status: 200, reason: 'ok' } } };
          }
          return { ok: true, data: { status: 200, ok: true, json: {} } };
        });

        ipcMain.removeHandler('gateway:rpc');
        ipcMain.handle('gateway:rpc', async (_event: unknown, method: string, payload: unknown) => {
          if (method === 'sessions.list') {
            return { success: true, result: { sessions: [{ key: 'agent:main:main', displayName: 'main' }] } };
          }
          if (method === 'sessions.patch') {
            patchRequests.push((payload ?? {}) as Record<string, unknown>);
            return { success: true, result: { ok: true, key: 'agent:main:main', resolved: {} } };
          }
          if (method === 'chat.history') {
            return { success: true, result: { messages: [] } };
          }
          if (method === 'chat.abort') {
            aborts.push((payload ?? {}) as Record<string, unknown>);
            return { success: true, result: {} };
          }
          if (method === 'chat.send') {
            sendCount += 1;
            return { success: true, result: { runId: sendCount === 1 ? 'run-slow-online' : 'run-unexpected-resend' } };
          }
          return { success: true, result: {} };
        });
      }, {
        onlineAccount: ONLINE_ACCOUNT,
        localAccount: LOCAL_ACCOUNT,
        agentsSnapshot: AGENTS_SNAPSHOT,
      });

      const page = await getStableWindow(app);
      try {
        await page.reload();
      } catch (error) {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) throw error;
      }

      await expect(page.getByTestId('main-layout')).toBeVisible();
      await page.clock.install();
      await expect(page.getByTestId('chat-composer-model-setup-required')).toHaveCount(0);
      await expect(page.getByTestId('chat-composer-input')).toBeEnabled();
      await page.getByTestId('chat-composer-input').fill('cloud is cold but reachable');
      await page.getByTestId('chat-composer-send').click();
      await expect(page.getByTestId('chat-page')).toHaveAttribute('data-active-run-id-present', 'true');

      await page.clock.fastForward(120_000);

      await expect(page.getByTestId('chat-page')).toHaveAttribute('data-sending', 'false');
      await expect(page.getByTestId('chat-page')).toHaveAttribute('data-degrade-in-progress', 'false');
      await expect(page.getByTestId('chat-page')).toHaveAttribute('data-active-run-id-present', 'false');
      await expect(page.getByTestId('chat-degrade-notice')).toHaveCount(0);
      await expect(page.getByTestId('chat-streaming-indicator')).toHaveCount(0);
      await expect(page.getByTestId('chat-page')).toHaveAttribute('data-error-present', 'true');
      await expect(page.getByText('cloud is cold but reachable')).toBeVisible();
      await expect(page.getByTestId('chat-error-bar')).toBeVisible();

      await app.evaluate(() => {
        const { BrowserWindow } = process.mainModule!.require('electron') as typeof import('electron');
        BrowserWindow.getAllWindows().forEach((window) => {
          window.webContents.send('gateway:chat-message', {
            state: 'final',
            runId: 'run-slow-online',
            sessionKey: 'agent:main:main',
            message: {
              role: 'assistant',
              id: 'late-online-final',
              stopReason: 'stop',
              content: [{ type: 'text', text: 'Online answer arrived after cold startup.' }],
            },
          });
        });
      });

      await expect(page.getByTestId('chat-page')).toHaveAttribute('data-sending', 'false');
      await expect(page.getByTestId('chat-page')).toHaveAttribute('data-degrade-in-progress', 'false');
      await expect(page.getByTestId('chat-page')).toHaveAttribute('data-active-run-id-present', 'false');
      await expect(page.getByTestId('chat-page')).toHaveAttribute('data-error-present', 'true');
      await expect(page.getByText('cloud is cold but reachable')).toBeVisible();
      await expect(page.getByTestId('chat-error-bar')).toBeVisible();
      await expect(page.getByTestId('chat-degrade-notice')).toHaveCount(0);
      await expect(page.getByText('Online answer arrived after cold startup.')).toHaveCount(0);

      const counters = await app.evaluate(() => ({
        degradeRequests: (globalThis as { __silentOnlineDegradeRequests?: Array<unknown> }).__silentOnlineDegradeRequests ?? [],
        patchRequests: (globalThis as { __silentOnlinePatchRequests?: Array<unknown> }).__silentOnlinePatchRequests ?? [],
        aborts: (globalThis as { __silentOnlineAborts?: Array<unknown> }).__silentOnlineAborts ?? [],
        sendCount: (globalThis as { __silentOnlineSendCount?: () => number }).__silentOnlineSendCount?.() ?? 0,
      }));
      const patchedModels = counters.patchRequests
        .map((request) => {
          if (!request || typeof request !== 'object' || !('model' in request)) {
            return undefined;
          }
          return (request as { model?: unknown }).model;
        })
        .filter((model) => model != null);
      expect(counters.degradeRequests).toEqual([]);
      expect(patchedModels).toEqual([]);
      expect(counters.aborts).toEqual([expect.objectContaining({ runId: 'run-slow-online' })]);
      expect(counters.sendCount).toBe(1);
    } finally {
      await closeElectronApp(app);
    }
  });

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
              json: AGENTS_SNAPSHOT,
            },
          },
          [stableStringify(['/api/settings', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { setupComplete: true, preferredChannel: 'online' },
            },
          },
          [stableStringify(['/api/provider-accounts', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: [ONLINE_ACCOUNT, LOCAL_ACCOUNT],
            },
          },
          [stableStringify(['/api/provider-accounts/key-info', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: [
                { accountId: ONLINE_ACCOUNT.id, hasKey: true, keyMasked: 'sk-***' },
                { accountId: LOCAL_ACCOUNT.id, hasKey: true, keyMasked: 'local' },
              ],
            },
          },
          [stableStringify(['/api/provider-vendors', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: [],
            },
          },
          [stableStringify(['/api/provider-accounts/default', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { accountId: ONLINE_ACCOUNT.id },
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
