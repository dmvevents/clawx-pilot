/**
 * BUG-012 repro / regression: on a fresh install, runChannelPreflight must
 * leave openclaw.json with an agents block the gateway can bind a channel from.
 *
 * Scope: this drives the REAL preflight → applyChannelChange → setAllAgentsModel
 * → writeOpenClawConfig path against a temp HOME. The provider-ACCOUNT layer
 * (electron-store backed) is stubbed to return exactly what seedCloudGateway
 * Provider would have written on first launch: one enabled "custom" cloud
 * gateway account, default, model moe-demo-pro. Everything that touches
 * ~/.openclaw/openclaw.json (channel-config, agent-config) is REAL.
 *
 * Regression class: on a truly fresh install the resulting openclaw.json had
 * NO agents block, so the gateway logged configuredChannelCount:0 and its RPC
 * router never came up (chat.history timed out → UI stuck). See
 * project_bug_012_agents_block_missing memory + CLEAN-SLATE-FINDINGS.md.
 */
import { readFile, rm } from 'fs/promises';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderConfig } from '@electron/utils/secure-storage';
import type { ProviderAccount } from '../../shared/providers/types';

const { testHome } = vi.hoisted(() => {
  const suffix = Math.random().toString(36).slice(2);
  return { testHome: `/tmp/clawx-fresh-install-${suffix}` };
});

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const mocked = { ...actual, homedir: () => testHome };
  return { ...mocked, default: mocked };
});

// Provider-ACCOUNT layer: mirror what seedCloudGatewayProvider writes on a
// fresh install. This is the electron-store-backed layer; stubbing it keeps the
// test off the packaged app while leaving the openclaw.json writers real.
const cloudAccount: ProviderAccount = {
  id: 'moe-cloud-gateway',
  vendorId: 'custom',
  label: 'MOE Cloud Gateway',
  authMode: 'api_key',
  baseUrl: 'https://gateway.example.run.app/v1',
  apiProtocol: 'openai-completions',
  model: 'moe-demo-pro',
  fallbackModels: ['moe-demo'],
  enabled: true,
  isDefault: true,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
} as ProviderAccount;

const cloudProvider: ProviderConfig = {
  id: 'moe-cloud-gateway',
  name: 'MOE Cloud Gateway',
  type: 'custom',
  enabled: true,
  baseUrl: 'https://gateway.example.run.app/v1',
  model: 'moe-demo-pro',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
} as ProviderConfig;

let defaultProviderId: string | undefined;

vi.mock('@electron/services/providers/provider-store', () => ({
  listProviderAccounts: vi.fn(async () => [cloudAccount]),
}));

vi.mock('@electron/utils/secure-storage', () => ({
  getProvider: vi.fn(async (id: string) => (id === cloudProvider.id ? cloudProvider : null)),
  getDefaultProvider: vi.fn(async () => defaultProviderId),
  setDefaultProvider: vi.fn(async (id: string) => { defaultProviderId = id; }),
}));

vi.mock('@electron/services/providers/provider-runtime-sync', () => ({
  syncDefaultProviderToRuntime: vi.fn(async () => undefined),
  getOpenClawProviderKey: (type: string, id: string) => `${type}-${id.replace(/[^a-z0-9]/gi, '')}`,
}));

async function readOpenClawJson(): Promise<Record<string, unknown>> {
  const content = await readFile(join(testHome, '.openclaw', 'openclaw.json'), 'utf8');
  return JSON.parse(content) as Record<string, unknown>;
}

