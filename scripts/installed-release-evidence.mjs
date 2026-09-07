#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXTRA_BUNDLED_PACKAGES } from './openclaw-bundle-config.mjs';

const STATUS = {
  PASS: 'PASS',
  FAIL: 'FAIL',
  BLOCKED: 'BLOCKED',
  NOT_RUN: 'NOT_RUN',
};

const REQUIRED_INSTALL_SUFFIXES = [
  { id: 'app-exe', suffix: 'Ministry of Education.exe' },
  { id: 'app-asar', suffix: 'resources\\app.asar' },
  { id: 'playwright-core', suffix: 'resources\\openclaw\\node_modules\\playwright-core\\package.json' },
  { id: 'ffmpeg', suffix: 'resources\\bin\\ffmpeg.exe' },
  { id: 'win-speech', suffix: 'resources\\bin\\WinSpeechRecognize.exe' },
  { id: 'cloud-config', suffix: 'resources\\resources\\cloud-gateway.json' },
  { id: 'cloud-key', suffix: 'resources\\resources\\cloud-gateway.key', secret: true },
  { id: 'desktop-shortcut', suffix: 'Desktop\\Ministry of Education.lnk' },
  { id: 'start-shortcut', suffix: 'Microsoft\\Windows\\Start Menu\\Programs\\Ministry of Education.lnk' },
];

const REQUIRED_RUNTIME_MODULES = ['playwright-core', 'xlsx', 'docx', 'mammoth', 'pdf-parse'];
const REQUIRED_PACKAGE_ROWS = [...EXTRA_BUNDLED_PACKAGES, 'nscc-2026.txt'];
const REQUIRED_PORTABLE_EVIDENCE_FILES = [
  'environment.json',
  'install-artifacts.json',
  'packages-nscc-presence.txt',
  'gateway-smoke.txt',
  'electron-probe-run.txt',
  'office-runtime.txt',
  'office-write.txt',
];
const EVIDENCE_FILE_CANDIDATES = {
  vmRun: ['vm-run.json'],
  environment: ['environment.json'],
  installArtifacts: ['install-artifacts.json'],
  packages: ['packages-nscc-presence.txt'],
  gatewaySmoke: ['gateway-smoke.txt'],
  electronProbeRun: ['electron-probe-run.txt'],
  officeRuntime: ['office-runtime.txt'],
  officeWrite: ['office-write.txt'],
};

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function normalizeWinPath(value) {
  return String(value ?? '').replace(/\//g, '\\').toLowerCase();
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : [value].filter(Boolean);
}

function statusFromExit(result) {
  if (result === 'BLOCKED' || String(result ?? '').startsWith('BLOCKED')) return STATUS.BLOCKED;
  if (result === 'COMPLETE') return STATUS.PASS;
  if (result == null || result === 'NOT_RUN') return STATUS.NOT_RUN;
  return STATUS.FAIL;
}

function addCheck(checks, id, status, reason = '') {
  checks.push({ id, status, reason });
}

function findOne(evidenceDir, candidates, checks, id, required = true) {
  const matches = candidates.filter((name) => existsSync(path.join(evidenceDir, name)));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    addCheck(checks, id, STATUS.FAIL, `ambiguous evidence files: ${matches.join(', ')}`);
    return null;
  }
  if (required) addCheck(checks, id, STATUS.NOT_RUN, `${candidates[0]} not present`);
  return null;
}

function findOneGlob(evidenceDir, pattern, checks, id) {
  const matches = readdirSync(evidenceDir).filter((name) => pattern.test(name)).sort();
  if (matches.length === 1) return matches[0];
  addCheck(
    checks,
    id,
    matches.length === 0 ? STATUS.NOT_RUN : STATUS.FAIL,
    matches.length === 0 ? 'electron probe JSON not present' : `ambiguous electron probe JSON files: ${matches.join(', ')}`,
  );
  return null;
}

function parseStateLines(text) {
  const out = {};
  const duplicates = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^STATE:([^=]+)=(.*)$/);
    if (!match) continue;
    const key = match[1].trim();
    // The default gateway producer can emit one of these per diagnostic log line.
    // Keep duplicate tolerance for parser compatibility, but surface that raw
    // diagnostics were present so accepted portable evidence can reject them.
    if (key === 'STDOUT' || key === 'STDERR') {
      out.__RAW_DIAGNOSTIC_STATE = true;
      continue;
    }
    if (Object.hasOwn(out, key)) duplicates.push(key);
    out[key] = match[2].trim();
  }
  if (duplicates.length > 0) throw new Error(`duplicate STATE fields: ${[...new Set(duplicates)].join(', ')}`);
  return out;
}

