import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..', '..');
const FIXTURE = path.join(ROOT, 'eval', 'fixtures', 'clwx92-public-pdf-fixture.pdf');
const WORKER_CHECK = path.join(ROOT, 'scripts', 'clwx92-workerenv-check.mjs');
const MARKER = 'CLWX92_SYNTHETIC_PUBLIC_FIXTURE_TEXT';

async function withIsolatedRoots<T>(fn: (roots: { root: string; home: string; temp: string; env: NodeJS.ProcessEnv }) => T | Promise<T>): Promise<T> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clwx92-test-'));
  const home = path.join(root, 'home');
  const temp = path.join(root, 'tmp');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(temp, { recursive: true });

  try {
    return await fn({
      root,
      home,
      temp,
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        TMPDIR: temp,
        TMP: temp,
        TEMP: temp,
      },
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function runWorker(env: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, [WORKER_CHECK], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    timeout: 30_000,
  });
}

function runVerifier(cwd: string, env: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, ['scripts/verify-openclaw-bundle.mjs'], {
    cwd,
    env,
    encoding: 'utf8',
    timeout: 30_000,
  });
}

function copyVerifierCheckoutFiles(destinationRoot: string) {
  for (const dir of ['scripts', 'extensions']) {
    fs.mkdirSync(path.join(destinationRoot, dir), { recursive: true });
  }
  fs.cpSync(
    path.join(ROOT, 'extensions', 'moe-principal-assistant'),
    path.join(destinationRoot, 'extensions', 'moe-principal-assistant'),
    { recursive: true },
  );
  for (const file of [
    'scripts/verify-openclaw-bundle.mjs',
    'scripts/clwx92-workerenv-check.mjs',
    'scripts/openclaw-bundle-config.mjs',
    'scripts/openclaw-2026-9-upgrade-verifier.mjs',
    'scripts/openclaw-windows-pty-guard-patch.mjs',
  ]) {
    fs.copyFileSync(path.join(ROOT, file), path.join(destinationRoot, file));
  }
}

