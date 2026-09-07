#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILD_OUTPUT_RECEIPT_FILE, BUILD_SOURCE_FILE, readVerifiedBuildOutputReceipt, readVerifiedBuildSource } from './release-build-source.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ELECTRON_BUILDER_BIN = process.platform === 'win32'
  ? path.join(ROOT, 'node_modules', '.bin', 'electron-builder.cmd')
  : path.join(ROOT, 'node_modules', '.bin', 'electron-builder');
const args = process.argv.slice(2);

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
