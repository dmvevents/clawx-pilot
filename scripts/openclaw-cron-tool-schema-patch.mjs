import fs from 'node:fs';
import path from 'node:path';

/**
 * CLWX-141 — Gemini (Vertex via the LiteLLM gateway, and the direct API) returns an
 * EMPTY completion / MALFORMED_FUNCTION_CALL whenever the declared tool set contains
 * the bundled `automations` (cron) tool, because that tool's schema has a parameter
 * literally named `in`. Proven 2026-09-11 by capturing the installed app's request
 * (89 tools) and bisecting it against the production gateway: the single property
 * `in` flips the NSCC policy prompt from 3/3 EMPTY to 0/3 on both `moe-demo-pro`
 * and `moe-demo` (docs/evidence/moe34-2026-09-11/moe34-tap/).
 *
 * The runtime is vendored, so the fix is a build-time source patch of the bundled
 * chunk (same pattern as the Windows PTY guard): rename the schema property to
 * `delay`, teach the `next_check` handler to accept the new name (and still the old
 * one), and rewrite the runtime's own prompt text that tells automation runs to call
 * `next_check in:"<dur>"`. The bundle verifier asserts the patched shape so a runtime
 * upgrade that moves these anchors fails the build instead of shipping the defect.
 *
 * Compatibility contract: the handler keeps reading `in` as a fallback on purpose. Self-paced
 * automation jobs created on moe.34 or earlier have the old prompt text (`with in:"<duration>"`)
 * serialized into their stored payload, and the runtime never rewrites persisted jobs; the
 * fallback is what keeps those runs pacing. Do not remove it in a later clean-up.
 *
 * Scope: only the root `dist/` chunks the desktop app executes. `dist/worker/worker.mjs` is a
 * minified duplicate of the whole runtime used solely by the `openclaw worker` container lane,
 * which nothing in electron/, src/, extensions/ or resources/ spawns; it is intentionally left
 * untouched and is NOT covered by the verifier's guarantee (recorded on CLWX-141).
 */
export const OPENCLAW_CRON_TOOL_SCHEMA_PATCH_VERSION = '2026.9.2';
export const CRON_NEXT_CHECK_PARAM = 'delay';

const CRON_TOOL_FILE_RE = /^cron-tool-.*\.js$/;
const COMMANDS_HANDLERS_FILE_RE = /^commands-handlers\.runtime-.*\.js$/;

/** Each anchor: exact baseline text, exact patched text, expected occurrences in the baseline. */
const CRON_TOOL_ANCHORS = [
  {
    label: 'schema property',
    baseline: '\t\tin: Type.Optional(Type.String({ description: "Relative duration for action=\\"next_check\\" (for example, \\"15m\\")" })),',
    patched: `\t\t${CRON_NEXT_CHECK_PARAM}: Type.Optional(Type.String({ description: "Relative duration for action=\\"next_check\\" (for example, \\"15m\\")" })),`,
    count: 1,
  },
  {
    label: 'management-only omit list',
    baseline: 'Type.Omit(schema, [\n\t\t"in",',
    patched: `Type.Omit(schema, [\n\t\t"${CRON_NEXT_CHECK_PARAM}",`,
    count: 1,
  },
  {
    // NOTE: the `const rawDuration = ` prefix is load-bearing, not incidental — the patched form
    // re-embeds the old `readToolStringParam(params, "in", …)` call as a fallback, and
    // classifySource() only tells baseline from patched apart because the baseline string carries
    // this prefix while the patched string does not repeat it. The `label` keeps the "required"
    // error naming the declared parameter (`delay required`), not the retired one.
    label: 'next_check handler read',
    baseline: 'const rawDuration = readToolStringParam(params, "in", { required: true });',
    patched: `const rawDuration = readToolStringParam(params, "${CRON_NEXT_CHECK_PARAM}") ?? readToolStringParam(params, "in", { required: true, label: "${CRON_NEXT_CHECK_PARAM}" });`,
    count: 1,
  },
  {
    label: 'next_check error text',
    baseline: 'cron next_check in must be a positive duration',
    patched: `cron next_check ${CRON_NEXT_CHECK_PARAM} must be a positive duration`,
    count: 2,
  },
  {
    label: 'tool description paced loop',
    baseline: 'job calls next_check in:"<dur>"',
    patched: `job calls next_check ${CRON_NEXT_CHECK_PARAM}:"<dur>"`,
    count: 1,
  },
  {
    // The ACTIONS summary is the first thing the model reads in the tool description; leaving
    // `in:` here while the schema says `delay` ships contradictory instructions (review F1).
    label: 'tool description ACTIONS line',
    baseline: 'next_check in:"30m" (own paced run only)',
    patched: `next_check ${CRON_NEXT_CHECK_PARAM}:"30m" (own paced run only)`,
    count: 1,
  },
];

const COMMANDS_HANDLERS_ANCHORS = [
  {
    label: 'self-paced automation prompt',
    baseline: 'action:"next_check" with in:"<duration>"',
    patched: `action:"next_check" with ${CRON_NEXT_CHECK_PARAM}:"<duration>"`,
    count: 1,
  },
];

function readPackageVersion(openclawDir) {
  const pkg = JSON.parse(fs.readFileSync(path.join(openclawDir, 'package.json'), 'utf8'));
  return String(pkg.version ?? '');
}

