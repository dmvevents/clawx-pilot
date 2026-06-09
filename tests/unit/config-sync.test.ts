import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripSystemdSupervisorEnv } from '@electron/gateway/config-sync-env';

describe('stripSystemdSupervisorEnv', () => {
  it('removes systemd supervisor marker env vars', () => {
    const env = {
      PATH: '/usr/bin:/bin',
      OPENCLAW_SYSTEMD_UNIT: 'openclaw-gateway.service',
      INVOCATION_ID: 'abc123',
      SYSTEMD_EXEC_PID: '777',
      JOURNAL_STREAM: '8:12345',
      OTHER: 'keep-me',
    };

    const result = stripSystemdSupervisorEnv(env);

    expect(result).toEqual({
      PATH: '/usr/bin:/bin',
      OTHER: 'keep-me',
    });
  });

  it('keeps unrelated variables unchanged', () => {
    const env = {
      NODE_ENV: 'production',
      OPENCLAW_GATEWAY_TOKEN: 'token',
      CLAWDBOT_SKIP_CHANNELS: '0',
    };

    expect(stripSystemdSupervisorEnv(env)).toEqual(env);
  });

  it('does not mutate source env object', () => {
    const env = {
      OPENCLAW_SYSTEMD_UNIT: 'openclaw-gateway.service',
      VALUE: '1',
    };
    const before = { ...env };

    const result = stripSystemdSupervisorEnv(env);

    expect(env).toEqual(before);
    expect(result).toEqual({ VALUE: '1' });
  });
});

describe('prepareGatewayLaunchContext', () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('CLAWX_PORT_CLAWX_HOST_API', '13210');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  async function loadPrepareGatewayLaunchContext() {
    const tempRoot = mkdtempSync(join(tmpdir(), 'clawx-config-sync-'));
    const openclawDir = join(tempRoot, 'openclaw');
    const configDir = join(tempRoot, 'config');
    mkdirSync(openclawDir, { recursive: true });
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(openclawDir, 'index.js'), '');
    tempDirs.push(tempRoot);

    vi.doMock('electron', () => ({
      app: {
        isPackaged: false,
        getVersion: () => '0.4.3-test',
        getAppPath: () => '/repo',
      },
    }));

    vi.doMock('@electron/utils/store', () => ({
      getAllSettings: vi.fn(async () => ({
        gatewayToken: 'gateway-token',
        proxyEnabled: false,
      })),
    }));
    vi.doMock('@electron/utils/secure-storage', () => ({
      getApiKey: vi.fn(async () => null),
      getDefaultProvider: vi.fn(async () => null),
      getProvider: vi.fn(async () => null),
    }));
    vi.doMock('@electron/utils/provider-registry', () => ({
      getProviderEnvVar: vi.fn(() => null),
      getKeyableProviderTypes: vi.fn(() => []),
    }));
    vi.doMock('@electron/utils/paths', () => ({
      getOpenClawConfigDir: vi.fn(() => configDir),
      getOpenClawDir: vi.fn(() => openclawDir),
      getOpenClawEntryPath: vi.fn(() => join(openclawDir, 'index.js')),
      getOpenClawResolvedDir: vi.fn(() => openclawDir),
      getOpenClawSkillsDir: vi.fn(() => join(configDir, 'skills')),
      isOpenClawPresent: vi.fn(() => true),
    }));
    vi.doMock('@electron/utils/uv-env', () => ({
      getUvMirrorEnv: vi.fn(async () => ({})),
    }));
    vi.doMock('@electron/utils/channel-config', () => ({
      cleanupDanglingWeChatPluginState: vi.fn(async () => undefined),
      listConfiguredChannelsFromConfig: vi.fn(async () => []),
      readOpenClawConfig: vi.fn(async () => ({})),
    }));
    vi.doMock('@electron/utils/openclaw-auth', () => ({
      sanitizeOpenClawConfig: vi.fn(async () => undefined),
      batchSyncConfigFields: vi.fn(async () => undefined),
    }));
    vi.doMock('@electron/utils/proxy', () => ({
      buildProxyEnv: vi.fn(() => ({})),
      resolveProxySettings: vi.fn(() => ({ httpProxy: '', httpsProxy: '', allProxy: '' })),
    }));
    vi.doMock('@electron/utils/openclaw-proxy', () => ({
      syncProxyConfigToOpenClaw: vi.fn(async () => undefined),
    }));
    vi.doMock('@electron/utils/logger', () => ({
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
    }));
    vi.doMock('@electron/utils/env-path', () => ({
      prependPathEntry: vi.fn((env) => ({ env })),
    }));
    vi.doMock('@electron/utils/plugin-install', () => ({
      copyPluginFromNodeModules: vi.fn(),
      fixupPluginManifest: vi.fn(),
      cpSyncSafe: vi.fn(),
    }));
    vi.doMock('@electron/gateway/skills-symlink-cleanup', () => ({
      cleanupAgentsSymlinkedSkills: vi.fn(() => ({ failed: 0 })),
      cleanupStalePluginRuntimeDeps: vi.fn(() => ({ failed: 0 })),
    }));
    vi.doMock('@electron/gateway/prelaunch-maintenance-cache', () => ({
      buildPrelaunchMaintenanceCacheKey: vi.fn(() => 'cache-key'),
      directoryChildrenSignature: vi.fn(() => 'empty'),
      pathSignature: vi.fn(() => 'missing'),
      runCachedPrelaunchMaintenanceTask: vi.fn((_name, _key, task) => ({
        ok: task(),
        skipped: false,
      })),
    }));

    const tokenModule = await import('@electron/api/host-api-token');
    tokenModule.generateHostApiToken();
    return import('@electron/gateway/config-sync');
  }

  it('threads Host API credentials into the spawned Gateway env after Host API startup', async () => {
    const { prepareGatewayLaunchContext } = await loadPrepareGatewayLaunchContext();

    const context = await prepareGatewayLaunchContext(18789);

    expect(context.forkEnv.CLAWX_HOST_API_PORT).toBe('13210');
    expect(context.forkEnv.CLAWX_HOST_API_TOKEN).toMatch(/^[a-f0-9]{64}$/);
    expect(context.forkEnv.OPENCLAW_GATEWAY_TOKEN).toBe('gateway-token');
  });
});
