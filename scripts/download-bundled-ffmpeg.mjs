#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createReadStream, mkdirSync as mkdirSyncFs, rmSync as rmSyncFs, statSync as statSyncFs } from 'node:fs';
import { constants } from 'node:fs';
import { access, chmod, copyFile, mkdir, mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const OUTPUT_BASE = path.join(ROOT_DIR, 'resources', 'bin');
const TEMP_PREFIX = path.join(os.tmpdir(), 'clawx-ffmpeg-');

export const FFMPEG_TARGETS = {
  'win32-x64': {
    archiveName: 'ffmpeg-n9.0.1-11-ge47273f4d9-win64-lgpl-9.0.zip',
    archiveSha256: '2484854ad6988d34560f4e6ea7a6ecb9dde0af7c229d2591815d056b04ec4f56',
    archiveBytes: 147_007_942,
    downloadUrl:
      'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-08-31-13-27/ffmpeg-n9.0.1-11-ge47273f4d9-win64-lgpl-9.0.zip',
    license: 'LGPL-2.1-or-later',
    upstream: 'BtbN/FFmpeg-Builds autobuild-2026-08-31-13-27',
    archiveRoot: 'ffmpeg-n9.0.1-11-ge47273f4d9-win64-lgpl-9.0',
    buildCommit: '8267213e26c1031621e6e1210fe3aa4867214f6a',
    buildCommitUrl: 'https://github.com/BtbN/FFmpeg-Builds/commit/8267213e26c1031621e6e1210fe3aa4867214f6a',
    ffmpegSourceCommit: 'e47273f4d9227152dcbf543cebaf9e2430ddbcc4',
    ffmpegSourceUrl: 'https://github.com/FFmpeg/FFmpeg/commit/e47273f4d9227152dcbf543cebaf9e2430ddbcc4',
    checksumsUrl: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-08-31-13-27/checksums.sha256',
    checksumsSha256: '5a831b23711edf09476291bfbb104cc4e9c78ab6d9a3978ff27da1ee76b01c5b',
    files: {
      'ffmpeg.exe': {
        source: 'bin/ffmpeg.exe',
        bytes: 114_400_768,
        sha256: '63a0b3c76a245bc0d986853612d9ec43a2a2d1f1c7a3fa40ee459c248075b3a6',
        executable: true,
      },
      'FFMPEG_LICENSE.txt': {
        source: 'LICENSE.txt',
        bytes: 7_651,
        sha256: 'da7eabb7bafdf7d3ae5e9f223aa5bdc1eece45ac569dc21b3b037520b4464768',
        executable: false,
      },
    },
  },
};

const PROVENANCE_FILE = 'FFMPEG_PROVENANCE.json';
const NOTICE_FILE = 'THIRD_PARTY_FFMPEG.txt';

const PLATFORM_GROUPS = {
  win: ['win32-x64'],
};

function parseArgs(argv) {
  const opts = { platform: null, target: null, all: false, archive: null };
  for (const arg of argv) {
    if (arg === '--all') opts.all = true;
    else if (arg.startsWith('--platform=')) opts.platform = arg.slice('--platform='.length);
    else if (arg === '--platform') throw new Error('--platform requires --platform=<name>');
    else if (arg.startsWith('--target=')) opts.target = arg.slice('--target='.length);
    else if (arg === '--target') throw new Error('--target requires --target=<id>');
    else if (arg.startsWith('--archive=')) opts.archive = arg.slice('--archive='.length);
    else if (arg === '--archive') throw new Error('--archive requires --archive=<path>');
    else throw new Error(`unknown arg: ${arg}`);
  }
  return opts;
}

export function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(filePath)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

export async function assertExecutableFile(filePath) {
  const info = await stat(filePath);
  if (!info.isFile()) throw new Error(`${filePath} is not a file`);
  await access(filePath, constants.R_OK);
  await chmod(filePath, 0o755).catch(() => undefined);
  return filePath;
}

async function assertRegularFile(filePath) {
  const info = await stat(filePath);
  if (!info.isFile()) throw new Error(`${filePath} is not a file`);
  await access(filePath, constants.R_OK);
  return info;
}

async function downloadFile(url, archivePath, fetchImpl = fetch) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`failed to download ${url}: ${response.status} ${response.statusText}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(archivePath, buffer);
  return archivePath;
}

function extractZip(archivePath, outDir) {
  if (process.platform === 'win32') {
    const psCommand = [
      'Add-Type -AssemblyName System.IO.Compression.FileSystem',
      `[System.IO.Compression.ZipFile]::ExtractToDirectory('${archivePath.replace(/'/g, "''")}', '${outDir.replace(/'/g, "''")}')`,
    ].join('; ');
    const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', psCommand], { stdio: 'inherit' });
    if (result.status !== 0) throw new Error(`PowerShell extraction failed for ${archivePath}`);
    return;
  }
  const result = spawnSync('unzip', ['-q', '-o', archivePath, '-d', outDir], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`unzip extraction failed for ${archivePath}`);
}

async function containedPath(root, relPath) {
  const rootReal = await realpath(root);
  const candidate = path.resolve(root, relPath);
  const parentReal = await realpath(path.dirname(candidate));
  if (parentReal !== rootReal && !parentReal.startsWith(`${rootReal}${path.sep}`)) {
    throw new Error(`archive member escapes extract root: ${relPath}`);
  }
  return candidate;
}

async function assertContainedFile(root, filePath, relPath) {
  const rootReal = await realpath(root);
  const fileReal = await realpath(filePath);
  if (fileReal !== rootReal && !fileReal.startsWith(`${rootReal}${path.sep}`)) {
    throw new Error(`archive member escapes extract root: ${relPath}`);
  }
}

async function copyDeclaredFiles(extractDir, targetDir, target) {
  const archiveRoot = target.archiveRoot;
  if (!archiveRoot || archiveRoot.includes('..') || path.isAbsolute(archiveRoot)) {
    throw new Error(`invalid FFmpeg archive root: ${archiveRoot}`);
  }
  const copied = {};
  for (const [destName, expected] of Object.entries(target.files ?? {})) {
    const sourcePath = await containedPath(extractDir, path.join(archiveRoot, expected.source));
    const sourceInfo = await assertRegularFile(sourcePath);
    await assertContainedFile(extractDir, sourcePath, expected.source);
    const sourceDigest = await sha256File(sourcePath);
    if (sourceInfo.size !== expected.bytes) {
      throw new Error(`${expected.source} size mismatch: expected ${expected.bytes}, got ${sourceInfo.size}`);
    }
    if (sourceDigest !== expected.sha256) {
      throw new Error(`${expected.source} checksum mismatch: expected ${expected.sha256}, got ${sourceDigest}`);
    }
    const destPath = path.join(targetDir, destName);
    await copyFile(sourcePath, destPath);
    if (expected.executable) await assertExecutableFile(destPath);
    else await assertRegularFile(destPath);
    copied[destName] = { ...expected, sha256: await sha256File(destPath), bytes: (await stat(destPath)).size };
  }
  return copied;
}

async function writeNotice(targetDir, target, copied) {
  const lines = [
    'FFmpeg bundled binary notice',
    '',
    `Upstream: ${target.upstream}`,
    `License: ${target.license}`,
    `Binary archive: ${target.downloadUrl}`,
    `Archive sha256: ${target.archiveSha256}`,
    ...(target.archiveBytes ? [`Archive bytes: ${target.archiveBytes}`] : []),
    `Build scripts commit: ${target.buildCommitUrl}`,
    `FFmpeg source commit: ${target.ffmpegSourceUrl}`,
    ...(target.checksumsUrl ? [`Release checksums: ${target.checksumsUrl}`] : []),
    ...(target.checksumsSha256 ? [`Release checksums sha256: ${target.checksumsSha256}`] : []),
    'Windows package acceptance must run this binary on Windows for `-version`, `-buildconf`, and a real transcode smoke before release.',
    '',
    'Bundled files:',
    ...Object.entries(copied).map(([name, file]) => `- ${name}: ${file.bytes} bytes, sha256:${file.sha256}`),
    '',
    'This package bundles the LGPL static Windows build. Keep this notice with the binary when redistributing.',
  ];
  await writeFile(path.join(targetDir, NOTICE_FILE), `${lines.join('\n')}\n`);
}

async function writeProvenance(targetDir, id, target, copied) {
  const receipt = {
    schemaVersion: 1,
    target: id,
    archive: {
      name: target.archiveName,
      url: target.downloadUrl,
      sha256: target.archiveSha256,
      bytes: target.archiveBytes,
      root: target.archiveRoot,
    },
    upstream: {
      name: target.upstream,
      license: target.license,
      buildCommit: target.buildCommit,
      buildCommitUrl: target.buildCommitUrl,
      ffmpegSourceCommit: target.ffmpegSourceCommit,
      ffmpegSourceUrl: target.ffmpegSourceUrl,
      checksumsUrl: target.checksumsUrl,
      checksumsSha256: target.checksumsSha256,
    },
    files: copied,
  };
  await writeFile(path.join(targetDir, PROVENANCE_FILE), `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

function assertToolResult(binary, args, result) {
  if (result.status !== 0) {
    throw new Error(`ffmpeg ${args.join(' ')} failed: ${(result.stderr || result.stdout || result.error?.message || '').slice(0, 500)}`);
  }
  return result;
}

function runTool(binary, args, opts = {}) {
  return assertToolResult(binary, args, spawnSync(binary, args, {
    encoding: 'utf8',
    timeout: opts.timeout ?? 15_000,
    windowsHide: true,
  }));
}

export function validateWindowsFfmpegFunctional(targetDir, deps = {}) {
  const platform = deps.platform ?? process.platform;
  if (platform !== 'win32') return { skipped: true, reason: `platform ${platform}` };
  const spawnTool = deps.spawnSync
    ? (binary, args) => assertToolResult(binary, args, deps.spawnSync(binary, args))
    : runTool;
  const ffmpeg = path.join(targetDir, 'ffmpeg.exe');
  const smokeRoot = deps.smokeRoot ?? path.join(os.tmpdir(), `clawx-ffmpeg-smoke-${process.pid}-${Date.now()}`);
  const mkdirSync = deps.mkdirSync ?? ((dir) => mkdirSyncFs(dir, { recursive: true }));
  const rmSync = deps.rmSync ?? ((dir) => rmSyncFs(dir, { recursive: true, force: true }));
  const statSync = deps.statSync ?? statSyncFs;
  mkdirSync(smokeRoot);
  try {
    spawnTool(ffmpeg, ['-hide_banner', '-version']);
    spawnTool(ffmpeg, ['-hide_banner', '-buildconf']);
    const outWav = path.join(smokeRoot, 'ffmpeg-smoke.wav');
    spawnTool(ffmpeg, [
      '-hide_banner',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=1000:duration=0.1',
      '-ar',
      '16000',
      '-ac',
      '1',
      '-f',
      'wav',
      outWav,
    ]);
    const output = statSync(outWav);
    if (!output.isFile() || output.size === 0) {
      throw new Error(`ffmpeg smoke output is empty or missing: ${outWav}`);
    }
    return { skipped: false, outputBytes: output.size };
  } finally {
    rmSync(smokeRoot);
  }
}

export async function setupFfmpegTarget(id, deps = {}) {
  const target = deps.target ?? FFMPEG_TARGETS[id];
  if (!target) throw new Error(`unsupported FFmpeg target: ${id}`);

  const rootDir = deps.rootDir ?? ROOT_DIR;
  const outputBase = deps.outputBase ?? path.join(rootDir, 'resources', 'bin');
  const targetDir = path.join(outputBase, id);
  const tempDir = deps.tempDir ?? (await mkdtemp(TEMP_PREFIX));
  const archivePath = path.join(tempDir, target.archiveName);
  const fetchImpl = deps.fetch ?? fetch;
  const extractor = deps.extractZip ?? extractZip;

  await mkdir(targetDir, { recursive: true });
  try {
    const inputArchive = deps.archivePath ? path.resolve(deps.archivePath) : archivePath;
    if (deps.archivePath) {
      console.log(`[ffmpeg] Using local archive ${inputArchive}`);
    } else {
      console.log(`[ffmpeg] Downloading ${target.downloadUrl}`);
      await downloadFile(target.downloadUrl, archivePath, fetchImpl);
    }
    if (target.archiveBytes) {
      const { size } = await stat(inputArchive);
      if (size !== target.archiveBytes) {
        throw new Error(`FFmpeg archive size mismatch for ${id}: expected ${target.archiveBytes}, got ${size}`);
      }
    }
    const digest = await sha256File(inputArchive);
    if (digest !== target.archiveSha256) {
      throw new Error(`FFmpeg archive checksum mismatch for ${id}: expected ${target.archiveSha256}, got ${digest}`);
    }

    const extractDir = path.join(tempDir, 'extract');
    await mkdir(extractDir, { recursive: true });
    extractor(inputArchive, extractDir);

    const copied = await copyDeclaredFiles(extractDir, targetDir, target);
    await writeNotice(targetDir, target, copied);
    await writeProvenance(targetDir, id, target, copied);
    validateWindowsFfmpegFunctional(targetDir, deps);
    console.log(`[ffmpeg] Ready: ${path.join(targetDir, 'ffmpeg.exe')}`);
    return { targetDir, files: copied };
  } finally {
    if (!deps.keepTemp) await rm(tempDir, { recursive: true, force: true });
  }
}

export function targetsForOptions(opts, platform = process.platform, arch = process.arch) {
  if (opts.all) return Object.keys(FFMPEG_TARGETS);
  if (opts.target) return [opts.target];
  if (opts.platform) {
    const group = PLATFORM_GROUPS[opts.platform];
    if (!group) throw new Error(`unknown FFmpeg platform: ${opts.platform}`);
    return group;
  }
  const current = `${platform}-${arch}`;
  return FFMPEG_TARGETS[current] ? [current] : PLATFORM_GROUPS.win;
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
    for (const target of targetsForOptions(opts)) await setupFfmpegTarget(target, opts.archive ? { archivePath: opts.archive } : {});
  } catch (error) {
    console.error(`[ffmpeg] ERROR ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) main();
