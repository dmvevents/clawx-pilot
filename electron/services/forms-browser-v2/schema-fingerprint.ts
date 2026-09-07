/**
 * CLWX-64 — forms schema-drift detector.
 *
 * MSFORMS_AUTOMATION.md warns Microsoft rotates Forms internals monthly and
 * we lived one editor pivot already; separately, if the Ministry edits a
 * form question the substring-matching fill driver can silently mis-map an
 * answer onto the wrong statutory field. Nothing verified the live form
 * against the captured schema before filling — this module closes that.
 *
 * Two layers, both pure and unit-tested:
 *
 *  1. STORED FINGERPRINT (`computeLabelsFingerprint` / `verifyStoredFingerprint`)
 *     Each captured schema JSON carries { questionCount, orderedLabelsHash }.
 *     The fill drivers recompute it from the loaded schema at run time, and a
 *     unit guard recomputes it from the committed files — so any schema edit
 *     (recapture, hand-edit, merge damage) fails LOUDLY until the fingerprint
 *     is consciously re-stamped.
 *
 *  2. LIVE-FORM MATCH (`matchLiveQuestions`)
 *     Before any field is filled, the driver lists the rendered question
 *     items and verifies them against the schema. The check is strict ONLY
 *     on definitive drift evidence, because a false positive would brick the
 *     proven fill path:
 *       - a schema question that is not conditional (no showWhen / branch
 *         rule) MUST be present on the live form → missing = edited/removed
 *         question → FAIL;
 *       - matched questions MUST appear in schema order → order regression =
 *         reordered form → FAIL;
 *       - live items that match no schema label are COUNTED and logged by
 *         the caller but do not fail on their own: Microsoft Forms renders
 *         decorative list items and branch reveals we cannot enumerate
 *         without a live session (tighten after a live-lane run if the
 *         unmatched count proves stable at 0).
 *     Conditional (branch-hidden) questions are exempt from the presence
 *     demand — Forms only renders them once their controlling answer is set.
 *     An EMPTY live list is reported as a load-state problem, not form drift.
 *
 * Documented detection limits (adversarial review 2026-09-05, all verified
 * to degrade to loud fill errors rather than wrong-field writes):
 *   - labels shorter than MIN_DEMANDED_LABEL_CHARS ("Sex", "Class") are
 *     demanded via exact-line match instead of prefix match;
 *   - drift confined to characters beyond MATCH_PREFIX_CHARS (e.g. the five
 *     "Number of students enrolled in Standard N" labels differing at char
 *     41+) is not distinguishable at the gate — fillField's longer needles
 *     (80 chars) still prevent mis-mapping.
 */
import { createHash } from 'node:crypto';

export interface SchemaFingerprint {
  questionCount: number;
  orderedLabelsHash: string;
  algorithm: string;
}

export const FINGERPRINT_ALGORITHM = 'sha256/normalized-labels-v1';

