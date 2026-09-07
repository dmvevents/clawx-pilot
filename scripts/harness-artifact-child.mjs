#!/usr/bin/env node
/**
 * harness-artifact-child.mjs — one matrix row in artifact context (CLWX-77).
 *
 * Spawned by harness-artifact.mjs with CLAWX_APP_RESOURCES pointing at the
 * STAGED resources dir (outside the repo tree). Imports the STAGED
 * doc-tools.mjs, so its createRequire walk-up finds no workspace
 * node_modules and dep resolution exercises the packaged-app seam
 * (NODE_PATH augmentation onto <resources>/openclaw/node_modules) exactly
 * as the installed app does.
 *
 * argv[2]: JSON { docToolsPath, fn, args, envShape? }
 *       or JSON { mode: 'register', pluginIndexPath, pluginConfig, hostApi?, envShape? }
 * envShape 'electronlike' fakes the Electron UtilityProcess environment
 * (process.versions.electron + process.type='utility') BEFORE any import —
 * the exact shape the packaged gateway runs under (utilityProcess.fork) and
 * the one that broke moe.16 PDF reads (CLWX-92). Generalized from
 * scripts/clwx92-workerenv-check.mjs to every matrix row.
 * stdout: one line "CLAWX77_VERDICT:" + JSON
 *   { ok: true, result } | { ok: false, message } | { ok: false, infra: true, message }
 * The sentinel prefix keeps a chatty dep writing to stdout from corrupting
 * the verdict (review finding, 2026-09-05). `infra: true` marks failures of
 * the HARNESS PLUMBING (bad spec, doc-tools failed to import) — the parent
 * must grade these FAIL, never REFUSED-READABLY. The message carries
 * err.message ONLY for tool errors — if a stack leaks into a
 * principal-facing message, that is a finding the parent must see, so we
 * never append err.stack ourselves.
 */
import { pathToFileURL } from 'node:url';

/**
 * Every verdict carries the OBSERVED env shape so the parent can assert the
 * electronlike fake actually applied (falsifiability lens, 2026-09-06: a
 * neutered fake produced byte-identical PASS verdicts while the report still
 * claimed UtilityProcess coverage). Sampled at emit time — after
 * applyEnvShape and after the tool ran.
 */
function emit(verdict) {
  const env = {
    electron: process.versions.electron ?? null,
    type: process.type ?? null,
  };
  console.log(`CLAWX77_VERDICT:${JSON.stringify({ ...verdict, env })}`);
}

/**
 * Fake the Electron UtilityProcess env shape (CLWX-92). Must run before the
 * doc-tools / plugin import so module-level env detection (pdfjs isNodeJS)
 * sees it — identical technique to clwx92-workerenv-check.mjs, which proved
 * this reproduces the moe.16 in-app failure exactly.
 */
function applyEnvShape(envShape) {
  if (envShape !== 'electronlike') return;
  process.versions.electron = process.versions.electron || '35.0.0';
  try {
    Object.defineProperty(process, 'type', { value: 'utility', configurable: true });
  } catch {
    process.type = 'utility';
  }
}

/**
 * Registration-smoke mode (CLWX-77 outlook/forms registration leg): import
 * the STAGED plugin entry and call register() with a mock gateway API that
 * only collects tool names. Proves the plugin's whole import graph loads
 * from the staged bundle and the tool inventory registers per contract.
 * Host-API env is set to a CLOSED local port — the CLWX-86 capability probe
 * fails unreachable → indeterminate → fail-open, so no tool parks and no
 * HTTP side effects are possible. register() itself never sends anything.
 */
async function runRegisterMode(spec) {
  if (spec.hostApi) {
    process.env.CLAWX_HOST_API_PORT = String(spec.hostApi.port);
    process.env.CLAWX_HOST_API_TOKEN = String(spec.hostApi.token);
  } else {
    // The parent's dev environment may carry live host-API vars; the
    // no-hostapi row must genuinely run without them.
    delete process.env.CLAWX_HOST_API_PORT;
    delete process.env.CLAWX_HOST_API_TOKEN;
  }
  // Deterministic network isolation (Codex lane finding, 2026-09-06): an
  // "assumed closed" port is not a guarantee — a local listener answering the
  // CLWX-86 capability probe could park tool families while the name-only
  // check stays green. Stub fetch BEFORE the plugin loads: every attempt is
  // recorded and rejected without opening a socket, so the gate always takes
  // its unreachable → indeterminate → fail-open path, listener or not.
  let networkAttempts = 0;
  globalThis.fetch = async () => {
    networkAttempts += 1;
    throw new Error('artifact-harness: network disabled in registration smoke');
  };
  const plugin = await import(pathToFileURL(spec.pluginIndexPath).href);
  if (typeof plugin.register !== 'function') {
    emit({ ok: false, infra: true, message: 'plugin entry has no register() export' });
    return;
  }
  const names = [];
  const quiet = { info() {}, warn() {}, error() {}, debug() {} };
  const api = {
    pluginConfig: spec.pluginConfig ?? {},
    registerTool: (def) => { names.push(typeof def?.name === 'string' ? def.name : '(unnamed)'); },
    log: quiet,
    logger: quiet,
    // spec.host lets rows pin host-contract gates (e.g. the legacy
    // skillAllowlist outlook kill-switch); JSON-serializable shapes only.
    host: spec.host ?? {},
  };
  try {
    const returned = await plugin.register(api);
    emit({ ok: true, result: { names: [...names].sort(), returned: returned ?? null, networkAttempts } });
  } catch (err) {
    emit({ ok: false, message: err instanceof Error ? err.message : String(err) });
  }
}

async function main() {
  const spec = JSON.parse(process.argv[2] ?? '{}');
  applyEnvShape(spec.envShape);
  if (spec.mode === 'register') {
    await runRegisterMode(spec);
    return;
  }
  const tools = await import(pathToFileURL(spec.docToolsPath).href);
  const fn = tools[spec.fn];
  if (typeof fn !== 'function') {
    emit({ ok: false, infra: true, message: `doc-tools has no export "${spec.fn}"` });
    return;
  }
  try {
    const result = await fn(spec.args);
    // dataUrl payloads can be large; cap what travels back to the parent.
    if (result && typeof result.dataUrl === 'string' && result.dataUrl.length > 200) {
      result.dataUrl = result.dataUrl.slice(0, 200);
    }
    emit({ ok: true, result });
  } catch (err) {
    emit({ ok: false, message: err instanceof Error ? err.message : String(err) });
  }
}

main().catch((err) => {
  // Reaching here means the ROW never ran (spec parse / doc-tools import
  // failed) — harness plumbing or a genuinely unloadable artifact; either
  // way the parent must not count it as a graded refusal.
  emit({ ok: false, infra: true, message: `child crashed before the tool ran: ${err instanceof Error ? err.message : String(err)}` });
});
