// @vitest-environment node
import fs from 'node:fs';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PATCH_MARKER,
  TARGET_OPENCLAW_VERSION,
  patchOpenClawChatHistory,
  transformOpenClawChatHistorySource,
  verifyOpenClawChatHistoryPatch,
} from '../../scripts/openclaw-chat-history-patch.mjs';

const ROOT = path.resolve(__dirname, '..', '..');
const installedOpenClawVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', 'openclaw', 'package.json'), 'utf8')).version;
const describeForPinnedOpenClaw = installedOpenClawVersion === TARGET_OPENCLAW_VERSION ? describe : describe.skip;
const ACTUAL_CHAT = path.join(ROOT, 'node_modules', 'openclaw', 'dist', 'chat-DM9hSaNV.js');
const ACTUAL_MODEL_SELECTION = path.join(ROOT, 'node_modules', 'openclaw', 'dist', 'model-selection-BLnNKGGO.js');
const actualSource = fs.existsSync(ACTUAL_CHAT) ? fs.readFileSync(ACTUAL_CHAT, 'utf8') : '';
const tempDirs: string[] = [];

type ChatMessage = { role: string; content: string; id?: string; timestamp?: number };
type HandlerFixture = {
  cfg: Record<string, unknown>;
  entry?: Record<string, unknown>;
  localMessages: ChatMessage[];
  resolvedSessionModel: { provider: string; model: string };
  catalog: Promise<unknown[]> | unknown[];
  catalogCalls: number;
};
type LoadedChatModule = {
  chatHandlers: Record<string, (args: {
    params: Record<string, unknown>;
    respond: (success: boolean, result?: unknown, error?: unknown) => void;
    context: Record<string, unknown>;
  }) => Promise<void>>;
};

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeTempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'clawx-chat-history-patch-'));
  tempDirs.push(dir);
  return dir;
}

function getImportedLocalNames(source: string): string[] {
  return [...source.matchAll(/^import \{([^}]+)\} from/gm)]
    .flatMap((match) => match[1].split(',').map((part) => part.trim().split(/\s+as\s+/).pop()!));
}

function stripModuleSyntaxForEval(source: string): string {
  return source
    .replace(/^import .*;\n/gm, '')
    .replace(/\nexport \{[\s\S]*?\};\s*$/, '\nreturn { chatHandlers };');
}

