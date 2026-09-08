import { readdirSync, readFileSync } from 'fs';
import { createRequire } from 'module';
import { join } from 'path';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  ONDEVICE_DENIED_TOOLS,
  applyOnDeviceToolTrim,
  hasOnDeviceTrim,
} from '../../electron/utils/ondevice-tool-policy';

const LOCAL_PROVIDER_KEY = 'ollama-ollamalo';
const LOCAL_MODEL_ID = 'qwen2.5:3b-instruct';
const OPENCLAW_RUNTIME_ROOT = process.env.CLAWX_OPENCLAW_RUNTIME_ROOT?.trim()
  || join(process.cwd(), 'node_modules', 'openclaw');
const requireOpenClawRuntime = createRequire(import.meta.url);

// ── Catalog fixture bound to the ACTUAL installed OpenClaw 2026.9.2 surface ──
// Every core name below is asserted against the runtime's own isKnownCoreToolId
// (see "runtime catalog parity"), so this fixture cannot silently drift into
// asserting denial of tools that no longer exist.

/** Principal-essential core tools (real 2026.9.2 core ids) — must survive. */
const KEPT_CORE_TOOLS = [
  'read',
  'write',
  'edit',
  'message',
  'exec',
  'apply_patch',
  'sessions_history',
  'sessions_send',
  'session_status',
  'agents_list',
  'progress_card',
] as const;

/**
 * Media core tool that SURVIVES today: the deny entry `image` names the retired
 * pre-9.2 tool and has no rename/family mapping in 2026.9.2, so it matches
 * nothing. Whether `image_generate` should be denied is an open product-policy
 * question (no reproduced cascade evidence on 9.2) — this test documents the
 * actual behavior and must be updated deliberately if the policy is extended.
 */
const SURVIVING_MEDIA_CORE_TOOL = 'image_generate';

/** Cascade offenders that are literal 2026.9.2 core tool ids. */
const DENIED_CORE_TOOLS = [
  'gateway',
  'tts',
  'process',
  'subagents',
  'sessions_list',
  'sessions_spawn',
  'sessions_yield',
  'web_search',
  'web_fetch',
] as const;

/**
 * In 2026.9.2 the `canvas` policy family was promoted to the core tool
 * `show_widget` (SHIPPED_PLUGIN_POLICY_FAMILY_CORE_TOOLS). Denying `canvas`
 * must remove `show_widget` through the real pipeline — real family denial.
 */
const CANVAS_FAMILY_CORE_TOOL = 'show_widget';

/**
 * Policy names that are NOT known core tool ids in 2026.9.2:
 *  - `update_plan`: renamed to `progress_card` (SHIPPED_CORE_POLICY_RENAMES).
 *  - `image`: retired; no rename or family mapping exists, so the deny entry
 *    `image` currently matches nothing (documented drift, see above).
 * NOTE: `canvas` is NOT retired as a policy id — isKnownCoreToolId('canvas')
 * is true. It stays a recognized policy name whose installed surface is the
 * promoted core `show_widget` plus the optional Canvas plugin tool (which
 * carries pluginId 'canvas' meta). The behavioral tests below prove that
 * denying `canvas` removes that real surface, not a literal meta-less name.
 */
const RETIRED_POLICY_NAMES = ['update_plan', 'image'] as const;

/** moe-principal-assistant plugin tools — actual registered names. */
const MOE_PLUGIN_TOOLS = [
  'document.find',
  'document.read_pdf',
  'document.read_docx',
  'document.read_xlsx',
  'document.write_docx',
  'document.write_xlsx',
  'document.read_image',
  'outlook.read_inbox',
  'outlook.read_email',
  'outlook.draft_email',
  'outlook.send_email',
  'forms.list',
  'forms.preview_daily_report',
  'forms.submit_daily_report',
  'principal.draft_letter',
  'principal.draft_memo',
  'principal.nscc_lookup',
  'principal.summarise_circular',
] as const;

type CatalogTool = { name: string; pluginId?: string };

const MOE_PLUGIN_ID = 'moe-principal-assistant';
/** The optional Canvas plugin tool as registered when installed AND enabled. */
const CANVAS_PLUGIN_TOOL: CatalogTool = { name: 'canvas', pluginId: 'canvas' };

