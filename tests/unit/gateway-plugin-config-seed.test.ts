import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../../electron/utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Hoisted so vi.mock factories below can reference it. Vitest hoists vi.mock()
// to the top of the file; non-hoisted constants are then in TDZ when the
// mock factory runs. After commit 588ab72/d562477 this file's imports now
// transitively load channel-config.ts which calls homedir() at module-load,
// surfacing the TDZ. vi.hoisted runs in the same hoisted phase as vi.mock
// and cannot reference top-level imports, so we re-require what we need.
const { HOME_OVERRIDE } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require('node:os') as typeof import('node:os');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('node:path') as typeof import('node:path');
  return {
    HOME_OVERRIDE: path.join(os.tmpdir(), 'clawx-plugin-seed-test-' + Date.now()),
  };
});

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return { ...actual, homedir: () => HOME_OVERRIDE, default: { ...actual, homedir: () => HOME_OVERRIDE } };
});

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => HOME_OVERRIDE, default: { ...actual, homedir: () => HOME_OVERRIDE } };
});

import { seedGatewayPluginConfig } from '../../electron/main/gateway-plugin-config-seed';

const CFG_PATH = join(HOME_OVERRIDE, '.openclaw', 'openclaw.json');

async function readCfg(): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(CFG_PATH, 'utf-8'));
}

async function writeCfg(cfg: unknown): Promise<void> {
  await fs.mkdir(join(HOME_OVERRIDE, '.openclaw'), { recursive: true });
  await fs.writeFile(CFG_PATH, JSON.stringify(cfg, null, 2) + '\n', 'utf-8');
}

beforeEach(async () => {
  await fs.rm(HOME_OVERRIDE, { recursive: true, force: true });
  delete process.env.CLAWX_SEED_GATEWAY_PLUGIN_CONFIG;
});

afterEach(async () => {
  await fs.rm(HOME_OVERRIDE, { recursive: true, force: true });
});

