/**
 * Self-healing seeder for gateway plugin config.
 *
 * Two MoE plugins declare required configSchema fields that, when missing or
 * invalid, cause `openclaw doctor repair` to exit non-zero — which in turn
 * makes GatewayManager.start() abort with `Gateway process exited before
 * becoming ready (code=1)`:
 *
 *   • microsoft-graph: requires { tenantId, clientId } and accepts
 *     authFlow ∈ {"device-code","auth-code-pkce"}.
 *   • moe-principal-assistant: requires { principalName, schoolName,
 *     educationDistrict, schoolType } where schoolType ∈ {"Denominational",
 *     "Government"} and educationDistrict ∈ the seven MoE districts.
 *
 * On a fresh install (or after a wipe of ~/.openclaw/openclaw.json) those
 * blocks are absent, the doctor refuses, and the gateway never comes up.
 * This seeder writes schema-valid placeholder config that:
 *   - keeps microsoft-graph DISABLED — always. The host-API adapter
 *     (electron/services/microsoft-graph) is the sole Graph lane; the
 *     gateway plugin stub crashes gateway boot when enabled without host
 *     wiring, so enabled=false is forced even over a hand edit;
 *   - leaves moe-principal-assistant ENABLED but with "Unconfigured *"
 *     defaults so it's effectively a no-op until first onboarding writes
 *     real values.
 *
 * Idempotent: only fills missing keys, never overwrites real values — with
 * the one deliberate policy exception above (microsoft-graph.enabled is
 * pinned to false).
 *
 * Disable via env: `CLAWX_SEED_GATEWAY_PLUGIN_CONFIG=0`.
 */
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { logger } from '../utils/logger';
import { withConfigLock } from '../utils/config-mutex';
import { readOpenClawConfig, writeOpenClawConfig } from '../utils/channel-config';

function _getConfigPath(): string {
  return join(homedir(), '.openclaw', 'openclaw.json');
}

// Placeholder values chosen to satisfy each plugin's JSON schema while
// remaining obviously-not-real so the onboarding flow can detect them.
const MS_GRAPH_PLACEHOLDER = {
  tenantId: 'pending-entra-registration',
  clientId: 'pending-entra-registration',
  redirectUri: 'http://localhost:18789/oauth/callback',
  authFlow: 'auth-code-pkce' as const,
  // Read-only baseline. Mail.Send and write scopes are requested through the
  // host-API sign-in flow when compose is enabled, never seeded here.
  scopes: ['offline_access', 'User.Read', 'Mail.Read'],
};

const MOE_ASSISTANT_PLACEHOLDER = {
  principalName: 'Unconfigured Principal',
  schoolName: 'Unconfigured School',
  educationDistrict: 'North Eastern' as const,
  schoolType: 'Government' as const,
};

interface PluginEntry {
  enabled?: boolean;
  config?: Record<string, unknown>;
  [key: string]: unknown;
}