async function createFakeOpenClawBundle(destinationRoot: string, options: { includeFixture: boolean }) {
  copyVerifierCheckoutFiles(destinationRoot);
  if (options.includeFixture) {
    const fixtureDir = path.join(destinationRoot, 'eval', 'fixtures');
    fs.mkdirSync(fixtureDir, { recursive: true });
    fs.copyFileSync(FIXTURE, path.join(fixtureDir, 'clwx92-public-pdf-fixture.pdf'));
  }

  const openclawRoot = path.join(destinationRoot, 'build', 'openclaw');
  const distDir = path.join(openclawRoot, 'dist');
  fs.mkdirSync(path.join(distDir, 'plugin-sdk'), { recursive: true });
  fs.mkdirSync(path.join(distDir, 'plugins'), { recursive: true });
  fs.writeFileSync(path.join(openclawRoot, 'package.json'), JSON.stringify({
    version: '2026.9.2',
    engines: { node: '>=22.22.3 <23 || >=24.15.0 <25 || >=25.9.0' },
  }), 'utf8');
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(destinationRoot, 'extensions', 'moe-principal-assistant', 'node_modules'), 'junction');
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(destinationRoot, 'build', 'node_modules'), 'junction');
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(openclawRoot, 'node_modules'), 'junction');

  fs.writeFileSync(path.join(distDir, 'chat-test.js'), [
    'async function handleChatHistoryRequest() {',
    'readPolicy: method === "chat.history" ? "ready" : "current";',
    'const startupProjectionPromise = entry?.authProfileOverride?.trim() ? readStartupProjection() : void 0;',
    'const thinkingDefault = resolveConfiguredThinkingDefault({ cfg, provider, model });',
    '}',
    'const chatHistoryHandlers = {};',
  ].join('\n'), 'utf8');
  fs.writeFileSync(path.join(distDir, 'sdk-alias-test.js'), [
    'function resolvePluginSdkScopedAliasMap() {}',
    'const cachedPluginSdkScopedAliasMaps = new Map();',
  ].join('\n'), 'utf8');
  fs.writeFileSync(path.join(distDir, 'pricing-test.js'), [
    'function normalizeOpenRouterModelPricing() {}',
    'const MODEL_PRICING_SOURCES = [];',
  ].join('\n'), 'utf8');
  fs.writeFileSync(path.join(distDir, 'bash-tools-test.js'), [
    'function processGatewayAllowlist(params, sandbox) {',
    '\t\t\t\t\t\tpty: params.pty === true && !sandbox && process.platform !== "win32",',
    '}',
    'function runExecProcess(params, sandbox) {',
    '\t\t\t\tconst usePty = params.pty === true && !sandbox && process.platform !== "win32";',
    '\treturn usePty;',
    '}',
  ].join('\n'), 'utf8');
  const moduleFiles = {
    'plugin-sdk/model-catalog-pricing.js': 'export function normalizeOpenRouterModelPricing() {}\nexport function normalizeModelPricingCatalog() {}\n',
    'plugin-sdk/agent-runtime.js': 'export function resolveThinkingDefault() {}\nexport function resolveThinkingDefaultWithRuntimeCatalog() {}\n',
    'plugin-sdk/document-extractor.js': 'export {};\n',
    'plugin-sdk/gateway-method-runtime.js': 'export function dispatchGatewayMethod() {}\n',
    'plugin-sdk/transport-ready-runtime.js': 'export function waitForTransportReady() {}\n',
    'plugins/loader.js': 'export function loadOpenClawPlugins() {}\nexport function resolveRuntimePluginRegistry() {}\n',
    'plugins/build-smoke-entry.js': `
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function resolvePluginRuntimeLoadContext(options) {
  const configPath = options.env.OPENCLAW_CONFIG_PATH;
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  return { ...options, config };
}

export function buildPluginRuntimeLoadOptions(context, overrides) {
  return { ...context, ...overrides };
}

export async function loadOpenClawPlugins(options) {
  const pluginRoot = options.config.plugins.load.paths[0];
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'openclaw.plugin.json'), 'utf8'));
  const pluginConfig = options.config.plugins.entries[manifest.id].config;
  const registry = { plugins: [], tools: [] };
  const record = { id: manifest.id, status: 'loaded', activated: true, rootDir: pluginRoot, toolNames: [] };
  const declared = new Set(manifest.contracts?.tools ?? []);
  const mod = await import(pathToFileURL(path.join(pluginRoot, 'index.mjs')).href);
  mod.register({
    pluginConfig,
    config: options.config,
    log: { info() {}, warn() {} },
    registerTool(tool, opts) {
      const names = [...(opts?.names ?? []), ...(opts?.name ? [opts.name] : []), ...(typeof tool === 'function' ? [] : [tool.name])].filter(Boolean);
      for (const name of names) {
        if (!declared.has(name)) throw new Error(\`undeclared tool \${name}\`);
      }
      record.toolNames.push(...names);
      registry.tools.push({
        names,
        factory: typeof tool === 'function' ? tool : () => tool,
      });
    },
  });
  registry.plugins.push(record);
  return registry;
}
`,
  };
  for (const [rel, content] of Object.entries(moduleFiles)) {
    fs.writeFileSync(path.join(distDir, rel), content, 'utf8');
  }
  return { openclawRoot, bundleNm: path.join(openclawRoot, 'node_modules') };
}

