import type { IncomingMessage, ServerResponse } from 'http';
import { applyProxySettings } from '../../main/proxy';
import { syncLaunchAtStartupSettingFromStore } from '../../main/launch-at-startup';
import { syncProxyConfigToOpenClaw } from '../../utils/openclaw-proxy';
import { getAllSettings, getSetting, resetSettings, setSetting, type AppSettings } from '../../utils/store';
import {
  applyChannelChange,
  prepareTransientChannelChange,
  type ProviderChannel,
} from '../../services/providers/channel-router';
import { logger } from '../../utils/logger';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';

async function handleProxySettingsChange(ctx: HostApiContext): Promise<void> {
  const settings = await getAllSettings();
  await syncProxyConfigToOpenClaw(settings, { preserveExistingWhenDisabled: false });
  await applyProxySettings(settings);
  if (ctx.gatewayManager.getStatus().state === 'running') {
    await ctx.gatewayManager.restart();
  }
}

function patchTouchesProxy(patch: Partial<AppSettings>): boolean {
  return Object.keys(patch).some((key) => (
    key === 'proxyEnabled' ||
    key === 'proxyServer' ||
    key === 'proxyHttpServer' ||
    key === 'proxyHttpsServer' ||
    key === 'proxyAllServer' ||
    key === 'proxyBypassRules'
  ));
}

function patchTouchesLaunchAtStartup(patch: Partial<AppSettings>): boolean {
  return Object.prototype.hasOwnProperty.call(patch, 'launchAtStartup');
}

function isProviderChannel(value: unknown): value is ProviderChannel {
  return value === 'online' || value === 'on-device';
}

/**
 * Run the channel-change transaction. Failures are logged but the settings
 * write itself is not rolled back — `applyChannelChange` is idempotent so the
 * preflight on next launch will reconcile if e.g. the gateway was unreachable.
 */
async function runChannelTransaction(
  value: unknown,
  ctx: HostApiContext,
): Promise<{ success: true; modelRef: string; accountId: string } | { success: false; error: string }> {
  if (!isProviderChannel(value)) {
    return { success: false, error: `Invalid preferredChannel value: ${String(value)}` };
  }

  try {
    const result = await applyChannelChange(value, ctx.gatewayManager);
    return { success: true, modelRef: result.modelRef, accountId: result.accountId };
  } catch (error) {
    logger.warn('[settings] channel-change transaction failed; setting persisted anyway:', error);
    return { success: false, error: String(error) };
  }
}

export async function handleSettingsRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/settings' && req.method === 'GET') {
    sendJson(res, 200, await getAllSettings());
    return true;
  }

  if (url.pathname === '/api/settings' && req.method === 'PUT') {
    try {
      const patch = await parseJsonBody<Partial<AppSettings>>(req);
      const entries = Object.entries(patch) as Array<[keyof AppSettings, AppSettings[keyof AppSettings]]>;
      for (const [key, value] of entries) {
        await setSetting(key, value);
      }
      if (patchTouchesProxy(patch)) {
        await handleProxySettingsChange(ctx);
      }
      if (patchTouchesLaunchAtStartup(patch)) {
        await syncLaunchAtStartupSettingFromStore();
      }
      let channelResult: Awaited<ReturnType<typeof runChannelTransaction>> | undefined;
      if (Object.prototype.hasOwnProperty.call(patch, 'preferredChannel')) {
        channelResult = await runChannelTransaction(patch.preferredChannel, ctx);
      }
      sendJson(res, 200, { success: true, channel: channelResult });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  /**
   * Degrade the runtime onto a channel WITHOUT persisting `preferredChannel`.
   *
   * This is the send-time failover path (`docs/OFFLINE_ARCHITECTURE.md` §3.1):
   * a cloud turn failed because the provider was unreachable or the fleet token
   * budget returned 429, and we want the next turn to run on-device instead of
   * failing. Crucially it must NOT rewrite the principal's stored preference —
   * their explicit toggle stays authoritative so the app returns to Online on
   * its own once connectivity or budget recovers.
   *
   * That is why this is a separate route rather than a flag on the
   * `preferredChannel` PUT: the only difference is the `setSetting` call, and
   * making it conditional there is exactly the kind of subtlety that later
   * silently starts persisting again.
   */
  if (url.pathname === '/api/settings/degradeChannel' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ channel?: unknown; reason?: unknown }>(req);
      if (!isProviderChannel(body.channel)) {
        sendJson(res, 400, { success: false, error: `Invalid channel: ${String(body.channel)}` });
        return true;
      }
      // This route runs INSIDE a failed turn. It prepares the target provider
      // entry/auth and returns the model ref so the renderer can pin only the
      // current session. It deliberately does not change preferredChannel,
      // defaultProvider, all-agent defaults, or the running gateway default.
      const result = await prepareTransientChannelChange(body.channel);
      logger.info('[settings] Prepared transient channel degrade', {
        channel: body.channel,
        reason: typeof body.reason === 'string' ? body.reason : 'unspecified',
        modelRef: result.modelRef,
      });
      sendJson(res, 200, {
        success: true,
        channel: result.channel,
        modelRef: result.modelRef,
        accountId: result.accountId,
      });
    } catch (error) {
      logger.warn('[settings] degradeChannel failed:', error);
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/settings/') && req.method === 'GET') {
    const key = url.pathname.slice('/api/settings/'.length) as keyof AppSettings;
    try {
      sendJson(res, 200, { value: await getSetting(key) });
    } catch (error) {
      sendJson(res, 404, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/settings/') && req.method === 'PUT') {
    const key = url.pathname.slice('/api/settings/'.length) as keyof AppSettings;
    try {
      const body = await parseJsonBody<{ value: AppSettings[keyof AppSettings] }>(req);
      await setSetting(key, body.value);
      if (
        key === 'proxyEnabled' ||
        key === 'proxyServer' ||
        key === 'proxyHttpServer' ||
        key === 'proxyHttpsServer' ||
        key === 'proxyAllServer' ||
        key === 'proxyBypassRules'
      ) {
        await handleProxySettingsChange(ctx);
      }
      if (key === 'launchAtStartup') {
        await syncLaunchAtStartupSettingFromStore();
      }
      let channelResult: Awaited<ReturnType<typeof runChannelTransaction>> | undefined;
      if (key === 'preferredChannel') {
        channelResult = await runChannelTransaction(body.value, ctx);
      }
      sendJson(res, 200, { success: true, channel: channelResult });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/settings/reset' && req.method === 'POST') {
    try {
      await resetSettings();
      await handleProxySettingsChange(ctx);
      await syncLaunchAtStartupSettingFromStore();
      sendJson(res, 200, { success: true, settings: await getAllSettings() });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
