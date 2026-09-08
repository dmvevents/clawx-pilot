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
import { verifyOpenClawChatHistoryPatch } from './openclaw-chat-history-patch.mjs';
import { verifyOpenClawPricingCachePatch } from './openclaw-pricing-cache-patch.mjs';
import { verifyOpenClawSdkAliasPatch } from './openclaw-sdk-alias-patch.mjs';

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

// 4. CLWX-106: pricing refresh must not normalize every remote OpenRouter
// row through provider plugins during startup. The bundle step patches the
// pinned OpenClaw usage-format chunk, and verification fails closed if the
// target drifted or the patch was omitted.
try {
  verifyOpenClawPricingCachePatch(path.join(ROOT, 'build', 'openclaw'));
} catch (err) {
  failures.push(`PRICING-CACHE: ${err instanceof Error ? err.message : String(err)}`);
}

// 5. September 8 Windows startup: chat.history must not wait for the cold
// model catalog merely to infer an absent thinkingLevel.
try {
  verifyOpenClawChatHistoryPatch(path.join(ROOT, 'build', 'openclaw'));
} catch (err) {
  failures.push(`CHAT-HISTORY: ${err instanceof Error ? err.message : String(err)}`);
}

// 6. CLWX-125: repeated plugin loader passes must not rewrite the
// OpenClaw plugin-sdk alias package and wrapper modules when generated
// content is already current.
try {
  verifyOpenClawSdkAliasPatch(path.join(ROOT, 'build', 'openclaw'));
} catch (err) {
  failures.push(`SDK-ALIAS: ${err instanceof Error ? err.message : String(err)}`);
}

// 7. CLWX-92: PDF parsing must survive the Electron UtilityProcess
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

if (failures.length > 0) {
  console.error(`✗ openclaw bundle verification FAILED (${failures.length}):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ openclaw bundle verified: ${EXTRA_BUNDLED_PACKAGES.length} extra packages present, ${SHIP_TARGETS.length} ship-target binding sets, ${HOST_LOADABLE.length} parsers loadable on host.`);
