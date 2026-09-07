#!/usr/bin/env node
/** Hosted Windows build profile provenance guard for public release publication. */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COMMIT = /^[0-9a-f]{40}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;
const PRODUCER = '.github/workflows/package-win-manual.yml';

function readJson(file, label) {
  if (!existsSync(file)) throw new Error(`${label} is missing: ${file}`);
  try { return JSON.parse(readFileSync(file, 'utf8')); }
  catch (error) { throw new Error(`${label} is unreadable JSON: ${error.message}`); }
}

function validIso(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function sourceIdentity(source) {
  return {
    gitCommit: source?.gitCommit,
    gitDirty: source?.gitDirty,
    gitStatusHash: source?.gitStatusHash,
    builtAt: source?.builtAt,
  };
}

function sameSource(expected, actual) {
  return ['gitCommit', 'gitDirty', 'gitStatusHash', 'builtAt'].every((key) => expected?.[key] === actual?.[key]);
}

function validateBuildSource(source) {
  const problems = [];
  if (source?.schemaVersion !== 1) problems.push('release-build-source has unsupported schema.');
  if (!COMMIT.test(String(source?.gitCommit ?? ''))) problems.push('release-build-source is missing a valid gitCommit.');
  if (source?.gitDirty !== false) problems.push('release-build-source must be clean for public release publication.');
  if (source?.gitStatusHash !== null) problems.push('release-build-source clean state must have null gitStatusHash.');
  if (!validIso(source?.builtAt)) problems.push('release-build-source is missing a valid builtAt timestamp.');
  return problems;
}

export function publicReleaseProfileProblems({ profile, source, receipt, manifest }) {
  const problems = [];
  problems.push(...validateBuildSource(source));

  if (profile?.schemaVersion !== 1) problems.push('release-build-profile has unsupported schema.');
  if (profile?.producer !== PRODUCER) problems.push('release-build-profile producer is unsupported.');
  if (profile?.cloudGatewaySeedProfile !== 'keyless-public') problems.push('Windows release publication requires a keyless-public build profile.');
  if (!COMMIT.test(String(profile?.sourceGitCommit ?? ''))) problems.push('release-build-profile is missing a valid sourceGitCommit.');
  if (COMMIT.test(String(profile?.sourceGitCommit ?? '')) && profile.sourceGitCommit !== source?.gitCommit) problems.push('release-build-profile sourceGitCommit does not match release-build-source.');
  if (profile?.repositoryPrivate !== false) problems.push('release-build-profile repositoryPrivate must be false for public release publication.');
  if (profile?.repositoryVisibility !== 'public') problems.push('release-build-profile repositoryVisibility must be public for public release publication.');
  if ((profile?.repositoryPrivate === false) !== (profile?.repositoryVisibility === 'public')) problems.push('release-build-profile repository visibility fields contradict each other.');
  if (profile?.credentialSeedIncluded !== false || profile?.cloudGatewaySeedIncluded !== false || profile?.azureSpeechSeedIncluded !== false) {
    problems.push('Windows release publication requires no credential-bearing seeds in the selected build.');
  }
  if (typeof profile?.microsoftGraphSeedIncluded !== 'boolean') problems.push('release-build-profile must record microsoftGraphSeedIncluded as a boolean.');

  const expectedSource = sourceIdentity(source);
  const receiptSource = sourceIdentity(receipt?.source);
  if (receipt?.schemaVersion !== 1) problems.push('release-build-output receipt has unsupported schema.');
  if (!sameSource(expectedSource, receiptSource)) problems.push('release-build-output receipt source does not match release-build-source.');
  if (!validIso(receipt?.recordedAt)) problems.push('release-build-output receipt is missing a valid recordedAt timestamp.');
  if (!Array.isArray(receipt?.outputs?.directories) || receipt.outputs.directories.length === 0) problems.push('release-build-output receipt is missing compiled directory records.');
  if (!Array.isArray(receipt?.outputs?.entrypoints) || receipt.outputs.entrypoints.length === 0) problems.push('release-build-output receipt is missing entrypoint records.');

  const artifacts = Array.isArray(manifest?.artifacts) ? manifest.artifacts : [];
  if (!manifest || typeof manifest.version !== 'string' || artifacts.length === 0) problems.push('Candidate manifest has no artifact inventory.');
  for (const artifact of artifacts) {
    if (!artifact || typeof artifact.name !== 'string' || !SHA256.test(String(artifact.sha256 ?? ''))) {
      problems.push('Candidate manifest contains an invalid artifact identity.');
      continue;
    }
    if (!sameSource(expectedSource, sourceIdentity(artifact.source))) {
      problems.push(`${artifact.name}: manifest artifact source does not match release-build-source.`);
    }
  }

  return problems;
}

export function validatePublicReleaseProfile({ profilePath, sourcePath, receiptPath, manifestPath }) {
  const profile = readJson(profilePath, 'release-build-profile');
  const source = readJson(sourcePath, 'release-build-source');
  const receipt = readJson(receiptPath, 'release-build-output receipt');
  const manifest = readJson(manifestPath, 'candidate manifest');
  const problems = publicReleaseProfileProblems({ profile, source, receipt, manifest });
  return { ok: problems.length === 0, problems };
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { command };
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i];
    const value = rest[i + 1];
    if (!['--profile', '--source', '--receipt', '--manifest'].includes(key) || !value || Object.hasOwn(options, key.slice(2))) {
      throw new Error('usage: release-build-profile.mjs check-public-release --profile <release-build-profile.json> --source <release-build-source.json> --receipt <release-build-output.json> --manifest <manifest.json>');
    }
    options[key.slice(2)] = value;
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.command !== 'check-public-release' || !options.profile || !options.source || !options.receipt || !options.manifest) {
    throw new Error('usage: release-build-profile.mjs check-public-release --profile <release-build-profile.json> --source <release-build-source.json> --receipt <release-build-output.json> --manifest <manifest.json>');
  }
  const result = validatePublicReleaseProfile({
    profilePath: path.resolve(ROOT, options.profile),
    sourcePath: path.resolve(ROOT, options.source),
    receiptPath: path.resolve(ROOT, options.receipt),
    manifestPath: path.resolve(ROOT, options.manifest),
  });
  for (const problem of result.problems) console.error(`[release-build-profile] ${problem}`);
  console.log(`[release-build-profile] ${result.ok ? 'PASS: selected Windows build provenance is public keyless and source-bound' : 'FAIL: publication blocked'}`);
  process.exitCode = result.ok ? 0 : 3;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[release-build-profile] ${error.message}`);
    process.exitCode = 2;
  });
}
