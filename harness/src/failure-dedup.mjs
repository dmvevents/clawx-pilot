// harness/src/failure-dedup.mjs — cross-version failure_category deduper.
//
// Called by the consolidated-summary step in
// .github/workflows/windows-installer-e2e.yml. Reads the JUnit XML each
// matrix leg produced, tallies which failure_category values appear in
// which installer_version legs, and returns a markdown callout that
// goes at the top of the consolidated $GITHUB_STEP_SUMMARY.
//
// A category is flagged REGRESSION SUSPECT when it shows up in >=2 of
// the 3 installer_version legs — that's the shape of a real regression
// (multiple release trains hit the same failure mode) rather than a
// per-version flake.
//
// No XML parser dep: JUnit's failure_category is emitted by PR #16's
// classifier as `<property name="failure_category" value="..."/>` and
// a substring regex is enough. If a future JUnit renderer emits
// attribute quoting differently, we escalate to a real parser.

import { readFileSync } from 'node:fs';

const PROPERTY_RE = /name="failure_category"\s+value="([^"]+)"/g;

/**
 * @param {string} xml
 * @returns {string[]} unique category names present in this XML.
 */
export function extractCategories(xml) {
  const seen = new Set();
  let m;
  while ((m = PROPERTY_RE.exec(xml)) !== null) {
    seen.add(m[1]);
  }
  return [...seen];
}

/**
 * @param {Array<{ version: string, xml: string | null }>} legs
 * @returns {{
 *   suspects: Array<{ category: string, versions: string[] }>,
 *   perVersionOnly: Array<{ category: string, version: string }>,
 *   markdown: string,
 * }}
 */
export function dedupFailureCategories(legs) {
  // category -> Set<version>
  const byCategory = new Map();
  for (const { version, xml } of legs) {
    if (typeof xml !== 'string' || xml.length === 0) continue;
    for (const cat of extractCategories(xml)) {
      if (!byCategory.has(cat)) byCategory.set(cat, new Set());
      byCategory.get(cat).add(version);
    }
  }

  const suspects = [];
  const perVersionOnly = [];
  for (const [category, versionSet] of byCategory.entries()) {
    const versions = [...versionSet].sort();
    if (versions.length >= 2) {
      suspects.push({ category, versions });
    } else {
      perVersionOnly.push({ category, version: versions[0] });
    }
  }
  suspects.sort((a, b) => b.versions.length - a.versions.length || a.category.localeCompare(b.category));
  perVersionOnly.sort((a, b) => a.category.localeCompare(b.category));

  const lines = [];
  if (suspects.length > 0) {
    lines.push('> **REGRESSION SUSPECT** — the same `failure_category` appeared in multiple installer versions:');
    lines.push('>');
    for (const s of suspects) {
      lines.push(`> - \`${s.category}\` in ${s.versions.map((v) => `\`${v}\``).join(', ')}`);
    }
  } else if (byCategory.size > 0) {
    lines.push('> _per-version-only_ — every `failure_category` is confined to a single installer version; no cross-version regression suspects.');
  } else {
    lines.push('> _per-version-only_ — no `failure_category` entries found across any installer version.');
  }

  return { suspects, perVersionOnly, markdown: lines.join('\n') };
}

/**
 * CLI: node failure-dedup.mjs <nightly.xml> <stable.xml> <previous.xml>
 * Prints the markdown callout on stdout so the workflow can prepend it.
 * Missing files are treated as empty legs (no failures reported).
 */
export function cliMain(argv) {
  const [nightlyPath, stablePath, previousPath] = argv;
  const legs = [
    { version: 'nightly', xml: safeRead(nightlyPath) },
    { version: 'stable', xml: safeRead(stablePath) },
    { version: 'previous', xml: safeRead(previousPath) },
  ];
  const { markdown } = dedupFailureCategories(legs);
  process.stdout.write(markdown + '\n');
}

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
  process.argv[1].endsWith('failure-dedup.mjs');
if (invokedDirectly) {
  cliMain(process.argv.slice(2));
}