/** Mirror of forms-driver's normalizeMatchText — keep in lockstep. */
export function normalizeLabel(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function computeLabelsFingerprint(labels: string[]): SchemaFingerprint {
  const normalized = labels.map(normalizeLabel);
  const hash = createHash('sha256').update(normalized.join('\n'), 'utf8').digest('hex');
  return {
    questionCount: labels.length,
    orderedLabelsHash: hash,
    algorithm: FINGERPRINT_ALGORITHM,
  };
}

export interface StoredFingerprintVerdict {
  ok: boolean;
  reason?: string;
}

/**
 * Verify a loaded schema against the fingerprint committed inside it.
 * A missing fingerprint fails too: the guard exists precisely so a schema
 * can never change shape silently.
 */
export function verifyStoredFingerprint(
  labels: string[],
  stored: Partial<SchemaFingerprint> | undefined,
  schemaName: string,
): StoredFingerprintVerdict {
  if (!stored || typeof stored.orderedLabelsHash !== 'string') {
    return {
      ok: false,
      reason:
        `${schemaName}: the captured form schema carries no fingerprint. ` +
        'After verifying the capture, re-stamp it with: pnpm exec tsx scripts/forms-stamp-fingerprint.ts',
    };
  }
  const actual = computeLabelsFingerprint(labels);
  if (
    actual.questionCount !== stored.questionCount ||
    actual.orderedLabelsHash !== stored.orderedLabelsHash
  ) {
    return {
      ok: false,
      reason:
        `${schemaName}: the captured form schema does not match its stored fingerprint ` +
        `(questions ${String(stored.questionCount)} → ${actual.questionCount}, ` +
        `hash ${String(stored.orderedLabelsHash).slice(0, 8)} → ${actual.orderedLabelsHash.slice(0, 8)}). ` +
        'The schema file changed without a fingerprint re-stamp — refusing to fill until it is verified ' +
        'and re-stamped (pnpm exec tsx scripts/forms-stamp-fingerprint.ts).',
    };
  }
  return { ok: true };
}

export interface LiveMatchResult {
  ok: boolean;
  reason?: string;
  /** Unconditional schema labels found on the live form. */
  matchedCount: number;
  /** How many unconditional labels were demanded. */
  demandedCount: number;
  /** Live items that matched no schema label (logged, not fatal — see header). */
  unmatchedLiveCount: number;
}

const MATCH_PREFIX_CHARS = 40;
const LIVE_TEXT_WINDOW_CHARS = 300;
const MIN_DEMANDED_LABEL_CHARS = 8;

function liveTextMatchesLabel(liveNormalized: string, labelNormalized: string): boolean {
  const needle = labelNormalized.slice(0, MATCH_PREFIX_CHARS);
  if (needle.length < 3) return false;
  return liveNormalized.slice(0, LIVE_TEXT_WINDOW_CHARS).includes(needle);
}

/**
 * Match the live form's rendered question texts against the schema labels.
 *
 * @param orderedLabels      every schema label, in fill order
 * @param unconditionalLabels the subset that must be visible on a fresh form
 *                            (no showWhen / branch-visibility rule, not
 *                            auto-recorded)
 * @param liveTexts          innerText of each rendered question item, in DOM
 *                            order
 */
export function matchLiveQuestions({
  orderedLabels,
  unconditionalLabels,
  liveTexts,
  formName,
}: {
  orderedLabels: string[];
  unconditionalLabels: string[];
  liveTexts: string[];
  formName: string;
}): LiveMatchResult {
  const labels = orderedLabels.map(normalizeLabel);
  const matchedLabelIndexes = new Set<number>();
  let cursor = 0;
  let unmatchedLiveCount = 0;
  let orderViolation: { liveText: string; labelIndex: number } | null = null;

  const nonEmptyLive = liveTexts.map(normalizeLabel).filter(Boolean);
  if (nonEmptyLive.length === 0) {
    return {
      ok: false,
      matchedCount: 0,
      demandedCount: unconditionalLabels.length,
      unmatchedLiveCount: 0,
      reason:
        `${formName}: the form page did not render any questions, so the fill cannot be verified. ` +
        'This is a page-load problem, not a form edit — re-open the form and try again.',
    };
  }

  // Live line sets for exact-match demands on short labels ("Sex", "Class")
  // whose prefixes are too ambiguous for includes-matching.
  const liveLines = new Set(
    liveTexts.flatMap((t) => t.split('\n').map(normalizeLabel)).filter(Boolean),
  );

  let previousLive = '';
  for (const rawLive of liveTexts) {
    const live = normalizeLabel(rawLive);
    if (!live) continue;
    // Skip consecutive duplicates: a nested rendering that double-reports a
    // question item must not steal a same-prefix sibling label and fake an
    // order violation.
    if (live === previousLive) continue;
    previousLive = live;
    // In-order greedy: prefer the first unused label at or after the cursor,
    // so duplicate/similar prefixes resolve to their in-order occurrence.
    let matchIndex = -1;
    for (let i = cursor; i < labels.length; i += 1) {
      if (!matchedLabelIndexes.has(i) && liveTextMatchesLabel(live, labels[i])) {
        matchIndex = i;
        break;
      }
    }
    if (matchIndex === -1) {
      // Backward search: a hit here means the form order regressed.
      for (let i = 0; i < cursor; i += 1) {
        if (!matchedLabelIndexes.has(i) && liveTextMatchesLabel(live, labels[i])) {
          orderViolation = orderViolation ?? { liveText: rawLive, labelIndex: i };
          matchIndex = i;
          break;
        }
      }
    }
    if (matchIndex === -1) {
      unmatchedLiveCount += 1;
      continue;
    }
    matchedLabelIndexes.add(matchIndex);
    cursor = Math.max(cursor, matchIndex + 1);
  }

  const normalizedUnconditional = unconditionalLabels
    .map(normalizeLabel)
    .filter((label, index, all) => label.length > 0 && all.indexOf(label) === index);
  const demanded = normalizedUnconditional.filter((l) => l.length >= MIN_DEMANDED_LABEL_CHARS);
  // Short labels are demanded too, via exact rendered-line equality.
  const demandedShort = normalizedUnconditional.filter((l) => l.length < MIN_DEMANDED_LABEL_CHARS);
  const demandedMissing = [
    ...demanded.filter((label) => ![...matchedLabelIndexes].some((i) => labels[i] === label)),
    ...demandedShort.filter((label) => !liveLines.has(label)),
  ];
  const demandedCount = demanded.length + demandedShort.length;
  const matchedCount = demandedCount - demandedMissing.length;

  if (demandedMissing.length > 0) {
    return {
      ok: false,
      matchedCount,
      demandedCount,
      unmatchedLiveCount,
      reason:
        `${formName}: the live Microsoft Form no longer matches the captured schema — ` +
        `${demandedMissing.length} expected question(s) not found, starting with ` +
        `"${demandedMissing[0].slice(0, 60)}". The form may have been edited. ` +
        'Refusing to fill; verify the form and recapture the schema before retrying.',
    };
  }
  if (orderViolation) {
    return {
      ok: false,
      matchedCount,
      demandedCount,
      unmatchedLiveCount,
      reason:
        `${formName}: the live Microsoft Form's questions are in a different order than the captured schema ` +
        `(question "${normalizeLabel(orderViolation.liveText).slice(0, 60)}" appeared out of sequence). ` +
        'The form may have been edited. Refusing to fill; verify the form and recapture the schema before retrying.',
    };
  }
  return { ok: true, matchedCount, demandedCount, unmatchedLiveCount };
}
