/**
 * moe.26 installed regression: the shipped resources/openclaw package carried
 * OpenClaw's `.openclaw-lifecycle-pending` install marker (pnpm never ran the
 * package's postinstall), and openclaw.mjs — the actual shipped Gateway
 * entrypoint — exits 1 on it:
 *
 *   "openclaw: package lifecycle is incomplete. Reinstall with package
 *    scripts enabled, then retry. OpenClaw package postinstall did not
 *    complete its lifecycle marker"
 *
 * These tests pin the build-time guard added for that regression:
 *   - marker detection / ship gate,
 *   - refusal to run the lifecycle against shared node_modules trees,
 *   - the hashed-chunk import-closure used to build the launcher fixture,
 *   - the NEGATIVE control (pending marker + exit-0 lifecycle stubs, the
 *     exact installed moe.26 shape ⇒ launcher must exit 1, readably), and
 *   - the POSITIVE prepared-package path (real upstream scripts complete the
 *     lifecycle in an OWNED copy; the real launcher then reports --version).
 *
 * The real-launcher suites copy a bounded fixture out of node_modules/openclaw
 * first; nothing here executes the lifecycle against the pnpm store itself.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LAUNCHER_FIXTURE_BASE_FILES,
  LIFECYCLE_INCOMPLETE_STDERR_SENTINEL,
  PACKAGE_LIFECYCLE_MARKER_CONTRACT_RELATIVE_PATH,
  PACKAGE_LIFECYCLE_PENDING_RELATIVE_PATH,
  PACKAGE_LIFECYCLE_RUNNER_RELATIVE_PATH,
  PACKAGE_LIFECYCLE_SCRIPT_RELATIVE_PATHS,
  assertOwnedLifecycleExecutionRoot,
  assertShippedOpenClawLifecycleComplete,
  buildShippedLauncherPendingFixture,
  collectRelativeImportClosure,
  completeBundledOpenClawLifecycle,
  gradeShippedLauncherPendingNegativeControl,
  gradeShippedLauncherVersionControl,
  isOpenClawLifecyclePending,
  listPendingLifecycleMarkers,
  runShippedLauncherVersionProbe,
} from '../../scripts/openclaw-package-lifecycle.mjs';

const ROOT = path.resolve(__dirname, '..', '..');
const REAL_OPENCLAW_DIR = path.join(ROOT, 'node_modules', 'openclaw');
const hasRealOpenClaw = fs.existsSync(path.join(REAL_OPENCLAW_DIR, 'openclaw.mjs'));

const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

/** Copy the bounded launcher+lifecycle+scripts fixture from the real package. */
function copyRealLauncherFixture(dest: string, { withRealScripts }: { withRealScripts: boolean }): void {
  const chain = collectRelativeImportClosure(REAL_OPENCLAW_DIR, [PACKAGE_LIFECYCLE_RUNNER_RELATIVE_PATH]);
  const files = [
    ...LAUNCHER_FIXTURE_BASE_FILES,
    PACKAGE_LIFECYCLE_MARKER_CONTRACT_RELATIVE_PATH,
    ...chain,
    ...(withRealScripts
      ? [...PACKAGE_LIFECYCLE_SCRIPT_RELATIVE_PATHS, path.join('scripts', 'windows-cmd-helpers.mjs'), path.join('dist', 'postinstall-inventory.json')]
      : []),
  ];
  for (const rel of files) {
    const src = path.join(REAL_OPENCLAW_DIR, rel);
    if (!fs.existsSync(src)) continue;
    const target = path.join(dest, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(src, target);
  }
}

describe('lifecycle marker detection and ship gate', () => {
  it('reports pending for the modern marker, the legacy guard, and both', () => {
    const root = tempDir('clawx-lifecycle-markers-');
    expect(listPendingLifecycleMarkers(root)).toEqual([]);
    expect(isOpenClawLifecyclePending(root)).toBe(false);
    fs.writeFileSync(path.join(root, PACKAGE_LIFECYCLE_PENDING_RELATIVE_PATH), 'pending\n');
    expect(listPendingLifecycleMarkers(root)).toEqual([PACKAGE_LIFECYCLE_PENDING_RELATIVE_PATH]);
    fs.mkdirSync(path.join(root, 'dist', 'openclaw-install-guard'), { recursive: true });
    expect(listPendingLifecycleMarkers(root)).toHaveLength(2);
    expect(isOpenClawLifecyclePending(root)).toBe(true);
  });

  it('ship gate throws with the marker path and no hand-deletion guidance', () => {
    const root = tempDir('clawx-lifecycle-gate-');
    fs.writeFileSync(path.join(root, PACKAGE_LIFECYCLE_PENDING_RELATIVE_PATH), 'pending\n');
    expect(() => assertShippedOpenClawLifecycleComplete(root)).toThrowError(
      /still carries install-lifecycle marker.*\.openclaw-lifecycle-pending.*do NOT delete the marker by hand/s,
    );
    fs.rmSync(path.join(root, PACKAGE_LIFECYCLE_PENDING_RELATIVE_PATH));
    expect(() => assertShippedOpenClawLifecycleComplete(root)).not.toThrow();
  });
});

describe('owned-root refusal', () => {
  it('refuses any node_modules tree (shared store / immutable evidence protection)', () => {
    for (const root of [
      path.join(ROOT, 'node_modules', 'openclaw'),
      path.join(os.tmpdir(), 'x', 'node_modules', '.pnpm', 'openclaw@2026.9.2', 'node_modules', 'openclaw'),
    ]) {
      expect(() => assertOwnedLifecycleExecutionRoot(root)).toThrowError(/refusing to run the OpenClaw package lifecycle inside a node_modules tree/);
      expect(() => completeBundledOpenClawLifecycle(root)).toThrowError(/node_modules/);
    }
  });

  it('accepts owned bundle and temp fixture roots', () => {
    expect(assertOwnedLifecycleExecutionRoot(path.join(ROOT, 'build', 'openclaw'))).toBe(path.join(ROOT, 'build', 'openclaw'));
    const fixture = tempDir('clawx-owned-');
    expect(assertOwnedLifecycleExecutionRoot(fixture)).toBe(path.resolve(fixture));
  });
});

describe('relative import closure (hashed lifecycle chunks)', () => {
  it('follows only relative specifiers, transitively', () => {
    const root = tempDir('clawx-closure-');
    fs.mkdirSync(path.join(root, 'dist', 'infra'), { recursive: true });
    fs.writeFileSync(path.join(root, 'dist', 'infra', 'package-lifecycle.js'), 'import { t } from "../package-lifecycle-AbCd123.js";\nexport { t };\n');
    fs.writeFileSync(path.join(root, 'dist', 'package-lifecycle-AbCd123.js'), 'import { n } from "./package-lifecycle-marker-XyZ9.js";\nimport path from "node:path";\nimport bare from "some-package";\nexport const t = () => n;\n');
    fs.writeFileSync(path.join(root, 'dist', 'package-lifecycle-marker-XyZ9.js'), 'export const n = "x";\n');
    const closure = collectRelativeImportClosure(root, [path.join('dist', 'infra', 'package-lifecycle.js')]);
    expect(closure).toEqual([
      path.join('dist', 'infra', 'package-lifecycle.js'),
      path.join('dist', 'package-lifecycle-AbCd123.js'),
      path.join('dist', 'package-lifecycle-marker-XyZ9.js'),
    ]);
  });

  it('fails loudly on a missing chunk instead of building a broken fixture', () => {
    const root = tempDir('clawx-closure-missing-');
    fs.mkdirSync(path.join(root, 'dist', 'infra'), { recursive: true });
    fs.writeFileSync(path.join(root, 'dist', 'infra', 'package-lifecycle.js'), 'import { t } from "../gone.js";\nexport { t };\n');
    expect(() => collectRelativeImportClosure(root, [path.join('dist', 'infra', 'package-lifecycle.js')])).toThrowError(/closure entry missing/);
  });
});

describe('control graders (pure)', () => {
  it('grades the pending negative control', () => {
    expect(gradeShippedLauncherPendingNegativeControl({ status: 1, signal: null, stdout: '', stderr: `openclaw: ${LIFECYCLE_INCOMPLETE_STDERR_SENTINEL}. Reinstall...` })).toBe(true);
    expect(gradeShippedLauncherPendingNegativeControl({ status: 0, signal: null, stdout: 'OpenClaw 2026.9.2\n', stderr: '' })).toMatch(/weakened or bypassed/);
    expect(gradeShippedLauncherPendingNegativeControl({ status: 1, signal: null, stdout: '', stderr: 'some other failure' })).toMatch(/without the lifecycle-incomplete stderr/);
    expect(gradeShippedLauncherPendingNegativeControl({ status: null, signal: 'SIGKILL', stdout: '', stderr: '' })).toMatch(/expected exit 1/);
  });

  it('grades the prepared-package positive control', () => {
    expect(gradeShippedLauncherVersionControl({ status: 0, signal: null, stdout: 'OpenClaw 2026.9.2 (abc)\n', stderr: '' }, '2026.9.2')).toBe(true);
    expect(gradeShippedLauncherVersionControl({ status: 1, signal: null, stdout: '', stderr: 'boom' }, '2026.9.2')).toMatch(/expected the prepared shipped launcher to exit 0/);
    expect(gradeShippedLauncherVersionControl({ status: 0, signal: null, stdout: 'OpenClaw 2026.4.23\n', stderr: '' }, '2026.9.2')).toMatch(/expected --version stdout/);
  });
});

describe.runIf(hasRealOpenClaw)('real shipped launcher: pending NEGATIVE control', () => {
  it('a pending marker with exit-0 lifecycle children (installed moe.26 shape) fails readably', () => {
    const bundleLike = tempDir('clawx-real-neg-src-');
    copyRealLauncherFixture(bundleLike, { withRealScripts: false });
    // buildShippedLauncherPendingFixture writes the exit-0 stubs + marker.
    const fixture = tempDir('clawx-real-neg-');
    const { copied } = buildShippedLauncherPendingFixture(bundleLike, fixture);
    expect(copied).toContain('openclaw.mjs');
    expect(fs.existsSync(path.join(fixture, PACKAGE_LIFECYCLE_PENDING_RELATIVE_PATH))).toBe(true);
    const probe = runShippedLauncherVersionProbe(fixture);
    expect(gradeShippedLauncherPendingNegativeControl(probe)).toBe(true);
    expect(probe.stderr).toContain('OpenClaw package postinstall did not complete its lifecycle marker');
    // The gate must also persist: the fixture stays pending for the next run.
    expect(fs.existsSync(path.join(fixture, PACKAGE_LIFECYCLE_PENDING_RELATIVE_PATH))).toBe(true);
  }, 60_000);
});

describe.runIf(hasRealOpenClaw)('real shipped launcher: prepared-package POSITIVE path', () => {
  it('completeBundledOpenClawLifecycle runs the real upstream scripts in an owned copy, then --version succeeds', () => {
    const fixture = tempDir('clawx-real-pos-');
    copyRealLauncherFixture(fixture, { withRealScripts: true });
    fs.writeFileSync(path.join(fixture, PACKAGE_LIFECYCLE_PENDING_RELATIVE_PATH), 'pending\n');
    const result = completeBundledOpenClawLifecycle(fixture);
    expect(result.completed).toBe(true);
    expect(result.pendingBefore).toEqual([PACKAGE_LIFECYCLE_PENDING_RELATIVE_PATH]);
    expect(fs.existsSync(path.join(fixture, PACKAGE_LIFECYCLE_PENDING_RELATIVE_PATH))).toBe(false);
    const pkg = JSON.parse(fs.readFileSync(path.join(fixture, 'package.json'), 'utf8'));
    const probe = runShippedLauncherVersionProbe(fixture);
    expect(gradeShippedLauncherVersionControl(probe, pkg.version)).toBe(true);
    // Second call is a no-op on a completed package.
    expect(completeBundledOpenClawLifecycle(fixture)).toEqual({ completed: false, pendingBefore: [] });
  }, 120_000);
});
