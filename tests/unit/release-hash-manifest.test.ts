import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error - plain .mjs module without type declarations
import { discoverArtifacts, generateManifest, hashDirectory, readAsarPackageVersion, verifyManifest } from '../../scripts/release-hash-manifest.mjs';

const VERSION = '0.4.3-moe.99';

let releaseDir: string;
let manifestDir: string;

/** Minimal valid asar: 16-byte pickle header, JSON index, then file data. */
function buildTinyAsar(version: string, payload = 'v1'): Buffer {
  const pkg = Buffer.from(JSON.stringify({ name: 'clawx', version }));
  const blob = Buffer.from(payload);
  const index = Buffer.from(
    JSON.stringify({
      files: {
        'package.json': { size: pkg.length, offset: '0' },
        'blob.txt': { size: blob.length, offset: String(pkg.length) },
      },
    }),
  );
  const head = Buffer.alloc(16);
  head.writeUInt32LE(4, 0);
  head.writeUInt32LE(index.length + 8, 4);
  head.writeUInt32LE(index.length + 4, 8);
  head.writeUInt32LE(index.length, 12);
  return Buffer.concat([head, index, pkg, blob]);
}

function writeUnpackedTree(version: string, payload = 'v1'): void {
  const resources = join(releaseDir, 'win-unpacked', 'resources');
  mkdirSync(join(resources, 'extensions', 'moe-principal-assistant'), { recursive: true });
  writeFileSync(join(resources, 'app.asar'), buildTinyAsar(version, payload));
  writeFileSync(join(resources, 'extensions', 'moe-principal-assistant', 'index.mjs'), `plugin-bits-${payload}`);
}

function writeMacTree(version: string, payload = 'v1'): void {
  const resources = join(releaseDir, 'mac-arm64', 'Ministry of Education.app', 'Contents', 'Resources');
  mkdirSync(join(resources, 'extensions'), { recursive: true });
  writeFileSync(join(resources, 'app.asar'), buildTinyAsar(version, payload));
  writeFileSync(join(resources, 'extensions', 'plugin.mjs'), `mac-plugin-${payload}`);
}

function seedArtifactSet(): void {
  writeFileSync(join(releaseDir, `Ministry of Education-${VERSION}-win-x64.exe`), 'installer-bits-v1');
  writeFileSync(join(releaseDir, `Ministry of Education-0.4.3-moe.98-win-x64.exe`), 'other-version-bits');
  writeUnpackedTree(VERSION);
}

async function generate() {
  return generateManifest({ releaseDir, version: VERSION, manifestDir, now: () => '2026-09-05T00:00:00.000Z' });
}

function writeManifest(manifest: unknown): void {
  writeFileSync(join(manifestDir, `${VERSION}.json`), JSON.stringify(manifest));
}

beforeEach(() => {
  releaseDir = mkdtempSync(join(tmpdir(), 'clwx85-release-'));
  manifestDir = mkdtempSync(join(tmpdir(), 'clwx85-manifests-'));
  seedArtifactSet();
});

afterEach(() => {
  rmSync(releaseDir, { recursive: true, force: true });
  rmSync(manifestDir, { recursive: true, force: true });
});