async function buildActualImportStubs(fixture: HandlerFixture) {
  const modelSelection = await import(pathToFileURL(ACTUAL_MODEL_SELECTION).href) as {
    p: (params: { cfg: unknown; provider: string; model: string; catalog: unknown[] }) => string;
  };
  const passthroughMessages = (messages: ChatMessage[]) => messages;
  const stubs: Record<string, unknown> = {
    fs,
    path,
    os,
    formatErrorMessage: (error: unknown) => String(error),
    normalizeLowercaseStringOrEmpty: (value: unknown) => typeof value === 'string' ? value.trim().toLowerCase() : '',
    normalizeOptionalString: (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : undefined,
    readStringValue: (value: unknown) => typeof value === 'string' ? value : undefined,
    normalizeProviderId: (value: unknown) => String(value ?? '').trim().toLowerCase().replace(/_/g, '-'),
    parseAgentSessionKey: () => ({ agentId: 'main', rest: 'main' }),
    resolveSessionAgentId: () => 'main',
    validateChatAbortParams: () => true,
    validateChatSendParams: () => true,
    errorShape: (_code: unknown, message: unknown) => ({ message }),
    formatValidationErrors: () => '',
    ErrorCodes: { INVALID_REQUEST: 'INVALID_REQUEST', UNAVAILABLE: 'UNAVAILABLE' },
    validateChatHistoryParams: Object.assign(() => true, { errors: [] }),
    validateChatInjectParams: () => true,
    hasGatewayClientCap: () => true,
    GATEWAY_CLIENT_NAMES: {},
    GATEWAY_CLIENT_MODES: {},
    isGatewayCliClient: () => false,
    isWebchatClient: () => true,
    GATEWAY_CLIENT_CAPS: {},
    normalizeMessageChannel: (value: unknown) => typeof value === 'string' ? value : undefined,
    INTERNAL_MESSAGE_CHANNEL: 'webchat',
    normalizeInputProvenance: () => undefined,
    ADMIN_SCOPE: 'admin',
    resolveThinkingDefault: modelSelection.p,
    resolveSessionFilePath: () => undefined,
    emitSessionTranscriptUpdate: () => undefined,
    stripEnvelopeFromMessages: passthroughMessages,
    readSessionMessages: () => fixture.localMessages,
    capArrayByJsonBytes: (messages: ChatMessage[]) => ({ items: messages }),
    jsonUtf8Bytes: (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8'),
    stripEnvelopeFromMessage: (value: unknown) => value,
    attachOpenClawTranscriptMeta: (message: unknown) => message,
    parseAssistantTextSignature: () => undefined,
    resolveAssistantMessagePhase: () => undefined,
    stripInlineDirectiveTagsFromMessageForDisplay: (message: unknown) => message,
    stripInlineDirectiveTagsForDisplay: (text: string) => ({ text }),
    sanitizeReplyDirectiveId: () => undefined,
    stripInboundMetadata: (value: unknown) => value,
    resolveGatewayModelSupportsImages: () => false,
    resolveDeletedAgentIdFromSessionKey: () => null,
    resolveSessionModelRef: () => fixture.resolvedSessionModel,
    loadSessionEntry: () => ({
      cfg: fixture.cfg,
      storePath: '/tmp/openclaw-session-store',
      entry: fixture.entry,
      canonicalKey: 'agent:main:main',
    }),
    isSilentReplyText: () => false,
    SILENT_REPLY_TOKEN: '__silent__',
    isAudioFileName: () => false,
    normalizeReplyPayloadsForDelivery: (value: unknown) => value,
    resolveSendableOutboundReplyParts: () => ({ mediaUrls: [] }),
    safeFileURLToPath: () => undefined,
    assertNoWindowsNetworkPath: () => undefined,
    getAgentScopedMediaLocalRoots: () => [],
    appendLocalMediaParentRoots: (roots: unknown[]) => roots,
    saveMediaBuffer: async () => undefined,
    assertLocalMediaAllowed: () => undefined,
    LocalMediaAccessError: class LocalMediaAccessError extends Error {},
    getSessionBindingService: () => undefined,
    resolveAgentTimeoutMs: () => 90_000,
    rewriteTranscriptEntriesInSessionFile: async () => undefined,
    isAbortRequestText: () => false,
    createReplyDispatcher: () => undefined,
    dispatchInboundMessage: async () => undefined,
    resolveSendPolicy: () => ({}),
    createChannelReplyPipeline: () => ({}),
    formatForLog: (value: unknown) => String(value),
    logLargePayload: () => undefined,
    MediaOffloadError: class MediaOffloadError extends Error {},
    parseMessageWithAttachments: async () => ({ message: '', images: [], imageOrder: [], offloadedRefs: [] }),
    normalizeRpcAttachmentsToChatAttachments: () => [],
    createManagedOutgoingImageBlocks: async () => [],
    attachManagedOutgoingImagesToMessage: () => undefined,
    cleanupManagedOutgoingImageRecords: async () => undefined,
    timestampOptsFromConfig: () => ({}),
    injectTimestamp: (message: string) => message,
    CURRENT_SESSION_VERSION: 1,
    SessionManager: class SessionManager {},
  };
  return stubs;
}

async function loadActualChatModule(source: string, fixture: HandlerFixture): Promise<LoadedChatModule> {
  const importedLocalNames = getImportedLocalNames(source);
  const body = stripModuleSyntaxForEval(source);
  const stubs = await buildActualImportStubs(fixture);
  const fn = new Function('stubs', `const { ${importedLocalNames.join(', ')} } = stubs;\nconst fs = stubs.fs;\nconst path = stubs.path;\nconst os = stubs.os;\n${body}`);
  return fn(stubs) as LoadedChatModule;
}

function makeFixture(overrides: Partial<HandlerFixture> = {}): HandlerFixture {
  return {
    cfg: { agents: { defaults: {} } },
    entry: { sessionId: 'session-1' },
    localMessages: [
      { id: 'u1', role: 'user', content: 'hello', timestamp: 1 },
      { id: 'a1', role: 'assistant', content: 'hi', timestamp: 2 },
    ],
    resolvedSessionModel: { provider: 'google', model: 'gemini-2.5-pro' },
    catalog: [],
    catalogCalls: 0,
    ...overrides,
  };
}

async function startHistoryCall(source: string, fixture: HandlerFixture) {
  const loaded = await loadActualChatModule(source, fixture);
  let response: { success: boolean; result?: unknown; error?: unknown } | null = null;
  const promise = loaded.chatHandlers['chat.history']({
    params: { sessionKey: 'agent:main:main', limit: 200 },
    context: {
      logGateway: { debug: () => undefined },
      loadGatewayModelCatalog: () => {
        fixture.catalogCalls += 1;
        return fixture.catalog;
      },
    },
    respond(success, result, error) {
      response = { success, result, error };
    },
  });
  return {
    promise,
    get response() {
      return response;
    },
  };
}

async function flushMicrotasks(turns = 3) {
  for (let i = 0; i < turns; i += 1) {
    await Promise.resolve();
  }
}

describeForPinnedOpenClaw('openclaw chat.history startup patch', () => {
  it('patches the pinned chat.history source and is idempotent', () => {
    const first = transformOpenClawChatHistorySource(actualSource);
    const second = transformOpenClawChatHistorySource(first.source);

    expect(first.patched).toBe(true);
    expect(first.source).toContain(PATCH_MARKER);
    expect(first.source).toContain('function resolveChatHistoryThinkingLevelWithoutCatalog(params)');
    expect(first.source).not.toContain('const catalog = await context.loadGatewayModelCatalog();');
    expect(second.patched).toBe(false);
    expect(second.source).toBe(first.source);
  });

  it('fails closed when the pinned target snippets drift', () => {
    expect(() => transformOpenClawChatHistorySource('const chatHandlers = {};')).toThrow(/target drift/);
    expect(() => transformOpenClawChatHistorySource(actualSource.replace('const chatHandlers = {', 'const changedChatHandlers = {'))).toThrow(/chatHandlers anchor/);
  });

  it('fails closed when a marked patch is incomplete or still blocks on the catalog', () => {
    const transformed = transformOpenClawChatHistorySource(actualSource).source;

    expect(() => transformOpenClawChatHistorySource(
      transformed.replace('function resolveChatHistoryThinkingLevelWithoutCatalog(params)', 'function resolveChatHistoryThinkingLevelChanged(params)'),
    )).toThrow(/patched snippets are incomplete/);

    expect(() => transformOpenClawChatHistorySource(
      transformed.replace('const verboseLevel = entry?.verboseLevel', 'const catalog = await context.loadGatewayModelCatalog();\n\t\tconst verboseLevel = entry?.verboseLevel'),
    )).toThrow(/blocking catalog await remains/);
  });

  it('proves the actual pinned handler blocks before the patch and responds after it when catalog never resolves', async () => {
    const baselineFixture = makeFixture({ catalog: new Promise<unknown[]>(() => {}) });
    const baseline = await startHistoryCall(actualSource, baselineFixture);
    await flushMicrotasks();

    expect(baselineFixture.catalogCalls).toBe(1);
    expect(baseline.response).toBeNull();

    const patchedFixture = makeFixture({ catalog: new Promise<unknown[]>(() => {}) });
    const patchedSource = transformOpenClawChatHistorySource(actualSource).source;
    const patched = await startHistoryCall(patchedSource, patchedFixture);
    await patched.promise;

    expect(patchedFixture.catalogCalls).toBe(0);
    expect(patched.response).toEqual({
      success: true,
      result: {
        sessionKey: 'agent:main:main',
        sessionId: 'session-1',
        messages: [
          { id: 'u1', role: 'user', content: 'hello', timestamp: 1 },
          { id: 'a1', role: 'assistant', content: 'hi', timestamp: 2 },
        ],
        thinkingLevel: 'off',
        fastMode: undefined,
        verboseLevel: undefined,
      },
      error: undefined,
    });
  });

  it('preserves actual pinned configured thinking defaults and leaves messages unchanged', async () => {
    const patchedSource = transformOpenClawChatHistorySource(actualSource).source;
    const perModelFixture = makeFixture({
      cfg: {
        agents: {
          defaults: {
            models: {
              'anthropic/claude-sonnet-4-6': { params: { thinking: 'adaptive' } },
            },
            verboseDefault: 'on',
          },
        },
      },
      entry: { sessionId: 'session-2', fastMode: true },
      resolvedSessionModel: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    });
    const globalDefaultFixture = makeFixture({
      cfg: { agents: { defaults: { thinkingDefault: 'low' } } },
      resolvedSessionModel: { provider: 'openai', model: 'gpt-5' },
    });

    const perModel = await startHistoryCall(patchedSource, perModelFixture);
    await perModel.promise;
    const globalDefault = await startHistoryCall(patchedSource, globalDefaultFixture);
    await globalDefault.promise;

    expect(perModelFixture.catalogCalls).toBe(0);
    expect(globalDefaultFixture.catalogCalls).toBe(0);
    expect(perModel.response).toMatchObject({
      result: {
        messages: perModelFixture.localMessages,
        thinkingLevel: 'adaptive',
        fastMode: true,
        verboseLevel: 'on',
      },
    });
    expect(globalDefault.response).toMatchObject({
      result: {
        messages: globalDefaultFixture.localMessages,
        thinkingLevel: 'low',
      },
    });
  });

  it('preserves persisted thinking without consulting catalog-backed default resolution', async () => {
    const patchedSource = transformOpenClawChatHistorySource(actualSource).source;
    const fixture = makeFixture({
      cfg: { agents: { defaults: { thinkingDefault: 'medium' } } },
      entry: { thinkingLevel: 'high', sessionId: 'session-3' },
      catalog: new Promise<unknown[]>(() => {}),
      resolvedSessionModel: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    });
    const patched = await startHistoryCall(patchedSource, fixture);
    await patched.promise;

    expect(fixture.catalogCalls).toBe(0);
    expect(patched.response).toMatchObject({ result: { thinkingLevel: 'high' } });
  });

  it('patches chat-history chunks while rejecting an unpatched bundle during verification', async () => {
    const dir = await makeTempDir();
    const openclawDir = path.join(dir, 'openclaw');
    const distDir = path.join(openclawDir, 'dist');
    await mkdir(distDir, { recursive: true });
    await writeFile(path.join(openclawDir, 'package.json'), JSON.stringify({ version: TARGET_OPENCLAW_VERSION }), 'utf8');
    await copyFile(ACTUAL_CHAT, path.join(distDir, 'chat-hot.js'));
    await writeFile(path.join(distDir, 'chat-history-text-small.js'), 'export const helper = true;\n', 'utf8');

    expect(() => verifyOpenClawChatHistoryPatch(openclawDir)).toThrow(/patch marker missing/);
    const result = patchOpenClawChatHistory(openclawDir);
    verifyOpenClawChatHistoryPatch(openclawDir);

    expect(result.targets.map((target) => path.basename(target))).toEqual(['chat-hot.js']);
    expect(result.patched).toBe(true);
    expect(fs.readFileSync(path.join(distDir, 'chat-hot.js'), 'utf8')).toContain(PATCH_MARKER);
    expect(fs.readFileSync(path.join(distDir, 'chat-history-text-small.js'), 'utf8')).not.toContain(PATCH_MARKER);
    expect(patchOpenClawChatHistory(openclawDir).patched).toBe(false);
  });
});
