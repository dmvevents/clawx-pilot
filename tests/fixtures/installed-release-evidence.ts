import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
// @ts-expect-error - plain .mjs module without type declarations
import { EXTRA_BUNDLED_PACKAGES } from '../../scripts/openclaw-bundle-config.mjs';

export type InstalledEvidenceFixtureManifest = {
  version: string;
  artifacts: Array<{
    name: string;
    kind: string;
    sha256: string;
  }>;
};

export type InstalledEvidenceFixtureOptions = {
  evidenceDir: string;
  manifest: InstalledEvidenceFixtureManifest;
  startedAt?: string;
  completedAt?: string;
  seedProfile?: 'seeded-private' | 'keyless-public';
};

const INSTALL_ROOT = 'C:\\Users\\clawxtest\\AppData\\Local\\Programs\\Ministry of Education';
const APP_EXE = `${INSTALL_ROOT}\\Ministry of Education.exe`;
const APP_ASAR = `${INSTALL_ROOT}\\resources\\app.asar`;

function fileSha256(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

export function refreshInstalledEvidenceBindings(evidenceDir: string): void {
  const vmRunPath = join(evidenceDir, 'vm-run.json');
  const vmRun = JSON.parse(readFileSync(vmRunPath, 'utf8'));
  const rawFiles = [
    'environment.json',
    'install-artifacts.json',
    'packages-nscc-presence.txt',
    'gateway-smoke.txt',
    'electron-probe-run.txt',
    'clawx-electron-probe-2026-09-07T01-04-00-000Z.json',
    'office-runtime.txt',
    'office-write.txt',
  ];
  vmRun.evidenceFiles = rawFiles.map((file) => ({ path: file, sha256: fileSha256(join(evidenceDir, file)) }));
  writeFileSync(vmRunPath, `${JSON.stringify(vmRun, null, 2)}\n`);
}

export function writeInstalledReleaseEvidenceFixture({
  evidenceDir,
  manifest,
  startedAt = '2026-09-07T01:02:03.000Z',
  completedAt = '2026-09-07T01:05:03.000Z',
  seedProfile = 'seeded-private',
}: InstalledEvidenceFixtureOptions) {
  const installer = manifest.artifacts.find((artifact) => artifact.kind === 'installer' && artifact.name.endsWith('.exe'));
  const appAsar = manifest.artifacts.find((artifact) => artifact.name === 'win:app.asar');
  if (!installer || !appAsar) throw new Error('fixture manifest needs installer and win:app.asar artifacts');

  const writeJson = (name: string, value: unknown) => {
    writeFileSync(join(evidenceDir, name), `${JSON.stringify(value, null, 2)}\n`);
    return name;
  };
  const writeText = (name: string, value: string) => {
    writeFileSync(join(evidenceDir, name), value.endsWith('\n') ? value : `${value}\n`);
    return name;
  };

  const environment = writeJson('environment.json', {
    schemaVersion: 1,
    status: 'COLLECTED',
    collectedAt: '2026-09-07T01:02:30.000Z',
    windows: {
      caption: 'Microsoft Windows Server 2022 Datacenter',
      version: '10.0.20348',
      build: '20348',
      productType: 3,
      architecture: '64-bit',
    },
    machine: {
      manufacturer: 'Google',
      model: 'Google Compute Engine',
      logicalProcessors: 4,
      memoryBytes: 17179869184,
      systemDiskFreeBytes: 53687091200,
      soundDeviceCount: 0,
      physicalMicrophoneTest: 'NOT_RUN',
    },
    user: {
      isElevated: true,
      administratorGroupMember: true,
      domainJoined: false,
    },
    priorState: {
      installPresent: true,
      appDataPresent: true,
      openclawPresent: true,
      chromeUserDataPresent: true,
    },
    coverage: ['Environment observations only', 'No clean-image attestation', 'No laptop-equivalence proof'],
  });

  const presentInstallRows = [
    ['Ministry of Education.exe', '1'.repeat(64)],
    ['resources\\app.asar', appAsar.sha256],
    ['resources\\openclaw\\node_modules\\playwright-core\\package.json', '2'.repeat(64)],
    ['resources\\bin\\ffmpeg.exe', '3'.repeat(64)],
    ['resources\\bin\\WinSpeechRecognize.exe', '4'.repeat(64)],
    ['Desktop\\Ministry of Education.lnk', '6'.repeat(64)],
    ['Microsoft\\Windows\\Start Menu\\Programs\\Ministry of Education.lnk', '7'.repeat(64)],
  ];
  if (seedProfile === 'seeded-private') presentInstallRows.splice(5, 0, ['resources\\resources\\cloud-gateway.json', '5'.repeat(64)]);
  const absentCredentialRows = [
    'resources\\resources\\cloud-gateway.json',
    'resources\\resources\\cloud-gateway.key',
    'resources\\resources\\azure-speech.json',
    'resources\\resources\\azure-speech.key',
  ].map((suffix) => ({
    Path: `${INSTALL_ROOT}\\${suffix}`,
    Exists: false,
    Length: null,
    Modified: null,
    Sha256: null,
    SecretMetadataOnly: suffix.endsWith('.key'),
  }));
  const seededSecretRows = [{
    Path: `${INSTALL_ROOT}\\resources\\resources\\cloud-gateway.key`,
    Exists: true,
    Length: 42,
    Modified: '2026-09-07T01:03:00.0000000Z',
    Sha256: null,
    SecretMetadataOnly: true,
  }];
  const installArtifacts = writeJson('install-artifacts.json', presentInstallRows.map(([suffix, hash]) => ({
    Path: `${INSTALL_ROOT}\\${suffix}`,
    Exists: true,
    Length: 123,
    Modified: '2026-09-07T01:03:00.0000000Z',
    Sha256: hash,
    SecretMetadataOnly: false,
  })).concat(seedProfile === 'keyless-public' ? absentCredentialRows : seededSecretRows));
  const packages = writeText(
    'packages-nscc-presence.txt',
    [...EXTRA_BUNDLED_PACKAGES, 'nscc-2026.txt'].map((name) => `${name}=True`).join('\n'),
  );
  const gatewaySmoke = writeText(
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
      'STATE:GATEWAY_EXITED=false',
    ].join('\n'),
  );
  const electronProbeRun = writeText(
    'electron-probe-run.txt',
    JSON.stringify({
      result: 'COMPLETE',
      summaryPath: 'C:\\Users\\clawxtest\\Downloads\\clawx-electron-probe-20260907-010203\\clawx-electron-probe-2026-09-07T01-04-00-000Z.json',
    }, null, 2),
  );
  const electronProbe = writeJson('clawx-electron-probe-2026-09-07T01-04-00-000Z.json', {
    state: 'ELECTRON_CDP_PROBE_DONE',
    renderer: { hasElectronInvoke: true },
    safeChat: {
      mode: 'outlook-open',
      sessionKey: 'agent:main:pilot-fixture',
      verificationToken: 'pilot-safe-chat-fixture-token',
      send: { success: true, result: { messageId: 'fixture-message' } },
      history: {
        ok: true,
        messageCount: 6,
        mode: 'outlook-open',
        verificationToken: 'pilot-safe-chat-fixture-token',
        expectedTool: 'outlook.open',
        scopedToCurrentPrompt: true,
        completed: true,
        finalAnswerEchoedMarker: true,
        observedToolCalls: [{ name: 'outlook.open', id: 'call-1' }],
        observedToolResults: [{ name: 'outlook.open', id: 'call-1', isError: false }],
        expectedToolResultOk: true,
        expectedToolOnly: true,
        unexpectedToolCalls: [],
        noBannedSideEffects: true,
        bannedToolCalls: [],
        bannedToolResults: [],
      },
    },
    validation: { ok: true, reasons: [] },
  });
  const officeRuntime = writeText(
    'office-runtime.txt',
    [
      'playwright-core=OK C:\\p\\playwright',
      'xlsx=OK C:\\p\\xlsx',
      'docx=OK C:\\p\\docx',
      'mammoth=OK C:\\p\\mammoth',
      'pdf-parse=OK C:\\p\\pdf-parse',
      'STATE: OFFICE_RUNTIME_READY_WITH_POWERPOINT',
    ].join('\n'),
  );
  const officeWrite = writeText(
    'office-write.txt',
    [
      'PASS  write_docx wrote valid OpenXML (8582 bytes) -> C:\\out\\x.docx',
      'PASS  read_docx round-trips the body text',
      'PASS  write_xlsx wrote valid OpenXML (16077 bytes) -> C:\\out\\x.xlsx',
      'PASS  read_xlsx round-trips a data row',
      'JS_RESULT: OK',
      'STATE: OFFICE_WRITE_OK',
    ].join('\n'),
  );

  const vmRun = writeJson('vm-run.json', {
    schemaVersion: 1,
    runId: '20260907-010203',
    platform: 'win32',
    startedAt,
    completedAt,
    result: 'COMPLETE',
    exitCode: 0,
    installer: {
      name: installer.name,
      sha256: installer.sha256,
      localPath: '/repo/release/installer.exe',
      guestPath: 'C:\\Users\\clawxtest\\Downloads\\moe19.exe',
      guestSha256: installer.sha256,
    },
    install: { exitCode: 0 },
    runningApp: {
      path: APP_EXE,
      version: manifest.version,
    },
    ports: { gateway: true, hostapi: true },
    appAsar: {
      path: APP_ASAR,
      sha256: appAsar.sha256,
    },
    environment: { path: environment },
    evidenceFiles: [environment, installArtifacts, packages, gatewaySmoke, electronProbeRun, electronProbe, officeRuntime, officeWrite]
      .map((file) => ({ path: file, sha256: fileSha256(join(evidenceDir, file)) })),
  });

  return {
    vmRun,
    environment,
    installArtifacts,
    packages,
    gatewaySmoke,
    electronProbeRun,
    electronProbe,
    officeRuntime,
    officeWrite,
  };
}
