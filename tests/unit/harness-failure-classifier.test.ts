// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { classifyFailure } from '../../harness/failure_classifier';

function base() {
  return {
    name: 'P1-example',
    classname: 'clawx.harness.doc-tooling-e2e',
    time: 0.123,
    timeout_ms: 30000,
    status: 'fail' as const,
    reason: '',
    detail: '',
    attachments: {
      screenshot: '/tmp/clawx/P1-example.png',
      stdout_tail: 'nominal output',
      stdout_truncated: false,
    },
  };
}

describe('harness/failure_classifier — classifyFailure()', () => {
  // Category 1 — timeout (status vocabulary)
  it('classifies status="timeout" as timeout with high confidence', () => {
    const tc = { ...base(), status: 'timeout' };
    const r = classifyFailure(tc);
    expect(r.category).toBe('timeout');
    expect(r.confidence).toBeGreaterThan(0.9);
    expect(r.evidence).toMatch(/status=timeout/);
  });

  // Category 1 — timeout (time exceeds timeout_ms)
  it('classifies time > timeout_ms as timeout', () => {
    const tc = { ...base(), status: 'fail', time: 35, timeout_ms: 30000 };
    const r = classifyFailure(tc);
    expect(r.category).toBe('timeout');
    expect(r.evidence).toMatch(/exceeds timeout_ms/);
  });

  // Category 2 — assertion
  it('classifies stdout_tail carrying AssertionError as assertion', () => {
    const tc = base();
    tc.attachments.stdout_tail =
      'Running P1...\nAssertionError: expected 5 to equal 6\n';
    const r = classifyFailure(tc);
    expect(r.category).toBe('assertion');
    expect(r.confidence).toBeGreaterThan(0.9);
    expect(r.evidence).toMatch(/AssertionError/);
  });

  // Category 3 — missing_output (failed status + empty screenshot)
  it('classifies failed status with empty screenshot as missing_output', () => {
    const tc = base();
    tc.attachments.screenshot = '';
    const r = classifyFailure(tc);
    expect(r.category).toBe('missing_output');
    expect(r.evidence).toMatch(/screenshot is empty/);
  });

  // Category 4 — schema_violation
  it('classifies runtime schema-gate messages as schema_violation', () => {
    const tc = base();
    tc.reason =
      'junit-report-schema: /testsuites/0/testcases/0/attachments required';
    const r = classifyFailure(tc);
    expect(r.category).toBe('schema_violation');
    expect(r.confidence).toBeGreaterThan(0.9);
  });

  // Category 5 — unknown (failed but nothing matches)
  it('classifies a failure that matches no rule as unknown', () => {
    const tc = base();
    // stdout_tail nominal (no assertion); screenshot present (not missing);
    // reason/detail carry no schema marker; time under timeout — no rule
    // fires, so we fall through to unknown.
    const r = classifyFailure(tc);
    expect(r.category).toBe('unknown');
    expect(r.confidence).toBe(0);
  });

  // Edge case 1 — completely empty object
  it('degrades gracefully on an empty testcase object', () => {
    const r = classifyFailure({});
    expect(r.category).toBe('unknown');
    expect(r.confidence).toBe(0);
    expect(r.evidence).toMatch(/not in a failure state/);
  });

  // Edge case 2 — malformed input (null / string / number)
  it('never throws on malformed input; returns unknown with evidence', () => {
    for (const bad of [null, 'a string', 42, undefined]) {
      const r = classifyFailure(bad);
      expect(r.category).toBe('unknown');
      expect(r.confidence).toBe(0);
      expect(typeof r.evidence).toBe('string');
    }
  });
});
