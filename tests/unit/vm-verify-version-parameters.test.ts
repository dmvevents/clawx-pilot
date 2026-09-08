/**
 * T5 (installed acceptance producer, 2026-09-08): the Windows verify engine's
 * installer / version / guest-object names must be explicit parameters, not
 * moe.19 assumptions, and a mismatched version or hash must fail closed.
 *
 * These tests exercise ONLY the local argument-parsing and validation front
 * end via `--print-config`, which resolves the configuration and exits before
 * any gcloud, gsutil, SSH, install or evidence-tree action. The real phases
 * (upload, install, probes) are never invoked here; installed execution stays
 * NOT_RUN in this lane. Every positive assertion is paired with a negative
 * control so a permanently-passing validator cannot masquerade as coverage.
 *
 * Review hardening (2026-09-08, F1/F2/F3): identity binds are exact —
 * `--manifest` is required for every non-legacy invocation, the installer
 * filename bind and the FileVersion assert are delimiter-anchored (moe.3 must
 * never bind moe.30), explicitly empty `--exe=`/`--version=` are refused at
 * both entrypoints, and a digit-free `--expect-file-version` is refused. The
 * falsifiers below are pinned from the independent review of 9bc9221b.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { platform, tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const enginePath = join(process.cwd(), 'scripts', 'vm-verify-moe19.sh');
const wrapperPath = join(process.cwd(), 'scripts', 'vm-verify-installed.sh');
const engine = readFileSync(enginePath, 'utf8');
const wrapper = readFileSync(wrapperPath, 'utf8');
// The producer is a macOS/Linux SSH-controller script (shasum, scp, gsutil).
const posixControllerIt = platform() === 'win32' ? it.skip : it;

type Config = {
  mode: string;
  status: string;
  reason: string | null;
  legacyDefaults: boolean;
  installer: { localPath: string; name: string; sha256: string | null };
  version: string;
  guestExeName: string;
  gcsDest: string;
  verifyTag: string;
  expectFileVersion: string;
  expectFileVersionPattern: string;
  evidenceDir: string;
  manifest: null | { path: string; version: string; installerName: string; installerSha256: string };
};

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'clawx-vm-verify-params-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function fakeInstaller(dir: string, name: string, body = 'not-a-real-installer'): { path: string; sha256: string } {
  const path = join(dir, name);
  writeFileSync(path, body);
  return { path, sha256: createHash('sha256').update(body).digest('hex') };
}

function writeManifest(dir: string, version: string, installerName: string, sha256: string): string {
  const path = join(dir, `release-manifest-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(path, JSON.stringify({
    version,
    artifacts: [{ name: installerName, kind: 'installer', sha256 }],
  }));
  return path;
}

function runPrintConfig(script: string, args: string[]) {
  // PATH is stripped of nothing: --print-config exits before any network tool
  // is reachable, so a hermetic run proves the ordering rather than mocking it.
  return spawnSync('bash', [script, '--print-config', ...args], { encoding: 'utf8' });
}

// Evaluate the engine-resolved ERE with the SAME consumer the phases use
// (grep -E), not a JS RegExp approximation.
function grepMatches(pattern: string, input: string): boolean {
  const result = spawnSync('grep', ['-Eq', pattern], { encoding: 'utf8', input });
  return result.status === 0;
}

function parseConfig(stdout: string): Config {
  return JSON.parse(stdout) as Config;
}

describe('vm-verify installed-acceptance producer: version parameters', () => {
  posixControllerIt('both scripts stay valid bash', () => {
    expect(() => execFileSync('bash', ['-n', enginePath], { stdio: 'pipe' })).not.toThrow();
    expect(() => execFileSync('bash', ['-n', wrapperPath], { stdio: 'pipe' })).not.toThrow();
  });

  posixControllerIt('resolves an explicit candidate identity with no moe.19 residue', () => {
    withTempDir((dir) => {
      const installer = fakeInstaller(dir, 'Ministry of Education-0.4.3-moe.30-win-x64.exe');
      const manifestPath = writeManifest(dir, '0.4.3-moe.30', 'Ministry of Education-0.4.3-moe.30-win-x64.exe', installer.sha256);
      const result = runPrintConfig(enginePath, ['--exe', installer.path, '--version', '0.4.3-moe.30', '--manifest', manifestPath]);

      expect(result.status).toBe(0);
      const config = parseConfig(result.stdout);
      expect(config).toMatchObject({
        mode: 'print-config',
        status: 'OK',
        legacyDefaults: false,
        version: '0.4.3-moe.30',
        guestExeName: 'clawx-installer-0.4.3-moe.30.exe',
        gcsDest: 'gs://clawx-rc-artifacts-622687731621/0.4.3-moe.30/',
        verifyTag: '0.4.3-moe.30',
        expectFileVersion: '0.4.3-moe.30',
        manifest: { version: '0.4.3-moe.30', installerSha256: installer.sha256 },
      });
      expect(config.installer.sha256).toBe(installer.sha256);
      expect(JSON.stringify(config)).not.toContain('moe.19');
      expect(JSON.stringify(config)).not.toContain('moe19');
      expect(config.evidenceDir).toContain('-0.4.3-moe.30-verify-');
    });
  });

  posixControllerIt('honours explicit guest object and bucket overrides', () => {
    withTempDir((dir) => {
      const installer = fakeInstaller(dir, 'Ministry of Education-0.4.3-moe.30-win-x64.exe');
      const manifestPath = writeManifest(dir, '0.4.3-moe.30', 'Ministry of Education-0.4.3-moe.30-win-x64.exe', installer.sha256);
      const result = runPrintConfig(enginePath, [
        '--exe', installer.path,
        '--version', '0.4.3-moe.30',
        '--manifest', manifestPath,
        '--guest-exe-name', 'moe30.exe',
        '--gcs-dest', 'gs://example-bucket/moe30/',
        '--expect-file-version', 'moe.30',
      ]);

      expect(result.status).toBe(0);
      expect(parseConfig(result.stdout)).toMatchObject({
        guestExeName: 'moe30.exe',
        gcsDest: 'gs://example-bucket/moe30/',
        expectFileVersion: 'moe.30',
      });
    });
  });

  posixControllerIt('keeps the legacy no-argument invocation on the historical moe.19 identity', () => {
    // Negative-control counterpart of the explicit-identity test: the legacy
    // defaults must still be exactly moe.19, and must apply ONLY here.
    const result = runPrintConfig(enginePath, []);
    const config = parseConfig(result.stdout);

    expect(config).toMatchObject({
      legacyDefaults: true,
      version: '0.4.3-moe.19',
      guestExeName: 'moe19.exe',
      gcsDest: 'gs://clawx-rc-artifacts-622687731621/moe19/',
      verifyTag: 'moe19',
      expectFileVersion: 'moe.19',
    });
    expect(config.installer.name).toBe('Ministry of Education-0.4.3-moe.19-win-x64.exe');
    // The moe.19 artifact is not present in a source checkout: absence is
    // BLOCKED with no hash, never a pass.
    expect([0, 3]).toContain(result.status);
    if (result.status === 3) {
      expect(config.status).toBe('BLOCKED');
      expect(config.installer.sha256).toBeNull();
    }
  });

  posixControllerIt('refuses a version whose string is absent from the installer filename', () => {
    withTempDir((dir) => {
      const installer = fakeInstaller(dir, 'Ministry of Education-0.4.3-moe.19-win-x64.exe');
      const manifestPath = writeManifest(dir, '0.4.3-moe.30', 'Ministry of Education-0.4.3-moe.30-win-x64.exe', installer.sha256);
      const result = runPrintConfig(enginePath, ['--exe', installer.path, '--version', '0.4.3-moe.30', '--manifest', manifestPath]);

      expect(result.status).toBe(2);
      const config = parseConfig(result.stdout);
      expect(config.status).toBe('FAIL');
      expect(config.reason).toContain('does not contain --version');
      expect(config.installer.sha256).toBeNull();
    });
  });

  posixControllerIt('refuses a prefix-truncated identity: moe.3 never binds moe.30, 0.4.3 never binds a 0.4.3-* pre-release', () => {
    // Pinned falsifiers from the independent review of 9bc9221b (F1): the old
    // substring bind accepted both of these against the moe.30 installer.
    withTempDir((dir) => {
      const installer = fakeInstaller(dir, 'Ministry of Education-0.4.3-moe.30-win-x64.exe');
      for (const version of ['0.4.3-moe.3', '0.4.3']) {
        const manifestPath = writeManifest(dir, version, `Ministry of Education-${version}-win-x64.exe`, installer.sha256);
        const result = runPrintConfig(enginePath, ['--exe', installer.path, '--version', version, '--manifest', manifestPath]);

        expect(result.status, version).toBe(2);
        const config = parseConfig(result.stdout);
        expect(config.status).toBe('FAIL');
        expect(config.reason).toContain(`-${version}-win`);
        expect(config.installer.sha256).toBeNull();
      }
    });
  });

  posixControllerIt('requires the release manifest for every non-legacy invocation (both entrypoints)', () => {
    withTempDir((dir) => {
      const installer = fakeInstaller(dir, 'Ministry of Education-0.4.3-moe.30-win-x64.exe');

      const engineRun = runPrintConfig(enginePath, ['--exe', installer.path, '--version', '0.4.3-moe.30']);
      expect(engineRun.status).toBe(2);
      expect(engineRun.stdout).toBe('');
      expect(engineRun.stderr).toContain('--manifest is required for any non-legacy invocation');

      const wrapperRun = runPrintConfig(wrapperPath, ['--exe', installer.path, '--version', '0.4.3-moe.30']);
      expect(wrapperRun.status).toBe(2);
      expect(wrapperRun.stderr).toContain('--manifest');
      // Negative control: the legacy no-argument engine invocation stays
      // manifest-free (covered above: exit 0/3, never the manifest config error).
    });
  });

  posixControllerIt('refuses explicitly empty --exe/--version instead of inheriting the moe.19 identity (both entrypoints)', () => {
    // Pinned falsifier from the independent review of 9bc9221b (F2):
    // `--exe= --version=` (unset CI variables) previously resolved
    // legacyDefaults: true through BOTH entrypoints.
    const engineEquals = runPrintConfig(enginePath, ['--exe=', '--version=']);
    expect(engineEquals.status).toBe(2);
    expect(engineEquals.stdout).toBe('');
    expect(engineEquals.stderr).toContain('must be non-empty');

    const engineBare = runPrintConfig(enginePath, ['--exe', '', '--version', '']);
    expect(engineBare.status).toBe(2);
    expect(engineBare.stdout).toBe('');
    expect(engineBare.stderr).toContain('must be non-empty');

    const wrapperEquals = runPrintConfig(wrapperPath, ['--exe=', '--version=']);
    expect(wrapperEquals.status).toBe(2);
    expect(wrapperEquals.stdout).toBe('');
    expect(wrapperEquals.stderr).toContain('non-empty value');

    // Bare-flag empty values pass the wrapper's presence check but are
    // refused by the engine's explicit-empty check before any cloud action.
    const wrapperBare = runPrintConfig(wrapperPath, ['--exe', '', '--version', '', '--manifest', 'unused.json']);
    expect(wrapperBare.status).toBe(2);
    expect(wrapperBare.stderr).toContain('must be non-empty');
  });

  posixControllerIt('refuses a partial identity instead of inheriting moe.19 defaults', () => {
    withTempDir((dir) => {
      const installer = fakeInstaller(dir, 'Ministry of Education-0.4.3-moe.30-win-x64.exe');
      const onlyExe = runPrintConfig(enginePath, ['--exe', installer.path]);
      const onlyVersion = runPrintConfig(enginePath, ['--version', '0.4.3-moe.30']);

      for (const result of [onlyExe, onlyVersion]) {
        expect(result.status).toBe(2);
        expect(result.stdout).toBe('');
        expect(result.stderr).toContain('--exe and --version must be provided together');
      }
    });
  });

  posixControllerIt('rejects unsafe parameter values and unknown flags', () => {
    withTempDir((dir) => {
      const installer = fakeInstaller(dir, 'Ministry of Education-0.4.3-moe.30-win-x64.exe');
      const cases: Array<{ args: string[]; expect: string }> = [
        { args: ['--exe', installer.path, '--version', '0.4.3-moe.30; rm -rf /'], expect: '--version must be non-empty' },
        { args: ['--exe', installer.path, '--version', '0.4.3-moe.30', '--guest-exe-name', 'a b.exe'], expect: '--guest-exe-name must be non-empty' },
        { args: ['--exe', installer.path, '--version', '0.4.3-moe.30', '--guest-exe-name', 'moe30.msi'], expect: '--guest-exe-name must end in .exe' },
        { args: ['--exe', installer.path, '--version', '0.4.3-moe.30', '--gcs-dest', 'https://example.invalid/x/'], expect: '--gcs-dest must look like' },
        { args: ['--exe', installer.path, '--version', '0.4.3-moe.30', '--manifest', join(dir, 'absent.json')], expect: '--manifest not found' },
        { args: ['--exe', installer.path, '--version', '0.4.3-moe.30', '--upload-everything'], expect: 'unknown argument' },
        { args: ['--exe'], expect: '--exe needs a value' },
        // Review F3: a delimiter-only expectation would match ANY FileVersion.
        { args: ['--exe', installer.path, '--version', '0.4.3-moe.30', '--expect-file-version', '.'], expect: '--expect-file-version must contain a digit' },
        { args: ['--exe', installer.path, '--version', '0.4.3-moe.30', '--expect-file-version', '-'], expect: '--expect-file-version must contain a digit' },
      ];

      for (const testCase of cases) {
        const result = runPrintConfig(enginePath, testCase.args);
        expect(result.status, `${testCase.args.join(' ')}`).toBe(2);
        expect(result.stderr).toContain(testCase.expect);
      }
    });
  });

  posixControllerIt('accepts a manifest that agrees on version, installer name and sha256', () => {
    withTempDir((dir) => {
      const installer = fakeInstaller(dir, 'Ministry of Education-0.4.3-moe.30-win-x64.exe');
      const manifestPath = join(dir, 'release-manifest.json');
      writeFileSync(manifestPath, JSON.stringify({
        version: '0.4.3-moe.30',
        artifacts: [
          { name: 'Ministry of Education-0.4.3-moe.30-win-x64.exe', kind: 'installer', sha256: installer.sha256 },
          { name: 'win:app.asar', kind: 'asar', sha256: 'b'.repeat(64) },
        ],
      }));

      const result = runPrintConfig(enginePath, ['--exe', installer.path, '--version', '0.4.3-moe.30', '--manifest', manifestPath]);

      expect(result.status).toBe(0);
      expect(parseConfig(result.stdout).manifest).toMatchObject({
        version: '0.4.3-moe.30',
        installerName: 'Ministry of Education-0.4.3-moe.30-win-x64.exe',
        installerSha256: installer.sha256,
      });
    });
  });

  posixControllerIt('refuses every manifest disagreement (version, name, hash, missing artifact)', () => {
    withTempDir((dir) => {
      const installer = fakeInstaller(dir, 'Ministry of Education-0.4.3-moe.30-win-x64.exe');
      const manifest = (body: unknown): string => {
        const manifestPath = join(dir, `manifest-${Math.random().toString(36).slice(2)}.json`);
        writeFileSync(manifestPath, JSON.stringify(body));
        return manifestPath;
      };
      const cases: Array<{ path: string; expect: string }> = [
        {
          path: manifest({ version: '0.4.3-moe.29', artifacts: [{ name: 'Ministry of Education-0.4.3-moe.30-win-x64.exe', kind: 'installer', sha256: installer.sha256 }] }),
          expect: 'manifest version 0.4.3-moe.29 != --version 0.4.3-moe.30',
        },
        {
          path: manifest({ version: '0.4.3-moe.30', artifacts: [{ name: 'Ministry of Education-0.4.3-moe.29-win-x64.exe', kind: 'installer', sha256: installer.sha256 }] }),
          expect: 'manifest installer name',
        },
        {
          path: manifest({ version: '0.4.3-moe.30', artifacts: [{ name: 'Ministry of Education-0.4.3-moe.30-win-x64.exe', kind: 'installer', sha256: 'c'.repeat(64) }] }),
          expect: 'sha256 does not match the local artifact',
        },
        {
          path: manifest({ version: '0.4.3-moe.30', artifacts: [{ name: 'Ministry of Education-0.4.3-moe.30-win-x64.exe', kind: 'installer' }] }),
          expect: 'installer sha256 missing or invalid',
        },
        {
          path: manifest({ version: '0.4.3-moe.30', artifacts: [{ name: 'win:app.asar', kind: 'asar', sha256: 'b'.repeat(64) }] }),
          expect: 'no Windows installer artifact',
        },
        { path: manifest('not-a-manifest-object'), expect: 'manifest version' },
      ];

      for (const testCase of cases) {
        const result = runPrintConfig(enginePath, ['--exe', installer.path, '--version', '0.4.3-moe.30', '--manifest', testCase.path]);
        expect(result.status, testCase.expect).toBe(2);
        expect(result.stderr).toContain(testCase.expect);
        expect(parseConfig(result.stdout).status).toBe('FAIL');
      }
    });
  });

  posixControllerIt('reports BLOCKED, never PASS, when the named installer is absent', () => {
    withTempDir((dir) => {
      const manifestPath = writeManifest(dir, '0.4.3-moe.30', 'Ministry of Education-0.4.3-moe.30-win-x64.exe', 'a'.repeat(64));
      const result = runPrintConfig(enginePath, ['--exe', join(dir, 'Ministry of Education-0.4.3-moe.30-win-x64.exe'), '--version', '0.4.3-moe.30', '--manifest', manifestPath]);

      expect(result.status).toBe(3);
      const config = parseConfig(result.stdout);
      expect(config.status).toBe('BLOCKED');
      expect(config.reason).toContain('installer not found');
      expect(config.installer.sha256).toBeNull();
    });
  });

  posixControllerIt('--print-config performs no cloud, guest or evidence-tree action', () => {
    withTempDir((dir) => {
      const installer = fakeInstaller(dir, 'Ministry of Education-0.4.3-moe.30-win-x64.exe');
      const binDir = join(dir, 'bin');
      // Sabotage every side-effecting tool the phases use: reaching any of them
      // during --print-config would exit 97 instead of 0.
      const sabotage = ['gcloud', 'gsutil', 'ssh', 'scp', 'nc', 'schtasks'];
      mkdirSync(binDir, { recursive: true });
      for (const tool of sabotage) {
        const toolPath = join(binDir, tool);
        writeFileSync(toolPath, `#!/usr/bin/env bash\necho "FORBIDDEN:${tool}" >&2\nexit 97\n`);
        chmodSync(toolPath, 0o755);
      }

      const manifestPath = writeManifest(dir, '0.4.3-moe.30', 'Ministry of Education-0.4.3-moe.30-win-x64.exe', installer.sha256);
      const result = spawnSync('bash', [enginePath, '--print-config', '--exe', installer.path, '--version', '0.4.3-moe.30', '--manifest', manifestPath], {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ''}` },
      });

      expect(result.status).toBe(0);
      expect(result.stderr).not.toContain('FORBIDDEN');
      expect(parseConfig(result.stdout).status).toBe('OK');
      // No evidence directory is created for a config-only invocation.
      expect(engine.indexOf('if [ "$PRINT_CONFIG" = "true" ]')).toBeLessThan(engine.indexOf('mkdir -p "$EVIDENCE_DIR"'));
    });
  });

  posixControllerIt('version-neutral wrapper requires an explicit identity plus manifest and forwards them unchanged', () => {
    withTempDir((dir) => {
      const installer = fakeInstaller(dir, 'Ministry of Education-0.4.3-moe.30-win-x64.exe');
      const manifestPath = writeManifest(dir, '0.4.3-moe.30', 'Ministry of Education-0.4.3-moe.30-win-x64.exe', installer.sha256);

      const missing = runPrintConfig(wrapperPath, []);
      expect(missing.status).toBe(2);
      expect(missing.stderr).toContain('requires BOTH --exe and --version');
      expect(missing.stdout).toBe('');

      const partial = runPrintConfig(wrapperPath, ['--exe', installer.path]);
      expect(partial.status).toBe(2);
      expect(partial.stderr).toContain('requires BOTH --exe and --version');

      const forwarded = runPrintConfig(wrapperPath, ['--exe', installer.path, '--version', '0.4.3-moe.30', '--manifest', manifestPath, '--guest-exe-name', 'moe30.exe']);
      expect(forwarded.status).toBe(0);
      expect(parseConfig(forwarded.stdout)).toMatchObject({
        legacyDefaults: false,
        version: '0.4.3-moe.30',
        guestExeName: 'moe30.exe',
        manifest: { version: '0.4.3-moe.30' },
      });
    });
  });

  posixControllerIt('delimiter-anchors the FileVersion assert against the real installed format', () => {
    // The pattern under test is the one the engine resolved and will feed to
    // grep -E in Phase 4 (on-disk FileVersion) and Phase 6 (running-binary
    // attest); it is evaluated here with grep itself, not a JS approximation.
    // Real installed FileVersions are the full semver string (moe.15/17/18/20
    // evidence: e.g. "0.4.3-moe.20").
    withTempDir((dir) => {
      const installer = fakeInstaller(dir, 'Ministry of Education-0.4.3-moe.30-win-x64.exe');
      const manifestPath = writeManifest(dir, '0.4.3-moe.30', 'Ministry of Education-0.4.3-moe.30-win-x64.exe', installer.sha256);
      const result = runPrintConfig(enginePath, ['--exe', installer.path, '--version', '0.4.3-moe.30', '--manifest', manifestPath]);
      expect(result.status).toBe(0);
      const pattern = parseConfig(result.stdout).expectFileVersionPattern;

      expect(grepMatches(pattern, '0.4.3-moe.30')).toBe(true);
      // Phase-6 attest line shape: "<FileVersion>|<path>".
      expect(grepMatches(pattern, '0.4.3-moe.30|C:\\Users\\clawxtest\\AppData\\Local\\Programs\\Ministry of Education\\Ministry of Education.exe')).toBe(true);
      // Pinned falsifiers (review F1): truncated/extended identities must not bind.
      expect(grepMatches(pattern, '0.4.3-moe.300')).toBe(false);
      expect(grepMatches(pattern, '10.4.3-moe.30')).toBe(false);
      expect(grepMatches(pattern, '0.4.3-moe.30.1')).toBe(false);
      expect(grepMatches(pattern, '0.4.3-moe.3')).toBe(false);

      // Legacy negative control: the historical "moe.19" expectation still
      // accepts the real moe.19 FileVersion, but no longer a superstring.
      const legacy = runPrintConfig(enginePath, []);
      const legacyPattern = parseConfig(legacy.stdout).expectFileVersionPattern;
      expect(grepMatches(legacyPattern, '0.4.3-moe.19')).toBe(true);
      expect(grepMatches(legacyPattern, '0.4.3-moe.19|C:\\x')).toBe(true);
      expect(grepMatches(legacyPattern, '0.4.3-moe.190')).toBe(false);
      expect(grepMatches(legacyPattern, '0.4.3-moe.191')).toBe(false);
    });
  });

  it('keeps phases, evidence layout and hash asserts bound to the parameters', () => {
    // The producer contract consumed by scripts/installed-release-evidence.mjs
    // must not drift while parameterizing: the guest object, both-hop hash and
    // running-binary attest all read the parameters, and no phase re-introduces
    // a literal moe.19 assumption outside the legacy default block.
    expect(engine).toContain('scp -P "$SSH_PORT" "$EXE" "$GUEST_USER@localhost:Downloads/$GUEST_EXE_NAME"');
    expect(engine).toContain('GUEST_SHA=$(gpwsh "(Get-FileHash \'$GUEST_DL\\\\$GUEST_EXE_NAME\').Hash"');
    expect(engine).toContain('[ "$GUEST_SHA" = "$SHA" ] || { log "FAIL: guest sha mismatch ($GUEST_SHA)"; exit 1; }');
    expect(engine).toContain('grep -Eq "$EXPECT_FILE_VERSION_RE" || { log "FAIL: on-disk FileVersion does not contain the delimited token $EXPECT_FILE_VERSION"; exit 1; }');
    expect(engine).toContain('echo "$RUN_ATTEST" | grep -Eq "$EXPECT_FILE_VERSION_RE"');
    expect(engine).toContain('guestPath: env.GUEST_DL && env.GUEST_EXE_NAME ? `${env.GUEST_DL}\\\\${env.GUEST_EXE_NAME}` : null');
    expect(engine).toContain('gsutil ls "${GCS_DEST}" 2>/dev/null | grep -qF "$(basename "$EXE")"');

    const afterLegacyBlock = engine.slice(engine.indexOf('EXE="$ARG_EXE"'));
    expect(afterLegacyBlock).not.toMatch(/moe\.?19/);

    // Every portable evidence file installed-release-evidence.mjs requires is
    // still produced by name.
    for (const evidenceFile of [
      'environment.json',
      'install-artifacts.json',
      'packages-nscc-presence.txt',
      'gateway-smoke.txt',
      'electron-probe-run.txt',
      'office-runtime.txt',
      'office-write.txt',
    ]) {
      expect(engine).toContain(evidenceFile);
    }
    expect(wrapper).toContain('exec bash "$ENGINE" "$@"');
  });
});
