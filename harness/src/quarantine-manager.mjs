// harness/src/quarantine-manager.mjs — SLA-based auto-quarantine planner.
//
// Sibling of flake-analyzer.mjs and per-testcase-table.mjs. Answers
// the question a triage rotation asks after seeing a [known-flaky]
// row for the third week in a row: "should this be quarantined?".
//
// This module is DRY-RUN ONLY. It never mutates test files, never
// edits harness sources, never rewrites JUnit. It emits a JSON
// manifest describing what a human owner *would* do — the actual
// quarantining is a follow-up PR the owner authors after reading
// this manifest.
//
// Decision rule (pure, testable):
//   - Compute per-suffix-window flake_rate using the same
//     analyzeFlakeRate contract as flake-analyzer.mjs.
//   - Slide a window of size `sustainWindow` over the last N history
//     entries. If the flake_rate over EVERY sub-window of that size
//     that ends within `sustainWindow` is >= threshold, the failure
//     is "sustained".
//   - Action = 'quarantine' when sustained. Otherwise 'noop'. Explicit
//     'unquarantine' is reserved for when a previously-quarantined
//     testcase has zero failures across the full history — this
//     module reports it but does not act on it (dry-run).
//
// Env overrides (read via readQuarantineConfig):
//   - HARNESS_QUARANTINE_THRESHOLD  default 0.30
//   - HARNESS_QUARANTINE_SUSTAIN    default 3
//
// Manifest shape (harness/reports/quarantine-plan.json):
//   {
//     "generated_at": "<iso8601 or omitted>",
//     "config": { "threshold": 0.30, "sustain": 3, "window": 10 },
//     "plans": [
//       {
//         "test_name": "P1-docx-summarize",
//         "action": "quarantine" | "unquarantine" | "noop",
//         "reason": "<human-readable>",
//         "current_flake_rate": 0.42,
//         "sustained_over_n_runs": 3
//       },
//       ...
//     ]
//   }

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { analyzeFlakeRate, testcaseFailedInRun } from './flake-analyzer.mjs';

export const DEFAULT_QUARANTINE_THRESHOLD = 0.3;
export const DEFAULT_QUARANTINE_SUSTAIN = 3;

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ threshold: number, sustain: number }}
 */
export function readQuarantineConfig(env) {
  const src = env ?? process.env;
  const rawThreshold = Number(src.HARNESS_QUARANTINE_THRESHOLD);
  const rawSustain = Number(src.HARNESS_QUARANTINE_SUSTAIN);
  const threshold =
    Number.isFinite(rawThreshold) && rawThreshold >= 0 && rawThreshold <= 1
      ? rawThreshold
      : DEFAULT_QUARANTINE_THRESHOLD;
  const sustain =
    Number.isFinite(rawSustain) && rawSustain >= 1
      ? Math.floor(rawSustain)
      : DEFAULT_QUARANTINE_SUSTAIN;
  return { threshold, sustain };
}

/**
 * Pure planner. Given a chronological history of JUnit XML runs and
 * a single testcase name, decide whether the testcase should be
 * quarantined. `historyJunits` MUST be ordered oldest-first — the
 * sustain window is a rolling window over the tail (most-recent
 * runs). loadHistoryJunits() in flake-analyzer.mjs returns
 * newest-first, so callers that consume it directly must
 * `[...history].reverse()` before passing here.
 *
 * @param {string[]} historyJunits   oldest-first ordered JUnit XML bodies
 * @param {string} testName
 * @param {{ sustainWindow?: number, sustainThreshold?: number }} [opts]
 * @returns {{
 *   action: 'quarantine' | 'unquarantine' | 'noop',
 *   reason: string,
 *   current_flake_rate: number,
 *   sustained_over_n_runs: number,
 * }}
 */
