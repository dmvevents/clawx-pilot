#!/usr/bin/env node
/** CLWX-106: portable evidence for the staged Ministry Windows release. */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RELEASE_REQUIRED_CRITERIA, scorecard } from './ga-gate-verdict.mjs';
import { sha256File } from './release-hash-manifest.mjs';
import { evaluateInstalledEvidence } from './installed-release-evidence.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const DISTRIBUTABLE = /\.(exe|dmg|zip|AppImage|deb|rpm)$/i;
const isoTime = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : NaN;
const MAX_RELEASE_EVIDENCE_AGE_MS = 24 * 60 * 60 * 1000;

/** Hash the candidate identity, excluding mutable publication/reporting metadata. */
export function candidateDigest(manifest) {
  const artifacts = (manifest.artifacts ?? []).map(({ name, kind, sha256, source }) => ({
    name, kind, sha256, source: source ?? null,
  })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  return createHash('sha256').update(JSON.stringify({ version: manifest.version, artifacts })).digest('hex');
}

export function candidateProblems(manifest, { gitCommit, gitDirty } = {}) {
  const problems = [];
  if (!COMMIT.test(gitCommit ?? '') || gitDirty !== false) problems.push('Acceptance requires a known, clean source revision.');
  if (!manifest || typeof manifest.version !== 'string' || !Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) {
    return [...problems, 'Candidate manifest has no artifact inventory.'];
  }
  const names = new Set();
  for (const artifact of manifest.artifacts) {
    if (!artifact || typeof artifact.name !== 'string' || !artifact.name || names.has(artifact.name) || !SHA256.test(artifact.sha256 ?? '') || !['installer', 'asar', 'bundle-dir'].includes(artifact.kind)) {
      problems.push('Candidate has an invalid or duplicate artifact identity.');
      continue;
    }
    names.add(artifact.name);
    if (artifact.source?.gitCommit !== gitCommit || artifact.source?.gitDirty !== false || !Number.isFinite(isoTime(artifact.source?.builtAt))) {
      problems.push(`${artifact.name}: build source is unknown, dirty or different from the tested revision.`);
    }
  }
  const installers = manifest.artifacts.filter((a) => a?.kind === 'installer');
  // This adapter proves one installed Windows candidate. It cannot certify an
  // additional Mac/ARM/Linux installer merely because it shares a version label.
  if (installers.length !== 1 || typeof installers[0].name !== 'string' || !installers[0].name.endsWith(`-${manifest.version}-win-x64.exe`) || /[/\\]/.test(installers[0].name)) {
    problems.push('This acceptance profile requires exactly one Windows x64 installer; other platform artifacts need their own acceptance profile.');
  }
  if (!manifest.artifacts.some((a) => a?.name === 'win:app.asar' && a.kind === 'asar')) problems.push('Candidate has no Windows app.asar identity.');
  return problems;
}

/** Ministry releases use the staged Windows acceptance lane, including tag pushes. */
export function automaticPublicationProblems(version) {
  if (typeof version !== 'string' || !version) return ['Package version is missing.'];
  return /-moe(?:[.-]|$)/i.test(version)
    ? ['Automatic Ministry publication is disabled. Use the staged Windows workflow with strict installed evidence.']
    : [];
}

function within(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.includes('\\')) throw new Error('Evidence path must be relative to its bundle.');
  const full = path.resolve(root, relative);
  if (!full.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error('Evidence path escapes its bundle.');
  if (existsSync(full) && !realpathSync(full).startsWith(`${realpathSync(root)}${path.sep}`)) throw new Error('Evidence symlink escapes its bundle.');
  return full;
}

/** Persist raw measured inputs as well as the derived verdict; never copy prose PASS. */
export async function writeReleaseEvidence({ outputDir, manifest, source, rows, staticOnly, release, installedDir, startedAt, completedAt }) {
  mkdirSync(outputDir, { recursive: true });
  const storedRows = [];
  for (const row of rows) {
    const stored = {
      id: row.id, tier: row.tier, box: row.box, status: row.status,
      criteria: row.criteria ?? [], optional: row.optional === true,
      exitCode: row.exitCode ?? null, startedAt: row.startedAt ?? null, completedAt: row.completedAt ?? null,
    };
    if (row.log && existsSync(row.log)) {
      const relative = `logs/${storedRows.length}.log`;
      const destination = within(outputDir, relative);
      mkdirSync(path.dirname(destination), { recursive: true });
      if (path.resolve(row.log) !== destination) copyFileSync(row.log, destination);
      stored.log = { path: relative, sha256: await sha256File(destination) };
    }
    storedRows.push(stored);
  }
  let installed = null;
  if (manifest && installedDir) {
    const result = await evaluateInstalledEvidence({ manifest, evidenceDir: installedDir });
    const files = [];
    for (const file of result.files) {
      const relative = `installed/${file.path}`;
      const destination = within(outputDir, relative);
      mkdirSync(path.dirname(destination), { recursive: true });
      copyFileSync(within(installedDir, file.path), destination);
      files.push({ path: relative, sha256: await sha256File(destination) });
    }
    installed = { directory: 'installed', files };
  }
  if (manifest) writeFileSync(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const report = {
    schemaVersion: 1, producer: 'scripts/ga-gate.mjs',
    mode: release ? 'strict-release-evidence' : 'development-health', staticOnly,
    startedAt, completedAt, source, version: manifest?.version ?? null,
    candidateSha256: manifest ? candidateDigest(manifest) : null,
    rows: storedRows, installed,
  };
  const reportPath = path.join(outputDir, 'release-evidence.json');
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return reportPath;
}

function distributionFiles(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) distributionFiles(full, files);
    else if (entry.isFile() && DISTRIBUTABLE.test(entry.name)) files.push(full);
  }
  return files;
}

