import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  ONDEVICE_DENIED_TOOLS,
  applyOnDeviceToolTrim,
  hasOnDeviceTrim,
} from '../../electron/utils/ondevice-tool-policy';

// ── Real openclaw tool-policy matcher ────────────────────────────────
// The whole point of the trim is that the resulting deny policy is honoured by
// the gateway's ACTUAL tool-policy resolver, not a re-implementation. openclaw's
// dist chunk names are content-hashed, so resolve the chunk that exports the
// matcher at test time and import it. If the bundled internals ever move, this
// test fails loudly instead of silently testing a stale copy.
let isToolAllowedByPolicyName: (name: string, policy: unknown) => boolean;

beforeAll(async () => {
  const distDir = join(process.cwd(), 'node_modules', 'openclaw', 'dist');
  const chunk = readdirSync(distDir).find(
    (f) =>
      f.endsWith('.js') &&
      /function isToolAllowedByPolicyName/.test(readFileSync(join(distDir, f), 'utf8')),
  );
  if (!chunk) {
    throw new Error(
      'Could not locate openclaw tool-policy matcher chunk — bundled internals may have moved',
    );
  }
  const mod = (await import(pathToFileURL(join(distDir, chunk)).href)) as Record<string, unknown>;
  // Exported minified as `n` (isToolAllowedByPolicyName) — assert it is callable.
  const candidate = (mod.n ?? mod.isToolAllowedByPolicyName) as typeof isToolAllowedByPolicyName;
  expect(typeof candidate).toBe('function');
  isToolAllowedByPolicyName = candidate;
});

const LOCAL_PROVIDER_KEY = 'ollama-ollamalo';

// A representative slice of the catalog ClawX injects into an on-device turn.
const FULL_CATALOG = [
  // Principal-essential — must survive the trim.
  'read',
  'write',
  'edit',
  'message',
  'exec',
  // Plugin tools (moe-principal-assistant) — must survive the trim.
  'outlook_send_email',
  'forms_fill',
  'moe_draft_letter',
  // The cascade offenders — must be removed.
  'gateway',
  'tts',
  'process',
  'subagents',
  'sessions_list',
  'sessions_spawn',
  'sessions_yield',
  'web_search',
  'web_fetch',
  'image',
  'canvas',
];

describe('applyOnDeviceToolTrim (pure transform)', () => {
  it('adds the on-device deny list under tools.byProvider[providerKey]', () => {
    const { config, changed } = applyOnDeviceToolTrim({}, LOCAL_PROVIDER_KEY);
    expect(changed).toBe(true);
    const deny = (config as any).tools.byProvider[LOCAL_PROVIDER_KEY].deny as string[];
    for (const tool of ONDEVICE_DENIED_TOOLS) {
      expect(deny).toContain(tool);
    }
    expect(deny).toContain('gateway');
    expect(deny).toContain('sessions_yield');
  });

  it('is idempotent — a second apply is a no-op and returns the same reference', () => {
    const first = applyOnDeviceToolTrim({}, LOCAL_PROVIDER_KEY);
    const second = applyOnDeviceToolTrim(first.config, LOCAL_PROVIDER_KEY);
    expect(second.changed).toBe(false);
    expect(second.config).toBe(first.config);
    expect(hasOnDeviceTrim((first.config as any).tools.byProvider[LOCAL_PROVIDER_KEY])).toBe(true);
  });

  it('never mutates the input config', () => {
    const input = { tools: { byProvider: {} } };
    const snapshot = JSON.stringify(input);
    applyOnDeviceToolTrim(input, LOCAL_PROVIDER_KEY);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('is provider-scoped — cloud providers get NO deny policy', () => {
    const { config } = applyOnDeviceToolTrim(
      { tools: { byProvider: { 'google': { allow: ['*'] } } } },
      LOCAL_PROVIDER_KEY,
    );
    const byProvider = (config as any).tools.byProvider;
    expect(byProvider.google).toEqual({ allow: ['*'] });
    expect(byProvider[LOCAL_PROVIDER_KEY].deny).toContain('tts');
  });

  it('merges with (does not clobber) an existing deny for the same provider', () => {
    const { config, changed } = applyOnDeviceToolTrim(
      { tools: { byProvider: { [LOCAL_PROVIDER_KEY]: { deny: ['custom_tool'] } } } },
      LOCAL_PROVIDER_KEY,
    );
    expect(changed).toBe(true);
    const deny = (config as any).tools.byProvider[LOCAL_PROVIDER_KEY].deny as string[];
    expect(deny).toContain('custom_tool');
    expect(deny).toContain('tts');
  });

  it('preserves unrelated top-level config keys', () => {
    const { config } = applyOnDeviceToolTrim(
      { agents: { defaults: { model: { primary: 'x/y' } } }, plugins: { entries: {} } },
      LOCAL_PROVIDER_KEY,
    );
    expect((config as any).agents.defaults.model.primary).toBe('x/y');
    expect((config as any).plugins).toEqual({ entries: {} });
  });

  it('returns unchanged for a blank provider key', () => {
    const input = {};
    const { config, changed } = applyOnDeviceToolTrim(input, '   ');
    expect(changed).toBe(false);
    expect(config).toBe(input);
  });
});

describe('trim honoured by the REAL openclaw tool-policy matcher', () => {
  it('removes exactly the cascade tools and keeps principal + plugin tools', () => {
    const { config } = applyOnDeviceToolTrim({}, LOCAL_PROVIDER_KEY);
    const policy = (config as any).tools.byProvider[LOCAL_PROVIDER_KEY];

    const survivors = FULL_CATALOG.filter((t) => isToolAllowedByPolicyName(t, policy));

    // The cascade offenders are gone.
    for (const denied of ONDEVICE_DENIED_TOOLS) {
      expect(survivors).not.toContain(denied);
    }
    expect(survivors).not.toContain('gateway');
    // The tools that make the assistant useful remain.
    for (const kept of [
      'read',
      'write',
      'edit',
      'message',
      'exec',
      'outlook_send_email',
      'forms_fill',
      'moe_draft_letter',
    ]) {
      expect(survivors).toContain(kept);
    }
    // The trim strictly shrinks the catalog.
    expect(survivors.length).toBeLessThan(FULL_CATALOG.length);
  });

  it('a provider with NO trim policy keeps the full catalog (proves scoping matters)', () => {
    // Simulates a cloud provider: applyOnDeviceToolTrim never wrote a policy for it.
    const survivors = FULL_CATALOG.filter((t) => isToolAllowedByPolicyName(t, undefined));
    expect(survivors).toEqual(FULL_CATALOG);
  });
});
