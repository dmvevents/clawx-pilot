#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function firstLine(value) {
  return String(value ?? '').split(/\r?\n/)[0]?.trim() ?? '';
}

export function sanitizeMarkdownTableValue(value) {
  return String(value ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\|/g, '\\|')
    .trim();
}

export function readJsonCommit(filePath, selector = 'gitCommit') {
  if (!existsSync(filePath)) return '';
  try {
    const record = JSON.parse(readFileSync(filePath, 'utf8'));
    const value = selector === 'source.gitCommit' ? record?.source?.gitCommit : record?.gitCommit;
    return typeof value === 'string' ? value : '';
  } catch {
    return 'unavailable';
  }
}

export function runCommandFirstLine(command, args = [], { cwd = process.cwd(), runner = spawnSync, timeout = 5_000 } = {}) {
  try {
    const result = runner(command, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout,
    });
    if (result?.status !== 0 || result?.error) return 'unavailable';
    return firstLine(result.stdout);
  } catch {
    return 'unavailable';
  }
}

function pnpmVersionCommand(platform) {
  return platform === 'win32'
    ? { command: 'cmd.exe', args: ['/d', '/s', '/c', 'pnpm --version'] }
    : { command: 'pnpm', args: ['--version'] };
}

export function collectWindowsBuildSummary({ env = process.env, cwd = process.cwd(), runner = spawnSync, platform = process.platform } = {}) {
  const pnpmCommand = pnpmVersionCommand(platform);
  return {
    workflowRun: env.GITHUB_RUN_ID ?? '',
    requestedRef: env.BUILD_REF_INPUT ?? '',
    checkedOutSha: runCommandFirstLine('git', ['rev-parse', 'HEAD'], { cwd, runner }),
    buildProfile: env.BUILD_PROFILE_INPUT ?? '',
    sourceRecordSha: readJsonCommit(path.join(cwd, '.release-build-source.json'), 'gitCommit'),
    buildReceiptSha: readJsonCommit(path.join(cwd, '.tmp', 'release-build-output.json'), 'source.gitCommit'),
    nodeVersion: runCommandFirstLine('node', ['--version'], { cwd, runner }),
    pnpmVersion: runCommandFirstLine(pnpmCommand.command, pnpmCommand.args, { cwd, runner }),
    dotnetVersion: runCommandFirstLine('dotnet', ['--version'], { cwd, runner }),
    pnpmCacheRestoreOutcome: env.PNPM_CACHE_RESTORE_OUTCOME ?? '',
    dependencyInstallOutcome: env.INSTALL_DEPENDENCIES_OUTCOME ?? '',
    pnpmCacheSaveOutcome: env.PNPM_CACHE_SAVE_OUTCOME ?? '',
    preflightOutcome: env.PREFLIGHT_OUTCOME ?? '',
    windowsBinaryPrepOutcome: env.PREP_WIN_BINARIES_OUTCOME ?? '',
    compileAndBundleOutcome: env.COMPILE_AND_BUNDLE_OUTCOME ?? '',
    installerOutcome: env.BUILD_WINDOWS_INSTALLER_OUTCOME ?? '',
    phases: 'restore pnpm cache; install dependencies; save pnpm cache; preflight; prep:win-binaries; package; run-electron-builder --win --publish never',
  };
}

export function renderWindowsBuildSummary(data) {
  const rows = [
    ['Workflow run', data.workflowRun],
    ['Requested ref', data.requestedRef],
    ['Checked out SHA', data.checkedOutSha],
    ['Build profile', data.buildProfile],
    ['Source record SHA', data.sourceRecordSha],
    ['Build receipt SHA', data.buildReceiptSha],
    ['Node', data.nodeVersion],
    ['pnpm', data.pnpmVersion],
    ['dotnet', data.dotnetVersion],
    ['pnpm cache restore outcome', data.pnpmCacheRestoreOutcome],
    ['Dependency install outcome', data.dependencyInstallOutcome],
    ['pnpm cache save outcome', data.pnpmCacheSaveOutcome],
    ['Preflight outcome', data.preflightOutcome],
    ['Windows binary prep outcome', data.windowsBinaryPrepOutcome],
    ['Compile and bundle outcome', data.compileAndBundleOutcome],
    ['Installer outcome', data.installerOutcome],
    ['Phases', data.phases],
  ];
  return [
    '## Windows package build summary',
    '',
    '| Field | Value |',
    '| --- | --- |',
    ...rows.map(([label, value]) => `| ${sanitizeMarkdownTableValue(label)} | ${sanitizeMarkdownTableValue(value)} |`),
    '',
  ].join('\n');
}

export function writeWindowsBuildSummary({ summaryPath = process.env.GITHUB_STEP_SUMMARY, env = process.env, cwd = process.cwd(), runner = spawnSync } = {}) {
  if (!summaryPath) return false;
  const summary = renderWindowsBuildSummary(collectWindowsBuildSummary({ env, cwd, runner }));
  appendFileSync(summaryPath, summary, 'utf8');
  return true;
}

const invokedAsScript = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (invokedAsScript) {
  writeWindowsBuildSummary();
}
