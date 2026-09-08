import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

const LOCAL_ACCOUNT = {
  id: 'ollama-local-qwen2.5-3b-instruct',
  vendorId: 'ollama',
  label: 'On this device',
  authMode: 'local',
  baseUrl: 'http://127.0.0.1:11434/v1',
  apiProtocol: 'openai-completions',
  model: 'qwen2.5:3b-instruct',
  enabled: true,
  isDefault: true,
  createdAt: '2026-09-08T00:00:00.000Z',
  updatedAt: '2026-09-08T00:00:00.000Z',
};

test.describe('Stakeholder startup model-route readiness', () => {
  test('disables chat send when Gateway is connected but the default local model route is unavailable', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: {
          state: 'running',
          port: 18789,
          pid: 9708,
          connectedAt: Date.now(),
          gatewayReady: true,
        },
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
            data: {
              status: 200,
              ok: true,
              json: {
                state: 'running',
                port: 18789,
                pid: 9708,
                connectedAt: Date.now(),
                gatewayReady: true,
              },
            },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                agents: [
                  {
                    id: 'main',
                    name: 'Main Agent',
                    isDefault: true,
                    modelDisplay: 'qwen2.5:3b-instruct',
                    modelRef: 'ollama-ollamalo/qwen2.5:3b-instruct',
                    inheritedModel: true,
                    workspace: '~/.openclaw/workspace',
                    agentDir: '~/.openclaw/agents/main/agent',
                    mainSessionKey: 'agent:main:main',
                    channelTypes: [],
                  },
                ],
                defaultModelRef: 'ollama-ollamalo/qwen2.5:3b-instruct',
              },
            },
          },
          [stableStringify(['/api/provider-accounts', 'GET'])]: {
            ok: true,
            data: { status: 200, ok: true, json: [LOCAL_ACCOUNT] },
          },
          [stableStringify(['/api/provider-accounts/key-info', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: [{ accountId: LOCAL_ACCOUNT.id, hasKey: true, keyMasked: 'local' }],
            },
          },
          [stableStringify(['/api/provider-vendors', 'GET'])]: {
            ok: true,
            data: { status: 200, ok: true, json: [] },
          },
          [stableStringify(['/api/provider-accounts/default', 'GET'])]: {
            ok: true,
            data: { status: 200, ok: true, json: { accountId: LOCAL_ACCOUNT.id } },
          },
          [stableStringify([`/api/provider-accounts/${LOCAL_ACCOUNT.id}/probe`, 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                valid: false,
                accountId: LOCAL_ACCOUNT.id,
                channel: 'on-device',
                status: null,
                reason: 'unavailable',
              },
            },
          },
        },
      });

      const page = await getStableWindow(app);
      try {
        await page.reload();
      } catch (error) {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) throw error;
      }

      await expect(page.getByTestId('main-layout')).toBeVisible();
      await expect(page.getByText(/gateway connected \| port: 18789/i)).toBeVisible();
      await expect(page.getByTestId('chat-composer-model-setup-required')).toBeVisible();
      await expect(page.getByTestId('chat-composer-input')).toBeDisabled();
      await expect(page.getByTestId('chat-composer-send')).toBeDisabled();
    } finally {
      await closeElectronApp(app);
    }
  });
});
