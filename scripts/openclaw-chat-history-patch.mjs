#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TARGET_OPENCLAW_VERSION = '2026.4.23';
export const PATCH_MARKER = 'CLWX chat.history nonblocking thinking default patch';

const ORIGINAL_THINKING_DEFAULT_BLOCK = `		let thinkingLevel = entry?.thinkingLevel;
		if (!thinkingLevel) {
			const catalog = await context.loadGatewayModelCatalog();
			thinkingLevel = resolveThinkingDefault({
				cfg,
				provider: resolvedSessionModel.provider,
				model: resolvedSessionModel.model,
				catalog
			});
		}`;

const PATCHED_HELPER = `// ${PATCH_MARKER}
function resolveChatHistoryThinkingLevelWithoutCatalog(params) {
	const persisted = params.entry?.thinkingLevel;
	if (persisted) return persisted;
	return resolveThinkingDefault({
		cfg: params.cfg,
		provider: params.provider,
		model: params.model,
		catalog: []
	});
}`;

const PATCHED_THINKING_DEFAULT_BLOCK = `		const thinkingLevel = resolveChatHistoryThinkingLevelWithoutCatalog({
			cfg,
			entry,
			provider: resolvedSessionModel.provider,
			model: resolvedSessionModel.model
		});`;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function resolveOpenClawPackageDir(openclawDir = path.join(ROOT, 'build', 'openclaw')) {
  return openclawDir;
}

function listChatFiles(openclawDir = path.join(ROOT, 'build', 'openclaw')) {
  const distDir = path.join(resolveOpenClawPackageDir(openclawDir), 'dist');
  if (!fs.existsSync(distDir)) return [];
  return fs.readdirSync(distDir)
    .filter((name) => /^chat-.*\.js$/.test(name))
    .sort()
    .map((name) => path.join(distDir, name));
}

function isChatHistorySource(source) {
  return source.includes('"chat.history": async')
    || source.includes(ORIGINAL_THINKING_DEFAULT_BLOCK)
    || source.includes(PATCH_MARKER);
}

export function findChatHistoryFiles(openclawDir = path.join(ROOT, 'build', 'openclaw')) {
  return listChatFiles(openclawDir).filter((file) => isChatHistorySource(fs.readFileSync(file, 'utf8')));
}

export function assertSupportedOpenClawVersion(openclawDir = path.join(ROOT, 'build', 'openclaw')) {
  const pkgPath = path.join(resolveOpenClawPackageDir(openclawDir), 'package.json');
  const version = readJson(pkgPath).version;
  if (version !== TARGET_OPENCLAW_VERSION) {
    throw new Error(`OpenClaw chat.history patch targets ${TARGET_OPENCLAW_VERSION}, found ${version}`);
  }
}

export function transformOpenClawChatHistorySource(source) {
  if (source.includes(PATCH_MARKER)) {
    if (!source.includes(PATCHED_HELPER) || !source.includes(PATCHED_THINKING_DEFAULT_BLOCK)) {
      throw new Error('OpenClaw chat.history patch marker found but patched snippets are incomplete');
    }
    if (source.includes('const catalog = await context.loadGatewayModelCatalog();')) {
      throw new Error('OpenClaw chat.history patch marker found but blocking catalog await remains');
    }
    return { source, patched: false };
  }

  if (!source.includes(ORIGINAL_THINKING_DEFAULT_BLOCK)) {
    throw new Error('OpenClaw chat.history patch target drift: thinking default snippet not found');
  }

  const helperAnchor = 'const chatHandlers = {';
  if (!source.includes(helperAnchor)) {
    throw new Error('OpenClaw chat.history patch target drift: chatHandlers anchor not found');
  }

  const withHelper = source.replace(helperAnchor, `${PATCHED_HELPER}\n${helperAnchor}`);
  const patched = withHelper.replace(ORIGINAL_THINKING_DEFAULT_BLOCK, PATCHED_THINKING_DEFAULT_BLOCK);
  return { source: patched, patched: patched !== source };
}

export function patchOpenClawChatHistory(openclawDir = path.join(ROOT, 'build', 'openclaw')) {
  assertSupportedOpenClawVersion(openclawDir);
  const targets = findChatHistoryFiles(openclawDir);
  if (targets.length === 0) throw new Error(`OpenClaw chat.history bundle file not found under ${openclawDir}`);
  let patched = false;
  for (const target of targets) {
    const current = fs.readFileSync(target, 'utf8');
    const result = transformOpenClawChatHistorySource(current);
    if (result.patched) {
      fs.writeFileSync(target, result.source, 'utf8');
      patched = true;
    }
  }
  return { target: targets[0], targets, patched };
}

export function verifyOpenClawChatHistoryPatch(openclawDir = path.join(ROOT, 'build', 'openclaw')) {
  assertSupportedOpenClawVersion(openclawDir);
  const targets = findChatHistoryFiles(openclawDir);
  if (targets.length === 0) throw new Error(`OpenClaw chat.history bundle file not found under ${openclawDir}`);
  for (const target of targets) {
    const current = fs.readFileSync(target, 'utf8');
    if (!current.includes(PATCH_MARKER)) {
      throw new Error(`OpenClaw chat.history patch marker missing in ${path.basename(target)}`);
    }
    transformOpenClawChatHistorySource(current);
  }
  return { target: targets[0], targets };
}

const invokedAsScript = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (invokedAsScript) {
  try {
    const openclawDir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, 'build', 'openclaw');
    const result = patchOpenClawChatHistory(openclawDir);
    console.log(`${result.patched ? 'patched' : 'already patched'} ${result.targets.map((target) => path.relative(ROOT, target)).join(', ')}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
