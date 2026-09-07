import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const PROJECT_MANAGER_SESSION_KEY = 'agent:main:main';
const CODER_SESSION_KEY = 'agent:coder:subagent:child-123';
const CODER_SESSION_ID = 'child-session-id';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

const seededHistory = [
  {
    role: 'user',
    content: [{ type: 'text', text: '[Mon 2026-04-06 15:18 GMT+8] Analyze Velaria uncommitted changes' }],
    timestamp: Date.now(),
  },
  {
    role: 'assistant',
    content: [{
      type: 'toolCall',
      id: 'spawn-call',
      name: 'sessions_spawn',
      arguments: { agentId: 'coder', task: 'analyze core blocks' },
    }],
    timestamp: Date.now(),
  },
  {
    role: 'toolResult',
    toolCallId: 'spawn-call',
    toolName: 'sessions_spawn',
    content: [{
      type: 'text',
      text: JSON.stringify({
        status: 'accepted',
        childSessionKey: CODER_SESSION_KEY,
        runId: 'child-run-id',
        mode: 'run',
      }, null, 2),
    }],
    details: {
      status: 'accepted',
      childSessionKey: CODER_SESSION_KEY,
      runId: 'child-run-id',
      mode: 'run',
    },
    isError: false,
    timestamp: Date.now(),
  },
  {
    role: 'assistant',
    content: [{
      type: 'toolCall',
      id: 'yield-call',
      name: 'sessions_yield',
      arguments: { message: 'I asked coder to break down the core blocks of ~/Velaria uncommitted changes; will give you the conclusion when it returns.' },
    }],
    timestamp: Date.now(),
  },
  {
    role: 'toolResult',
    toolCallId: 'yield-call',
    toolName: 'sessions_yield',
    content: [{
      type: 'text',
      text: JSON.stringify({
        status: 'yielded',
        message: 'I asked coder to break down the core blocks of ~/Velaria uncommitted changes; will give you the conclusion when it returns.',
      }, null, 2),
    }],
    details: {
      status: 'yielded',
      message: 'I asked coder to break down the core blocks of ~/Velaria uncommitted changes; will give you the conclusion when it returns.',
    },
    isError: false,
    timestamp: Date.now(),
  },
  {
    role: 'user',
    content: [{
      type: 'text',
      text: `[Internal task completion event]
source: subagent
session_key: ${CODER_SESSION_KEY}
session_id: ${CODER_SESSION_ID}
type: subagent task
status: completed successfully`,
    }],
    timestamp: Date.now(),
  },
  {
    role: 'assistant',
    content: [{ type: 'text', text: 'Coder has finished the analysis, here are the conclusions.' }],
    _attachedFiles: [
      {
        fileName: 'CHECKLIST.md',
        mimeType: 'text/markdown',
        fileSize: 433,
        preview: null,
        filePath: '/Users/bytedance/.openclaw/workspace/CHECKLIST.md',
        source: 'tool-result',
      },
    ],
    timestamp: Date.now(),
  },
];

const childTranscriptMessages = [
  {
    role: 'user',
    content: [{ type: 'text', text: 'Analyze the core content of ~/Velaria uncommitted changes' }],
    timestamp: Date.now(),
  },
  {
    role: 'assistant',
    content: [{
      type: 'toolCall',
      id: 'coder-exec-call',
      name: 'exec',
      arguments: {
        command: "cd ~/Velaria && git status --short && sed -n '1,200p' src/dataflow/core/logical/planner/plan.h",
        workdir: '/Users/bytedance/.openclaw/workspace-coder',
      },
    }],
    timestamp: Date.now(),
  },
  {
    role: 'toolResult',
    toolCallId: 'coder-exec-call',
    toolName: 'exec',
    content: [{ type: 'text', text: 'M src/dataflow/core/logical/planner/plan.h' }],
    details: {
      status: 'completed',
      aggregated: "M src/dataflow/core/logical/planner/plan.h\nM src/dataflow/core/execution/runtime/execution_optimizer.cc",
      cwd: '/Users/bytedance/.openclaw/workspace-coder',
    },
    isError: false,
    timestamp: Date.now(),
  },
  {
    role: 'assistant',
    content: [{ type: 'text', text: 'Analysis complete, there are 4 key blocks.' }],
    timestamp: Date.now(),
  },
];

