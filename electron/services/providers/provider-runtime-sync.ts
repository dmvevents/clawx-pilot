import type { GatewayManager } from '../../gateway/manager';
import { getProviderAccount, listProviderAccounts } from './provider-store';
import { getProviderSecret } from '../secrets/secret-store';
import type { ProviderConfig } from '../../utils/secure-storage';
import { getAllProviders, getApiKey, getDefaultProvider, getProvider } from '../../utils/secure-storage';
import { getProviderConfig, getProviderDefaultModel } from '../../utils/provider-registry';
import {
  removeProviderFromOpenClaw,
  removeProviderKeyFromOpenClaw,
  saveOAuthTokenToOpenClaw,
  saveProviderKeyToOpenClaw,
  setOpenClawDefaultModel,
  setOpenClawDefaultModelWithOverride,
  syncProviderConfigToOpenClaw,
  updateAgentModelProvider,
  updateSingleAgentModelProvider,
} from '../../utils/openclaw-auth';
import {
  type PiAiModelInputCapability,
  type PiAiModelsJsonModelEntry,
  piAiModelsJsonModelEntry,
} from '../../shared/pi-ai-model-cost';
import { logger } from '../../utils/logger';
import { listAgentsSnapshot } from '../../utils/agent-config';

const GOOGLE_OAUTH_RUNTIME_PROVIDER = 'google-gemini-cli';
const GOOGLE_OAUTH_DEFAULT_MODEL_REF = `${GOOGLE_OAUTH_RUNTIME_PROVIDER}/gemini-3-pro-preview`;
const OPENAI_OAUTH_RUNTIME_PROVIDER = 'openai-codex';
const OPENAI_OAUTH_DEFAULT_MODEL_REF = `${OPENAI_OAUTH_RUNTIME_PROVIDER}/gpt-5.4`;
const MANAGED_CLOUD_GATEWAY_RUNTIME_PROVIDER = 'custom-moecloud';
const MANAGED_CLOUD_GATEWAY_PROVIDER_IDS = new Set(['moe-cloud-gateway', MANAGED_CLOUD_GATEWAY_RUNTIME_PROVIDER]);
const MANAGED_CLOUD_GATEWAY_VISION_MODELS = new Set(['moe-demo-pro', 'moe-demo']);
const TEXT_AND_IMAGE_INPUT: PiAiModelInputCapability[] = ['text', 'image'];

/**
 * Provider types that are not in the built-in provider registry (no `providerConfig.api`).
 * They require explicit api-protocol defaulting to `openai-completions`.
 */
function isUnregisteredProviderType(type: string): boolean {
  return type === 'custom' || type === 'ollama';
}

type RuntimeProviderSyncContext = {
  runtimeProviderKey: string;
  meta: ReturnType<typeof getProviderConfig>;
  api: string;
};

function normalizeProviderBaseUrl(
  config: ProviderConfig,
  baseUrl?: string,
  apiProtocol?: string,
): string | undefined {
  if (!baseUrl) {
    return undefined;
  }

  const normalized = baseUrl.trim().replace(/\/+$/, '');

  if (config.type === 'minimax-portal' || config.type === 'minimax-portal-cn') {
    return normalized.replace(/\/v1$/, '').replace(/\/anthropic$/, '').replace(/\/$/, '') + '/anthropic';
  }

  if (isUnregisteredProviderType(config.type)) {
    const protocol = apiProtocol || config.apiProtocol || 'openai-completions';
    if (protocol === 'openai-responses') {
      return normalized.replace(/\/responses?$/i, '');
    }
    if (protocol === 'openai-completions') {
      return normalized.replace(/\/chat\/completions$/i, '');
    }
    if (protocol === 'anthropic-messages') {
      return normalized.replace(/\/v1\/messages$/i, '').replace(/\/messages$/i, '');
    }
  }

  return normalized;
}

function shouldUseExplicitDefaultOverride(
  config: ProviderConfig,
  runtimeProviderKey: string,
  meta: ReturnType<typeof getProviderConfig>,
): boolean {
  if (config.baseUrl || runtimeProviderKey !== config.type) {
    return true;
  }

  // Some field installs have legacy apiProtocol values on built-in providers
  // such as Google. If there is no explicit provider metadata/baseUrl to write,
  // use the built-in provider path so setOpenClawDefaultModel can remove any
  // stale models.providers.<id> entry instead of preserving a bad override.
  return Boolean(config.apiProtocol && meta?.baseUrl);
}

