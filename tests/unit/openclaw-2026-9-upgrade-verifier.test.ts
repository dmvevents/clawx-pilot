import fs from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  TARGET_OPENCLAW_VERSION,
  satisfiesOpenClawNodeEngine,
  verifyOpenClaw20269Upgrade,
} from '../../scripts/openclaw-2026-9-upgrade-verifier.mjs';
import {
  ensureElectronRuntime,
  getElectronPlatformPath,
  isElectronRuntimeInstalled,
} from '../../scripts/ensure-electron-runtime.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(__dirname, '..', '..');
const ACTUAL_OPENCLAW_DIR = path.join(ROOT, 'node_modules', 'openclaw');
const ACTUAL_CHAT = path.join(ACTUAL_OPENCLAW_DIR, 'dist', 'chat-IsrqkYID.js');
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeOpenClawFixture(overrides: Record<string, string> = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'clwx-openclaw-2026-9-'));
  tempDirs.push(dir);
  const openclawDir = path.join(dir, 'openclaw');
  const distDir = path.join(openclawDir, 'dist');
  await mkdir(path.join(distDir, 'plugin-sdk'), { recursive: true });
  await mkdir(path.join(distDir, 'plugins'), { recursive: true });
  await writeFile(path.join(openclawDir, 'package.json'), JSON.stringify({
    version: TARGET_OPENCLAW_VERSION,
    engines: { node: '>=22.22.3 <23 || >=24.15.0 <25 || >=25.9.0' },
  }), 'utf8');
  await writeFile(path.join(distDir, 'chat-fixture.js'), overrides.chat ?? [
    'async function handleChatHistoryRequest() {',
    'readPolicy: method === "chat.history" ? "ready" : "current";',
    'const startupProjectionPromise = entry?.authProfileOverride?.trim() ? readStartupProjection() : void 0;',
    'const thinkingDefault = resolveConfiguredThinkingDefault({ cfg, provider, model });',
    '}',
    'const chatHistoryHandlers = {};',
  ].join('\n'), 'utf8');
  await writeFile(path.join(distDir, 'sdk-alias-fixture.js'), overrides.sdk ?? [
    'function resolvePluginSdkScopedAliasMap() {}',
    'const cachedPluginSdkScopedAliasMaps = new Map();',
  ].join('\n'), 'utf8');
  await writeFile(path.join(distDir, 'pricing-fixture.js'), overrides.pricing ?? [
    'function normalizeOpenRouterModelPricing() {}',
    'const MODEL_PRICING_SOURCES = [];',
  ].join('\n'), 'utf8');
  const moduleFiles = {
    'plugin-sdk/model-catalog-pricing.js': 'export function normalizeOpenRouterModelPricing() {}\nexport function normalizeModelPricingCatalog() {}\n',
    'plugin-sdk/agent-runtime.js': 'export function resolveThinkingDefault() {}\nexport function resolveThinkingDefaultWithRuntimeCatalog() {}\n',
    'plugin-sdk/document-extractor.js': 'export {};\n',
    'plugin-sdk/gateway-method-runtime.js': 'export function dispatchGatewayMethod() {}\n',
    'plugin-sdk/transport-ready-runtime.js': 'export function waitForTransportReady() {}\n',
    'plugins/loader.js': 'export function loadOpenClawPlugins() {}\nexport function resolveRuntimePluginRegistry() {}\n',
  };
  for (const [rel, content] of Object.entries(moduleFiles)) {
    await writeFile(path.join(distDir, rel), content, 'utf8');
  }
  return openclawDir;
}

function getImportedLocalNames(source: string): string[] {
  return [...source.matchAll(/^import \{([^}]+)\} from/gm)]
    .flatMap((match) => match[1].split(',').map((part) => part.trim().split(/\s+as\s+/).pop()!));
}

