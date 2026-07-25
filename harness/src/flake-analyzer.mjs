// harness/src/flake-analyzer.mjs — historical flake-rate analyzer.
//
// Sibling of per-testcase-table.mjs. Reads a windowed set of historical
// JUnit XML files (harness/history/junit-*.xml) and answers, for a
// given test_name, "what fraction of the last N runs did this testcase
// fail?" — a number in [0, 1].
//
// A row in the per-testcase failure table with flake_rate >= threshold
// (default 0.20) gets a `[known-flaky]` prefix on its test_name. The
// prefix is a visual signal to a reviewer that this row is a repeat
// offender rather than a fresh regression.
//
// Window + threshold defaults are wired into the CLI wrapper by
// per-testcase-table.mjs — HARNESS_FLAKE_WINDOW (default 10) caps how
// many history entries we consider; HARNESS_FLAKE_THRESHOLD (default
// 0.20) is the cutoff for the [known-flaky] prefix.
//
// No XML parser dependency: we consume the same shape harness/run.ts
// emits via renderJUnitXml. See per-testcase-table.mjs for the same
// contract-tested string parsing.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

export const DEFAULT_FLAKE_WINDOW = 10;
export const DEFAULT_FLAKE_THRESHOLD = 0.2;

// Matches ONLY <testcase ...>...</testcase> block pairs — the negative
// lookbehind excludes self-closing `<testcase .../>` opening tags,
// which are passes and would otherwise falsely open a block spanning
// the next real failure. Same rule as per-testcase-table.mjs.
const TESTCASE_BLOCK_RE = /<testcase\b([^>]*?)(?<!\/)>([\s\S]*?)<\/testcase>/g;
const NAME_ATTR_RE = /\bname="([^"]+)"/;
const FAILURE_RE = /<failure\b/;

/**
 * Given a single historical JUnit XML body, return true iff the named
 * testcase appears as a failure (block-form with <failure> child) in
 * that run. Self-closing testcases are passes and never count.
 *
 * @param {string} xml
 * @param {string} testName
 * @returns {boolean}
 */
export function testcaseFailedInRun(xml, testName) {
  if (typeof xml !== 'string' || xml.length === 0) return false;
  let m;
  TESTCASE_BLOCK_RE.lastIndex = 0;
  while ((m = TESTCASE_BLOCK_RE.exec(xml)) !== null) {
    const [, attrs, body] = m;
    const nameMatch = NAME_ATTR_RE.exec(attrs);
    if (!nameMatch) continue;
    if (nameMatch[1] !== testName) continue;
    if (FAILURE_RE.test(body)) return true;
  }
  return false;
}

/**
 * Pure function. Compute the flake_rate for `testName` across an
 * ordered array of historical JUnit XML strings. Rate = failing_runs /
 * total_runs, in [0, 1]. Empty history returns 0 — the reviewer sees
 * "0.00" and no [known-flaky] prefix, which is the honest signal on a
 * repo with no history dir yet.
 *
 * @param {string[]} historyJunits   ordered array (most-recent-first
 *                                    or oldest-first — the rate is
 *                                    invariant under order)
 * @param {string} testName
 * @returns {number}   rate in [0, 1]
 */
export function analyzeFlakeRate(historyJunits, testName) {
  if (!Array.isArray(historyJunits) || historyJunits.length === 0) return 0;
  let failed = 0;
  for (const xml of historyJunits) {
    if (testcaseFailedInRun(xml, testName)) failed += 1;
  }
  return failed / historyJunits.length;
}

/**
 * Filesystem loader. Walks `<repoRoot>/harness/history/` for files
 * matching `junit-*.xml`, sorts them lexicographically DESCENDING (the
 * filename convention includes an ISO timestamp so lexicographic order
 * ≈ chronological order), and returns the newest `window` entries as
 * XML strings.
 *
 * Missing dir returns an empty array — the CLI degrades gracefully to
 * flake_rate=0 on repos that have never populated history.
 *
 * @param {{ repoRoot?: string, window?: number }} [opts]
 * @returns {string[]}
 */
export function loadHistoryJunits(opts = {}) {
  const repoRoot = opts.repoRoot ?? process.cwd();
  const window = opts.window ?? DEFAULT_FLAKE_WINDOW;
  const dir = path.join(repoRoot, 'harness', 'history');
  if (!existsSync(dir)) return [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const junits = entries
    .filter((f) => f.startsWith('junit-') && f.endsWith('.xml'))
    .sort()
    .reverse()
    .slice(0, Math.max(0, window));
  const bodies = [];
  for (const f of junits) {
    try {
      bodies.push(readFileSync(path.join(dir, f), 'utf8'));
    } catch {
      // Skip unreadable history file — the flake_rate degrades toward
      // 0 in proportion to how many history files survive, which is
      // the honest signal.
    }
  }
  return bodies;
}

/**
 * Read HARNESS_FLAKE_WINDOW / HARNESS_FLAKE_THRESHOLD from the given
 * env, falling back to the module defaults. Isolated so the unit
 * tests can pass a fake env without mutating process.env.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ window: number, threshold: number }}
 */
export function readFlakeConfig(env) {
  const src = env ?? process.env;
  const rawWindow = Number(src.HARNESS_FLAKE_WINDOW);
  const rawThreshold = Number(src.HARNESS_FLAKE_THRESHOLD);
  const window =
    Number.isFinite(rawWindow) && rawWindow > 0 ? Math.floor(rawWindow) : DEFAULT_FLAKE_WINDOW;
  const threshold =
    Number.isFinite(rawThreshold) && rawThreshold >= 0 && rawThreshold <= 1
      ? rawThreshold
      : DEFAULT_FLAKE_THRESHOLD;
  return { window, threshold };
}