export function getOpenClawProviderKey(type: string, providerId: string): string {
  if (isUnregisteredProviderType(type)) {
    // If the providerId is already a runtime key (e.g. re-seeded from openclaw.json
    // as "custom-XXXXXXXX"), return it directly to avoid double-hashing.
    const prefix = `${type}-`;
    if (providerId.startsWith(prefix)) {
      const tail = providerId.slice(prefix.length);
      if (tail.length === 8 && !tail.includes('-')) {
        return providerId;
      }
    }
    const suffix = providerId.replace(/-/g, '').slice(0, 8);
    return `${type}-${suffix}`;
  }
  if (type === 'minimax-portal-cn') {
    return 'minimax-portal';
  }
  return type;
}

async function resolveRuntimeProviderKey(config: ProviderConfig): Promise<string> {
  const account = await getProviderAccount(config.id);
  if (account?.authMode === 'oauth_browser') {
    if (config.type === 'google') {
      return GOOGLE_OAUTH_RUNTIME_PROVIDER;
    }
    if (config.type === 'openai') {
      return OPENAI_OAUTH_RUNTIME_PROVIDER;
    }
  }
  return getOpenClawProviderKey(config.type, config.id);
}

async function getBrowserOAuthRuntimeProvider(config: ProviderConfig): Promise<string | null> {
  const account = await getProviderAccount(config.id);
  if (account?.authMode !== 'oauth_browser') {
    return null;
  }

  const secret = await getProviderSecret(config.id);
  if (secret?.type !== 'oauth') {
    return null;
  }

  if (config.type === 'google') {
    return GOOGLE_OAUTH_RUNTIME_PROVIDER;
  }
  if (config.type === 'openai') {
    return OPENAI_OAUTH_RUNTIME_PROVIDER;
  }
  return null;
}

export function getProviderModelRef(config: ProviderConfig): string | undefined {
  const providerKey = getOpenClawProviderKey(config.type, config.id);

  if (config.model) {
    return config.model.startsWith(`${providerKey}/`)
      ? config.model
      : `${providerKey}/${config.model}`;
  }

  const defaultModel = getProviderDefaultModel(config.type);
  if (!defaultModel) {
    return undefined;
  }

  return defaultModel.startsWith(`${providerKey}/`)
    ? defaultModel
    : `${providerKey}/${defaultModel}`;
}

export async function getProviderFallbackModelRefs(config: ProviderConfig): Promise<string[]> {
  const allProviders = await getAllProviders();
  const providerMap = new Map(allProviders.map((provider) => [provider.id, provider]));
  const seen = new Set<string>();
  const results: string[] = [];
  const providerKey = getOpenClawProviderKey(config.type, config.id);

  for (const fallbackModel of config.fallbackModels ?? []) {
    const normalizedModel = fallbackModel.trim();
    if (!normalizedModel) continue;

    const modelRef = normalizedModel.startsWith(`${providerKey}/`)
      ? normalizedModel
      : `${providerKey}/${normalizedModel}`;

    if (seen.has(modelRef)) continue;
    seen.add(modelRef);
    results.push(modelRef);
  }

  for (const fallbackId of config.fallbackProviderIds ?? []) {
    if (!fallbackId || fallbackId === config.id) continue;

    const fallbackProvider = providerMap.get(fallbackId);
    if (!fallbackProvider) continue;

    const modelRef = getProviderModelRef(fallbackProvider);
    if (!modelRef || seen.has(modelRef)) continue;

    seen.add(modelRef);
    results.push(modelRef);
  }

  return results;
}

type GatewayRefreshMode = 'reload' | 'restart';

function scheduleGatewayRefresh(
  gatewayManager: GatewayManager | undefined,
  message: string,
  options?: { delayMs?: number; onlyIfRunning?: boolean; mode?: GatewayRefreshMode },
): void {
  if (!gatewayManager) {
    return;
  }

  if (options?.onlyIfRunning && gatewayManager.getStatus().state === 'stopped') {
    return;
  }

  logger.info(message);
  if (options?.mode === 'restart') {
    gatewayManager.debouncedRestart(options?.delayMs);
    return;
  }
  gatewayManager.debouncedReload(options?.delayMs);
}

export async function syncProviderApiKeyToRuntime(
  providerType: string,
  providerId: string,
  apiKey: string,
): Promise<void> {
  const ock = getOpenClawProviderKey(providerType, providerId);
  await saveProviderKeyToOpenClaw(ock, apiKey);
}