/** Recompute acceptance at the last local boundary before publication. */
export async function validateReleaseEvidence({ reportPath, manifest, releaseDir, source, tag, packageVersion, now = Date.now() }) {
  const problems = candidateProblems(manifest, source);
  if (tag !== undefined && tag !== `v${manifest?.version}`) problems.push('Publication tag must exactly match v<tested candidate version>.');
  if (packageVersion !== undefined && packageVersion !== manifest?.version) problems.push('Checked-out package version differs from the candidate.');
  if (problems.length) return { ok: false, problems };
  let report;
  try { report = JSON.parse(readFileSync(reportPath, 'utf8')); }
  catch { return { ok: false, problems: [...problems, 'Release evidence is missing or unreadable.'] }; }
  if (!report || typeof report !== 'object' || Array.isArray(report)) return { ok: false, problems: [...problems, 'Release evidence is malformed.'] };
  const root = path.dirname(path.resolve(reportPath));
  if (report?.schemaVersion !== 1 || report.producer !== 'scripts/ga-gate.mjs' || report.mode !== 'strict-release-evidence' || report.staticOnly !== false) {
    problems.push('Evidence is not a supported, non-static strict gate run.');
  }
  if (report.source?.gitCommit !== source?.gitCommit || report.source?.gitDirty !== false) problems.push('Gate evidence belongs to a different or dirty source revision.');
  try {
    if (report.version !== manifest.version || report.candidateSha256 !== candidateDigest(manifest)) problems.push('Gate evidence belongs to a different candidate artifact set.');
  } catch { problems.push('Candidate identity cannot be verified.'); }
  const start = isoTime(report.startedAt);
  const end = isoTime(report.completedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end > now) problems.push('Gate timestamps are missing, reversed or in the future.');
  else if (now - end > MAX_RELEASE_EVIDENCE_AGE_MS) problems.push('Gate evidence is older than 24 hours.');
  for (const artifact of manifest?.artifacts ?? []) {
    if (isoTime(artifact.source?.builtAt) > start) problems.push(`${artifact.name}: gate evidence predates the build.`);
  }
  const rows = report.rows;
  if (!Array.isArray(rows) || rows.length === 0 || rows.some((r) => !r || typeof r.id !== 'string' || !Array.isArray(r.criteria))) {
    problems.push('Gate row inventory is missing or malformed.');
  } else {
    const verdict = scorecard(rows, { release: true, staticOnly: report.staticOnly });
    if (verdict.exitCode !== 0) problems.push(...verdict.releaseBlockers.map((b) => `${b.criterion}: ${b.status}`));
    if (verdict.fails.length) problems.push('An executed gate check failed.');
    const seen = new Set();
    const required = new Set(RELEASE_REQUIRED_CRITERIA.map((c) => c.id));
    for (const row of rows) {
      const [criterion] = row.criteria;
      if (row.criteria.length !== 1 || !required.has(criterion) || seen.has(criterion)) {
        problems.push(`${row.id}: each required criterion needs its own unambiguous evidence row.`);
        continue;
      }
      seen.add(criterion);
      if (row.status !== 'PASS') problems.push(`${row.id}: required evidence did not pass.`);
      if (criterion === 't2-installed-windows-app' || criterion === 'release-artifact-provenance') continue;
      if (row.status !== 'PASS' || row.exitCode !== 0) {
        problems.push(`${row.id}: executed PASS with exit code zero is required.`);
        continue;
      }
      const rowStart = isoTime(row.startedAt);
      const rowEnd = isoTime(row.completedAt);
      if (!Number.isFinite(rowStart) || !Number.isFinite(rowEnd) || rowStart < start || rowEnd < rowStart || rowEnd > end) problems.push(`${row.id}: invalid execution timestamps.`);
      else if (now - rowEnd > MAX_RELEASE_EVIDENCE_AGE_MS) problems.push(`${row.id}: execution evidence is older than 24 hours.`);
      try {
        const log = within(root, row.log?.path);
        if (!SHA256.test(row.log?.sha256 ?? '') || await sha256File(log) !== row.log.sha256) problems.push(`${row.id}: execution log is missing or changed.`);
        // The gate writes this framing from spawnSync.status, before stdout.
        if (!/^\$ [^\n]+\nexit=0\n\n--- stdout ---\n/.test(readFileSync(log, 'utf8'))) problems.push(`${row.id}: execution log does not record successful execution.`);
      } catch { problems.push(`${row.id}: execution log is missing or invalid.`); }
    }
  }
  try {
    if (report.installed?.directory !== 'installed' || !Array.isArray(report.installed.files) || report.installed.files.length === 0) throw new Error('missing installed evidence');
    const actual = await evaluateInstalledEvidence({ manifest, evidenceDir: within(root, 'installed') });
    if (!actual.ok) problems.push(...actual.checks.filter((c) => c.status !== 'PASS').map((c) => `${c.id}: ${c.status}`));
    const expectedFiles = new Map(report.installed.files.map((file) => [file.path, file.sha256]));
    if (expectedFiles.size !== report.installed.files.length || actual.files.length !== expectedFiles.size) problems.push('Installed evidence inventory changed or contains duplicates.');
    for (const file of actual.files) {
      if (expectedFiles.get(`installed/${file.path}`) !== file.sha256) problems.push('Installed evidence bytes changed after the gate run.');
    }
    const installedStart = isoTime(actual.startedAt);
    const installedEnd = isoTime(actual.completedAt);
    if (!Number.isFinite(installedStart) || !Number.isFinite(installedEnd) || installedEnd < installedStart || installedEnd > end) problems.push('Installed evidence has invalid run timestamps.');
    else if (now - installedEnd > MAX_RELEASE_EVIDENCE_AGE_MS) problems.push('Installed evidence is older than 24 hours.');
    for (const artifact of manifest?.artifacts ?? []) {
      if (isoTime(artifact.source?.builtAt) > installedStart) problems.push(`${artifact.name}: installed evidence predates the build.`);
    }
  } catch { problems.push('Complete installed Windows producer evidence is required.'); }
  try {
    const files = distributionFiles(releaseDir);
    const installers = manifest.artifacts.filter((a) => a.kind === 'installer');
    if (files.length !== installers.length) problems.push('Distribution contains missing or additional installers.');
    for (const artifact of installers) {
      const matches = files.filter((file) => path.basename(file) === artifact.name);
      if (matches.length !== 1 || await sha256File(matches[0]) !== artifact.sha256) problems.push(`${artifact.name}: staged installer bytes do not match the tested candidate.`);
    }
  } catch { problems.push('Staged installer bytes could not be verified.'); }
  return { ok: problems.length === 0, problems };
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const packageVersion = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  if (command === 'check-automatic-policy' && args.length === 0) {
    const problems = automaticPublicationProblems(packageVersion);
    for (const problem of problems) console.error(`[release-evidence] ${problem}`);
    process.exitCode = problems.length ? 3 : 0;
    return;
  }
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--report', '--manifest', '--dir', '--tag'].includes(args[i]) || !args[i + 1] || Object.hasOwn(options, args[i].slice(2))) throw new Error('Use check --report <file> --manifest <file> --dir <staged artifacts> [--tag v<version>].');
    options[args[i].slice(2)] = args[i + 1];
  }
  if (command !== 'check' || !options.report || !options.manifest || !options.dir) throw new Error('Use check --report <file> --manifest <file> --dir <staged artifacts>.');
  // Gate and publication use the same source reader; loaded lazily for the CLI.
  const { readCurrentSource } = await import('./release-build-source.mjs');
  const result = await validateReleaseEvidence({
    reportPath: path.resolve(options.report), manifest: JSON.parse(readFileSync(options.manifest, 'utf8')),
    releaseDir: path.resolve(options.dir), source: readCurrentSource(ROOT), tag: options.tag, packageVersion,
  });
  for (const problem of result.problems) console.error(`[release-evidence] ${problem}`);
  console.log(`[release-evidence] ${result.ok ? 'PASS: staged Windows evidence matches (not publication authorization)' : 'FAIL: publication blocked'}`);
  process.exitCode = result.ok ? 0 : 3;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('[release-evidence] Invalid or unreadable release inputs; publication blocked.'); process.exitCode = 3; });
}
