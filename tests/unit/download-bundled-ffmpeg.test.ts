import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error - plain .mjs module without type declarations
import { FFMPEG_TARGETS, assertExecutableFile, setupFfmpegTarget, targetsForOptions, validateWindowsFfmpegFunctional } from '../../scripts/download-bundled-ffmpeg.mjs';

let root: string;
let archiveBytes: Buffer;

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function response(bytes: Buffer) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'clwx-ffmpeg-test-'));
  archiveBytes = Buffer.from('fake archive bytes');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('download-bundled-ffmpeg', () => {
  function fakeTarget(archive = archiveBytes) {
    return {
      archiveName: 'ffmpeg.zip',
      archiveSha256: sha256(archive),
      archiveBytes: archive.length,
      downloadUrl: 'https://example.test/ffmpeg.zip',
      license: 'LGPL-2.1-or-later',
      upstream: 'test-build',
      archiveRoot: 'ffmpeg-test-root',
      buildCommit: 'b'.repeat(40),
      buildCommitUrl: `https://example.test/build/${'b'.repeat(40)}`,
      ffmpegSourceCommit: 'f'.repeat(40),
      ffmpegSourceUrl: `https://example.test/ffmpeg/${'f'.repeat(40)}`,
      checksumsUrl: 'https://example.test/checksums.sha256',
      checksumsSha256: 'c'.repeat(64),
      files: {
        'ffmpeg.exe': {
          source: 'bin/ffmpeg.exe',
          bytes: Buffer.byteLength('ffmpeg'),
          sha256: sha256(Buffer.from('ffmpeg')),
          executable: true,
        },
        'FFMPEG_LICENSE.txt': {
          source: 'LICENSE.txt',
          bytes: Buffer.byteLength('license'),
          sha256: sha256(Buffer.from('license')),
          executable: false,
        },
      },
    };
  }

  function writeExactArchiveLayout(outDir: string, ffmpeg = 'ffmpeg', license = 'license') {
    mkdirSync(join(outDir, 'ffmpeg-test-root', 'bin'), { recursive: true });
    writeFileSync(join(outDir, 'ffmpeg-test-root', 'bin', 'ffmpeg.exe'), ffmpeg);
    writeFileSync(join(outDir, 'ffmpeg-test-root', 'LICENSE.txt'), license);
  }

  it('defaults non-Windows hosts to the Windows packaging target', () => {
    expect(targetsForOptions({}, 'darwin', 'arm64')).toEqual(['win32-x64']);
    expect(targetsForOptions({ platform: 'win' }, 'darwin', 'arm64')).toEqual(['win32-x64']);
  });

  it('hash-verifies the pinned archive before installing ffmpeg only', async () => {
    const extractZip = (_archive: string, outDir: string) => {
      writeExactArchiveLayout(outDir);
    };

    const result = await setupFfmpegTarget('win32-x64', {
      target: fakeTarget(),
      outputBase: join(root, 'resources', 'bin'),
      fetch: async () => response(archiveBytes),
      extractZip,
      keepTemp: false,
    });

    const binDir = join(root, 'resources', 'bin', 'win32-x64');
    expect(result.targetDir).toBe(binDir);
    expect(readFileSync(join(binDir, 'ffmpeg.exe'), 'utf8')).toBe('ffmpeg');
    expect(readFileSync(join(binDir, 'FFMPEG_LICENSE.txt'), 'utf8')).toBe('license');
    expect(readFileSync(join(binDir, 'THIRD_PARTY_FFMPEG.txt'), 'utf8')).toContain('LGPL');
    expect(JSON.parse(readFileSync(join(binDir, 'FFMPEG_PROVENANCE.json'), 'utf8')).files['ffmpeg.exe'].sha256).toBe(sha256(Buffer.from('ffmpeg')));
  });

  it('fails closed on size mismatch before extracting corrupt downloads', async () => {
    let extracted = false;
    await expect(setupFfmpegTarget('win32-x64', {
      target: fakeTarget(),
      outputBase: join(root, 'resources', 'bin'),
      fetch: async () => response(Buffer.from('corrupt')),
      extractZip: () => {
        extracted = true;
      },
    })).rejects.toThrow(/size mismatch/);
    expect(extracted).toBe(false);
  });

  it('fails closed on checksum mismatch and never extracts same-size corrupt downloads', async () => {
    let extracted = false;
    await expect(setupFfmpegTarget('win32-x64', {
      target: fakeTarget(),
      outputBase: join(root, 'resources', 'bin'),
      fetch: async () => response(Buffer.from('x'.repeat(archiveBytes.length))),
      extractZip: () => {
        extracted = true;
      },
    })).rejects.toThrow(/checksum mismatch/);
    expect(extracted).toBe(false);
  });

  it('rejects missing or non-file ffmpeg.exe from the archive', async () => {
    await expect(setupFfmpegTarget('win32-x64', {
      target: fakeTarget(),
      outputBase: join(root, 'resources', 'bin'),
      fetch: async () => response(archiveBytes),
      extractZip: (_archive: string, outDir: string) => {
        mkdirSync(join(outDir, 'ffmpeg-test-root', 'bin', 'ffmpeg.exe'), { recursive: true });
        writeFileSync(join(outDir, 'ffmpeg-test-root', 'LICENSE.txt'), 'license');
      },
    })).rejects.toThrow(/is not a file/);
  });

  it('rejects unexpected archive layout instead of basename searching', async () => {
    await expect(setupFfmpegTarget('win32-x64', {
      target: fakeTarget(),
      outputBase: join(root, 'resources', 'bin'),
      fetch: async () => response(archiveBytes),
      extractZip: (_archive: string, outDir: string) => {
        mkdirSync(join(outDir, 'different-root', 'bin'), { recursive: true });
        writeFileSync(join(outDir, 'different-root', 'bin', 'ffmpeg.exe'), 'ffmpeg');
        writeFileSync(join(outDir, 'different-root', 'LICENSE.txt'), 'license');
      },
    })).rejects.toThrow(/no such file|ENOENT/);
  });

  it('rejects archive members that resolve outside the extract root', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'clwx-ffmpeg-outside-'));
    try {
      writeFileSync(join(outside, 'ffmpeg.exe'), 'ffmpeg');
      await expect(setupFfmpegTarget('win32-x64', {
        target: fakeTarget(),
        outputBase: join(root, 'resources', 'bin'),
        fetch: async () => response(archiveBytes),
        extractZip: (_archive: string, outDir: string) => {
          mkdirSync(join(outDir, 'ffmpeg-test-root', 'bin'), { recursive: true });
          symlinkSync(join(outside, 'ffmpeg.exe'), join(outDir, 'ffmpeg-test-root', 'bin', 'ffmpeg.exe'));
          writeFileSync(join(outDir, 'ffmpeg-test-root', 'LICENSE.txt'), 'license');
        },
      })).rejects.toThrow(/escapes extract root/);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('runs bounded Windows-only version/buildconf/transcode smoke when executing on Windows', async () => {
    const calls: string[][] = [];
    const smokeRoot = join(root, 'smoke');
    await setupFfmpegTarget('win32-x64', {
      target: fakeTarget(),
      outputBase: join(root, 'resources', 'bin'),
      fetch: async () => response(archiveBytes),
      extractZip: (_archive: string, outDir: string) => writeExactArchiveLayout(outDir),
      platform: 'win32',
      spawnSync: (_binary: string, args: string[]) => {
        calls.push(args);
        if (args.includes('-f') && args.includes('wav')) writeFileSync(args.at(-1) as string, 'wav');
        return { status: 0, stdout: '', stderr: '' };
      },
      smokeRoot,
    });
    expect(calls).toEqual([
      ['-hide_banner', '-version'],
      ['-hide_banner', '-buildconf'],
      ['-hide_banner', '-y', '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=0.1', '-ar', '16000', '-ac', '1', '-f', 'wav', expect.stringMatching(/ffmpeg-smoke\.wav$/)],
    ]);
    expect(existsSync(join(root, 'resources', 'bin', 'win32-x64', 'ffmpeg-smoke.wav'))).toBe(false);
    expect(existsSync(smokeRoot)).toBe(false);
  });

  it('fails native prep when the Windows ffmpeg functional smoke fails', () => {
    const smokeRoot = join(root, 'smoke-fail');
    expect(() => validateWindowsFfmpegFunctional(root, {
      platform: 'win32',
      smokeRoot,
      spawnSync: () => ({ status: 1, stdout: '', stderr: 'cannot execute' }),
    })).toThrow(/cannot execute/);
    expect(existsSync(smokeRoot)).toBe(false);
  });

  it('fails native prep when transcode output is empty and still cleans up smoke files', () => {
    const smokeRoot = join(root, 'smoke-empty');
    expect(() => validateWindowsFfmpegFunctional(root, {
      platform: 'win32',
      smokeRoot,
      spawnSync: () => ({ status: 0, stdout: '', stderr: '' }),
      statSync: () => ({ isFile: () => true, size: 0 }),
    })).toThrow(/smoke output is empty/);
    expect(existsSync(smokeRoot)).toBe(false);
  });

  it('rejects non-file installed helpers', async () => {
    const dir = join(root, 'ffmpeg.exe');
    mkdirSync(dir, { recursive: true });
    await expect(assertExecutableFile(dir)).rejects.toThrow(/is not a file/);
  });

  it('pins the root-selected immutable BtbN LGPL archive metadata', () => {
    expect(FFMPEG_TARGETS['win32-x64']).toMatchObject({
      archiveName: 'ffmpeg-n9.0.1-11-ge47273f4d9-win64-lgpl-9.0.zip',
      archiveSha256: '2484854ad6988d34560f4e6ea7a6ecb9dde0af7c229d2591815d056b04ec4f56',
      archiveBytes: 147_007_942,
      archiveRoot: 'ffmpeg-n9.0.1-11-ge47273f4d9-win64-lgpl-9.0',
      buildCommit: '8267213e26c1031621e6e1210fe3aa4867214f6a',
      buildCommitUrl: 'https://github.com/BtbN/FFmpeg-Builds/commit/8267213e26c1031621e6e1210fe3aa4867214f6a',
      ffmpegSourceCommit: 'e47273f4d9227152dcbf543cebaf9e2430ddbcc4',
      ffmpegSourceUrl: 'https://github.com/FFmpeg/FFmpeg/commit/e47273f4d9227152dcbf543cebaf9e2430ddbcc4',
      checksumsSha256: '5a831b23711edf09476291bfbb104cc4e9c78ab6d9a3978ff27da1ee76b01c5b',
    });
    expect(FFMPEG_TARGETS['win32-x64'].downloadUrl).toContain('autobuild-2026-08-31-13-27');
    expect(FFMPEG_TARGETS['win32-x64'].files['ffmpeg.exe']).toMatchObject({
      bytes: 114_400_768,
      sha256: '63a0b3c76a245bc0d986853612d9ec43a2a2d1f1c7a3fa40ee459c248075b3a6',
    });
    expect(FFMPEG_TARGETS['win32-x64'].files['FFMPEG_LICENSE.txt']).toMatchObject({
      bytes: 7_651,
      sha256: 'da7eabb7bafdf7d3ae5e9f223aa5bdc1eece45ac569dc21b3b037520b4464768',
    });
  });
});
