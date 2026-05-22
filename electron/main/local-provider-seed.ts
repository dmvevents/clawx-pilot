/**
 * One-shot seed for a local OpenAI-compatible LLM provider account.
 *
 * Wires Ollama running `nora:4b-v3.2` at http://127.0.0.1:11434/v1 as a
 * ClawX provider account so that fresh installs (no cloud keys configured)
 * can still get a chat reply out of the box.
 *
 * Behaviour:
 *   - Idempotent: if a provider account already targets the same baseUrl,
 *     this function does nothing. Re-running on a configured machine is
 *     a no-op and never overwrites a real-user-configured provider.
 *   - Cloud-default with local fallback: marks the seeded account as the
 *     default ONLY if no other default account exists. If a Sonnet/Opus
 *     (etc.) default is already configured, the seeded Nora account is
 *     added as a non-default fallback the user can switch to manually.
 *   - Sync to runtime: calls syncSavedProviderToRuntime() so the gateway's
 *     openclaw.json picks up the new provider on next launch/reload.
 *
 * Disable via env: `CLAWX_SEED_LOCAL_LLM_PROVIDER=0` (see shared/feature-flags.ts).
 */
import { logger } from '../utils/logger';
import type { GatewayManager } from '../gateway/manager';
import { SEED_LOCAL_LLM_PROVIDER } from '../../shared/feature-flags';
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

// Local Ollama endpoint and model. Keep these here (not in shared/)
// so the seed remains a single-file concern that's easy to tweak or revert.
//
// Why hermes3:8b: 36-prompt agentic bake-off across qwen3:4b/8b, llama3.1:8b,
// granite3.2:8b, hermes3:8b on tool accuracy, argument grounding, refusal,
// multi-turn, hang resistance, long context, and Trinidad & Tobago primary-
// school domain prompts. Real scoreboard:
//   • hermes3:8b   27/36 (75.0%), 1.5s avg   ← winner
//   • qwen3:8b     24/36 (66.7%), 26.6s avg, 6 timeouts
//   • granite3.2:8b 11/36 (30.6%), 1.5s avg — refuses to call tools
//   • llama3.1:8b   ~80% on light bench but overeager (false-positive tool
//                   calls for chitchat); regressed on full suite (not re-run)
//   • qwen3:4b     scored 5/5 light but 12-hour hang on one prompt
//   • nora:4b-v3.2 0/36 — no native function calling at all.
//
// Hermes 3 is a Llama-3.1-8B fine-tune by Nous Research, explicitly trained
// for agentic/tool use. License: Llama-3.1-Community (commercial use allowed).
// Memory: ~5 GB on disk, ~9-10 GB resident with 8k context. Fits the 16 GB
// principal-laptop budget with headroom for Electron + Office.
//
// Long-term: revisit when Hermes 4 / xLAM-v2 GGUF / Qwen 3.5 land. The
// self-test cron at scripts/clawx-selftest.mjs will catch regressions.
const LOCAL_BASE_URL = 'http://127.0.0.1:11434/v1';
const LOCAL_MODEL_ID = 'hermes3:8b';
const LOCAL_ACCOUNT_ID = 'ollama-local-hermes3-8b';
const LOCAL_ACCOUNT_LABEL = 'On this device (Hermes 3 8B)';
// Ollama doesn't enforce auth but the secret-store and runtime-sync paths
// expect a non-empty token — use a recognisable placeholder.
const LOCAL_PLACEHOLDER_KEY = 'ollama-local';

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
    target === normaliseBaseUrl('http://localhost:11434/v1')
  );
}