export async function syncAllProviderAuthToRuntime(): Promise<void> {
  const accounts = await listProviderAccounts();

  for (const account of accounts) {
    const runtimeProviderKey = await resolveRuntimeProviderKey({
      id: account.id,
      name: account.label,
      type: account.vendorId,
      baseUrl: account.baseUrl,
      model: account.model,
      fallbackModels: account.fallbackModels,
      fallbackProviderIds: account.fallbackAccountIds,
      enabled: account.enabled,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
    });

    const secret = await getProviderSecret(account.id);
    if (!secret) {
      continue;
    }

    if (secret.type === 'api_key') {
      await saveProviderKeyToOpenClaw(runtimeProviderKey, secret.apiKey);
      continue;
    }

    if (secret.type === 'local' && secret.apiKey) {
      await saveProviderKeyToOpenClaw(runtimeProviderKey, secret.apiKey);
      continue;
    }

    if (secret.type === 'oauth') {
      await saveOAuthTokenToOpenClaw(runtimeProviderKey, {
        access: secret.accessToken,
        refresh: secret.refreshToken,
        expires: secret.expiresAt,
        email: secret.email,
        projectId: secret.subject,
      });
    }
  }
}

async function syncProviderSecretToRuntime(
  config: ProviderConfig,
  runtimeProviderKey: string,
  apiKey: string | undefined,
): Promise<void> {
  const secret = await getProviderSecret(config.id);
  if (apiKey !== undefined) {
    const trimmedKey = apiKey.trim();
    if (trimmedKey) {
      await saveProviderKeyToOpenClaw(runtimeProviderKey, trimmedKey);
    } else {
      // An explicit empty string means the caller wants to clear the key.
      // Mirror that intent into OpenClaw auth-profiles so the gateway no
      // longer authenticates with the stale value (matches the explicit
      // delete branch in the legacy /api/providers/:id PUT handler).
      await removeProviderKeyFromOpenClaw(runtimeProviderKey);
    }
    return;
  }

  if (secret?.type === 'api_key') {
    await saveProviderKeyToOpenClaw(runtimeProviderKey, secret.apiKey);
    return;
  }

  if (secret?.type === 'oauth') {
    await saveOAuthTokenToOpenClaw(runtimeProviderKey, {
      access: secret.accessToken,
      refresh: secret.refreshToken,
      expires: secret.expiresAt,
      email: secret.email,
      projectId: secret.subject,
    });
    return;
  }

  if (secret?.type === 'local' && secret.apiKey) {
    await saveProviderKeyToOpenClaw(runtimeProviderKey, secret.apiKey);
  }
}

/**
 * ClawX's `apiProtocol` field doubles as both an HTTP-auth identifier
 * ('google-query-key', 'anthropic-header', etc.) AND, sometimes, an
 * actual openclaw runtime protocol ('openai-completions'). The gateway
 * only accepts a fixed enum on `models.providers.<id>.api`:
 *   openai-completions, openai-responses, openai-codex-responses,
 *   anthropic-messages, google-generative-ai, github-copilot,
 *   bedrock-converse-stream, ollama, azure-openai-responses
 *
 * Pre-fix, ClawX would write the auth-side string verbatim into the
 * runtime-side field, causing OpenClaw doctor to reject the config and
 * crash-loop the gateway. Map auth identifiers to their corresponding
 * runtime protocols so the two schemas stay in sync.
 */
function normalizeRuntimeApi(apiProtocol: string | undefined, fallback: string | undefined): string | undefined {
  if (!apiProtocol) return fallback;
  switch (apiProtocol) {
    // Auth-side identifiers — pick the matching runtime protocol.
    case 'google-query-key':
      // ClawX uses Google's OpenAI-compatible /v1beta/openai endpoint by default.
      return 'openai-completions';
    case 'anthropic-header':
      return 'anthropic-messages';
    case 'openrouter':
    case 'openai-bearer':
      return 'openai-completions';
    case 'none':
      // Local-only providers like Ollama.
      return 'ollama';
    // Already a valid runtime protocol — pass through.
    case 'openai-completions':
    case 'openai-responses':
    case 'openai-codex-responses':
    case 'anthropic-messages':
    case 'google-generative-ai':
    case 'github-copilot':
    case 'bedrock-converse-stream':
    case 'ollama':
    case 'azure-openai-responses':
      return apiProtocol;
    default:
      return fallback ?? 'openai-completions';
  }
}

