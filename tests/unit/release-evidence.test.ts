import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RELEASE_REQUIRED_CRITERIA } from '../../scripts/ga-gate-verdict.mjs';
import { automaticPublicationProblems, candidateDigest, candidateProblems, validateReleaseEvidence, writeReleaseEvidence } from '../../scripts/release-evidence.mjs';
import { publishManifest } from '../../scripts/release-hash-manifest.mjs';
import { writeInstalledReleaseEvidenceFixture } from '../fixtures/installed-release-evidence';

const SOURCE = { gitCommit: 'a'.repeat(40), gitDirty: false, gitStatusHash: null };
const BUILD_TIME = '2026-09-07T00:00:00.000Z';
const START = '2026-09-07T02:00:00.000Z';
const END = '2026-09-07T02:05:00.000Z';
const NOW = Date.parse('2026-09-07T03:00:00.000Z');
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
let dir: string;
let releaseDir: string;
let installedDir: string;
let outputDir: string;
let manifest: ReturnType<typeof fixtureManifest>;

function fixtureManifest() {
  const source = { ...SOURCE, builtAt: BUILD_TIME };
  return {
    version: '0.4.3-moe.99', generatedAt: BUILD_TIME, published: false,
    artifacts: [
      { name: 'Ministry of Education-0.4.3-moe.99-win-x64.exe', kind: 'installer', path: 'Ministry of Education-0.4.3-moe.99-win-x64.exe', sha256: digest('fixture installer'), source },
      { name: 'win:app.asar', kind: 'asar', path: 'win-unpacked/resources/app.asar', sha256: digest('fixture asar'), source },
      { name: 'win:extensions', kind: 'bundle-dir', path: 'win-unpacked/resources/extensions', sha256: digest('fixture extensions'), source },
    ],
  };
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'clwx106-evidence-'));
  releaseDir = path.join(dir, 'staged');
  installedDir = path.join(dir, 'machine');
  outputDir = path.join(dir, 'bundle');
  for (const folder of [releaseDir, installedDir, outputDir]) mkdirSync(folder);
  manifest = fixtureManifest();
  writeFileSync(path.join(releaseDir, manifest.artifacts[0].name), 'fixture installer');
  writeInstalledReleaseEvidenceFixture({
    evidenceDir: installedDir,
    manifest,
    startedAt: '2026-09-07T01:00:00.000Z',
    completedAt: END,
  });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function writeProof() {
  const rows = RELEASE_REQUIRED_CRITERIA.map(({ id }, index) => {
    const log = path.join(dir, `command-${index}.log`);
    writeFileSync(log, '$ fixture-check\nexit=0\n\n--- stdout ---\nfixture observation\n--- stderr ---\n');
    return { id, tier: id.startsWith('t2-') ? 'T2' : 'T0', box: 'fixture', criteria: [id], status: 'PASS', exitCode: 0, log, startedAt: '2026-09-07T02:01:00.000Z', completedAt: END };
  });
  return writeReleaseEvidence({ outputDir, manifest, source: SOURCE, rows, staticOnly: false, release: true, installedDir, startedAt: START, completedAt: END });
}

type MutableProof = {
  mode: string; staticOnly: boolean; source: typeof SOURCE; candidateSha256: string;
  startedAt: string | null; completedAt: string;
  rows: Array<{ id: string; status: string; criteria: string[]; log: { path: string; sha256: string } }>;
};

function changeReport(reportPath: string, change: (report: MutableProof) => void) {
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  change(report);
  writeFileSync(reportPath, JSON.stringify(report));
}

async function validate(reportPath: string, source = SOURCE, now = NOW) {
  return validateReleaseEvidence({ reportPath, manifest, releaseDir, source, now });
}