describe('release-hash-manifest (CLWX-85)', () => {
  it('discovers only the requested version: installer, asar, and bundle dir', () => {
    const { artifacts } = discoverArtifacts({ releaseDir, version: VERSION });
    const names = artifacts.map((a: { name: string }) => a.name);
    expect(names).toContain(`Ministry of Education-${VERSION}-win-x64.exe`);
    expect(names).toContain('win:app.asar');
    expect(names).toContain('win:extensions');
    expect(names.join()).not.toContain('moe.98');
  });

  it('reads the version out of an asar and returns null on garbage', () => {
    const asarPath = join(releaseDir, 'win-unpacked', 'resources', 'app.asar');
    expect(readAsarPackageVersion(asarPath)).toBe(VERSION);
    writeFileSync(asarPath, 'not-an-asar');
    expect(readAsarPackageVersion(asarPath)).toBeNull();
  });

  it('skips (and reports) unpacked trees whose asar carries another version — never binds stale bits', () => {
    writeUnpackedTree('0.4.3-moe.10');
    const { artifacts, skipped } = discoverArtifacts({ releaseDir, version: VERSION });
    const names = artifacts.map((a: { name: string }) => a.name);
    expect(names).not.toContain('win:app.asar');
    expect(names).not.toContain('win:extensions');
    expect(skipped.join('\n')).toMatch(/0\.4\.3-moe\.10.*tree skipped/);
  });

  it('skips unpacked trees whose asar version is unreadable (fail closed)', () => {
    writeFileSync(join(releaseDir, 'win-unpacked', 'resources', 'app.asar'), 'corrupted');
    const { artifacts, skipped } = discoverArtifacts({ releaseDir, version: VERSION });
    expect(artifacts.map((a: { name: string }) => a.name)).not.toContain('win:app.asar');
    expect(skipped.join('\n')).toMatch(/unreadable/);
  });

  it('a plain base version never sweeps the moe.N-suffixed installer family', () => {
    const { artifacts } = discoverArtifacts({ releaseDir, version: '0.4.3' });
    expect(artifacts.filter((a: { kind: string }) => a.kind === 'installer')).toHaveLength(0);
  });

  it('verify passes on untouched bits and hard-fails when any artifact changes', async () => {
    const { manifest } = await generate();
    expect((await verifyManifest({ manifest, releaseDir })).ok).toBe(true);

    writeFileSync(join(releaseDir, `Ministry of Education-${VERSION}-win-x64.exe`), 'installer-bits-TAMPERED');
    const tampered = await verifyManifest({ manifest, releaseDir });
    expect(tampered.ok).toBe(false);
    expect(tampered.results.some((r: { status: string }) => r.status === 'mismatch')).toBe(true);
  });

  it('detects drift inside the plugin bundle dir, not just top-level files', async () => {
    const { manifest } = await generate();
    writeFileSync(join(releaseDir, 'win-unpacked', 'resources', 'extensions', 'moe-principal-assistant', 'index.mjs'), 'plugin-bits-TAMPERED');
    expect((await verifyManifest({ manifest, releaseDir })).ok).toBe(false);
  });

  it('hashDirectory digest is stable and order-independent but content-sensitive', async () => {
    const dir = join(releaseDir, 'win-unpacked', 'resources', 'extensions');
    const first = await hashDirectory(dir);
    const second = await hashDirectory(dir);
    expect(first.sha256).toBe(second.sha256);
    writeFileSync(join(dir, 'moe-principal-assistant', 'index.mjs'), 'plugin-bits-v2');
    expect((await hashDirectory(dir)).sha256).not.toBe(first.sha256);
  });

  it('unpublished rebuild with different bits updates the manifest and keeps the prior hashes', async () => {
    const first = await generate();
    writeManifest(first.manifest);
    writeUnpackedTree(VERSION, 'v2');
    const second = await generate();
    expect(second.action).toBe('updated');
    expect(second.hardStop).toBeNull();
    expect(second.manifest.supersededBuilds).toHaveLength(1);
    expect(second.warnings.join('\n')).toMatch(/UNPUBLISHED REBUILD/);
  });

  it('drift on one platform never drops the other platform from active verify coverage', async () => {
    writeMacTree(VERSION);
    const first = await generate();
    writeManifest(first.manifest);
    expect(first.manifest.artifacts.map((a: { name: string }) => a.name)).toContain('mac-arm64:app.asar');

    rmSync(join(releaseDir, 'mac-arm64'), { recursive: true, force: true });
    writeUnpackedTree(VERSION, 'v2');
    const second = await generate();
    expect(second.action).toBe('updated');
    const names = second.manifest.artifacts.map((a: { name: string }) => a.name);
    expect(names).toContain('mac-arm64:app.asar');
    expect(names).toContain('win:app.asar');
    const superseded = second.manifest.supersededBuilds[0].artifacts.map((a: { name: string }) => a.name);
    expect(superseded).not.toContain('mac-arm64:app.asar');
  });

  it('HARD STOP: a published version with different bits refuses regeneration (bump moe.N)', async () => {
    const first = await generate();
    writeManifest({ ...first.manifest, published: true });
    writeUnpackedTree(VERSION, 'v2');
    const second = await generate();
    expect(second.action).toBe('hard-stop');
    expect(second.hardStop).toMatch(/PUBLISHED with different bits/);
    expect(second.hardStop).toMatch(/moe\.N/);
  });

  it('same-bits regeneration is idempotent (no hard stop, no superseded history)', async () => {
    const first = await generate();
    writeManifest({ ...first.manifest, published: true });
    const second = await generate();
    expect(second.action).toBe('unchanged');
    expect(second.hardStop).toBeNull();
  });

  it('install-side single-artifact check works via only + pathOverride', async () => {
    const { manifest } = await generate();
    const installedAsar = join(releaseDir, 'installed-copy.asar');
    cpSync(join(releaseDir, 'win-unpacked', 'resources', 'app.asar'), installedAsar);
    expect((await verifyManifest({ manifest, releaseDir, only: 'win:app.asar', pathOverride: installedAsar })).ok).toBe(true);
    writeFileSync(installedAsar, 'asar-bits-DRIFTED');
    expect((await verifyManifest({ manifest, releaseDir, only: 'win:app.asar', pathOverride: installedAsar })).ok).toBe(false);
  });

  it('missing artifacts fail closed, and allow-missing never turns zero checks into a pass', async () => {
    const { manifest } = await generate();
    rmSync(join(releaseDir, `Ministry of Education-${VERSION}-win-x64.exe`));
    expect((await verifyManifest({ manifest, releaseDir })).ok).toBe(false);
    expect((await verifyManifest({ manifest, releaseDir, allowMissing: true })).ok).toBe(true);
    expect((await verifyManifest({ manifest, releaseDir, only: 'no-such-artifact' })).ok).toBe(false);
  });
});