function shouldUseBearerAuthHeader(config: ProviderConfig, api: string | undefined): boolean {
  if (config.type !== 'custom') {
    return false;
  }
  return api === 'openai-completions' || api === 'openai-responses';
}

function shouldStampManagedCloudGatewayVision(
  config: ProviderConfig,
  runtimeProviderKey: string,
  modelId: string,
): boolean {
  return config.type === 'custom'
    && MANAGED_CLOUD_GATEWAY_PROVIDER_IDS.has(config.id)
    && runtimeProviderKey === MANAGED_CLOUD_GATEWAY_RUNTIME_PROVIDER
    && MANAGED_CLOUD_GATEWAY_VISION_MODELS.has(modelId);
}

function runtimeModelEntryForProvider(
  config: ProviderConfig,
  runtimeProviderKey: string,
  modelId: string,
): PiAiModelsJsonModelEntry {
  if (shouldStampManagedCloudGatewayVision(config, runtimeProviderKey, modelId)) {
    return piAiModelsJsonModelEntry(modelId, modelId, { input: TEXT_AND_IMAGE_INPUT });
  }
  return piAiModelsJsonModelEntry(modelId);
}

function runtimeModelIdForProvider(runtimeProviderKey: string, modelId: string | undefined): string | undefined {
  const trimmed = modelId?.trim();
  if (!trimmed) return undefined;
  const prefix = `${runtimeProviderKey}/`;
  return trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : trimmed;
}

function runtimeModelRefForProvider(runtimeProviderKey: string, modelId: string | undefined): string | undefined {
  const stripped = runtimeModelIdForProvider(runtimeProviderKey, modelId);
  return stripped ? `${runtimeProviderKey}/${stripped}` : undefined;
}

function runtimeModelIdsForProvider(config: ProviderConfig, runtimeProviderKey: string): string[] {
  return [config.model, ...(config.fallbackModels ?? [])]
    .map((modelId) => runtimeModelIdForProvider(runtimeProviderKey, modelId))
    .filter((modelId): modelId is string => Boolean(modelId));
}

function runtimeModelEntriesForProvider(
  config: ProviderConfig,
  runtimeProviderKey: string,
): PiAiModelsJsonModelEntry[] {
  return runtimeModelIdsForProvider(config, runtimeProviderKey)
    .map((modelId) => runtimeModelEntryForProvider(config, runtimeProviderKey, modelId));
}

function managedRuntimeModelEntriesForProvider(
  config: ProviderConfig,
  runtimeProviderKey: string,
): PiAiModelsJsonModelEntry[] | undefined {
  if (
    config.type !== 'custom'
    || !MANAGED_CLOUD_GATEWAY_PROVIDER_IDS.has(config.id)
    || runtimeProviderKey !== MANAGED_CLOUD_GATEWAY_RUNTIME_PROVIDER
  ) {
    return undefined;
  }
  return runtimeModelEntriesForProvider(config, runtimeProviderKey);
}

async function resolveRuntimeSyncContext(config: ProviderConfig): Promise<RuntimeProviderSyncContext | null> {
  const runtimeProviderKey = await resolveRuntimeProviderKey(config);
  const meta = getProviderConfig(config.type);
  const fallbackApi = isUnregisteredProviderType(config.type) ? 'openai-completions' : meta?.api;
  const api = normalizeRuntimeApi(config.apiProtocol, fallbackApi);
  if (!api) {
    return null;
  }

  return {
    runtimeProviderKey,
    meta,
    api,
  };
}

async function syncRuntimeProviderConfig(
  config: ProviderConfig,
  context: RuntimeProviderSyncContext,
): Promise<void> {
  const modelIds = runtimeModelIdsForProvider(config, context.runtimeProviderKey);
  await syncProviderConfigToOpenClaw(context.runtimeProviderKey, modelIds[0], {
    baseUrl: normalizeProviderBaseUrl(config, config.baseUrl || context.meta?.baseUrl, context.api),
    api: context.api,
    apiKeyEnv: context.meta?.apiKeyEnv,
    headers: config.headers ?? context.meta?.headers,
    authHeader: shouldUseBearerAuthHeader(config, context.api),
    models: managedRuntimeModelEntriesForProvider(config, context.runtimeProviderKey),
  });
}

