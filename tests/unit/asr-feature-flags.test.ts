import { afterEach, describe, expect, it, vi } from 'vitest';

const ENV_KEYS = ['CLAWX_PILOT_MODE', 'CLAWX_PREFER_AZURE_SPEECH'] as const;
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

async function loadFlags(env: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  vi.resetModules();
  for (const key of ENV_KEYS) {
    const value = env[key];
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  return import('../../shared/feature-flags');
}

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  vi.resetModules();
});

describe('ASR feature flags', () => {
  it('prefers Azure Speech by default in pilot mode', async () => {
    const flags = await loadFlags({ CLAWX_PILOT_MODE: '1' });

    expect(flags.PREFER_AZURE_SPEECH).toBe(true);
  });

  it('keeps Azure Speech opt-out available for local/offline deployments', async () => {
    const flags = await loadFlags({
      CLAWX_PILOT_MODE: '1',
      CLAWX_PREFER_AZURE_SPEECH: '0',
    });

    expect(flags.PREFER_AZURE_SPEECH).toBe(false);
  });

  it('does not prefer Azure Speech outside pilot mode unless explicitly enabled', async () => {
    const flags = await loadFlags({ CLAWX_PILOT_MODE: '0' });

    expect(flags.PREFER_AZURE_SPEECH).toBe(false);
  });
});