describe('BUG-012 fresh-install boot chain', () => {
  beforeEach(async () => {
    vi.resetModules();
    defaultProviderId = undefined;
    await rm(testHome, { recursive: true, force: true });
  });

  afterEach(async () => {
    await rm(testHome, { recursive: true, force: true });
  });

  it('preflight leaves openclaw.json with a bindable agents model on a fresh install', async () => {
    const { runChannelPreflight } = await import('@electron/services/providers/channel-router');

    // Fresh install: preferredChannel would be 'online' after cloud seed.
    const preflight = await runChannelPreflight('online');

    // The preflight must actually run — not early-return on no-accounts.
    expect(preflight.ran, `preflight did not run: ${JSON.stringify(preflight)}`).toBe(true);

    const config = await readOpenClawJson();
    const agents = config.agents as
      | { defaults?: { model?: { primary?: string } }; list?: Array<{ model?: { primary?: string } }> }
      | undefined;

    // THE CORE ASSERTION: the gateway needs some agents model to bind a
    // channel. agents.defaults.model.primary OR a populated list entry must
    // carry a provider/model ref.
    expect(agents, 'openclaw.json must have an agents block after preflight').toBeDefined();

    const defaultsModel = agents?.defaults?.model?.primary;
    const firstListModel = agents?.list?.[0]?.model?.primary;
    const bindableModel = defaultsModel ?? firstListModel;

    expect(bindableModel, 'agents must carry a bindable provider/model ref').toBeTruthy();
    expect(bindableModel).toContain('/');
  });

  /**
   * Companion repro for the ACTUAL BUG-012 trigger. When NO provider account
   * resolves at preflight time (cloud seed skipped + Ollama not registered),
   * runChannelPreflight early-returns `no-accounts` and writes nothing — the
   * gateway then boots with configuredChannelCount:0 and its RPC router never
   * comes up. This test locks the invariant that ensureBootableAgentsConfig
   * (called on the boot path) still leaves a bootable agents block behind so
   * the gateway can at least start and the renderer can show a setup state
   * instead of hanging on a chat.history timeout.
   */
  it('boot path leaves a bootable agents block even when no provider account resolves', async () => {
    // Simulate the "no accounts at all" fresh install: nothing seeded yet.
    const providerStore = await import('@electron/services/providers/provider-store');
    (providerStore.listProviderAccounts as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    const { runChannelPreflight, ensureBootableAgentsConfig } = await import(
      '@electron/services/providers/channel-router'
    );

    const preflight = await runChannelPreflight('online');
    // With no accounts, preflight cannot pin a model — it early-returns.
    expect(preflight.ran).toBe(false);
    expect(preflight.reason).toBe('no-accounts');

    // The boot-path safety net must still leave a bootable agents block so the
    // gateway comes up (unconfigured) rather than hanging with a dead RPC.
    const result = await ensureBootableAgentsConfig();
    expect(result.ensured).toBe(true);

    const config = await readOpenClawJson();
    const agents = config.agents as { defaults?: unknown; list?: unknown } | undefined;
    expect(agents, 'openclaw.json must have an agents block after the boot-path safety net').toBeDefined();
    expect(agents?.defaults, 'agents.defaults must exist so the gateway can bind/route').toBeDefined();
  });

  it('ensureBootableAgentsConfig is idempotent and never downgrades an existing model', async () => {
    const { ensureBootableAgentsConfig } = await import('@electron/services/providers/channel-router');

    // First call with a known model seeds it.
    const first = await ensureBootableAgentsConfig('custom-moecloud/moe-demo-pro');
    expect(first.created).toBe(true);
    expect(first.modelRef).toBe('custom-moecloud/moe-demo-pro');

    // Second call must be a no-op and preserve the existing model (idempotent).
    const second = await ensureBootableAgentsConfig();
    expect(second.created).toBe(false);
    expect(second.modelRef).toBe('custom-moecloud/moe-demo-pro');

    const config = await readOpenClawJson();
    const agents = config.agents as { defaults?: { model?: { primary?: string } } };
    expect(agents.defaults?.model?.primary).toBe('custom-moecloud/moe-demo-pro');
  });

  /**
   * Slow-ready repro (KR2): a prior boot seeded a present-but-model-less
   * defaults block (preflight resolved no model). A later boot that DOES have a
   * valid modelRef must upgrade the empty block in place rather than
   * short-circuiting on "defaults exists" — otherwise the gateway boots with an
   * unbindable channel and the composer stays disabled for minutes while the
   * ready-fallback loop churns.
   */
  it('upgrades a present-but-model-less defaults block when a modelRef becomes available', async () => {
    const { ensureBootableAgentsConfig } = await import('@electron/services/providers/channel-router');

    // First boot: no model resolvable → seeds an empty defaults block.
    const seeded = await ensureBootableAgentsConfig();
    expect(seeded.ensured).toBe(true);
    let config = await readOpenClawJson();
    let agents = config.agents as { defaults?: { model?: { primary?: string } } };
    expect(agents.defaults, 'empty defaults block must be seeded').toBeDefined();
    expect(agents.defaults?.model?.primary, 'no model yet on first boot').toBeUndefined();

    // Second boot: a valid modelRef is now available → must be written in.
    const upgraded = await ensureBootableAgentsConfig('custom-moecloud/moe-demo-pro');
    expect(upgraded.modelRef).toBe('custom-moecloud/moe-demo-pro');
    config = await readOpenClawJson();
    agents = config.agents as { defaults?: { model?: { primary?: string } } };
    expect(
      agents.defaults?.model?.primary,
      'model-less defaults must be upgraded, not left unbindable',
    ).toBe('custom-moecloud/moe-demo-pro');

    // Third boot with no modelRef: now short-circuits and preserves the model.
    const stable = await ensureBootableAgentsConfig();
    expect(stable.created).toBe(false);
    expect(stable.modelRef).toBe('custom-moecloud/moe-demo-pro');
  });
});
