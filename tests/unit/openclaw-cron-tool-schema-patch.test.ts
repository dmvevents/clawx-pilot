// @vitest-environment node
import fs from 'node:fs';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CRON_NEXT_CHECK_PARAM,
  OPENCLAW_CRON_TOOL_SCHEMA_PATCH_VERSION,
  assertOpenClawCronToolSchemaPatch,
  classifySource,
  patchOpenClawCronToolSchema,
  transformCommandsHandlersSource,
  transformCronToolSource,
} from '../../scripts/openclaw-cron-tool-schema-patch.mjs';

const ROOT = path.resolve(__dirname, '..', '..');
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

// Minimal stand-in for the bundled cron-tool chunk: every anchor the patch touches, in the
// exact upstream shape (tabs, quoting) observed in openclaw 2026.9.2 `dist/cron-tool-*.js`.
const CRON_TOOL_BASELINE = [
  '\tconst schema = Type.Object({',
  '\t\tid: Type.Optional(Type.String()),',
  '\t\tin: Type.Optional(Type.String({ description: "Relative duration for action=\\"next_check\\" (for example, \\"15m\\")" })),',
  '\t\ttext: Type.Optional(Type.String({ description: "systemEvent text for action=\\"wake\\"" })),',
  '\t}, { additionalProperties: true });',
  '\treturn managementOnly ? Type.Omit(schema, [',
  '\t\t"in",',
  '\t\t"text",',
  '\t]) : schema;',
  'ACTIONS: status | list [includeDisabled,limit?,offset?] | next_check in:"30m" (own paced run only) | wake text',
  'PACED LOOP: recurring job + pacing{min?,max?} durations ("15m","4h"; at least one). Inside its run, job calls next_check in:"<dur>" to set the next delay',
  '\t\t\t\t\tcase "next_check": {',
  '\t\t\t\t\t\tconst rawDuration = readToolStringParam(params, "in", { required: true });',
  '\t\t\t\t\t\ttry { delayMs = parseDurationMs(rawDuration); } catch {',
  '\t\t\t\t\t\t\tthrow new Error("cron next_check in must be a positive duration");',
  '\t\t\t\t\t\t}',
  '\t\t\t\t\t\tif (delayMs <= 0) throw new Error("cron next_check in must be a positive duration");',
  '\t\t\t\t\t}',
].join('\n');

const COMMANDS_HANDLERS_BASELINE = [
  '\tif (params.selfPaced) lines.push(`Before replying, ALWAYS call the ${AUTOMATIONS_TOOL_NAME} tool action:"next_check" with in:"<duration>" — pick the next check`);',
].join('\n');

async function makeBundle(version: string, cronSource: string, commandsSource: string) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'clawx-cron-schema-patch-'));
  tempDirs.push(dir);
  await mkdir(path.join(dir, 'dist'), { recursive: true });
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'openclaw', version }));
  await writeFile(path.join(dir, 'dist', 'cron-tool-AAAA1111.js'), cronSource);
  // A second cron-tool chunk that is only a re-export must be ignored, not counted as ambiguous.
  await writeFile(path.join(dir, 'dist', 'cron-tool-BBBB2222.js'), 'export { t } from "./cron-tool-AAAA1111.js";\n');
  await writeFile(path.join(dir, 'dist', 'commands-handlers.runtime-CCCC3333.js'), commandsSource);
  return dir;
}

