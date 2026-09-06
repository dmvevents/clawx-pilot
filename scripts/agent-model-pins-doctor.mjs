/**
 * Agent model-pin doctor (CLWX-83, finding #4).
 *
 * Why this exists: an agent config pinned a nonexistent model
 * ("gpt-5.3-codex-spark") and every parallel-agent wave silently lost 1-2
 * workers for a month — `codex doctor` validates config parse and the
 * DEFAULT model only; per-profile and per-agent pins error at spawn time,
 * quietly. This doctor audits every pin surface against the committed
 * allowlist (scripts/agent-model-allowlist.json):
 *
 *   1. .codex/agents/*.toml   — `model = "..."` pins must be in codexModels.
 *   2. .claude/agents/*.md and .codex/agents/*.md frontmatter — `model:`
 *      must be a tier alias (haiku/sonnet/opus/fable/inherit); bare model
 *      IDs break under Bedrock/proxy routing per the harness enforcer.
 *   3. ~/.codex/config.toml (best-effort, machine-local) — knownBadModels
 *      pins FAIL; legacy [profiles.*] tables WARN (codex >= 0.153 refuses
 *      `--profile` against legacy tables outright, so they are dead config).
 *
 * Parser notes (adversarial review, this card): pins are matched in BOTH
 * TOML quote styles, as dotted keys (`profiles.x.model = ...`), and inside
 * inline tables; content of multi-line strings ("""/''') is skipped so a
 * docstring example can never produce a phantom pin. This is still a
 * line-based scanner, not a TOML parser — kept dependency-free on purpose.
 *
 * Repo surfaces (1+2) are also guarded on every `pnpm test` run by
 * tests/unit/clwx83-agent-model-pins.test.ts, which imports the pure
 * functions below. A run that finds ZERO repo surface files fails — an
 * empty audit must never report CLEAN.
 *
 * Run: pnpm doctor:agents          (exit 0 clean, 1 failures; warnings never fail)
 *      pnpm doctor:agents --strict (warnings also fail)
 */

