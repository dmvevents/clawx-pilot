#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TARGET_OPENCLAW_VERSION = '2026.4.23';
export const PATCH_MARKER = 'CLWX pricing cache candidate-gated normalization patch';

const ORIGINAL_PROVIDER_CANONICALIZER = `function canonicalizeOpenRouterProvider(provider) {
	const normalized = normalizeModelRef(provider, "placeholder").provider;
	return PROVIDER_ALIAS_TO_OPENROUTER[normalized] ?? normalized;
}`;

const PATCHED_PROVIDER_CANONICALIZER = `function canonicalizeOpenRouterProvider(provider) {
	const normalized = normalizeProviderId(provider);
	return PROVIDER_ALIAS_TO_OPENROUTER[normalized] ?? normalized;
}`;

const ORIGINAL_NORMALIZED_CATALOG_BUILD = `		const catalogByNormalizedId = /* @__PURE__ */ new Map();
		for (const entry of catalogById.values()) {
			const normalizedId = canonicalizeOpenRouterLookupId(entry.id);
			if (!normalizedId || catalogByNormalizedId.has(normalizedId)) continue;
			catalogByNormalizedId.set(normalizedId, entry);
		}`;

const PATCHED_HELPERS = `// ${PATCH_MARKER}
function buildOpenRouterPricingLookupCandidates(refs) {
	const exactIds = /* @__PURE__ */ new Set();
	const providerPrefixes = /* @__PURE__ */ new Set();
	const normalizedIds = /* @__PURE__ */ new Set();
	for (const ref of refs) {
		for (const candidate of buildOpenRouterExactCandidates(ref)) {
			if (!candidate) continue;
			exactIds.add(candidate);
			const slash = candidate.indexOf("/");
			const provider = slash === -1 ? candidate : candidate.slice(0, slash);
			const canonicalProvider = canonicalizeOpenRouterProvider(provider);
			if (canonicalProvider) providerPrefixes.add(canonicalProvider + "/");
			const normalized = canonicalizeOpenRouterLookupId(candidate);
			if (normalized) normalizedIds.add(normalized);
		}
	}
	return { exactIds, providerPrefixes, normalizedIds };
}
function shouldNormalizeOpenRouterCatalogEntry(id, candidates) {
	const trimmed = id.trim();
	if (!trimmed) return false;
	if (candidates.exactIds.has(trimmed)) return true;
	const slash = trimmed.indexOf("/");
	if (slash === -1) return candidates.providerPrefixes.has(canonicalizeOpenRouterProvider(trimmed) + "/");
	const provider = canonicalizeOpenRouterProvider(trimmed.slice(0, slash));
	return provider ? candidates.providerPrefixes.has(provider + "/") : false;
}`;

const PATCHED_NORMALIZED_CATALOG_BUILD = `		const catalogByNormalizedId = /* @__PURE__ */ new Map();
		const openRouterLookupCandidates = buildOpenRouterPricingLookupCandidates(refs);
		for (const entry of catalogById.values()) {
			if (!shouldNormalizeOpenRouterCatalogEntry(entry.id, openRouterLookupCandidates)) continue;
			const normalizedId = canonicalizeOpenRouterLookupId(entry.id);
			if (!normalizedId || !openRouterLookupCandidates.normalizedIds.has(normalizedId) || catalogByNormalizedId.has(normalizedId)) continue;
			catalogByNormalizedId.set(normalizedId, entry);
		}`;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function resolveOpenClawPackageDir(openclawDir = path.join(ROOT, 'build', 'openclaw')) {
  return openclawDir;
}

function listUsageFormatFiles(openclawDir = path.join(ROOT, 'build', 'openclaw')) {
  const distDir = path.join(resolveOpenClawPackageDir(openclawDir), 'dist');
  if (!fs.existsSync(distDir)) return [];
  return fs.readdirSync(distDir)
    .filter((name) => /^usage-format-.*\.js$/.test(name))
    .sort()
    .map((name) => path.join(distDir, name));
}

function isPricingBootstrapSource(source) {
  return source.includes('async function refreshGatewayModelPricingCache')
    || source.includes(ORIGINAL_NORMALIZED_CATALOG_BUILD)
    || source.includes(PATCH_MARKER);
}

