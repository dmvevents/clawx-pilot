#!/usr/bin/env node
/**
 * eval/run.mjs — ClawX doc-tooling evaluation pipeline.
 *
 * The offline harness (`harness/run.ts`) answers "does the handler work?" and
 * scores 5/5. The Ministry scored the same build 0/5. Both are true: the
 * failure was tool SELECTION and file DISCOVERY, neither of which the harness
 * can observe, because it reads `expect_calls_tool` from its own spec and
 * calls that handler directly with an absolute path.
 *
 * This pipeline scores the layers the harness cannot:
 *
 *   A  selection    Does the shipped catalogue rank document.* above the
 *                   Python skills for each Ministry prompt?
 *   B  counterfactual  Replay the PRE-FIX catalogue. The Python skill MUST
 *                   win. A metric that cannot reproduce the known failure
 *                   proves nothing when it passes, so this lane inverts the
 *                   assertion and fails if the defect is NOT reproduced.
 *   C  discovery    Does a bare filename resolve on a OneDrive-redirected
 *                   tree, and does the sandbox still refuse /etc/hosts?
 *   D  steering     Are the catalogue's steering claims actually present?
 *   E  capability   Delegates to harness/run.ts — handlers still work.
 *   F  live         Real LLM tool-pick. SKIPs loudly with no model.
 *
 * Every lane is deterministic except F. Exit 0 only if no lane FAILs; a
 * SKIP is reported but does not fail the run, and the report says which
 * lanes skipped so a green run is never mistaken for full coverage.
 *
 * Usage:
 *   pnpm eval                     # lanes A-E
 *   pnpm eval --live              # add lane F (needs a reachable model)
 *   pnpm eval --lane A            # one lane (repeatable)
 *   pnpm eval --json out.json     # machine-readable report
 *   pnpm eval --junit out.xml     # JUnit XML for CI
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  REPO_ROOT,
  INDEX_MJS,
  autoEnabledSlugs,
  buildCatalogue,
  loadPersona,
  loadSkillCatalogue,
  loadToolCatalogue,
  personaDirectives,
  rank,
} from './lib/steering.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_DIR = path.join(__dirname, 'cases');

const DOC_TOOL_NAMES = [
  'document.read_pdf',
  'document.read_docx',
  'document.write_docx',
  'document.read_xlsx',
  'document.write_xlsx',
  'document.read_image',
];

/** The four Python-backed skills that competed with the native tools. */
const PYTHON_DOC_SKILLS = ['pdf', 'docx', 'xlsx', 'pptx'];

// ---------------------------------------------------------------- utilities

function parseArgs(argv) {
  const args = { live: false, lanes: [], json: null, junit: null, verbose: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--live') args.live = true;
    else if (a === '--verbose' || a === '-v') args.verbose = true;
    else if (a === '--lane') args.lanes.push(argv[++i].toUpperCase());
    else if (a.startsWith('--lane=')) args.lanes.push(a.slice(7).toUpperCase());
    else if (a === '--json') args.json = argv[++i];
    else if (a.startsWith('--json=')) args.json = a.slice(7);
    else if (a === '--junit') args.junit = argv[++i];
    else if (a.startsWith('--junit=')) args.junit = a.slice(8);
  }
  return args;
}

function loadCases(file) {
  return JSON.parse(readFileSync(path.join(CASES_DIR, file), 'utf8'));
}

const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', red: '\x1b[31m',
  green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};
const paint = (c, s) => (process.stdout.isTTY ? `${C[c]}${s}${C.reset}` : s);

class Lane {
  constructor(id, title, why) {
    this.id = id;
    this.title = title;
    this.why = why;
    this.results = [];
  }
  add(id, status, detail, extra = {}) {
    this.results.push({ id, status, detail, ...extra });
    const tag =
      status === 'PASS' ? paint('green', 'PASS')
      : status === 'FAIL' ? paint('red', 'FAIL')
      : paint('yellow', 'SKIP');
    process.stdout.write(`  [${tag}] ${id.padEnd(28)} ${paint('dim', detail)}\n`);
  }
  get failed() { return this.results.filter((r) => r.status === 'FAIL').length; }
  get skipped() { return this.results.filter((r) => r.status === 'SKIP').length; }
  get passed() { return this.results.filter((r) => r.status === 'PASS').length; }
}

