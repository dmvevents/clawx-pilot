#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const parsed = {};
  for (const arg of argv) {
    const match = /^--([^=]+)=(.*)$/u.exec(arg);
    if (match) parsed[match[1]] = match[2];
  }
  return parsed;
}

export function getElectronPlatformPath(platform = os.platform()) {
  switch (platform) {
    case 'mas':
    case 'darwin':
      return 'Electron.app/Contents/MacOS/Electron';
    case 'freebsd':
    case 'openbsd':
    case 'linux':
      return 'electron';
    case 'win32':
      return 'electron.exe';
    default:
      throw new Error(`Electron builds are not available on platform: ${platform}`);
  }
}

function readTrimmedIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8').trim();
  } catch {
    return null;
  }
}

export function resolveElectronPackage() {
  const packageJsonPath = require.resolve('electron/package.json', { paths: [ROOT] });
  const packageDir = path.dirname(packageJsonPath);
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const checksumsPath = path.join(packageDir, 'checksums.json');
  if (!fs.existsSync(checksumsPath)) {
    throw new Error(`Electron checksum manifest missing: ${checksumsPath}`);
  }
  return { packageDir, pkg, checksumsPath };
}

export function isElectronRuntimeInstalled({ electronPackageDir, version, platform = os.platform(), distDir }) {
  const platformPath = getElectronPlatformPath(platform);
  const resolvedDistDir = distDir ?? path.join(electronPackageDir, 'dist');
  const pathFile = path.join(electronPackageDir, 'path.txt');
  const versionFile = path.join(resolvedDistDir, 'version');
  const executablePath = path.join(resolvedDistDir, platformPath);
  return readTrimmedIfExists(pathFile) === platformPath
    && readTrimmedIfExists(versionFile)?.replace(/^v/u, '') === version
    && fs.existsSync(executablePath);
}

function extractZip(zipPath, distDir) {
  if (process.platform === 'win32') {
    const psCommand = `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory('${zipPath.replace(/'/g, "''")}', '${distDir.replace(/'/g, "''")}')`;
    execFileSync('powershell.exe', ['-NoProfile', '-Command', psCommand], { stdio: 'inherit' });
  } else {
    execFileSync('unzip', ['-q', '-o', zipPath, '-d', distDir], { stdio: 'inherit' });
  }
}

export async function ensureElectronRuntime(options = {}) {
  const { packageDir, pkg, checksumsPath } = resolveElectronPackage();
  const hostPlatform = os.platform();
  const hostArch = os.arch();
  const platform = options.platform ?? process.env.ELECTRON_INSTALL_PLATFORM ?? process.env.npm_config_platform ?? hostPlatform;
  const arch = options.arch ?? process.env.ELECTRON_INSTALL_ARCH ?? process.env.npm_config_arch ?? hostArch;
  if (platform !== hostPlatform || arch !== hostArch) {
    throw new Error(`Electron runtime materialization is host-only; requested ${platform}-${arch}, host is ${hostPlatform}-${hostArch}`);
  }
  const platformPath = getElectronPlatformPath(platform);
  const distDir = process.env.ELECTRON_OVERRIDE_DIST_PATH || path.join(packageDir, 'dist');

  if (isElectronRuntimeInstalled({ electronPackageDir: packageDir, version: pkg.version, platform, distDir })) {
    return { electronPackageDir: packageDir, version: pkg.version, platform, arch, platformPath, installed: true };
  }

  const { downloadArtifact } = require('@electron/get');
  const zipPath = await downloadArtifact({
    version: pkg.version,
    artifactName: 'electron',
    platform,
    arch,
    force: process.env.force_no_cache === 'true',
    cacheRoot: process.env.electron_config_cache,
    checksums: process.env.electron_use_remote_checksums || process.env.npm_config_electron_use_remote_checksums ? undefined : require(checksumsPath),
  });
  await fs.promises.rm(distDir, { recursive: true, force: true });
  await fs.promises.mkdir(distDir, { recursive: true });
  extractZip(zipPath, distDir);
  const extractedTypes = path.join(distDir, 'electron.d.ts');
  if (fs.existsSync(extractedTypes)) {
    await fs.promises.rename(extractedTypes, path.join(packageDir, 'electron.d.ts'));
  }
  await fs.promises.writeFile(path.join(packageDir, 'path.txt'), platformPath, 'utf8');

  if (!isElectronRuntimeInstalled({ electronPackageDir: packageDir, version: pkg.version, platform, distDir })) {
    throw new Error(`Electron ${pkg.version} runtime did not materialize ${platformPath} with matching version metadata`);
  }
  return { electronPackageDir: packageDir, version: pkg.version, platform, arch, platformPath, installed: false };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const keepAlive = setInterval(() => {}, 1_000);
  ensureElectronRuntime(parseArgs(process.argv.slice(2)))
    .then((result) => {
      console.log(`✓ Electron ${result.version} runtime ready for ${result.platform}-${result.arch} (${result.platformPath})`);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    })
    .finally(() => clearInterval(keepAlive));
}