export function findUsageFormatFiles(openclawDir = path.join(ROOT, 'build', 'openclaw')) {
  return listUsageFormatFiles(openclawDir).filter((file) => isPricingBootstrapSource(fs.readFileSync(file, 'utf8')));
}

export function findUsageFormatFile(openclawDir = path.join(ROOT, 'build', 'openclaw')) {
  const candidates = findUsageFormatFiles(openclawDir);
  if (candidates.length !== 1) {
    throw new Error(`Expected exactly one pricing bootstrap usage-format bundle file under ${openclawDir}, found ${candidates.length}`);
  }
  return candidates[0];
}

export function assertSupportedOpenClawVersion(openclawDir = path.join(ROOT, 'build', 'openclaw')) {
  const pkgPath = path.join(resolveOpenClawPackageDir(openclawDir), 'package.json');
  const version = readJson(pkgPath).version;
  if (version !== TARGET_OPENCLAW_VERSION) {
    throw new Error(`OpenClaw pricing patch targets ${TARGET_OPENCLAW_VERSION}, found ${version}`);
  }
}

export function transformOpenClawPricingCacheSource(source) {
  if (source.includes(PATCH_MARKER)) {
    if (!source.includes(PATCHED_PROVIDER_CANONICALIZER) || !source.includes(PATCHED_HELPERS) || !source.includes(PATCHED_NORMALIZED_CATALOG_BUILD)) {
      throw new Error('OpenClaw pricing patch marker found but patched snippets are incomplete');
    }
    return { source, patched: false };
  }

  if (!source.includes(ORIGINAL_PROVIDER_CANONICALIZER)) {
    throw new Error('OpenClaw pricing patch target drift: provider canonicalizer snippet not found');
  }
  if (!source.includes(ORIGINAL_NORMALIZED_CATALOG_BUILD)) {
    throw new Error('OpenClaw pricing patch target drift: normalized catalog build snippet not found');
  }

  const withProviderPatch = source.replace(ORIGINAL_PROVIDER_CANONICALIZER, PATCHED_PROVIDER_CANONICALIZER);
  const helperAnchor = 'function resolveCatalogPricingForRef(params) {';
  if (!withProviderPatch.includes(helperAnchor)) {
    throw new Error('OpenClaw pricing patch target drift: catalog resolver anchor not found');
  }
  const withHelpers = withProviderPatch.replace(helperAnchor, `${PATCHED_HELPERS}\n${helperAnchor}`);
  const patched = withHelpers.replace(ORIGINAL_NORMALIZED_CATALOG_BUILD, PATCHED_NORMALIZED_CATALOG_BUILD);
  return { source: patched, patched: patched !== source };
}

export function patchOpenClawPricingCache(openclawDir = path.join(ROOT, 'build', 'openclaw')) {
  assertSupportedOpenClawVersion(openclawDir);
  const targets = findUsageFormatFiles(openclawDir);
  if (targets.length === 0) throw new Error(`OpenClaw pricing bootstrap usage-format bundle file not found under ${openclawDir}`);
  let patched = false;
  for (const target of targets) {
    const current = fs.readFileSync(target, 'utf8');
    const result = transformOpenClawPricingCacheSource(current);
    if (result.patched) {
      fs.writeFileSync(target, result.source, 'utf8');
      patched = true;
    }
  }
  return { target: targets[0], targets, patched };
}

export function verifyOpenClawPricingCachePatch(openclawDir = path.join(ROOT, 'build', 'openclaw')) {
  assertSupportedOpenClawVersion(openclawDir);
  const targets = findUsageFormatFiles(openclawDir);
  if (targets.length === 0) throw new Error(`OpenClaw pricing bootstrap usage-format bundle file not found under ${openclawDir}`);
  for (const target of targets) {
    const current = fs.readFileSync(target, 'utf8');
    if (!current.includes(PATCH_MARKER)) {
      throw new Error(`OpenClaw pricing patch marker missing in ${path.basename(target)}`);
    }
    transformOpenClawPricingCacheSource(current);
  }
  return { target: targets[0], targets };
}

const invokedAsScript = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (invokedAsScript) {
  try {
    const openclawDir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, 'build', 'openclaw');
    const result = patchOpenClawPricingCache(openclawDir);
    console.log(`${result.patched ? 'patched' : 'already patched'} ${result.targets.map((target) => path.relative(ROOT, target)).join(', ')}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
