/**
 * Channel router — single source of truth for the Online / On-this-device toggle.
 *
 * The principal-facing UI exposes two channels: "online" and "on-device". Until
 * this module existed, that toggle only flipped `preferredChannel` in the
 * renderer-persisted settings store. The agent runtime resolved its model from
 * a completely separate path (`agents.list[<id>].model.primary` in
 * `~/.openclaw/openclaw.json`), so a chat could keep going to ollama after the
 * user picked Online.
 *
 * `applyChannelChange` is the *one* function the toggle should call. It runs
 * the four-store transaction in a deterministic order:
 *
 *   1. clawx-providers.json       — defaultProvider / defaultProviderAccountId
 *   2. openclaw.json (providers)  — runtime provider entry + auth
 *   3. openclaw.json (agents)     — agents.defaults.model.primary +
 *                                    agents.list[*].model.primary
 *   4. clawx-providers.json again — isDefault flag on all accounts
 *
 * Any partial failure logs and rethrows; settings PUT will surface the error
 * to the renderer so the user knows the toggle didn't take.
 */
import { setAllAgentsModel } from '../../utils/agent-config';
import { logger } from '../../utils/logger';
import {
  getDefaultProvider,
  getProvider,
  setDefaultProvider,
} from '../../utils/secure-storage';
import type { ProviderConfig } from '../../utils/secure-storage';
import { getProviderDefaultModel } from '../../utils/provider-registry';
import type { GatewayManager } from '../../gateway/manager';
import { listProviderAccounts } from './provider-store';
import {
  ensureProviderAccountRuntime,
  getOpenClawProviderKey,
  syncDefaultProviderToRuntime,
} from './provider-runtime-sync';

export { ensureBootableAgentsConfig } from '../../utils/agent-config';

export type ProviderChannel = 'online' | 'on-device';

const LOCAL_HOST_PATTERN = /^(?:https?:\/\/)?(?:127(?:\.\d{1,3}){3}|localhost|::1|\[::1\])(?::\d+)?(?:\/|$)/i;

const ONLINE_VENDOR_IDS = new Set([
  'anthropic',
  'openai',
  'google',
  'openrouter',
  'ark',
  'moonshot',
  'moonshot-global',
  'siliconflow',
  'deepseek',
  'minimax-portal',
  'minimax-portal-cn',
  'modelstudio',
]);

const LOCAL_VENDOR_IDS = new Set(['ollama']);

function classifyAccount(account: { vendorId: string; baseUrl?: string }): ProviderChannel {
  const baseUrl = (account.baseUrl ?? '').trim();
  if (baseUrl && LOCAL_HOST_PATTERN.test(baseUrl)) return 'on-device';
  const vendorId = (account.vendorId ?? '').trim().toLowerCase();
  if (LOCAL_VENDOR_IDS.has(vendorId)) return 'on-device';
  if (ONLINE_VENDOR_IDS.has(vendorId)) return 'online';
  return 'online';
}

/**
 * Pick the best account in the requested channel. Mirrors the renderer's
 * `pickAccountForChannel` selection rules so the toggle's local-state
 * decision and the main-process write resolve to the same account.
 */
async function pickAccountForChannel(channel: ProviderChannel): Promise<{
  accountId: string;
  vendorId: string;
  model?: string;
} | null> {
  const accounts = await listProviderAccounts();
  if (accounts.length === 0) return null;

  const inChannel = accounts.filter((a) => classifyAccount({ vendorId: a.vendorId, baseUrl: a.baseUrl }) === channel);
  if (inChannel.length === 0) return null;

  const defaultMatch = inChannel.find((a) => a.isDefault === true);
  const firstEnabled = inChannel.find((a) => a.enabled !== false);
  const picked = defaultMatch ?? firstEnabled ?? inChannel[0];
  if (!picked) return null;

  return {
    accountId: picked.id,
    vendorId: picked.vendorId,
    model: picked.model,
  };
}

