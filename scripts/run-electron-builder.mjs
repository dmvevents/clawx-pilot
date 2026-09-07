#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FFMPEG_TARGETS } from './download-bundled-ffmpeg.mjs';
import { BUILD_OUTPUT_RECEIPT_FILE, BUILD_SOURCE_FILE, readVerifiedBuildOutputReceipt, readVerifiedBuildSource } from './release-build-source.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ELECTRON_BUILDER_BIN = process.platform === 'win32'
  ? path.join(ROOT, 'node_modules', '.bin', 'electron-builder.cmd')
  : path.join(ROOT, 'node_modules', '.bin', 'electron-builder');
const args = process.argv.slice(2);
const REQUIRED_WIN_HELPERS = ['node.exe', 'uv.exe', 'ffmpeg.exe', 'WinSpeechRecognize.exe', 'WinSpeechRecognize.exe.config'];
const REQUIRED_FFMPEG_FILES = ['ffmpeg.exe', 'FFMPEG_LICENSE.txt', 'FFMPEG_PROVENANCE.json', 'THIRD_PARTY_FFMPEG.txt'];
const FFMPEG_TARGET = FFMPEG_TARGETS['win32-x64'];

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

export function prepareBuilderArgs(argv, env = process.env) {
  const prepared = [];
  let publishSeen = false;
  let publishRejected = false;
  let publishCount = 0;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--publish' || arg === '-p') {
      publishSeen = true;
      publishCount += 1;
      if (argv[i + 1] && !argv[i + 1].startsWith('-')) {
        if (argv[i + 1] !== 'never') publishRejected = true;
        prepared.push(arg, argv[i + 1]);
        i += 1;
      } else {
        publishRejected = true;
        prepared.push(arg);
      }
      continue;
    }
    if (arg.startsWith('--publish=')) {
      publishSeen = true;
      publishCount += 1;
      if (arg !== '--publish=never') publishRejected = true;
      prepared.push(arg);
      continue;
    }
    if (arg.startsWith('-p=')) {
      publishSeen = true;
      publishCount += 1;
      if (arg !== '-p=never') publishRejected = true;
      prepared.push(arg);
      continue;
    }
    if (arg.startsWith('-p') && arg.length > 2) {
      publishSeen = true;
      publishCount += 1;
      if (arg !== '-pnever') publishRejected = true;
      prepared.push(arg);
      continue;
    }
    prepared.push(arg);
  }
  if (publishCount > 1) publishRejected = true;
  if (!publishSeen) {
    prepared.push('--publish', 'never');
  }
  return { args: prepared, publishRejected };
}

export function assertNoDirectPublish(argv, env = process.env) {
  const prepared = prepareBuilderArgs(argv, env);
  if (prepared.publishRejected) {
    throw new Error('Direct electron-builder publication is disabled for this project. Build with --publish never, then use release evidence and manifest publication after review.');
  }
  return prepared;
}

export function builderArgsIncludeWindowsTarget(argv) {
  return argv.some((arg) => arg === '--win' || arg === '-w' || arg.startsWith('--win='));
}

export function builderArgsIncludeArm64Only(argv) {
  return argv.some((arg) => arg === '--arm64' || arg === '--ia32') && !argv.some((arg) => arg === '--x64');
}

function assertPlainFile(filePath, label) {
  if (!existsSync(filePath)) throw new Error(`${label} is missing: ${filePath}`);
  if (!statSync(filePath).isFile()) throw new Error(`${label} is not a file: ${filePath}`);
}

