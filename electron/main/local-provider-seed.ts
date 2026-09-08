/**
 * One-shot seed for a local native Ollama LLM provider account.
 *
 * Wires Ollama running `qwen2.5:3b-instruct` at http://127.0.0.1:11434 as a
 * ClawX provider account so that fresh installs (no cloud keys configured)
 * can still get a chat reply out of the box.
 *
 * Behaviour:
 *   - Idempotent: if a provider account already targets the same baseUrl,
 *     this function does nothing. Re-running on a configured machine is
 *     a no-op and never overwrites a real-user-configured provider.
 *   - Cloud-default with local fallback: creates the seeded account only when
 *     the configured local model answers the bounded readiness probe, and marks
 *     it as default ONLY if no other default account exists. If a Sonnet/Opus
 *     (etc.) default is already configured, the seeded Qwen account is added as
 *     a non-default fallback the user can switch to manually.
 *   - Sync to runtime: calls syncSavedProviderToRuntime() so the gateway's
 *     openclaw.json picks up the new provider on next launch/reload.
 *
 * Disable via env: `CLAWX_SEED_LOCAL_LLM_PROVIDER=0` (see shared/feature-flags.ts).
 */
import { logger } from '../utils/logger';
import type { GatewayManager } from '../gateway/manager';
import { SEED_LOCAL_LLM_PROVIDER, TRIM_ONDEVICE_TOOL_CATALOG } from '../../shared/feature-flags';
import { readOpenClawConfig, writeOpenClawConfig } from '../utils/channel-config';
import { applyOnDeviceToolTrim } from '../utils/ondevice-tool-policy';
import type { ProviderAccount } from '../shared/providers/types';
import {
  listProviderAccounts,
  saveProviderAccount,
  setDefaultProviderAccount,
  getDefaultProviderAccountId,
} from '../services/providers/provider-store';
import { storeApiKey } from '../utils/secure-storage';
import {
  getOpenClawProviderKey,
  syncSavedProviderToRuntime,
} from '../services/providers/provider-runtime-sync';
import { providerAccountToConfig } from '../services/providers/provider-store';
import { patchProviderModelCompat } from '../utils/openclaw-auth';
import { proxyAwareFetch } from '../utils/proxy-fetch';

// Local Ollama endpoint and model. Keep these here (not in shared/)
// so the seed remains a single-file concern that's easy to tweak or revert.
//
// Why qwen2.5:3b-instruct: Hermes 3 8B was the May 2026 winner on a 36-prompt
// agentic bake-off, but its 30 GB loaded footprint is unworkable on the
// 16 GB Windows pilot laptop. A focused 12-prompt rerun in May 2026 against
// Qwen 2.5 3B Instruct showed:
//   • Accuracy: tied at 11/12 (91.7%) — tool, domain, grounding, multi-step
//   • Mean latency: 469ms (Qwen) vs 1049ms (Hermes) — 2.2x faster
//   • P95 cold-start: 1285ms (Qwen) vs 3937ms (Hermes) — 3.1x lower
//   • Loaded memory: 4.3 GB (Qwen) vs 30 GB (Hermes) — 7x smaller
//   • Both miss one refusal prompt (different prompts; same search_web bias)
//
// Qwen 2.5 3B Instruct is Alibaba's instruction-tuned 3B model with native
// function calling. License: Apache-2.0 (commercial use allowed).
// Disk: ~1.9 GB. Loaded: ~4.3 GB with 32k context. Leaves ~11 GB headroom on
// the 16 GB principal laptop for Electron + Office + Forms.
//
// Long-term: revisit when Qwen 3.5 / Hermes 4 land. The self-test cron at
// scripts/clawx-selftest.mjs will catch regressions.
const LOCAL_BASE_URL = 'http://127.0.0.1:11434';
const LOCAL_MODEL_ID = 'qwen2.5:3b-instruct';
const LOCAL_CONTEXT_TOKENS = 32_768;
const LOCAL_MODEL_PARAMS = { num_ctx: LOCAL_CONTEXT_TOKENS } as const;
const LOCAL_ACCOUNT_ID = 'ollama-local-qwen2.5-3b-instruct';
const LOCAL_ACCOUNT_LABEL = 'On this device (Qwen 2.5 3B Instruct)';
// Ollama doesn't enforce auth but the secret-store and runtime-sync paths
// expect a non-empty token — use a recognisable placeholder.
const LOCAL_PLACEHOLDER_KEY = 'ollama-local';
const LOCAL_READINESS_TIMEOUT_MS = 1_500;

function normaliseBaseUrl(input: string | undefined | null): string {
  if (!input) return '';
  return input.trim().replace(/\/+$/, '').toLowerCase();
}