function readJsonOrState(filePath) {
  const text = readFileSync(filePath, 'utf8').trim();
  if (!text) throw new Error('empty evidence file');
  if (filePath.endsWith('.json')) return JSON.parse(text);
  return parseStateLines(text);
}

function boolValue(value) {
  if (typeof value === 'boolean') return value;
  return /^true$/i.test(String(value ?? '').trim());
}

function hasOwn(value, key) {
  return isObject(value) && Object.hasOwn(value, key);
}

function lowerHash(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value) ? value.toLowerCase() : null;
}

function sha256File(filePath) {
  const hash = createHash('sha256');
  hash.update(readFileSync(filePath));
  return hash.digest('hex');
}

function readEvidenceFile(evidenceDir, relativePath, files, { json = false, state = false } = {}) {
  const fullPath = path.join(evidenceDir, relativePath);
  const stat = statSync(fullPath);
  if (!stat.isFile()) throw new Error(`${relativePath} is not a file`);
  files.push({ path: relativePath, sha256: sha256File(fullPath) });
  return json ? readJson(fullPath) : state ? readJsonOrState(fullPath) : readFileSync(fullPath, 'utf8');
}

function manifestArtifact(manifest, nameOrPredicate) {
  const artifacts = Array.isArray(manifest?.artifacts) ? manifest.artifacts : [];
  if (typeof nameOrPredicate === 'function') return artifacts.find(nameOrPredicate) ?? null;
  return artifacts.find((artifact) => artifact.name === nameOrPredicate) ?? null;
}

function sourceRevisionFromManifest(manifest) {
  const artifacts = Array.isArray(manifest?.artifacts) ? manifest.artifacts : [];
  const targets = artifacts.filter((artifact) => artifact.name === 'win:app.asar' || artifact.name?.startsWith?.('win:') || (artifact.kind === 'installer' && /\.exe$/i.test(String(artifact.name))));
  if (targets.length === 0) return null;
  if (!targets.every((artifact) => typeof artifact?.source?.gitCommit === 'string' && /^[0-9a-f]{40}$/i.test(artifact.source.gitCommit))) return null;
  const revisions = new Set(
    targets
      .map((artifact) => artifact?.source?.gitCommit)
      .map((commit) => commit.toLowerCase()),
  );
  return revisions.size === 1 ? [...revisions][0] : null;
}

function checkManifest(manifest, checks) {
  if (!isObject(manifest) || typeof manifest.version !== 'string') {
    addCheck(checks, 'manifest', STATUS.FAIL, 'manifest is missing a version');
    return { installer: null, appAsar: null, sourceRevision: null };
  }
  addCheck(checks, 'manifest', STATUS.PASS, `version ${manifest.version}`);
  const installer = manifestArtifact(manifest, (artifact) => artifact.kind === 'installer' && /\.exe$/i.test(String(artifact.name)));
  const appAsar = manifestArtifact(manifest, 'win:app.asar');
  if (!installer?.name || !lowerHash(installer.sha256)) addCheck(checks, 'manifest-installer', STATUS.FAIL, 'Windows installer artifact is missing or unhashed');
  else addCheck(checks, 'manifest-installer', STATUS.PASS, installer.name);
  if (!appAsar?.name || !lowerHash(appAsar.sha256)) addCheck(checks, 'manifest-app-asar', STATUS.FAIL, 'win:app.asar artifact is missing or unhashed');
  else addCheck(checks, 'manifest-app-asar', STATUS.PASS, appAsar.name);
  const sourceRevision = sourceRevisionFromManifest(manifest);
  addCheck(
    checks,
    'manifest-source-revision',
    sourceRevision ? STATUS.PASS : STATUS.NOT_RUN,
    sourceRevision ? sourceRevision : 'manifest artifacts do not share explicit build source provenance',
  );
  return { installer, appAsar, sourceRevision };
}

function validIsoTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed);
}

function checkVmRunSchema(vmRun, checks) {
  const reasons = [];
  if (vmRun?.schemaVersion !== 1) reasons.push(`schemaVersion=${vmRun?.schemaVersion ?? '(missing)'}`);
  if (vmRun?.platform !== 'win32') reasons.push(`platform=${vmRun?.platform ?? '(missing)'}`);
  if (!Number.isInteger(vmRun?.exitCode)) reasons.push(`exitCode=${vmRun?.exitCode ?? '(missing)'}`);
  if (!validIsoTimestamp(vmRun?.startedAt)) reasons.push('startedAt invalid');
  if (!validIsoTimestamp(vmRun?.completedAt)) reasons.push('completedAt invalid');
  if (validIsoTimestamp(vmRun?.startedAt) && validIsoTimestamp(vmRun?.completedAt) && Date.parse(vmRun.startedAt) > Date.parse(vmRun.completedAt)) reasons.push('startedAt after completedAt');
  if (!['COMPLETE', 'FAIL', 'BLOCKED', 'NOT_RUN'].includes(vmRun?.result)) reasons.push(`result=${vmRun?.result ?? '(missing)'}`);
  if (vmRun?.result === 'COMPLETE' && vmRun?.exitCode !== 0) reasons.push(`complete exitCode=${vmRun?.exitCode}`);
  addCheck(checks, 'vm-run-schema', reasons.length === 0 ? STATUS.PASS : STATUS.FAIL, reasons.join('; ') || 'schemaVersion 1 win32 timestamps valid');
  return reasons.length === 0;
}