function sha256FileSync(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function assertFileHash(filePath, expected) {
  const stats = statSync(filePath);
  if (stats.size !== expected.bytes) {
    throw new Error(`${path.basename(filePath)} size mismatch: expected ${expected.bytes}, got ${stats.size}`);
  }
  const digest = sha256FileSync(filePath);
  if (digest !== expected.sha256) {
    throw new Error(`${path.basename(filePath)} checksum mismatch: expected ${expected.sha256}, got ${digest}`);
  }
}

export function assertWindowsFfmpegPackage(binDir, target = FFMPEG_TARGET) {
  for (const name of REQUIRED_FFMPEG_FILES) {
    assertPlainFile(path.join(binDir, name), `Windows FFmpeg package file ${name}`);
  }
  for (const [name, expected] of Object.entries(target.files)) {
    assertFileHash(path.join(binDir, name), expected);
  }
  const receiptPath = path.join(binDir, 'FFMPEG_PROVENANCE.json');
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  const archive = receipt.archive ?? {};
  if (
    receipt.schemaVersion !== 1 ||
    receipt.target !== 'win32-x64' ||
    archive.name !== target.archiveName ||
    archive.url !== target.downloadUrl ||
    archive.sha256 !== target.archiveSha256 ||
    archive.bytes !== target.archiveBytes ||
    archive.root !== target.archiveRoot
  ) {
    throw new Error('FFMPEG_PROVENANCE.json does not match the pinned FFmpeg archive metadata');
  }
  const upstream = receipt.upstream ?? {};
  if (
    upstream.buildCommit !== target.buildCommit ||
    upstream.buildCommitUrl !== target.buildCommitUrl ||
    upstream.ffmpegSourceCommit !== target.ffmpegSourceCommit ||
    upstream.ffmpegSourceUrl !== target.ffmpegSourceUrl ||
    upstream.checksumsSha256 !== target.checksumsSha256
  ) {
    throw new Error('FFMPEG_PROVENANCE.json does not match the pinned FFmpeg source/build metadata');
  }
  for (const [name, expected] of Object.entries(target.files)) {
    const file = receipt.files?.[name];
    if (!file || file.bytes !== expected.bytes || file.sha256 !== expected.sha256 || file.source !== expected.source) {
      throw new Error(`FFMPEG_PROVENANCE.json does not match ${name}`);
    }
  }
  const notice = readFileSync(path.join(binDir, 'THIRD_PARTY_FFMPEG.txt'), 'utf8');
  for (const expected of [target.archiveSha256, target.files['ffmpeg.exe'].sha256, target.files['FFMPEG_LICENSE.txt'].sha256]) {
    if (!notice.includes(expected)) throw new Error(`THIRD_PARTY_FFMPEG.txt is missing ${expected}`);
  }
}

export function assertWindowsHelperInputs({ root = ROOT, arch = 'x64', ffmpegTarget = FFMPEG_TARGET } = {}) {
  const binDir = path.join(root, 'resources', 'bin', `win32-${arch}`);
  for (const name of REQUIRED_WIN_HELPERS) {
    assertPlainFile(path.join(binDir, name), `Windows helper ${name}`);
  }
  assertWindowsFfmpegPackage(binDir, ffmpegTarget);
  const config = readFileSync(path.join(root, 'electron-builder.yml'), 'utf8');
  if (!config.includes('from: resources/bin/win32-${arch}') || !config.includes('to: bin')) {
    throw new Error('electron-builder.yml must copy resources/bin/win32-${arch} to installed resources/bin for Windows builds');
  }
  return binDir;
}

export function assertWindowsUnpackedHelpers({ root = ROOT, ffmpegTarget = FFMPEG_TARGET } = {}) {
  const binDir = path.join(root, 'release', 'win-unpacked', 'resources', 'bin');
  for (const name of REQUIRED_WIN_HELPERS) {
    assertPlainFile(path.join(binDir, name), `Packaged Windows helper ${name}`);
  }
  assertWindowsFfmpegPackage(binDir, ffmpegTarget);
  return binDir;
}

function verifyBuildSource(label) {
  return readVerifiedBuildSource({ root: ROOT, sourcePath: BUILD_SOURCE_FILE, label });
}

function verifyBuildReceipt(label) {
  return readVerifiedBuildOutputReceipt({ root: ROOT, sourcePath: BUILD_SOURCE_FILE, receiptPath: BUILD_OUTPUT_RECEIPT_FILE, label });
}

function spawnElectronBuilder(builderArgs) {
  if (process.platform === 'darwin') {
    const command = [
      'ulimit -n 65536 >/dev/null 2>&1 || ulimit -n 32768 >/dev/null 2>&1 || ulimit -n 16384 >/dev/null 2>&1 || true',
      `exec ${shellQuote(ELECTRON_BUILDER_BIN)}${builderArgs.length > 0 ? ` ${builderArgs.map(shellQuote).join(' ')}` : ''}`,
    ].join('; ');

    return spawn('/bin/bash', ['-lc', command], {
      cwd: ROOT,
      stdio: 'inherit',
      env: process.env,
    });
  }

  return spawn(ELECTRON_BUILDER_BIN, builderArgs, {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  });
}

// CLWX-85: bind the built bits to the version string. The ONLY outcome that
// fails the build is the script's deliberate policy stop (exit 3: a PUBLISHED
// version rebuilt with different bits — bump moe.N instead). Exit 2 means
// nothing to record; any other failure (a crash in the manifest script) must
// never block a legitimate build, so it warns loudly and passes.
function recordHashManifest() {
  const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'release-hash-manifest.mjs'), 'generate', '--build-source-file', BUILD_SOURCE_FILE], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  if (result.status === 3) return 3;
  if (result.status !== 0 && result.status !== 2) {
    console.warn(`[run-electron-builder] WARN release-hash-manifest crashed (status ${result.status ?? 'signal'}) — build is OK but its bits were NOT recorded; run "pnpm release:manifest" manually and report the crash.`);
  }
  return 0;
}

