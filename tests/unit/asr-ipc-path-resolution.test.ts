import { describe, expect, it } from 'vitest';
import { getPathLookupCommand, parsePathLookupOutput } from '@electron/main/asr-ipc';

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
});