function environmentTargetClass(productType) {
  if (productType === 1) return 'client';
  if (productType === 2 || productType === 3) return 'server';
  return 'unknown';
}

function environmentScope(environment) {
  if (!environment) return null;
  const prior = environment.priorState ?? {};
  return {
    targetClass: environmentTargetClass(environment.windows?.productType),
    reusedState: Boolean(prior.installPresent || prior.appDataPresent || prior.openclawPresent || prior.chromeUserDataPresent),
    noPriorState: prior.installPresent === false && prior.appDataPresent === false && prior.openclawPresent === false && prior.chromeUserDataPresent === false,
    elevation: {
      isElevated: environment.user?.isElevated ?? null,
      administratorGroupMember: environment.user?.administratorGroupMember ?? null,
    },
    windows: {
      caption: environment.windows?.caption ?? null,
      version: environment.windows?.version ?? null,
      build: environment.windows?.build ?? null,
      productType: environment.windows?.productType ?? null,
      architecture: environment.windows?.architecture ?? null,
    },
    machine: {
      logicalProcessors: environment.machine?.logicalProcessors ?? null,
      memoryBytes: environment.machine?.memoryBytes ?? null,
    },
    coverage: Array.isArray(environment.coverage) ? environment.coverage : [],
  };
}

function checkEnvironment(environment, vmRun, checks) {
  const reasons = [];
  if (environment?.schemaVersion !== 1) reasons.push(`schemaVersion=${environment?.schemaVersion ?? '(missing)'}`);
  if (environment?.status !== 'COLLECTED') reasons.push(`status=${environment?.status ?? '(missing)'}`);
  if (!validIsoTimestamp(environment?.collectedAt)) reasons.push('collectedAt invalid');
  if (typeof environment?.windows?.caption !== 'string' || environment.windows.caption.trim() === '') reasons.push('windows.caption missing');
  if (typeof environment?.windows?.version !== 'string' || environment.windows.version.trim() === '') reasons.push('windows.version missing');
  if (typeof environment?.windows?.build !== 'string' || environment.windows.build.trim() === '') reasons.push('windows.build missing');
  if (![1, 2, 3].includes(environment?.windows?.productType)) reasons.push('windows.productType invalid');
  if (typeof environment?.windows?.architecture !== 'string' || environment.windows.architecture.trim() === '') reasons.push('windows.architecture missing');
  if (!Number.isInteger(environment?.machine?.logicalProcessors) || environment.machine.logicalProcessors <= 0) reasons.push('machine.logicalProcessors invalid');
  if (!Number.isFinite(environment?.machine?.memoryBytes) || environment.machine.memoryBytes <= 0) reasons.push('machine.memoryBytes invalid');
  if (typeof environment?.user?.isElevated !== 'boolean') reasons.push('user.isElevated invalid');
  if (typeof environment?.user?.administratorGroupMember !== 'boolean') reasons.push('user.administratorGroupMember invalid');
  for (const key of ['installPresent', 'appDataPresent', 'openclawPresent', 'chromeUserDataPresent']) {
    if (typeof environment?.priorState?.[key] !== 'boolean') reasons.push(`priorState.${key} invalid`);
  }
  addCheck(checks, 'environment-schema', reasons.length === 0 ? STATUS.PASS : STATUS.FAIL, reasons.join('; ') || 'schemaVersion 1 collected Windows environment profile');

  const timestampReasons = [];
  if (!validIsoTimestamp(environment?.collectedAt) || !validIsoTimestamp(vmRun?.startedAt) || !validIsoTimestamp(vmRun?.completedAt)) {
    timestampReasons.push('timestamp missing or invalid');
  } else {
    const collectedAt = Date.parse(environment.collectedAt);
    if (collectedAt < Date.parse(vmRun.startedAt) || collectedAt > Date.parse(vmRun.completedAt)) timestampReasons.push('collectedAt outside vm-run window');
  }
  addCheck(checks, 'environment-timestamp', timestampReasons.length === 0 ? STATUS.PASS : STATUS.FAIL, timestampReasons.join('; ') || 'collectedAt within vm-run window');
}