describe('openclaw cron tool schema patch (CLWX-141)', () => {
  it('renames the next_check parameter everywhere the runtime declares, reads or prompts for it', () => {
    const cron = transformCronToolSource(CRON_TOOL_BASELINE);
    expect(cron.changed).toBe(true);
    expect(cron.source).not.toMatch(/^\t\tin: Type\.Optional/m);
    expect(cron.source).toContain(`\t\t${CRON_NEXT_CHECK_PARAM}: Type.Optional(Type.String({ description: "Relative duration for action=\\"next_check\\"`);
    expect(cron.source).toContain(`Type.Omit(schema, [\n\t\t"${CRON_NEXT_CHECK_PARAM}",`);
    // The handler accepts the new name and still honours the old one for jobs persisted before the
    // rename; the "required" error names the declared parameter, not the retired one.
    expect(cron.source).toContain(`readToolStringParam(params, "${CRON_NEXT_CHECK_PARAM}") ?? readToolStringParam(params, "in", { required: true, label: "${CRON_NEXT_CHECK_PARAM}" })`);
    expect(cron.source).toContain(`job calls next_check ${CRON_NEXT_CHECK_PARAM}:"<dur>"`);
    expect(cron.source).toContain(`next_check ${CRON_NEXT_CHECK_PARAM}:"30m" (own paced run only)`);
    // No model-facing text may still tell the model to send `in`.
    expect(cron.source).not.toContain('next_check in:');
    expect(cron.source).not.toContain('cron next_check in must be');
    expect(cron.source.match(new RegExp(`cron next_check ${CRON_NEXT_CHECK_PARAM} must be a positive duration`, 'g'))).toHaveLength(2);

    const commands = transformCommandsHandlersSource(COMMANDS_HANDLERS_BASELINE);
    expect(commands.changed).toBe(true);
    expect(commands.source).toContain(`action:"next_check" with ${CRON_NEXT_CHECK_PARAM}:"<duration>"`);
    expect(commands.source).not.toContain('with in:"<duration>"');
  });

  it('is idempotent and never leaves a half-patched chunk', () => {
    const once = transformCronToolSource(CRON_TOOL_BASELINE);
    const twice = transformCronToolSource(once.source);
    expect(twice.changed).toBe(false);
    expect(twice.source).toBe(once.source);
    expect(twice.state).toBe('patched');
    expect(classifySource('export const unrelated = 1;\n', [{ label: 'x', baseline: 'AAA', patched: 'BBB', count: 1 }])).toBe('unrelated');
    // A chunk with the schema renamed but the handler still reading only "in" is rejected.
    const half = CRON_TOOL_BASELINE.replace('\t\tin: Type.Optional', `\t\t${CRON_NEXT_CHECK_PARAM}: Type.Optional`);
    expect(() => transformCronToolSource(half)).toThrow(/ambiguous|partially patched/);
  });

  it('patches a bundle directory, verifies it, and skips unrelated re-export chunks', async () => {
    const dir = await makeBundle(OPENCLAW_CRON_TOOL_SCHEMA_PATCH_VERSION, CRON_TOOL_BASELINE, COMMANDS_HANDLERS_BASELINE);
    expect(() => assertOpenClawCronToolSchemaPatch(dir)).toThrow(/cron tool schema patch .* missing/);
    const result = patchOpenClawCronToolSchema(dir);
    expect(result).toMatchObject({ supported: true, patched: true });
    expect(result.files.map((f: string) => path.basename(f))).toEqual(['cron-tool-AAAA1111.js', 'commands-handlers.runtime-CCCC3333.js']);
    expect(assertOpenClawCronToolSchemaPatch(dir)).toMatchObject({ supported: true });
    expect(patchOpenClawCronToolSchema(dir)).toMatchObject({ supported: true, patched: false });
    expect(fs.readFileSync(path.join(dir, 'dist', 'cron-tool-BBBB2222.js'), 'utf8')).toContain('export { t }');
  });

  it('declares itself unsupported for a runtime version it was not written against', async () => {
    const dir = await makeBundle('2026.10.0', CRON_TOOL_BASELINE, COMMANDS_HANDLERS_BASELINE);
    expect(patchOpenClawCronToolSchema(dir)).toMatchObject({ supported: false, patched: false });
    expect(assertOpenClawCronToolSchemaPatch(dir)).toMatchObject({ supported: false });
    expect(fs.readFileSync(path.join(dir, 'dist', 'cron-tool-AAAA1111.js'), 'utf8')).toBe(CRON_TOOL_BASELINE);
  });

  it('fails loudly when the bundled chunk is missing or duplicated instead of shipping the defect', async () => {
    const dir = await makeBundle(OPENCLAW_CRON_TOOL_SCHEMA_PATCH_VERSION, 'export const nothing = 1;\n', COMMANDS_HANDLERS_BASELINE);
    expect(() => patchOpenClawCronToolSchema(dir)).toThrow(/Expected exactly one .* cron tool chunk/);
    const dup = await makeBundle(OPENCLAW_CRON_TOOL_SCHEMA_PATCH_VERSION, CRON_TOOL_BASELINE, COMMANDS_HANDLERS_BASELINE);
    await writeFile(path.join(dup, 'dist', 'cron-tool-DDDD4444.js'), CRON_TOOL_BASELINE);
    expect(() => patchOpenClawCronToolSchema(dup)).toThrow(/found 2/);
  });

  const installedVersion = fs.existsSync(path.join(ROOT, 'node_modules', 'openclaw', 'package.json'))
    ? JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', 'openclaw', 'package.json'), 'utf8')).version
    : null;
  const itForPinnedRuntime = installedVersion === OPENCLAW_CRON_TOOL_SCHEMA_PATCH_VERSION ? it : it.skip;

  itForPinnedRuntime('matches the anchors of the actually installed openclaw runtime', () => {
    const distDir = path.join(ROOT, 'node_modules', 'openclaw', 'dist');
    const cronChunks = fs.readdirSync(distDir).filter((n) => /^cron-tool-.*\.js$/.test(n));
    const baselineChunks = cronChunks.filter((n) => transformCronToolSource(fs.readFileSync(path.join(distDir, n), 'utf8')).changed);
    expect(baselineChunks).toHaveLength(1);
    const commandChunks = fs.readdirSync(distDir).filter((n) => /^commands-handlers\.runtime-.*\.js$/.test(n));
    const baselineCommands = commandChunks.filter((n) => transformCommandsHandlersSource(fs.readFileSync(path.join(distDir, n), 'utf8')).changed);
    expect(baselineCommands).toHaveLength(1);
    // After the transform, no built-in cron tool schema property is spelled `in` any more, and no
    // model-facing text in either real chunk still asks for it.
    const patched = transformCronToolSource(fs.readFileSync(path.join(distDir, baselineChunks[0]), 'utf8')).source;
    expect(patched).not.toMatch(/^\t\tin: Type\./m);
    expect(patched).not.toContain('next_check in:');
    expect(patched).not.toContain('cron next_check in must be');
    expect(patched).toContain('readToolStringParam(params, "in", { required: true, label: "delay" })');
    const patchedCommands = transformCommandsHandlersSource(fs.readFileSync(path.join(distDir, baselineCommands[0]), 'utf8')).source;
    expect(patchedCommands).not.toContain('with in:"<duration>"');
    expect(patchedCommands).toContain('with delay:"<duration>"');
  });
});