// ------------------------------------------------------- lane A: selection

/**
 * The two catalogues a real principal can end up with. Scoring only the
 * default would be scoring the easy case: `bundles.json` ships the
 * recommended "Principal's toolkit" with pdf/xlsx/docx/pptx in it, so a
 * principal who accepts the recommendation gets every Python skill back and
 * the native tools must out-rank them on merit, not by absence.
 */
function catalogueProfiles({ tools, skills }) {
  const auto = autoEnabledSlugs();
  const bundles = JSON.parse(
    readFileSync(path.join(REPO_ROOT, 'resources/skills/bundles.json'), 'utf8'),
  );
  const recommended = bundles.bundles.find((b) => b.recommended) ?? { skills: [] };
  return [
    {
      id: 'default',
      why: 'fresh install — only auto-enabled skills reach the model',
      enabled: auto,
    },
    {
      id: 'principal-bundle',
      why: `recommended "${recommended.name ?? recommended.id}" installed — re-enables the Python doc skills`,
      enabled: new Set([...auto, ...recommended.skills]),
    },
  ];
}

async function laneSelection() {
  const lane = new Lane(
    'A',
    'tool selection — shipped catalogue',
    'the layer that actually produced the Ministry 0/5',
  );
  const spec = loadCases('tool-selection.json');
  const tools = await loadToolCatalogue();
  const skills = loadSkillCatalogue(os.homedir());
  const persona = loadPersona();

  for (const profile of catalogueProfiles({ tools, skills })) {
    const catalogue = buildCatalogue({ tools, skills, enabled: profile.enabled });
    const offered = catalogue.filter((c) => c.kind === 'skill').map((c) => c.name);
    process.stdout.write(
      paint('dim', `  profile "${profile.id}": ${tools.length} document.* tools + ${offered.length} skills — ${profile.why}\n`),
    );

    for (const c of spec.cases) {
      const id = `${c.id}[${profile.id}]`;
      const ranked = rank({
        prompt: c.prompt,
        fileExt: c.file_ext,
        candidates: catalogue,
        persona,
      });
      const top = ranked[0];
      const present = new Set(ranked.map((r) => r.name));
      const forbidden = (c.forbidden ?? []).filter((f) => present.has(f));

      if (forbidden.includes(top?.name)) {
        lane.add(
          id,
          'FAIL',
          `forbidden candidate "${top.name}" ranks #1 (${top.score}) — this is the 2026-07-21 failure mode`,
          { ranked: ranked.slice(0, 3), intent: ranked.intent },
        );
        continue;
      }
      if (c.expect_tool && top?.name !== c.expect_tool) {
        const want = ranked.find((r) => r.name === c.expect_tool);
        lane.add(
          id,
          'FAIL',
          `expected ${c.expect_tool} #1, got ${top?.name} (${top?.score}); ${c.expect_tool}=${want?.score ?? 'absent'} [intent=${ranked.intent}]`,
          { ranked: ranked.slice(0, 3), intent: ranked.intent },
        );
        continue;
      }
      // Margin over the best forbidden candidate. A hair-thin win is not a
      // durable one, so the margin is recorded and reported.
      const bestForbidden = ranked.find((r) => forbidden.includes(r.name));
      const margin = bestForbidden
        ? Math.round((top.score - bestForbidden.score) * 1000) / 1000
        : null;
      lane.add(
        id,
        'PASS',
        `#1 ${top.name} (${top.score})` +
          (margin === null
            ? ' — no forbidden candidate in this catalogue'
            : ` beats ${bestForbidden.name} (${bestForbidden.score}) by ${margin}`),
        { ranked: ranked.slice(0, 3), margin, intent: ranked.intent },
      );
    }
  }
  return lane;
}

