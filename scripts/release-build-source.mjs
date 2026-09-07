#!/usr/bin/env node
/**
 * CLWX-106 build source context.
 *
 * Packaging records the source revision before compilation starts. The
 * electron-builder wrapper verifies the same context before and after the
 * builder runs, then hands that explicit context to release-hash-manifest.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BUILD_SOURCE_SCHEMA_VERSION = 1;
export const BUILD_OUTPUT_RECEIPT_SCHEMA_VERSION = 1;
export const BUILD_SOURCE_FILE = path.join(ROOT, '.release-build-source.json');
export const BUILD_OUTPUT_RECEIPT_FILE = path.join(ROOT, '.tmp', 'release-build-output.json');
const BUILD_OUTPUT_DIRS = ['dist', 'dist-electron'];
const BUILD_OUTPUT_ENTRYPOINTS = ['dist/index.html', 'dist-electron/main/index.js'];
// Generated release evidence may be written after the source context is
// recorded. It is intentionally excluded from the source digest; product source,
// tests, scripts and configs remain included.
const SOURCE_STATUS_EXCLUDED_PREFIXES = ['docs/evidence/', 'docs/release-manifests/'];

function runGit(root, args) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new Error(`git ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`);
  }
  return result.stdout;
}

function normalizeRepoPath(value) {
  return value.split(path.sep).join('/');
}

function shouldExcludeSourceStatusPath(repoPath) {
  return SOURCE_STATUS_EXCLUDED_PREFIXES.some((prefix) => repoPath === prefix.slice(0, -1) || repoPath.startsWith(prefix));
}

function parseStatusEntries(statusPorcelain) {
  const records = statusPorcelain.split('\0').filter(Boolean);
  const entries = [];
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    const status = record.slice(0, 2);
    const firstPath = record.slice(3);
    const paths = [firstPath];
    if ((status[0] === 'R' || status[0] === 'C') && records[i + 1]) paths.push(records[(i += 1)]);
    const normalizedPaths = paths.map(normalizeRepoPath).filter((repoPath) => repoPath && !shouldExcludeSourceStatusPath(repoPath));
    if (normalizedPaths.length > 0) entries.push({ status, paths: normalizedPaths });
  }
  return entries;
}

function hashPathBytes(root, repoPath) {
  const absolute = path.join(root, repoPath);
  if (!existsSync(absolute)) return 'missing';
  const stat = lstatSync(absolute);
  if (!stat.isFile()) return `${stat.isDirectory() ? 'directory' : 'non-file'}:${stat.size}`;
  return createHash('sha256').update(readFileSync(absolute)).digest('hex');
}

function sourceStatusHash(root, statusPorcelain) {
  const entries = parseStatusEntries(statusPorcelain);
  if (entries.length === 0) return { gitDirty: false, gitStatusHash: null };
  const hash = createHash('sha256');
  for (const entry of entries) {
    hash.update(`${entry.status}\n`);
    for (const repoPath of entry.paths) {
      hash.update(`${repoPath}\n${hashPathBytes(root, repoPath)}\n`);
    }
  }
  return { gitDirty: true, gitStatusHash: hash.digest('hex') };
}

function rootFromOptions(options) {
  if (typeof options === 'string') return options;
  return options?.root ?? ROOT;
}

export function readCurrentSource(options = {}) {
  const root = rootFromOptions(options);
  const gitCommit = runGit(root, ['rev-parse', 'HEAD']).trim();
  if (!/^[0-9a-f]{40}$/i.test(gitCommit)) throw new Error(`invalid git commit: ${gitCommit}`);
  const statusPorcelain = runGit(root, ['status', '--porcelain=v1', '--untracked-files=all', '-z']);
  const { gitDirty, gitStatusHash } = sourceStatusHash(root, statusPorcelain);
  return {
    schemaVersion: BUILD_SOURCE_SCHEMA_VERSION,
    gitCommit,
    gitDirty,
    gitStatusHash,
  };
}

function normalizeTimestamp(value, label, nowMs = Date.now()) {
  if (typeof value !== 'string') throw new Error(`build source context is missing ${label}`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`build source context has invalid ${label}`);
  if (parsed > nowMs) throw new Error(`build source context ${label} is in the future`);
  return value;
}

export function recordBuildSource({
  root = ROOT,
  outputPath = path.join(root, '.release-build-source.json'),
  now = () => new Date().toISOString(),
} = {}) {
  const builtAt = normalizeTimestamp(now(), 'builtAt');
  const source = { ...readCurrentSource({ root }), builtAt, recordedAt: builtAt };
  mkdirSync(path.dirname(outputPath), { recursive: true });
  const tmp = `${outputPath}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(source, null, 2)}\n`);
  renameSync(tmp, outputPath);
  return source;
}

export function readRecordedBuildSource({ sourcePath = BUILD_SOURCE_FILE, nowMs = Date.now() } = {}) {
  if (!existsSync(sourcePath)) throw new Error(`build source context is missing: ${sourcePath}`);
  const source = JSON.parse(readFileSync(sourcePath, 'utf8'));
  if (source?.schemaVersion !== BUILD_SOURCE_SCHEMA_VERSION) {
    throw new Error(`unsupported build source schema: ${source?.schemaVersion ?? '(missing)'}`);
  }
  if (!/^[0-9a-f]{40}$/i.test(String(source.gitCommit ?? ''))) {
    throw new Error('build source context is missing gitCommit');
  }
  if (typeof source.gitDirty !== 'boolean') throw new Error('build source context is missing gitDirty');
  if (source.gitStatusHash !== null && !/^[0-9a-f]{64}$/i.test(String(source.gitStatusHash ?? ''))) {
    throw new Error('build source context has invalid gitStatusHash');
  }
  if (typeof source.builtAt !== 'string' && typeof source.recordedAt !== 'string') throw new Error('build source context is missing builtAt');
  if (typeof source.builtAt !== 'string') source.builtAt = source.recordedAt;
  if (typeof source.recordedAt !== 'string') source.recordedAt = source.builtAt;
  source.builtAt = normalizeTimestamp(source.builtAt, 'builtAt', nowMs);
  source.recordedAt = normalizeTimestamp(source.recordedAt, 'recordedAt', nowMs);
  return source;
}

export function assertSameSourceState(recorded, { root = ROOT, label = 'source' } = {}) {
  const current = readCurrentSource({ root });
  const mismatches = [];
  for (const key of ['gitCommit', 'gitDirty', 'gitStatusHash']) {
    if (recorded[key] !== current[key]) mismatches.push(`${key}: recorded ${recorded[key]} != current ${current[key]}`);
  }
  if (mismatches.length > 0) {
    throw new Error(`${label} changed after build source context was recorded:\n  ${mismatches.join('\n  ')}`);
  }
  return true;
}

export function readVerifiedBuildSource({ root = ROOT, sourcePath = BUILD_SOURCE_FILE, label = 'source', nowMs = Date.now() } = {}) {
  const recorded = readRecordedBuildSource({ sourcePath, nowMs });
  assertSameSourceState(recorded, { root, label });
  return recorded;
}

function hashFile(absolute) {
  return createHash('sha256').update(readFileSync(absolute)).digest('hex');
}

function walkFiles(root, repoPath) {
  const absolute = path.join(root, repoPath);
  if (!existsSync(absolute)) throw new Error(`compiled output is missing: ${repoPath}`);
  const stat = lstatSync(absolute);
  if (!stat.isDirectory()) throw new Error(`compiled output is not a directory: ${repoPath}`);

  const files = [];
  const visit = (dir, dirRepoPath) => {
    for (const name of readdirSync(dir).sort((a, b) => a.localeCompare(b))) {
      const child = path.join(dir, name);
      const childRepoPath = `${dirRepoPath}/${name}`;
      const childStat = lstatSync(child);
      if (childStat.isDirectory()) visit(child, childRepoPath);
      else if (childStat.isFile()) files.push({ absolute: child, repoPath: childRepoPath });
    }
  };
  visit(absolute, repoPath);
  if (files.length === 0) throw new Error(`compiled output has no files: ${repoPath}`);
  return files;
}

function hashCompiledOutputDirectory(root, repoPath) {
  const files = walkFiles(root, repoPath);
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(`${file.repoPath}\0${hashFile(file.absolute)}\0`);
  }
  return { path: repoPath, sha256: hash.digest('hex'), fileCount: files.length };
}

function readEntrypointMtime(root, repoPath, minMtimeMs) {
  const absolute = path.join(root, repoPath);
  if (!existsSync(absolute)) throw new Error(`compiled output entrypoint is missing: ${repoPath}`);
  const stat = lstatSync(absolute);
  if (!stat.isFile()) throw new Error(`compiled output entrypoint is not a file: ${repoPath}`);
  if (stat.mtimeMs + 1000 < minMtimeMs) {
    throw new Error(`compiled output entrypoint is older than build source record: ${repoPath}`);
  }
  return { path: repoPath, mtimeMs: stat.mtimeMs };
}

function readCompiledOutputs(root, sourceBuiltAt) {
  const sourceBuiltAtMs = Date.parse(sourceBuiltAt);
  if (!Number.isFinite(sourceBuiltAtMs)) throw new Error('build source context has invalid builtAt');
  return {
    directories: BUILD_OUTPUT_DIRS.map((repoPath) => hashCompiledOutputDirectory(root, repoPath)),
    entrypoints: BUILD_OUTPUT_ENTRYPOINTS.map((repoPath) => readEntrypointMtime(root, repoPath, sourceBuiltAtMs)),
  };
}

function sourceIdentity(source) {
  return {
    gitCommit: source.gitCommit,
    gitDirty: source.gitDirty,
    gitStatusHash: source.gitStatusHash,
    builtAt: source.builtAt,
  };
}

function assertReceiptSourceMatches(expected, actual, label) {
  const mismatches = [];
  for (const key of ['gitCommit', 'gitDirty', 'gitStatusHash', 'builtAt']) {
    if (expected[key] !== actual?.[key]) mismatches.push(`${key}: receipt ${actual?.[key]} != source ${expected[key]}`);
  }
  if (mismatches.length > 0) throw new Error(`${label} source does not match build source context:\n  ${mismatches.join('\n  ')}`);
}

function validateCompiledDirectoryRecord(record, label) {
  if (!BUILD_OUTPUT_DIRS.includes(record?.path)) throw new Error(`${label} has unknown compiled output path: ${record?.path ?? '(missing)'}`);
  if (!/^[0-9a-f]{64}$/i.test(String(record.sha256 ?? ''))) throw new Error(`${label} has invalid compiled output hash for ${record.path}`);
  if (!Number.isInteger(record.fileCount) || record.fileCount < 1) throw new Error(`${label} has invalid file count for ${record.path}`);
}

function validateEntrypointRecord(record, label) {
  if (!BUILD_OUTPUT_ENTRYPOINTS.includes(record?.path)) throw new Error(`${label} has unknown entrypoint path: ${record?.path ?? '(missing)'}`);
  if (!Number.isFinite(record.mtimeMs)) throw new Error(`${label} has invalid entrypoint mtime for ${record.path}`);
}

export function recordBuildOutputReceipt({
  root = ROOT,
  sourcePath = path.join(root, '.release-build-source.json'),
  outputPath = path.join(root, '.tmp', 'release-build-output.json'),
  now = () => new Date().toISOString(),
  nowMs = undefined,
} = {}) {
  const effectiveNowMs = nowMs ?? Date.now();
  const source = readVerifiedBuildSource({ root, sourcePath, label: 'release build source before output receipt', nowMs: effectiveNowMs });
  const receiptRecordedAtValue = now();
  const receiptRecordedAt = normalizeTimestamp(receiptRecordedAtValue, 'receipt recordedAt', nowMs ?? Date.now());
  const outputs = readCompiledOutputs(root, source.builtAt);
  const receipt = {
    schemaVersion: BUILD_OUTPUT_RECEIPT_SCHEMA_VERSION,
    recordedAt: receiptRecordedAt,
    source: sourceIdentity(source),
    outputs,
  };
  mkdirSync(path.dirname(outputPath), { recursive: true });
  const tmp = `${outputPath}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(receipt, null, 2)}\n`);
  renameSync(tmp, outputPath);
  return receipt;
}

export function readRecordedBuildOutputReceipt({ receiptPath = BUILD_OUTPUT_RECEIPT_FILE, nowMs = Date.now() } = {}) {
  if (!existsSync(receiptPath)) throw new Error(`build output receipt is missing: ${receiptPath}`);
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  if (receipt?.schemaVersion !== BUILD_OUTPUT_RECEIPT_SCHEMA_VERSION) {
    throw new Error(`unsupported build output receipt schema: ${receipt?.schemaVersion ?? '(missing)'}`);
  }
  receipt.recordedAt = normalizeTimestamp(receipt.recordedAt, 'receipt recordedAt', nowMs);
  const source = receipt.source ?? {};
  if (!/^[0-9a-f]{40}$/i.test(String(source.gitCommit ?? ''))) throw new Error('build output receipt is missing source.gitCommit');
  if (typeof source.gitDirty !== 'boolean') throw new Error('build output receipt is missing source.gitDirty');
  if (source.gitStatusHash !== null && !/^[0-9a-f]{64}$/i.test(String(source.gitStatusHash ?? ''))) {
    throw new Error('build output receipt has invalid source.gitStatusHash');
  }
  source.builtAt = normalizeTimestamp(source.builtAt, 'source builtAt', nowMs);
  if (!Array.isArray(receipt.outputs?.directories) || receipt.outputs.directories.length !== BUILD_OUTPUT_DIRS.length) {
    throw new Error('build output receipt has invalid compiled directory records');
  }
  if (!Array.isArray(receipt.outputs?.entrypoints) || receipt.outputs.entrypoints.length !== BUILD_OUTPUT_ENTRYPOINTS.length) {
    throw new Error('build output receipt has invalid entrypoint records');
  }
  receipt.outputs.directories.forEach((record) => validateCompiledDirectoryRecord(record, 'build output receipt'));
  receipt.outputs.entrypoints.forEach((record) => validateEntrypointRecord(record, 'build output receipt'));
  return receipt;
}

export function assertSameBuildOutputReceipt(receipt, { root = ROOT, label = 'compiled output' } = {}) {
  const current = readCompiledOutputs(root, receipt.source.builtAt);
  const expectedDirectories = new Map(receipt.outputs.directories.map((record) => [record.path, record]));
  const mismatches = [];
  for (const actual of current.directories) {
    const expected = expectedDirectories.get(actual.path);
    if (!expected) mismatches.push(`${actual.path}: missing receipt record`);
    else if (expected.sha256 !== actual.sha256) mismatches.push(`${actual.path}: receipt ${expected.sha256} != current ${actual.sha256}`);
    else if (expected.fileCount !== actual.fileCount) mismatches.push(`${actual.path}: receipt ${expected.fileCount} files != current ${actual.fileCount} files`);
  }
  if (mismatches.length > 0) throw new Error(`${label} changed after build output receipt was recorded:\n  ${mismatches.join('\n  ')}`);
  return true;
}

export function readVerifiedBuildOutputReceipt({
  root = ROOT,
  sourcePath = BUILD_SOURCE_FILE,
  receiptPath = BUILD_OUTPUT_RECEIPT_FILE,
  label = 'compiled output',
  nowMs = Date.now(),
} = {}) {
  const source = readVerifiedBuildSource({ root, sourcePath, label: `${label} source`, nowMs });
  const receipt = readRecordedBuildOutputReceipt({ receiptPath, nowMs });
  assertReceiptSourceMatches(sourceIdentity(source), receipt.source, label);
  assertSameSourceState(receipt.source, { root, label: `${label} source` });
  assertSameBuildOutputReceipt(receipt, { root, label });
  return receipt;
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = { command, root: ROOT, outputPath: null, sourcePath: null, receiptPath: null };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === '--root') opts.root = path.resolve(rest[(i += 1)]);
    else if (arg === '--out') opts.outputPath = path.resolve(rest[(i += 1)]);
    else if (arg === '--source-file') opts.sourcePath = path.resolve(rest[(i += 1)]);
    else if (arg === '--receipt-file') opts.receiptPath = path.resolve(rest[(i += 1)]);
    else throw new Error(`unknown arg: ${arg}`);
  }
  opts.outputPath ??= path.join(opts.root, '.release-build-source.json');
  opts.sourcePath ??= opts.outputPath;
  opts.receiptPath ??= path.join(opts.root, '.tmp', 'release-build-output.json');
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.command === 'record') {
    const source = recordBuildSource(opts);
    console.log(`[release-build-source] recorded ${source.gitCommit}${source.gitDirty ? ' (dirty)' : ' (clean)'}`);
    return;
  }
  if (opts.command === 'verify') {
    const source = readVerifiedBuildSource({ root: opts.root, sourcePath: opts.sourcePath, label: 'release build source' });
    console.log(`[release-build-source] verified ${source.gitCommit}${source.gitDirty ? ' (dirty)' : ' (clean)'}`);
    return;
  }
  if (opts.command === 'receipt') {
    const receipt = recordBuildOutputReceipt({ root: opts.root, sourcePath: opts.sourcePath, outputPath: opts.receiptPath });
    console.log(`[release-build-source] recorded compiled output receipt for ${receipt.source.gitCommit}${receipt.source.gitDirty ? ' (dirty)' : ' (clean)'}`);
    return;
  }
  if (opts.command === 'verify-receipt') {
    const receipt = readVerifiedBuildOutputReceipt({ root: opts.root, sourcePath: opts.sourcePath, receiptPath: opts.receiptPath, label: 'release build output receipt' });
    console.log(`[release-build-source] verified compiled output receipt for ${receipt.source.gitCommit}${receipt.source.gitDirty ? ' (dirty)' : ' (clean)'}`);
    return;
  }
  console.error('usage: release-build-source.mjs <record|verify|receipt|verify-receipt> [--root dir] [--out file] [--source-file file] [--receipt-file file]');
  process.exit(2);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  try {
    main();
  } catch (error) {
    console.error(`[release-build-source] ERROR ${error.message}`);
    process.exit(3);
  }
}
