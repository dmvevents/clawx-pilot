/**
 * Shipped OpenClaw package-lifecycle guard (moe.26 regression, 2026-09-08).
 *
 * OpenClaw 2026.9.x ships `.openclaw-lifecycle-pending` inside its npm
 * tarball; the package's OWN postinstall (scripts/postinstall-bundled-plugins.mjs)
 * is what clears it. pnpm 10 does not run dependency build scripts unless the
 * package is approved (pnpm.onlyBuiltDependencies), so an unapproved install
 * leaves the marker in node_modules/openclaw, bundle-openclaw.mjs copied it
 * verbatim, and every installed moe.26 Gateway start hit the launcher gate:
 *
 *   openclaw: package lifecycle is incomplete. Reinstall with package scripts
 *   enabled, then retry. OpenClaw package postinstall did not complete its
 *   lifecycle marker
 *
 * The shipped-marker omission (install-side scripts never ran + bundle copied
 * the store entry verbatim) is the CONFIRMED, separable defect this module
 * closes at build time. The installed launcher's startup self-heal did
 * observably fail too — the exact stderr proves its lifecycle children exited
 * 0 WITHOUT completing the marker — but the child-side mechanism is NOT yet
 * proven: root's native diagnostic shows the Electron exe with an explicit
 * ELECTRON_RUN_AS_NODE=1 env DOES run the script with correct argv and a true
 * direct-invocation predicate, so the effective Gateway UtilityProcess child
 * env/argv still needs native evidence. Regardless of that mechanism,
 * startup must not mutate the shipped package: the upstream postinstall
 * prunes dist/extensions/* dependency dirs that our bundle mirrors in, so an
 * in-place installed-app "repair" would corrupt the bundle even when it runs.
 * The lifecycle therefore MUST be completed at build time, in a directory we
 * own, and proven complete before shipping — never against the shared pnpm
 * store or an immutable artifact, and never at installed-app startup.
 *
 * Used by scripts/bundle-openclaw.mjs (build-time completion) and
 * scripts/verify-openclaw-bundle.mjs (ship gate + entrypoint controls).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const PACKAGE_LIFECYCLE_PENDING_RELATIVE_PATH = '.openclaw-lifecycle-pending';
export const LEGACY_PACKAGE_INSTALL_GUARD_RELATIVE_PATH = path.join('dist', 'openclaw-install-guard');
export const PACKAGE_LIFECYCLE_RUNNER_RELATIVE_PATH = path.join('dist', 'infra', 'package-lifecycle.js');
export const PACKAGE_LIFECYCLE_MARKER_CONTRACT_RELATIVE_PATH = path.join('scripts', 'lib', 'package-lifecycle-marker.mjs');
export const PACKAGE_LIFECYCLE_SCRIPT_RELATIVE_PATHS = [
  path.join('scripts', 'preinstall-package-manager-warning.mjs'),
  path.join('scripts', 'postinstall-bundled-plugins.mjs'),
];
/** Stable first sentence of the launcher's lifecycle-gate stderr. */
export const LIFECYCLE_INCOMPLETE_STDERR_SENTINEL = 'package lifecycle is incomplete';
export const DEFAULT_LIFECYCLE_TIMEOUT_MS = 10 * 60 * 1000;
export const DEFAULT_LAUNCHER_PROBE_TIMEOUT_MS = 120 * 1000;

/** Relative paths (from the package root) of install-gate markers present. */
export function listPendingLifecycleMarkers(packageRoot, { existsSync = fs.existsSync } = {}) {
  return [PACKAGE_LIFECYCLE_PENDING_RELATIVE_PATH, LEGACY_PACKAGE_INSTALL_GUARD_RELATIVE_PATH]
    .filter((rel) => existsSync(path.join(packageRoot, rel)));
}

export function isOpenClawLifecyclePending(packageRoot, options = {}) {
  return listPendingLifecycleMarkers(packageRoot, options).length > 0;
}

/**
 * The lifecycle mutates the package (marker removal + inventory-driven dist
 * prune). Running it against the shared pnpm store, a workspace node_modules
 * or an immutable extracted artifact would corrupt evidence other consumers
 * rely on — only owned copies (build/openclaw, temp fixtures) are allowed.
 */
export function assertOwnedLifecycleExecutionRoot(packageRoot) {
  const resolved = path.resolve(packageRoot);
  if (resolved.split(/[\\/]+/u).includes('node_modules')) {
    throw new Error(
      `refusing to run the OpenClaw package lifecycle inside a node_modules tree: ${resolved} — copy the package to an owned bundle/fixture directory first`,
    );
  }
  return resolved;
}

/**
 * Complete the npm package lifecycle inside an OWNED package copy using the
 * package's own runner (dist/infra/package-lifecycle.js) under a REAL Node
 * (`nodeBin`), exactly as `npm install` with scripts enabled would. Throws if
 * the scripts fail or any pending marker survives. No-op when already complete.
 */
