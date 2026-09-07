import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  collectWindowsBuildSummary,
  renderWindowsBuildSummary,
  sanitizeMarkdownTableValue,
  writeWindowsBuildSummary,
} from '../../scripts/windows-build-summary.mjs';

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(path.join(tmpdir(), 'windows-build-summary-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runnerWith(responses: Record<string, { status: number; stdout?: string; error?: Error }>, calls: Array<{ command: string; args: string[]; timeout?: number }> = []) {
  return (command: string, args: string[], options?: { timeout?: number }) => {
    calls.push({ command, args, timeout: options?.timeout });
    const key = [command, ...args].join(' ');
    return responses[key] ?? { status: 1, stdout: '' };
  };
}

describe('Windows build summary', () => {
  it('escapes markdown table metacharacters and removes line breaks from dynamic values', () => {
    expect(sanitizeMarkdownTableValue('main|release\r\nINJECT')).toBe('main\\|release INJECT');
    const summary = renderWindowsBuildSummary({
      workflowRun: '1|2',
      requestedRef: 'branch\n| injected | row |',
      checkedOutSha: 'abc',
      buildProfile: 'keyless-public',
      sourceRecordSha: '',
      buildReceiptSha: '',
      nodeVersion: 'v24',
      pnpmVersion: '10',
      dotnetVersion: '8',
      pnpmCacheRestoreOutcome: 'success',
      dependencyInstallOutcome: 'success',
      pnpmCacheSaveOutcome: 'failure\r\n| injected |',
      preflightOutcome: 'success',
      windowsBinaryPrepOutcome: 'success',
      compileAndBundleOutcome: 'success',
      installerOutcome: 'success',
      phases: 'a|b',
    });

    expect(summary).toContain('1\\|2');
    expect(summary).toContain('branch \\| injected \\| row \\|');
    expect(summary).toContain('failure \\| injected \\|');
    expect(summary).not.toContain('| injected | row |');
  });

  it('uses actual git checkout SHA and the nested receipt source commit', () => withTempDir((dir) => {
    mkdirSync(path.join(dir, '.tmp'), { recursive: true });
    writeFileSync(path.join(dir, '.release-build-source.json'), JSON.stringify({ gitCommit: 'source-top' }), 'utf8');
    writeFileSync(path.join(dir, '.tmp', 'release-build-output.json'), JSON.stringify({ gitCommit: 'wrong-top', source: { gitCommit: 'receipt-source' } }), 'utf8');

    const summary = collectWindowsBuildSummary({
      cwd: dir,
      env: { GITHUB_SHA: 'event-sha', BUILD_REF_INPUT: 'refs/heads/main' },
      platform: 'linux',
      runner: runnerWith({
        'git rev-parse HEAD': { status: 0, stdout: 'checkout-sha\n' },
        'node --version': { status: 0, stdout: 'v24.0.0\n' },
        'pnpm --version': { status: 0, stdout: '10.0.0\n' },
        'dotnet --version': { status: 0, stdout: '8.0.424\n' },
      }) as never,
    });

    expect(summary.checkedOutSha).toBe('checkout-sha');
    expect(summary.sourceRecordSha).toBe('source-top');
    expect(summary.buildReceiptSha).toBe('receipt-source');
  }));

  it('records cache/install/build outcomes and keeps tool probes fail-soft', () => {
    const summary = collectWindowsBuildSummary({
      env: {
        PNPM_CACHE_RESTORE_OUTCOME: 'success',
        INSTALL_DEPENDENCIES_OUTCOME: 'success',
        PNPM_CACHE_SAVE_OUTCOME: 'failure',
        PREFLIGHT_OUTCOME: 'skipped',
        PREP_WIN_BINARIES_OUTCOME: 'skipped',
        COMPILE_AND_BUNDLE_OUTCOME: 'skipped',
        BUILD_WINDOWS_INSTALLER_OUTCOME: 'skipped',
      },
      platform: 'linux',
      runner: runnerWith({
        'git rev-parse HEAD': { status: 0, stdout: 'checkout-sha\n' },
        'node --version': { status: 1, stdout: '' },
        'pnpm --version': { status: 0, stdout: '10.0.0\n' },
        'dotnet --version': { status: 1, error: new Error('missing dotnet') },
      }) as never,
    });

    expect(summary.nodeVersion).toBe('unavailable');
    expect(summary.dotnetVersion).toBe('unavailable');
    expect(summary.pnpmVersion).toBe('10.0.0');
    expect(summary.pnpmCacheRestoreOutcome).toBe('success');
    expect(summary.dependencyInstallOutcome).toBe('success');
    expect(summary.pnpmCacheSaveOutcome).toBe('failure');
    expect(summary.preflightOutcome).toBe('skipped');
  });

  it('uses a Windows-safe fixed pnpm version probe and bounds diagnostic spawns', () => {
    const calls: Array<{ command: string; args: string[]; timeout?: number }> = [];
    const summary = collectWindowsBuildSummary({
      platform: 'win32',
      runner: runnerWith({
        'git rev-parse HEAD': { status: 0, stdout: 'checkout-sha\n' },
        'node --version': { status: 0, stdout: 'v24.0.0\n' },
        'cmd.exe /d /s /c pnpm --version': { status: 0, stdout: '10.0.0\n' },
        'dotnet --version': { status: 0, stdout: '8.0.424\n' },
      }, calls) as never,
    });

    expect(summary.pnpmVersion).toBe('10.0.0');
    expect(calls).toContainEqual({ command: 'cmd.exe', args: ['/d', '/s', '/c', 'pnpm --version'], timeout: 5_000 });
    expect(calls.every((call) => call.timeout === 5_000)).toBe(true);
    expect(calls).not.toContainEqual(expect.objectContaining({ command: 'pnpm' }));
  });

  it('writes only the allowlisted markdown summary to the requested file', () => withTempDir((dir) => {
    const summaryPath = path.join(dir, 'summary.md');
    const wrote = writeWindowsBuildSummary({
      summaryPath,
      cwd: dir,
      env: {
        GITHUB_RUN_ID: 'run-123',
        BUILD_REF_INPUT: 'main|release',
        BUILD_PROFILE_INPUT: 'keyless-public',
        CLOUD_GATEWAY_CONFIG_JSON: 'secret-json',
        AZURE_SPEECH_KEY: 'secret-key',
      },
      platform: 'linux',
      runner: runnerWith({
        'git rev-parse HEAD': { status: 0, stdout: 'checkout-sha\n' },
      }) as never,
    });
    const summary = readFileSync(summaryPath, 'utf8');

    expect(wrote).toBe(true);
    expect(summary).toContain('Windows package build summary');
    expect(summary).toContain('main\\|release');
    expect(summary).toContain('checkout-sha');
    expect(summary).not.toContain('secret-json');
    expect(summary).not.toContain('secret-key');
  }));
});
