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
 *      pins FAIL; ACTIVE pins outside codexModels FAIL (the next-typo class,
 *      Codex adversarial review 2026-09-06); legacy [profiles.*] tables and
 *      the pins inside them WARN (codex >= 0.153 refuses `--profile` against
 *      legacy tables outright, so they are dead config; cleanup = owner call).
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
 * Cut an unquoted trailing `#` comment off a TOML line. Quote-aware so a `#`
 * inside a string value survives. Without this, delimiter counting below saw
 * comment text — `model = "x" # """` counted an odd number of triple quotes,
 * opened a phantom multiline, and SKIPPED the real pin (Codex adversarial
 * review, 2026-09-06: demonstrated false-clean bypass).
 */
function stripTomlComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '#') {
      return line.slice(0, i).trimEnd();
    }
  }
  return line;
}

/**
 * Yield trimmed TOML lines that sit OUTSIDE multi-line strings, so string
 * content (e.g. developer_instructions docstrings) is never scanned.
 * Comments are stripped BEFORE multiline-delimiter counting (see above).
 */
function* tomlScanLines(text) {
  let inMultiline = null; // the open delimiter: '"""' or "'''"
  for (const rawLine of text.replace(/^﻿/, '').split(/\r?\n/)) {
    if (inMultiline) {
      // Raw line on purpose: the closing delimiter may share a line with a
      // string-content `#` that must not hide it.
      if (rawLine.includes(inMultiline)) inMultiline = null;
      continue;
    }
    const line = stripTomlComment(rawLine.trim());
    if (!line) continue;
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
 * Parse ALL `model:` frontmatter values from an agent .md (array, possibly
 * empty). Tolerates a UTF-8 BOM, quoted values, and trailing YAML comments.
 * All occurrences matter: duplicate keys are ambiguous across YAML parsers,
 * so a clean first key must never mask a bad second one (Codex adversarial
 * review, 2026-09-06: demonstrated first-match-only bypass).
 */
export function parseAgentMdModelPins(text) {
  const fm = text.replace(/^﻿/, '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return [];
  const pins = [];
  const re = /^model:\s*["']?([^\s"'#]+)["']?\s*(?:#.*)?$/gm;
  let match;
  while ((match = re.exec(fm[1])) !== null) pins.push(match[1]);
  return pins;
}

/** First `model:` pin or null — kept for existing callers/fixtures. */
export function parseAgentMdModelPin(text) {
  return parseAgentMdModelPins(text)[0] ?? null;
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
    const pins = parseAgentMdModelPins(file.text);
    const distinct = [...new Set(pins)];
    if (distinct.length > 1) {
      failures.push(
        `${file.path}: frontmatter has ${pins.length} model: keys (${distinct.join(', ')}) — duplicate keys are ambiguous across YAML parsers; keep exactly one`,
      );
    }
    for (const pin of distinct) {
      if (!tierAliases.has(pin)) {
        failures.push(
          `${file.path}: frontmatter pins model "${pin}" — must be a tier alias (${[...tierAliases].join('/')}); bare model IDs silently break under Bedrock/proxy routing`,
        );
      }
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
    // Legacy [profiles.*] pins are DEAD config (codex >= 0.153 refuses the
    // tables outright) — they cannot cause silent worker loss, and their
    // cleanup is a recorded owner fleet call, so they stay warnings.
    const inDeadProfileTable = /^profiles\./.test(pin.section ?? '');
    if (knownBad.has(pin.model)) {
      failures.push(`${where} pins "${pin.model}" — PROVEN nonexistent (the CLWX-83 silent-worker-loss class)`);
    } else if (!codexModels.has(pin.model)) {
      if (inDeadProfileTable) {
        warnings.push(`${where} pins "${pin.model}" — not in the verified allowlist (inside a dead legacy profile table; cleanup is an owner call)`);
      } else {
        // ACTIVE unknown pins FAIL by default: the next typo is exactly the
        // spark class, and a warning-only default is a fail-open path (Codex
        // adversarial review, 2026-09-06). Verify the model live, then add
        // it to scripts/agent-model-allowlist.json.
        failures.push(`${where} pins "${pin.model}" — ACTIVE pin not in the verified allowlist (the next-typo class); verify it exists, then add it to scripts/agent-model-allowlist.json`);
      }
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
