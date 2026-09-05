#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ELECTRON_BUILDER_BIN = process.platform === 'win32'
  ? path.join(ROOT, 'node_modules', '.bin', 'electron-builder.cmd')
  : path.join(ROOT, 'node_modules', '.bin', 'electron-builder');
const args = process.argv.slice(2);

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function spawnElectronBuilder() {
  if (process.platform === 'darwin') {
    const command = [
      'ulimit -n 65536 >/dev/null 2>&1 || ulimit -n 32768 >/dev/null 2>&1 || ulimit -n 16384 >/dev/null 2>&1 || true',
      `exec ${shellQuote(ELECTRON_BUILDER_BIN)}${args.length > 0 ? ` ${args.map(shellQuote).join(' ')}` : ''}`,
    ].join('; ');

    return spawn('/bin/bash', ['-lc', command], {
      cwd: ROOT,
      stdio: 'inherit',
      env: process.env,
    });
  }

  return spawn(ELECTRON_BUILDER_BIN, args, {
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
  const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'release-hash-manifest.mjs'), 'generate'], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  if (result.status === 3) return 3;
  if (result.status !== 0 && result.status !== 2) {
    console.warn(`[run-electron-builder] WARN release-hash-manifest crashed (status ${result.status ?? 'signal'}) — build is OK but its bits were NOT recorded; run "pnpm release:manifest" manually and report the crash.`);
  }
  return 0;
}

const child = spawnElectronBuilder();
child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  if ((code ?? 1) === 0) {
    process.exit(recordHashManifest());
  }
  process.exit(code ?? 1);
});
child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});
