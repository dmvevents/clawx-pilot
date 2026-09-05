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

async function main() {
  const spec = JSON.parse(process.argv[2] ?? '{}');
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
