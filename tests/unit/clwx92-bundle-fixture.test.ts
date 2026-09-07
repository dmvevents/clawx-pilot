import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
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
  for (const dir of ['scripts', 'extensions/moe-principal-assistant']) {
    fs.mkdirSync(path.join(destinationRoot, dir), { recursive: true });
  }
  for (const file of [
    'scripts/verify-openclaw-bundle.mjs',
    'scripts/clwx92-workerenv-check.mjs',
    'scripts/openclaw-bundle-config.mjs',
    'scripts/openclaw-pricing-cache-patch.mjs',
    'extensions/moe-principal-assistant/doc-tools.mjs',
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
  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(path.join(openclawRoot, 'package.json'), JSON.stringify({ version: '2026.4.23' }), 'utf8');
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(openclawRoot, 'node_modules'), 'junction');

  const { transformOpenClawPricingCacheSource } = await import(pathToFileURL(path.join(ROOT, 'scripts', 'openclaw-pricing-cache-patch.mjs')).href);
  const source = `function canonicalizeOpenRouterProvider(provider) {
\tconst normalized = normalizeModelRef(provider, "placeholder").provider;
\treturn PROVIDER_ALIAS_TO_OPENROUTER[normalized] ?? normalized;
}
function resolveCatalogPricingForRef(params) {
\treturn params;
}
function refreshGatewayModelPricingCache() {
\t\tconst catalogByNormalizedId = /* @__PURE__ */ new Map();
\t\tfor (const entry of catalogById.values()) {
\t\t\tconst normalizedId = canonicalizeOpenRouterLookupId(entry.id);
\t\t\tif (!normalizedId || catalogByNormalizedId.has(normalizedId)) continue;
\t\t\tcatalogByNormalizedId.set(normalizedId, entry);
\t\t}
}
`;
  fs.writeFileSync(path.join(distDir, 'usage-format-test.js'), transformOpenClawPricingCacheSource(source).source, 'utf8');
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

    expect(result.status).toBe(0);
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

    expect(result.status).toBe(0);
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
