import type { IncomingMessage, ServerResponse } from 'http';
import {
  type ProviderConfig,
} from '../../utils/secure-storage';
import {
  getProviderConfig,
} from '../../utils/provider-registry';
import { deviceOAuthManager, type OAuthProviderType } from '../../utils/device-oauth';
import { browserOAuthManager, type BrowserOAuthProviderType } from '../../utils/browser-oauth';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';
import {
  syncDefaultProviderToRuntime,
  syncDeletedProviderApiKeyToRuntime,
  syncDeletedProviderToRuntime,
  syncProviderApiKeyToRuntime,
  syncSavedProviderToRuntime,
  syncUpdatedProviderToRuntime,
} from '../../services/providers/provider-runtime-sync';
import { validateApiKeyWithProvider } from '../../services/providers/provider-validation';
import { classifyAccount, type ProviderChannel } from '../../services/providers/channel-router';
import { getProviderService } from '../../services/providers/provider-service';
import { providerAccountToConfig } from '../../services/providers/provider-store';
import { probeLocalProviderReadiness } from '../../main/local-provider-seed';
import type { ProviderAccount } from '../../shared/providers/types';
import { logger } from '../../utils/logger';

const legacyProviderRoutesWarned = new Set<string>();

const STORED_DEFAULT_PROBE_TIMEOUT_MS = 5_000;

type StoredDefaultProviderProbeReason =
  | 'ok'
  | 'missing-default'
  | 'missing-account'
  | 'offline-channel'
  | 'missing-key'
  | 'unsupported'
  | 'unavailable'
  | 'changed-default'
  | 'probe-error';

type StoredDefaultProviderProbeResult = {
  success: true;
  valid: boolean;
  accountId: string | null;
  channel: ProviderChannel | null;
  status: number | null;
  reason: StoredDefaultProviderProbeReason;
};

function storedDefaultProviderProbeResult(
  reason: StoredDefaultProviderProbeReason,
  options: { accountId?: string | null; channel?: ProviderChannel | null; status?: number | null; valid?: boolean } = {},
): StoredDefaultProviderProbeResult {
  return {
    success: true,
    valid: options.valid ?? reason === 'ok',
    accountId: options.accountId ?? null,
    channel: options.channel ?? null,
    status: options.status ?? null,
    reason,
  };
}

async function probeProviderAccount(
  account: ProviderAccount,
  options: { expectedDefaultAccountId?: string | null } = {},
): Promise<StoredDefaultProviderProbeResult> {
  const channel = classifyAccount(account);
  if (channel !== 'online') {
    const readiness = await probeLocalProviderReadiness({
      baseUrl: account.baseUrl,
      modelId: account.model,
      timeoutMs: STORED_DEFAULT_PROBE_TIMEOUT_MS,
    });
    if (options.expectedDefaultAccountId) {
      const currentDefaultAccountId = await getProviderService().getDefaultAccountId();
      if (currentDefaultAccountId !== options.expectedDefaultAccountId) {
        return storedDefaultProviderProbeResult('changed-default', {
          accountId: options.expectedDefaultAccountId,
          channel,
          status: readiness.status ?? null,
        });
      }
    }
    return storedDefaultProviderProbeResult(readiness.ready ? 'ok' : 'unavailable', {
      accountId: account.id,
      channel,
      status: readiness.status ?? null,
      valid: readiness.ready,
    });
  }

  const providerService = getProviderService();
  const apiKey = await providerService.getEffectiveAccountApiKey(account);
  if (!apiKey?.trim()) {
    return storedDefaultProviderProbeResult('missing-key', { accountId: account.id, channel });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), STORED_DEFAULT_PROBE_TIMEOUT_MS);
  try {
    const registryBaseUrl = getProviderConfig(account.vendorId)?.baseUrl;
    const result = await validateApiKeyWithProvider(account.vendorId, apiKey, {
      baseUrl: account.baseUrl || registryBaseUrl,
      apiProtocol: account.apiProtocol,
      quiet: true,
      signal: controller.signal,
    });
    if (options.expectedDefaultAccountId) {
      const currentDefaultAccountId = await providerService.getDefaultAccountId();
      if (currentDefaultAccountId !== options.expectedDefaultAccountId) {
        return storedDefaultProviderProbeResult('changed-default', {
          accountId: options.expectedDefaultAccountId,
          channel,
          status: result.status ?? null,
        });
      }
    }

    const status = result.status ?? null;
    if (typeof status !== 'number') {
      return storedDefaultProviderProbeResult('unsupported', { accountId: account.id, channel, status });
    }
    if (result.valid === true && status >= 200 && status < 300) {
      return storedDefaultProviderProbeResult('ok', { accountId: account.id, channel, status, valid: true });
    }
    return storedDefaultProviderProbeResult('unavailable', { accountId: account.id, channel, status });
  } catch (error) {
    logger.warn('[provider-probe] provider account probe failed', {
      accountId: account.id,
      providerType: account.vendorId,
      error: error instanceof Error ? error.name : typeof error,
    });
    return storedDefaultProviderProbeResult('probe-error', { accountId: account.id, channel });
  } finally {
    clearTimeout(timeout);
  }
}