// -------------------------------------------- lane B: counterfactual replay

/**
 * Replays the PRE-FIX catalogue and asserts the defect reproduces. If the
 * Python skill does NOT win here, the metric is not measuring what it claims
 * and lane A's green is meaningless — so this lane FAILs on non-reproduction.
 */
async function laneCounterfactual() {
  const lane = new Lane(
    'B',
    'counterfactual — pre-fix catalogue must still fail',
    'a metric that cannot reproduce the known failure proves nothing when it passes',
  );
  const spec = loadCases('tool-selection.json');
  const tools = await loadToolCatalogue();
  const skills = loadSkillCatalogue(os.homedir());

  // Pre-fix state: pdf/docx/xlsx/pptx auto-enabled, no persona document.*
  // routing rule, and tool descriptions without the "prefer this" steering.
  const preFixEnabled = new Set([
    ...autoEnabledSlugs(),
    ...PYTHON_DOC_SKILLS,
  ]);
  const strippedTools = tools.map((t) => ({
    ...t,
    // Strip the steering sentences added by the fix, keeping the factual
    // description — this is what the descriptions said before 98e805d8's
    // steering pass.
    description: t.description
      .replace(/Prefer th(is|ese)[^.]*\./g, '')
      .replace(/WITHOUT invoking Python/g, '')
      .replace(/no Python[^.]*\./gi, ''),
  }));
  const catalogue = buildCatalogue({
    tools: strippedTools,
    skills,
    enabled: preFixEnabled,
  });

  let reproduced = 0;
  const scoreable = spec.cases.filter((c) => (c.forbidden ?? []).length > 0);
  for (const c of scoreable) {
    const ranked = rank({
      prompt: c.prompt,
      fileExt: c.file_ext,
      candidates: catalogue,
      persona: '', // no document.* routing rule pre-fix
    });
    const top = ranked[0];
    if ((c.forbidden ?? []).includes(top?.name)) {
      reproduced++;
      lane.add(c.id, 'PASS', `defect reproduced: "${top.name}" wins (${top.score}) as it did on 2026-07-21`);
    } else {
      lane.add(
        c.id,
        'SKIP',
        `pre-fix catalogue still picks ${top?.name} — this case's regression is not catalogue-driven`,
      );
    }
  }

  // The suite-level assertion: the pre-fix catalogue must lose a meaningful
  // share of cases, or the proxy is not sensitive to the thing we fixed.
  const rate = reproduced / Math.max(1, scoreable.length);
  if (reproduced === 0) {
    lane.add(
      'B-sensitivity',
      'FAIL',
      `pre-fix catalogue reproduced 0/${scoreable.length} failures — the ranking model is NOT sensitive to the defect, so lane A's result is not evidence`,
    );
  } else {
    lane.add(
      'B-sensitivity',
      'PASS',
      `pre-fix catalogue fails ${reproduced}/${scoreable.length} (${Math.round(rate * 100)}%) — the metric detects the defect it claims to measure`,
    );
  }
  return lane;
}

// ------------------------------------------------------- lane C: discovery

