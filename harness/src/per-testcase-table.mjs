// harness/src/per-testcase-table.mjs — per-testcase failure table renderer.
//
// Sibling of failure-dedup.mjs. Called by the consolidated-summary job
// in .github/workflows/windows-installer-e2e.yml. Reads the JUnit XML
// each matrix leg produced and renders a markdown table with one row
// per failing testcase (across all 3 installer_versions), sorted by
// (failure_category asc, test_name asc).
//
// The 3-way summary + REGRESSION-SUSPECT callout (failure-dedup.mjs)
// answers "which failure_categories fired, and did they overlap?".
// This module answers the next question a reviewer asks: "which
// specific testcase produced each row, and when did it first fail?".
//
// When there are zero failures across all 3 legs we emit a single-line
// all-green message instead of an empty table — the count comes from
// each <testsuite tests="..."> attribute so the message stays honest
// even if the prompt corpus grows.
//
// No XML parser dependency: we consume the same shape harness/run.ts
// emits via renderJUnitXml, plus one non-emitted-yet attribute
// (`timestamp` on <testcase>/<testsuite>). Attribute quoting matches
// the renderer; a future switch to a different renderer would need a
// real parser and would flip our contract tests red first.

import { readFileSync } from 'node:fs';

import {
  DEFAULT_FLAKE_THRESHOLD,
  DEFAULT_FLAKE_WINDOW,
  analyzeFlakeRate,
  loadHistoryJunits,
  readFlakeConfig,
} from './flake-analyzer.mjs';
import { DEFAULT_OWNER, loadOwners, resolveOwner } from './testcase-owners.mjs';

const TESTSUITE_OPEN_RE = /<testsuite\b([^>]*)>/;
const TESTSUITE_TESTS_RE = /\btests="(\d+)"/;
const TESTSUITE_TS_RE = /\btimestamp="([^"]+)"/;
// Match ONLY <testcase ...> </testcase> block pairs — the negative
// lookbehind excludes self-closing `<testcase .../>` opening tags,
// which are passes and would otherwise falsely open a block spanning
// the next real failure.
const TESTCASE_BLOCK_RE = /<testcase\b([^>]*?)(?<!\/)>([\s\S]*?)<\/testcase>/g;
const NAME_ATTR_RE = /\bname="([^"]+)"/;
const TIMESTAMP_ATTR_RE = /\btimestamp="([^"]+)"/;
const FAILURE_RE = /<failure\b/;
const FAILURE_CATEGORY_RE = /name="failure_category"\s+value="([^"]+)"/;

/**
 * @param {string} xml   raw JUnit XML for a single installer_version leg
 * @param {string} version   installer_version name (nightly|stable|previous)
 * @returns {{
 *   failingRows: Array<{
 *     test_name: string,
 *     installer_version: string,
 *     failure_category: string,
 *     first_failure_ts_from_junit: string,
 *   }>,
 *   totalTests: number,
 * }}
 */
export function extractFailingTestcases(xml, version) {
  if (typeof xml !== 'string' || xml.length === 0) {
    return { failingRows: [], totalTests: 0 };
  }
  const suiteMatch = TESTSUITE_OPEN_RE.exec(xml);
  const suiteAttrs = suiteMatch ? suiteMatch[1] : '';
  const suiteTestsMatch = TESTSUITE_TESTS_RE.exec(suiteAttrs);
  const totalTests = suiteTestsMatch ? Number(suiteTestsMatch[1]) : 0;
  const suiteTsMatch = TESTSUITE_TS_RE.exec(suiteAttrs);
  const suiteTs = suiteTsMatch ? suiteTsMatch[1] : '';

  const failingRows = [];
  // Only <testcase>...</testcase> blocks can carry a <failure> child;
  // self-closing testcases are passes and are ignored here.
  let m;
  TESTCASE_BLOCK_RE.lastIndex = 0;
  while ((m = TESTCASE_BLOCK_RE.exec(xml)) !== null) {
    const [, attrs, body] = m;
    if (!FAILURE_RE.test(body)) continue;
    const nameMatch = NAME_ATTR_RE.exec(attrs);
    if (!nameMatch) continue;
    const tsMatch = TIMESTAMP_ATTR_RE.exec(attrs);
    const catMatch = FAILURE_CATEGORY_RE.exec(body);
    failingRows.push({
      test_name: nameMatch[1],
      installer_version: version,
      failure_category: catMatch ? catMatch[1] : '(uncategorised)',
      first_failure_ts_from_junit: tsMatch ? tsMatch[1] : suiteTs,
    });
  }
  return { failingRows, totalTests };
}

