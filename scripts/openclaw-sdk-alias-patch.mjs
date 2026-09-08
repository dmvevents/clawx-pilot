#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TARGET_OPENCLAW_VERSION = '2026.4.23';
export const PATCH_MARKER = 'CLWX SDK alias idempotent materialization patch';

const ORIGINAL_JSON_HELPER = `function writeRuntimeJsonFile(targetPath, value) {
	fs.mkdirSync(path.dirname(targetPath), { recursive: true });
	fs.writeFileSync(targetPath, \`${'${JSON.stringify(value, null, 2)}'}\\n\`, "utf8");
}`;

const PATCHED_WRITE_HELPERS = `// ${PATCH_MARKER}
function readRuntimeUtf8FileIfExists(targetPath) {
	try {
		return fs.readFileSync(targetPath, "utf8");
	} catch (error) {
		if (error && typeof error === "object" && error.code === "ENOENT") return undefined;
		throw error;
	}
}
function writeRuntimeUtf8FileIfChanged(targetPath, content) {
	if (readRuntimeUtf8FileIfExists(targetPath) === content) return false;
	fs.mkdirSync(path.dirname(targetPath), { recursive: true });
	fs.writeFileSync(targetPath, content, "utf8");
	return true;
}
function writeRuntimeJsonFile(targetPath, value) {
	writeRuntimeUtf8FileIfChanged(targetPath, \`${'${JSON.stringify(value, null, 2)}'}\\n\`);
}`;

const ORIGINAL_WRAPPER_FUNCTION = `function writeRuntimeModuleWrapper(sourcePath, targetPath) {
	const specifier = path.relative(path.dirname(targetPath), sourcePath).replaceAll(path.sep, "/");
	const normalizedSpecifier = specifier.startsWith(".") ? specifier : \`./${'${specifier}'}\`;
	const defaultForwarder = hasRuntimeDefaultExport(sourcePath) ? [
		\`import defaultModule from ${'${JSON.stringify(normalizedSpecifier)}'};\`,
		\`let defaultExport = defaultModule;\`,
		\`for (let index = 0; index < 4 && defaultExport && typeof defaultExport === "object" && "default" in defaultExport; index += 1) {\`,
		\`  defaultExport = defaultExport.default;\`,
		\`}\`
	] : [
		\`import * as module from ${'${JSON.stringify(normalizedSpecifier)}'};\`,
		\`let defaultExport = "default" in module ? module.default : module;\`,
		\`for (let index = 0; index < 4 && defaultExport && typeof defaultExport === "object" && "default" in defaultExport; index += 1) {\`,
		\`  defaultExport = defaultExport.default;\`,
		\`}\`
	];
	fs.mkdirSync(path.dirname(targetPath), { recursive: true });
	fs.writeFileSync(targetPath, [
		\`export * from ${'${JSON.stringify(normalizedSpecifier)}'};\`,
		...defaultForwarder,
		"export { defaultExport as default };",
		""
	].join("\\n"), "utf8");
}`;

const PATCHED_WRAPPER_FUNCTION = `function writeRuntimeModuleWrapper(sourcePath, targetPath) {
	const specifier = path.relative(path.dirname(targetPath), sourcePath).replaceAll(path.sep, "/");
	const normalizedSpecifier = specifier.startsWith(".") ? specifier : \`./${'${specifier}'}\`;
	const defaultForwarder = hasRuntimeDefaultExport(sourcePath) ? [
		\`import defaultModule from ${'${JSON.stringify(normalizedSpecifier)}'};\`,
		\`let defaultExport = defaultModule;\`,
		\`for (let index = 0; index < 4 && defaultExport && typeof defaultExport === "object" && "default" in defaultExport; index += 1) {\`,
		\`  defaultExport = defaultExport.default;\`,
		\`}\`
	] : [
		\`import * as module from ${'${JSON.stringify(normalizedSpecifier)}'};\`,
		\`let defaultExport = "default" in module ? module.default : module;\`,
		\`for (let index = 0; index < 4 && defaultExport && typeof defaultExport === "object" && "default" in defaultExport; index += 1) {\`,
		\`  defaultExport = defaultExport.default;\`,
		\`}\`
	];
	writeRuntimeUtf8FileIfChanged(targetPath, [
		\`export * from ${'${JSON.stringify(normalizedSpecifier)}'};\`,
		...defaultForwarder,
		"export { defaultExport as default };",
		""
	].join("\\n"));
}`;

const ORIGINAL_ALIAS_DIR_BLOCK = `	try {
		if (fs.existsSync(pluginSdkAliasDir) && !fs.lstatSync(pluginSdkAliasDir).isDirectory()) fs.rmSync(pluginSdkAliasDir, {
			recursive: true,
			force: true
		});
	} catch {}
	fs.mkdirSync(pluginSdkAliasDir, { recursive: true });`;

const PATCHED_ALIAS_DIR_BLOCK = `	try {
		if (fs.existsSync(pluginSdkAliasDir) && !fs.lstatSync(pluginSdkAliasDir).isDirectory()) fs.rmSync(pluginSdkAliasDir, {
			recursive: true,
			force: true
		});
	} catch {}
	if (!fs.existsSync(pluginSdkAliasDir)) fs.mkdirSync(pluginSdkAliasDir, { recursive: true });`;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function resolveOpenClawPackageDir(openclawDir = path.join(ROOT, 'build', 'openclaw')) {
  return openclawDir;
}