describe('release evidence from machine observations, bound to staged bytes', () => {
  it('requires staged acceptance for Ministry automatic release paths', () => {
    expect(automaticPublicationProblems('0.4.3-moe.19')).not.toHaveLength(0);
    expect(automaticPublicationProblems(undefined)).not.toHaveLength(0);
    expect(automaticPublicationProblems('1.0.0')).toEqual([]);
  });

  it.each([null, {}, [], { version: 'v', artifacts: [null] }, { version: 'v', artifacts: [{ kind: 'installer' }] }])('fails closed for malformed candidate %j', async (invalid) => {
    const reportPath = await writeProof();
    expect((await validateReleaseEvidence({ reportPath, manifest: invalid, releaseDir, source: SOURCE, now: NOW })).ok).toBe(false);
  });

  it('rejects a publication target or checkout version different from the tested candidate', async () => {
    const reportPath = await writeProof();
    const options = { reportPath, manifest, releaseDir, source: SOURCE, now: NOW };
    expect((await validateReleaseEvidence({ ...options, tag: `v${manifest.version}`, packageVersion: manifest.version })).ok).toBe(true);
    expect((await validateReleaseEvidence({ ...options, tag: 'v0.4.3-moe.18' })).ok).toBe(false);
    expect((await validateReleaseEvidence({ ...options, packageVersion: '0.4.3-moe.18' })).ok).toBe(false);
  });
  it('accepts a complete portable fixture and rereads raw producers without a live action', async () => {
    const reportPath = await writeProof();
    rmSync(installedDir, { recursive: true });
    expect(await validate(reportPath)).toEqual({ ok: true, problems: [] });
  });


  it('accepts release evidence exactly at and inside the 24 hour freshness boundary', async () => {
    const reportPath = await writeProof();

    expect((await validate(reportPath, SOURCE, Date.parse(END) + (24 * 60 * 60 * 1000) - 1)).ok).toBe(true);
    expect(await validate(reportPath, SOURCE, Date.parse(END) + (24 * 60 * 60 * 1000))).toEqual({ ok: true, problems: [] });
  });

  it('rejects otherwise valid release evidence older than 24 hours at publication time', async () => {
    const reportPath = await writeProof();

    const result = await validate(reportPath, SOURCE, Date.parse(END) + (24 * 60 * 60 * 1000) + 1);

    expect(result.ok).toBe(false);
    expect(result.problems).toContain('Gate evidence is older than 24 hours.');
  });


  it('rejects a fresh report wrapper around an old required row observation', async () => {
    const reportPath = await writeProof();
    const freshNow = Date.parse(END) + (24 * 60 * 60 * 1000) + 1;
    changeReport(reportPath, (report) => {
      report.completedAt = new Date(freshNow).toISOString();
    });

    const result = await validate(reportPath, SOURCE, freshNow);

    expect(result.ok).toBe(false);
    expect(result.problems).toEqual(expect.arrayContaining([expect.stringContaining('execution evidence is older than 24 hours.')]));
  });

  it('rejects a fresh report wrapper around old installed Windows evidence', async () => {
    const reportPath = await writeProof();
    const freshNow = Date.parse(END) + (24 * 60 * 60 * 1000) + 1;
    changeReport(reportPath, (report) => {
      report.startedAt = new Date(freshNow - (5 * 60 * 1000)).toISOString();
      report.completedAt = new Date(freshNow).toISOString();
      for (const row of report.rows) {
        row.startedAt = new Date(freshNow - (4 * 60 * 1000)).toISOString();
        row.completedAt = new Date(freshNow).toISOString();
      }
    });

    const result = await validate(reportPath, SOURCE, freshNow);

    expect(result.ok).toBe(false);
    expect(result.problems).toContain('Installed evidence is older than 24 hours.');
  });

  it.each(['missing', 'development', 'static', 'wrong-source', 'dirty-source', 'wrong-candidate', 'missing-row', 'skipped-row', 'unknown-status', 'duplicate-row', 'coalesced-criteria'])('rejects %s evidence', async (kind) => {
    const reportPath = await writeProof();
    if (kind === 'missing') rmSync(reportPath);
    else changeReport(reportPath, (report) => {
      if (kind === 'development') report.mode = 'development-health';
      if (kind === 'static') report.staticOnly = true;
      if (kind === 'wrong-source') report.source.gitCommit = 'b'.repeat(40);
      if (kind === 'dirty-source') report.source.gitDirty = true;
      if (kind === 'wrong-candidate') report.candidateSha256 = 'f'.repeat(64);
      if (kind === 'missing-row') report.rows.pop();
      if (kind === 'skipped-row') report.rows[1].status = 'SKIP';
      if (kind === 'unknown-status') report.rows[1].status = 'GREEN';
      if (kind === 'duplicate-row') report.rows.push(report.rows[0]);
      if (kind === 'coalesced-criteria') report.rows = [{ ...report.rows[0], criteria: RELEASE_REQUIRED_CRITERIA.map((c) => c.id) }];
    });
    expect((await validate(reportPath)).ok).toBe(false);
  });

  it.each(['installer', 'execution-log', 'producer', 'missing-producer'])('rejects changed %s bytes after a passed gate', async (kind) => {
    const reportPath = await writeProof();
    if (kind === 'installer') writeFileSync(path.join(releaseDir, manifest.artifacts[0].name), 'another build, same version');
    if (kind === 'execution-log') writeFileSync(path.join(outputDir, 'logs/1.log'), '$ changed\nexit=0\n');
    if (kind === 'producer') writeFileSync(path.join(outputDir, 'installed/office-write.txt'), 'RESULT: PASS');
    if (kind === 'missing-producer') rmSync(path.join(outputDir, 'installed/install-artifacts.json'));
    expect((await validate(reportPath)).ok).toBe(false);
  });

  it('rejects an additional untested installer in the distribution directory', async () => {
    const reportPath = await writeProof();
    writeFileSync(path.join(releaseDir, 'unreviewed.exe'), 'other bits');
    expect((await validate(reportPath)).ok).toBe(false);
  });

  it('rejects an execution log whose hash is refreshed but recorded exit was not successful', async () => {
    const reportPath = await writeProof();
    const text = '$ fixture-check\nexit=2\n\n--- stdout ---\nPASS\n';
    writeFileSync(path.join(outputDir, 'logs/1.log'), text);
    changeReport(reportPath, (report) => { report.rows[1].log.sha256 = digest(text); });
    expect((await validate(reportPath)).ok).toBe(false);
  });

  it.each(['before-build', 'reversed', 'future', 'invalid'])('rejects %s gate timestamps', async (kind) => {
    const reportPath = await writeProof();
    changeReport(reportPath, (report) => {
      if (kind === 'before-build') report.startedAt = '2026-09-06T23:00:00.000Z';
      if (kind === 'reversed') report.completedAt = '2026-09-07T01:00:00.000Z';
      if (kind === 'future') report.completedAt = '2026-09-08T01:00:00.000Z';
      if (kind === 'invalid') report.startedAt = null;
    });
    expect((await validate(reportPath)).ok).toBe(false);
  });

  it('does not let publication metadata change the candidate identity', () => {
    expect(candidateDigest({ ...manifest, published: true, publishedAt: END })).toBe(candidateDigest(manifest));
  });

  it('rejects legacy or dirty artifact provenance even when every row claims PASS', async () => {
    const reportPath = await writeProof();
    manifest.artifacts[2].source = undefined as never;
    expect((await validate(reportPath)).ok).toBe(false);
    manifest = fixtureManifest();
    manifest.artifacts[2].source = { ...manifest.artifacts[2].source, gitDirty: true };
    expect(candidateProblems(manifest, SOURCE)).not.toHaveLength(0);
  });

  it.each([null, [], {}, 'GREEN'])('rejects malformed JSON report %j without throwing', async (value) => {
    const reportPath = path.join(outputDir, 'release-evidence.json');
    writeFileSync(reportPath, JSON.stringify(value));
    expect((await validate(reportPath)).ok).toBe(false);
  });

  it('marks only a fully validated local fixture manifest published', async () => {
    const reportPath = await writeProof();
    const manifestDir = path.join(dir, 'manifests');
    mkdirSync(manifestDir);
    const file = path.join(manifestDir, `${manifest.version}.json`);
    writeFileSync(file, JSON.stringify(manifest));
    const rejected = await publishManifest({ manifestDir, version: manifest.version, reportPath: 'missing', releaseDir, source: SOURCE, now: NOW });
    expect(rejected.ok).toBe(false);
    expect(JSON.parse(readFileSync(file, 'utf8')).published).toBe(false);
    const accepted = await publishManifest({ manifestDir, version: manifest.version, reportPath, releaseDir, source: SOURCE, now: NOW });
    expect(accepted.ok).toBe(true);
    expect(JSON.parse(readFileSync(file, 'utf8')).published).toBe(true);
    expect((await validate(reportPath)).ok).toBe(true);
  });
});
