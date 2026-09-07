import { describe, expect, it } from 'vitest';
// @ts-expect-error - plain .mjs module without type declarations
import { assertNoDirectPublish, prepareBuilderArgs, runElectronBuilderWrapper } from '../../scripts/run-electron-builder.mjs';

describe('run-electron-builder publish staging (CLWX-106)', () => {
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

});
