#!/usr/bin/env node
/**
 * Scoped transport child for harness-artifact.mjs.
 *
 * This exercises the staged OpenClaw plugin loader, not the ClawX mock
 * registration API, while avoiding `openclaw plugins inspect <id> --json`.
 * The CLI diagnostics command loads every discovered plugin before filtering
 * to one id; on hosted Windows that made the fast package lane timeout while
 * proving unrelated plugin inventory. This child keeps the production
 * plugin-host boundary and requests exactly the MoE plugin via onlyPluginIds.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const VERDICT_PREFIX = 'CLAWX77_TRANSPORT_VERDICT:';

function emit(verdict) {
  console.log(`${VERDICT_PREFIX}${JSON.stringify(verdict)}`);
}

function findDistChunk(distDir, label, patterns) {
  const candidates = readdirSync(distDir)
    .filter((name) => name.endsWith('.js'))
    .filter((name) => {
      const source = readFileSync(path.join(distDir, name), 'utf8');
      return patterns.every((pattern) => pattern.test(source));
    });
  if (candidates.length !== 1) {
    throw new Error(`expected exactly one staged OpenClaw ${label} chunk, found ${candidates.length}: ${candidates.join(', ') || '(none)'}`);
  }
  return path.join(distDir, candidates[0]);
}

function pickFunction(mod, names, label) {
  for (const name of names) {
    if (typeof mod[name] === 'function') return mod[name];
  }
  throw new Error(`staged OpenClaw ${label} export not found (${names.join('/')})`);
}

async function loadPluginRuntime(distDir) {
  const buildSmokeEntry = path.join(distDir, 'plugins', 'build-smoke-entry.js');
  if (existsSync(buildSmokeEntry)) {
    const smoke = await import(pathToFileURL(buildSmokeEntry).href);
    return {
      loadOpenClawPlugins: pickFunction(smoke, ['loadOpenClawPlugins'], 'loadOpenClawPlugins'),
      resolvePluginRuntimeLoadContext: pickFunction(smoke, ['resolvePluginRuntimeLoadContext'], 'resolvePluginRuntimeLoadContext'),
      buildPluginRuntimeLoadOptions: pickFunction(smoke, ['buildPluginRuntimeLoadOptions'], 'buildPluginRuntimeLoadOptions'),
    };
  }

  const loaderPath = findDistChunk(distDir, 'plugin loader', [
    /function loadOpenClawPlugins\b/,
    /loadOpenClawPlugins as \w+/,
  ]);
  const loadContextPath = findDistChunk(distDir, 'plugin load-context', [
    /function resolvePluginRuntimeLoadContext\b/,
    /function buildPluginRuntimeLoadOptions\b/,
    /resolvePluginRuntimeLoadContext as \w+/,
    /buildPluginRuntimeLoadOptions as \w+/,
  ]);

  const loader = await import(pathToFileURL(loaderPath).href);
  const loadContext = await import(pathToFileURL(loadContextPath).href);
  return {
    loadOpenClawPlugins: pickFunction(loader, ['loadOpenClawPlugins', 'r'], 'loadOpenClawPlugins'),
    resolvePluginRuntimeLoadContext: pickFunction(loadContext, ['resolvePluginRuntimeLoadContext', 'i'], 'resolvePluginRuntimeLoadContext'),
    buildPluginRuntimeLoadOptions: pickFunction(loadContext, ['buildPluginRuntimeLoadOptions', 't'], 'buildPluginRuntimeLoadOptions'),
  };
}

function buildScopedPluginPayload(registry, pluginId) {
  const plugins = Array.isArray(registry?.plugins) ? registry.plugins : [];
  if (plugins.length !== 1) {
    throw new Error(`scoped loader returned ${plugins.length} plugin(s), expected exactly 1`);
  }
  const plugin = plugins[0];
  if (plugin?.id !== pluginId) {
    throw new Error(`scoped loader returned plugin "${plugin?.id ?? 'unknown'}", expected "${pluginId}"`);
  }
  return {
    workspaceDir: registry.workspaceDir ?? null,
    plugin,
  };
}

async function main() {
  const spec = JSON.parse(process.argv[2] ?? '{}');
  const gatewayDir = path.resolve(String(spec.gatewayDir ?? ''));
  const pluginId = String(spec.pluginId ?? '');
  const workspaceDir = path.resolve(String(spec.workspaceDir ?? path.join(process.env.HOME ?? gatewayDir, '.openclaw', 'workspace')));
  if (!gatewayDir || !existsSync(gatewayDir)) throw new Error(`gatewayDir not found: ${gatewayDir}`);
  if (!pluginId) throw new Error('pluginId is required');

  const distDir = path.join(gatewayDir, 'dist');
  const {
    loadOpenClawPlugins,
    resolvePluginRuntimeLoadContext,
    buildPluginRuntimeLoadOptions,
  } = await loadPluginRuntime(distDir);

  const env = { ...process.env };
  const context = resolvePluginRuntimeLoadContext({
    env,
    workspaceDir,
  });
  const registry = await loadOpenClawPlugins(buildPluginRuntimeLoadOptions(context, {
    workspaceDir,
    env,
    onlyPluginIds: [pluginId],
    loadModules: true,
    activate: false,
    cache: false,
  }));

  emit({ ok: true, result: buildScopedPluginPayload(registry, pluginId) });
}

main().catch((err) => {
  emit({ ok: false, infra: true, message: err instanceof Error ? err.message : String(err) });
});