async function laneDiscovery() {
  const lane = new Lane(
    'C',
    'file discovery — OneDrive KFM + sandbox',
    '"I couldn\'t find any files in that folder" was Defect A',
  );
  const spec = loadCases('discovery.json');
  const { resolveReadablePath, findWithinDir, findWithinDirLegacyDepthFirst } =
    await import(
      pathToFileURL(
        path.join(REPO_ROOT, 'extensions/moe-principal-assistant/doc-tools.mjs'),
      ).href
    );
  const home = os.homedir();

  // Traversal-order counterfactual. A depth-first walk burns its entry budget
  // inside whichever subfolder sorts first and never reaches a depth-1
  // sibling — which is where Output_Files lives. Assert the breadth-first
  // scan finds it AND that the old order does not, on the same real tree; a
  // fix nobody can see fail is not a verified fix. If the legacy walk also
  // finds it, this box's ~/Documents is too small to exhibit the bug and the
  // check SKIPs rather than claiming a pass it did not earn.
  {
    const dir = path.join(home, 'Documents', 'Output_Files');
    const name = `moe-eval-traversal-${process.pid}.docx`;
    const preexisting = existsSync(dir);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, name), 'eval probe');
    try {
      const bfs = findWithinDir(path.join(home, 'Documents'), name);
      const dfs = findWithinDirLegacyDepthFirst(path.join(home, 'Documents'), name);
      if (!bfs) {
        lane.add(
          'C0-traversal-order',
          'FAIL',
          'breadth-first scan missed a depth-1 sibling in ~/Documents/Output_Files',
        );
      } else if (dfs) {
        lane.add(
          'C0-traversal-order',
          'SKIP',
          'both traversals found it — this ~/Documents is too small to exhibit the budget-exhaustion bug',
        );
      } else {
        lane.add(
          'C0-traversal-order',
          'PASS',
          'breadth-first found ~/Documents/Output_Files; the superseded depth-first walk missed it',
        );
      }
    } finally {
      await rm(path.join(dir, name), { force: true }).catch(() => {});
      if (!preexisting) await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  for (const c of spec.cases) {
    if (c.platform === 'darwin' && process.platform !== 'darwin') {
      lane.add(c.id, 'SKIP', 'darwin-only case');
      continue;
    }
    if (c.platform === '!win32' && process.platform === 'win32') {
      lane.add(c.id, 'SKIP', 'non-win32 case');
      continue;
    }

    const name = `moe-eval-${c.id}-${process.pid}.docx`;
    let dir = null;
    let filePath = c.path ?? null;
    let cleanupRoot = null;

    try {
      if (c.layout?.startsWith('home:')) {
        const rel = c.layout.slice('home:'.length);
        dir = path.join(home, rel);
        // Remove only the leaf file, never the (possibly real) folder tree.
        const preexisting = existsSync(dir);
        await mkdir(dir, { recursive: true });
        if (!preexisting) cleanupRoot = path.join(home, rel.split(path.sep)[0]);
        filePath = path.join(dir, name);
        await writeFile(filePath, 'eval probe');
      } else if (c.layout === 'tmpdir') {
        dir = await mkdtemp(path.join(os.tmpdir(), 'moe-eval-'));
        cleanupRoot = dir;
        filePath = path.join(dir, name);
        await writeFile(filePath, 'eval probe');
      } else if (c.layout === 'tmp-literal') {
        dir = path.join('/tmp', `moe-eval-${process.pid}`);
        await mkdir(dir, { recursive: true });
        cleanupRoot = dir;
        filePath = path.join(dir, name);
        await writeFile(filePath, 'eval probe');
      }

      const query =
        c.query === 'absolute' ? filePath
        : c.query === 'tilde' ? filePath.replace(home, '~')
        : name;

      let got = null;
      let err = null;
      try {
        got = resolveReadablePath(query);
      } catch (e) {
        err = e;
      }

      if (c.expect === 'found') {
        if (err) {
          lane.add(c.id, 'FAIL', `expected to find ${query}, threw: ${err.message.slice(0, 140)}`);
        } else if (path.resolve(got) !== path.resolve(filePath) &&
                   // tmp symlink aliasing: compare realpaths
                   !got.endsWith(path.join(path.basename(dir ?? ''), name))) {
          lane.add(c.id, 'FAIL', `resolved to ${got}, expected ${filePath}`);
        } else {
          lane.add(c.id, 'PASS', `${c.query} → ${got.replace(home, '~')}`);
        }
      } else if (c.expect === 'refused') {
        if (err && /refused to read/.test(err.message)) {
          lane.add(c.id, 'PASS', 'sandbox refused, as required');
        } else if (err) {
          lane.add(c.id, 'FAIL', `expected a sandbox refusal, got: ${err.message.slice(0, 120)}`);
        } else {
          lane.add(c.id, 'FAIL', `SANDBOX ESCAPE: resolved ${got}`);
        }
      } else if (c.expect === 'not-found') {
        if (!err) {
          lane.add(c.id, 'FAIL', `expected not-found, resolved ${got}`);
        } else if (!/file not found/.test(err.message)) {
          lane.add(c.id, 'FAIL', `wrong error: ${err.message.slice(0, 120)}`);
        } else if (!/searched/.test(err.message) || !/~\//.test(err.message)) {
          lane.add(
            c.id,
            'FAIL',
            'not-found message does not enumerate the searched folders, so the principal has nothing to act on',
          );
        } else {
          lane.add(c.id, 'PASS', 'not-found and the message lists what was searched');
        }
      }
    } finally {
      if (filePath && c.layout !== 'system') {
        await rm(filePath, { force: true }).catch(() => {});
      }
      if (cleanupRoot && cleanupRoot !== home) {
        await rm(cleanupRoot, { recursive: true, force: true }).catch(() => {});
      }
    }
  }
  return lane;
}

