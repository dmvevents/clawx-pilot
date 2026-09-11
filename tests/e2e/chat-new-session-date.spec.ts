import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const MAIN_SESSION_KEY = 'agent:main:main';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

test.describe('ClawX chat session date grouping', () => {
  test('new chat appears in the Today session bucket', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    const oldTimestampMs = Date.now() - 35 * 24 * 60 * 60 * 1000;
    const seededHistory = [
      { role: 'user', content: 'Existing conversation', timestamp: oldTimestampMs },
      { role: 'assistant', content: 'Existing reply', timestamp: oldTimestampMs + 1000 },
    ];

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: {
              sessions: [{
                key: MAIN_SESSION_KEY,
                displayName: 'main',
                updatedAt: oldTimestampMs,
              }],
            },
          },
          [stableStringify(['chat.history', { sessionKey: MAIN_SESSION_KEY, limit: 200 }])]: {
            success: true,
            result: { messages: seededHistory },
          },
          [stableStringify(['chat.history', { sessionKey: MAIN_SESSION_KEY, limit: 1000 }])]: {
            success: true,
            result: { messages: seededHistory },
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
              json: { success: true, agents: [{ id: 'main', name: 'Main' }] },
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

      await expect(page.getByText('Existing conversation')).toBeVisible({ timeout: 30_000 });

      await page.getByTestId('sidebar-new-chat').click();

      await expect(page.getByTestId('session-bucket-today').getByText(/agent:main:session-/)).toBeVisible();
      await expect(page.getByTestId('session-bucket-older')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });

  test('New Chat clicked before history has loaded still starts a new session (CLWX-140)', async ({ launchElectronApp }) => {
    // Installed-build shape: the gateway reports running but the main
    // session's history has not arrived yet, so the transcript is empty. The
    // old guard read "0 messages" as "already a fresh chat" and stayed on
    // agent:main:main; when history arrived, yesterday's messages surrounded
    // the new turn.
    const app = await launchElectronApp({ skipSetup: true });
    const oldTimestampMs = Date.now() - 35 * 24 * 60 * 60 * 1000;
    const seededHistory = [
      { role: 'user', content: 'Existing conversation', timestamp: oldTimestampMs },
      { role: 'assistant', content: 'Existing reply', timestamp: oldTimestampMs + 1000 },
    ];

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
        // Hold history back so the click lands while the transcript is still
        // empty. Without this delay the mocks resolve before the click and the
        // pre-fix guard passes too (negative control, 2026-09-10).
        gatewayRpcDelayMs: { 'chat.history': 6_000 },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: { sessions: [{ key: MAIN_SESSION_KEY, displayName: 'main', updatedAt: oldTimestampMs }] },
          },
          [stableStringify(['chat.history', { sessionKey: MAIN_SESSION_KEY, limit: 200 }])]: {
            success: true,
            result: { messages: seededHistory },
          },
          [stableStringify(['chat.history', { sessionKey: MAIN_SESSION_KEY, limit: 1000 }])]: {
            success: true,
            result: { messages: seededHistory },
          },
        },
        hostApi: {
          [stableStringify(['/api/gateway/status', 'GET'])]: {
            ok: true,
            data: { status: 200, ok: true, json: { state: 'running', port: 18789, pid: 12345 } },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: { status: 200, ok: true, json: { success: true, agents: [{ id: 'main', name: 'Main' }] } },
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

      // Click as soon as the button exists — do NOT wait for the seeded
      // history to render. This is the first-minute-after-launch window.
      const newChat = page.getByTestId('sidebar-new-chat');
      await expect(newChat).toBeVisible({ timeout: 30_000 });
      await newChat.click();

      // The new session must exist before the delayed history could have arrived.
      await expect(page.getByTestId('session-bucket-today').getByText(/agent:main:session-/)).toBeVisible({ timeout: 5_000 });
      // ...and once the main session's history does arrive, it must land in the
      // main session, not in the new conversation on screen.
      await expect(page.getByTestId('chat-page')).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(8_000);
      await expect(page.getByTestId('chat-page').getByText('Existing conversation')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });
});