export function countOccurrences(source, snippet) {
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

function replaceAllExact(source, search, replacement) {
  return source.split(search).join(replacement);
}

/**
 * Classify a chunk against a set of anchors.
 *  - 'baseline': every anchor present exactly `count` times and no patched form present.
 *  - 'patched':  every patched form present exactly `count` times and no baseline form present.
 *  - 'unrelated': no anchor of either form present (this chunk does not carry the tool).
 *  - otherwise an Error describing the ambiguous shape.
 */
export function classifySource(source, anchors) {
  let baselineHits = 0;
  let patchedHits = 0;
  const detail = [];
  for (const anchor of anchors) {
    const b = countOccurrences(source, anchor.baseline);
    const p = anchor.baseline === anchor.patched ? 0 : countOccurrences(source, anchor.patched);
    detail.push(`${anchor.label}: baseline=${b}, patched=${p}, expected=${anchor.count}`);
    if (b === anchor.count && p === 0) baselineHits += 1;
    else if (p === anchor.count && b === 0) patchedHits += 1;
    else if (b === 0 && p === 0) continue;
    else return new Error(`ambiguous anchor shape (${detail.join('; ')})`);
  }
  if (baselineHits === anchors.length) return 'baseline';
  if (patchedHits === anchors.length) return 'patched';
  if (baselineHits === 0 && patchedHits === 0) return 'unrelated';
  return new Error(`partially patched chunk (${detail.join('; ')})`);
}

/** Pure transform of a chunk that is in the baseline shape; returns the input unchanged otherwise. */
export function transformSource(source, anchors) {
  const state = classifySource(source, anchors);
  if (state instanceof Error) throw state;
  if (state !== 'baseline') return { source, changed: false, state };
  let next = source;
  for (const anchor of anchors) next = replaceAllExact(next, anchor.baseline, anchor.patched);
  const after = classifySource(next, anchors);
  if (after !== 'patched') throw new Error(`cron tool schema patch did not converge: ${after instanceof Error ? after.message : after}`);
  return { source: next, changed: true, state: 'patched' };
}

export function transformCronToolSource(source) {
  return transformSource(source, CRON_TOOL_ANCHORS);
}

export function transformCommandsHandlersSource(source) {
  return transformSource(source, COMMANDS_HANDLERS_ANCHORS);
}

function findTargets(openclawDir) {
  const distDir = path.join(openclawDir, 'dist');
  const names = fs.readdirSync(distDir);
  const targets = [];
  for (const [re, anchors, label] of [
    [CRON_TOOL_FILE_RE, CRON_TOOL_ANCHORS, 'cron tool'],
    [COMMANDS_HANDLERS_FILE_RE, COMMANDS_HANDLERS_ANCHORS, 'commands handlers'],
  ]) {
    const carriers = [];
    for (const name of names.filter((n) => re.test(n))) {
      const filePath = path.join(distDir, name);
      const source = fs.readFileSync(filePath, 'utf8');
      const state = classifySource(source, anchors);
      if (state instanceof Error) throw new Error(`${label} chunk ${name}: ${state.message}`);
      if (state === 'unrelated') continue;
      carriers.push({ filePath, source, state, anchors, label });
    }
    if (carriers.length !== 1) {
      throw new Error(`Expected exactly one OpenClaw ${OPENCLAW_CRON_TOOL_SCHEMA_PATCH_VERSION} ${label} chunk carrying the next_check anchors under ${distDir}, found ${carriers.length}`);
    }
    targets.push(carriers[0]);
  }
  return targets;
}

export function assertOpenClawCronToolSchemaPatch(openclawDir) {
  const version = readPackageVersion(openclawDir);
  if (version !== OPENCLAW_CRON_TOOL_SCHEMA_PATCH_VERSION) {
    return { supported: false, version };
  }
  const targets = findTargets(openclawDir);
  const unpatched = targets.filter((t) => t.state !== 'patched');
  if (unpatched.length > 0) {
    throw new Error(`OpenClaw cron tool schema patch (CLWX-141, parameter "in" → "${CRON_NEXT_CHECK_PARAM}") missing in ${unpatched.map((t) => path.basename(t.filePath)).join(', ')}`);
  }
  return { supported: true, version, files: targets.map((t) => t.filePath) };
}

export function patchOpenClawCronToolSchema(openclawDir) {
  const version = readPackageVersion(openclawDir);
  if (version !== OPENCLAW_CRON_TOOL_SCHEMA_PATCH_VERSION) {
    return { supported: false, version, patched: false, files: [] };
  }
  const targets = findTargets(openclawDir);
  let patched = false;
  for (const target of targets) {
    const result = transformSource(target.source, target.anchors);
    if (result.changed) {
      fs.writeFileSync(target.filePath, result.source, 'utf8');
      patched = true;
    }
  }
  assertOpenClawCronToolSchemaPatch(openclawDir);
  return { supported: true, version, patched, files: targets.map((t) => t.filePath) };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const openclawDir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(process.cwd(), 'build', 'openclaw');
  const verifyOnly = process.argv.includes('--verify');
  try {
    const result = verifyOnly ? assertOpenClawCronToolSchemaPatch(openclawDir) : patchOpenClawCronToolSchema(openclawDir);
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