// -------------------------------------------------------- lane D: steering

async function laneSteering() {
  const lane = new Lane(
    'D',
    'steering artifacts present',
    'the catalogue text and manifest state the fix depends on',
  );
  const tools = await loadToolCatalogue();
  const persona = loadPersona();
  const enabled = autoEnabledSlugs();
  const indexSrc = readFileSync(INDEX_MJS, 'utf8');

  // Every document.* tool registered.
  const names = tools.map((t) => t.name);
  const missing = DOC_TOOL_NAMES.filter((n) => !names.includes(n));
  lane.add(
    'D1-tools-registered',
    missing.length ? 'FAIL' : 'PASS',
    missing.length ? `not registered: ${missing.join(', ')}` : `all ${DOC_TOOL_NAMES.length} document.* tools registered`,
  );

  // Steering language in each description.
  for (const key of ['prefer', 'no-python']) {
    const re = key === 'prefer' ? /[Pp]refer th(is|ese)/ : /(WITHOUT invoking Python|no Python|without Python)/i;
    const bad = tools
      .filter((t) => DOC_TOOL_NAMES.includes(t.name))
      .filter((t) => !re.test(t.description))
      .map((t) => t.name);
    lane.add(
      `D2-${key}`,
      bad.length ? 'FAIL' : 'PASS',
      bad.length ? `missing ${key} claim: ${bad.join(', ')}` : `all descriptions carry the ${key} claim`,
    );
  }

  // Persona routing rule, mirroring the outlook.* rule that makes Outlook reliable.
  const directives = personaDirectives(persona);
  const routed = new Set(directives.map((d) => d.tool));
  const unrouted = DOC_TOOL_NAMES.filter((n) => !persona.includes(n));
  lane.add(
    'D3-persona-names-tools',
    unrouted.length ? 'FAIL' : 'PASS',
    unrouted.length ? `persona does not name: ${unrouted.join(', ')}` : 'persona names all six tools',
  );
  lane.add(
    'D4-persona-directives',
    routed.size >= 4 ? 'PASS' : 'FAIL',
    `${routed.size} parseable file-kind directives [${[...routed].join(', ')}]`,
  );

  // Python skills not auto-enabled.
  const offenders = PYTHON_DOC_SKILLS.filter((s) => enabled.has(s));
  lane.add(
    'D5-python-skills-off',
    offenders.length ? 'FAIL' : 'PASS',
    offenders.length
      ? `auto-enabled on every fresh install: ${offenders.join(', ')}`
      : 'pdf/docx/xlsx/pptx are not auto-enabled',
  );

  // The native path must not regress to shelling out.
  const code = indexSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const shellOuts = ['child_process', 'execSync', 'spawnSync', 'uv run', 'pip install'].filter(
    (b) => code.includes(b),
  );
  lane.add(
    'D6-no-shell-out',
    shellOuts.length ? 'FAIL' : 'PASS',
    shellOuts.length ? `index.mjs shells out: ${shellOuts.join(', ')}` : 'no shell-out in index.mjs',
  );

  // Runtime deps must be real dependencies — electron-builder strips devDeps.
  const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  const misclassified = ['pdf-parse', 'mammoth', 'xlsx', 'docx'].filter(
    (d) => !pkg.dependencies?.[d],
  );
  lane.add(
    'D7-deps-classified',
    misclassified.length ? 'FAIL' : 'PASS',
    misclassified.length
      ? `stripped from the asar (moe.9 class): ${misclassified.join(', ')}`
      : 'pdf-parse/mammoth/xlsx/docx are runtime dependencies',
  );

  return lane;
}