interface OpenClawConfig {
  plugins?: {
    entries?: Record<string, PluginEntry>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fillMissingKeys<T extends Record<string, unknown>>(
  target: Record<string, unknown>,
  defaults: T,
): boolean {
  let changed = false;
  for (const [key, defaultValue] of Object.entries(defaults)) {
    if (!(key in target) || target[key] === undefined || target[key] === null || target[key] === '') {
      target[key] = defaultValue;
      changed = true;
    }
  }
  return changed;
}

export async function seedGatewayPluginConfig(): Promise<void> {
  if (process.env.CLAWX_SEED_GATEWAY_PLUGIN_CONFIG === '0') {
    logger.debug('[gateway-plugin-seed] disabled via CLAWX_SEED_GATEWAY_PLUGIN_CONFIG=0');
    return;
  }

  // Wrap the entire read-modify-write inside withConfigLock so concurrent
  // boot-time writers (ensureBuiltinSkillsInstalled, seedDefaultLocalProvider,
  // setOpenClawDefaultModel, ...) cannot interleave between our read and our
  // write. Pre-fix this function used raw fs.{readFile,writeFile} and would
  // silently overwrite anything those writers had committed in the gap. The
  // boot-path audit at /tmp/boot-path-audit.md lists this as the single
  // CRITICAL race window on every launch.
  await withConfigLock(async () => {
    // First-run-from-zero handling: if the file doesn't exist yet, ensure the
    // directory + create an empty skeleton so the canonical readers don't
    // explode. readOpenClawConfig itself returns {} on ENOENT, but we need
    // the directory to exist before writeOpenClawConfig is called.
    const dir = join(homedir(), '.openclaw');
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (mkErr) {
      logger.warn(
        `[gateway-plugin-seed] failed to create ${dir}: ${mkErr instanceof Error ? mkErr.message : String(mkErr)}`,
      );
      return;
    }

    // Use the canonical reader+writer so we inherit the regression guard
    // landed in commit 588ab72 (refuses to clobber a populated agents.list).
    let cfg: OpenClawConfig;
    try {
      cfg = (await readOpenClawConfig()) as OpenClawConfig;
    } catch (err) {
      logger.warn(
        `[gateway-plugin-seed] openclaw.json unreadable; skipping: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return;
    }

    if (!isPlainObject(cfg.plugins)) cfg.plugins = {};
    const plugins = cfg.plugins as { entries?: Record<string, PluginEntry> };
    if (!isPlainObject(plugins.entries)) plugins.entries = {};
    const entries = plugins.entries!;

    let changed = false;

    // microsoft-graph: stub config, forced disabled ALWAYS. The host-API
    // adapter is the sole Graph lane; the gateway stub crashes gateway boot
    // when enabled without host wiring, so this is pinned rather than
    // fill-if-missing like everything else in this seeder.
    const mg: PluginEntry = entries['microsoft-graph'] ?? {};
    if (mg.enabled !== false) {
      mg.enabled = false;
      changed = true;
    }
    if (!isPlainObject(mg.config)) {
      mg.config = {};
      changed = true;
    }
    if (fillMissingKeys(mg.config!, MS_GRAPH_PLACEHOLDER)) changed = true;
    // authFlow drift fix: enum tightened from 'pkce' to 'auth-code-pkce'
    if (mg.config!['authFlow'] === 'pkce') {
      mg.config!['authFlow'] = 'auth-code-pkce';
      changed = true;
    }
    entries['microsoft-graph'] = mg;

    // moe-principal-assistant: stay enabled but harmless until onboarding.
    const ma: PluginEntry = entries['moe-principal-assistant'] ?? {};
    if (ma.enabled === undefined) {
      ma.enabled = true;
      changed = true;
    }
    if (!isPlainObject(ma.config)) {
      ma.config = {};
      changed = true;
    }
    if (fillMissingKeys(ma.config!, MOE_ASSISTANT_PLACEHOLDER)) changed = true;
    // schoolType drift fix: enum is {Denominational, Government}, lowercase invalid.
    const stRaw = ma.config!['schoolType'];
    if (typeof stRaw === 'string' && stRaw !== 'Denominational' && stRaw !== 'Government') {
      ma.config!['schoolType'] = 'Government';
      changed = true;
    }
    entries['moe-principal-assistant'] = ma;

    // Prune stale plugin entries the gateway warns about every boot.
    // The gateway log emits lines like:
    //   plugins.entries.wechat: plugin not found: wechat (stale config
    //     entry ignored; remove it from plugins config)
    // for entries the user (or a previous build) configured but for
    // which no plugin code exists in the current bundle. The gateway
    // ignores them at runtime, but logs the warn every restart, which
    // becomes noise that masks real problems.
    //
    // We can't dynamically detect every available plugin from this
    // process (the gateway owns that knowledge), but we CAN evict a
    // small known list of upstream-fork plugins that the MoE pilot
    // build never ships. Keep this list narrow — adding a plugin name
    // here permanently disables it for the pilot.
    const STALE_PLUGIN_NAMES = [
      'wechat',
      'wecom',
      'feishu',
      'qqbot',
      'discord',
      'telegram',
      'whatsapp',
      'slack',
      'signal',
      'imessage',
      'matrix',
      'line',
      'msteams',
      'googlechat',
      'mattermost',
      'tlon',
      'twitch',
      'voice-call',
      'webhooks',
      'xiaomi',
      'zalo',
      'zalouser',
      'nostr',
      'nextcloud-talk',
      'phone-control',
      'synology-chat',
      'irc',
      'bluebubbles',
      'browser',
      'google',
      'dingtalk',
    ];
    for (const name of STALE_PLUGIN_NAMES) {
      if (entries[name]) {
        delete entries[name];
        changed = true;
        logger.info(`[gateway-plugin-seed] pruned stale plugins.entries.${name}`);
      }
    }

    // One-shot migration: scan models.providers.*.api and rewrite any
    // ClawX-side auth-protocol values that snuck into the runtime-side
    // field. This repairs configs written before commit ef9801c, when
    // provider-runtime-sync.ts wrote `apiProtocol` verbatim into `api`.
    // The gateway's enum doesn't accept google-query-key / anthropic-
    // header / openrouter / openai-bearer / none, and rejecting the
    // config crash-loops the gateway. Map them to the runtime-side
    // equivalent the gateway does accept.
    const runtimeApiMigration: Record<string, string> = {
      'google-query-key': 'openai-completions',
      'anthropic-header': 'anthropic-messages',
      'openrouter': 'openai-completions',
      'openai-bearer': 'openai-completions',
      'none': 'ollama',
    };
    const models = (cfg as { models?: { providers?: Record<string, { api?: unknown }> } }).models;
    const providers = models?.providers;
    if (providers && typeof providers === 'object') {
      for (const [name, pCfg] of Object.entries(providers)) {
        if (!pCfg || typeof pCfg !== 'object') continue;
        const currentApi = pCfg.api;
        if (typeof currentApi === 'string' && runtimeApiMigration[currentApi]) {
          pCfg.api = runtimeApiMigration[currentApi];
          changed = true;
          logger.info(
            `[gateway-plugin-seed] migrated models.providers.${name}.api: "${currentApi}" → "${pCfg.api}"`,
          );
        }
      }
    }

    if (!changed) {
      logger.debug('[gateway-plugin-seed] plugin config already schema-valid; no changes');
      return;
    }

    await writeOpenClawConfig(cfg);
    logger.info(
      '[gateway-plugin-seed] patched openclaw.json with schema-valid placeholders for microsoft-graph + moe-principal-assistant',
    );
  });
}