/**
 * @param {Array<{ version: string, xml: string | null }>} legs
 * @param {{
 *   ownersJsonRules?: Array<any> | null,
 *   codeownersRules?: Array<any> | null,
 *   historyJunits?: string[] | null,
 *   flakeThreshold?: number,
 * }} [sources]
 * @returns {{
 *   rows: Array<{
 *     test_name: string,
 *     installer_version: string,
 *     failure_category: string,
 *     owner: string,
 *     flake_rate: number,
 *     first_failure_ts_from_junit: string,
 *   }>,
 *   totalTests: number,
 *   allPassed: boolean,
 *   markdown: string,
 * }}
 */
export function buildPerTestcaseTable(legs, sources) {
  const rows = [];
  let totalTests = 0;
  const historyJunits =
    sources && Array.isArray(sources.historyJunits) ? sources.historyJunits : null;
  const flakeThreshold =
    sources && typeof sources.flakeThreshold === 'number'
      ? sources.flakeThreshold
      : DEFAULT_FLAKE_THRESHOLD;
  for (const { version, xml } of legs) {
    const { failingRows, totalTests: t } = extractFailingTestcases(xml, version);
    totalTests += t;
    for (const r of failingRows) {
      const flakeRate = historyJunits ? analyzeFlakeRate(historyJunits, r.test_name) : 0;
      rows.push({
        test_name: r.test_name,
        installer_version: r.installer_version,
        failure_category: r.failure_category,
        owner: resolveOwner(r.test_name, sources ?? {}),
        flake_rate: flakeRate,
        first_failure_ts_from_junit: r.first_failure_ts_from_junit,
      });
    }
  }

  // Required sort: (failure_category asc, test_name asc). Ties within
  // the same category+name across versions are stable — the leg order
  // supplied by the caller (nightly, stable, previous) is preserved.
  rows.sort((a, b) => {
    const cat = a.failure_category.localeCompare(b.failure_category);
    if (cat !== 0) return cat;
    return a.test_name.localeCompare(b.test_name);
  });

  const allPassed = rows.length === 0;
  const lines = [];
  lines.push('## Per-testcase failure table');
  lines.push('');
  if (allPassed) {
    // Message shape locked so a reviewer scanning the summary sees the
    // exact same sentence on every green run.
    lines.push(
      `All ${totalTests} testcases passed across all ${legs.length} installer_versions.`,
    );
  } else {
    lines.push(
      '| test_name | installer_version | failure_category | owner | flake_rate | first_failure_ts_from_junit |',
    );
    lines.push('| --- | --- | --- | --- | ---: | --- |');
    for (const r of rows) {
      // `[known-flaky]` prefix is a visual signal to the reviewer that
      // this row is a repeat offender across history, not a fresh
      // regression. Threshold is configurable via HARNESS_FLAKE_THRESHOLD.
      const flaky = r.flake_rate >= flakeThreshold;
      const displayName = flaky ? `[known-flaky] ${r.test_name}` : r.test_name;
      const rateStr = r.flake_rate.toFixed(2);
      lines.push(
        `| ${displayName} | ${r.installer_version} | ${r.failure_category} | ${r.owner} | ${rateStr} | ${r.first_failure_ts_from_junit} |`,
      );
    }
  }

  return { rows, totalTests, allPassed, markdown: lines.join('\n') };
}

/**
 * CLI: node per-testcase-table.mjs <nightly.xml> <stable.xml> <previous.xml>
 * Prints the markdown table (or all-green line) on stdout so the
 * workflow can append it to $GITHUB_STEP_SUMMARY.
 */
export function cliMain(argv) {
  const [nightlyPath, stablePath, previousPath] = argv;
  const legs = [
    { version: 'nightly', xml: safeRead(nightlyPath) },
    { version: 'stable', xml: safeRead(stablePath) },
    { version: 'previous', xml: safeRead(previousPath) },
  ];
  // Auto-discover CODEOWNERS + harness/tests/OWNERS.json from the repo
  // the workflow is running in. Missing files silently fall through to
  // DEFAULT_OWNER (@clawx-triage).
  const ownerSources = loadOwners();
  // Read HARNESS_FLAKE_WINDOW / HARNESS_FLAKE_THRESHOLD from env; load
  // the newest N JUnit history entries so the table can annotate rows
  // as [known-flaky] when they exceed the threshold. Missing history
  // dir yields flake_rate=0 for every row — the honest signal on a
  // repo that has never populated history.
  const { window, threshold } = readFlakeConfig();
  const historyJunits = loadHistoryJunits({ window });
  const { markdown } = buildPerTestcaseTable(legs, {
    ...ownerSources,
    historyJunits,
    flakeThreshold: threshold,
  });
  process.stdout.write(markdown + '\n');
}

export { DEFAULT_OWNER, DEFAULT_FLAKE_WINDOW, DEFAULT_FLAKE_THRESHOLD };

function safeRead(p) {
  if (!p) return null;
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

const invokedDirectly =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  process.argv[1].endsWith('per-testcase-table.mjs');
if (invokedDirectly) {
  cliMain(process.argv.slice(2));
}