function listLoaderFiles(openclawDir = path.join(ROOT, 'build', 'openclaw')) {
  const distDir = path.join(resolveOpenClawPackageDir(openclawDir), 'dist');
  if (!fs.existsSync(distDir)) return [];
  return fs.readdirSync(distDir)
    .filter((name) => /^loader-.*\.js$/.test(name))
    .sort()
    .map((name) => path.join(distDir, name));
}

function isSdkAliasSource(source) {
  return source.includes('function ensureOpenClawPluginSdkAlias')
    || source.includes(ORIGINAL_WRAPPER_FUNCTION)
    || source.includes(PATCH_MARKER);
}

export function findSdkAliasLoaderFiles(openclawDir = path.join(ROOT, 'build', 'openclaw')) {
  return listLoaderFiles(openclawDir).filter((file) => isSdkAliasSource(fs.readFileSync(file, 'utf8')));
}

export function assertSupportedOpenClawVersion(openclawDir = path.join(ROOT, 'build', 'openclaw')) {
  const pkgPath = path.join(resolveOpenClawPackageDir(openclawDir), 'package.json');
  const version = readJson(pkgPath).version;
  if (version !== TARGET_OPENCLAW_VERSION) {
    throw new Error(`OpenClaw SDK alias patch targets ${TARGET_OPENCLAW_VERSION}, found ${version}`);
  }
}

export function transformOpenClawSdkAliasSource(source) {
  if (source.includes(PATCH_MARKER)) {
    if (!source.includes(PATCHED_WRITE_HELPERS) || !source.includes(PATCHED_WRAPPER_FUNCTION) || !source.includes(PATCHED_ALIAS_DIR_BLOCK)) {
      throw new Error('OpenClaw SDK alias patch marker found but patched snippets are incomplete');
    }
    if (source.includes(ORIGINAL_JSON_HELPER) || source.includes(ORIGINAL_WRAPPER_FUNCTION) || source.includes('\tfs.mkdirSync(pluginSdkAliasDir, { recursive: true });')) {
      throw new Error('OpenClaw SDK alias patch marker found but unconditional alias writes remain');
    }
    return { source, patched: false };
  }

  if (!source.includes(ORIGINAL_JSON_HELPER)) {
    throw new Error('OpenClaw SDK alias patch target drift: runtime JSON writer snippet not found');
  }
  if (!source.includes(ORIGINAL_WRAPPER_FUNCTION)) {
    throw new Error('OpenClaw SDK alias patch target drift: runtime wrapper writer snippet not found');
  }
  if (!source.includes(ORIGINAL_ALIAS_DIR_BLOCK)) {
    throw new Error('OpenClaw SDK alias patch target drift: alias directory snippet not found');
  }

  const withWriteHelper = source.replace(ORIGINAL_JSON_HELPER, PATCHED_WRITE_HELPERS);
  const withWrapper = withWriteHelper.replace(ORIGINAL_WRAPPER_FUNCTION, PATCHED_WRAPPER_FUNCTION);
  const patched = withWrapper.replace(ORIGINAL_ALIAS_DIR_BLOCK, PATCHED_ALIAS_DIR_BLOCK);
  return { source: patched, patched: patched !== source };
}

export function patchOpenClawSdkAlias(openclawDir = path.join(ROOT, 'build', 'openclaw')) {
  assertSupportedOpenClawVersion(openclawDir);
  const targets = findSdkAliasLoaderFiles(openclawDir);
  if (targets.length === 0) throw new Error(`OpenClaw SDK alias loader bundle file not found under ${openclawDir}`);
  let patched = false;
  for (const target of targets) {
    const current = fs.readFileSync(target, 'utf8');
    const result = transformOpenClawSdkAliasSource(current);
    if (result.patched) {
      fs.writeFileSync(target, result.source, 'utf8');
      patched = true;
    }
  }
  return { target: targets[0], targets, patched };
}

export function verifyOpenClawSdkAliasPatch(openclawDir = path.join(ROOT, 'build', 'openclaw')) {
  assertSupportedOpenClawVersion(openclawDir);
  const targets = findSdkAliasLoaderFiles(openclawDir);
  if (targets.length === 0) throw new Error(`OpenClaw SDK alias loader bundle file not found under ${openclawDir}`);
  for (const target of targets) {
    const current = fs.readFileSync(target, 'utf8');
    if (!current.includes(PATCH_MARKER)) {
      throw new Error(`OpenClaw SDK alias patch marker missing in ${path.basename(target)}`);
    }
    transformOpenClawSdkAliasSource(current);
  }
  return { target: targets[0], targets };
}

const invokedAsScript = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (invokedAsScript) {
  try {
    const openclawDir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, 'build', 'openclaw');
    const result = patchOpenClawSdkAlias(openclawDir);
    console.log(`${result.patched ? 'patched' : 'already patched'} ${result.targets.map((target) => path.relative(ROOT, target)).join(', ')}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