async function probeStoredProviderAccount(accountId: string): Promise<StoredDefaultProviderProbeResult> {
  const providerService = getProviderService();
  const accounts = await providerService.listAccounts();
  const account = accounts.find((candidate) => candidate.id === accountId)
    ?? await providerService.getAccount(accountId);
  if (!account) {
    return storedDefaultProviderProbeResult('missing-account', { accountId });
  }

  return probeProviderAccount(account);
}

async function probeStoredDefaultProvider(): Promise<StoredDefaultProviderProbeResult> {
  const providerService = getProviderService();
  const defaultAccountId = await providerService.getDefaultAccountId();
  if (!defaultAccountId) {
    return storedDefaultProviderProbeResult('missing-default');
  }

  const accounts = await providerService.listAccounts();
  const account = accounts.find((candidate) => candidate.id === defaultAccountId)
    ?? await providerService.getAccount(defaultAccountId);
  if (!account) {
    return storedDefaultProviderProbeResult('missing-account', { accountId: defaultAccountId });
  }

  return probeProviderAccount(account, { expectedDefaultAccountId: defaultAccountId });
}

function hasObjectChanges<T extends Record<string, unknown>>(
  existing: T,
  patch: Partial<T> | undefined,
): boolean {
  if (!patch) return false;
  const keys = Object.keys(patch) as Array<keyof T>;
  if (keys.length === 0) return false;
  return keys.some((key) => JSON.stringify(existing[key]) !== JSON.stringify(patch[key]));
}