describe('seedGatewayPluginConfig', () => {
  it('writes first-run skeleton when openclaw.json is missing so gateway boots cleanly', async () => {
    await expect(seedGatewayPluginConfig()).resolves.toBeUndefined();
    const cfg = await readCfg();
    const entries = (cfg as any).plugins.entries;
    expect(entries['microsoft-graph'].enabled).toBe(false);
    expect(entries['microsoft-graph'].config.tenantId).toBe('pending-entra-registration');
    expect(entries['moe-principal-assistant'].enabled).toBe(true);
    expect(entries['moe-principal-assistant'].config.schoolType).toBe('Government');
  });

  it('seeds microsoft-graph with disabled + schema-valid placeholder config', async () => {
    await writeCfg({ plugins: { entries: {} } });
    await seedGatewayPluginConfig();
    const cfg = await readCfg();
    const mg = (cfg as any).plugins.entries['microsoft-graph'];
    expect(mg.enabled).toBe(false);
    expect(mg.config.tenantId).toBe('pending-entra-registration');
    expect(mg.config.clientId).toBe('pending-entra-registration');
    expect(mg.config.authFlow).toBe('auth-code-pkce');
    expect(mg.config.scopes).toEqual(['User.Read', 'Mail.Send', 'Files.ReadWrite']);
  });

  it('seeds moe-principal-assistant with enabled + Unconfigured placeholders in valid enums', async () => {
    await writeCfg({ plugins: { entries: {} } });
    await seedGatewayPluginConfig();
    const cfg = await readCfg();
    const ma = (cfg as any).plugins.entries['moe-principal-assistant'];
    expect(ma.enabled).toBe(true);
    expect(ma.config.principalName).toBe('Unconfigured Principal');
    expect(ma.config.schoolName).toBe('Unconfigured School');
    // schoolType enum is {Denominational, Government} — placeholder must match
    expect(['Denominational', 'Government']).toContain(ma.config.schoolType);
    // educationDistrict enum is the seven MoE districts
    expect([
      'Caroni',
      'North Eastern',
      'Port of Spain & Environs',
      'South Eastern',
      'St. George East',
      'St. Patrick',
      'Victoria',
    ]).toContain(ma.config.educationDistrict);
  });

  it('does NOT overwrite real values once configured', async () => {
    await writeCfg({
      plugins: {
        entries: {
          'microsoft-graph': {
            enabled: true,
            config: {
              tenantId: 'real-tenant-uuid',
              clientId: 'real-client-uuid',
              redirectUri: 'http://localhost:18789/oauth/callback',
              authFlow: 'auth-code-pkce',
              scopes: ['User.Read'],
            },
          },
          'moe-principal-assistant': {
            enabled: true,
            config: {
              principalName: 'Mrs. Bartholomew',
              schoolName: 'Diego Martin Govt Primary',
              educationDistrict: 'Port of Spain & Environs',
              schoolType: 'Government',
            },
          },
        },
      },
    });
    await seedGatewayPluginConfig();
    const cfg = await readCfg();
    expect((cfg as any).plugins.entries['microsoft-graph'].config.tenantId).toBe('real-tenant-uuid');
    expect((cfg as any).plugins.entries['moe-principal-assistant'].config.principalName).toBe(
      'Mrs. Bartholomew',
    );
    expect((cfg as any).plugins.entries['moe-principal-assistant'].config.schoolName).toBe(
      'Diego Martin Govt Primary',
    );
  });

  it('drift-fixes legacy authFlow="pkce" to "auth-code-pkce"', async () => {
    await writeCfg({
      plugins: {
        entries: {
          'microsoft-graph': {
            enabled: false,
            config: {
              tenantId: 'x',
              clientId: 'y',
              authFlow: 'pkce', // old enum value
            },
          },
        },
      },
    });
    await seedGatewayPluginConfig();
    const cfg = await readCfg();
    expect((cfg as any).plugins.entries['microsoft-graph'].config.authFlow).toBe('auth-code-pkce');
  });

  it('drift-fixes invalid schoolType to "Government"', async () => {
    await writeCfg({
      plugins: {
        entries: {
          'moe-principal-assistant': {
            enabled: true,
            config: {
              principalName: 'P',
              schoolName: 'S',
              educationDistrict: 'Caroni',
              schoolType: 'primary', // invalid — old free-text value
            },
          },
        },
      },
    });
    await seedGatewayPluginConfig();
    const cfg = await readCfg();
    expect((cfg as any).plugins.entries['moe-principal-assistant'].config.schoolType).toBe(
      'Government',
    );
  });

  it('respects CLAWX_SEED_GATEWAY_PLUGIN_CONFIG=0 escape hatch', async () => {
    process.env.CLAWX_SEED_GATEWAY_PLUGIN_CONFIG = '0';
    await writeCfg({ plugins: { entries: {} } });
    await seedGatewayPluginConfig();
    const cfg = await readCfg();
    expect((cfg as any).plugins.entries).toEqual({});
  });

  it('is a no-op on a second run (idempotent)', async () => {
    await writeCfg({ plugins: { entries: {} } });
    await seedGatewayPluginConfig();
    const after1 = await fs.readFile(CFG_PATH, 'utf-8');
    await seedGatewayPluginConfig();
    const after2 = await fs.readFile(CFG_PATH, 'utf-8');
    expect(after2).toBe(after1);
  });

  it('prunes stale plugin entries (wechat, wecom, etc.) the gateway warns about every boot', async () => {
    // Seed a config that has the leftover-fork plugin entries the
    // gateway emits "plugin not found" warns for. After
    // seedGatewayPluginConfig runs they should be gone.
    await writeCfg({
      plugins: {
        entries: {
          wechat: { enabled: false },
          wecom: { enabled: false },
          'phone-control': { enabled: false },
          telegram: { enabled: false },
        },
      },
    });
    await seedGatewayPluginConfig();
    const cfg = await readCfg();
    const entries = (cfg as { plugins?: { entries?: Record<string, unknown> } }).plugins?.entries ?? {};
    expect(entries.wechat).toBeUndefined();
    expect(entries.wecom).toBeUndefined();
    expect(entries['phone-control']).toBeUndefined();
    expect(entries.telegram).toBeUndefined();
    // The MoE plugins should still be added (the seed's primary job).
    expect(entries['microsoft-graph']).toBeDefined();
    expect(entries['moe-principal-assistant']).toBeDefined();
  });
});