function deriveModelRef(provider: ProviderConfig, runtimeKey: string): string | null {
  const explicit = (provider.model ?? '').trim();
  if (explicit) {
    return explicit.startsWith(`${runtimeKey}/`) ? explicit : `${runtimeKey}/${explicit}`;
  }
  const fallback = getProviderDefaultModel(provider.type)?.trim();
  if (!fallback) return null;
  return fallback.startsWith(`${runtimeKey}/`) ? fallback : `${runtimeKey}/${fallback}`;
}

export interface ApplyChannelChangeResult {
  channel: ProviderChannel;
  accountId: string;
  modelRef: string;
  switched: boolean;
}

export interface ApplyChannelChangeOptions {
  /**
   * Write the four stores but leave the running Gateway alone.
   *
   * Set by pre-start boot convergence. That path runs before the Gateway starts,
   * so queueing a refresh there is unnecessary and can only add startup churn.
   *
   * Live settings toggles must not set it because their running Gateway needs an
   * immediate refresh.
   */
  skipGatewayRefresh?: boolean;
}

async function getProviderAccountRuntime(accountId: string): Promise<{ modelRef: string; channel: ProviderChannel }> {
  const provider = await getProvider(accountId);
  if (!provider) {
    throw new Error(`Provider account "${accountId}" disappeared mid-transaction`);
  }

  const runtimeKey = getOpenClawProviderKey(provider.type, provider.id);
  const modelRef = deriveModelRef(provider, runtimeKey);
  if (!modelRef) {
    throw new Error(
      `Provider account "${accountId}" has no model configured. ` +
      `Open Settings → Models and pick a model.`,
    );
  }

  return {
    modelRef,
    channel: classifyAccount({ vendorId: provider.type, baseUrl: provider.baseUrl }),
  };
}

async function applyProviderAccountDefault(
  accountId: string,
  gatewayManager?: GatewayManager,
  options?: ApplyChannelChangeOptions,
  writeDefault = true,
): Promise<{ accountId: string; modelRef: string; channel: ProviderChannel }> {
  const { modelRef, channel } = await getProviderAccountRuntime(accountId);

  if (writeDefault) {
    await setDefaultProvider(accountId);
  }
  await syncDefaultProviderToRuntime(accountId, gatewayManager, {
    skipGatewayRefresh: options?.skipGatewayRefresh === true,
  });
  await setAllAgentsModel(modelRef);

  return { accountId, modelRef, channel };
}

/**
 * Run the channel-change transaction. If the requested channel has no
 * configured account, throws — callers should surface a "configure a model
 * first" toast rather than silently leaving the system in a mismatched state.
 */
export async function applyChannelChange(
  channel: ProviderChannel,
  gatewayManager?: GatewayManager,
  options?: ApplyChannelChangeOptions,
): Promise<ApplyChannelChangeResult> {
  const picked = await pickAccountForChannel(channel);
  if (!picked) {
    throw new Error(
      `No provider account is configured for the "${channel}" channel. ` +
      `Add one in Settings → Models before switching channels.`,
    );
  }

  const previousDefault = await getDefaultProvider();
  const switched = previousDefault !== picked.accountId;

  // 1+2. clawx-providers.json default + runtime providers/auth (writes both
  // defaultProvider and defaultProviderAccountId, and pushes provider config
  // into openclaw.json). 3. Pin every agent's effective model so the runtime
  // can't fall back to some stale entry sitting first in agents/<id>/agent/models.json.
  const { modelRef } = await applyProviderAccountDefault(picked.accountId, gatewayManager, options, switched);

  logger.info('[channel-router] Applied channel change', {
    channel,
    accountId: picked.accountId,
    modelRef,
    previousDefault,
    gatewayRefreshSuppressed: options?.skipGatewayRefresh === true,
  });

  return {
    channel,
    accountId: picked.accountId,
    modelRef,
    switched,
  };
}

export interface TransientChannelChangeResult {
  channel: ProviderChannel;
  accountId: string;
  modelRef: string;
}

