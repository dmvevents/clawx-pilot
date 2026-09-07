import { describe, expect, it } from 'vitest';
import path from 'node:path';
import {
  getFfmpegBinaryName,
  getFfmpegCandidatePaths,
  getPathLookupCommand,
  parsePathLookupOutput,
} from '@electron/main/asr-ipc';

describe('ASR binary path lookup', () => {
  it('uses where.exe for Windows PATH fallback', () => {
    expect(getPathLookupCommand('whisper.exe', 'win32')).toEqual({
      command: 'where.exe',
      args: ['whisper.exe'],
    });
  });

  it('uses which for POSIX PATH fallback', () => {
    expect(getPathLookupCommand('whisper', 'darwin')).toEqual({
      command: '/usr/bin/which',
      args: ['whisper'],
    });
  });

  it('parses the first non-empty path from Windows where.exe output', () => {
    expect(parsePathLookupOutput('\r\nC:\\Tools\\whisper.exe\r\nC:\\Python\\Scripts\\whisper.exe\r\n')).toBe(
      'C:\\Tools\\whisper.exe',
    );
  });

  it('uses the Windows ffmpeg executable name', () => {
    expect(getFfmpegBinaryName('win32')).toBe('ffmpeg.exe');
    expect(getFfmpegBinaryName('darwin')).toBe('ffmpeg');
  });

  it('prefers bundled packaged Windows ffmpeg before dev and PATH fallbacks', () => {
    expect(getFfmpegCandidatePaths({
      platform: 'win32',
      arch: 'x64',
      isPackaged: true,
      resourcesPath: '/installed/resources',
      cwd: '/repo/ClawX',
      appPath: '/installed/resources/app.asar',
    })).toEqual([
      path.join('/installed/resources', 'bin', 'ffmpeg.exe'),
      path.join('/installed/resources', 'bin', 'win32-x64', 'ffmpeg.exe'),
    ]);
  });

  it('checks the repo Windows binary folder in dev builds', () => {
    expect(getFfmpegCandidatePaths({
      platform: 'win32',
      arch: 'x64',
      isPackaged: false,
      cwd: '/repo/ClawX',
      appPath: undefined,
      resourcesPath: undefined,
    })).toEqual([
      path.join('/repo/ClawX', 'resources', 'bin', 'win32-x64', 'ffmpeg.exe'),
      path.join('/repo/ClawX', 'resources', 'bin', 'ffmpeg.exe'),
    ]);
  });
});