export function runElectronBuilderWrapper(argv = args, env = process.env, deps = {}) {
  const exit = deps.exit ?? process.exit;
  const log = deps.log ?? console.log;
  const errorLog = deps.error ?? console.error;
  const verifySource = deps.verifyBuildSource ?? verifyBuildSource;
  const verifyReceipt = deps.verifyBuildReceipt ?? verifyBuildReceipt;
  const spawnBuilder = deps.spawnElectronBuilder ?? spawnElectronBuilder;
  const recordManifest = deps.recordHashManifest ?? recordHashManifest;
  const validateWindowsInputs = deps.assertWindowsHelperInputs ?? assertWindowsHelperInputs;
  const validateWindowsOutput = deps.assertWindowsUnpackedHelpers ?? assertWindowsUnpackedHelpers;
  let prepared;
  try {
    prepared = assertNoDirectPublish(argv, env);
  } catch (error) {
    errorLog(`[run-electron-builder] ERROR ${error.message}`);
    exit(3);
    return;
  }
  let source;
  try {
    source = verifySource('release build source before electron-builder');
    verifyReceipt('release build output receipt before electron-builder');
    if (builderArgsIncludeWindowsTarget(prepared.args) && !builderArgsIncludeArm64Only(prepared.args)) {
      validateWindowsInputs({ root: ROOT, arch: 'x64' });
    }
  } catch (error) {
    errorLog(`[run-electron-builder] ERROR ${error.message}`);
    errorLog('[run-electron-builder] Run the package/build pipeline through "node scripts/release-build-source.mjs receipt" before electron-builder so compiled artifacts can be bound to their source.');
    exit(3);
    return;
  }
  log(`[run-electron-builder] build source ${source.gitCommit}${source.gitDirty ? ' (dirty)' : ' (clean)'}`);
  const child = spawnBuilder(prepared.args);
  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    if ((code ?? 1) === 0) {
      try {
        verifySource('release build source after electron-builder');
        verifyReceipt('release build output receipt after electron-builder');
        if (builderArgsIncludeWindowsTarget(prepared.args) && !builderArgsIncludeArm64Only(prepared.args)) {
          validateWindowsOutput({ root: ROOT });
        }
      } catch (error) {
        errorLog(`[run-electron-builder] ERROR ${error.message}`);
        exit(3);
        return;
      }
      exit(recordManifest());
      return;
    }
    exit(code ?? 1);
  });
  child.on('error', (error) => {
    errorLog(error);
    exit(1);
  });
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) runElectronBuilderWrapper();