function accountTargetsLocalEndpoint(account: ProviderAccount): boolean {
  if (account.vendorId !== 'ollama' && account.vendorId !== 'custom') {
    return false;
  }
  const target = normaliseBaseUrl(account.baseUrl);
  if (!target) return false;
  // Treat 127.0.0.1 and localhost as equivalent for idempotency.
  return (
    target === normaliseBaseUrl(LOCAL_BASE_URL) ||
    target === normaliseBaseUrl(`${LOCAL_BASE_URL}/v1`) ||
    target === normaliseBaseUrl('http://localhost:11434') ||
    target === normaliseBaseUrl('http://localhost:11434/v1')
  );
}

export interface LocalProviderSeedOptions {
  /** Suppress only pre-start boot refreshes; live settings/provider edits still pass the manager. */
  skipGatewayRefresh?: boolean;
}

export type LocalProviderReadinessReason =
  | 'ok'
  | 'connection-error'
  | 'http-error'
  | 'invalid-response'
  | 'model-missing';

export interface LocalProviderReadinessResult {
  ready: boolean;
  reason: LocalProviderReadinessReason;
  status?: number;
}

function normalizeLocalModelId(model: string | undefined | null): string {
  const trimmed = (model ?? '').trim();
  if (!trimmed) return LOCAL_MODEL_ID;
  const slash = trimmed.indexOf('/');
  return slash > 0 ? trimmed.slice(slash + 1).trim() : trimmed;
}

function buildLocalModelsUrl(baseUrl: string | undefined | null): string {
  const normalized = normaliseBaseUrl(baseUrl || LOCAL_BASE_URL);
  if (!normalized) return `${LOCAL_BASE_URL}/api/tags`;
  if (normalized.endsWith('/api/tags') || normalized.endsWith('/models')) return normalized;
  if (normalized.endsWith('/v1')) return `${normalized}/models`;
  return `${normalized}/api/tags`;
}

function responseContainsModel(data: unknown, modelId: string): boolean | null {
  if (!data || typeof data !== 'object') return null;
  const openAiEntries = (data as { data?: unknown }).data;
  if (Array.isArray(openAiEntries)) {
    return openAiEntries.some((entry) => (
      entry && typeof entry === 'object' && (entry as { id?: unknown }).id === modelId
    ));
  }

  const ollamaEntries = (data as { models?: unknown }).models;
  if (Array.isArray(ollamaEntries)) {
    return ollamaEntries.some((entry) => (
      entry && typeof entry === 'object' && (entry as { name?: unknown }).name === modelId
    ));
  }

  return null;
}

export async function probeLocalProviderReadiness(options?: {
  baseUrl?: string | null;
  modelId?: string | null;
  timeoutMs?: number;
}): Promise<LocalProviderReadinessResult> {
  const modelId = normalizeLocalModelId(options?.modelId);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options?.timeoutMs ?? LOCAL_READINESS_TIMEOUT_MS);

  try {
    const response = await proxyAwareFetch(buildLocalModelsUrl(options?.baseUrl), {
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ready: false, reason: 'http-error', status: response.status };
    }

    const data = await response.json().catch(() => null);
    const containsModel = responseContainsModel(data, modelId);
    if (containsModel === true) {
      return { ready: true, reason: 'ok', status: response.status };
    }
    if (containsModel === false) {
      return { ready: false, reason: 'model-missing', status: response.status };
    }
    return { ready: false, reason: 'invalid-response', status: response.status };
  } catch {
    return { ready: false, reason: 'connection-error' };
  } finally {
    clearTimeout(timeout);
  }
}