// ------------------------------------------------------ lane E: capability

async function laneCapability() {
  const lane = new Lane(
    'E',
    'capability — handler layer',
    'delegates to harness/run.ts; proves the handlers behind the tools still work',
  );
  const junit = path.join(REPO_ROOT, 'artifacts/eval/harness-junit.xml');
  await mkdir(path.dirname(junit), { recursive: true });
  const out = await sh('pnpm', ['exec', 'tsx', 'harness/run.ts', '--junit', junit]);
  const passes = [...out.stdout.matchAll(/\[PASS\] (\S+)/g)].map((m) => m[1]);
  const fails = [...out.stdout.matchAll(/\[FAIL\] (\S+)/g)].map((m) => m[1]);
  for (const id of passes) lane.add(`E-${id}`, 'PASS', 'handler ok');
  for (const id of fails) lane.add(`E-${id}`, 'FAIL', 'handler failed — see harness output');
  if (!passes.length && !fails.length) {
    lane.add('E-harness', 'FAIL', `harness produced no results (exit ${out.code})`);
  }
  return lane;
}

// ------------------------------------------------------------ lane F: live

async function laneLive(enabled) {
  const lane = new Lane(
    'F',
    'live model tool-pick',
    'the ONLY lane that proves what an actual LLM does; everything else is a proxy',
  );
  if (!enabled) {
    lane.add('F-live', 'SKIP', 'not requested — pass --live to run against a reachable model');
    return lane;
  }
  const probe = await sh('curl', [
    '-s', '-m', '4', '-o', '/dev/null', '-w', '%{http_code}',
    'http://127.0.0.1:8080/v1/models',
  ]);
  const code = probe.stdout.trim();
  if (code !== '200') {
    lane.add(
      'F-live',
      'SKIP',
      `no reachable model (router :8080 → HTTP ${code || 'no response'}). Tool-selection remains PROXY-VERIFIED ONLY.`,
    );
    return lane;
  }
  lane.add(
    'F-live',
    'SKIP',
    'router reachable but the in-app gateway turn is not wired into this pipeline yet — run the in-app suite on the pilot laptop',
  );
  return lane;
}

// --------------------------------------------------------------- reporting

function sh(cmd, args) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd: REPO_ROOT, env: process.env });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr += d));
    p.on('close', (code) => resolve({ code, stdout, stderr }));
    p.on('error', (e) => resolve({ code: -1, stdout, stderr: String(e) }));
  });
}

