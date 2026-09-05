#!/usr/bin/env node
/**
 * CLWX-85 — release hash-manifest gate.
 *
 * The same version string has shipped different bits at least three times
 * (moe.10 installer embedded a day-older app.asar; identical installer
 * filenames across the 06-08/06-10 RC tags with different sha256; 06-23
 * drifted across three installer hashes with docs citing a fourth). This
 * tool binds a version string to one artifact set:
 *
 *   generate  — after a build, hash the version's installers + the unpacked
 *               app.asar + the plugin bundle dirs into
 *               docs/release-manifests/<version>.json. Re-generating the
 *               same version with different bits is allowed while the
 *               manifest is unpublished (the old hashes are kept in
 *               supersededBuilds and a loud warning names the drift), but
 *               is a HARD STOP once the manifest is marked published —
 *               shipped bits are immutable per version; bump moe.N instead.
 *   publish   — mark the manifest published (do this when the artifact set
 *               is uploaded / handed to the pilot).
 *   verify    — recompute hashes and diff against the manifest. Any
 *               mismatch is a hard stop (exit 1). Install-side checks can
 *               verify a single artifact at a custom path via --only/--path.
 *
 * Wired into scripts/run-electron-builder.mjs (generate runs after every
 * successful build). Exit codes: 0 OK / 1 mismatch or published-drift /
 * 2 usage or missing inputs.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_DIR_DEFAULT = path.join('docs', 'release-manifests');
const INSTALLER_EXTENSIONS = new Set(['.exe', '.dmg', '.zip']);
const BUNDLE_DIR_NAMES = ['extensions', 'openclaw-plugins'];
// Unpacked-tree asar written more than this long before/after the newest
// installer for the version is suspicious: likely two different builds.
const STALENESS_WINDOW_MS = 30 * 60 * 1000;

export function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(filePath)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

function walkFiles(dir, base = dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, base, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

/** Stable digest of a directory: sha256 over "relpath\nfilehash\n" lines, sorted. */
export async function hashDirectory(dir) {
  const files = walkFiles(dir);
  const hash = createHash('sha256');
  for (const file of files) {
    const rel = path.relative(dir, file).split(path.sep).join('/');
    hash.update(`${rel}\n${await sha256File(file)}\n`);
  }
  return { sha256: hash.digest('hex'), fileCount: files.length };
}

/** Find this version's artifact set under the release dir. */
export function discoverArtifacts({ releaseDir, version }) {
  const artifacts = [];
  if (!existsSync(releaseDir)) return artifacts;
  const marker = `-${version}-`;
  for (const name of readdirSync(releaseDir).sort()) {
    if (!name.includes(marker)) continue;
    if (!INSTALLER_EXTENSIONS.has(path.extname(name))) continue;
    artifacts.push({ name, path: name, kind: 'installer' });
  }
  const unpackedRoots = [];
  const winResources = path.join(releaseDir, 'win-unpacked', 'resources');
  if (existsSync(path.join(winResources, 'app.asar'))) unpackedRoots.push({ platform: 'win', resources: winResources, rel: 'win-unpacked/resources' });
  for (const dirName of ['mac-arm64', 'mac', 'mac-x64']) {
    const macDir = path.join(releaseDir, dirName);
    if (!existsSync(macDir)) continue;
    for (const entry of readdirSync(macDir).sort()) {
      if (!entry.endsWith('.app')) continue;
      const resources = path.join(macDir, entry, 'Contents', 'Resources');
      if (existsSync(path.join(resources, 'app.asar'))) {
        unpackedRoots.push({ platform: dirName, resources, rel: `${dirName}/${entry}/Contents/Resources` });
      }
    }
  }
  for (const { platform, resources, rel } of unpackedRoots) {
    artifacts.push({ name: `${platform}:app.asar`, path: `${rel}/app.asar`, kind: 'asar' });
    for (const bundle of BUNDLE_DIR_NAMES) {
      if (existsSync(path.join(resources, bundle))) {
        artifacts.push({ name: `${platform}:${bundle}`, path: `${rel}/${bundle}`, kind: 'bundle-dir' });
      }
    }
  }
  return artifacts;
}

async function hashArtifact(releaseDir, artifact) {
  const abs = path.join(releaseDir, artifact.path);
  if (artifact.kind === 'bundle-dir') {
    const { sha256, fileCount } = await hashDirectory(abs);
    return { ...artifact, sha256, fileCount, mtimeMs: statSync(abs).mtimeMs };
  }
  return { ...artifact, sha256: await sha256File(abs), bytes: statSync(abs).size, mtimeMs: statSync(abs).mtimeMs };
}