async function syncCustomProviderAgentModel(
  config: ProviderConfig,
  runtimeProviderKey: string,
  apiKey: string | undefined,
): Promise<void> {
  if (!isUnregisteredProviderType(config.type)) {
    return;
  }

  const resolvedKey = apiKey !== undefined ? (apiKey.trim() || null) : await getApiKey(config.id);
  if (!resolvedKey || !config.baseUrl) {
    return;
  }

  const modelIds = runtimeModelIdsForProvider(config, runtimeProviderKey);
  const api = normalizeRuntimeApi(config.apiProtocol, 'openai-completions') ?? 'openai-completions';
  await updateAgentModelProvider(runtimeProviderKey, {
    baseUrl: normalizeProviderBaseUrl(config, config.baseUrl, api),
    api,
    models: modelIds.map((modelId) => runtimeModelEntryForProvider(config, runtimeProviderKey, modelId)),
    apiKey: resolvedKey,
    authHeader: shouldUseBearerAuthHeader(config, api),
  });
}

async function syncProviderToRuntime(
  config: ProviderConfig,
  apiKey: string | undefined,
): Promise<RuntimeProviderSyncContext | null> {
  const context = await resolveRuntimeSyncContext(config);
  if (!context) {
    return null;
  }

  await syncProviderSecretToRuntime(config, context.runtimeProviderKey, apiKey);
  await syncRuntimeProviderConfig(config, context);
  await syncCustomProviderAgentModel(config, context.runtimeProviderKey, apiKey);
  return context;
}

async function removeDeletedProviderFromOpenClaw(
  provider: ProviderConfig,
  providerId: string,
  runtimeProviderKey?: string,
): Promise<void> {
  const keys = new Set<string>();
  if (runtimeProviderKey) {
    keys.add(runtimeProviderKey);
  } else {
    keys.add(await resolveRuntimeProviderKey({ ...provider, id: providerId }));
  }
  keys.add(providerId);

  for (const key of keys) {
    await removeProviderFromOpenClaw(key);
  }
}

function parseModelRef(modelRef: string): { providerKey: string; modelId: string } | null {
  const trimmed = modelRef.trim();
  const separatorIndex = trimmed.indexOf('/');
  if (separatorIndex <= 0 || separatorIndex >= trimmed.length - 1) {
    return null;
  }

  return {
    providerKey: trimmed.slice(0, separatorIndex),
    modelId: trimmed.slice(separatorIndex + 1),
  };
}

async function buildRuntimeProviderConfigMap(): Promise<Map<string, ProviderConfig>> {
  const configs = await getAllProviders();
  const runtimeMap = new Map<string, ProviderConfig>();

  for (const config of configs) {
    const runtimeKey = await resolveRuntimeProviderKey(config);
    runtimeMap.set(runtimeKey, config);
  }

  return runtimeMap;
}

async function buildAgentModelProviderEntry(
  config: ProviderConfig,
  runtimeProviderKey: string,
  modelId: string,
): Promise<{
  baseUrl?: string;
  api?: string;
  models?: PiAiModelsJsonModelEntry[];
  apiKey?: string;
  authHeader?: boolean;
} | null> {
  const meta = getProviderConfig(config.type);
  const api = config.apiProtocol || (isUnregisteredProviderType(config.type) ? 'openai-completions' : meta?.api);
  const baseUrl = normalizeProviderBaseUrl(config, config.baseUrl || meta?.baseUrl, api);
  if (!api || !baseUrl) {
    return null;
  }

  let apiKey: string | undefined;
  let authHeader: boolean | undefined;

  if (isUnregisteredProviderType(config.type)) {
    apiKey = (await getApiKey(config.id)) || undefined;
    authHeader = shouldUseBearerAuthHeader(config, api);
  } else if (config.type === 'minimax-portal' || config.type === 'minimax-portal-cn') {
    const accountApiKey = await getApiKey(config.id);
    if (accountApiKey) {
      apiKey = accountApiKey;
    } else {
      authHeader = true;
      apiKey = 'minimax-oauth';
    }
  }

  return {
    baseUrl,
    api,
    models: [runtimeModelEntryForProvider(config, runtimeProviderKey, modelId)],
    apiKey,
    authHeader,
  };
}

