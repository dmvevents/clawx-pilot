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
 *   - keeps microsoft-graph DISABLED until the Entra app-registration packet
 *     comes back from MoE IT (see /tmp/moe-entra-app-registration-request.md);
 *   - leaves moe-principal-assistant ENABLED but with "Unconfigured *"
 *     defaults so it's effectively a no-op until first onboarding writes
 *     real values.
 *
 * Idempotent: only fills missing keys, never overwrites real values.
 *
 * Disable via env: `CLAWX_SEED_GATEWAY_PLUGIN_CONFIG=0`.
 */
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { logger } from '../utils/logger';
import { withConfigLock } from '../utils/config-mutex';
import { readOpenClawConfig, writeOpenClawConfig } from '../utils/channel-config';

function getConfigPath(): string {
  return join(homedir(), '.openclaw', 'openclaw.json');
}

// Placeholder values chosen to satisfy each plugin's JSON schema while
// remaining obviously-not-real so the onboarding flow can detect them.
const MS_GRAPH_PLACEHOLDER = {
  tenantId: 'pending-entra-registration',
  clientId: 'pending-entra-registration',
  redirectUri: 'http://localhost:18789/oauth/callback',
  authFlow: 'auth-code-pkce' as const,
  scopes: ['User.Read', 'Mail.Send', 'Files.ReadWrite'],
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

    // microsoft-graph: stub config, keep disabled until Entra packet returns.
    const mg: PluginEntry = entries['microsoft-graph'] ?? {};
    if (mg.enabled === undefined) {
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