export async function seedDefaultLocalProvider(
  gatewayManager?: GatewayManager,
): Promise<void> {
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
        || id.startsWith('hermes3:')
        || id.startsWith('qwen3:')
        || id.startsWith('nora:'),
      {
        // Hermes 3 supports tool-calling natively; reasoning_effort is benign
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

  // Always-run re-sync: if our canonical account exists, push its current
  // model id into openclaw.json on every boot. This catches the case where
  // an earlier ClawX release wrote a different model into openclaw.json's
  // models.providers entry (e.g. ollama-ollamalo → qwen3:4b) and the model
  // id has since changed at the seed level. Without this, the gateway keeps
  // routing the old model id even though the providerAccount points to the
  // new one. Idempotent — syncSavedProviderToRuntime only writes when
  // something actually differs.
  try {
    const accounts = await listProviderAccounts();
    const canonical = accounts.find((a) => a.id === LOCAL_ACCOUNT_ID);
    if (canonical && canonical.model !== LOCAL_MODEL_ID) {
      // Drift between the seed code and the stored account: update the
      // account so the migration block below isn't needed in this branch.
      const updated = { ...canonical, model: LOCAL_MODEL_ID, label: LOCAL_ACCOUNT_LABEL,
        updatedAt: new Date().toISOString() };
      await saveProviderAccount(updated);
      logger.info(
        `[local-provider-seed] Bumped local account ${LOCAL_ACCOUNT_ID} model → ${LOCAL_MODEL_ID}`,
      );
    }
    if (canonical || accounts.find((a) => a.id === LOCAL_ACCOUNT_ID)) {
      const account = (await listProviderAccounts()).find((a) => a.id === LOCAL_ACCOUNT_ID);
      if (account) {
        await syncSavedProviderToRuntime(
          providerAccountToConfig(account),
          LOCAL_PLACEHOLDER_KEY,
          gatewayManager,
        );
      }
    }
  } catch (err) {
    logger.warn(
      `[local-provider-seed] always-resync failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  try {
    const existingAccounts = await listProviderAccounts();

    // One-time migration: fold any previous local-Ollama seed (Nora 4B, or the
    // earlier Qwen 3 4B) into the current default (Qwen 3 8B). Nora can't
    // tool-call (Ollama returns HTTP 400 with a `tools` array); Qwen 3 4B
    // bench-passed but had a 12-hour hang on one principal-style prompt that
    // disqualifies it for a chat product. Migrate in-place so the user keeps
    // their default-flag and existing chat sessions don't break.
    const LEGACY_LOCAL_IDS = new Set([
      'ollama-local-nora',
      'ollama-local-qwen3-4b',
      'ollama-local-qwen3-8b',
    ]);
    const LEGACY_LOCAL_MODELS = new Set([
      'nora:4b-v3.2',
      'qwen3:4b',
      'qwen3:8b',
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
        apiProtocol: 'openai-completions',
        updatedAt: now,
      };
      await saveProviderAccount(migrated);
      await storeApiKey(migrated.id, LOCAL_PLACEHOLDER_KEY);
      try {
        await syncSavedProviderToRuntime(
          providerAccountToConfig(migrated),
          LOCAL_PLACEHOLDER_KEY,
          gatewayManager,
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

    const now = new Date().toISOString();
    const account: ProviderAccount = {
      id: LOCAL_ACCOUNT_ID,
      vendorId: 'ollama',
      label: LOCAL_ACCOUNT_LABEL,
      authMode: 'local',
      baseUrl: LOCAL_BASE_URL,
      apiProtocol: 'openai-completions',
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
        gatewayManager,
      );
    } catch (err) {
      logger.warn(
        `[local-provider-seed] syncSavedProviderToRuntime failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Patch the model entry in openclaw.json so the gateway extracts <think>
    // blocks (Nora emits Apple-style reasoning) and skips tool-calling, which
    // the local Ollama OpenAI shim does not implement.  Idempotent: re-runs
    // are no-ops once both compat fields are already set.
    try {
      const runtimeProviderKey = getOpenClawProviderKey(account.vendorId, account.id);
      await patchProviderModelCompat(
        runtimeProviderKey,
        (id) => id === LOCAL_MODEL_ID || id.startsWith('nora:'),
        {
          supportsReasoningEffort: true,
          supportsTools: false,
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
      `[local-provider-seed] Seeded "${LOCAL_ACCOUNT_LABEL}" (${LOCAL_BASE_URL}, model=${LOCAL_MODEL_ID}, default=${shouldBecomeDefault})`,
    );
  } catch (err) {
    logger.warn(
      `[local-provider-seed] Failed to seed local provider: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