describe('CLWX-92 public PDF bundle fixture', () => {
  it('ships a public fixture with the expected parser marker', () => {
    expect(fs.existsSync(FIXTURE)).toBe(true);
    expect(fs.statSync(FIXTURE).size).toBeGreaterThan(1_000);

    const worker = fs.readFileSync(WORKER_CHECK, 'utf8');
    expect(worker).toContain('../eval/fixtures/clwx92-public-pdf-fixture.pdf');
    expect(worker).toContain(MARKER);
    expect(worker).not.toContain('skills/laptop/evidence');
    expect(worker).not.toContain('01_Ministry_Circular_ICT_Equipment_Audit.pdf');
  });

  it('parses the fixture when the bundle probe stages it under owned temp', () => withIsolatedRoots(({ env, temp }) => {
    const stagedFixture = path.join(temp, 'clwx92-public-pdf-fixture.pdf');
    fs.copyFileSync(FIXTURE, stagedFixture);

    const result = runWorker({ ...env, CLWX92_PDF_FIXTURE: stagedFixture });
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status, output).toBe(0);
    expect(output).toContain('CLWX92_VERIFY=PASS');
    expect(output).toContain(MARKER);
    expect(output).not.toContain('refused to read');
  }), 35_000);

  it('refuses a non-home non-temp fixture path even when the checkout itself is under temp', () => withIsolatedRoots(({ env, home, temp }) => {
    const realHome = os.homedir();
    const disallowedDir = fs.mkdtempSync(path.join(realHome, '.clwx92-disallowed-'));
    const disallowedFixture = path.join(disallowedDir, 'clwx92-public-pdf-fixture.pdf');
    try {
      fs.copyFileSync(FIXTURE, disallowedFixture);
      expect(path.resolve(disallowedFixture).startsWith(path.resolve(home))).toBe(false);
      expect(path.resolve(disallowedFixture).startsWith(path.resolve(temp))).toBe(false);

      const result = runWorker({ ...env, CLWX92_PDF_FIXTURE: disallowedFixture });
      const output = `${result.stdout}${result.stderr}`;

      expect(result.status).toBe(1);
      expect(output).toContain('CLWX92_VERIFY=FAIL error=refused to read');
      expect(output).toContain("only files under the user's home or tmp directory");
    } finally {
      fs.rmSync(disallowedDir, { recursive: true, force: true });
    }
  }), 35_000);

  it('cleans up the worker bundle-mode doc-tools temp copy after execution', () => withIsolatedRoots(async ({ root, env, temp }) => {
    const stagedFixture = path.join(temp, 'clwx92-public-pdf-fixture.pdf');
    fs.copyFileSync(FIXTURE, stagedFixture);
    const { bundleNm } = await createFakeOpenClawBundle(path.join(root, 'checkout'), { includeFixture: false });
    const before = new Set(fs.readdirSync(temp).filter((name) => name.startsWith('clwx92-')));

    const result = runWorker({
      ...env,
      CLWX92_BUNDLE_NM: bundleNm,
      CLWX92_PDF_FIXTURE: stagedFixture,
    });
    const output = `${result.stdout}${result.stderr}`;
    const after = fs.readdirSync(temp).filter((name) => name.startsWith('clwx92-') && !before.has(name));

    expect(result.status).toBe(0);
    expect(output).toContain('CLWX92_VERIFY=PASS');
    expect(after).toEqual([]);
  }), 35_000);

  it('runs the full bundle verifier from a fresh checkout copy by staging the repo fixture under temp', () => withIsolatedRoots(async ({ root, env }) => {
    const sandboxRoot = path.join(root, 'checkout-with-fixture');
    await createFakeOpenClawBundle(sandboxRoot, { includeFixture: true });

    const result = runVerifier(sandboxRoot, env);
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status, output).toBe(0);
    expect(output).toContain('openclaw bundle verified');
    expect(output).not.toContain('refused to read');
  }), 35_000);

  it('makes the bundle gate fail if the public fixture is missing instead of skipping CLWX-92', () => withIsolatedRoots(async ({ root, env }) => {
    const sandboxRoot = path.join(root, 'checkout-without-fixture');
    await createFakeOpenClawBundle(sandboxRoot, { includeFixture: false });

    const result = runVerifier(sandboxRoot, env);
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toContain('UTILITY-ENV(pdf): public fixture missing at');
    expect(output).toContain(path.join(sandboxRoot, 'eval', 'fixtures', 'clwx92-public-pdf-fixture.pdf'));
    expect(output).not.toContain('utility-env pdf check skipped');
    expect(output).not.toContain('01_Ministry_Circular_ICT_Equipment_Audit.pdf');
  }), 35_000);
});