async function syncAgentModelsToRuntime(agentIds?: Set<string>): Promise<void> {
  const snapshot = await listAgentsSnapshot();
  const runtimeProviderConfigs = await buildRuntimeProviderConfigMap();

  const targets = snapshot.agents.filter((agent) => {
    if (!agent.modelRef) return false;
    if (!agentIds) return true;
    return agentIds.has(agent.id);
  });

  for (const agent of targets) {
    const parsed = parseModelRef(agent.modelRef || '');
    if (!parsed) {
      continue;
    }

    const providerConfig = runtimeProviderConfigs.get(parsed.providerKey);
    if (!providerConfig) {
      logger.warn(
        `[provider-runtime] No provider account mapped to runtime key "${parsed.providerKey}" for agent "${agent.id}"`,
      );
      continue;
    }

    const entry = await buildAgentModelProviderEntry(providerConfig, parsed.providerKey, parsed.modelId);
    if (!entry) {
      continue;
    }

    await updateSingleAgentModelProvider(agent.id, parsed.providerKey, entry);
  }
}

export async function syncAgentModelOverrideToRuntime(agentId: string): Promise<void> {
  await syncAgentModelsToRuntime(new Set([agentId]));
}

export async function syncSavedProviderToRuntime(
  config: ProviderConfig,
  apiKey: string | undefined,
  gatewayManager?: GatewayManager,
): Promise<void> {
  const context = await syncProviderToRuntime(config, apiKey);
  if (!context) {
    return;
  }

  try {
    await syncAgentModelsToRuntime();
  } catch (err) {
    logger.warn('[provider-runtime] Failed to sync per-agent model registries after provider save:', err);
  }

  scheduleGatewayRefresh(
    gatewayManager,
    `Scheduling Gateway reload after saving provider "${context.runtimeProviderKey}" config`,
  );
}

export async function syncUpdatedProviderToRuntime(
  config: ProviderConfig,
  apiKey: string | undefined,
  gatewayManager?: GatewayManager,
): Promise<void> {
  const context = await syncProviderToRuntime(config, apiKey);
  if (!context) {
    return;
  }

  const ock = context.runtimeProviderKey;
  const fallbackModels = await getProviderFallbackModelRefs(config);

  const defaultProviderId = await getDefaultProvider();
  if (defaultProviderId === config.id) {
    const modelOverride = runtimeModelRefForProvider(ock, config.model);
    if (!isUnregisteredProviderType(config.type)) {
      if (shouldUseExplicitDefaultOverride(config, ock, context.meta)) {
        await setOpenClawDefaultModelWithOverride(ock, modelOverride, {
          baseUrl: normalizeProviderBaseUrl(config, config.baseUrl || context.meta?.baseUrl, context.api),
          api: context.api,
          apiKeyEnv: context.meta?.apiKeyEnv,
          headers: config.headers ?? context.meta?.headers,
        }, fallbackModels);
      } else {
        if (config.apiProtocol) {
          logger.info('[provider-runtime] Using built-in provider default path; ignoring legacy apiProtocol-only override', {
            providerId: config.id,
            providerType: config.type,
            runtimeProviderKey: ock,
            apiProtocol: config.apiProtocol,
            modelRef: modelOverride,
          });
        }
        await setOpenClawDefaultModel(ock, modelOverride, fallbackModels);
      }
    } else {
      const normalizedApi = normalizeRuntimeApi(config.apiProtocol, 'openai-completions') ?? 'openai-completions';
      await setOpenClawDefaultModelWithOverride(ock, modelOverride, {
        baseUrl: normalizeProviderBaseUrl(config, config.baseUrl, normalizedApi),
        api: normalizedApi,
        headers: config.headers,
        authHeader: shouldUseBearerAuthHeader(config, normalizedApi),
        models: managedRuntimeModelEntriesForProvider(config, ock),
      }, fallbackModels);
    }
  }

  try {
    await syncAgentModelsToRuntime();
  } catch (err) {
    logger.warn('[provider-runtime] Failed to sync per-agent model registries after provider update:', err);
  }

  scheduleGatewayRefresh(
    gatewayManager,
    `Scheduling Gateway reload after updating provider "${ock}" config`,
  );
}

export async function syncDeletedProviderToRuntime(
  provider: ProviderConfig | null,
  providerId: string,
  gatewayManager?: GatewayManager,
  runtimeProviderKey?: string,
): Promise<void> {
  if (!provider?.type) {
    return;
  }

  const ock = runtimeProviderKey ?? await resolveRuntimeProviderKey({ ...provider, id: providerId });
  await removeDeletedProviderFromOpenClaw(provider, providerId, ock);

  scheduleGatewayRefresh(
    gatewayManager,
    `Scheduling Gateway restart after deleting provider "${ock}"`,
    { mode: 'restart' },
  );
}