function stripModuleSyntaxForEval(source: string): string {
  return source
    .replace(/^import .*;\n/gm, '')
    .replace(/\nexport \{[\s\S]*?\};\s*$/, '\nreturn { chatHistoryHandlers };');
}

async function loadActualChatHistoryHandler() {
  const source = fs.readFileSync(ACTUAL_CHAT, 'utf8');
  const importedLocalNames = getImportedLocalNames(source);
  const calls = new Set<string>();
  const stubs: Record<string, unknown> = Object.fromEntries(importedLocalNames.map((name) => [name, (..._args: unknown[]) => {
    calls.add(name);
    return undefined;
  }]));
  Object.assign(stubs, {
    assertValidParams: () => true,
    normalizeOptionalChatText: (value: unknown) => typeof value === 'string' ? value : undefined,
    resolveRequestedChatAgentId: () => ({ ok: true, agentId: 'main' }),
    loadGatewaySessionEntryReadOnly: () => ({
      cfg: { agents: { defaults: {} } },
      storePath: '/tmp/openclaw-session-store',
      store: {},
      entry: { sessionId: 'session-1' },
      canonicalKey: 'agent:main:main',
    }),
    validateChatSelectedAgent: () => ({ ok: true, agentId: 'main' }),
    resolveSessionAgentId: () => 'main',
    measureDiagnosticsTimelineSpanSync: (_label: string, fn: () => unknown) => fn(),
    measureDiagnosticsTimelineSpan: (_label: string, fn: () => unknown) => fn(),
    resolveSessionModelRef: () => ({ provider: 'google', model: 'gemini-2.5-pro' }),
    CHAT_HISTORY_MAX_ENTRIES: 1000,
    getMaxChatHistoryMessagesBytes: () => 1_000_000,
    resolveEffectiveChatHistoryMaxChars: () => undefined,
    listSessionPendingInputs: () => ({ items: [], total: 0 }),
    listSessionPendingInputReceipts: () => [],
    readIncrementalChatHistoryTail: () => ({
      readPage: { messages: [{ role: 'user', content: 'hello' }], totalMessages: 1, transcriptSource: 'active' },
      rawMessages: [{ role: 'user', content: 'hello' }],
      projected: [{ role: 'user', content: 'hello' }],
      rawPageMessages: 1,
    }),
    readChatHistoryCliSessionImportSnapshot: () => [],
    resolveChatHistoryWithCliSessionImports: ({ localMessages }: { localMessages: unknown[] }) => ({ messages: localMessages, imported: false }),
    resolveSessionTranscriptActiveLeafEntryId: () => null,
    augmentChatHistoryWithCanvasBlocks: (messages: unknown) => messages,
    dropPreSessionStartAnnouncePairs: (messages: unknown) => messages,
    projectChatDisplayMessages: (messages: unknown) => messages,
    composeTranscriptDisplay: (messages: unknown) => messages,
    capArrayByJsonBytes: (items: unknown[]) => ({ items }),
    jsonUtf8Bytes: () => 1,
    jsonUtf8BytesOrInfinity: () => 1,
    isSessionTranscriptProjectionUnavailableError: () => false,
    readChatHistoryMessageSeq: () => 1,
    buildGatewaySessionInfo: () => ({ modelProvider: 'google', model: 'gemini-2.5-pro', thinkingDefault: 'low' }),
    getSessionDefaults: () => ({ modelProvider: 'google', model: 'gemini-2.5-pro', thinkingDefault: 'low' }),
    findModelCatalogEntry: () => undefined,
    resolveAgentConfig: () => undefined,
    resolveConfiguredThinkingDefault: () => undefined,
    resolveGatewayModelSelectionPolicy: () => ({ target: 'session' }),
    tryResolveSessionCompatibilityOwnerAgentId: () => undefined,
    resolveVisibleActiveSessionRunState: () => ({ active: false }),
    readSessionPlacementFields: () => ({}),
    resolveInFlightRunSnapshot: () => undefined,
    boundInFlightRunSnapshotForChatHistory: () => undefined,
    formatErrorMessage: (error: unknown) => String(error),
    ErrorCodes: { INVALID_REQUEST: 'INVALID_REQUEST' },
    errorShape: (_code: unknown, message: unknown) => ({ message }),
    resolveAuthenticatedProfileId: () => undefined,
    formatForLog: String,
  });
  const fn = new Function('stubs', `const { ${importedLocalNames.join(', ')} } = stubs;\n${stripModuleSyntaxForEval(source)}`);
  type ChatHistoryHandler = (request: {
    params: Record<string, unknown>;
    client: Record<string, unknown>;
    context: Record<string, unknown>;
    respond: (ok: boolean, payload: Record<string, unknown> | undefined) => void;
  }) => Promise<void>;
  return { module: fn(stubs) as { chatHistoryHandlers: Record<string, ChatHistoryHandler> }, calls };
}

