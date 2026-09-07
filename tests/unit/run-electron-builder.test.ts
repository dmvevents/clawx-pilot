import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error - plain .mjs module without type declarations
import { assertNoDirectPublish, assertWindowsHelperInputs, assertWindowsUnpackedHelpers, prepareBuilderArgs, runElectronBuilderWrapper } from '../../scripts/run-electron-builder.mjs';

describe('run-electron-builder publish staging (CLWX-106)', () => {
  function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  const fakeFfmpegTarget = {
    archiveName: 'ffmpeg.zip',
    archiveSha256: sha256('archive'),
    archiveBytes: 7,
    downloadUrl: 'https://example.test/ffmpeg.zip',
    archiveRoot: 'ffmpeg-root',
    buildCommit: 'b'.repeat(40),
    buildCommitUrl: `https://example.test/build/${'b'.repeat(40)}`,
    ffmpegSourceCommit: 'f'.repeat(40),
    ffmpegSourceUrl: `https://example.test/ffmpeg/${'f'.repeat(40)}`,
    checksumsSha256: 'c'.repeat(64),
    files: {
      'ffmpeg.exe': { source: 'bin/ffmpeg.exe', bytes: 6, sha256: sha256('ffmpeg') },
      'FFMPEG_LICENSE.txt': { source: 'LICENSE.txt', bytes: 7, sha256: sha256('license') },
    },
  };

  function writeFakeHelpers(bin: string): void {
    mkdirSync(bin, { recursive: true });
    for (const name of ['node.exe', 'uv.exe', 'WinSpeechRecognize.exe', 'WinSpeechRecognize.exe.config']) {
      writeFileSync(join(bin, name), name);
    }
    writeFileSync(join(bin, 'ffmpeg.exe'), 'ffmpeg');
    writeFileSync(join(bin, 'FFMPEG_LICENSE.txt'), 'license');
    writeFileSync(join(bin, 'THIRD_PARTY_FFMPEG.txt'), [
      fakeFfmpegTarget.archiveSha256,
      fakeFfmpegTarget.files['ffmpeg.exe'].sha256,
      fakeFfmpegTarget.files['FFMPEG_LICENSE.txt'].sha256,
    ].join('\n'));
    writeFileSync(join(bin, 'FFMPEG_PROVENANCE.json'), JSON.stringify({
      schemaVersion: 1,
      target: 'win32-x64',
      archive: {
        name: fakeFfmpegTarget.archiveName,
        url: fakeFfmpegTarget.downloadUrl,
        sha256: fakeFfmpegTarget.archiveSha256,
        bytes: fakeFfmpegTarget.archiveBytes,
        root: fakeFfmpegTarget.archiveRoot,
      },
      upstream: {
        buildCommit: fakeFfmpegTarget.buildCommit,
        buildCommitUrl: fakeFfmpegTarget.buildCommitUrl,
        ffmpegSourceCommit: fakeFfmpegTarget.ffmpegSourceCommit,
        ffmpegSourceUrl: fakeFfmpegTarget.ffmpegSourceUrl,
        checksumsSha256: fakeFfmpegTarget.checksumsSha256,
      },
      files: fakeFfmpegTarget.files,
    }));
  }

  it('rejects explicit publish requests before the builder is spawned', () => {
    expect(() => assertNoDirectPublish(['--win', '--publish', 'always'], {})).toThrow(/Direct electron-builder publication is disabled/);
    expect(() => assertNoDirectPublish(['--mac', '--publish=onTagOrDraft'], {})).toThrow(/Direct electron-builder publication is disabled/);
    expect(() => assertNoDirectPublish(['--linux', '-p', 'always'], {})).toThrow(/Direct electron-builder publication is disabled/);
    expect(() => assertNoDirectPublish(['--win', '--publish'], {})).toThrow(/Direct electron-builder publication is disabled/);
    expect(() => assertNoDirectPublish(['--win', '-p=always'], {})).toThrow(/Direct electron-builder publication is disabled/);
    expect(() => assertNoDirectPublish(['--win', '-palways'], {})).toThrow(/Direct electron-builder publication is disabled/);
    expect(() => assertNoDirectPublish(['--win', '--publish', 'never', '--publish', 'never'], {})).toThrow(/Direct electron-builder publication is disabled/);
  });

  it('preserves explicit never and adds never under CI default-publish risk', () => {
    expect(assertNoDirectPublish(['--win', '--publish', 'never'], {}).args).toEqual(['--win', '--publish', 'never']);
    expect(assertNoDirectPublish(['--win', '--publish=never'], {}).args).toEqual(['--win', '--publish=never']);
    expect(assertNoDirectPublish(['--win', '-p=never'], {}).args).toEqual(['--win', '-p=never']);
    expect(assertNoDirectPublish(['--win', '-pnever'], {}).args).toEqual(['--win', '-pnever']);
    expect(prepareBuilderArgs(['--win', '--publish', 'never'], {}).publishRejected).toBe(false);
    expect(prepareBuilderArgs(['--win'], {}).args).toEqual(['--win', '--publish', 'never']);
    expect(prepareBuilderArgs(['--win'], { CI: 'true' }).args).toEqual(['--win', '--publish', 'never']);
    expect(assertNoDirectPublish(['--win'], { CI: 'true' }).args).toEqual(['--win', '--publish', 'never']);
  });

  it('exits before spawning electron-builder when direct publication is requested', () => {
    const spawned: string[][] = [];
    const exits: number[] = [];
    const verified: string[] = [];
    runElectronBuilderWrapper(['--win', '--publish', 'always'], {}, {
      verifyBuildSource: () => {
        verified.push('source');
        throw new Error('source verification should not run after publish rejection');
      },
      verifyBuildReceipt: () => {
        verified.push('receipt');
        throw new Error('receipt verification should not run after publish rejection');
      },
      spawnElectronBuilder: (argv: string[]) => {
        spawned.push(argv);
        return { on: () => undefined };
      },
      exit: (code: number) => {
        exits.push(code);
      },
      log: () => undefined,
      error: () => undefined,
    });

    expect(exits).toEqual([3]);
    expect(spawned).toEqual([]);
    expect(verified).toEqual([]);
  });

  it('exits before spawning electron-builder when the output receipt is missing', () => {
    const spawned: string[][] = [];
    const exits: number[] = [];
    runElectronBuilderWrapper(['--win'], {}, {
      verifyBuildSource: () => ({
        gitCommit: '0123456789abcdef0123456789abcdef01234567',
        gitDirty: false,
      }),
      verifyBuildReceipt: () => {
        throw new Error('build output receipt is missing: .tmp/release-build-output.json');
      },
      spawnElectronBuilder: (argv: string[]) => {
        spawned.push(argv);
        return { on: () => undefined };
      },
      exit: (code: number) => {
        exits.push(code);
      },
      log: () => undefined,
      error: () => undefined,
    });

    expect(exits).toEqual([3]);
    expect(spawned).toEqual([]);
  });

  it('verifies the output receipt before and after a successful builder run', () => {
    const spawned: string[][] = [];
    const exits: number[] = [];
    const sourceLabels: string[] = [];
    const receiptLabels: string[] = [];
    const handlers: Record<string, (code: number, signal?: NodeJS.Signals | null) => void> = {};

    runElectronBuilderWrapper(['--win'], {}, {
      verifyBuildSource: (label: string) => {
        sourceLabels.push(label);
        return {
          gitCommit: '0123456789abcdef0123456789abcdef01234567',
          gitDirty: false,
        };
      },
      verifyBuildReceipt: (label: string) => {
        receiptLabels.push(label);
        return { source: { gitCommit: '0123456789abcdef0123456789abcdef01234567', gitDirty: false } };
      },
      assertWindowsHelperInputs: () => undefined,
      assertWindowsUnpackedHelpers: () => undefined,
      spawnElectronBuilder: (argv: string[]) => {
        spawned.push(argv);
        return {
          on: (event: string, handler: (code: number, signal?: NodeJS.Signals | null) => void) => {
            handlers[event] = handler;
          },
        };
      },
      recordHashManifest: () => 0,
      exit: (code: number) => {
        exits.push(code);
      },
      log: () => undefined,
      error: () => undefined,
    });

    expect(spawned).toEqual([['--win', '--publish', 'never']]);
    expect(sourceLabels).toEqual(['release build source before electron-builder']);
    expect(receiptLabels).toEqual(['release build output receipt before electron-builder']);

    handlers.exit(0, null);

    expect(sourceLabels).toEqual(['release build source before electron-builder', 'release build source after electron-builder']);
    expect(receiptLabels).toEqual(['release build output receipt before electron-builder', 'release build output receipt after electron-builder']);
    expect(exits).toEqual([0]);
  });

  it('validates required Windows helper inputs before spawning builder', () => {
    const spawned: string[][] = [];
    const exits: number[] = [];
    runElectronBuilderWrapper(['--win'], {}, {
      verifyBuildSource: () => ({
        gitCommit: '0123456789abcdef0123456789abcdef01234567',
        gitDirty: false,
      }),
      verifyBuildReceipt: () => ({ source: { gitCommit: '0123456789abcdef0123456789abcdef01234567', gitDirty: false } }),
      assertWindowsHelperInputs: () => {
        throw new Error('Windows helper ffmpeg.exe is missing');
      },
      spawnElectronBuilder: (argv: string[]) => {
        spawned.push(argv);
        return { on: () => undefined };
      },
      exit: (code: number) => {
        exits.push(code);
      },
      log: () => undefined,
      error: () => undefined,
    });

    expect(exits).toEqual([3]);
    expect(spawned).toEqual([]);
  });

  it('validates packaged Windows helpers before recording the manifest', () => {
    const exits: number[] = [];
    const handlers: Record<string, (code: number, signal?: NodeJS.Signals | null) => void> = {};
    let manifestRecorded = false;
    runElectronBuilderWrapper(['--win'], {}, {
      verifyBuildSource: () => ({
        gitCommit: '0123456789abcdef0123456789abcdef01234567',
        gitDirty: false,
      }),
      verifyBuildReceipt: () => ({ source: { gitCommit: '0123456789abcdef0123456789abcdef01234567', gitDirty: false } }),
      assertWindowsHelperInputs: () => undefined,
      assertWindowsUnpackedHelpers: () => {
        throw new Error('Packaged Windows helper ffmpeg.exe is missing');
      },
      spawnElectronBuilder: () => ({
        on: (event: string, handler: (code: number, signal?: NodeJS.Signals | null) => void) => {
          handlers[event] = handler;
        },
      }),
      recordHashManifest: () => {
        manifestRecorded = true;
        return 0;
      },
      exit: (code: number) => {
        exits.push(code);
      },
      log: () => undefined,
      error: () => undefined,
    });

    handlers.exit(0, null);

    expect(exits).toEqual([3]);
    expect(manifestRecorded).toBe(false);
  });

  it('fails closed when pre-builder ffmpeg.exe is missing or not a file', () => {
    const root = mkdtempSync(join(tmpdir(), 'clwx-builder-pre-'));
    try {
      writeFileSync(join(root, 'electron-builder.yml'), 'win:\n  extraResources:\n    - from: resources/bin/win32-${arch}\n      to: bin\n');
      const bin = join(root, 'resources', 'bin', 'win32-x64');
      mkdirSync(bin, { recursive: true });
      for (const name of ['node.exe', 'uv.exe', 'WinSpeechRecognize.exe', 'WinSpeechRecognize.exe.config']) {
        writeFileSync(join(bin, name), name);
      }
      expect(() => assertWindowsHelperInputs({ root, arch: 'x64', ffmpegTarget: fakeFfmpegTarget })).toThrow(/ffmpeg\.exe.*missing/);
      mkdirSync(join(bin, 'ffmpeg.exe'));
      expect(() => assertWindowsHelperInputs({ root, arch: 'x64', ffmpegTarget: fakeFfmpegTarget })).toThrow(/ffmpeg\.exe.*not a file/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails closed when post-builder installed ffmpeg.exe is missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'clwx-builder-post-'));
    try {
      const bin = join(root, 'release', 'win-unpacked', 'resources', 'bin');
      mkdirSync(bin, { recursive: true });
      for (const name of ['node.exe', 'uv.exe', 'WinSpeechRecognize.exe', 'WinSpeechRecognize.exe.config']) {
        writeFileSync(join(bin, name), name);
      }
      expect(() => assertWindowsUnpackedHelpers({ root, ffmpegTarget: fakeFfmpegTarget })).toThrow(/ffmpeg\.exe.*missing/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails closed when ffmpeg.exe bytes are mutated despite a matching receipt', () => {
    const root = mkdtempSync(join(tmpdir(), 'clwx-builder-mutated-'));
    try {
      writeFileSync(join(root, 'electron-builder.yml'), 'win:\n  extraResources:\n    - from: resources/bin/win32-${arch}\n      to: bin\n');
      const bin = join(root, 'resources', 'bin', 'win32-x64');
      writeFakeHelpers(bin);
      writeFileSync(join(bin, 'ffmpeg.exe'), 'mutated');
      expect(() => assertWindowsHelperInputs({ root, arch: 'x64', ffmpegTarget: fakeFfmpegTarget })).toThrow(/ffmpeg\.exe size mismatch|ffmpeg\.exe checksum mismatch/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails closed when FFmpeg notices or provenance are missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'clwx-builder-notice-'));
    try {
      writeFileSync(join(root, 'electron-builder.yml'), 'win:\n  extraResources:\n    - from: resources/bin/win32-${arch}\n      to: bin\n');
      const bin = join(root, 'resources', 'bin', 'win32-x64');
      writeFakeHelpers(bin);
      rmSync(join(bin, 'THIRD_PARTY_FFMPEG.txt'));
      expect(() => assertWindowsHelperInputs({ root, arch: 'x64', ffmpegTarget: fakeFfmpegTarget })).toThrow(/THIRD_PARTY_FFMPEG\.txt.*missing/);
      writeFakeHelpers(bin);
      rmSync(join(bin, 'FFMPEG_PROVENANCE.json'));
      expect(() => assertWindowsHelperInputs({ root, arch: 'x64', ffmpegTarget: fakeFfmpegTarget })).toThrow(/FFMPEG_PROVENANCE\.json.*missing/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails closed when provenance claims a different archive than the copied bytes', () => {
    const root = mkdtempSync(join(tmpdir(), 'clwx-builder-receipt-'));
    try {
      writeFileSync(join(root, 'electron-builder.yml'), 'win:\n  extraResources:\n    - from: resources/bin/win32-${arch}\n      to: bin\n');
      const bin = join(root, 'resources', 'bin', 'win32-x64');
      writeFakeHelpers(bin);
      const receipt = JSON.parse(JSON.stringify({
        schemaVersion: 1,
        target: 'win32-x64',
        archive: {
          name: 'other.zip',
          url: fakeFfmpegTarget.downloadUrl,
          sha256: fakeFfmpegTarget.archiveSha256,
          bytes: fakeFfmpegTarget.archiveBytes,
          root: fakeFfmpegTarget.archiveRoot,
        },
        upstream: {
          buildCommit: fakeFfmpegTarget.buildCommit,
          buildCommitUrl: fakeFfmpegTarget.buildCommitUrl,
          ffmpegSourceCommit: fakeFfmpegTarget.ffmpegSourceCommit,
          ffmpegSourceUrl: fakeFfmpegTarget.ffmpegSourceUrl,
          checksumsSha256: fakeFfmpegTarget.checksumsSha256,
        },
        files: fakeFfmpegTarget.files,
      }));
      writeFileSync(join(bin, 'FFMPEG_PROVENANCE.json'), JSON.stringify(receipt));
      expect(() => assertWindowsHelperInputs({ root, arch: 'x64', ffmpegTarget: fakeFfmpegTarget })).toThrow(/archive metadata/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

});