export async function prepareTransientChannelChange(channel: ProviderChannel): Promise<TransientChannelChangeResult> {
  const picked = await pickAccountForChannel(channel);
  if (!picked) {
    throw new Error(
      `No provider account is configured for the "${channel}" channel. ` +
      `Add one in Settings → Models before switching channels.`,
    );
  }

  const { modelRef, channel: resolvedChannel } = await getProviderAccountRuntime(picked.accountId);
  await ensureProviderAccountRuntime(picked.accountId);

  logger.info('[channel-router] Prepared transient channel change', {
    channel: resolvedChannel,
    accountId: picked.accountId,
    modelRef,
  });

  return {
    channel: resolvedChannel,
    accountId: picked.accountId,
    modelRef,
  };
}

/**
 * Read-only coherence probe: returns the channels that the user *could*
 * switch to without configuring a new account. Used by the preflight to
 * decide what to repair to.
 */
export async function listAvailableChannels(): Promise<ProviderChannel[]> {
  const accounts = await listProviderAccounts();
  const seen = new Set<ProviderChannel>();
  for (const a of accounts) {
    seen.add(classifyAccount({ vendorId: a.vendorId, baseUrl: a.baseUrl }));
  }
  return [...seen];
}

/**
 * Read the current channel implied by the default provider account. Returns
 * null when no default is set.
 */
export async function getActiveChannel(): Promise<ProviderChannel | null> {
  const defaultId = await getDefaultProvider();
  if (!defaultId) return null;
  const provider = await getProvider(defaultId);
  if (!provider) return null;
  return classifyAccount({ vendorId: provider.type, baseUrl: provider.baseUrl });
}

export interface ChannelPreflightResult {
  ran: boolean;
  reason: 'no-accounts' | 'desired-unavailable' | 'reconciled' | 'already-coherent';
  desired: ProviderChannel;
  applied?: ProviderChannel;
  modelRef?: string;
  accountId?: string;
  error?: string;
}

/**
 * Launch-time coherence check. Reconciles the four-store divergence that
 * accumulated before `applyChannelChange` existed: pilot installs in the
 * field have `preferredChannel=online` in clawx-settings but
 * `agents.list[main].model.primary` still pointing at ollama.
 *
 * Strategy:
 *   1. Read the renderer-persisted preferredChannel (defaults to 'on-device').
 *   2. If no accounts exist at all, skip — seedDefaultLocalProvider is
 *      expected to populate at least one before the next launch.
 *   3. If the desired channel has no account, fall back to the other channel.
 *   4. Always run `applyChannelChange(target)` so the four stores converge,
 *      regardless of whether they were already coherent. This is cheap (a
 *      handful of file writes under withConfigLock) and ensures legacy
 *      hand-patched configs from earlier sessions are repaired.
 *
 * Failures are logged and returned in the result; the caller should not
 * block app launch on them.
 */
export async function runChannelPreflight(
  desired: ProviderChannel,
  gatewayManager?: GatewayManager,
  options?: ApplyChannelChangeOptions,
): Promise<ChannelPreflightResult> {
  const accounts = await listProviderAccounts();
  if (accounts.length === 0) {
    return { ran: false, reason: 'no-accounts', desired };
  }

  const available = await listAvailableChannels();
  let target: ProviderChannel = desired;
  if (!available.includes(desired)) {
    const fallback = available[0];
    if (!fallback) {
      return { ran: false, reason: 'no-accounts', desired };
    }
    target = fallback;
    logger.warn('[channel-router] Preflight: desired channel unavailable, falling back', {
      desired,
      fallback,
    });
  }

  try {
    const result = await applyChannelChange(target, gatewayManager, options);
    return {
      ran: true,
      reason: target !== desired ? 'desired-unavailable' : (result.switched ? 'reconciled' : 'already-coherent'),
      desired,
      applied: target,
      modelRef: result.modelRef,
      accountId: result.accountId,
    };
  } catch (error) {
    logger.warn('[channel-router] Preflight: applyChannelChange failed', { target, error: String(error) });
    return { ran: false, reason: 'desired-unavailable', desired, applied: target, error: String(error) };
  }
}