describe('OpenClaw 2026.9 upgrade verifier', () => {
  it('accepts the actual installed OpenClaw 2026.9.2 runtime disposition', async () => {
    await verifyOpenClaw20269Upgrade(ACTUAL_OPENCLAW_DIR);
  });

  it('matches the exact OpenClaw node engine floor used by the Windows wrappers', () => {
    expect(satisfiesOpenClawNodeEngine('22.22.2')).toBe(false);
    expect(satisfiesOpenClawNodeEngine('22.22.3')).toBe(true);
    expect(satisfiesOpenClawNodeEngine('24.14.9')).toBe(false);
    expect(satisfiesOpenClawNodeEngine('24.15.0')).toBe(true);
    expect(satisfiesOpenClawNodeEngine('25.8.9')).toBe(false);
    expect(satisfiesOpenClawNodeEngine('25.9.0')).toBe(true);
  });

  it('documents Electron 42 runtime materialization as an explicit package prerequisite', () => {
    const electronDir = path.dirname(require.resolve('electron/package.json'));
    expect(getElectronPlatformPath(process.platform)).toBe(process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : process.platform === 'win32' ? 'electron.exe' : 'electron');
    expect(typeof isElectronRuntimeInstalled({ electronPackageDir: electronDir, version: require('electron/package.json').version })).toBe('boolean');
  });

  it('fails closed instead of materializing a cross-target Electron runtime on the host', async () => {
    const wrongPlatform = process.platform === 'win32' ? 'linux' : 'win32';
    await expect(ensureElectronRuntime({ platform: wrongPlatform })).rejects.toThrow(/host-only/);
  });

  it('proves the actual chat.history handler responds without the old blocking model catalog path', async () => {
    const { module } = await loadActualChatHistoryHandler();
    let startupProjectionReads = 0;
    let response: [boolean, Record<string, unknown> | undefined] | undefined;

    await module.chatHistoryHandlers['chat.history']({
      params: { sessionKey: 'agent:main:main', limit: 200 },
      client: {},
      context: {
        getRuntimeConfig: () => ({ agents: { defaults: {} } }),
        chatAbortControllers: new Map(),
        chatRunState: {},
        logGateway: { debug() {} },
        readChatStartupProjection: () => {
          startupProjectionReads += 1;
          return undefined;
        },
        loadGatewayModelCatalog: () => {
          throw new Error('chat.history touched the old blocking model catalog loader');
        },
      },
      respond: (ok: boolean, payload: Record<string, unknown> | undefined) => {
        response = [ok, payload];
      },
    });

    expect(startupProjectionReads).toBe(1);
    expect(response?.[0]).toBe(true);
    expect(response?.[1]?.messages).toEqual([{ role: 'user', content: 'hello' }]);
    expect(response?.[1]?.sessionInfo).toMatchObject({ modelProvider: 'google', model: 'gemini-2.5-pro' });
  });

  it('proves native pricing normalization replaces the old provider-plugin startup refresh path', async () => {
    const pricing = await import(pathToFileURL(path.join(ACTUAL_OPENCLAW_DIR, 'dist', 'plugin-sdk', 'model-catalog-pricing.js')).href) as {
      normalizeOpenRouterModelPricing: (value: unknown) => unknown;
      normalizeModelPricingCatalog: (rows: unknown[], normalize: (value: unknown) => unknown) => Map<string, unknown> | undefined;
    };
    expect(pricing.normalizeOpenRouterModelPricing({ prompt: '0.000001', completion: '0.000002', input_cache_read: '0', input_cache_write: '0' })).toMatchObject({
      input: 1,
      output: 2,
      cacheRead: 0,
      cacheWrite: 0,
    });
    const catalog = pricing.normalizeModelPricingCatalog([
      { id: 'google/gemini-2.5-pro', pricing: { prompt: '0.000001', completion: '0.000002' } },
    ], pricing.normalizeOpenRouterModelPricing);
    expect(catalog?.get('google/gemini-2.5-pro')).toMatchObject({ input: 1, output: 2 });
  });

  it('loads required runtime surfaces for plugin/tool registration from the actual package', async () => {
    const loader = await import(pathToFileURL(path.join(ACTUAL_OPENCLAW_DIR, 'dist', 'plugins', 'loader.js')).href) as {
      loadOpenClawPlugins: (options: unknown) => unknown;
    };
    const registry = loader.loadOpenClawPlugins({ activate: false, onlyPluginIds: [] }) as { plugins: unknown[]; tools?: unknown[] };
    expect(registry.plugins).toEqual([]);
    for (const rel of [
      'plugin-sdk/gateway-method-runtime.js',
      'plugin-sdk/transport-ready-runtime.js',
      'plugin-sdk/session-catalog.js',
      'plugin-sdk/session-transcript-runtime.js',
    ]) {
      const mod = await import(pathToFileURL(path.join(ACTUAL_OPENCLAW_DIR, 'dist', rel)).href);
      expect(Object.keys(mod).length).toBeGreaterThan(0);
    }
    expect(fs.existsSync(path.join(ACTUAL_OPENCLAW_DIR, 'dist', 'plugin-sdk', 'document-extractor.js'))).toBe(true);
  });

  it('fails closed when the old chat.history catalog await is present', async () => {
    const openclawDir = await makeOpenClawFixture({
      chat: [
        'async function handleChatHistoryRequest() {',
        'readPolicy: method === "chat.history" ? "ready" : "current";',
        'const startupProjectionPromise = entry?.authProfileOverride?.trim() ? readStartupProjection() : void 0;',
        'const x = { catalog: await context.loadGatewayModelCatalog() };',
        'const thinkingDefault = resolveConfiguredThinkingDefault({ cfg, provider, model });',
        '}',
        'const chatHistoryHandlers = {};',
      ].join('\n'),
    });
    await expect(verifyOpenClaw20269Upgrade(openclawDir)).rejects.toThrow(/blocking catalog await/);
  });

  it('fails closed when stale SDK wrapper materialization helpers reappear', async () => {
    const openclawDir = await makeOpenClawFixture({
      sdk: 'function ensureOpenClawPluginSdkAlias() {}\nfunction resolvePluginSdkScopedAliasMap() {}\nconst cachedPluginSdkScopedAliasMaps = new Map();',
    });
    await expect(verifyOpenClaw20269Upgrade(openclawDir)).rejects.toThrow(/runtime wrapper materialization/);
  });

  it('fails closed when old pricing refresh cache implementation reappears', async () => {
    const openclawDir = await makeOpenClawFixture({
      pricing: 'function refreshGatewayModelPricingCache() {}\nfunction normalizeOpenRouterModelPricing() {}\nconst MODEL_PRICING_SOURCES = [];',
    });
    await expect(verifyOpenClaw20269Upgrade(openclawDir)).rejects.toThrow(/old refresh\/cache implementation/);
  });
});
