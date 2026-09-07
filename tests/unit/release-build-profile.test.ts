import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { publicReleaseProfileProblems, publicReleaseProfileSummaryProblems, sanitizePublicReleaseProfile } from '../../scripts/release-build-profile.mjs';

const commit = '0123456789abcdef0123456789abcdef01234567';
const builtAt = '2026-09-07T00:00:00.000Z';
const recordedAt = '2026-09-07T00:01:00.000Z';
const artifactHash = 'a'.repeat(64);

type Bundle = ReturnType<typeof validBundle>;

function validBundle() {
  const source = { schemaVersion: 1, gitCommit: commit, gitDirty: false, gitStatusHash: null, builtAt, recordedAt: builtAt };
  const sourceForReceipt = { schemaVersion: 1, gitCommit: commit, gitDirty: false, gitStatusHash: null, builtAt, recordedAt: builtAt };
  return {
    profile: {
      schemaVersion: 1,
      producer: '.github/workflows/package-win-manual.yml',
      cloudGatewaySeedProfile: 'keyless-public',
      repositoryPrivate: false,
      repositoryVisibility: 'public',
      sourceGitCommit: commit,
      cloudGatewaySeedIncluded: false,
      azureSpeechSeedIncluded: false,
      credentialSeedIncluded: false,
      microsoftGraphSeedIncluded: false,
      limitations: ['Cloud gateway and Azure Speech are not preconfigured in this installer.'],
    },
    source,
    receipt: {
      schemaVersion: 1,
      recordedAt,
      source: sourceForReceipt,
      outputs: {
        directories: [{ path: 'dist', sha256: artifactHash, fileCount: 1 }],
        entrypoints: [{ path: 'dist/index.html', mtimeMs: 1 }],
      },
    },
    manifest: {
      version: '0.18.0-moe.20',
      artifacts: [
        { name: 'Ministry of Education-0.18.0-moe.20-win-x64.exe', kind: 'installer', sha256: artifactHash, source: sourceForReceipt },
        { name: 'win:app.asar', kind: 'asar', sha256: artifactHash, source: sourceForReceipt },
      ],
    },
  };
}

function writeBundle(bundle: Bundle) {
  const dir = mkdtempSync(join(tmpdir(), 'release-build-profile-'));
  mkdirSync(dir, { recursive: true });
  const paths = {
    profile: join(dir, 'profile.json'),
    source: join(dir, 'source.json'),
    receipt: join(dir, 'receipt.json'),
    manifest: join(dir, 'manifest.json'),
  };
  writeFileSync(paths.profile, JSON.stringify(bundle.profile));
  writeFileSync(paths.source, JSON.stringify(bundle.source));
  writeFileSync(paths.receipt, JSON.stringify(bundle.receipt));
  writeFileSync(paths.manifest, JSON.stringify(bundle.manifest));
  return paths;
}

function runCli(bundle: Bundle, overrides: Partial<ReturnType<typeof writeBundle>> = {}) {
  const paths = { ...writeBundle(bundle), ...overrides };
  return spawnSync(process.execPath, [
    'scripts/release-build-profile.mjs',
    'check-public-release',
    '--profile', paths.profile,
    '--source', paths.source,
    '--receipt', paths.receipt,
    '--manifest', paths.manifest,
  ], { cwd: process.cwd(), encoding: 'utf8' });
}

function runCliWith(mutator: (bundle: Bundle) => void) {
  const bundle = validBundle();
  mutator(bundle);
  return runCli(bundle);
}

