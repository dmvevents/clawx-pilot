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
 * stdout (last line): JSON { ok: true, result } | { ok: false, message }
 * The message carries err.message ONLY — if a stack leaks into a
 * principal-facing message, that is a finding the parent must see, so we
 * never append err.stack ourselves.
 */
import { pathToFileURL } from 'node:url';

async function main() {
  const spec = JSON.parse(process.argv[2] ?? '{}');
  const tools = await import(pathToFileURL(spec.docToolsPath).href);
  const fn = tools[spec.fn];
  if (typeof fn !== 'function') {
    console.log(JSON.stringify({ ok: false, message: `doc-tools has no export "${spec.fn}"` }));
    return;
  }
  try {
    const result = await fn(spec.args);
    // dataUrl payloads can be large; cap what travels back to the parent.
    if (result && typeof result.dataUrl === 'string' && result.dataUrl.length > 200) {
      result.dataUrl = result.dataUrl.slice(0, 200);
    }
    console.log(JSON.stringify({ ok: true, result }));
  } catch (err) {
    console.log(JSON.stringify({ ok: false, message: err instanceof Error ? err.message : String(err) }));
  }
}

main().catch((err) => {
  console.log(JSON.stringify({ ok: false, message: `child crashed: ${err instanceof Error ? err.message : String(err)}` }));
});