/** Catalog for an installation WITHOUT the optional Canvas plugin. */
const BASE_CATALOG: CatalogTool[] = [
  ...KEPT_CORE_TOOLS.map((name) => ({ name })),
  { name: SURVIVING_MEDIA_CORE_TOOL },
  { name: CANVAS_FAMILY_CORE_TOOL },
  ...MOE_PLUGIN_TOOLS.map((name) => ({ name, pluginId: MOE_PLUGIN_ID })),
  ...DENIED_CORE_TOOLS.map((name) => ({ name })),
];

/** Catalog with the optional Canvas plugin installed and enabled. */
const CANVAS_ENABLED_CATALOG: CatalogTool[] = [...BASE_CATALOG, CANVAS_PLUGIN_TOOL];

type ToolPolicy = {
  allow?: string[];
  deny?: string[];
};

type TestConfig = {
  tools?: {
    profile?: string;
    byProvider?: Record<string, ToolPolicy | undefined>;
  };
  agents?: { defaults?: { model?: { primary?: string } } };
  plugins?: Record<string, unknown>;
};

type ToolRecord = { name: string };

type EffectiveToolPolicy = {
  agentId?: string;
  globalPolicy?: ToolPolicy;
  globalProviderPolicy?: ToolPolicy;
  agentPolicy?: ToolPolicy;
  agentProviderPolicy?: ToolPolicy;
  profile?: string;
  providerProfile?: string;
  profileAlsoAllow?: string[];
  providerProfileAlsoAllow?: string[];
};

let isToolAllowedByPolicyName: (name: string, policy: unknown) => boolean;
let isKnownCoreToolId: (name: string) => boolean;
let resolveEffectiveToolPolicy: (params: Record<string, unknown>) => EffectiveToolPolicy;
let resolveToolProfilePolicy: (profile: unknown) => ToolPolicy | undefined;
let mergeAlsoAllowPolicy: (policy: ToolPolicy | undefined, alsoAllow: string[] | undefined) => ToolPolicy | undefined;
let buildDefaultToolPolicyPipelineSteps: (params: Record<string, unknown>) => unknown[];
let applyToolPolicyPipeline: (params: {
  tools: ToolRecord[];
  toolMeta: (tool: ToolRecord) => unknown;
  steps: unknown[];
  warn: (message: string) => void;
}) => ToolRecord[];

function asTestConfig(config: unknown): TestConfig {
  return config as TestConfig;
}

function toolPolicy(config: unknown): ToolPolicy {
  const policy = asTestConfig(config).tools?.byProvider?.[LOCAL_PROVIDER_KEY];
  if (!policy) throw new Error(`missing tool policy for ${LOCAL_PROVIDER_KEY}`);
  return policy;
}

function parseExportedName(source: string, sourceSymbol: string): string | null {
  const exportBlocks = [...source.matchAll(/export\s*\{([^}]+)\}/g)];
  for (const [, block] of exportBlocks) {
    for (const rawPart of block.split(',')) {
      const part = rawPart.trim();
      const match = part.match(/^(\w+)(?:\s+as\s+(\w+))?$/);
      if (!match) continue;
      const [, localName, exportedName] = match;
      if (localName === sourceSymbol) return exportedName ?? localName;
    }
  }
  return null;
}

async function importOpenClawFunction<T extends (...args: never[]) => unknown>(
  sourceSymbol: string,
  label: string,
): Promise<T> {
  const distDir = join(OPENCLAW_RUNTIME_ROOT, 'dist');
  const candidates = readdirSync(distDir)
    .filter((f) => f.endsWith('.js'))
    .map((file) => {
      const source = readFileSync(join(distDir, file), 'utf8');
      const exportName = parseExportedName(source, sourceSymbol);
      return exportName ? { file, exportName } : null;
    })
    .filter((entry): entry is { file: string; exportName: string } => Boolean(entry));

  const namedCandidates = candidates.filter((entry) => entry.exportName === sourceSymbol);
  const selectedCandidates = namedCandidates.length > 0 ? namedCandidates : candidates;
  if (selectedCandidates.length !== 1) {
    throw new Error(
      `Ambiguous or missing OpenClaw export for ${label}: ${selectedCandidates
        .map((entry) => `${entry.file}:${entry.exportName}`)
        .join(', ') || 'none'}`,
    );
  }

  const selected = selectedCandidates[0];
  const mod = requireOpenClawRuntime(join(distDir, selected.file)) as Record<string, unknown>;
  const fn = mod[selected.exportName];
  if (typeof fn !== 'function') {
    throw new Error(`OpenClaw export ${selected.file}:${selected.exportName} for ${label} is not callable`);
  }
  return fn as T;
}