describe('release build profile publication guard', () => {
  it('accepts a public keyless build profile bound to source, receipt and manifest artifacts', () => {
    const bundle = validBundle();
    expect(publicReleaseProfileProblems(bundle)).toEqual([]);
    const result = runCli(bundle);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('PASS: selected Windows build provenance is public keyless and source-bound');
  });

  it('accepts the sanitized profile summary replayed from a release-evidence bundle', () => {
    const bundle = validBundle();
    const sanitized = sanitizePublicReleaseProfile(bundle.profile);

    expect(sanitized).not.toHaveProperty('limitations');
    expect(publicReleaseProfileSummaryProblems({ profile: sanitized, manifest: bundle.manifest })).toEqual([]);
  });

  it('rejects sanitized profile summaries that are malformed or mismatched to manifest source', () => {
    const bundle = validBundle();
    expect(publicReleaseProfileSummaryProblems({
      profile: { ...sanitizePublicReleaseProfile(bundle.profile), schemaVersion: 2 },
      manifest: bundle.manifest,
    })).toContain('release-build-profile has unsupported schema.');
    expect(publicReleaseProfileSummaryProblems({
      profile: { ...sanitizePublicReleaseProfile(bundle.profile), sourceGitCommit: 'f'.repeat(40) },
      manifest: bundle.manifest,
    })).toContain('release-build-profile sourceGitCommit does not match release-build-source.');
  });

  it('executable CLI rejects missing, invalid or mismatched profile commits', () => {
    const missingResult = runCli(validBundle(), { profile: join(mkdtempSync(join(tmpdir(), 'release-build-profile-missing-')), 'missing-profile.json') });
    expect(missingResult.status).toBe(2);
    expect(missingResult.stderr).toContain('release-build-profile is missing');

    const invalid = runCliWith((bundle) => { bundle.profile.sourceGitCommit = 'x'.repeat(40); });
    expect(invalid.status).toBe(3);
    expect(invalid.stderr).toContain('release-build-profile is missing a valid sourceGitCommit.');

    const mismatch = runCliWith((bundle) => { bundle.profile.sourceGitCommit = 'f'.repeat(40); });
    expect(mismatch.status).toBe(3);
    expect(mismatch.stderr).toContain('release-build-profile sourceGitCommit does not match release-build-source.');
  });

  it('executable CLI rejects unsupported producer and non-keyless profile labels', () => {
    const producer = runCliWith((bundle) => { bundle.profile.producer = 'manual-label'; });
    expect(producer.status).toBe(3);
    expect(producer.stderr).toContain('release-build-profile producer is unsupported.');

    const seeded = runCliWith((bundle) => { bundle.profile.cloudGatewaySeedProfile = 'seeded-private'; });
    expect(seeded.status).toBe(3);
    expect(seeded.stderr).toContain('Windows release publication requires a keyless-public build profile.');
  });

  it('executable CLI rejects credential seed booleans and private/public visibility contradictions', () => {
    for (const field of ['cloudGatewaySeedIncluded', 'azureSpeechSeedIncluded', 'credentialSeedIncluded'] as const) {
      const result = runCliWith((bundle) => { bundle.profile[field] = true; });
      expect(result.status).toBe(3);
      expect(result.stderr).toContain('Windows release publication requires no credential-bearing seeds in the selected build.');
    }

    const privateFlag = runCliWith((bundle) => { bundle.profile.repositoryPrivate = true; });
    expect(privateFlag.status).toBe(3);
    expect(privateFlag.stderr).toContain('release-build-profile repositoryPrivate must be false for public release publication.');

    const privateVisibility = runCliWith((bundle) => { bundle.profile.repositoryVisibility = 'private'; });
    expect(privateVisibility.status).toBe(3);
    expect(privateVisibility.stderr).toContain('release-build-profile repositoryVisibility must be public for public release publication.');

    const missingGraphBoolean = runCliWith((bundle) => { bundle.profile.microsoftGraphSeedIncluded = undefined as unknown as boolean; });
    expect(missingGraphBoolean.status).toBe(3);
    expect(missingGraphBoolean.stderr).toContain('release-build-profile must record microsoftGraphSeedIncluded as a boolean.');
  });

  it('executable CLI rejects dirty source, receipt/source mismatch and manifest/source mismatch', () => {
    const dirty = runCliWith((bundle) => { bundle.source.gitDirty = true; });
    expect(dirty.status).toBe(3);
    expect(dirty.stderr).toContain('release-build-source must be clean for public release publication.');

    const receiptMismatch = runCliWith((bundle) => { bundle.receipt.source.gitCommit = 'f'.repeat(40); });
    expect(receiptMismatch.status).toBe(3);
    expect(receiptMismatch.stderr).toContain('release-build-output receipt source does not match release-build-source.');

    const manifestMismatch = runCliWith((bundle) => { bundle.manifest.artifacts[0].source.gitCommit = 'f'.repeat(40); });
    expect(manifestMismatch.status).toBe(3);
    expect(manifestMismatch.stderr).toContain('Ministry of Education-0.18.0-moe.20-win-x64.exe: manifest artifact source does not match release-build-source.');
  });
});
