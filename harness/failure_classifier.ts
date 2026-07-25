// harness/failure_classifier.ts
//
// Classifies a single testcase (as it appears in the canonical JUnit
// report built by harness/run.ts::buildReport) into one of five
// diagnostic categories, alongside a confidence in [0,1] and a short
// evidence string. The classifier is deterministic, side-effect free,
// and rule-ordered — the first rule that matches wins.
//
// Rules (checked top-to-bottom):
//   1. status is a timeout signal, OR time > timeout_ms  -> timeout
//   2. stdout_tail contains an assertion signature       -> assertion
//   3. screenshot is empty AND status is a failure       -> missing_output
//   4. reason/detail carry the runtime schema-gate       -> schema_violation
//   5. otherwise                                         -> unknown
//
// The input is intentionally loose — real testcases come from
// buildReport(), but callers (dashboards, ad-hoc scripts) may hand in
// partial or malformed rows. We accept any object and degrade to
// {category: "unknown", confidence: 0, evidence: "..."} rather than
// throw, so classification can't itself break a report pipeline.

export type FailureCategory =
  | 'timeout'
  | 'assertion'
  | 'missing_output'
  | 'schema_violation'
  | 'unknown';

export interface Classification {
  category: FailureCategory;
  confidence: number;
  evidence: string;
}

interface TestcaseLike {
  name?: unknown;
  status?: unknown;
  time?: unknown;
  timeout_ms?: unknown;
  reason?: unknown;
  detail?: unknown;
  attachments?: {
    screenshot?: unknown;
    stdout_tail?: unknown;
    stdout_truncated?: unknown;
  };
}

// Failure statuses across the two vocabularies the pipeline uses:
// buildReport() emits 'fail'; upstream Prompt/RunResult uses 'FAIL';
// callers occasionally hand us 'failed' or 'error'. Treat all as failure.
const FAIL_STATUSES = new Set([
  'fail',
  'failed',
  'FAIL',
  'error',
  'ERROR',
]);
const TIMEOUT_STATUSES = new Set(['timeout', 'TIMEOUT', 'timed_out']);

function isFailureStatus(s: unknown): boolean {
  return typeof s === 'string' && FAIL_STATUSES.has(s);
}

function isTimeoutStatus(s: unknown): boolean {
  return typeof s === 'string' && TIMEOUT_STATUSES.has(s);
}

const ASSERTION_PATTERNS: RegExp[] = [
  /AssertionError/,
  /\bexpected\b/i,
  /\bassert\s/i,
];

export function classifyFailure(testcase: unknown): Classification {
  if (testcase === null || typeof testcase !== 'object') {
    return {
      category: 'unknown',
      confidence: 0,
      evidence: 'classifier: input is not an object',
    };
  }
  const tc = testcase as TestcaseLike;

  // Rule 1 — timeout
  const status = tc.status;
  const time = typeof tc.time === 'number' ? tc.time : Number.NaN;
  const timeoutMs = typeof tc.timeout_ms === 'number' ? tc.timeout_ms : Number.NaN;
  if (isTimeoutStatus(status)) {
    return {
      category: 'timeout',
      confidence: 0.99,
      evidence: `status=${String(status)}`,
    };
  }
  // time is seconds (JUnit convention); timeout_ms is ms. Compare in ms.
  if (Number.isFinite(time) && Number.isFinite(timeoutMs) && time * 1000 > timeoutMs) {
    return {
      category: 'timeout',
      confidence: 0.9,
      evidence: `time=${time.toFixed(3)}s exceeds timeout_ms=${timeoutMs}`,
    };
  }

  // Everything below applies only to failure-shaped rows.
  const failing = isFailureStatus(status);

  // Rule 2 — assertion (stdout_tail carries assertion signature)
  const stdoutTail =
    typeof tc.attachments?.stdout_tail === 'string' ? tc.attachments.stdout_tail : '';
  for (const rx of ASSERTION_PATTERNS) {
    const m = rx.exec(stdoutTail);
    if (m) {
      return {
        category: 'assertion',
        confidence: failing ? 0.95 : 0.6,
        evidence: `stdout_tail matches /${rx.source}/ at "${stdoutTail.slice(Math.max(0, m.index - 10), m.index + 40)}"`,
      };
    }
  }

  // Rule 3 — missing_output (failed status but no screenshot captured)
  if (failing) {
    const screenshot =
      typeof tc.attachments?.screenshot === 'string' ? tc.attachments.screenshot : '';
    if (screenshot.length === 0) {
      return {
        category: 'missing_output',
        confidence: 0.85,
        evidence: 'attachments.screenshot is empty on a failed testcase',
      };
    }
  }

  // Rule 4 — schema_violation (runtime-layer message surfaces in reason/detail)
  const reason = typeof tc.reason === 'string' ? tc.reason : '';
  const detail = typeof tc.detail === 'string' ? tc.detail : '';
  const schemaHit = /junit-report-schema:|schema:\s/.exec(reason + '\n' + detail);
  if (schemaHit) {
    return {
      category: 'schema_violation',
      confidence: 0.95,
      evidence: `reason/detail carries runtime schema-gate marker: "${schemaHit[0]}"`,
    };
  }

  // Rule 5 — unknown
  return {
    category: 'unknown',
    confidence: 0,
    evidence: failing
      ? 'failure did not match timeout/assertion/missing_output/schema_violation'
      : 'testcase is not in a failure state',
  };
}