export async function syncDeletedProviderApiKeyToRuntime(
  provider: ProviderConfig | null,
  providerId: string,
  runtimeProviderKey?: string,
): Promise<void> {
  if (!provider?.type) {
    return;
  }

  const ock = runtimeProviderKey ?? await resolveRuntimeProviderKey({ ...provider, id: providerId });
  await removeProviderKeyFromOpenClaw(ock);
}

export async function ensureProviderAccountRuntime(providerId: string): Promise<void> {
  const provider = await getProvider(providerId);
  if (!provider) {
    throw new Error(`Provider account "${providerId}" disappeared mid-transaction`);
  }
  await syncProviderToRuntime(provider, undefined);
}

export async function syncDefaultProviderToRuntime(
  providerId: string,
  gatewayManager?: GatewayManager,
  options?: { skipGatewayRefresh?: boolean },
): Promise<void> {
  const provider = await getProvider(providerId);
  if (!provider) {
    return;
  }

  // Per-run send-time degrade (docs/OFFLINE_ARCHITECTURE.md §3.1, CLWX-95/96):
  // the caller writes the on-device channel into the four stores and then
  // immediately resends the failed turn. Scheduling a gateway reload/restart
  // here races that resend — on Windows `debouncedReload` falls through to a
  // full `restart` (manager.ts) which tears the runtime down under the in-
  // flight send, so the turn dies with no terminal event and the composer
  // spins. When `skipGatewayRefresh` is set the config write still lands
  // (four-store coherence is preserved via the canonical writers below), but
  // the runtime is left to pick up the new default on its next run rather than
  // being bounced mid-resend. Default is unchanged (a refresh is scheduled),
  // so existing callers keep their behaviour.
  const skipRefresh = options?.skipGatewayRefresh === true;

  const ock = await resolveRuntimeProviderKey(provider);
  const providerKey = await getApiKey(providerId);
  const fallbackModels = await getProviderFallbackModelRefs(provider);
  const oauthTypes = ['minimax-portal', 'minimax-portal-cn'];
  const browserOAuthRuntimeProvider = await getBrowserOAuthRuntimeProvider(provider);
  const isOAuthProvider = (oauthTypes.includes(provider.type) && !providerKey) || Boolean(browserOAuthRuntimeProvider);

  if (!isOAuthProvider) {
    const modelOverride = runtimeModelRefForProvider(ock, provider.model);

    if (isUnregisteredProviderType(provider.type)) {
      const normalizedApi = normalizeRuntimeApi(provider.apiProtocol, 'openai-completions') ?? 'openai-completions';
      await setOpenClawDefaultModelWithOverride(ock, modelOverride, {
        baseUrl: normalizeProviderBaseUrl(provider, provider.baseUrl, normalizedApi),
        api: normalizedApi,
        headers: provider.headers,
        authHeader: shouldUseBearerAuthHeader(provider, normalizedApi),
        models: managedRuntimeModelEntriesForProvider(provider, ock),
      }, fallbackModels);
    } else {
      const meta = getProviderConfig(provider.type);
      if (shouldUseExplicitDefaultOverride(provider, ock, meta)) {
        // Same auth-protocol -> runtime-protocol normalization as
        // resolveRuntimeSyncContext (the reason: provider.apiProtocol may
        // be google-query-key / anthropic-header / etc which the gateway
        // enum doesn't accept). Without this, the gateway crash-loops on
        // boot for Google/Anthropic-keyed default providers.
        const normalizedApi = normalizeRuntimeApi(provider.apiProtocol, meta?.api) ?? 'openai-completions';
        await setOpenClawDefaultModelWithOverride(ock, modelOverride, {
          baseUrl: normalizeProviderBaseUrl(
            provider,
            provider.baseUrl || meta?.baseUrl,
            normalizedApi,
          ),
          api: normalizedApi,
          apiKeyEnv: meta?.apiKeyEnv,
          headers: provider.headers ?? meta?.headers,
        }, fallbackModels);
      } else {
        if (provider.apiProtocol) {
          logger.info('[provider-runtime] Using built-in provider default path; ignoring legacy apiProtocol-only override', {
            providerId: provider.id,
            providerType: provider.type,
            runtimeProviderKey: ock,
            apiProtocol: provider.apiProtocol,
            modelRef: modelOverride,
          });
        }
        await setOpenClawDefaultModel(ock, modelOverride, fallbackModels);
      }
    }

    if (providerKey) {
      await saveProviderKeyToOpenClaw(ock, providerKey);
    }
  } else {
    if (browserOAuthRuntimeProvider) {
      const secret = await getProviderSecret(provider.id);
      if (secret?.type === 'oauth') {
        await saveOAuthTokenToOpenClaw(browserOAuthRuntimeProvider, {
          access: secret.accessToken,
          refresh: secret.refreshToken,
          expires: secret.expiresAt,
          email: secret.email,
          projectId: secret.subject,
        });
      }

      const defaultModelRef = browserOAuthRuntimeProvider === GOOGLE_OAUTH_RUNTIME_PROVIDER
        ? GOOGLE_OAUTH_DEFAULT_MODEL_REF
        : OPENAI_OAUTH_DEFAULT_MODEL_REF;
      const modelOverride = provider.model
        ? (provider.model.startsWith(`${browserOAuthRuntimeProvider}/`)
          ? provider.model
          : `${browserOAuthRuntimeProvider}/${provider.model}`)
        : defaultModelRef;

      await setOpenClawDefaultModel(browserOAuthRuntimeProvider, modelOverride, fallbackModels);
      logger.info(`Configured openclaw.json for browser OAuth provider "${provider.id}"`);
      try {
        await syncAgentModelsToRuntime();
      } catch (err) {
        logger.warn('[provider-runtime] Failed to sync per-agent model registries after browser OAuth switch:', err);
      }
      if (!skipRefresh) {
        scheduleGatewayRefresh(
          gatewayManager,
          `Scheduling Gateway reload after provider switch to "${browserOAuthRuntimeProvider}"`,
        );
      }
      return;
    }

    const defaultBaseUrl = provider.type === 'minimax-portal'
      ? 'https://api.minimax.io/anthropic'
      : 'https://api.minimaxi.com/anthropic';
    const api = 'anthropic-messages' as const;

    let baseUrl = provider.baseUrl || defaultBaseUrl;
    if (baseUrl) {
      baseUrl = baseUrl.replace(/\/v1$/, '').replace(/\/anthropic$/, '').replace(/\/$/, '') + '/anthropic';
    }

    const targetProviderKey = 'minimax-portal';

    await setOpenClawDefaultModelWithOverride(targetProviderKey, getProviderModelRef(provider), {
      baseUrl,
      api,
      authHeader: targetProviderKey === 'minimax-portal' ? true : undefined,
      apiKeyEnv: targetProviderKey === 'minimax-portal' ? 'minimax-oauth' : 'qwen-oauth',
    }, fallbackModels);

    logger.info(`Configured openclaw.json for OAuth provider "${provider.type}"`);

    try {
      const defaultModelId = provider.model?.split('/').pop();
      await updateAgentModelProvider(targetProviderKey, {
        baseUrl,
        api,
        authHeader: targetProviderKey === 'minimax-portal' ? true : undefined,
        apiKey: targetProviderKey === 'minimax-portal' ? 'minimax-oauth' : 'qwen-oauth',
        models: defaultModelId ? [piAiModelsJsonModelEntry(defaultModelId)] : [],
      });
    } catch (err) {
      logger.warn(`Failed to update models.json for OAuth provider "${targetProviderKey}":`, err);
    }
  }

  if (
    isUnregisteredProviderType(provider.type) &&
    providerKey &&
    provider.baseUrl
  ) {
    const modelId = runtimeModelIdForProvider(ock, provider.model);
    await updateAgentModelProvider(ock, {
      baseUrl: normalizeProviderBaseUrl(provider, provider.baseUrl, provider.apiProtocol || 'openai-completions'),
      api: provider.apiProtocol || 'openai-completions',
      models: modelId ? [runtimeModelEntryForProvider(provider, ock, modelId)] : [],
      apiKey: providerKey,
    });
  }

  try {
    await syncAgentModelsToRuntime();
  } catch (err) {
    logger.warn('[provider-runtime] Failed to sync per-agent model registries after default provider switch:', err);
  }

  if (!skipRefresh) {
    scheduleGatewayRefresh(
      gatewayManager,
      `Scheduling Gateway reload after provider switch to "${ock}"`,
      { onlyIfRunning: true },
    );
  }
}