function checkVmRun(vmRun, manifest, installer, appAsar, checks) {
  checkVmRunSchema(vmRun, checks);
  const resultStatus = statusFromExit(vmRun?.result);
  if (resultStatus !== STATUS.PASS) {
    addCheck(checks, 'vm-run', resultStatus, `result ${vmRun?.result ?? '(missing)'}`);
    return;
  }
  addCheck(checks, 'vm-run', STATUS.PASS, 'wrapper result COMPLETE');

  const expectedInstallerSha = lowerHash(installer?.sha256);
  const localSha = lowerHash(vmRun?.installer?.sha256);
  const guestSha = lowerHash(vmRun?.installer?.guestSha256);
  const installerNameMatches = vmRun?.installer?.name === installer?.name;
  addCheck(
    checks,
    'installer-both-hop-hash',
    installerNameMatches && expectedInstallerSha && localSha === expectedInstallerSha && guestSha === expectedInstallerSha ? STATUS.PASS : STATUS.FAIL,
    `name=${vmRun?.installer?.name ?? '(missing)'} local=${localSha ?? '(missing)'} guest=${guestSha ?? '(missing)'}`,
  );
  addCheck(
    checks,
    'installer-exit',
    vmRun?.install?.exitCode === 0 ? STATUS.PASS : STATUS.FAIL,
    `exit=${vmRun?.install?.exitCode ?? '(missing)'}`,
  );
  addCheck(
    checks,
    'running-app-version',
    vmRun?.runningApp?.version === manifest.version ? STATUS.PASS : STATUS.FAIL,
    `${vmRun?.runningApp?.version ?? '(missing)'}`,
  );
  addCheck(
    checks,
    'running-ports',
    vmRun?.ports?.gateway === true && vmRun?.ports?.hostapi === true ? STATUS.PASS : STATUS.FAIL,
    `gateway=${String(vmRun?.ports?.gateway)} hostapi=${String(vmRun?.ports?.hostapi)}`,
  );
  const expectedAsar = lowerHash(appAsar?.sha256);
  const vmAsar = lowerHash(vmRun?.appAsar?.sha256);
  addCheck(
    checks,
    'vm-run-app-asar-hash',
    expectedAsar && vmAsar === expectedAsar ? STATUS.PASS : STATUS.FAIL,
    `expected=${expectedAsar ?? '(missing)'} actual=${vmAsar ?? '(missing)'}`,
  );
}

function rowPath(row) {
  return row?.Path ?? row?.path;
}

function rowHash(row) {
  return lowerHash(row?.Sha256 ?? row?.sha256);
}

function rowLength(row) {
  return Number(row?.Length ?? row?.length ?? 0);
}

function rowExists(row) {
  return row?.Exists === true || row?.exists === true;
}

function installRowsForSuffix(rows, suffix) {
  const normalizedSuffix = normalizeWinPath(suffix);
  return rows.filter((row) => normalizeWinPath(rowPath(row)).endsWith(normalizedSuffix));
}

function oneInstallRow(rows, suffix, problems) {
  const matches = installRowsForSuffix(rows, suffix);
  if (matches.length === 0) return null;
  if (matches.length > 1) problems.push(`duplicate ${suffix}`);
  return matches[0];
}

function checkInstallArtifacts(rowsValue, appAsar, vmRun, checks) {
  const rows = asArray(rowsValue);
  const missing = [];
  const badSecrets = [];
  const duplicateProblems = [];
  for (const item of REQUIRED_INSTALL_SUFFIXES) {
    const row = oneInstallRow(rows, item.suffix, duplicateProblems);
    if (!row || !rowExists(row)) {
      missing.push(item.id);
      continue;
    }
    if (item.secret && (row.SecretMetadataOnly !== true || rowHash(row) != null)) badSecrets.push(item.id);
  }
  const exeRow = oneInstallRow(rows, 'Ministry of Education.exe', duplicateProblems);
  const asarRow = oneInstallRow(rows, 'resources\\app.asar', duplicateProblems);
  const exeRowHash = rowHash(exeRow);
  const exePathMatches = normalizeWinPath(rowPath(exeRow)) === normalizeWinPath(vmRun?.runningApp?.path);
  const exeMeasured = Boolean(exeRowHash && rowLength(exeRow) > 0);
  const appRoot = normalizeWinPath(vmRun?.runningApp?.path).replace(/\\ministry of education\.exe$/, '');
  const expectedAsarPath = appRoot ? `${appRoot}\\resources\\app.asar` : '';
  const asarPathMatches = Boolean(
    expectedAsarPath
      && normalizeWinPath(rowPath(asarRow)) === expectedAsarPath
      && normalizeWinPath(vmRun?.appAsar?.path) === expectedAsarPath,
  );
  const pathProblems = [];
  if (!exePathMatches) pathProblems.push('running app path does not exactly match exe artifact row');
  if (!exeMeasured) pathProblems.push('exe artifact row lacks nonzero length and sha256');
  if (!asarPathMatches) pathProblems.push('app.asar is not under the running app install root');

  addCheck(
    checks,
    'install-artifact-rows',
    missing.length === 0 && badSecrets.length === 0 && duplicateProblems.length === 0 && pathProblems.length === 0 ? STATUS.PASS : STATUS.FAIL,
    [
      missing.length ? `missing ${missing.join(', ')}` : '',
      duplicateProblems.length ? duplicateProblems.join('; ') : '',
      badSecrets.length ? `secret rows hashed or not metadata-only: ${badSecrets.join(', ')}` : '',
      pathProblems.length ? pathProblems.join('; ') : '',
    ].filter(Boolean).join('; ') || `${REQUIRED_INSTALL_SUFFIXES.length} unique rows present`,
  );

  const expectedAsar = lowerHash(appAsar?.sha256);
  const actualAsar = rowHash(asarRow);
  addCheck(
    checks,
    'installed-app-asar-hash',
    expectedAsar && actualAsar === expectedAsar ? STATUS.PASS : STATUS.FAIL,
    `expected=${expectedAsar ?? '(missing)'} actual=${actualAsar ?? '(missing)'}`,
  );
}

