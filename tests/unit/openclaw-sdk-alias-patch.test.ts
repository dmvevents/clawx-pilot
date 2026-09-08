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
  patchOpenClawSdkAlias,
  transformOpenClawSdkAliasSource,
  verifyOpenClawSdkAliasPatch,
} from '../../scripts/openclaw-sdk-alias-patch.mjs';

const ROOT = path.resolve(__dirname, '..', '..');
const ACTUAL_LOADER = path.join(ROOT, 'node_modules', 'openclaw', 'dist', 'loader-DeOtDUYt.js');
const actualSource = fs.readFileSync(ACTUAL_LOADER, 'utf8');
const tempDirs: string[] = [];

type MaterializeHelper = (distRoot: string) => void;
type TraceFs = typeof fs & { counts: { mkdirSync: number; writeFileSync: number; rmSync: number } };

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeTempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'clawx-sdk-alias-'));
  tempDirs.push(dir);
  return dir;
}

async function makeDistRoot(files: Record<string, string> = {
  'index.js': 'export const named = "ok";\nexport default { marker: "default-ok" };\n',
  'tools.js': 'export const tool = 7;\n',
}) {
  const root = await makeTempDir();
  const distRoot = path.join(root, 'dist');
  const sdkDir = path.join(distRoot, 'plugin-sdk');
  await mkdir(sdkDir, { recursive: true });
  await Promise.all(Object.entries(files).map(([name, content]) => writeFile(path.join(sdkDir, name), content, 'utf8')));
  return distRoot;
}

function extractActualHelperSource(source: string) {
  const patchedStart = source.indexOf(`// ${PATCH_MARKER}`);
  const start = patchedStart === -1 ? source.indexOf('function writeRuntimeJsonFile') : patchedStart;
  const end = source.indexOf('function remapBundledPluginRuntimePath');
  if (start === -1 || end === -1 || end <= start) throw new Error('actual loader helper block not found');
  return source.slice(start, end);
}

function loadMaterializeHelper(source: string, fsImpl: typeof fs = fs): MaterializeHelper {
  const helperSource = extractActualHelperSource(source);
  const fn = new Function('fs', 'path', `${helperSource}\nreturn ensureOpenClawPluginSdkAlias;`);
  return fn(fsImpl, path) as MaterializeHelper;
}

function makeTraceFs(): TraceFs {
  const trace = Object.create(fs) as TraceFs;
  trace.counts = { mkdirSync: 0, writeFileSync: 0, rmSync: 0 };
  trace.mkdirSync = ((...args: Parameters<typeof fs.mkdirSync>) => {
    trace.counts.mkdirSync += 1;
    return fs.mkdirSync(...args);
  }) as typeof fs.mkdirSync;
  trace.writeFileSync = ((...args: Parameters<typeof fs.writeFileSync>) => {
    trace.counts.writeFileSync += 1;
    return fs.writeFileSync(...args);
  }) as typeof fs.writeFileSync;
  trace.rmSync = ((...args: Parameters<typeof fs.rmSync>) => {
    trace.counts.rmSync += 1;
    return fs.rmSync(...args);
  }) as typeof fs.rmSync;
  return trace;
}

function aliasRoot(distRoot: string) {
  return path.join(distRoot, 'extensions', 'node_modules', 'openclaw');
}

function wrapperPath(distRoot: string, name: string) {
  return path.join(aliasRoot(distRoot), 'plugin-sdk', name);
}