/** Plugin tools carry plugin meta exactly as the gateway's toolMeta reports it. */
function catalogToolMeta(tool: CatalogTool): unknown {
  return tool.pluginId ? { pluginId: tool.pluginId } : undefined;
}

function runFullProfileProviderPipeline(
  config: unknown,
  catalog: CatalogTool[],
): { names: string[]; warnings: string[] } {
  const effective = resolveEffectiveToolPolicy({
    config,
    modelProvider: LOCAL_PROVIDER_KEY,
    modelId: LOCAL_MODEL_ID,
    sessionKey: 'agent:main:main',
  });
  const profilePolicy = resolveToolProfilePolicy(effective.profile);
  const providerProfilePolicy = resolveToolProfilePolicy(effective.providerProfile);
  const warnings: string[] = [];
  const steps = buildDefaultToolPolicyPipelineSteps({
    profilePolicy: mergeAlsoAllowPolicy(profilePolicy, effective.profileAlsoAllow),
    profile: effective.profile,
    profileUnavailableCoreWarningAllowlist: profilePolicy?.allow,
    providerProfilePolicy: mergeAlsoAllowPolicy(
      providerProfilePolicy,
      effective.providerProfileAlsoAllow,
    ),
    providerProfile: effective.providerProfile,
    providerProfileUnavailableCoreWarningAllowlist: providerProfilePolicy?.allow,
    globalPolicy: effective.globalPolicy,
    globalProviderPolicy: effective.globalProviderPolicy,
    agentPolicy: effective.agentPolicy,
    agentProviderPolicy: effective.agentProviderPolicy,
    agentId: effective.agentId,
  });
  const filtered = applyToolPolicyPipeline({
    tools: catalog.map((tool) => ({ ...tool })),
    toolMeta: (tool) => catalogToolMeta(tool as CatalogTool),
    steps,
    warn: (message) => warnings.push(message),
  });
  return { names: filtered.map((tool) => tool.name), warnings };
}

beforeAll(async () => {
  isToolAllowedByPolicyName = await importOpenClawFunction<typeof isToolAllowedByPolicyName>(
    'isToolAllowedByPolicyName',
    'tool-policy matcher',
  );
  isKnownCoreToolId = await importOpenClawFunction<typeof isKnownCoreToolId>(
    'isKnownCoreToolId',
    'core tool-id catalog',
  );
  resolveEffectiveToolPolicy = await importOpenClawFunction<typeof resolveEffectiveToolPolicy>(
    'resolveEffectiveToolPolicy',
    'effective tool-policy resolver',
  );
  resolveToolProfilePolicy = await importOpenClawFunction<typeof resolveToolProfilePolicy>(
    'resolveToolProfilePolicy',
    'tool profile resolver',
  );
  mergeAlsoAllowPolicy = await importOpenClawFunction<typeof mergeAlsoAllowPolicy>(
    'mergeAlsoAllowPolicy',
    'tool profile alsoAllow merger',
  );
  buildDefaultToolPolicyPipelineSteps = await importOpenClawFunction<
    typeof buildDefaultToolPolicyPipelineSteps
  >(
    'buildDefaultToolPolicyPipelineSteps',
    'tool-policy pipeline step builder',
  );
  applyToolPolicyPipeline = await importOpenClawFunction<typeof applyToolPolicyPipeline>(
    'applyToolPolicyPipeline',
    'tool-policy pipeline',
  );
});

describe('OpenClaw runtime export discovery (negative controls for lookup drift)', () => {
  it('selects the exported name mapped to isToolAllowedByPolicyName instead of a stale minified alias', () => {
    const source = `
      function createToolPolicyMatcher() {}
      function isToolAllowedByPolicyName() {}
      function isToolAllowedByPolicies() {}
      export { createToolPolicyMatcher as n, isToolAllowedByPolicyName as o, isToolAllowedByPolicies as t };
    `;

    expect(parseExportedName(source, 'isToolAllowedByPolicyName')).toBe('o');
  });

  it('returns null (never a guess) when the symbol is absent from every export block', () => {
    const source = 'function other() {}\nexport { other as n };';
    expect(parseExportedName(source, 'isToolAllowedByPolicyName')).toBeNull();
  });

  it('rejects loudly for a symbol the runtime does not export at all', async () => {
    await expect(
      importOpenClawFunction('clawxNoSuchPolicyFunction', 'nonexistent symbol control'),
    ).rejects.toThrow(/Ambiguous or missing OpenClaw export/);
  });
});