function checkPackages(text, checks) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) {
    addCheck(checks, 'packages-nscc-presence', STATUS.FAIL, 'presence file is empty');
    return;
  }
  const rows = new Map();
  const duplicates = [];
  for (const line of lines) {
    const match = line.match(/^(.+?)=(True|False)$/i);
    if (!match) {
      addCheck(checks, 'packages-nscc-presence', STATUS.FAIL, `malformed row: ${line}`);
      return;
    }
    const name = match[1];
    if (rows.has(name)) duplicates.push(name);
    rows.set(name, /^true$/i.test(match[2]));
  }
  const expected = new Set(REQUIRED_PACKAGE_ROWS);
  const unknown = [...rows.keys()].filter((name) => !expected.has(name));
  const missing = REQUIRED_PACKAGE_ROWS.filter((name) => !rows.has(name));
  const falseRows = [...rows.entries()].filter(([, present]) => !present).map(([name]) => name);
  const ok = duplicates.length === 0 && unknown.length === 0 && missing.length === 0 && falseRows.length === 0;
  addCheck(
    checks,
    'packages-nscc-presence',
    ok ? STATUS.PASS : STATUS.FAIL,
    ok
      ? `${rows.size} exact package/NSCC rows true`
      : [
        duplicates.length ? `duplicates ${[...new Set(duplicates)].join(', ')}` : '',
        unknown.length ? `unknown ${unknown.join(', ')}` : '',
        missing.length ? `missing ${missing.join(', ')}` : '',
        falseRows.length ? `false ${falseRows.join(', ')}` : '',
      ].filter(Boolean).join('; '),
  );
}

function checkGatewaySmoke(gateway, checks) {
  const result = gateway.RESULT;
  const requiredTrue = [
    ['SAFE_METADATA_ONLY', gateway.SAFE_METADATA_ONLY],
    ['NODE_EXISTS', gateway.NODE_EXISTS],
    ['ENTRY_EXISTS', gateway.ENTRY_EXISTS],
    ['CWD_EXISTS', gateway.CWD_EXISTS],
    ['PLAYWRIGHT_CORE_EXISTS', gateway.PLAYWRIGHT_CORE_EXISTS],
    ['GATEWAY_TCP_READY', gateway.GATEWAY_TCP_READY],
    ['SYSTEM_PRESENCE_CHALLENGE', gateway.SYSTEM_PRESENCE_CHALLENGE],
    ['SYSTEM_PRESENCE_HANDSHAKE', gateway.SYSTEM_PRESENCE_HANDSHAKE],
    ['SYSTEM_PRESENCE_RPC', gateway.SYSTEM_PRESENCE_RPC],
    ['GATEWAY_READY', gateway.GATEWAY_READY],
  ];
  const missing = requiredTrue.filter(([, value]) => !boolValue(value)).map(([key]) => key);
  const hasExited = hasOwn(gateway, 'GATEWAY_EXITED');
  const exited = boolValue(gateway.GATEWAY_EXITED);
  const explicitlyRunning = gateway.GATEWAY_EXITED === false || /^false$/i.test(String(gateway.GATEWAY_EXITED ?? ''));
  const rawFields = [
    hasOwn(gateway, 'ARGUMENT_LINE') ? 'ARGUMENT_LINE' : '',
    hasOwn(gateway, 'ERROR') ? 'ERROR' : '',
    gateway.__RAW_DIAGNOSTIC_STATE ? 'STDOUT/STDERR' : '',
  ].filter(Boolean);
  addCheck(
    checks,
    'gateway-smoke',
    result === 'COMPLETE' && missing.length === 0 && hasExited && explicitlyRunning && rawFields.length === 0 ? STATUS.PASS : STATUS.FAIL,
    missing.length
      ? `false fields ${missing.join(', ')}`
      : rawFields.length
        ? `raw diagnostic fields present: ${rawFields.join(', ')}`
        : `result=${result ?? '(missing)'} exited=${hasExited ? String(exited) : '(missing)'}`,
  );
}