const longRunPrompt = 'Inspect the workspace and summarize the result';
const longRunProcessSegments = Array.from({ length: 9 }, (_, index) => `Checked source ${index + 1}.`);
const longRunSummary = 'Here is the summary.';
const longRunReplyText = `${longRunProcessSegments.join(' ')} ${longRunSummary}`;
const longRunHistory = [
  {
    role: 'user',
    content: [{ type: 'text', text: longRunPrompt }],
    timestamp: Date.now(),
  },
  ...longRunProcessSegments.map((segment, index) => ({
    role: 'assistant',
    id: `long-run-step-${index + 1}`,
    content: [{ type: 'text', text: segment }],
    timestamp: Date.now(),
  })),
  {
    role: 'assistant',
    id: 'long-run-final',
    content: [{ type: 'text', text: longRunReplyText }],
    timestamp: Date.now(),
  },
];

const errorRunPrompt = '你是什么模型？';
const errorRunHistory = [
  {
    role: 'user',
    content: [{ type: 'text', text: errorRunPrompt }],
    timestamp: Date.now(),
  },
  {
    role: 'assistant',
    id: 'error-final',
    content: [],
    stopReason: 'error',
    errorMessage: '404 Resource not found',
    timestamp: Date.now(),
  },
];

test.describe('ClawX chat execution graph', () => {
  test('renders internal yield status and linked subagent branch from mocked IPC', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: {
              sessions: [{ key: PROJECT_MANAGER_SESSION_KEY, displayName: 'main' }],
            },
          },
          [stableStringify(['chat.history', { sessionKey: 'agent:main:main', limit: 200 }])]: {
            success: true,
            result: {
              messages: seededHistory,
            },
          },
          [stableStringify(['chat.history', { sessionKey: 'agent:main:main', limit: 1000 }])]: {
            success: true,
            result: {
              messages: seededHistory,
            },
          },
        },
        hostApi: {
          [stableStringify(['/api/gateway/status', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { state: 'running', port: 18789, pid: 12345 },
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
                  { id: 'main', name: 'main' },
                  { id: 'coder', name: 'coder' },
                ],
              },
            },
          },
          [stableStringify([`/api/sessions/transcript?agentId=coder&sessionId=${CODER_SESSION_ID}`, 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                messages: childTranscriptMessages,
              },
            },
          },
        },
      });

      const page = await getStableWindow(app);
      try {
        await page.reload();
      } catch (error) {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) {
          throw error;
        }
      }
      await expect(page.getByTestId('main-layout')).toBeVisible();
      await expect(page.getByTestId('chat-execution-graph')).toBeVisible({ timeout: 30_000 });
      // Completed runs auto-collapse into a single-line summary button. Expand
      // it first so the underlying step details are rendered.
      const graph = page.getByTestId('chat-execution-graph');
      if ((await graph.getAttribute('data-collapsed')) === 'true') {
        await graph.click();
      }
      await expect(
        page.locator('[data-testid="chat-execution-graph"] [data-testid="chat-execution-step"]').getByText('sessions_yield', { exact: true }),
      ).toBeVisible();
      await expect(page.getByText('coder subagent')).toBeVisible();
      await expect(
        page.locator('[data-testid="chat-execution-graph"] [data-testid="chat-execution-step"]').getByText('exec', { exact: true }),
      ).toBeVisible();
      const execRow = page.locator('[data-testid="chat-execution-step"]').filter({ hasText: 'exec' }).first();
      await execRow.click();
      await expect(execRow.locator('pre')).toBeVisible();
      await expect(page.locator('[data-testid="chat-execution-graph"]').getByText('I asked coder to break down the core blocks of ~/Velaria uncommitted changes; will give you the conclusion when it returns.')).toBeVisible();
      await expect(page.getByText('CHECKLIST.md')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('preserves long execution history counts and strips the full folded reply prefix', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: {
              sessions: [{ key: PROJECT_MANAGER_SESSION_KEY, displayName: 'main' }],
            },
          },
          [stableStringify(['chat.history', { sessionKey: 'agent:main:main', limit: 200 }])]: {
            success: true,
            result: {
              messages: longRunHistory,
            },
          },
          [stableStringify(['chat.history', { sessionKey: 'agent:main:main', limit: 1000 }])]: {
            success: true,
            result: {
              messages: longRunHistory,
            },
          },
        },
        hostApi: {
          [stableStringify(['/api/gateway/status', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { state: 'running', port: 18789, pid: 12345 },
            },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                agents: [{ id: 'main', name: 'main' }],
              },
            },
          },
        },
      });

      const page = await getStableWindow(app);
      try {
        await page.reload();
      } catch (error) {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) {
          throw error;
        }
      }

      await expect(page.getByTestId('main-layout')).toBeVisible();
      await expect(page.getByTestId('chat-execution-graph')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('chat-execution-graph')).toHaveAttribute('data-collapsed', 'true');
      await expect(page.getByTestId('chat-execution-graph')).toContainText('0 tool calls');
      await expect(page.getByTestId('chat-execution-graph')).toContainText('9 process messages');
      await expect(page.getByTestId('chat-page')).toHaveAttribute('data-sending', 'false');
      await expect(page.getByTestId('chat-page')).toHaveAttribute('data-pending-final', 'false');
      await expect(page.getByTestId('chat-page')).toHaveAttribute('data-active-run-id-present', 'false');
      await expect(page.getByTestId('chat-page')).toHaveAttribute('data-active-execution-graph', 'false');
      await expect(page.getByTestId('chat-page')).toHaveAttribute('data-degrade-in-progress', 'false');
      await expect(page.getByTestId('chat-page')).toHaveAttribute('data-run-error-present', 'false');
      await expect(page.getByTestId('chat-page')).toHaveAttribute('data-error-present', 'false');
      await expect(page.getByText(longRunSummary, { exact: true })).toBeVisible();
      await expect(page.getByText(longRunReplyText, { exact: true })).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('stops the stale thinking state and does not repaint a stale run-error banner on a fresh window (D0)', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: {
              sessions: [{ key: PROJECT_MANAGER_SESSION_KEY, displayName: 'main' }],
            },
          },
          [stableStringify(['chat.history', { sessionKey: 'agent:main:main', limit: 200 }])]: {
            success: true,
            result: {
              messages: errorRunHistory,
            },
          },
          [stableStringify(['chat.history', { sessionKey: 'agent:main:main', limit: 1000 }])]: {
            success: true,
            result: {
              messages: errorRunHistory,
            },
          },
        },
        hostApi: {
          [stableStringify(['/api/gateway/status', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { state: 'running', port: 18789, pid: 12345 },
            },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                agents: [{ id: 'main', name: 'main' }],
              },
            },
          },
        },
      });

      const page = await getStableWindow(app);
      try {
        await page.reload();
      } catch (error) {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) {
          throw error;
        }
      }

      await expect(page.getByTestId('main-layout')).toBeVisible();
      // moe.18 Finding D0: a FRESH window loading a session whose last turn
      // errored historically must NOT repaint the red run-error banner (it
      // used to persist across reloads/gateway restarts until app relaunch).
      // The stale thinking state must still stop and the composer must be
      // usable. In-line rendering of the historical error-stopped message is
      // the recorded follow-up (no banner ≠ hidden active failures: active
      // own-turn errors still paint, pinned in chat-channel-degrade tests).
      await expect(page.getByTestId('chat-execution-graph')).toHaveCount(0);
      await expect(page.getByTestId('chat-execution-step-thinking-trailing')).toHaveCount(0);
      await expect(page.getByTestId('chat-run-error')).toHaveCount(0);
      await expect(page.getByTestId('chat-page')).toHaveAttribute('data-sending', 'false');
      await expect(page.getByTestId('chat-page')).toHaveAttribute('data-pending-final', 'false');
      await expect(page.getByTestId('chat-page')).toHaveAttribute('data-active-run-id-present', 'false');
      await expect(page.getByTestId('chat-page')).toHaveAttribute('data-run-error-present', 'false');
      await expect(page.getByText('404 Resource not found')).toBeHidden();
      await page.getByTestId('chat-composer-input').fill('retry');
      await expect(page.getByTestId('chat-composer-send')).toBeEnabled();
    } finally {
      await closeElectronApp(app);
    }
  });


  test('surfaces a visible terminal error after partial tool progress stalls', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: {
              sessions: [{ key: PROJECT_MANAGER_SESSION_KEY, displayName: 'main' }],
            },
          },
          [stableStringify(['chat.send', {
            deliver: false,
            idempotencyKey: '__dynamic__',
            message: 'check stale tool progress',
            sessionKey: 'agent:main:main',
          }])]: {
            success: true,
            result: { runId: 'run-stale-tool' },
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
              json: { state: 'running', port: 18789, pid: 12345 },
            },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                agents: [{ id: 'main', name: 'main' }],
              },
            },
          },
        },
      });
      await app.evaluate(() => {
        const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
        ipcMain.removeHandler('gateway:rpc');
        ipcMain.handle('gateway:rpc', async (_event: unknown, method: string) => {
          if (method === 'sessions.list') {
            return { success: true, result: { sessions: [{ key: 'agent:main:main', displayName: 'main' }] } };
          }
          if (method === 'chat.history') {
            return { success: true, result: { messages: [] } };
          }
          if (method === 'chat.send') {
            return { success: true, result: { runId: 'run-stale-tool' } };
          }
          return { success: true, result: {} };
        });
      });

      const page = await getStableWindow(app);
      try {
        await page.reload();
      } catch (error) {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) {
          throw error;
        }
      }

      await expect(page.getByTestId('main-layout')).toBeVisible();
      await page.getByTestId('chat-composer-input').fill('check stale tool progress');
      await page.getByTestId('chat-composer-send').click();
      await expect(page.getByTestId('chat-page')).toHaveAttribute('data-active-run-id-present', 'true');

      await app.evaluate(() => {
        const { BrowserWindow } = process.mainModule!.require('electron') as typeof import('electron');
        BrowserWindow.getAllWindows().forEach((window) => {
          window.webContents.send('gateway:chat-message', {
            state: 'delta',
            runId: 'run-stale-tool',
            sessionKey: 'agent:main:main',
            message: {
              role: 'assistant',
              content: [{
                type: 'tool_use',
                id: 'yield-call',
                name: 'sessions_yield',
                input: { message: 'waiting on a child task' },
              }],
            },
          });
        });
      });

      await expect(page.getByTestId('chat-execution-graph')).toBeVisible();
      await expect(page.locator('[data-testid="chat-execution-step"]').filter({ hasText: 'sessions_yield' })).toBeVisible();

      await app.evaluate(() => {
        const { BrowserWindow } = process.mainModule!.require('electron') as typeof import('electron');
        BrowserWindow.getAllWindows().forEach((window) => {
          window.webContents.send('gateway:chat-message', {
            state: 'error',
            runId: 'run-stale-tool',
            sessionKey: 'agent:main:main',
            errorMessage: 'No response received from the model. The provider may be unavailable or the API key may have insufficient quota. Please check your provider settings.',
          });
        });
      });

      await expect(page.getByTestId('chat-page')).toHaveAttribute('data-sending', 'false');
      await expect(page.getByTestId('chat-page')).toHaveAttribute('data-active-run-id-present', 'false');
      await expect(page.getByTestId('chat-page')).toHaveAttribute('data-error-present', 'true');
      await expect(page.getByText('Technical details')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });

  test('clears an inactive on-device runtime pin on the next send after Online provider proof', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: { sessions: [{ key: PROJECT_MANAGER_SESSION_KEY, displayName: 'main' }] },
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
            data: { status: 200, ok: true, json: { state: 'running', port: 18789, pid: 12345 } },
          },
          [stableStringify(['/api/settings', 'GET'])]: {
            ok: true,
            data: { status: 200, ok: true, json: { setupComplete: true, preferredChannel: 'online' } },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: { status: 200, ok: true, json: { success: true, agents: [{ id: 'main', name: 'main' }] } },
          },
          [stableStringify(['/api/provider-accounts', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: [
                { id: 'google', vendorId: 'google', label: 'Online', model: 'gemini-2.5-pro', isDefault: true, enabled: true },
                { id: 'ollama', vendorId: 'ollama', label: 'On this device', baseUrl: 'http://127.0.0.1:11434', model: 'qwen2.5:3b-instruct', enabled: true },
              ],
            },
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
            data: { status: 200, ok: true, json: { accountId: 'google' } },
          },
          [stableStringify(['/api/provider-accounts/default/probe', 'GET'])]: {
            ok: true,
            data: { status: 200, ok: true, json: { success: true, valid: true, accountId: 'google', channel: 'online', status: 200, reason: 'ok' } },
          },
          [stableStringify(['/api/settings/degradeChannel', 'POST'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { success: true, channel: 'on-device', accountId: 'ollama', modelRef: 'ollama/qwen2.5:3b-instruct' },
            },
          },
        },
      });

      await app.evaluate(() => {
        const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
        (globalThis as { __chatPatchModels?: Array<unknown> }).__chatPatchModels = [];
        let sendCount = 0;
        ipcMain.removeHandler('gateway:rpc');
        ipcMain.handle('gateway:rpc', async (_event: unknown, method: string, params: unknown) => {
          if (method === 'sessions.patch') {
            const requested = (params as { model?: unknown } | undefined)?.model;
            const sessionKey = String((params as { key?: unknown } | undefined)?.key ?? 'agent:main:main');
            (globalThis as { __chatPatchModels?: Array<unknown> }).__chatPatchModels?.push(requested ?? null);
            if (requested == null) {
              return { success: true, result: { ok: true, key: sessionKey, entry: { key: sessionKey }, resolved: {} } };
            }
            const requestedModel = String(requested);
            return {
              success: true,
              result: {
                ok: true,
                key: sessionKey,
                entry: { key: sessionKey, modelOverride: requestedModel, providerOverride: requestedModel.split('/')[0] },
                resolved: { modelProvider: 'ollama', model: 'qwen2.5:3b-instruct' },
              },
            };
          }
          if (method === 'chat.send') {
            sendCount += 1;
            return { success: true, result: { runId: sendCount === 1 ? 'run-cloud' : 'run-after-clear' } };
          }
          if (method === 'sessions.list') {
            return { success: true, result: { sessions: [{ key: 'agent:main:main', displayName: 'main' }] } };
          }
          if (method === 'chat.history') {
            return { success: true, result: { messages: [] } };
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
      await expect(page.getByTestId('chat-composer-channel')).toBeVisible();
      await expect(page.getByTestId('chat-composer-channel')).toHaveAttribute('data-channel', 'online');
      await page.getByTestId('chat-composer-input').fill('first turn uses a tool before fallback');
      await page.getByTestId('chat-composer-send').click();
      await expect(page.getByTestId('chat-page')).toHaveAttribute('data-active-run-id-present', 'true');

      await app.evaluate(() => {
        const { BrowserWindow } = process.mainModule!.require('electron') as typeof import('electron');
        BrowserWindow.getAllWindows().forEach((window) => {
          window.webContents.send('gateway:chat-message', {
            state: 'delta',
            runId: 'run-cloud',
            sessionKey: 'agent:main:main',
            message: {
              role: 'assistant',
              content: [{ type: 'tool_use', id: 'tool-1', name: 'outlook.read_inbox', input: {} }],
            },
          });
        });
      });
      await expect(page.locator('[data-testid="chat-execution-step"]').filter({ hasText: 'outlook.read_inbox' })).toBeVisible();

      await app.evaluate(() => {
        const { BrowserWindow } = process.mainModule!.require('electron') as typeof import('electron');
        BrowserWindow.getAllWindows().forEach((window) => {
          window.webContents.send('gateway:chat-message', {
            state: 'error',
            runId: 'run-cloud',
            sessionKey: 'agent:main:main',
            errorMessage: 'fetch failed',
          });
        });
      });

      await expect.poll(async () => await app.evaluate(() => (
        (globalThis as { __chatPatchModels?: Array<unknown> }).__chatPatchModels ?? []
      ))).toContain('ollama/qwen2.5:3b-instruct');
      await expect(page.getByTestId('chat-composer-channel')).toHaveAttribute('data-channel', 'on-device');
      await expect(page.getByTestId('chat-page')).toHaveAttribute('data-sending', 'false');

      await page.getByTestId('chat-composer-input').fill('second turn after Online is healthy');
      await page.getByTestId('chat-composer-send').click();

      await expect(page.getByTestId('chat-composer-channel')).toHaveAttribute('data-channel', 'online');
      await expect.poll(async () => await app.evaluate(() => (
        ((globalThis as { __chatPatchModels?: Array<unknown> }).__chatPatchModels ?? []).slice(-2)
      ))).toEqual(['ollama/qwen2.5:3b-instruct', null]);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('keeps channel recovery visible when a fresh send replaces the degrade notice', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: {
              sessions: [{ key: PROJECT_MANAGER_SESSION_KEY, displayName: 'main' }],
            },
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
              json: { state: 'running', port: 18789, pid: 12345 },
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
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                agents: [{ id: 'main', name: 'main' }],
              },
            },
          },
          [stableStringify(['/api/provider-accounts', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: [
                { id: 'google', vendorId: 'google', label: 'Online', model: 'gemini-2.5-pro', isDefault: true, enabled: true },
                { id: 'ollama', vendorId: 'ollama', label: 'On this device', baseUrl: 'http://127.0.0.1:11434', model: 'qwen2.5:3b-instruct', enabled: true },
              ],
            },
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
            data: { status: 200, ok: true, json: { accountId: 'google' } },
          },
          [stableStringify(['/api/settings/degradeChannel', 'POST'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                channel: 'on-device',
                accountId: 'ollama',
                modelRef: 'ollama/qwen2.5:3b-instruct',
              },
            },
          },
        },
      });
      await app.evaluate(() => {
        const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
        let pinnedOnDevice = false;
        let sendCount = 0;
        (globalThis as {
          __releaseChannelRecoveryClear?: () => void;
          __resolveOnDevicePin?: () => void;
        }).__releaseChannelRecoveryClear = undefined;
        (globalThis as { __resolveOnDevicePin?: () => void }).__resolveOnDevicePin = undefined;
        ipcMain.removeHandler('gateway:rpc');
        ipcMain.handle('gateway:rpc', async (_event: unknown, method: string, params: unknown) => {
          if (method === 'sessions.patch') {
            const requested = (params as { model?: unknown } | undefined)?.model;
            const sessionKey = String((params as { key?: unknown } | undefined)?.key ?? 'agent:main:main');
            if (requested == null) {
              if (!pinnedOnDevice) {
                return {
                  success: true,
                  result: {
                    ok: true,
                    key: sessionKey,
                    entry: { key: sessionKey },
                    resolved: {},
                  },
                };
              }
              return await new Promise((resolve) => {
                (globalThis as { __releaseChannelRecoveryClear?: () => void }).__releaseChannelRecoveryClear = () => resolve({
                  success: true,
                  result: {
                    ok: true,
                    key: sessionKey,
                    entry: { key: sessionKey },
                    resolved: {},
                  },
                });
              });
            }
            const requestedModel = String(requested);
            return await new Promise((resolve) => {
              (globalThis as { __resolveOnDevicePin?: () => void }).__resolveOnDevicePin = () => {
                pinnedOnDevice = true;
                resolve({
                  success: true,
                  result: {
                    ok: true,
                    key: sessionKey,
                    entry: { key: sessionKey, modelOverride: requestedModel, providerOverride: requestedModel.split('/')[0] },
                    resolved: { modelProvider: 'ollama', model: 'qwen2.5:3b-instruct' },
                  },
                });
              };
            });
          }
          if (method === 'chat.send') {
            sendCount += 1;
            return { success: true, result: { runId: sendCount === 1 ? 'run-cloud' : 'run-new' } };
          }
          if (method === 'sessions.list') {
            return { success: true, result: { sessions: [{ key: 'agent:main:main', displayName: 'main' }] } };
          }
          if (method === 'chat.history') {
            return { success: true, result: { messages: [] } };
          }
          return { success: true, result: {} };
        });
      });

      const page = await getStableWindow(app);
      try {
        await page.reload();
      } catch (error) {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) {
          throw error;
        }
      }

      await expect(page.getByTestId('main-layout')).toBeVisible();
      await expect(page.getByTestId('chat-composer-channel')).toHaveAttribute('data-channel', 'online');
      await page.getByTestId('chat-composer-input').fill('first turn');
      await page.getByTestId('chat-composer-send').click();
      await expect(page.getByTestId('chat-page')).toHaveAttribute('data-active-run-id-present', 'true');
      await expect(page.getByTestId('chat-page')).toHaveAttribute('data-sending', 'true');

      await app.evaluate(() => {
        const { BrowserWindow } = process.mainModule!.require('electron') as typeof import('electron');
        BrowserWindow.getAllWindows().forEach((window) => {
          window.webContents.send('gateway:chat-message', {
            state: 'error',
            runId: 'run-cloud',
            sessionKey: 'agent:main:main',
            errorMessage: 'fetch failed',
          });
        });
      });

      await expect(page.getByTestId('chat-page')).toHaveAttribute('data-degrade-in-progress', 'true');
      await expect.poll(async () => await app.evaluate(() => (
        typeof (globalThis as { __resolveOnDevicePin?: () => void }).__resolveOnDevicePin === 'function'
      ))).toBe(true);
      await app.evaluate(() => {
        const { BrowserWindow } = process.mainModule!.require('electron') as typeof import('electron');
        BrowserWindow.getAllWindows().forEach((window) => {
          window.webContents.send('gateway:chat-message', {
            state: 'final',
            runId: 'run-cloud',
            sessionKey: 'agent:main:main',
            message: {
              role: 'assistant',
              id: 'cloud-final-after-pin',
              stopReason: 'stop',
              content: [{ type: 'text', text: 'Cloud recovered after pin.' }],
            },
          });
        });
      });
      await app.evaluate(() => {
        (globalThis as { __resolveOnDevicePin?: () => void }).__resolveOnDevicePin?.();
      });
      await expect.poll(async () => await app.evaluate(() => (
        typeof (globalThis as { __releaseChannelRecoveryClear?: () => void }).__releaseChannelRecoveryClear === 'function'
      ))).toBe(true);
      await expect(page.getByTestId('chat-composer-input')).toBeEnabled();
      await page.getByTestId('chat-composer-input').fill('second turn while restore is pending');
      await page.getByTestId('chat-composer-send').click();

      await expect(page.getByTestId('chat-page')).toHaveAttribute('data-degrade-in-progress', 'true');
      await expect(page.getByTestId('chat-channel-recovery-notice')).toBeVisible();
      await expect(page.getByText('Restoring this chat to your selected channel…')).toBeVisible();

      await app.evaluate(() => {
        (globalThis as { __releaseChannelRecoveryClear?: () => void }).__releaseChannelRecoveryClear?.();
      });
      await expect(page.getByTestId('chat-page')).toHaveAttribute('data-degrade-in-progress', 'false');
      await expect(page.getByTestId('chat-channel-recovery-notice')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });

});