describe('runtime catalog parity (guards against word-swap fixtures)', () => {
  it('every core fixture name is a real 2026.9.2 core tool id', () => {
    for (const name of [
      ...KEPT_CORE_TOOLS,
      ...DENIED_CORE_TOOLS,
      SURVIVING_MEDIA_CORE_TOOL,
      CANVAS_FAMILY_CORE_TOOL,
    ]) {
      expect(isKnownCoreToolId(name), `${name} should be a known core tool id`).toBe(true);
    }
  });

  it('retired policy names are NOT core tool ids — a literal-name fixture for them is invalid', () => {
    for (const name of RETIRED_POLICY_NAMES) {
      expect(isKnownCoreToolId(name), `${name} should be retired`).toBe(false);
    }
  });

  it('`canvas` remains a KNOWN policy id whose surface is the promoted family, not a literal tool', () => {
    expect(isKnownCoreToolId('canvas')).toBe(true);
  });

  it('every deny entry is either a live core id or a documented retired/family name', () => {
    const retired = new Set<string>(RETIRED_POLICY_NAMES);
    for (const denied of ONDEVICE_DENIED_TOOLS) {
      expect(
        isKnownCoreToolId(denied) || retired.has(denied),
        `${denied} is neither a known core id nor a documented retired/family policy name`,
      ).toBe(true);
    }
  });
});