function junitXml(lanes) {
  const esc = (s) =>
    String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  const all = lanes.flatMap((l) => l.results);
  const suites = lanes
    .map((l) => {
      const cases = l.results
        .map((r) => {
          const attrs = `name="${esc(r.id)}" classname="clawx.eval.lane-${l.id}"`;
          if (r.status === 'PASS') return `    <testcase ${attrs}/>`;
          if (r.status === 'SKIP')
            return `    <testcase ${attrs}><skipped message="${esc(r.detail)}"/></testcase>`;
          return `    <testcase ${attrs}><failure message="${esc(r.detail)}"/></testcase>`;
        })
        .join('\n');
      return [
        `  <testsuite name="clawx.eval.lane-${l.id} ${esc(l.title)}" tests="${l.results.length}" failures="${l.failed}" skipped="${l.skipped}">`,
        cases,
        '  </testsuite>',
      ].join('\n');
    })
    .join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites tests="${all.length}" failures="${all.filter((r) => r.status === 'FAIL').length}" skipped="${all.filter((r) => r.status === 'SKIP').length}">`,
    suites,
    '</testsuites>',
    '',
  ].join('\n');
}

async function main() {
  const args = parseArgs(process.argv);
  const want = (id) => args.lanes.length === 0 || args.lanes.includes(id);

  process.stdout.write(
    `\n${paint('cyan', 'ClawX doc-tooling evaluation pipeline')}\n` +
      paint('dim', `  baseline: Ministry 2026-07-21 scored 0/5 (incoming-tests/ClawX Agent Tests/)\n`) +
      paint('dim', `  platform: ${process.platform} ${process.arch}   node ${process.version}\n\n`),
  );

  const lanes = [];
  const plan = [
    ['A', laneSelection],
    ['B', laneCounterfactual],
    ['C', laneDiscovery],
    ['D', laneSteering],
    ['E', laneCapability],
    ['F', () => laneLive(args.live)],
  ];

  for (const [id, fn] of plan) {
    if (!want(id)) continue;
    process.stdout.write(paint('cyan', `Lane ${id}: `));
    const stub = new Lane(id, '', '');
    let lane;
    try {
      lane = await fn();
    } catch (err) {
      process.stdout.write('\n');
      stub.add(`${id}-lane`, 'FAIL', `lane threw: ${err.message}`);
      lane = stub;
    }
    lanes.push(lane);
    process.stdout.write('\n');
  }

  // Rewrite the header line per lane now that titles are known — printed
  // after the fact keeps the streaming output honest about ordering.
  process.stdout.write(paint('cyan', 'Summary\n'));
  let totalFail = 0;
  let totalSkip = 0;
  for (const l of lanes) {
    totalFail += l.failed;
    totalSkip += l.skipped;
    const verdict = l.failed ? paint('red', 'FAIL') : l.skipped === l.results.length ? paint('yellow', 'SKIP') : paint('green', 'PASS');
    process.stdout.write(
      `  ${verdict}  lane ${l.id} ${l.title.padEnd(44)} ${l.passed}P ${l.failed}F ${l.skipped}S\n`,
    );
    if (l.why) process.stdout.write(paint('dim', `        ${l.why}\n`));
  }

  if (totalSkip) {
    process.stdout.write(
      paint('yellow', `\n  ${totalSkip} check(s) SKIPPED — a green run here does NOT mean full coverage.\n`),
    );
    const liveSkipped = lanes.find((l) => l.id === 'F')?.skipped;
    if (liveSkipped) {
      process.stdout.write(
        paint('yellow', '  Tool selection is PROXY-VERIFIED ONLY. Closing it out needs an in-app LLM run on the pilot laptop.\n'),
      );
    }
  }

  const report = {
    baseline: 'Ministry 2026-07-21, 0/5',
    platform: `${process.platform} ${process.arch}`,
    node: process.version,
    lanes: lanes.map((l) => ({
      id: l.id, title: l.title, why: l.why,
      passed: l.passed, failed: l.failed, skipped: l.skipped,
      results: l.results,
    })),
    totals: {
      passed: lanes.reduce((s, l) => s + l.passed, 0),
      failed: totalFail,
      skipped: totalSkip,
    },
  };
  if (args.json) {
    const dest = path.resolve(args.json);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, JSON.stringify(report, null, 2) + '\n');
    process.stdout.write(paint('dim', `\n  JSON report → ${dest}\n`));
  }
  if (args.junit) {
    const dest = path.resolve(args.junit);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, junitXml(lanes));
    process.stdout.write(paint('dim', `  JUnit XML   → ${dest}\n`));
  }

  process.stdout.write(
    totalFail
      ? paint('red', `\n  ${totalFail} FAILURE(S)\n\n`)
      : paint('green', `\n  all ${report.totals.passed} checks passed\n\n`),
  );
  process.exit(totalFail ? 1 : 0);
}

main().catch((err) => {
  process.stderr.write(`eval: fatal: ${err?.stack ?? err}\n`);
  process.exit(2);
});