function parseJsonTail(text) {
  const start = String(text ?? '').indexOf('{');
  if (start < 0) throw new Error('JSON payload not found');
  return JSON.parse(String(text).slice(start));
}

function checkElectronProbeRun(text, checks) {
  try {
    const data = parseJsonTail(text);
    const summaryPath = typeof data.summaryPath === 'string' ? data.summaryPath : '';
    const summaryName = summaryPath.split(/[\\/]/).pop() ?? '';
    const ok = /^clawx-electron-probe-.*\.json$/.test(summaryName);
    addCheck(
      checks,
      'electron-probe-run',
      ok ? STATUS.PASS : STATUS.FAIL,
      ok ? summaryName : 'producer summaryPath missing or not a clawx electron probe JSON',
    );
    return ok ? summaryName : null;
  } catch (error) {
    addCheck(checks, 'electron-probe-run', STATUS.FAIL, error.message);
    return null;
  }
}

function checkElectronProbe(probe, checks) {
  const validationReasons = probe?.validation?.reasons;
  const history = probe?.safeChat?.history;
  const send = probe?.safeChat?.send;
  const safeChatOk = Boolean(
    typeof probe?.safeChat?.sessionKey === 'string'
      && probe.safeChat.sessionKey.length > 0
      && typeof probe?.safeChat?.verificationToken === 'string'
      && probe.safeChat.verificationToken.length > 0
      && send
      && send.skipped !== true
      && send.success === true
      && history
      && history.skipped !== true
      && history.ok === true
      && history.scopedToCurrentPrompt === true
      && history.completed === true
      && history.finalAnswerEchoedMarker === true
      && history.expectedToolResultOk === true
      && history.expectedToolOnly === true
      && history.noBannedSideEffects === true
      && Number(history.messageCount ?? 0) > 0
      && Array.isArray(history.observedToolResults)
      && history.observedToolResults.length > 0,
  );
  addCheck(
    checks,
    'electron-cdp-probe',
    probe?.state === 'ELECTRON_CDP_PROBE_DONE'
      && probe?.renderer?.hasElectronInvoke === true
      && probe?.validation?.ok === true
      && Array.isArray(validationReasons)
      && validationReasons.length === 0
      && safeChatOk
      ? STATUS.PASS
      : STATUS.FAIL,
    `state=${probe?.state ?? '(missing)'} invoke=${String(probe?.renderer?.hasElectronInvoke)} validation=${String(probe?.validation?.ok)} safeChat=${String(safeChatOk)} reasons=${Array.isArray(validationReasons) ? validationReasons.length : '(missing)'}`,
  );
}

function officeStateLines(text, prefix) {
  return text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith(`STATE: ${prefix}`));
}

function checkOfficeRuntime(value, checks) {
  const text = String(value ?? '');
  const missing = REQUIRED_RUNTIME_MODULES.filter((name) => !new RegExp(`^${name}=OK\\b`, 'm').test(text));
  const terminalStates = officeStateLines(text, 'OFFICE_RUNTIME_');
  const stateOk = terminalStates.length === 1 && /^STATE: OFFICE_RUNTIME_READY(_WITH_POWERPOINT)?$/.test(terminalStates[0]);
  const contradictory = /^(?:.+=(?:MISSING|FAILED|FAILED-LOAD)\b|STATE: OFFICE_RUNTIME_(?:PARTIAL|BLOCKED|FAIL))/m.test(text);
  addCheck(
    checks,
    'office-runtime',
    missing.length === 0 && stateOk && !contradictory ? STATUS.PASS : STATUS.FAIL,
    missing.length
      ? `missing module OK lines ${missing.join(', ')}`
      : !stateOk
        ? `terminal states ${terminalStates.join(', ') || '(missing)'}`
        : contradictory
          ? 'contradictory runtime failure line present'
          : 'runtime ready',
  );
}

