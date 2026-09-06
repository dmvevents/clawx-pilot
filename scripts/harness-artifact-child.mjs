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
 * argv[2]: JSON { docToolsPath, fn, args }
 *       or JSON { mode: 'register', pluginIndexPath, pluginConfig, hostApi? }
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

function emit(verdict) {
  console.log(`CLAWX77_VERDICT:${JSON.stringify(verdict)}`);
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
    host: {},
  };
  try {
    const returned = await plugin.register(api);
    emit({ ok: true, result: { names: [...names].sort(), returned: returned ?? null } });
  } catch (err) {
    emit({ ok: false, message: err instanceof Error ? err.message : String(err) });
  }
}

async function main() {
  const spec = JSON.parse(process.argv[2] ?? '{}');
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