export function completeBundledOpenClawLifecycle(packageRoot, options = {}) {
  const root = assertOwnedLifecycleExecutionRoot(packageRoot);
  const nodeBin = options.nodeBin ?? process.execPath;
  const timeoutMs = options.timeoutMs ?? DEFAULT_LIFECYCLE_TIMEOUT_MS;
  const pendingBefore = listPendingLifecycleMarkers(root);
  if (pendingBefore.length === 0) {
    return { completed: false, pendingBefore };
  }
  const runnerPath = path.join(root, PACKAGE_LIFECYCLE_RUNNER_RELATIVE_PATH);
  if (!fs.existsSync(runnerPath)) {
    throw new Error(`OpenClaw package at ${root} is lifecycle-pending but has no lifecycle runner at ${PACKAGE_LIFECYCLE_RUNNER_RELATIVE_PATH}`);
  }
  const code = [
    `const { completePendingPackageLifecycle } = await import(${JSON.stringify(pathToFileURL(runnerPath).href)});`,
    `await completePendingPackageLifecycle({ packageRoot: ${JSON.stringify(root)} });`,
  ].join('\n');
  const result = spawnSync(nodeBin, ['--input-type=module', '-e', code], {
    cwd: root,
    stdio: 'inherit',
    timeout: timeoutMs,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`OpenClaw package lifecycle completion failed${result.signal ? ` with ${result.signal}` : ` with exit code ${result.status ?? 'unknown'}`} in ${root}`);
  }
  const pendingAfter = listPendingLifecycleMarkers(root);
  if (pendingAfter.length > 0) {
    throw new Error(`OpenClaw package lifecycle ran but marker(s) survived in ${root}: ${pendingAfter.join(', ')}`);
  }
  return { completed: true, pendingBefore };
}

/** Ship gate: a bundle that still carries an install-gate marker must not ship. */
export function assertShippedOpenClawLifecycleComplete(packageRoot, options = {}) {
  const pending = listPendingLifecycleMarkers(packageRoot, options);
  if (pending.length > 0) {
    throw new Error(
      `shipped OpenClaw package at ${packageRoot} still carries install-lifecycle marker(s): ${pending.join(', ')} — `
      + 'the launcher refuses to start until the package lifecycle completes (moe.26 installed regression). '
      + 'Complete the lifecycle at build time (bundle-openclaw.mjs) / approve openclaw in pnpm.onlyBuiltDependencies; do NOT delete the marker by hand.',
    );
  }
}

/**
 * Resolve the transitive RELATIVE-import closure of ESM files, starting from
 * `entryRelativePaths` under `baseDir`. Follows only './'/'../' specifiers
 * (dist chunks have content-hashed names, so the launcher fixture cannot
 * hardcode them). Bounded; node: builtins and bare specifiers are ignored.
 */