export async function handleProviderRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  const providerService = getProviderService();
  const logLegacyProviderRoute = (route: string): void => {
    if (legacyProviderRoutesWarned.has(route)) return;
    legacyProviderRoutesWarned.add(route);
    logger.warn(
      `[provider-migration] Legacy HTTP route "${route}" is deprecated. Prefer /api/provider-accounts endpoints.`,
    );
  };

  if (url.pathname === '/api/provider-vendors' && req.method === 'GET') {
    sendJson(res, 200, await providerService.listVendors());
    return true;
  }

  if (url.pathname === '/api/provider-accounts' && req.method === 'GET') {
    sendJson(res, 200, await providerService.listAccounts());
    return true;
  }

  if (url.pathname === '/api/provider-accounts' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ account: ProviderAccount; apiKey?: string }>(req);
      const account = await providerService.createAccount(body.account, body.apiKey);
      await syncSavedProviderToRuntime(providerAccountToConfig(account), body.apiKey, ctx.gatewayManager);
      sendJson(res, 200, { success: true, account });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/provider-accounts/default' && req.method === 'GET') {
    sendJson(res, 200, { accountId: await providerService.getDefaultAccountId() ?? null });
    return true;
  }

  if (url.pathname === '/api/provider-accounts/default' && req.method === 'PUT') {
    try {
      const body = await parseJsonBody<{ accountId: string }>(req);
      const currentDefault = await providerService.getDefaultAccountId();
      if (currentDefault === body.accountId) {
        sendJson(res, 200, { success: true, noChange: true });
        return true;
      }
      await providerService.setDefaultAccount(body.accountId);
      await syncDefaultProviderToRuntime(body.accountId, ctx.gatewayManager);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  // ── New account-based companion endpoints ─────────────────────────
  // Exposed alongside the existing /api/provider-accounts surface so the
  // renderer (and any future external client) can drop the legacy
  // /api/providers paths without losing functionality. Specific paths
  // must be matched BEFORE the generic /api/provider-accounts/:id rule
  // below to avoid being captured as account ids.

  if (url.pathname === '/api/provider-accounts/key-info' && req.method === 'GET') {
    sendJson(res, 200, await providerService.listAccountsKeyInfo());
    return true;
  }

  if (url.pathname === '/api/provider-accounts/default/probe' && req.method === 'GET') {
    try {
      sendJson(res, 200, await probeStoredDefaultProvider());
    } catch (error) {
      logger.warn('[provider-probe] stored default provider probe failed before validation', {
        error: error instanceof Error ? error.name : typeof error,
      });
      sendJson(res, 200, storedDefaultProviderProbeResult('probe-error'));
    }
    return true;
  }

  const accountProbeMatch = url.pathname.match(/^\/api\/provider-accounts\/([^/]+)\/probe$/);
  if (accountProbeMatch && req.method === 'GET') {
    try {
      sendJson(res, 200, await probeStoredProviderAccount(decodeURIComponent(accountProbeMatch[1])));
    } catch (error) {
      logger.warn('[provider-probe] provider account probe failed before validation', {
        error: error instanceof Error ? error.name : typeof error,
      });
      sendJson(res, 200, storedDefaultProviderProbeResult('probe-error'));
    }
    return true;
  }

  if (url.pathname === '/api/provider-accounts/validate' && req.method === 'POST') {
    try {
      // Accept legacy `providerId` as a fallback so external clients that
      // migrate by URL alone (without renaming their request body) continue
      // to work. The renderer always sends all three fields; older callers
      // may send only `providerId`.
      const body = await parseJsonBody<{
        accountId?: string;
        vendorId?: string;
        providerId?: string;
        apiKey: string;
        options?: { baseUrl?: string; apiProtocol?: string };
      }>(req);
      const accountId = body.accountId || body.vendorId || body.providerId || '';
      const account = accountId ? await providerService.getAccount(accountId) : null;
      const providerType = account?.vendorId || body.vendorId || body.providerId || accountId;
      const registryBaseUrl = getProviderConfig(providerType)?.baseUrl;
      const resolvedBaseUrl = body.options?.baseUrl || account?.baseUrl || registryBaseUrl;
      const resolvedProtocol = body.options?.apiProtocol || account?.apiProtocol;
      sendJson(res, 200, await validateApiKeyWithProvider(providerType, body.apiKey, {
        baseUrl: resolvedBaseUrl,
        apiProtocol: resolvedProtocol,
      }));
    } catch (error) {
      sendJson(res, 500, { valid: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/provider-accounts/oauth/start' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{
        provider: OAuthProviderType | BrowserOAuthProviderType;
        region?: 'global' | 'cn';
        accountId?: string;
        label?: string;
      }>(req);
      if (body.provider === 'google' || body.provider === 'openai') {
        await browserOAuthManager.startFlow(body.provider, {
          accountId: body.accountId,
          label: body.label,
        });
      } else {
        await deviceOAuthManager.startFlow(body.provider, body.region, {
          accountId: body.accountId,
          label: body.label,
        });
      }
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/provider-accounts/oauth/cancel' && req.method === 'POST') {
    try {
      await deviceOAuthManager.stopFlow();
      await browserOAuthManager.stopFlow();
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/provider-accounts/oauth/submit' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ code: string }>(req);
      const accepted = browserOAuthManager.submitManualCode(body.code || '');
      if (!accepted) {
        sendJson(res, 400, { success: false, error: 'No active manual OAuth input pending' });
        return true;
      }
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/provider-accounts/') && req.method === 'GET') {
    const remainder = decodeURIComponent(url.pathname.slice('/api/provider-accounts/'.length));
    if (remainder.endsWith('/api-key')) {
      const accountId = remainder.slice(0, -'/api-key'.length);
      sendJson(res, 200, { apiKey: await providerService.getAccountApiKey(accountId) });
      return true;
    }
    if (remainder.endsWith('/has-api-key')) {
      const accountId = remainder.slice(0, -'/has-api-key'.length);
      sendJson(res, 200, { hasKey: await providerService.hasAccountApiKey(accountId) });
      return true;
    }
    sendJson(res, 200, await providerService.getAccount(remainder));
    return true;
  }

  if (url.pathname.startsWith('/api/provider-accounts/') && req.method === 'PUT') {
    const accountId = decodeURIComponent(url.pathname.slice('/api/provider-accounts/'.length));
    try {
      const body = await parseJsonBody<{ updates: Partial<ProviderAccount>; apiKey?: string }>(req);
      const existing = await providerService.getAccount(accountId);
      if (!existing) {
        sendJson(res, 404, { success: false, error: 'Provider account not found' });
        return true;
      }
      const hasPatchChanges = hasObjectChanges(existing as unknown as Record<string, unknown>, body.updates);
      if (!hasPatchChanges && body.apiKey === undefined) {
        sendJson(res, 200, { success: true, noChange: true, account: existing });
        return true;
      }
      const nextAccount = await providerService.updateAccount(accountId, body.updates, body.apiKey);
      await syncUpdatedProviderToRuntime(providerAccountToConfig(nextAccount), body.apiKey, ctx.gatewayManager);
      sendJson(res, 200, { success: true, account: nextAccount });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/provider-accounts/') && req.method === 'DELETE') {
    const accountId = decodeURIComponent(url.pathname.slice('/api/provider-accounts/'.length));
    try {
      const existing = await providerService.getAccount(accountId);
      const runtimeProviderKey = existing?.authMode === 'oauth_browser'
        ? (existing.vendorId === 'google'
          ? 'google-gemini-cli'
          : (existing.vendorId === 'openai' ? 'openai-codex' : undefined))
        : undefined;
      if (url.searchParams.get('apiKeyOnly') === '1') {
        await providerService._deleteProviderApiKeyInternal(accountId);
        await syncDeletedProviderApiKeyToRuntime(
          existing ? providerAccountToConfig(existing) : null,
          accountId,
          runtimeProviderKey,
        );
        sendJson(res, 200, { success: true });
        return true;
      }
      await providerService.deleteAccount(accountId);
      await syncDeletedProviderToRuntime(
        existing ? providerAccountToConfig(existing) : null,
        accountId,
        ctx.gatewayManager,
        runtimeProviderKey,
      );
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/providers' && req.method === 'GET') {
    logLegacyProviderRoute('GET /api/providers');
    sendJson(res, 200, await providerService._listProvidersWithKeyInfoInternal());
    return true;
  }

  if (url.pathname === '/api/providers/default' && req.method === 'GET') {
    logLegacyProviderRoute('GET /api/providers/default');
    sendJson(res, 200, { providerId: await providerService._getDefaultProviderInternal() ?? null });
    return true;
  }

  if (url.pathname === '/api/providers/default' && req.method === 'PUT') {
    logLegacyProviderRoute('PUT /api/providers/default');
    try {
      const body = await parseJsonBody<{ providerId: string }>(req);
      const currentDefault = await providerService._getDefaultProviderInternal();
      if (currentDefault === body.providerId) {
        sendJson(res, 200, { success: true, noChange: true });
        return true;
      }
      await providerService._setDefaultProviderInternal(body.providerId);
      await syncDefaultProviderToRuntime(body.providerId, ctx.gatewayManager);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/providers/validate' && req.method === 'POST') {
    logLegacyProviderRoute('POST /api/providers/validate');
    try {
      const body = await parseJsonBody<{ providerId: string; apiKey: string; options?: { baseUrl?: string; apiProtocol?: string } }>(req);
      const provider = await providerService._getProviderInternal(body.providerId);
      const providerType = provider?.type || body.providerId;
      const registryBaseUrl = getProviderConfig(providerType)?.baseUrl;
      const resolvedBaseUrl = body.options?.baseUrl || provider?.baseUrl || registryBaseUrl;
      const resolvedProtocol = body.options?.apiProtocol || provider?.apiProtocol;
      sendJson(res, 200, await validateApiKeyWithProvider(providerType, body.apiKey, { baseUrl: resolvedBaseUrl, apiProtocol: resolvedProtocol }));
    } catch (error) {
      sendJson(res, 500, { valid: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/providers/oauth/start' && req.method === 'POST') {
    logLegacyProviderRoute('POST /api/providers/oauth/start');
    try {
      const body = await parseJsonBody<{
        provider: OAuthProviderType | BrowserOAuthProviderType;
        region?: 'global' | 'cn';
        accountId?: string;
        label?: string;
      }>(req);
      if (body.provider === 'google' || body.provider === 'openai') {
        await browserOAuthManager.startFlow(body.provider, {
          accountId: body.accountId,
          label: body.label,
        });
      } else {
        await deviceOAuthManager.startFlow(body.provider, body.region, {
          accountId: body.accountId,
          label: body.label,
        });
      }
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/providers/oauth/cancel' && req.method === 'POST') {
    logLegacyProviderRoute('POST /api/providers/oauth/cancel');
    try {
      await deviceOAuthManager.stopFlow();
      await browserOAuthManager.stopFlow();
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/providers/oauth/submit' && req.method === 'POST') {
    logLegacyProviderRoute('POST /api/providers/oauth/submit');
    try {
      const body = await parseJsonBody<{ code: string }>(req);
      const accepted = browserOAuthManager.submitManualCode(body.code || '');
      if (!accepted) {
        sendJson(res, 400, { success: false, error: 'No active manual OAuth input pending' });
        return true;
      }
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/providers' && req.method === 'POST') {
    logLegacyProviderRoute('POST /api/providers');
    try {
      const body = await parseJsonBody<{ config: ProviderConfig; apiKey?: string }>(req);
      const config = body.config;
      await providerService._saveProviderInternal(config);
      if (body.apiKey !== undefined) {
        const trimmedKey = body.apiKey.trim();
        if (trimmedKey) {
          await providerService._setProviderApiKeyInternal(config.id, trimmedKey);
          await syncProviderApiKeyToRuntime(config.type, config.id, trimmedKey);
        }
      }
      await syncSavedProviderToRuntime(config, body.apiKey, ctx.gatewayManager);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/providers/') && req.method === 'GET') {
    logLegacyProviderRoute('GET /api/providers/:id');
    const providerId = decodeURIComponent(url.pathname.slice('/api/providers/'.length));
    if (providerId.endsWith('/api-key')) {
      const actualId = providerId.slice(0, -('/api-key'.length));
      sendJson(res, 200, { apiKey: await providerService._getProviderApiKeyInternal(actualId) });
      return true;
    }
    if (providerId.endsWith('/has-api-key')) {
      const actualId = providerId.slice(0, -('/has-api-key'.length));
      sendJson(res, 200, { hasKey: await providerService._hasProviderApiKeyInternal(actualId) });
      return true;
    }
    sendJson(res, 200, await providerService._getProviderInternal(providerId));
    return true;
  }

  if (url.pathname.startsWith('/api/providers/') && req.method === 'PUT') {
    logLegacyProviderRoute('PUT /api/providers/:id');
    const providerId = decodeURIComponent(url.pathname.slice('/api/providers/'.length));
    try {
      const body = await parseJsonBody<{ updates: Partial<ProviderConfig>; apiKey?: string }>(req);
      const existing = await providerService._getProviderInternal(providerId);
      if (!existing) {
        sendJson(res, 404, { success: false, error: 'Provider not found' });
        return true;
      }
      const hasPatchChanges = hasObjectChanges(existing as unknown as Record<string, unknown>, body.updates);
      if (!hasPatchChanges && body.apiKey === undefined) {
        sendJson(res, 200, { success: true, noChange: true });
        return true;
      }
      const nextConfig: ProviderConfig = { ...existing, ...body.updates, updatedAt: new Date().toISOString() };
      await providerService._saveProviderInternal(nextConfig);
      if (body.apiKey !== undefined) {
        const trimmedKey = body.apiKey.trim();
        if (trimmedKey) {
          await providerService._setProviderApiKeyInternal(providerId, trimmedKey);
          await syncProviderApiKeyToRuntime(nextConfig.type, providerId, trimmedKey);
        } else {
          await providerService._deleteProviderApiKeyInternal(providerId);
          await syncDeletedProviderApiKeyToRuntime(existing, providerId);
        }
      }
      await syncUpdatedProviderToRuntime(nextConfig, body.apiKey, ctx.gatewayManager);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/providers/') && req.method === 'DELETE') {
    logLegacyProviderRoute('DELETE /api/providers/:id');
    const providerId = decodeURIComponent(url.pathname.slice('/api/providers/'.length));
    try {
      const existing = await providerService._getProviderInternal(providerId);
      if (url.searchParams.get('apiKeyOnly') === '1') {
        await providerService._deleteProviderApiKeyInternal(providerId);
        await syncDeletedProviderApiKeyToRuntime(existing, providerId);
        sendJson(res, 200, { success: true });
        return true;
      }
      await providerService._deleteProviderInternal(providerId);
      await syncDeletedProviderToRuntime(existing, providerId, ctx.gatewayManager);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
