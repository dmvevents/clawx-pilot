/**
 * CLWX-92 regression check: readPdf must work under the Electron
 * UtilityProcess environment shape that broke moe.16 in-app PDF reads.
 *
 * pdfjs's isNodeJS detection: process.versions.electron present AND
 * process.type !== 'browser' => browser-like => demands
 * GlobalWorkerOptions.workerSrc. We fake that shape BEFORE importing
 * doc-tools (the moe.16 VM differential repro proved this reproduces the
 * failure exactly), then parse a real PDF. PASS = the workerSrc fix holds
 * in the hostile env; the plain-node PASS is covered by the doc-tooling
 * harness and verify-openclaw-bundle.
 *
 * Run: node scripts/clwx92-workerenv-check.mjs
 */
process.versions.electron = process.versions.electron || '35.0.0';
try {
  Object.defineProperty(process, 'type', { value: 'utility', configurable: true });
} catch {
  process.type = 'utility';
}

// Bundle mode (CLWX92_BUNDLE_NM set by verify-openclaw-bundle): copy
// doc-tools OUTSIDE the repo so module resolution cannot escape to the
// workspace node_modules, and point the packaged-app fallback at the bundle
// — mirroring exactly how the shipped gateway resolves (the VM repro trick).
let docToolsUrl = new URL('../extensions/moe-principal-assistant/doc-tools.mjs', import.meta.url);
if (process.env.CLWX92_BUNDLE_NM) {
  const { mkdtempSync, copyFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join, dirname } = await import('node:path');
  const { pathToFileURL, fileURLToPath } = await import('node:url');
  const dir = mkdtempSync(join(tmpdir(), 'clwx92-'));
  const dst = join(dir, 'doc-tools.mjs');
  copyFileSync(fileURLToPath(docToolsUrl), dst);
  // loadDep's packaged-app augment probes <resources>/openclaw/node_modules.
  process.env.CLAWX_APP_RESOURCES = dirname(dirname(process.env.CLWX92_BUNDLE_NM));
  docToolsUrl = pathToFileURL(dst);
}

const { readPdf } = await import(docToolsUrl.href);
const fixture = new URL(
  '../skills/laptop/evidence/2026-08-20-raj-prompt-replay/fixtures/01_Ministry_Circular_ICT_Equipment_Audit.pdf',
  import.meta.url,
).pathname;

try {
  const out = await readPdf({ path: fixture });
  if (out.totalChars > 100 && out.pages >= 1) {
    console.log(`CLWX92_VERIFY=PASS pages=${out.pages} chars=${out.totalChars} env=utility-fake`);
    process.exit(0);
  }
  console.log(`CLWX92_VERIFY=FAIL empty result: pages=${out.pages} chars=${out.totalChars}`);
  process.exit(1);
} catch (err) {
  console.log(`CLWX92_VERIFY=FAIL error=${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
  process.exit(1);
}