function checkOfficeWrite(value, checks) {
  const text = String(value ?? '');
  const predicates = [
    /PASS\s+write_docx wrote valid OpenXML/m,
    /PASS\s+read_docx round-trips the body text/m,
    /PASS\s+write_xlsx wrote valid OpenXML/m,
    /PASS\s+read_xlsx round-trips a data row/m,
  ];
  const states = officeStateLines(text, 'OFFICE_WRITE_');
  const jsResults = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith('JS_RESULT:'));
  const ok = predicates.every((predicate) => predicate.test(text))
    && states.length === 1
    && states[0] === 'STATE: OFFICE_WRITE_OK'
    && jsResults.length === 1
    && jsResults[0] === 'JS_RESULT: OK'
    && !/^FAIL\s+/m.test(text)
    && !/^JS_RESULT: FAIL\b/m.test(text);
  addCheck(checks, 'office-write', ok ? STATUS.PASS : STATUS.FAIL, ok ? 'write/readback complete' : `states=${states.join(', ') || '(missing)'} js=${jsResults.join(', ') || '(missing)'}`);
}

function expectedPortableEvidencePaths(electronPath) {
  return new Set([
    ...REQUIRED_PORTABLE_EVIDENCE_FILES,
    ...(electronPath ? [electronPath] : []),
  ]);
}

function checkVmRunEvidenceBindings(vmRun, files, checks, expectedPaths) {
  if (!vmRun) return;
  if (!Array.isArray(vmRun.evidenceFiles)) {
    addCheck(checks, 'vm-run-evidence-files', STATUS.FAIL, 'vm-run evidenceFiles array missing');
    return;
  }
  const entries = new Map();
  const duplicates = [];
  const invalid = [];
  for (const entry of vmRun.evidenceFiles) {
    if (!isObject(entry) || typeof entry.path !== 'string' || path.isAbsolute(entry.path) || entry.path.includes('..') || !lowerHash(entry.sha256)) {
      invalid.push(String(entry?.path ?? '(missing)'));
      continue;
    }
    if (entries.has(entry.path)) duplicates.push(entry.path);
    entries.set(entry.path, lowerHash(entry.sha256));
  }
  const expected = expectedPaths ?? expectedPortableEvidencePaths(null);
  const expectedList = [...expected].sort();
  const entryList = [...entries.keys()].sort();
  const missingEntries = expectedList.filter((name) => !entries.has(name));
  const extraEntries = entryList.filter((name) => !expected.has(name));
  const fileHashes = new Map(files.filter((file) => file.path !== 'vm-run.json').map((file) => [file.path, file.sha256]));
  const missingFiles = expectedList.filter((name) => !fileHashes.has(name));
  const mismatches = expectedList
    .filter((name) => entries.has(name) && fileHashes.has(name) && entries.get(name) !== fileHashes.get(name))
    .map((name) => name);
  const ok = invalid.length === 0 && duplicates.length === 0 && missingEntries.length === 0 && extraEntries.length === 0 && missingFiles.length === 0 && mismatches.length === 0;
  addCheck(
    checks,
    'vm-run-evidence-files',
    ok ? STATUS.PASS : STATUS.FAIL,
    ok
      ? `${expectedList.length} portable producer file hashes exactly bound to vm-run`
      : [
        invalid.length ? `invalid ${invalid.join(', ')}` : '',
        duplicates.length ? `duplicates ${[...new Set(duplicates)].join(', ')}` : '',
        missingEntries.length ? `missing entries ${missingEntries.join(', ')}` : '',
        extraEntries.length ? `unknown extra entries ${extraEntries.join(', ')}` : '',
        missingFiles.length ? `missing files ${missingFiles.join(', ')}` : '',
        mismatches.length ? `stale hashes ${mismatches.join(', ')}` : '',
      ].filter(Boolean).join('; '),
  );
}

function readOptionalStructured(evidenceDir, candidates, checks, id, files) {
  const relativePath = findOne(evidenceDir, candidates, checks, id);
  if (!relativePath) return null;
  try {
    return readEvidenceFile(evidenceDir, relativePath, files, { state: true });
  } catch (error) {
    addCheck(checks, id, STATUS.FAIL, error.message);
    return null;
  }
}

