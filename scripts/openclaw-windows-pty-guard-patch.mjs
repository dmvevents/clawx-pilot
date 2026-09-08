import fs from 'node:fs';
import path from 'node:path';

export const OPENCLAW_WINDOWS_PTY_GUARD_VERSION = '2026.9.2';

const APPROVAL_UNGUARDED = '\t\t\t\t\t\tpty: params.pty === true && !sandbox,';
const APPROVAL_GUARDED = '\t\t\t\t\t\tpty: params.pty === true && !sandbox && process.platform !== "win32",';
const EXEC_UNGUARDED = '\t\t\t\tconst usePty = params.pty === true && !sandbox;';
const EXEC_GUARDED = '\t\t\t\tconst usePty = params.pty === true && !sandbox && process.platform !== "win32";';

function readPackageVersion(openclawDir) {
  const pkgPath = path.join(openclawDir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  return String(pkg.version ?? '');
}

function countOccurrences(source, snippet) {
  if (!snippet) return 0;
  let count = 0;
  let index = 0;
  while (index < source.length) {
    const found = source.indexOf(snippet, index);
    if (found === -1) return count;
    count += 1;
    index = found + snippet.length;
  }
  return count;
}

function listDistJs(openclawDir) {
  const distDir = path.join(openclawDir, 'dist');
  return fs.readdirSync(distDir)
    .filter((name) => /^bash-tools-.*\.js$/.test(name))
    .map((name) => path.join(distDir, name));
}

function readPtyShape(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  return {
    source,
    approvalUnguarded: countOccurrences(source, APPROVAL_UNGUARDED),
    approvalGuarded: countOccurrences(source, APPROVAL_GUARDED),
    execUnguarded: countOccurrences(source, EXEC_UNGUARDED),
    execGuarded: countOccurrences(source, EXEC_GUARDED),
  };
}

function findPtyGuardFile(openclawDir) {
  const candidates = listDistJs(openclawDir)
    .map((filePath) => ({ filePath, shape: readPtyShape(filePath) }))
    .filter(({ shape }) => shape.approvalUnguarded + shape.approvalGuarded + shape.execUnguarded + shape.execGuarded > 0);

  if (candidates.length !== 1) {
    throw new Error(`Expected exactly one OpenClaw ${OPENCLAW_WINDOWS_PTY_GUARD_VERSION} bash-tools PTY guard file under ${openclawDir}, found ${candidates.length}`);
  }
  return candidates[0];
}

function isPatched(shape) {
  return shape.approvalGuarded === 1
    && shape.execGuarded === 1
    && shape.approvalUnguarded === 0
    && shape.execUnguarded === 0;
}

function isPatchableBaseline(shape) {
  return shape.approvalUnguarded === 1
    && shape.execUnguarded === 1
    && shape.approvalGuarded === 0
    && shape.execGuarded === 0;
}

function formatShape(shape) {
  return `approval unguarded=${shape.approvalUnguarded}, approval guarded=${shape.approvalGuarded}, exec unguarded=${shape.execUnguarded}, exec guarded=${shape.execGuarded}`;
}

export function assertOpenClawWindowsPtyGuard(openclawDir) {
  const version = readPackageVersion(openclawDir);
  if (version !== OPENCLAW_WINDOWS_PTY_GUARD_VERSION) {
    return { supported: false, version };
  }

  const { filePath, shape } = findPtyGuardFile(openclawDir);
  if (!isPatched(shape)) {
    throw new Error(`OpenClaw Windows PTY guard missing or ambiguous in ${path.basename(filePath)} (${formatShape(shape)})`);
  }
  return { supported: true, version, filePath };
}

export function patchOpenClawWindowsPtyGuard(openclawDir) {
  const version = readPackageVersion(openclawDir);
  if (version !== OPENCLAW_WINDOWS_PTY_GUARD_VERSION) {
    return { supported: false, version, patched: false, replacements: 0 };
  }

  const { filePath, shape } = findPtyGuardFile(openclawDir);
  if (isPatched(shape)) {
    return { supported: true, version, filePath, patched: false, replacements: 0 };
  }
  if (!isPatchableBaseline(shape)) {
    throw new Error(`Unsupported OpenClaw Windows PTY shape in ${path.basename(filePath)} (${formatShape(shape)})`);
  }

  const next = shape.source
    .replace(APPROVAL_UNGUARDED, APPROVAL_GUARDED)
    .replace(EXEC_UNGUARDED, EXEC_GUARDED);
  fs.writeFileSync(filePath, next, 'utf8');

  assertOpenClawWindowsPtyGuard(openclawDir);
  return { supported: true, version, filePath, patched: true, replacements: 2 };
}