describe('applyOnDeviceToolTrim (pure transform)', () => {
  it('adds the on-device deny list under tools.byProvider[providerKey]', () => {
    const { config, changed } = applyOnDeviceToolTrim({}, LOCAL_PROVIDER_KEY);
    expect(changed).toBe(true);
    const deny = toolPolicy(config).deny ?? [];
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
    expect(hasOnDeviceTrim(toolPolicy(first.config))).toBe(true);
  });

  it('never mutates the input config', () => {
    const input = { tools: { byProvider: {} } };
    const snapshot = JSON.stringify(input);
    applyOnDeviceToolTrim(input, LOCAL_PROVIDER_KEY);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('is provider-scoped — cloud providers get NO deny policy', () => {
    const { config } = applyOnDeviceToolTrim(
      { tools: { byProvider: { google: { allow: ['*'] } } } },
      LOCAL_PROVIDER_KEY,
    );
    const byProvider = asTestConfig(config).tools?.byProvider ?? {};
    expect(byProvider.google).toEqual({ allow: ['*'] });
    expect(byProvider[LOCAL_PROVIDER_KEY]?.deny).toContain('tts');
  });

  it('merges with (does not clobber) an existing deny for the same provider', () => {
    const { config, changed } = applyOnDeviceToolTrim(
      { tools: { byProvider: { [LOCAL_PROVIDER_KEY]: { deny: ['custom_tool'] } } } },
      LOCAL_PROVIDER_KEY,
    );
    expect(changed).toBe(true);
    const deny = toolPolicy(config).deny ?? [];
    expect(deny).toContain('custom_tool');
    expect(deny).toContain('tts');
  });

  it('preserves unrelated top-level config keys', () => {
    const { config } = applyOnDeviceToolTrim(
      { agents: { defaults: { model: { primary: 'x/y' } } }, plugins: { entries: {} } },
      LOCAL_PROVIDER_KEY,
    );
    expect(asTestConfig(config).agents?.defaults?.model?.primary).toBe('x/y');
    expect(asTestConfig(config).plugins).toEqual({ entries: {} });
  });

  it('returns unchanged for a blank provider key', () => {
    const input = {};
    const { config, changed } = applyOnDeviceToolTrim(input, '   ');
    expect(changed).toBe(false);
    expect(config).toBe(input);
  });
});

describe('trim honoured by the raw openclaw matcher (literal names only)', () => {
  it('denies literal deny-list names and keeps principal + plugin tools', () => {
    const { config } = applyOnDeviceToolTrim({}, LOCAL_PROVIDER_KEY);
    const policy = toolPolicy(config);

    for (const denied of DENIED_CORE_TOOLS) {
      expect(isToolAllowedByPolicyName(denied, policy), `${denied} should be denied`).toBe(false);
    }
    for (const kept of [...KEPT_CORE_TOOLS, ...MOE_PLUGIN_TOOLS]) {
      expect(isToolAllowedByPolicyName(kept, policy), `${kept} should be kept`).toBe(true);
    }
  });

  it('NEGATIVE CONTROL: the raw matcher alone does NOT implement family denial — show_widget passes it', () => {
    // Family expansion (canvas -> show_widget) happens in the pipeline, not in
    // isToolAllowedByPolicyName. If this control ever fails, the matcher's
    // semantics changed and the pipeline tests below must be re-derived.
    const { config } = applyOnDeviceToolTrim({}, LOCAL_PROVIDER_KEY);
    expect(isToolAllowedByPolicyName(CANVAS_FAMILY_CORE_TOOL, toolPolicy(config))).toBe(true);
  });

  it('NEGATIVE CONTROL: deny entries are exact names — image_generate is not glob-swallowed by `image`', () => {
    const { config } = applyOnDeviceToolTrim({}, LOCAL_PROVIDER_KEY);
    expect(isToolAllowedByPolicyName(SURVIVING_MEDIA_CORE_TOOL, toolPolicy(config))).toBe(true);
  });
});

describe('on-device trim through the ACTUAL OpenClaw 2026.9.2 policy pipeline', () => {
  it('denies the cascade set AND the canvas family core tool; keeps principal/doc/plugin tools', () => {
    const { config } = applyOnDeviceToolTrim({ tools: { profile: 'full' } }, LOCAL_PROVIDER_KEY);

    const { names, warnings } = runFullProfileProviderPipeline(config, BASE_CATALOG);

    expect(warnings).toEqual([]);
    for (const denied of DENIED_CORE_TOOLS) {
      expect(names).not.toContain(denied);
    }
    // Real family denial: deny entry `canvas` removes promoted core show_widget.
    expect(names).not.toContain(CANVAS_FAMILY_CORE_TOOL);
    // Exact expected survivor set, in catalog order — no vacuous passes.
    expect(names).toEqual([
      ...KEPT_CORE_TOOLS,
      SURVIVING_MEDIA_CORE_TOOL,
      ...MOE_PLUGIN_TOOLS,
    ]);
  });

  it('with the optional Canvas plugin enabled, the family entry also denies the plugin tool `canvas`', () => {
    const { config } = applyOnDeviceToolTrim({ tools: { profile: 'full' } }, LOCAL_PROVIDER_KEY);

    const { names, warnings } = runFullProfileProviderPipeline(config, CANVAS_ENABLED_CATALOG);

    expect(warnings).toEqual([]);
    expect(names).not.toContain('canvas');
    expect(names).not.toContain(CANVAS_FAMILY_CORE_TOOL);
    for (const kept of MOE_PLUGIN_TOOLS) {
      expect(names).toContain(kept);
    }
  });

  it('NO-TRIM BASELINE: a provider without the trim keeps the entire enabled catalog', () => {
    const { names, warnings } = runFullProfileProviderPipeline(
      { tools: { profile: 'full' } },
      CANVAS_ENABLED_CATALOG,
    );

    expect(warnings).toEqual([]);
    expect(names).toEqual(CANVAS_ENABLED_CATALOG.map((tool) => tool.name));
  });

  it('NEGATIVE CONTROL (forbidden-tool survival): dropping `canvas` from deny lets the family survive', () => {
    // Proves the family denial observed above is CAUSED by our deny entry and
    // the oracle detects survival — not a vacuous pass on an absent tool.
    const withoutCanvas = ONDEVICE_DENIED_TOOLS.filter((tool) => tool !== 'canvas');
    const config = {
      tools: {
        profile: 'full',
        byProvider: { [LOCAL_PROVIDER_KEY]: { deny: [...withoutCanvas] } },
      },
    };

    const { names } = runFullProfileProviderPipeline(config, CANVAS_ENABLED_CATALOG);

    expect(names).toContain(CANVAS_FAMILY_CORE_TOOL);
    expect(names).toContain('canvas');
    expect(names).not.toContain('gateway');
  });

  it('NEGATIVE CONTROL: a meta-less literal `canvas` tool would SURVIVE the family entry', () => {
    // 2026.9.2 family expansion REPLACES `canvas` with show_widget + the tools
    // of pluginId 'canvas'. A hypothetical tool named `canvas` without plugin
    // meta is therefore NOT denied. No installed 9.2 surface exposes such a
    // tool (core `canvas` is retired; the plugin tool always carries meta) —
    // this control documents that binding and fails if the semantics change.
    const { config } = applyOnDeviceToolTrim({ tools: { profile: 'full' } }, LOCAL_PROVIDER_KEY);
    const catalogWithBareCanvas: CatalogTool[] = [...BASE_CATALOG, { name: 'canvas' }];

    const { names } = runFullProfileProviderPipeline(config, catalogWithBareCanvas);

    expect(names).toContain('canvas');
    expect(names).not.toContain(CANVAS_FAMILY_CORE_TOOL);
  });
});