describe('openclaw SDK alias materialization patch', () => {
  it('patches the pinned loader source and is idempotent', () => {
    const first = transformOpenClawSdkAliasSource(actualSource);
    const second = transformOpenClawSdkAliasSource(first.source);

    expect(first.patched).toBe(true);
    expect(first.source).toContain(PATCH_MARKER);
    expect(first.source).toContain('function writeRuntimeUtf8FileIfChanged(targetPath, content)');
    expect(first.source).toContain('if (!fs.existsSync(pluginSdkAliasDir)) fs.mkdirSync(pluginSdkAliasDir, { recursive: true });');
    expect(first.source).not.toContain('fs.writeFileSync(targetPath, [');
    expect(second.patched).toBe(false);
    expect(second.source).toBe(first.source);
  });

  it('fails closed when the pinned target snippets drift', () => {
    expect(() => transformOpenClawSdkAliasSource('function ensureOpenClawPluginSdkAlias() {}')).toThrow(/target drift/);
    expect(() => transformOpenClawSdkAliasSource(actualSource.replace('function writeRuntimeModuleWrapper', 'function writeRuntimeModuleWrapperChanged'))).toThrow(/runtime wrapper writer/);
    expect(() => transformOpenClawSdkAliasSource(actualSource.replace('fs.mkdirSync(pluginSdkAliasDir, { recursive: true });', 'fs.mkdirSync(pluginSdkAliasDir);'))).toThrow(/alias directory/);
  });

  it('fails closed when a marked patch is incomplete or still has unconditional alias writes', () => {
    const transformed = transformOpenClawSdkAliasSource(actualSource).source;

    expect(() => transformOpenClawSdkAliasSource(
      transformed.replace('function writeRuntimeUtf8FileIfChanged(targetPath, content)', 'function writeRuntimeUtf8FileIfChangedChanged(targetPath, content)'),
    )).toThrow(/patched snippets are incomplete/);

    expect(() => transformOpenClawSdkAliasSource(
      transformed.replace('writeRuntimeUtf8FileIfChanged(targetPath, [', 'fs.writeFileSync(targetPath, ['),
    )).toThrow(/patched snippets are incomplete|unconditional alias writes/);
  });

  it('proves the actual pinned helper rewrites unchanged aliases while the patch performs no second-pass mkdir or write', async () => {
    const baselineDistRoot = await makeDistRoot();
    const baselineTrace = makeTraceFs();
    const baselineHelper = loadMaterializeHelper(actualSource, baselineTrace);

    baselineHelper(baselineDistRoot);
    baselineTrace.counts.mkdirSync = 0;
    baselineTrace.counts.writeFileSync = 0;
    baselineHelper(baselineDistRoot);

    expect(baselineTrace.counts.mkdirSync).toBeGreaterThan(0);
    expect(baselineTrace.counts.writeFileSync).toBeGreaterThan(0);

    const patchedDistRoot = await makeDistRoot();
    const patchedTrace = makeTraceFs();
    const patchedHelper = loadMaterializeHelper(transformOpenClawSdkAliasSource(actualSource).source, patchedTrace);

    patchedHelper(patchedDistRoot);
    patchedTrace.counts.mkdirSync = 0;
    patchedTrace.counts.writeFileSync = 0;
    patchedHelper(patchedDistRoot);

    expect(patchedTrace.counts.mkdirSync).toBe(0);
    expect(patchedTrace.counts.writeFileSync).toBe(0);
  });

  it('regenerates missing package files, stale wrappers, non-directory alias targets and default-export wrapper changes', async () => {
    const distRoot = await makeDistRoot({
      'index.js': 'export const named = "ok";\n',
      'tools.js': 'export const tool = 7;\n',
    });
    const trace = makeTraceFs();
    const helper = loadMaterializeHelper(transformOpenClawSdkAliasSource(actualSource).source, trace);

    helper(distRoot);
    const initialToolsWrapper = fs.readFileSync(wrapperPath(distRoot, 'tools.js'), 'utf8');
    expect(initialToolsWrapper).toContain('import * as module from "../../../../plugin-sdk/tools.js";');

    fs.rmSync(path.join(aliasRoot(distRoot), 'package.json'));
    fs.writeFileSync(wrapperPath(distRoot, 'index.js'), 'stale wrapper', 'utf8');
    trace.counts.mkdirSync = 0;
    trace.counts.writeFileSync = 0;
    helper(distRoot);

    expect(fs.readFileSync(path.join(aliasRoot(distRoot), 'package.json'), 'utf8')).toContain('"./plugin-sdk": "./plugin-sdk/index.js"');
    expect(fs.readFileSync(wrapperPath(distRoot, 'index.js'), 'utf8')).not.toBe('stale wrapper');
    expect(trace.counts.writeFileSync).toBe(2);

    fs.writeFileSync(path.join(distRoot, 'plugin-sdk', 'tools.js'), 'export const tool = 8;\nexport default { tool };\n', 'utf8');
    helper(distRoot);
    expect(fs.readFileSync(wrapperPath(distRoot, 'tools.js'), 'utf8')).toContain('import defaultModule from "../../../../plugin-sdk/tools.js";');

    fs.rmSync(path.join(aliasRoot(distRoot), 'plugin-sdk'), { recursive: true, force: true });
    fs.writeFileSync(path.join(aliasRoot(distRoot), 'plugin-sdk'), 'not a directory', 'utf8');
    trace.counts.rmSync = 0;
    helper(distRoot);
    expect(trace.counts.rmSync).toBe(1);
    expect(fs.statSync(path.join(aliasRoot(distRoot), 'plugin-sdk')).isDirectory()).toBe(true);
  });

  it('preserves named and default module wrapper imports', async () => {
    const distRoot = await makeDistRoot({
      'index.js': 'export const named = "ok";\nexport default { marker: "default-ok" };\n',
      'tools.js': 'export const tool = 7;\n',
    });
    const helper = loadMaterializeHelper(transformOpenClawSdkAliasSource(actualSource).source);
    helper(distRoot);

    const indexModule = await import(`${pathToFileURL(wrapperPath(distRoot, 'index.js')).href}?index=${Date.now()}`) as {
      default: { marker: string };
      named: string;
    };
    const toolsModule = await import(`${pathToFileURL(wrapperPath(distRoot, 'tools.js')).href}?tools=${Date.now()}`) as {
      default: { tool: number };
      tool: number;
    };

    expect(indexModule.named).toBe('ok');
    expect(indexModule.default.marker).toBe('default-ok');
    expect(toolsModule.tool).toBe(7);
    expect(toolsModule.default.tool).toBe(7);
  });

  it('patches loader chunks in an OpenClaw bundle and verifies fail-closed idempotence', async () => {
    const dir = await makeTempDir();
    const openclawDir = path.join(dir, 'openclaw');
    const distDir = path.join(openclawDir, 'dist');
    await mkdir(distDir, { recursive: true });
    await writeFile(path.join(openclawDir, 'package.json'), JSON.stringify({ version: TARGET_OPENCLAW_VERSION }), 'utf8');
    await copyFile(ACTUAL_LOADER, path.join(distDir, 'loader-test.js'));
    await writeFile(path.join(distDir, 'loader-unrelated.js'), 'export const unrelated = true;\n', 'utf8');

    expect(() => verifyOpenClawSdkAliasPatch(openclawDir)).toThrow(/patch marker missing/);
    const result = patchOpenClawSdkAlias(openclawDir);
    verifyOpenClawSdkAliasPatch(openclawDir);

    expect(result.targets.map((target) => path.basename(target))).toEqual(['loader-test.js']);
    expect(result.patched).toBe(true);
    expect(fs.readFileSync(path.join(distDir, 'loader-test.js'), 'utf8')).toContain(PATCH_MARKER);
    expect(fs.readFileSync(path.join(distDir, 'loader-unrelated.js'), 'utf8')).not.toContain(PATCH_MARKER);
    expect(patchOpenClawSdkAlias(openclawDir).patched).toBe(false);
  });
});