function stalenessWarnings(hashed) {
  const warnings = [];
  const installers = hashed.filter((a) => a.kind === 'installer');
  const asars = hashed.filter((a) => a.kind === 'asar');
  for (const asar of asars) {
    const platform = asar.name.split(':')[0];
    let platInstallers = installers.filter((i) => i.name.includes(`-${platform}-`) || i.name.includes(`-${platform}.`) || (platform === 'win' && i.name.endsWith('.exe')) || (platform.startsWith('mac') && (i.name.endsWith('.dmg') || i.name.endsWith('.zip'))));
    // No installer for this platform in the set: an unpacked tree here may be
    // an old build's leftovers — compare against the whole installer set so
    // the skew is still visible.
    if (platInstallers.length === 0) platInstallers = installers;
    for (const installer of platInstallers) {
      const skewMs = Math.abs(installer.mtimeMs - asar.mtimeMs);
      if (skewMs > STALENESS_WINDOW_MS) {
        warnings.push(`STALENESS: ${installer.name} and ${asar.name} were written ${Math.round(skewMs / 60000)} min apart — they may come from different builds; the installer's embedded asar can differ from the unpacked tree (the moe.10 defect).`);
      }
    }
  }
  return warnings;
}

function manifestPathFor(manifestDir, version) {
  return path.join(manifestDir, `${version}.json`);
}

function readManifest(manifestDir, version) {
  const file = manifestPathFor(manifestDir, version);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
}