export async function evaluateInstalledEvidence({ manifest, evidenceDir }) {
  const checks = [];
  const files = [];
  const resolvedEvidenceDir = path.resolve(evidenceDir);
  const { installer, appAsar, sourceRevision } = checkManifest(manifest, checks);

  const vmRunPath = findOne(resolvedEvidenceDir, EVIDENCE_FILE_CANDIDATES.vmRun, checks, 'vm-run-file');
  let vmRun = null;
  if (vmRunPath) {
    try {
      vmRun = readEvidenceFile(resolvedEvidenceDir, vmRunPath, files, { json: true });
      checkVmRun(vmRun, manifest, installer, appAsar, checks);
    } catch (error) {
      addCheck(checks, 'vm-run', STATUS.FAIL, error.message);
    }
  }

  const environment = readOptionalStructured(resolvedEvidenceDir, EVIDENCE_FILE_CANDIDATES.environment, checks, 'environment-file', files);
  if (environment) checkEnvironment(environment, vmRun, checks);

  const installArtifacts = readOptionalStructured(resolvedEvidenceDir, EVIDENCE_FILE_CANDIDATES.installArtifacts, checks, 'install-artifacts-file', files);
  if (installArtifacts) checkInstallArtifacts(installArtifacts, appAsar, vmRun, checks);

  const packagesPath = findOne(resolvedEvidenceDir, EVIDENCE_FILE_CANDIDATES.packages, checks, 'packages-file');
  if (packagesPath) {
    try {
      checkPackages(readEvidenceFile(resolvedEvidenceDir, packagesPath, files), checks);
    } catch (error) {
      addCheck(checks, 'packages-nscc-presence', STATUS.FAIL, error.message);
    }
  }

  const gateway = readOptionalStructured(resolvedEvidenceDir, EVIDENCE_FILE_CANDIDATES.gatewaySmoke, checks, 'gateway-smoke-file', files);
  if (gateway) checkGatewaySmoke(gateway, checks);

  const electronRunPath = findOne(resolvedEvidenceDir, EVIDENCE_FILE_CANDIDATES.electronProbeRun, checks, 'electron-probe-run-file');
  let expectedElectronProbeName = null;
  if (electronRunPath) {
    try {
      expectedElectronProbeName = checkElectronProbeRun(readEvidenceFile(resolvedEvidenceDir, electronRunPath, files), checks);
    } catch (error) {
      addCheck(checks, 'electron-probe-run', STATUS.FAIL, error.message);
    }
  }

  const electronPath = findOneGlob(resolvedEvidenceDir, /^clawx-electron-probe-.*\.json$/, checks, 'electron-probe-file');
  if (electronPath) {
    if (expectedElectronProbeName && electronPath !== expectedElectronProbeName) {
      addCheck(checks, 'electron-probe-run-current-json', STATUS.FAIL, `summaryPath=${expectedElectronProbeName} file=${electronPath}`);
    } else if (expectedElectronProbeName) {
      addCheck(checks, 'electron-probe-run-current-json', STATUS.PASS, electronPath);
    }
    try {
      checkElectronProbe(readEvidenceFile(resolvedEvidenceDir, electronPath, files, { json: true }), checks);
    } catch (error) {
      addCheck(checks, 'electron-cdp-probe', STATUS.FAIL, error.message);
    }
  }

  const officeRuntimePath = findOne(resolvedEvidenceDir, EVIDENCE_FILE_CANDIDATES.officeRuntime, checks, 'office-runtime-file');
  if (officeRuntimePath) {
    try {
      checkOfficeRuntime(readEvidenceFile(resolvedEvidenceDir, officeRuntimePath, files), checks);
    } catch (error) {
      addCheck(checks, 'office-runtime', STATUS.FAIL, error.message);
    }
  }

  const officeWritePath = findOne(resolvedEvidenceDir, EVIDENCE_FILE_CANDIDATES.officeWrite, checks, 'office-write-file');
  if (officeWritePath) {
    try {
      checkOfficeWrite(readEvidenceFile(resolvedEvidenceDir, officeWritePath, files), checks);
    } catch (error) {
      addCheck(checks, 'office-write', STATUS.FAIL, error.message);
    }
  }

  checkVmRunEvidenceBindings(vmRun, files, checks, expectedPortableEvidencePaths(electronPath));

  const ok = checks.length > 0 && checks.every((check) => check.status === STATUS.PASS);
  return {
    ok,
    checks,
    files,
    version: manifest?.version ?? null,
    platform: 'win32',
    sourceRevision,
    installerName: installer?.name ?? null,
    installerSha256: lowerHash(installer?.sha256),
    appAsarSha256: lowerHash(appAsar?.sha256) ?? lowerHash(vmRun?.appAsar?.sha256),
    startedAt: vmRun?.startedAt ?? null,
    completedAt: vmRun?.completedAt ?? null,
    environmentScope: environmentScope(environment),
  };
}

async function main() {
  const [manifestPath, evidenceDir] = process.argv.slice(2);
  if (!manifestPath || !evidenceDir) {
    console.error('usage: installed-release-evidence.mjs <manifest.json> <evidence-dir>');
    process.exit(2);
  }
  const result = await evaluateInstalledEvidence({ manifest: readJson(path.resolve(manifestPath)), evidenceDir });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 3);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((error) => {
    console.error(`[installed-release-evidence] ERROR ${error.message}`);
    process.exit(1);
  });
}