export function planQuarantine(historyJunits, testName, opts = {}) {
  const sustainWindow = opts.sustainWindow ?? DEFAULT_QUARANTINE_SUSTAIN;
  const sustainThreshold = opts.sustainThreshold ?? DEFAULT_QUARANTINE_THRESHOLD;

  const history = Array.isArray(historyJunits) ? historyJunits : [];
  const current_flake_rate = analyzeFlakeRate(history, testName);

  if (history.length === 0) {
    return {
      action: 'noop',
      reason: 'empty history — no signal',
      current_flake_rate: 0,
      sustained_over_n_runs: 0,
    };
  }

  // If the entire history is green for this testcase, flag the
  // human-review 'unquarantine' hint. This module never acts on it —
  // an owner still has to author the PR that removes the skip.
  const anyFailure = history.some((xml) => testcaseFailedInRun(xml, testName));
  if (!anyFailure) {
    return {
      action: 'unquarantine',
      reason: `no failures across ${history.length} historical runs`,
      current_flake_rate: 0,
      sustained_over_n_runs: 0,
    };
  }

  // Not enough history to satisfy the sustain requirement — noop.
  // We intentionally do NOT quarantine on a single hot run; the whole
  // point of sustain is to filter one-off environment blips.
  if (history.length < sustainWindow) {
    return {
      action: 'noop',
      reason: `history size ${history.length} < sustainWindow ${sustainWindow}`,
      current_flake_rate,
      sustained_over_n_runs: 0,
    };
  }

  // Compute how many CONSECUTIVE tail runs saw a failure. This is
  // the strict "sustained" signal — quarantine only when the tail
  // sustain-window entries are ALL failures AND the overall
  // flake_rate over that window meets the threshold. This makes a
  // single flaky run in an otherwise-green tail a noop even at a
  // low threshold, which is the behavior a reviewer expects.
  let consecutiveTailFailures = 0;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (testcaseFailedInRun(history[i], testName)) {
      consecutiveTailFailures += 1;
    } else {
      break;
    }
  }

  const tailRate = consecutiveTailFailures / sustainWindow;
  const sustained =
    consecutiveTailFailures >= sustainWindow && tailRate >= sustainThreshold;

  if (sustained) {
    return {
      action: 'quarantine',
      reason: `failed in the last ${consecutiveTailFailures} consecutive runs (>= sustainWindow ${sustainWindow}); rate ${tailRate.toFixed(2)} >= threshold ${sustainThreshold.toFixed(2)}`,
      current_flake_rate,
      sustained_over_n_runs: consecutiveTailFailures,
    };
  }

  return {
    action: 'noop',
    reason: `not sustained (${consecutiveTailFailures} consecutive tail failures; need ${sustainWindow} at rate >= ${sustainThreshold.toFixed(2)})`,
    current_flake_rate,
    sustained_over_n_runs: consecutiveTailFailures,
  };
}

/**
 * Build a JSON manifest for a set of testcases.
 *
 * @param {string[]} historyJunits   oldest-first history
 * @param {string[]} testNames       testcases to plan against
 * @param {{
 *   threshold?: number,
 *   sustain?: number,
 *   window?: number,
 *   generatedAt?: string,
 * }} [opts]
 * @returns {{
 *   generated_at?: string,
 *   config: { threshold: number, sustain: number, window: number },
 *   plans: Array<{
 *     test_name: string,
 *     action: 'quarantine' | 'unquarantine' | 'noop',
 *     reason: string,
 *     current_flake_rate: number,
 *     sustained_over_n_runs: number,
 *   }>,
 * }}
 */
export function buildQuarantineManifest(historyJunits, testNames, opts = {}) {
  const threshold = opts.threshold ?? DEFAULT_QUARANTINE_THRESHOLD;
  const sustain = opts.sustain ?? DEFAULT_QUARANTINE_SUSTAIN;
  const window = opts.window ?? historyJunits.length;
  const plans = testNames.map((name) => {
    const plan = planQuarantine(historyJunits, name, {
      sustainWindow: sustain,
      sustainThreshold: threshold,
    });
    return { test_name: name, ...plan };
  });
  const manifest = {
    config: { threshold, sustain, window },
    plans,
  };
  if (opts.generatedAt) {
    return { generated_at: opts.generatedAt, ...manifest };
  }
  return manifest;
}

/**
 * Write the manifest to disk under `<repoRoot>/harness/reports/`.
 * DRY-RUN discipline: this writes ONLY the manifest — never a test
 * file, never a source file, never the JUnit inputs.
 *
 * @param {ReturnType<typeof buildQuarantineManifest>} manifest
 * @param {{ repoRoot?: string, outPath?: string }} [opts]
 * @returns {string}   absolute path the manifest was written to
 */
export function writeQuarantineManifest(manifest, opts = {}) {
  const repoRoot = opts.repoRoot ?? process.cwd();
  const outPath =
    opts.outPath ?? path.join(repoRoot, 'harness', 'reports', 'quarantine-plan.json');
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  return outPath;
}

/**
 * Convert a manifest into a fast lookup map keyed by test_name so
 * the per-testcase table can render a QUARANTINE column without
 * re-planning per row.
 *
 * @param {ReturnType<typeof buildQuarantineManifest> | null | undefined} manifest
 * @returns {Map<string, { action: string, reason: string }>}
 */
export function manifestToLookup(manifest) {
  const map = new Map();
  if (!manifest || !Array.isArray(manifest.plans)) return map;
  for (const p of manifest.plans) {
    if (typeof p.test_name === 'string') {
      map.set(p.test_name, { action: p.action, reason: p.reason });
    }
  }
  return map;
}