export async function seedDefaultLocalProvider(
  gatewayManager?: GatewayManager,
  options?: LocalProviderSeedOptions,
): Promise<void> {
  const syncGatewayManager = options?.skipGatewayRefresh === true ? undefined : gatewayManager;
  if (!SEED_LOCAL_LLM_PROVIDER) {
    logger.info('[local-provider-seed] SEED_LOCAL_LLM_PROVIDER disabled — skipping');
    return;
  }

  // Always-run: patch openclaw.json's compat block for Nora so reasoning is
  // extracted and the tool-call hammer is set down. Idempotent — only writes
  // when at least one compat field would actually change. Runs every launch
  // so updates to the patch (new compat keys, etc.) propagate even when the
  // provider account is already seeded.
  try {
    const runtimeProviderKey = getOpenClawProviderKey('ollama', LOCAL_ACCOUNT_ID);
    await patchProviderModelCompat(
      runtimeProviderKey,
      (id) => id === LOCAL_MODEL_ID
        || id.startsWith('qwen2.5:')
        || id.startsWith('qwen3:')
        || id.startsWith('hermes3:')
        || id.startsWith('nora:'),
      {
        // Qwen 2.5 supports tool-calling natively; reasoning_effort is benign
        // (ignored if unrecognised) and harmless to leave on for forward-compat.
        supportsReasoningEffort: true,
        supportsTools: true,
      },
    );
  } catch (err) {
    logger.warn(
      `[local-provider-seed] patchProviderModelCompat (always-run) failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Always-run tool-catalog trim: the on-device model (qwen2.5:3b) tool-cascades
  // when the full built-in catalog is injected. Write a per-provider deny policy
  // so the gateway strips the orchestration/media/web tools for the local
  // provider only — cloud providers keep the full catalog. Idempotent: only
  // writes when the deny entries aren't already present. See
  // electron/utils/ondevice-tool-policy.ts for why the sandbox path can't do this.
  if (TRIM_ONDEVICE_TOOL_CATALOG) {
    try {
      const runtimeProviderKey = getOpenClawProviderKey('ollama', LOCAL_ACCOUNT_ID);
      const config = await readOpenClawConfig();
      const { config: nextConfig, changed } = applyOnDeviceToolTrim(config, runtimeProviderKey);
      if (changed) {
        await writeOpenClawConfig(nextConfig);
        logger.info(
          `[local-provider-seed] Trimmed on-device tool catalog for provider "${runtimeProviderKey}"`,
        );
      }
    } catch (err) {
      logger.warn(
        `[local-provider-seed] on-device tool-catalog trim failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Always-run re-sync: if our canonical account exists, push its current
  // native Ollama contract into openclaw.json on every boot. This catches the
  // case where an earlier ClawX release wrote /v1 + openai-completions or a
  // different model id into the runtime provider entry. Idempotent —
  // syncSavedProviderToRuntime only writes when something actually differs.
  try {
    const accounts = await listProviderAccounts();
    const canonical = accounts.find((a) => a.id === LOCAL_ACCOUNT_ID);
    let accountToSync = canonical;
    const canonicalDrifted = canonical && (
      canonical.model !== LOCAL_MODEL_ID
        || normaliseBaseUrl(canonical.baseUrl) !== normaliseBaseUrl(LOCAL_BASE_URL)
        || canonical.apiProtocol !== 'ollama'
    );
    if (canonicalDrifted) {
      // Drift between the seed code and the stored account: update the
      // account so the migration block below isn't needed in this branch.
      const updated = {
        ...canonical,
        model: LOCAL_MODEL_ID,
        label: LOCAL_ACCOUNT_LABEL,
        baseUrl: LOCAL_BASE_URL,
        apiProtocol: 'ollama' as const,
        updatedAt: new Date().toISOString(),
      };
      await saveProviderAccount(updated);
      accountToSync = updated;
      logger.info(
        `[local-provider-seed] Repaired local account ${LOCAL_ACCOUNT_ID} runtime contract → ${LOCAL_MODEL_ID} (${LOCAL_BASE_URL}, api=ollama, num_ctx=${LOCAL_MODEL_PARAMS.num_ctx})`,
      );
    }
    if (accountToSync) {
      await syncSavedProviderToRuntime(
        providerAccountToConfig(accountToSync),
        LOCAL_PLACEHOLDER_KEY,
        syncGatewayManager,
      );
    }
  } catch (err) {
    logger.warn(
      `[local-provider-seed] always-resync failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  try {
    const existingAccounts = await listProviderAccounts();

    // One-time migration: fold any previous local-Ollama seed into the
    // current default (Qwen 2.5 3B Instruct). Each prior model was either
    // capability-blocked or memory-blocked for the 16 GB pilot laptop:
    //   • Nora 4B: no native tool-calling (Ollama returns HTTP 400 with `tools`)
    //   • Qwen 3 4B: 12-hour hang on one principal-style prompt
    //   • Qwen 3 8B / Hermes 3 8B: 30 GB loaded footprint exceeds 16 GB RAM
    // Migrate in-place so the user keeps their default-flag and existing chat
    // sessions don't break.
    const LEGACY_LOCAL_IDS = new Set([
      'ollama-local-nora',
      'ollama-local-qwen3-4b',
      'ollama-local-qwen3-8b',
      'ollama-local-hermes3-8b',
    ]);
    const LEGACY_LOCAL_MODELS = new Set([
      'nora:4b-v3.2',
      'qwen3:4b',
      'qwen3:8b',
      'hermes3:8b',
    ]);
    const legacyNora = existingAccounts.find((a) =>
      LEGACY_LOCAL_IDS.has(a.id) || (a.model && LEGACY_LOCAL_MODELS.has(a.model)),
    );
    if (legacyNora && !existingAccounts.some((a) => a.id === LOCAL_ACCOUNT_ID)) {
      const now = new Date().toISOString();
      const migrated: ProviderAccount = {
        ...legacyNora,
        id: LOCAL_ACCOUNT_ID,
        label: LOCAL_ACCOUNT_LABEL,
        model: LOCAL_MODEL_ID,
        baseUrl: LOCAL_BASE_URL,
        apiProtocol: 'ollama',
        updatedAt: now,
      };
      await saveProviderAccount(migrated);
      await storeApiKey(migrated.id, LOCAL_PLACEHOLDER_KEY);
      try {
        await syncSavedProviderToRuntime(
          providerAccountToConfig(migrated),
          LOCAL_PLACEHOLDER_KEY,
          syncGatewayManager,
        );
      } catch (err) {
        logger.warn(
          `[local-provider-seed] migration syncSavedProviderToRuntime failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      if (migrated.isDefault) {
        try { await setDefaultProviderAccount(migrated.id); } catch { /* non-fatal */ }
      }
      logger.info(
        `[local-provider-seed] Migrated legacy Nora account to "${LOCAL_ACCOUNT_LABEL}" (${LOCAL_MODEL_ID})`,
      );
      return;
    }

    // Idempotency: if any account already targets the local Ollama endpoint
    // (by vendorId+baseUrl), assume the user/seed has already been here.
    const alreadySeeded = existingAccounts.some(accountTargetsLocalEndpoint);
    if (alreadySeeded) {
      logger.info(
        '[local-provider-seed] Local Ollama account already present — skipping seed',
      );
      return;
    }

    // Cloud-default-with-local-fallback: only become default when there is
    // truly no default yet. listProviderAccounts() may be empty (true fresh
    // install) or populated with real cloud accounts already.
    const existingDefaultId = await getDefaultProviderAccountId();
    const hasAnyDefault = Boolean(existingDefaultId)
      || existingAccounts.some((account) => account.isDefault);
    const shouldBecomeDefault = !hasAnyDefault;

    const readiness = await probeLocalProviderReadiness({
      baseUrl: LOCAL_BASE_URL,
      modelId: LOCAL_MODEL_ID,
    });
    if (!readiness.ready) {
      logger.warn('[local-provider-seed] Local Ollama model is not ready — skipping automatic local seed', {
        reason: readiness.reason,
        status: readiness.status ?? null,
      });
      return;
    }

    const now = new Date().toISOString();
    const account: ProviderAccount = {
      id: LOCAL_ACCOUNT_ID,
      vendorId: 'ollama',
      label: LOCAL_ACCOUNT_LABEL,
      authMode: 'local',
      baseUrl: LOCAL_BASE_URL,
      apiProtocol: 'ollama',
      model: LOCAL_MODEL_ID,
      enabled: true,
      isDefault: shouldBecomeDefault,
      createdAt: now,
      updatedAt: now,
    };

    await saveProviderAccount(account);
    await storeApiKey(account.id, LOCAL_PLACEHOLDER_KEY);

    // Push provider config + key into openclaw.json so the gateway routes
    // chat requests at this account on its next reload.
    try {
      await syncSavedProviderToRuntime(
        providerAccountToConfig(account),
        LOCAL_PLACEHOLDER_KEY,
        syncGatewayManager,
      );
    } catch (err) {
      logger.warn(
        `[local-provider-seed] syncSavedProviderToRuntime failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Patch the model entry in openclaw.json so the gateway flags Qwen 2.5
    // as supporting native tool-calling. Idempotent: re-runs are no-ops once
    // both compat fields are already set.
    try {
      const runtimeProviderKey = getOpenClawProviderKey(account.vendorId, account.id);
      await patchProviderModelCompat(
        runtimeProviderKey,
        (id) => id === LOCAL_MODEL_ID || id.startsWith('qwen2.5:'),
        {
          supportsReasoningEffort: true,
          supportsTools: true,
        },
      );
    } catch (err) {
      logger.warn(
        `[local-provider-seed] patchProviderModelCompat failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (shouldBecomeDefault) {
      try {
        await setDefaultProviderAccount(account.id);
      } catch (err) {
        logger.warn(
          `[local-provider-seed] setDefaultProviderAccount failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    logger.info(
      `[local-provider-seed] Seeded "${LOCAL_ACCOUNT_LABEL}" (${LOCAL_BASE_URL}, api=ollama, model=${LOCAL_MODEL_ID}, num_ctx=${LOCAL_MODEL_PARAMS.num_ctx}, default=${shouldBecomeDefault})`,
    );
  } catch (err) {
    logger.warn(
      `[local-provider-seed] Failed to seed local provider: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
