/**
 * Settings route contract for the two channel-change entry points.
 *
 * Both POST /api/settings/degradeChannel and PUT /api/settings run the same
 * four-store transaction, and the ONLY differences are the two things this
 * suite pins:
 *
 *   1. the degrade path does not persist `preferredChannel`
 *   2. the degrade path does not bounce the running Gateway
 *
 * (2) is why this file exists. `syncDefaultProviderToRuntime` grew a
 * `skipGatewayRefresh` option for exactly this case (CLWX-95/96) and it was
 * unit-tested at that layer — but no production caller ever passed it, so the
 * option was dead code and the race it was written to prevent still shipped.
 * The moe.19 Windows VM verify (evidence 2026-09-06) caught it live: the first
 * send with the cloud unreachable degraded to on-device, the degrade scheduled
 * a Gateway reload, Windows turned the reload into a full restart, the restart
 * lost the port race ("Port 18789 still occupied" x3), and the Gateway was
 * down for three minutes. Three fresh sessions in a row produced an empty
 * assistant bubble.
 *
 * A layer-level test cannot catch "nobody calls it". This one asserts the wire.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';

const mocks = vi.hoisted(() => ({
  applyChannelChange: vi.fn(),
  getSetting: vi.fn(),
  setSetting: vi.fn(),
  getAllSettings: vi.fn(),
  resetSettings: vi.fn(),
  parseJsonBody: vi.fn(),
  sendJson: vi.fn(),
  applyProxySettings: vi.fn(),
  syncProxyConfigToOpenClaw: vi.fn(),
  syncLaunchAtStartupSettingFromStore: vi.fn(),
}));

vi.mock('@electron/services/providers/channel-router', () => ({
  applyChannelChange: mocks.applyChannelChange,
}));

vi.mock('@electron/utils/store', () => ({
  getAllSettings: mocks.getAllSettings,
  getSetting: mocks.getSetting,
  resetSettings: mocks.resetSettings,
  setSetting: mocks.setSetting,
}));

vi.mock('@electron/api/route-utils', () => ({
  parseJsonBody: mocks.parseJsonBody,
  sendJson: mocks.sendJson,
}));

vi.mock('@electron/main/proxy', () => ({ applyProxySettings: mocks.applyProxySettings }));
vi.mock('@electron/utils/openclaw-proxy', () => ({ syncProxyConfigToOpenClaw: mocks.syncProxyConfigToOpenClaw }));
vi.mock('@electron/main/launch-at-startup', () => ({
  syncLaunchAtStartupSettingFromStore: mocks.syncLaunchAtStartupSettingFromStore,
}));
vi.mock('@electron/utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { handleSettingsRoutes } from '@electron/api/routes/settings';

const gatewayManager = { getStatus: () => ({ state: 'running' }), restart: vi.fn() };
const ctx = { gatewayManager } as never;

function call(method: string, pathname: string): Promise<boolean> {
  return handleSettingsRoutes(
    { method } as IncomingMessage,
    {} as ServerResponse,
    new URL(`http://127.0.0.1:13210${pathname}`),
    ctx,
  );
}

describe('POST /api/settings/degradeChannel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSetting.mockResolvedValue('online');
    mocks.applyChannelChange.mockResolvedValue({
      channel: 'on-device',
      accountId: 'ollama-local',
      modelRef: 'ollama-ollamalo/qwen2.5:3b-instruct',
      switched: true,
    });
  });

  it('suppresses the gateway refresh so the in-flight resend is not orphaned', async () => {
    mocks.parseJsonBody.mockResolvedValue({ channel: 'on-device', reason: 'unreachable' });

    expect(await call('POST', '/api/settings/degradeChannel')).toBe(true);

    expect(mocks.applyChannelChange).toHaveBeenCalledTimes(1);
    expect(mocks.applyChannelChange).toHaveBeenCalledWith(
      'on-device',
      gatewayManager,
      { skipGatewayRefresh: true },
    );
  });

  it('leaves the principal\'s stored preference untouched', async () => {
    mocks.parseJsonBody.mockResolvedValue({ channel: 'on-device', reason: 'rate-limited' });

    await call('POST', '/api/settings/degradeChannel');

    expect(mocks.setSetting).not.toHaveBeenCalled();
    const [, payload] = mocks.sendJson.mock.calls.at(-1) as [unknown, number, Record<string, unknown>];
    expect(payload).toBe(200);
  });

  it('rejects a channel it does not recognise instead of degrading blind', async () => {
    mocks.parseJsonBody.mockResolvedValue({ channel: 'satellite' });

    await call('POST', '/api/settings/degradeChannel');

    expect(mocks.applyChannelChange).not.toHaveBeenCalled();
    expect(mocks.sendJson).toHaveBeenCalledWith(expect.anything(), 400, expect.objectContaining({ success: false }));
  });
});

describe('PUT /api/settings (the principal\'s own toggle)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setSetting.mockResolvedValue(undefined);
    mocks.applyChannelChange.mockResolvedValue({
      channel: 'on-device',
      accountId: 'ollama-local',
      modelRef: 'ollama-ollamalo/qwen2.5:3b-instruct',
      switched: true,
    });
  });

  // Falsifiability for the suite above: if the assertion were "skipGatewayRefresh
  // is passed somewhere", it would pass on a build that suppressed the refresh
  // everywhere — which would leave the deliberate toggle needing a restart to
  // take effect. The toggle is NOT inside a turn, so it must still refresh.
  it('persists the preference and still refreshes the gateway', async () => {
    mocks.parseJsonBody.mockResolvedValue({ preferredChannel: 'on-device' });

    expect(await call('PUT', '/api/settings')).toBe(true);

    expect(mocks.setSetting).toHaveBeenCalledWith('preferredChannel', 'on-device');
    expect(mocks.applyChannelChange).toHaveBeenCalledWith('on-device', gatewayManager);
    const options = mocks.applyChannelChange.mock.calls[0]?.[2];
    expect(options?.skipGatewayRefresh).not.toBe(true);
  });
});
