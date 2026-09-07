import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { refreshInstalledEvidenceBindings, writeInstalledReleaseEvidenceFixture } from '../fixtures/installed-release-evidence';
// @ts-expect-error - plain .mjs module without type declarations
import { EXTRA_BUNDLED_PACKAGES } from '../../scripts/openclaw-bundle-config.mjs';
// @ts-expect-error - plain .mjs module without type declarations
import { evaluateInstalledEvidence } from '../../scripts/installed-release-evidence.mjs';

const VERSION = '0.4.3-moe.99';
const INSTALLER_SHA = 'a'.repeat(64);
const APP_ASAR_SHA = 'b'.repeat(64);
const SOURCE = {
  schemaVersion: 1,
  gitCommit: '0123456789abcdef0123456789abcdef01234567',
  gitDirty: false,
  gitStatusHash: null,
  recordedAt: '2026-09-07T00:00:00.000Z',
};

let evidenceDir: string;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function manifest(source: unknown = SOURCE) {
  return {
    version: VERSION,
    generatedAt: '2026-09-07T00:00:01.000Z',
    published: false,
    artifacts: [
      {
        name: `Ministry of Education-${VERSION}-win-x64.exe`,
        path: `Ministry of Education-${VERSION}-win-x64.exe`,
        kind: 'installer',
        sha256: INSTALLER_SHA,
        source,
      },
      {
        name: 'win:app.asar',
        path: 'win-unpacked/resources/app.asar',
        kind: 'asar',
        sha256: APP_ASAR_SHA,
        source,
      },
    ],
  };
}