function writeManifestAtomic(manifestDir, manifest) {
  mkdirSync(manifestDir, { recursive: true });
  const file = manifestPathFor(manifestDir, manifest.version);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(manifest, null, 2)}\n`);
  renameSync(tmp, file);
  return file;
}

/**
 * Generate/refresh the manifest for a version. Returns { manifest, action,
 * warnings, hardStop }. hardStop is set (and nothing is written) when the
 * existing manifest is published and any overlapping artifact hash differs.
 */
export async function generateManifest({ releaseDir, version, manifestDir, now = () => new Date().toISOString() }) {
  const discovered = discoverArtifacts({ releaseDir, version });
  if (discovered.length === 0) {
    return { manifest: null, action: 'no-artifacts', warnings: [`no artifacts for ${version} under ${releaseDir}`], hardStop: null };
  }
  const hashed = [];
  for (const artifact of discovered) hashed.push(await hashArtifact(releaseDir, artifact));
  const warnings = stalenessWarnings(hashed);
  const existing = readManifest(manifestDir, version);
  if (!existing) {
    const manifest = { version, generatedAt: now(), published: false, artifacts: hashed, supersededBuilds: [], warnings };
    return { manifest, action: 'created', warnings, hardStop: null };
  }
  const drift = [];
  for (const artifact of hashed) {
    const prior = existing.artifacts.find((a) => a.name === artifact.name);
    if (prior && prior.sha256 !== artifact.sha256) drift.push(`${artifact.name}: recorded ${prior.sha256.slice(0, 12)}… != current ${artifact.sha256.slice(0, 12)}…`);
  }
  if (drift.length === 0) {
    const merged = [...existing.artifacts];
    for (const artifact of hashed) if (!merged.some((a) => a.name === artifact.name)) merged.push(artifact);
    const manifest = { ...existing, artifacts: merged, warnings: [...new Set([...(existing.warnings ?? []), ...warnings])] };
    return { manifest, action: merged.length === existing.artifacts.length ? 'unchanged' : 'merged', warnings, hardStop: null };
  }
  if (existing.published) {
    return {
      manifest: existing,
      action: 'hard-stop',
      warnings,
      hardStop: `version ${version} is PUBLISHED with different bits — a shipped version string is immutable. Bump moe.N (CLAUDE.md convention) instead of rebuilding. Drift:\n  ${drift.join('\n  ')}`,
    };
  }
  const manifest = {
    version,
    generatedAt: now(),
    published: false,
    artifacts: hashed,
    supersededBuilds: [...(existing.supersededBuilds ?? []), { generatedAt: existing.generatedAt, artifacts: existing.artifacts }],
    warnings,
  };
  return { manifest, action: 'updated', warnings: [...warnings, `UNPUBLISHED REBUILD of ${version} with different bits (${drift.length} artifact(s)); prior hashes kept in supersededBuilds. If the prior bits ever shipped, bump moe.N now. Drift:\n  ${drift.join('\n  ')}`], hardStop: null };
}

/**
 * Verify artifacts against a manifest. options.only limits to one artifact
 * name; options.pathOverride (with only) checks it at a custom absolute or
 * cwd-relative path (install-side checks). Missing artifacts fail unless
 * options.allowMissing. Returns { ok, results }.
 */
export async function verifyManifest({ manifest, releaseDir, only = null, pathOverride = null, allowMissing = false }) {
  const targets = manifest.artifacts.filter((a) => (only ? a.name === only : true));
  if (targets.length === 0) return { ok: false, results: [{ name: only ?? '(none)', status: 'not-in-manifest' }] };
  const results = [];
  for (const artifact of targets) {
    const abs = pathOverride ? path.resolve(pathOverride) : path.join(releaseDir, artifact.path);
    if (!existsSync(abs)) {
      results.push({ name: artifact.name, status: allowMissing ? 'missing-skipped' : 'missing', path: abs });
      continue;
    }
    const actual = artifact.kind === 'bundle-dir' ? (await hashDirectory(abs)).sha256 : await sha256File(abs);
    results.push({ name: artifact.name, status: actual === artifact.sha256 ? 'ok' : 'mismatch', expected: artifact.sha256, actual, path: abs });
  }
  const checked = results.filter((r) => r.status === 'ok' || r.status === 'mismatch');
  const ok = checked.length > 0 && results.every((r) => r.status === 'ok' || r.status === 'missing-skipped');
  return { ok, results };
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = { command, releaseDir: path.join(ROOT, 'release'), manifestDir: path.join(ROOT, MANIFEST_DIR_DEFAULT), version: null, only: null, pathOverride: null, allowMissing: false };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === '--dir') opts.releaseDir = path.resolve(rest[(i += 1)]);
    else if (arg === '--manifest-dir') opts.manifestDir = path.resolve(rest[(i += 1)]);
    else if (arg === '--version') opts.version = rest[(i += 1)];
    else if (arg === '--only') opts.only = rest[(i += 1)];
    else if (arg === '--path') opts.pathOverride = rest[(i += 1)];
    else if (arg === '--allow-missing') opts.allowMissing = true;
    else { console.error(`unknown arg: ${arg}`); process.exit(2); }
  }
  if (!opts.version) opts.version = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.command === 'generate') {
    const { manifest, action, warnings, hardStop } = await generateManifest(opts);
    for (const warning of warnings) console.warn(`[release-hash-manifest] WARN ${warning}`);
    if (hardStop) { console.error(`[release-hash-manifest] HARD STOP: ${hardStop}`); process.exit(1); }
    if (action === 'no-artifacts') { console.warn(`[release-hash-manifest] nothing to record for ${opts.version}`); process.exit(2); }
    const file = writeManifestAtomic(opts.manifestDir, manifest);
    console.log(`[release-hash-manifest] ${action}: ${path.relative(ROOT, file)} (${manifest.artifacts.length} artifact(s))`);
    return;
  }
  if (opts.command === 'publish') {
    const manifest = readManifest(opts.manifestDir, opts.version);
    if (!manifest) { console.error(`[release-hash-manifest] no manifest for ${opts.version} — run generate first`); process.exit(2); }
    manifest.published = true;
    manifest.publishedAt = new Date().toISOString();
    writeManifestAtomic(opts.manifestDir, manifest);
    console.log(`[release-hash-manifest] published: ${opts.version} — this version's bits are now immutable`);
    return;
  }
  if (opts.command === 'verify') {
    const manifest = readManifest(opts.manifestDir, opts.version);
    if (!manifest) { console.error(`[release-hash-manifest] no manifest for ${opts.version}`); process.exit(2); }
    const { ok, results } = await verifyManifest({ manifest, releaseDir: opts.releaseDir, only: opts.only, pathOverride: opts.pathOverride, allowMissing: opts.allowMissing });
    for (const result of results) console.log(`[release-hash-manifest] ${result.status.toUpperCase()} ${result.name}${result.status === 'mismatch' ? ` expected ${result.expected.slice(0, 12)}… got ${result.actual.slice(0, 12)}…` : ''}`);
    if (!ok) { console.error(`[release-hash-manifest] HARD STOP: artifact set does not match the ${opts.version} manifest`); process.exit(1); }
    console.log(`[release-hash-manifest] OK: ${results.filter((r) => r.status === 'ok').length} artifact(s) match ${opts.version}`);
    return;
  }
  console.error('usage: release-hash-manifest.mjs <generate|publish|verify> [--version v] [--dir releaseDir] [--manifest-dir dir] [--only name] [--path file] [--allow-missing]');
  process.exit(2);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((error) => { console.error(error); process.exit(1); });
}