export function collectRelativeImportClosure(baseDir, entryRelativePaths, options = {}) {
  const readFileSync = options.readFileSync ?? fs.readFileSync;
  const existsSync = options.existsSync ?? fs.existsSync;
  const maxFiles = options.maxFiles ?? 64;
  const queue = [...entryRelativePaths];
  const seen = new Set();
  const specifierRe = /(?:from\s*|^import\s*|[^A-Za-z0-9_$]import\s*\(\s*)["'](\.\.?\/[^"']+)["']/gmu;
  while (queue.length > 0) {
    const rel = path.normalize(queue.shift());
    if (seen.has(rel)) continue;
    if (seen.size >= maxFiles) {
      throw new Error(`relative import closure exceeded ${maxFiles} files under ${baseDir}`);
    }
    const abs = path.join(baseDir, rel);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`relative import escaped the package root: ${rel}`);
    }
    if (!existsSync(abs)) {
      throw new Error(`relative import closure entry missing: ${rel} (under ${baseDir})`);
    }
    seen.add(rel);
    const source = readFileSync(abs, 'utf8');
    for (const match of source.matchAll(specifierRe)) {
      queue.push(path.normalize(path.join(path.dirname(rel), match[1])));
    }
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

/** Launcher files every probe fixture needs besides the lifecycle chain. */
export const LAUNCHER_FIXTURE_BASE_FILES = [
  'openclaw.mjs',
  'node-version.mjs',
  'package.json',
  path.join('dist', 'cli-startup-metadata.json'),
];

/**
 * Build a minimal ISOLATED launcher fixture proving the pending gate:
 * launcher + real lifecycle-runner chain + marker contract, a pending marker,
 * and lifecycle SCRIPT STUBS that exit 0 WITHOUT completing the lifecycle.
 * The stubs MODEL the observed installed moe.26 symptom shape
 * (exit-0-without-completion); the actual self-heal child env/argv mechanism
 * remains unproven pending root native diagnostics — root's probe shows the
 * installed exe with explicit ELECTRON_RUN_AS_NODE=1 DOES run a script child
 * correctly. A correct launcher must exit 1 with the
 * lifecycle-incomplete stderr; a weakened guard or bypass makes this control
 * pass silently and FAILS the build.
 */
export function buildShippedLauncherPendingFixture(bundleDir, fixtureDir) {
  const copied = [];
  const chain = collectRelativeImportClosure(bundleDir, [PACKAGE_LIFECYCLE_RUNNER_RELATIVE_PATH]);
  for (const rel of [...LAUNCHER_FIXTURE_BASE_FILES, PACKAGE_LIFECYCLE_MARKER_CONTRACT_RELATIVE_PATH, ...chain]) {
    const src = path.join(bundleDir, rel);
    if (!fs.existsSync(src)) {
      // cli-startup-metadata.json is optional for the NEGATIVE control (the
      // gate fires before the version fast-path); everything else must exist.
      if (rel === path.join('dist', 'cli-startup-metadata.json')) continue;
      throw new Error(`launcher fixture source missing from bundle: ${rel}`);
    }
    const dest = path.join(fixtureDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    copied.push(rel);
  }
  for (const rel of PACKAGE_LIFECYCLE_SCRIPT_RELATIVE_PATHS) {
    const dest = path.join(fixtureDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, '// moe.26 negative control: exits 0 WITHOUT completing the lifecycle marker\nprocess.exit(0);\n');
  }
  fs.writeFileSync(path.join(fixtureDir, PACKAGE_LIFECYCLE_PENDING_RELATIVE_PATH), 'pending\n');
  return { copied };
}

/**
 * Allowlisted probe env (mirrors the harness transport rows): never spread
 * the developer env into a launcher probe — OPENCLAW_CONTAINER would disable
 * the --version fast path and config overrides would redirect the probe.
 */
export function buildLauncherProbeEnv(homeDir) {
  const env = {
    PATH: process.env.PATH,
    HOME: homeDir,
    TMPDIR: process.env.TMPDIR,
    LANG: process.env.LANG,
    OPENCLAW_NO_RESPAWN: '1',
    NODE_DISABLE_COMPILE_CACHE: '1',
  };
  if (process.platform === 'win32') {
    for (const key of ['SystemRoot', 'SystemDrive', 'windir', 'PATHEXT', 'ComSpec', 'TEMP', 'TMP']) {
      if (process.env[key] !== undefined) env[key] = process.env[key];
    }
    env.USERPROFILE = homeDir;
  }
  return env;
}

/** Run `<nodeBin> openclaw.mjs --version` against a package root, isolated. */
export function runShippedLauncherVersionProbe(packageRoot, options = {}) {
  const nodeBin = options.nodeBin ?? process.execPath;
  const timeoutMs = options.timeoutMs ?? DEFAULT_LAUNCHER_PROBE_TIMEOUT_MS;
  // NEVER inside packageRoot: a leaked probe home in build/openclaw would be
  // packed into the installer by the later electron-builder step.
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawx-launcher-probe-home-'));
  try {
    const result = spawnSync(nodeBin, [path.join(packageRoot, 'openclaw.mjs'), '--version'], {
      cwd: packageRoot,
      env: buildLauncherProbeEnv(homeDir),
      encoding: 'utf8',
      timeout: timeoutMs,
    });
    if (result.error) throw result.error;
    return { status: result.status, signal: result.signal, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
}

/** Verdict for the prepared-package positive control. true | reason string. */
export function gradeShippedLauncherVersionControl(probe, expectedVersion) {
  if (probe.status !== 0) {
    return `expected the prepared shipped launcher to exit 0 for --version, got ${probe.signal ?? probe.status}; stderr: ${probe.stderr.trim().slice(0, 300)}`;
  }
  if (!probe.stdout.includes(`OpenClaw ${expectedVersion}`)) {
    return `expected --version stdout to report "OpenClaw ${expectedVersion}", got: ${probe.stdout.trim().slice(0, 300)}`;
  }
  if (probe.stderr.includes(LIFECYCLE_INCOMPLETE_STDERR_SENTINEL)) {
    return `prepared launcher still emitted the lifecycle-incomplete stderr: ${probe.stderr.trim().slice(0, 300)}`;
  }
  return true;
}

/** Verdict for the pending negative control. true | reason string. */
export function gradeShippedLauncherPendingNegativeControl(probe) {
  if (probe.status === 0) {
    return 'pending-marker fixture launched successfully — the launcher lifecycle gate is weakened or bypassed';
  }
  if (probe.status !== 1) {
    return `expected exit 1 from the pending-marker fixture, got ${probe.signal ?? probe.status}; stderr: ${probe.stderr.trim().slice(0, 300)}`;
  }
  if (!probe.stderr.includes(LIFECYCLE_INCOMPLETE_STDERR_SENTINEL)) {
    return `pending-marker fixture exited 1 but without the lifecycle-incomplete stderr; stderr: ${probe.stderr.trim().slice(0, 300)}`;
  }
  return true;
}