function writeJson(name: string, value: unknown): void {
  writeFileSync(join(evidenceDir, name), `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(name: string, value: string): void {
  writeFileSync(join(evidenceDir, name), value.endsWith('\n') ? value : `${value}\n`);
}

function readFixture(name: string): string {
  return readFileSync(join(evidenceDir, name), 'utf8');
}

function readJsonFixture<T = unknown>(name: string): T {
  return JSON.parse(readFixture(name)) as T;
}

function rewriteJsonFixture<T>(name: string, update: (value: T) => void, refresh = true): void {
  const value = readJsonFixture<T>(name);
  update(value);
  writeJson(name, value);
  if (refresh) refreshInstalledEvidenceBindings(evidenceDir);
}

function writeFullFixture(): ReturnType<typeof writeInstalledReleaseEvidenceFixture> {
  return writeInstalledReleaseEvidenceFixture({ evidenceDir, manifest: manifest() });
}

async function evaluate(currentManifest: unknown = manifest()) {
  return evaluateInstalledEvidence({ manifest: currentManifest, evidenceDir });
}

function statuses(result: Awaited<ReturnType<typeof evaluateInstalledEvidence>>) {
  return new Map(result.checks.map((check: { id: string; status: string; reason: string }) => [check.id, check]));
}

beforeEach(() => {
  evidenceDir = mkdtempSync(join(tmpdir(), 'clwx-installed-evidence-'));
});

afterEach(() => {
  rmSync(evidenceDir, { recursive: true, force: true });
});

describe('installed-release-evidence (CLWX-106)', () => {
  it('accepts one complete raw installed-evidence run and returns relative file hashes', async () => {
    writeFullFixture();
    const result = await evaluate();

    expect(result.ok).toBe(true);
    expect(result.version).toBe(VERSION);
    expect(result.platform).toBe('win32');
    expect(result.sourceRevision).toBe(SOURCE.gitCommit);
    expect(result.installerName).toBe(`Ministry of Education-${VERSION}-win-x64.exe`);
    expect(result.installerSha256).toBe(INSTALLER_SHA);
    expect(result.appAsarSha256).toBe(APP_ASAR_SHA);
    expect(result.startedAt).toBe('2026-09-07T01:02:03.000Z');
    expect(result.completedAt).toBe('2026-09-07T01:05:03.000Z');
    expect(result.files).toContainEqual({ path: 'vm-run.json', sha256: sha256(readFixture('vm-run.json')) });
    expect(result.files).toContainEqual({ path: 'environment.json', sha256: sha256(readFixture('environment.json')) });
    expect(result.files).toContainEqual({ path: 'electron-probe-run.txt', sha256: sha256(readFixture('electron-probe-run.txt')) });
    expect(result.files.every((file: { path: string }) => !file.path.startsWith('/'))).toBe(true);
    expect(result.environmentScope).toMatchObject({
      targetClass: 'server',
      reusedState: true,
      noPriorState: false,
      elevation: {
        isElevated: true,
        administratorGroupMember: true,
      },
      windows: {
        caption: 'Microsoft Windows Server 2022 Datacenter',
        build: '20348',
        productType: 3,
      },
      machine: {
        logicalProcessors: 4,
        memoryBytes: 17179869184,
      },
    });
  });

  it('requires a collected environment profile bound to the vm-run portable inventory', async () => {
    writeFullFixture();
    rmSync(join(evidenceDir, 'environment.json'));

    const result = await evaluate();
    expect(result.ok).toBe(false);
    expect(statuses(result).get('environment-file')).toMatchObject({ status: 'NOT_RUN' });
    expect(statuses(result).get('vm-run-evidence-files')).toMatchObject({ status: 'FAIL' });
    expect(statuses(result).get('vm-run-evidence-files')?.reason).toContain('missing files environment.json');
  });

  it('rejects malformed environment profiles instead of inferring environment scope', async () => {
    writeFullFixture();
    rewriteJsonFixture<{
      windows: { build?: string; productType: unknown };
      machine: { memoryBytes: number };
      user: { isElevated?: boolean };
      priorState: { chromeUserDataPresent?: boolean };
    }>('environment.json', (environment) => {
      delete environment.windows.build;
      environment.windows.productType = '3';
      environment.machine.memoryBytes = 0;
      delete environment.user.isElevated;
      delete environment.priorState.chromeUserDataPresent;
    });

    const result = await evaluate();
    expect(result.ok).toBe(false);
    const check = statuses(result).get('environment-schema');
    expect(check).toMatchObject({ status: 'FAIL' });
    expect(check?.reason).toContain('windows.build missing');
    expect(check?.reason).toContain('windows.productType invalid');
    expect(check?.reason).toContain('machine.memoryBytes invalid');
    expect(check?.reason).toContain('user.isElevated invalid');
    expect(check?.reason).toContain('priorState.chromeUserDataPresent invalid');
  });

  it('rejects environment profiles collected outside the vm-run window', async () => {
    writeFullFixture();
    rewriteJsonFixture<{ collectedAt: string }>('environment.json', (environment) => {
      environment.collectedAt = '2026-09-07T01:06:00.000Z';
    });

    const result = await evaluate();
    expect(result.ok).toBe(false);
    expect(statuses(result).get('environment-timestamp')).toMatchObject({ status: 'FAIL' });
    expect(statuses(result).get('environment-timestamp')?.reason).toContain('collectedAt outside vm-run window');
  });

  it('exposes client/no-prior-state environment scope without turning it into clean-image acceptance', async () => {
    writeFullFixture();
    rewriteJsonFixture<{
      windows: { productType: number; caption: string };
      priorState: {
        installPresent: boolean;
        appDataPresent: boolean;
        openclawPresent: boolean;
        chromeUserDataPresent: boolean;
      };
    }>('environment.json', (environment) => {
      environment.windows.productType = 1;
      environment.windows.caption = 'Microsoft Windows 11 Pro';
      environment.priorState.installPresent = false;
      environment.priorState.appDataPresent = false;
      environment.priorState.openclawPresent = false;
      environment.priorState.chromeUserDataPresent = false;
    });

    const result = await evaluate();
    expect(result.ok).toBe(true);
    expect(result.environmentScope).toMatchObject({
      targetClass: 'client',
      reusedState: false,
      noPriorState: true,
      windows: {
        caption: 'Microsoft Windows 11 Pro',
        productType: 1,
      },
    });
  });

  it('fails closed when the installed app.asar hash does not match the manifest', async () => {
    writeFullFixture();
    rewriteJsonFixture<Array<{ Path: string; Sha256: string }>>('install-artifacts.json', (rows) => {
      const asar = rows.find((row) => row.Path.endsWith('resources\\app.asar'));
      if (asar) asar.Sha256 = 'c'.repeat(64);
    });

    const result = await evaluate();
    expect(result.ok).toBe(false);
    expect(statuses(result).get('installed-app-asar-hash')).toMatchObject({ status: 'FAIL' });
  });

  it('does not accept RESULT.md paper-green evidence without raw producer files', async () => {
    writeFileSync(join(evidenceDir, 'RESULT.md'), '# PASS\nEverything looked good.\n');
    const result = await evaluate();

    expect(result.ok).toBe(false);
    expect(statuses(result).get('vm-run-file')).toMatchObject({ status: 'NOT_RUN' });
    expect(result.files).toEqual([]);
  });

  it('rejects host-only Electron probes without current safe-chat runtime proof', async () => {
    writeFullFixture();
    writeJson('clawx-electron-probe-2026-09-07T01-04-00-000Z.json', {
      state: 'ELECTRON_CDP_PROBE_DONE',
      renderer: { hasElectronInvoke: true },
      hostApi: { outlookOpen: { status: 'opened' }, formsList: { ok: true } },
      validation: { ok: true, reasons: [] },
    });
    refreshInstalledEvidenceBindings(evidenceDir);

    const result = await evaluate();
    expect(result.ok).toBe(false);
    expect(statuses(result).get('electron-cdp-probe')).toMatchObject({ status: 'FAIL' });
  });

  it('rejects Electron probes whose validation passed with non-empty reasons', async () => {
    writeFullFixture();
    rewriteJsonFixture<{ validation: { reasons: string[] } }>('clawx-electron-probe-2026-09-07T01-04-00-000Z.json', (probe) => {
      probe.validation.reasons = ['safe chat did not complete'];
    });

    const result = await evaluate();
    expect(result.ok).toBe(false);
    expect(statuses(result).get('electron-cdp-probe')).toMatchObject({ status: 'FAIL' });
  });

  it('marks missing producers as NOT_RUN instead of inventing PASS from partial output', async () => {
    writeFullFixture();
    rmSync(join(evidenceDir, 'gateway-smoke.txt'));
    rmSync(join(evidenceDir, 'office-write.txt'));

    const result = await evaluate();
    expect(result.ok).toBe(false);
    expect(statuses(result).get('gateway-smoke-file')).toMatchObject({ status: 'NOT_RUN' });
    expect(statuses(result).get('office-write-file')).toMatchObject({ status: 'NOT_RUN' });
  });

  it('rejects ambiguous runs rather than merging files across executions', async () => {
    writeFullFixture();
    writeJson('clawx-electron-probe-2026-09-07T01-06-00-000Z.json', {
      state: 'ELECTRON_CDP_PROBE_DONE',
      renderer: { hasElectronInvoke: true },
      validation: { ok: true, reasons: [] },
    });

    const result = await evaluate();
    expect(result.ok).toBe(false);
    expect(statuses(result).get('electron-probe-file')).toMatchObject({ status: 'FAIL' });
  });

  it('reports manifest source provenance as NOT_RUN for legacy manifests', async () => {
    writeFullFixture();
    const legacyManifest = manifest(undefined);
    legacyManifest.artifacts.forEach((artifact: { source?: unknown }) => {
      delete artifact.source;
    });

    const result = await evaluate(legacyManifest);
    expect(result.ok).toBe(false);
    expect(result.sourceRevision).toBeNull();
    expect(statuses(result).get('manifest-source-revision')).toMatchObject({ status: 'NOT_RUN' });
  });

  it('rejects duplicate install artifact rows and exact running-app path mismatches', async () => {
    writeFullFixture();
    rewriteJsonFixture<Array<{ Path: string }>>('install-artifacts.json', (rows) => {
      rows.push({ ...rows[0] });
    });
    rewriteJsonFixture<{ runningApp: { path: string } }>('vm-run.json', (vmRun) => {
      vmRun.runningApp.path = vmRun.runningApp.path.replace('Ministry of Education.exe', 'Ministry of Education-copy.exe');
    }, false);

    const result = await evaluate();
    expect(result.ok).toBe(false);
    expect(statuses(result).get('install-artifact-rows')).toMatchObject({ status: 'FAIL' });
    expect(statuses(result).get('install-artifact-rows')?.reason).toContain('duplicate');
    expect(statuses(result).get('install-artifact-rows')?.reason).toContain('running app path');
  });

  it('rejects exact running-app path mismatches against the measured exe row', async () => {
    writeFullFixture();
    rewriteJsonFixture<{ runningApp: { path: string } }>('vm-run.json', (vmRun) => {
      vmRun.runningApp.path = vmRun.runningApp.path.replace('Ministry of Education.exe', 'Ministry of Education-copy.exe');
    }, false);

    const result = await evaluate();
    expect(result.ok).toBe(false);
    expect(statuses(result).get('install-artifact-rows')).toMatchObject({ status: 'FAIL' });
    expect(statuses(result).get('install-artifact-rows')?.reason).toContain('running app path');
  });

  it('rejects stale raw producer files that are not bound to vm-run hashes', async () => {
    writeFullFixture();
    writeText('packages-nscc-presence.txt', ['nscc-2026.txt', ...EXTRA_BUNDLED_PACKAGES].map((name: string) => `${name}=True`).join('\n'));

    const result = await evaluate();
    expect(result.ok).toBe(false);
    expect(statuses(result).get('vm-run-evidence-files')).toMatchObject({ status: 'FAIL' });
  });

  it('rejects private, unknown, duplicate, or nonexistent vm-run evidence file entries', async () => {
    writeFullFixture();
    rewriteJsonFixture<{ evidenceFiles: Array<{ path: string; sha256: string }> }>('vm-run.json', (vmRun) => {
      vmRun.evidenceFiles.push(
        { path: 'pre-install-backup.txt', sha256: '1'.repeat(64) },
        { path: 'gateway-smoke.txt.stderr.txt', sha256: '2'.repeat(64) },
        { path: 'nonexistent-private-extra.txt', sha256: '3'.repeat(64) },
        { ...vmRun.evidenceFiles[0] },
      );
    }, false);

    const result = await evaluate();
    expect(result.ok).toBe(false);
    const check = statuses(result).get('vm-run-evidence-files');
    expect(check).toMatchObject({ status: 'FAIL' });
    expect(check?.reason).toContain('duplicates');
    expect(check?.reason).toContain('unknown extra entries');
  });

  it('rejects vm-run portable inventories missing a canonical consumed producer file', async () => {
    writeFullFixture();
    rewriteJsonFixture<{ evidenceFiles: Array<{ path: string; sha256: string }> }>('vm-run.json', (vmRun) => {
      vmRun.evidenceFiles = vmRun.evidenceFiles.filter((entry) => entry.path !== 'electron-probe-run.txt');
    }, false);

    const result = await evaluate();
    expect(result.ok).toBe(false);
    expect(statuses(result).get('vm-run-evidence-files')).toMatchObject({ status: 'FAIL' });
    expect(statuses(result).get('vm-run-evidence-files')?.reason).toContain('missing entries electron-probe-run.txt');
  });

  it('rejects package inventories with duplicate, missing, false, or unknown rows', async () => {
    writeFullFixture();
    writeText(
      'packages-nscc-presence.txt',
      [
        ...EXTRA_BUNDLED_PACKAGES.slice(1).map((name: string) => `${name}=True`),
        `${EXTRA_BUNDLED_PACKAGES[1]}=False`,
        `${EXTRA_BUNDLED_PACKAGES[1]}=True`,
        'unknown-package=True',
        'nscc-2026.txt=True',
      ].join('\n'),
    );
    refreshInstalledEvidenceBindings(evidenceDir);

    const result = await evaluate();
    expect(result.ok).toBe(false);
    expect(statuses(result).get('packages-nscc-presence')).toMatchObject({ status: 'FAIL' });
    expect(statuses(result).get('packages-nscc-presence')?.reason).toContain('duplicates');
  });

  it('rejects gateway smoke output with duplicate or implicit GATEWAY_EXITED state', async () => {
    writeFullFixture();
    writeText(
      'gateway-smoke.txt',
      [
        'STATE:SAFE_METADATA_ONLY=true',
        'STATE:RESULT=COMPLETE',
        'STATE:NODE_EXISTS=true',
        'STATE:NODE_EXISTS=false',
        'STATE:ENTRY_EXISTS=true',
        'STATE:CWD_EXISTS=true',
        'STATE:PLAYWRIGHT_CORE_EXISTS=true',
        'STATE:GATEWAY_TCP_READY=true',
        'STATE:SYSTEM_PRESENCE_CHALLENGE=true',
        'STATE:SYSTEM_PRESENCE_HANDSHAKE=true',
        'STATE:SYSTEM_PRESENCE_RPC=true',
        'STATE:GATEWAY_READY=true',
      ].join('\n'),
    );
    refreshInstalledEvidenceBindings(evidenceDir);

    const result = await evaluate();
    expect(result.ok).toBe(false);
    expect(statuses(result).get('gateway-smoke-file')).toMatchObject({ status: 'FAIL' });
  });

  it('rejects gateway smoke output that claims ready with old TCP-only fields', async () => {
    writeFullFixture();
    writeText(
      'gateway-smoke.txt',
      [
        'STATE:SAFE_METADATA_ONLY=true',
        'STATE:RESULT=COMPLETE',
        'STATE:NODE_EXISTS=true',
        'STATE:ENTRY_EXISTS=true',
        'STATE:CWD_EXISTS=true',
        'STATE:PLAYWRIGHT_CORE_EXISTS=true',
        'STATE:GATEWAY_READY=true',
        'STATE:GATEWAY_EXITED=false',
      ].join('\n'),
    );
    refreshInstalledEvidenceBindings(evidenceDir);

    const result = await evaluate();
    expect(result.ok).toBe(false);
    expect(statuses(result).get('gateway-smoke')).toMatchObject({ status: 'FAIL' });
    expect(statuses(result).get('gateway-smoke')?.reason).toContain('SYSTEM_PRESENCE_RPC');
  });

  it('rejects gateway smoke output when executable prerequisites are false', async () => {
    writeFullFixture();
    const original = readFixture('gateway-smoke.txt');
    writeText('gateway-smoke.txt', original.replace('STATE:NODE_EXISTS=true', 'STATE:NODE_EXISTS=false'));
    refreshInstalledEvidenceBindings(evidenceDir);

    const result = await evaluate();
    expect(result.ok).toBe(false);
    const check = statuses(result).get('gateway-smoke');
    expect(check).toMatchObject({ status: 'FAIL' });
    expect(check?.reason).toContain('NODE_EXISTS');
  });

  it('rejects gateway smoke output when any readiness handshake predicate is false', async () => {
    for (const field of [
      'GATEWAY_TCP_READY',
      'SYSTEM_PRESENCE_CHALLENGE',
      'SYSTEM_PRESENCE_HANDSHAKE',
      'SYSTEM_PRESENCE_RPC',
    ]) {
      writeFullFixture();
      const original = readFixture('gateway-smoke.txt');
      writeText('gateway-smoke.txt', original.replace(`STATE:${field}=true`, `STATE:${field}=false`));
      refreshInstalledEvidenceBindings(evidenceDir);

      const result = await evaluate();
      expect(result.ok).toBe(false);
      const check = statuses(result).get('gateway-smoke');
      expect(check).toMatchObject({ status: 'FAIL' });
      expect(check?.reason).toContain(field);
    }
  });

  it('rejects portable gateway evidence containing repeated raw diagnostic rows', async () => {
    writeFullFixture();
    const original = readFixture('gateway-smoke.txt');
    writeText(
      'gateway-smoke.txt',
      `${original}\nSTATE:ARGUMENT_LINE=--token secret-token-sentinel --private https://private.example.invalid\nSTATE:STDOUT=teacher@example.edu ready\nSTATE:STDOUT=secret-token-sentinel repeated\nSTATE:STDERR=https://private.example.invalid failed\n`,
    );
    refreshInstalledEvidenceBindings(evidenceDir);

    const result = await evaluate();
    expect(result.ok).toBe(false);
    const check = statuses(result).get('gateway-smoke');
    expect(check).toMatchObject({ status: 'FAIL' });
    expect(check?.reason).toContain('raw diagnostic fields present');
  });

  it('requires gateway safe metadata marker and explicit false exit state', async () => {
    writeFullFixture();
    const original = readFixture('gateway-smoke.txt');
    writeText('gateway-smoke.txt', original.replace('GATEWAY_EXITED=false', 'GATEWAY_EXITED=unknown'));
    refreshInstalledEvidenceBindings(evidenceDir);
    expect((await evaluate()).ok).toBe(false);

    writeText('gateway-smoke.txt', original.replace('STATE:SAFE_METADATA_ONLY=true\n', ''));
    refreshInstalledEvidenceBindings(evidenceDir);
    const result = await evaluate();
    expect(result.ok).toBe(false);
    expect(statuses(result).get('gateway-smoke')?.reason).toContain('SAFE_METADATA_ONLY');
  });

  it('rejects gateway smoke output when GATEWAY_EXITED=false is not explicit', async () => {
    writeFullFixture();
    writeText(
      'gateway-smoke.txt',
      [
        'STATE:SAFE_METADATA_ONLY=true',
        'STATE:RESULT=COMPLETE',
        'STATE:NODE_EXISTS=true',
        'STATE:ENTRY_EXISTS=true',
        'STATE:CWD_EXISTS=true',
        'STATE:PLAYWRIGHT_CORE_EXISTS=true',
        'STATE:GATEWAY_TCP_READY=true',
        'STATE:SYSTEM_PRESENCE_CHALLENGE=true',
        'STATE:SYSTEM_PRESENCE_HANDSHAKE=true',
        'STATE:SYSTEM_PRESENCE_RPC=true',
        'STATE:GATEWAY_READY=true',
      ].join('\n'),
    );
    refreshInstalledEvidenceBindings(evidenceDir);

    const result = await evaluate();
    expect(result.ok).toBe(false);
    expect(statuses(result).get('gateway-smoke')).toMatchObject({ status: 'FAIL' });
    expect(statuses(result).get('gateway-smoke')?.reason).toContain('exited=(missing)');
  });

  it('rejects Electron run output that points at a different probe JSON', async () => {
    writeFullFixture();
    writeText('electron-probe-run.txt', JSON.stringify({
      result: 'COMPLETE',
      summaryPath: 'C:\\Users\\clawxtest\\Downloads\\clawx-electron-probe-20260907-010203\\clawx-electron-probe-other.json',
    }, null, 2));
    refreshInstalledEvidenceBindings(evidenceDir);

    const result = await evaluate();
    expect(result.ok).toBe(false);
    expect(statuses(result).get('electron-probe-run-current-json')).toMatchObject({ status: 'FAIL' });
  });

  it('rejects Office runtime logs that end in partial/fail after ready/module OK lines', async () => {
    writeFullFixture();
    writeText(
      'office-runtime.txt',
      [
        'playwright-core=OK C:\\p\\playwright',
        'xlsx=OK C:\\p\\xlsx',
        'docx=OK C:\\p\\docx',
        'mammoth=OK C:\\p\\mammoth',
        'pdf-parse=OK C:\\p\\pdf-parse',
        'STATE: OFFICE_RUNTIME_READY_WITH_POWERPOINT',
        'pdf-parse=FAILED-LOAD missing dependency',
        'STATE: OFFICE_RUNTIME_PARTIAL',
      ].join('\n'),
    );
    refreshInstalledEvidenceBindings(evidenceDir);

    const result = await evaluate();
    expect(result.ok).toBe(false);
    expect(statuses(result).get('office-runtime')).toMatchObject({ status: 'FAIL' });
  });

  it('rejects Office write logs that end in partial/fail after earlier PASS lines', async () => {
    writeFullFixture();
    writeText(
      'office-write.txt',
      [
        'PASS  write_docx wrote valid OpenXML (8582 bytes) -> C:\\out\\x.docx',
        'PASS  read_docx round-trips the body text',
        'PASS  write_xlsx wrote valid OpenXML (16077 bytes) -> C:\\out\\x.xlsx',
        'PASS  read_xlsx round-trips a data row',
        'JS_RESULT: OK',
        'STATE: OFFICE_WRITE_OK',
        'FAIL  read_xlsx final readback failed',
        'JS_RESULT: FAIL',
        'STATE: OFFICE_WRITE_PARTIAL',
      ].join('\n'),
    );
    refreshInstalledEvidenceBindings(evidenceDir);

    const result = await evaluate();
    expect(result.ok).toBe(false);
    expect(statuses(result).get('office-write')).toMatchObject({ status: 'FAIL' });
  });

  it('rejects vm-run schema, platform, exit code, and timestamp inconsistencies', async () => {
    writeFullFixture();
    rewriteJsonFixture<{ platform: string; exitCode: number; startedAt: string; completedAt: string }>('vm-run.json', (vmRun) => {
      vmRun.platform = 'darwin';
      vmRun.exitCode = 1;
      vmRun.startedAt = '2026-09-07T01:06:00.000Z';
      vmRun.completedAt = '2026-09-07T01:05:00.000Z';
    }, false);

    const result = await evaluate();
    expect(result.ok).toBe(false);
    expect(statuses(result).get('vm-run-schema')).toMatchObject({ status: 'FAIL' });
  });

  it('does not accept JSON aliases for producer stdout files', async () => {
    writeFullFixture();
    const gateway = readFixture('gateway-smoke.txt');
    rmSync(join(evidenceDir, 'gateway-smoke.txt'));
    writeJson('gateway-smoke.json', { RESULT: 'COMPLETE', raw: gateway });

    const result = await evaluate();
    expect(result.ok).toBe(false);
    expect(statuses(result).get('gateway-smoke-file')).toMatchObject({ status: 'NOT_RUN' });
  });
});