import { readdirSync, readFileSync, existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Yield trimmed TOML lines that sit OUTSIDE multi-line strings, so string
 * content (e.g. developer_instructions docstrings) is never scanned.
 */
function* tomlScanLines(text) {
  let inMultiline = null; // the open delimiter: '"""' or "'''"
  for (const rawLine of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (inMultiline) {
      if (line.includes(inMultiline)) inMultiline = null;
      continue;
    }
    if (!line || line.startsWith('#')) continue;
    let opensMultiline = false;
    for (const delim of ['"""', "'''"]) {
      const count = line.split(delim).length - 1;
      if (count % 2 === 1) {
        inMultiline = delim;
        opensMultiline = true;
        break;
      }
    }
    if (opensMultiline) continue;
    yield line;
  }
}

/**
 * Parse model pins from a TOML text, tracking [section] tables. Matches
 * `model = "x"` and `model = 'x'`, dotted keys ending in `.model`, and
 * `model = ...` inside inline tables.
 */
export function parseTomlModelPins(text) {
  const pins = [];
  let section = '';
  for (const line of tomlScanLines(text)) {
    const sectionMatch = line.match(/^\[+([^\]]+)\]+$/);
    if (sectionMatch) {
      section = sectionMatch[1].trim();
      continue;
    }
    const pinMatch = line.match(/^(?:[\w."'-]+\.)?model\s*=\s*(["'])([^"']+)\1/);
    if (pinMatch) {
      pins.push({ section, model: pinMatch[2] });
      continue;
    }
    if (/=\s*\{/.test(line)) {
      const inline = line.match(/\bmodel\s*=\s*(["'])([^"']+)\1/);
      if (inline) pins.push({ section, model: inline[2] });
    }
  }
  return pins;
}

/**
 * Parse the `model:` frontmatter value from an agent .md, or null.
 * Tolerates a UTF-8 BOM, quoted values, and trailing YAML comments.
 */
export function parseAgentMdModelPin(text) {
  const fm = text.replace(/^﻿/, '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return null;
  const pin = fm[1].match(/^model:\s*["']?([^\s"'#]+)["']?\s*(?:#.*)?$/m);
  return pin ? pin[1] : null;
}

/** List legacy [profiles.*] table names in a codex config TOML. */
export function parseLegacyProfileTables(text) {
  const tables = [];
  for (const line of tomlScanLines(text)) {
    const match = line.match(/^\[profiles\.([^\]]+)\]$/);
    if (match) tables.push(match[1]);
  }
  return tables;
}

/**
 * Audit repo agent surfaces. Files are {path, text}; returns {failures}.
 * Pure — callers read the files (CLI below, or the unit guard with fixtures).
 */
export function auditRepoAgentSurfaces({ codexTomlFiles = [], agentMdFiles = [], allowlist }) {
  const failures = [];
  const codexModels = new Set(allowlist.codexModels);
  const tierAliases = new Set(allowlist.tierAliases);
  for (const file of codexTomlFiles) {
    for (const pin of parseTomlModelPins(file.text)) {
      if (!codexModels.has(pin.model)) {
        failures.push(
          `${file.path}: pins model "${pin.model}"${pin.section ? ` (in [${pin.section}])` : ''} — not in the verified allowlist (scripts/agent-model-allowlist.json)`,
        );
      }
    }
  }
  for (const file of agentMdFiles) {
    const pin = parseAgentMdModelPin(file.text);
    if (pin !== null && !tierAliases.has(pin)) {
      failures.push(
        `${file.path}: frontmatter pins model "${pin}" — must be a tier alias (${[...tierAliases].join('/')}); bare model IDs silently break under Bedrock/proxy routing`,
      );
    }
  }
  return { failures };
}

/** Audit a user-level codex config text. Returns {failures, warnings}. */
export function auditCodexUserConfig(text, allowlist) {
  const failures = [];
  const warnings = [];
  const knownBad = new Set(allowlist.knownBadModels);
  const codexModels = new Set(allowlist.codexModels);
  for (const pin of parseTomlModelPins(text)) {
    const where = pin.section ? `[${pin.section}]` : 'top-level';
    if (knownBad.has(pin.model)) {
      failures.push(`${where} pins "${pin.model}" — PROVEN nonexistent (the CLWX-83 silent-worker-loss class)`);
    } else if (!codexModels.has(pin.model)) {
      warnings.push(`${where} pins "${pin.model}" — not in the verified allowlist; verify it exists, then add it`);
    }
  }
  const legacy = parseLegacyProfileTables(text);
  if (legacy.length > 0) {
    warnings.push(
      `legacy [profiles.*] tables (${legacy.join(', ')}) — codex >= 0.153 refuses --profile against legacy tables; migrate to ~/.codex/<name>.config.toml or remove`,
    );
  }
  return { failures, warnings };
}

function readDirFiles(dir, suffix) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(suffix))
    .map((name) => ({ path: join(dir, name), text: readFileSync(join(dir, name), 'utf8') }));
}

function main() {
  const strict = process.argv.includes('--strict');
  const configFlagIndex = process.argv.indexOf('--codex-config');
  const codexConfigPath =
    configFlagIndex !== -1 ? process.argv[configFlagIndex + 1] : join(homedir(), '.codex', 'config.toml');

  const allowlist = JSON.parse(readFileSync(join(repoRoot, 'scripts', 'agent-model-allowlist.json'), 'utf8'));
  const codexTomlFiles = readDirFiles(join(repoRoot, '.codex', 'agents'), '.toml');
  const agentMdFiles = [
    ...readDirFiles(join(repoRoot, '.claude', 'agents'), '.md'),
    ...readDirFiles(join(repoRoot, '.codex', 'agents'), '.md'),
  ];

  const repo = auditRepoAgentSurfaces({ codexTomlFiles, agentMdFiles, allowlist });
  if (codexTomlFiles.length === 0 || agentMdFiles.length === 0) {
    repo.failures.push(
      `audited ${codexTomlFiles.length} codex toml(s) and ${agentMdFiles.length} agent md(s) — an empty surface means the agent dirs moved; the audit is only meaningful if it saw them`,
    );
  }
  console.log(
    `[doctor:agents] repo surfaces: ${codexTomlFiles.length} codex toml(s), ${agentMdFiles.length} agent md(s) — ${
      repo.failures.length === 0 ? 'CLEAN' : `${repo.failures.length} FAILURE(S)`
    }`,
  );
  for (const failure of repo.failures) console.error(`  FAIL ${failure}`);

  let user = { failures: [], warnings: [] };
  if (existsSync(codexConfigPath)) {
    user = auditCodexUserConfig(readFileSync(codexConfigPath, 'utf8'), allowlist);
    console.log(
      `[doctor:agents] user config (${codexConfigPath}): ${
        user.failures.length === 0 ? 'no known-bad pins' : `${user.failures.length} FAILURE(S)`
      }, ${user.warnings.length} warning(s)`,
    );
    for (const failure of user.failures) console.error(`  FAIL ${failure}`);
    for (const warning of user.warnings) console.warn(`  WARN ${warning}`);
  } else {
    console.log(`[doctor:agents] user config not found at ${codexConfigPath} — skipped`);
  }

  const failed = repo.failures.length + user.failures.length > 0 || (strict && user.warnings.length > 0);
  process.exit(failed ? 1 : 0);
}

function isInvokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}
if (isInvokedDirectly()) main();
