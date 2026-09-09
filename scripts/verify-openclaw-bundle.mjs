/**
 * Gateway-bundle completeness + loadability gate (CLWX-72).
 *
 * Why this exists: the moe.15 tester incident shipped a gateway bundle where
 * pdf-parse was PRESENT but UNLOADABLE — its transitive platform-native
 * binding (@napi-rs/canvas-win32-x64-msvc, an optionalDependency pnpm only
 * installs for the host platform) was missing, and the runtime's catch-all
 * masked the load error as "module not found". Presence checks alone cannot
 * catch that class, and nothing failed the build. This script does three
 * things and exits non-zero on any miss:
 *
 *   1. PRESENCE: every EXTRA_BUNDLED_PACKAGES entry exists in
 *      build/openclaw/node_modules.
 *   2. PLATFORM BINDINGS: the platform-native bindings we ship to are
 *      present for every target in SHIP_TARGETS (win32-x64 NSIS + darwin).
 *   3. HOST LOADABILITY: each critical parser actually require()s from the
 *      bundle on this host (catches evaluation-time throws, not just
 *      resolution).
 *
 * Run: node scripts/verify-openclaw-bundle.mjs   (wired into the package chain)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { EXTRA_BUNDLED_PACKAGES } from './openclaw-bundle-config.mjs';
import { verifyOpenClaw20269Upgrade } from './openclaw-2026-9-upgrade-verifier.mjs';
import {
  assertShippedOpenClawLifecycleComplete,
  buildShippedLauncherPendingFixture,
  gradeShippedLauncherPendingNegativeControl,
  gradeShippedLauncherVersionControl,
  runShippedLauncherVersionProbe,
} from './openclaw-package-lifecycle.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE_NM = path.join(ROOT, 'build', 'openclaw', 'node_modules');

// Platforms we actually ship installers for.
const SHIP_TARGETS = [
  { label: 'win32-x64', pkgs: ['@napi-rs/canvas-win32-x64-msvc'] },
  { label: 'darwin-arm64', pkgs: ['@napi-rs/canvas-darwin-arm64'] },
  { label: 'darwin-x64', pkgs: ['@napi-rs/canvas-darwin-x64'] },
];

// Parsers whose load failure reaches the principal directly.
const HOST_LOADABLE = ['pdf-parse', 'mammoth', 'docx', 'xlsx'];
const CLWX92_PDF_FIXTURE = path.join(ROOT, 'eval', 'fixtures', 'clwx92-public-pdf-fixture.pdf');

const failures = [];

if (!fs.existsSync(BUNDLE_NM)) {
  console.error(`FAIL: bundle not found at ${BUNDLE_NM} — run zx scripts/bundle-openclaw.mjs first.`);
  process.exit(1);
}

// 1. Presence.
for (const name of EXTRA_BUNDLED_PACKAGES) {
  const dir = path.join(BUNDLE_NM, ...name.split('/'));
  if (!fs.existsSync(path.join(dir, 'package.json'))) {
    failures.push(`PRESENCE: ${name} missing from bundle`);
  }
}

// 2. Platform-native bindings per ship target.
for (const target of SHIP_TARGETS) {
  for (const pkg of target.pkgs) {
    const dir = path.join(BUNDLE_NM, ...pkg.split('/'));
    const hasNode = fs.existsSync(dir)
      && fs.readdirSync(dir).some((f) => f.endsWith('.node'));
    if (!hasNode) {
      failures.push(`BINDING(${target.label}): ${pkg} missing or has no .node binary`);
    }
  }
}

// 3. Host loadability from the bundle context. A minimal DOMMatrix polyfill
// mirrors what the runtime installs (doc-tools.mjs) so we test the same
// conditions the gateway runs under.
if (typeof globalThis.DOMMatrix === 'undefined') {
  globalThis.DOMMatrix = class { constructor() { this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0; } };
}
const bundleRequire = createRequire(path.join(BUNDLE_NM, 'noop.js'));
for (const name of HOST_LOADABLE) {
  try {
    bundleRequire(name);
  } catch (err) {
    failures.push(`LOAD(${name}): ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
  }
}

// 4. OpenClaw 2026.9.2 upgrade disposition: the old 2026.4.23 CLWX
// bundle-surgery patches are obsolete only if the bundled runtime exposes the
// upstream catalog/pricing/SDK-alias implementations we inspected.
try {
  await verifyOpenClaw20269Upgrade(path.join(ROOT, 'build', 'openclaw'), { requireBundlePtyGuard: true });
} catch (err) {
  failures.push(`OPENCLAW-2026.9: ${err instanceof Error ? err.message : String(err)}`);
}

// 5. CLWX-92: PDF parsing must survive the Electron UtilityProcess
// environment shape (process.versions.electron + process.type='utility'
// makes pdfjs demand GlobalWorkerOptions.workerSrc). Run the shipped
// doc-tools against the BUNDLE's pdf-parse in a child process with the
// faked env — this is the exact failure that reached the external tester
// on moe.16 despite every presence check passing. The parser sandbox allows
// user-home and OS-temp reads only, so copy the public repo fixture into a
// unique temp directory for this probe instead of widening allowed roots.
{
  let tempDir = null;
  try {
    if (!fs.existsSync(CLWX92_PDF_FIXTURE)) {
      failures.push(`UTILITY-ENV(pdf): public fixture missing at ${CLWX92_PDF_FIXTURE}`);
    } else {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clwx92-bundle-pdf-'));
      const tempFixture = path.join(tempDir, 'clwx92-public-pdf-fixture.pdf');
      fs.copyFileSync(CLWX92_PDF_FIXTURE, tempFixture);
      const child = spawnSync(process.execPath, ['scripts/clwx92-workerenv-check.mjs'], {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: 120_000,
        env: { ...process.env, CLWX92_BUNDLE_NM: BUNDLE_NM, CLWX92_PDF_FIXTURE: tempFixture },
      });
      if (child.status !== 0) {
        failures.push(`UTILITY-ENV(pdf): ${String(child.stdout + child.stderr).split('\n').filter(Boolean).pop() ?? 'check failed'}`);
      }
    }
  } finally {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

// 6. moe.26: shipped-launcher package-lifecycle gate. The installed moe.26
// Gateway never became ready because the bundle shipped OpenClaw's
// `.openclaw-lifecycle-pending` marker (pnpm had not run the package's
// postinstall) and openclaw.mjs hard-exits 1 on it. None of the previous
// checks — nor the nine-row artifact harness, whose transport rows import the
// staged plugin loader directly — ever EXECUTED openclaw.mjs, the actual
// shipped entrypoint, so the gate was invisible until the installed VM run.
// Three sub-checks, all against build/openclaw or an isolated temp fixture:
//   a) no install-gate marker ships;
//   b) POSITIVE: the real entrypoint launches (`openclaw.mjs --version`)
//      from the prepared package;
//   c) NEGATIVE CONTROL: a minimal isolated launcher fixture WITH a pending
//      marker (and lifecycle-script stubs that exit 0 without completing it,
//      the exact installed moe.26 shape) must exit 1 with the
//      lifecycle-incomplete stderr — proving the upstream guard is intact,
//      not weakened or bypassed.
{
  const bundleRoot = path.join(ROOT, 'build', 'openclaw');
  let lifecycleMarkersClean = false;
  try {
    assertShippedOpenClawLifecycleComplete(bundleRoot);
    lifecycleMarkersClean = true;
  } catch (err) {
    failures.push(`LIFECYCLE(marker): ${err instanceof Error ? err.message : String(err)}`);
  }
  // Only probe the real entrypoint when the marker gate passed: on a pending
  // bundle the launcher's self-heal would RUN the lifecycle inside
  // build/openclaw (pruning the mirrored extension deps) — the verifier must
  // never mutate the bundle it grades.
  if (lifecycleMarkersClean) {
    try {
      const expectedVersion = JSON.parse(fs.readFileSync(path.join(bundleRoot, 'package.json'), 'utf8')).version;
      const probe = runShippedLauncherVersionProbe(bundleRoot);
      const verdict = gradeShippedLauncherVersionControl(probe, expectedVersion);
      if (verdict !== true) failures.push(`LIFECYCLE(entrypoint --version): ${verdict}`);
    } catch (err) {
      failures.push(`LIFECYCLE(entrypoint --version): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  let fixtureDir = null;
  try {
    fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawx-moe26-pending-control-'));
    buildShippedLauncherPendingFixture(bundleRoot, fixtureDir);
    const probe = runShippedLauncherVersionProbe(fixtureDir);
    const verdict = gradeShippedLauncherPendingNegativeControl(probe);
    if (verdict !== true) failures.push(`LIFECYCLE(pending negative control): ${verdict}`);
  } catch (err) {
    failures.push(`LIFECYCLE(pending negative control): ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    if (fixtureDir) fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
}

// ── Contract 1: gateway WebSocket protocol (CLWX-138) ────────────────────────
// Chat was impossible on a fully package-verified installer because the app
// offered protocol [3,3] while the bundled gateway required 4. Every other gate
// was green, and no gate compared those two numbers.
//
// This runs here rather than in `pnpm run preflight` because preflight executes
// before bundle-openclaw.mjs, so the bundled gateway does not exist on disk yet.
// This script runs immediately after bundling, which is the first point both
// sides are readable.
//
// Deliberate design: when the required version cannot be extracted, this FAILS as
// indeterminate rather than passing. A check that silently passes when it cannot
// see the answer is worse than no check, and is exactly how CLWX-138 survived.
function verifyGatewayProtocolContract() {
  const problems = [];

  // Applicability, before anything else. This verifier is also run by
  // tests/unit/clwx92-bundle-fixture.test.ts against an isolated root that stages
  // ONLY the bundle - no app source. There, no connect frame exists because there is
  // no app to check, which is different from "an app is present but its range cannot
  // be read". The first is not applicable; the second is a genuine unknown and must
  // fail. Conflating them made this gate report a false failure in CI.
  const appTreePresent = fs.existsSync(path.join(ROOT, 'electron', 'gateway'))
    || fs.existsSync(path.join(ROOT, 'src', 'lib'));
  if (!appTreePresent) {
    console.log('  protocol contract: no app source in this root — check not applicable');
    return [];
  }

  // Scan EVERY connect frame, not just Main's. Independent review found three in
  // the app - electron/gateway/ws-client.ts, src/lib/api-client.ts and
  // src/lib/gateway-client.ts - and the first version of this gate read only the
  // first, then printed a whole-bundle PASS. That would certify a build with two
  // frames still refused, and the diagnostic transport would then fail with the very
  // error an engineer had enabled it to investigate.
  const frameFiles = [
    path.join('electron', 'gateway', 'ws-client.ts'),
    path.join('src', 'lib', 'api-client.ts'),
    path.join('src', 'lib', 'gateway-client.ts'),
  ];
  const frames = [];
  for (const rel of frameFiles) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    const text = fs.readFileSync(abs, 'utf8');
    const mins = [...text.matchAll(/minProtocol:\s*(\d+)/g)];
    const maxes = [...text.matchAll(/maxProtocol:\s*(\d+)/g)];
    if (mins.length === 0 || maxes.length === 0) continue;
    if (mins.length !== maxes.length) {
      problems.push(`PROTOCOL: ${rel} declares ${mins.length} minProtocol and ${maxes.length} maxProtocol values; cannot pair them (INDETERMINATE)`);
      continue;
    }
    for (let i = 0; i < mins.length; i += 1) {
      frames.push({ rel, min: Number(mins[i][1]), max: Number(maxes[i][1]) });
    }
  }
  // A repo-wide sweep catches a frame added in a file this list does not know about.
  const sweepRoots = [path.join(ROOT, 'electron'), path.join(ROOT, 'src')];
  const seen = new Set(frames.map((f) => f.rel));
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      const rel = path.relative(ROOT, full);
      if (seen.has(rel)) continue;
      const text = fs.readFileSync(full, 'utf8');
      if (/minProtocol:\s*\d+/.test(text)) {
        problems.push(`PROTOCOL: ${rel} declares a connect protocol range but is not in the gate's known-frame list. Add it, or the gate will pass while that frame is refused.`);
      }
    }
  };
  sweepRoots.forEach(walk);

  if (frames.length === 0) {
    return ['PROTOCOL: no connect frame found in any known location (INDETERMINATE — refusing to certify compatibility)'];
  }

  const distDir = path.join(ROOT, 'build', 'openclaw', 'dist');
  if (!fs.existsSync(distDir)) {
    return [`PROTOCOL: bundled gateway dist not found at ${path.relative(ROOT, distDir)} (INDETERMINATE)`];
  }

  // Two signals, most authoritative first. Signal A is the gateway naming its own
  // requirement in the mismatch message; newer gateways carry it. Signal B is the
  // modal default in its negotiation code, which is present in every version
  // observed: 2026.4.23 carries `maxProtocol ?? 3`, 2026.9.2 carries
  // `maxProtocol ?? 4`. Both were read from real bundles rather than assumed.
  let required = null;
  let foundIn = null;
  const defaults = new Map();
  for (const entry of fs.readdirSync(distDir)) {
    if (!entry.endsWith('.js')) continue;
    const text = fs.readFileSync(path.join(distDir, entry), 'utf8');
    if (required === null && text.includes('protocol mismatch')) {
      const m = text.match(/expected=(\d+)/);
      if (m) { required = Number(m[1]); foundIn = `dist/${entry} (expected=)`; }
    }
    for (const m of text.matchAll(/maxProtocol\s*\?\?\s*(\d+)/g)) {
      const v = Number(m[1]);
      defaults.set(v, (defaults.get(v) ?? 0) + 1);
    }
  }
  if (required === null && defaults.size > 0) {
    const [modal] = [...defaults.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
    required = modal[0];
    foundIn = `modal \`maxProtocol ?? N\` across dist (${modal[1]} occurrence(s))`;
  }
  if (required === null) {
    return ['PROTOCOL: bundled gateway states no expected protocol version and no negotiation default anywhere in dist (INDETERMINATE — refusing to certify compatibility)'];
  }

  for (const f of frames) {
    if (required < f.min || required > f.max) {
      problems.push(
        `PROTOCOL: bundled gateway requires protocol ${required} (from ${foundIn}) but ${f.rel} offers ` +
        `[${f.min},${f.max}]. That connect is refused with close 1002 "protocol mismatch". The gateway admits ` +
        `protocol 3 only for node clients and probes, so a ui/webchat client offering [3,3] is rejected outright. ` +
        `Its liveness probe still accepts the older version, so a listening port and a readiness probe will BOTH ` +
        `report success on this build — see CLWX-138.`,
      );
    }
    if (f.min === f.max) {
      problems.push(
        `PROTOCOL: ${f.rel} pins minProtocol === maxProtocol (${f.min}). Offer a range so the gateway can ` +
        `negotiate; pinning makes every gateway upgrade a hard break instead of a negotiation.`,
      );
    }
  }
  console.log(`  protocol contract: gateway requires ${required}; ${frames.length} connect frame(s) checked`);
  return problems;
}

failures.push(...verifyGatewayProtocolContract());

if (failures.length > 0) {
  console.error(`✗ openclaw bundle verification FAILED (${failures.length}):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ openclaw bundle verified: ${EXTRA_BUNDLED_PACKAGES.length} extra packages present, ${SHIP_TARGETS.length} ship-target binding sets, ${HOST_LOADABLE.length} parsers loadable on host, lifecycle gate + shipped-entrypoint controls passed.`);
