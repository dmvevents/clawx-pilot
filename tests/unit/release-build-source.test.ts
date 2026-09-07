import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error - plain .mjs module without type declarations
import { assertSameSourceState, readCurrentSource, readRecordedBuildOutputReceipt, readRecordedBuildSource, readVerifiedBuildOutputReceipt, readVerifiedBuildSource, recordBuildOutputReceipt, recordBuildSource } from '../../scripts/release-build-source.mjs';

let repoDir: string;

function git(args: string[]): void {
  const result = spawnSync('git', args, { cwd: repoDir, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
}

beforeEach(() => {
  repoDir = mkdtempSync(join(tmpdir(), 'clwx-source-'));
  git(['init']);
  git(['config', 'user.email', 'test@example.invalid']);
  git(['config', 'user.name', 'Test']);
  writeFileSync(join(repoDir, '.gitignore'), '.release-build-source.json\n.tmp/\ndist/\ndist-electron/\n');
  writeFileSync(join(repoDir, 'package.json'), '{"name":"fixture"}\n');
  git(['add', '.gitignore', 'package.json']);
  git(['commit', '-m', 'fixture']);
});

afterEach(() => {
  rmSync(repoDir, { recursive: true, force: true });
});

function writeCompiledOutputs(mtimeIso: string): void {
  mkdirSync(join(repoDir, 'dist', 'assets'), { recursive: true });
  mkdirSync(join(repoDir, 'dist-electron', 'main'), { recursive: true });
  writeFileSync(join(repoDir, 'dist', 'index.html'), '<div id="root"></div>\n');
  writeFileSync(join(repoDir, 'dist', 'assets', 'app.js'), 'console.log("fresh");\n');
  writeFileSync(join(repoDir, 'dist-electron', 'main', 'index.js'), 'require("./preload.js");\n');
  writeFileSync(join(repoDir, 'dist-electron', 'main', 'preload.js'), 'module.exports = {};\n');
  const mtime = new Date(mtimeIso);
  for (const file of [
    join(repoDir, 'dist', 'index.html'),
    join(repoDir, 'dist', 'assets', 'app.js'),
    join(repoDir, 'dist-electron', 'main', 'index.js'),
    join(repoDir, 'dist-electron', 'main', 'preload.js'),
  ]) {
    utimesSync(file, mtime, mtime);
  }
}

describe('release-build-source (CLWX-106)', () => {
  it('records the current commit, dirty bit, and timestamp before packaging', () => {
    const source = recordBuildSource({
      root: repoDir,
      outputPath: join(repoDir, '.release-build-source.json'),
      now: () => '2026-09-07T00:00:00.000Z',
    });
    expect(source.gitCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(source.gitDirty).toBe(false);
    expect(source.gitStatusHash).toBeNull();
    expect(source.builtAt).toBe('2026-09-07T00:00:00.000Z');
    expect(source.recordedAt).toBe('2026-09-07T00:00:00.000Z');
    expect(assertSameSourceState(source, { root: repoDir })).toBe(true);
  });

  it('fails verification when source state changes after the record', () => {
    const sourcePath = join(repoDir, '.release-build-source.json');
    const source = recordBuildSource({
      root: repoDir,
      outputPath: sourcePath,
      now: () => '2026-09-07T00:00:00.000Z',
    });
    expect(readVerifiedBuildSource({ root: repoDir, sourcePath, label: 'builder start' })).toEqual(source);
    writeFileSync(join(repoDir, 'changed.txt'), 'new source\n');
    expect(() => assertSameSourceState(source, { root: repoDir, label: 'test source' })).toThrow(/test source changed/);
    expect(() => readVerifiedBuildSource({ root: repoDir, sourcePath, label: 'builder end' })).toThrow(/builder end changed/);
    const current = readCurrentSource({ root: repoDir });
    expect(current.gitCommit).toBe(source.gitCommit);
    expect(current.gitDirty).toBe(true);
    expect(current.gitStatusHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hashes dirty file bytes, not only the git status row', () => {
    writeFileSync(join(repoDir, 'tracked.txt'), 'first\n');
    git(['add', 'tracked.txt']);
    git(['commit', '-m', 'add tracked']);
    const clean = recordBuildSource({
      root: repoDir,
      outputPath: join(repoDir, '.release-build-source.json'),
      now: () => '2026-09-07T00:00:00.000Z',
    });
    writeFileSync(join(repoDir, 'tracked.txt'), 'dirty-one\n');
    const firstDirty = readCurrentSource({ root: repoDir });
    writeFileSync(join(repoDir, 'tracked.txt'), 'dirty-two\n');
    const secondDirty = readCurrentSource({ root: repoDir });

    expect(firstDirty.gitCommit).toBe(clean.gitCommit);
    expect(firstDirty.gitDirty).toBe(true);
    expect(firstDirty.gitStatusHash).toMatch(/^[0-9a-f]{64}$/);
    expect(secondDirty.gitStatusHash).toMatch(/^[0-9a-f]{64}$/);
    expect(secondDirty.gitStatusHash).not.toBe(firstDirty.gitStatusHash);
  });

  it('excludes generated release evidence and release manifests from source status', () => {
    const clean = readCurrentSource({ root: repoDir });
    writeFileSync(join(repoDir, 'docs-evidence-unrelated.txt'), 'included\n');
    const included = readCurrentSource({ root: repoDir });
    expect(included.gitDirty).toBe(true);

    git(['add', 'docs-evidence-unrelated.txt']);
    git(['commit', '-m', 'add unrelated']);
    mkdirSync(join(repoDir, 'docs', 'evidence'), { recursive: true });
    mkdirSync(join(repoDir, 'docs', 'release-manifests'), { recursive: true });
    writeFileSync(join(repoDir, 'docs', 'evidence', 'run.json'), 'generated\n');
    writeFileSync(join(repoDir, 'docs', 'release-manifests', 'v.json'), 'generated\n');
    const source = readCurrentSource({ root: repoDir });
    expect(source.gitCommit).not.toBe(clean.gitCommit);
    expect(source.gitDirty).toBe(false);
    expect(source.gitStatusHash).toBeNull();
  });

  it('records and verifies a fresh compiled output receipt bound to the source record', () => {
    const sourcePath = join(repoDir, '.release-build-source.json');
    const receiptPath = join(repoDir, '.tmp', 'release-build-output.json');
    recordBuildSource({
      root: repoDir,
      outputPath: sourcePath,
      now: () => '2026-09-07T00:00:00.000Z',
    });
    writeCompiledOutputs('2026-09-07T00:01:00.000Z');

    const receipt = recordBuildOutputReceipt({
      root: repoDir,
      sourcePath,
      outputPath: receiptPath,
      now: () => '2026-09-07T00:02:00.000Z',
      nowMs: Date.parse('2026-09-07T00:03:00.000Z'),
    });

    expect(receipt.source.gitCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(receipt.outputs.directories.map((record: { path: string }) => record.path).sort()).toEqual(['dist', 'dist-electron']);
    expect(receipt.outputs.entrypoints.map((record: { path: string }) => record.path).sort()).toEqual(['dist-electron/main/index.js', 'dist/index.html']);
    expect(readVerifiedBuildOutputReceipt({ root: repoDir, sourcePath, receiptPath, label: 'test compiled output' })).toEqual(receipt);
  });

  it('does not let a direct source record mark missing compiled outputs as ready', () => {
    const sourcePath = join(repoDir, '.release-build-source.json');
    const receiptPath = join(repoDir, '.tmp', 'release-build-output.json');
    recordBuildSource({
      root: repoDir,
      outputPath: sourcePath,
      now: () => '2026-09-07T00:00:00.000Z',
    });

    expect(() => readRecordedBuildOutputReceipt({ receiptPath })).toThrow(/build output receipt is missing/);
    expect(() => readVerifiedBuildOutputReceipt({ root: repoDir, sourcePath, receiptPath, label: 'missing receipt' })).toThrow(/build output receipt is missing/);
  });

  it('rejects stale compiled entrypoints older than the source record', () => {
    const sourcePath = join(repoDir, '.release-build-source.json');
    recordBuildSource({
      root: repoDir,
      outputPath: sourcePath,
      now: () => '2026-09-07T00:00:00.000Z',
    });
    writeCompiledOutputs('2026-09-06T23:59:00.000Z');

    expect(() => recordBuildOutputReceipt({
      root: repoDir,
      sourcePath,
      outputPath: join(repoDir, '.tmp', 'release-build-output.json'),
      now: () => '2026-09-07T00:02:00.000Z',
      nowMs: Date.parse('2026-09-07T00:03:00.000Z'),
    })).toThrow(/older than build source record/);
  });

  it('rejects ignored compiled byte changes after the output receipt is recorded', () => {
    const sourcePath = join(repoDir, '.release-build-source.json');
    const receiptPath = join(repoDir, '.tmp', 'release-build-output.json');
    recordBuildSource({
      root: repoDir,
      outputPath: sourcePath,
      now: () => '2026-09-07T00:00:00.000Z',
    });
    writeCompiledOutputs('2026-09-07T00:01:00.000Z');
    recordBuildOutputReceipt({
      root: repoDir,
      sourcePath,
      outputPath: receiptPath,
      now: () => '2026-09-07T00:02:00.000Z',
      nowMs: Date.parse('2026-09-07T00:03:00.000Z'),
    });

    writeFileSync(join(repoDir, 'dist', 'assets', 'app.js'), 'console.log("mutated compiled bytes");\n');

    expect(() => readVerifiedBuildOutputReceipt({ root: repoDir, sourcePath, receiptPath, label: 'compiled bytes' })).toThrow(/compiled bytes changed/);
  });

  it('rejects invalid or future recorded source timestamps', () => {
    const sourcePath = join(repoDir, '.release-build-source.json');
    const base = {
      schemaVersion: 1,
      gitCommit: readCurrentSource({ root: repoDir }).gitCommit,
      gitDirty: false,
      gitStatusHash: null,
    };
    writeFileSync(sourcePath, JSON.stringify({ ...base, builtAt: 'not-a-date' }));
    expect(() => readRecordedBuildSource({ sourcePath })).toThrow(/invalid builtAt/);

    writeFileSync(sourcePath, JSON.stringify({ ...base, builtAt: '2999-01-01T00:00:00.000Z' }));
    expect(() => readRecordedBuildSource({ sourcePath, nowMs: Date.parse('2026-09-07T00:00:00.000Z') })).toThrow(/builtAt is in the future/);
  });
});
