#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { constants } from 'node:fs';
import { access, chmod, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const PROJECT_FILE = path.join(
  ROOT_DIR,
  'electron',
  'native',
  'WinSpeechRecognize',
  'WinSpeechRecognize.csproj',
);
const OUTPUT_BASE = path.join(ROOT_DIR, 'resources', 'bin');
const HELPER_NAME = 'WinSpeechRecognize.exe';

const TARGETS = {
  x64: { dir: 'win32-x64' },
  arm64: { dir: 'win32-arm64' },
};

function flagValue(name) {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  if (index >= 0) return process.argv[index + 1];
  return undefined;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function dotnetAvailable() {
  const result = spawnSync('dotnet', ['--version'], { encoding: 'utf8' });
  return result.status === 0;
}

async function assertHelperExists(outputDir) {
  const helperPath = path.join(outputDir, HELPER_NAME);
  await access(helperPath, constants.X_OK | constants.R_OK).catch(async () => {
    await access(helperPath, constants.R_OK);
    await chmod(helperPath, 0o755).catch(() => undefined);
  });
  return helperPath;
}

const requestedArch = flagValue('--arch');
const targetKeys = hasFlag('--all')
  ? Object.keys(TARGETS)
  : [requestedArch ?? 'x64'];
const invalid = targetKeys.find((key) => !TARGETS[key]);
if (invalid) {
  fail(`Unsupported Windows ASR helper arch: ${invalid}. Use x64, arm64, or --all.`);
}

const skipMissing =
  process.env.SKIP_WIN_ASR_HELPER === '1' ||
  process.env.SKIP_WINDOWS_ASR_HELPER === '1' ||
  hasFlag('--skip-missing');

if (!dotnetAvailable()) {
  const message =
    'dotnet SDK is required to build WinSpeechRecognize.exe. ' +
    'Install a .NET SDK or set SKIP_WIN_ASR_HELPER=1 for an intentional diagnostic build.';
  if (skipMissing) {
    console.warn(`[win-asr] ${message}`);
    process.exit(0);
  }
  fail(`[win-asr] ${message}`);
}

for (const key of targetKeys) {
  const target = TARGETS[key];
  const outputDir = path.join(OUTPUT_BASE, target.dir);
  await mkdir(outputDir, { recursive: true });

  console.log(`[win-asr] Publishing Windows desktop helper to ${outputDir}`);
  const args = [
    'publish',
    PROJECT_FILE,
    '-c',
    'Release',
    '-p:DebugType=embedded',
    '-p:EnableWindowsTargeting=true',
    '-p:Platform=AnyCPU',
    '-o',
    outputDir,
  ];

  const result = spawnSync('dotnet', args, { cwd: ROOT_DIR, stdio: 'inherit' });
  if (result.status !== 0) {
    fail(`[win-asr] dotnet publish failed for ${target.dir}`);
  }

  const helperPath = await assertHelperExists(outputDir);
  console.log(`[win-asr] Ready: ${helperPath}`);
}
