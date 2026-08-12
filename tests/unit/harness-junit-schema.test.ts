// @vitest-environment node
import { describe, expect, it } from 'vitest';

// @ts-expect-error — .mjs sibling with no bundled .d.ts
import {
  loadSchema,
  renderJUnitXml,
  STDOUT_TAIL_MAX_BYTES,
  TRUNCATION_MARKER,
  truncateStdout,
  validateReport,
} from '../../harness/src/junit-schema.mjs';

// Base fixture — a schema-valid single-suite report. Each negative test
// starts from a clone and violates exactly one invariant so the failure
// message is unambiguous.
function baseReport() {
  return {
    testsuites: [
      {
        name: 'clawx.harness.doc-tooling-e2e',
        tests: 1,
        failures: 0,
        skipped: 0,
        testcases: [
          {
            name: 'P1-docx-summarize',
            classname: 'clawx.harness.doc-tooling-e2e',
            time: 0.123,
            status: 'pass' as const,
            attachments: {
              screenshot: '/tmp/clawx/P1-docx-summarize.png',
              stdout_tail: '[PASS] P1-docx-summarize\nok',
              stdout_truncated: false,
            },
          },
        ],
      },
    ],
  };
}

describe('harness/schemas/junit-report.schema.json — schema gate', () => {
  it('accepts a schema-valid report and renders XML', () => {
    const report = validateReport(baseReport());
    const xml = renderJUnitXml(report);
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('name="P1-docx-summarize"');
    expect(xml).toContain('time="0.123"');
  });

  it('exposes the schema on disk with the expected top-level shape', () => {
    const schema = loadSchema();
    expect(schema.$id).toBe('https://clawx.local/schemas/junit-report.json');
    expect(schema.type).toBe('object');
    expect(schema.required).toContain('testsuites');
    expect(schema.definitions.testcase.required).toEqual(
      expect.arrayContaining(['name', 'classname', 'time', 'status']),
    );
    expect(schema.definitions.testcase.properties.status.enum).toEqual([
      'pass',
      'fail',
      'skip',
    ]);
  });

  // ── Negative-path #1: missing testcase name ──────────────────────────
  it('rejects a testcase with a missing name', () => {
    const report = baseReport();
    // @ts-expect-error — intentionally deleting a required field
    delete report.testsuites[0].testcases[0].name;
    expect(() => validateReport(report)).toThrow(/junit-report-schema/);
    expect(() => validateReport(report)).toThrow(/name/);
  });

  // ── Negative-path #2: non-numeric time attribute ─────────────────────
  it('rejects a testcase with a non-numeric time attribute', () => {
    const report = baseReport();
    // @ts-expect-error — writing a string where a number is required
    report.testsuites[0].testcases[0].time = '0.5s';
    expect(() => validateReport(report)).toThrow(/junit-report-schema/);
    expect(() => validateReport(report)).toThrow(/time/);
  });

  // ── Negative-path #3: unknown status enum ────────────────────────────
  it('rejects a testcase with an unknown status enum value', () => {
    const report = baseReport();
    // @ts-expect-error — 'flaky' is not in the closed enum {pass, fail, skip}
    report.testsuites[0].testcases[0].status = 'flaky';
    expect(() => validateReport(report)).toThrow(/junit-report-schema/);
    expect(() => validateReport(report)).toThrow(/enum|status/);
  });

  // ── Attachments-block negative-path #A: missing attachments ─────────
  it('rejects a testcase with the attachments block missing', () => {
    const report = baseReport();
    // @ts-expect-error — intentionally deleting a required field
    delete report.testsuites[0].testcases[0].attachments;
    expect(() => validateReport(report)).toThrow(/junit-report-schema/);
    expect(() => validateReport(report)).toThrow(/attachments/);
  });

  // ── Attachments-block negative-path #B: malformed screenshot path ───
  it('rejects a testcase whose attachments.screenshot is not a .png path', () => {
    const report = baseReport();
    // A .jpg path violates the ^(|.*\.[Pp][Nn][Gg])$ pattern; only .png
    // (or empty string for "no screenshot") is accepted.
    report.testsuites[0].testcases[0].attachments.screenshot =
      '/tmp/clawx/P1-docx-summarize.jpg';
    expect(() => validateReport(report)).toThrow(/junit-report-schema/);
    expect(() => validateReport(report)).toThrow(/pattern|screenshot/);
  });

  // ── Attachments-block negative-path #C: >10KB stdout without marker ─
  it('rejects a testcase whose stdout was truncated but is missing the >10KB marker', () => {
    const report = baseReport();
    // Simulate a runner that shortened stdout to fit but forgot the
    // TRUNCATION_MARKER — this is the drift the invariant catches.
    report.testsuites[0].testcases[0].attachments.stdout_tail =
      'a'.repeat(STDOUT_TAIL_MAX_BYTES - 10);
    report.testsuites[0].testcases[0].attachments.stdout_truncated = true;
    expect(() => validateReport(report)).toThrow(/junit-report-schema/);
    expect(() => validateReport(report)).toThrow(/TRUNCATION_MARKER/);
  });

  it('truncateStdout produces a schema-valid tail carrying the marker', () => {
    const big = 'x'.repeat(20 * 1024);
    const { stdout_tail, stdout_truncated } = truncateStdout(big);
    expect(stdout_truncated).toBe(true);
    expect(stdout_tail.endsWith(TRUNCATION_MARKER)).toBe(true);
    expect(Buffer.byteLength(stdout_tail, 'utf8')).toBeLessThanOrEqual(
      STDOUT_TAIL_MAX_BYTES,
    );

    const report = baseReport();
    report.testsuites[0].testcases[0].attachments.stdout_tail = stdout_tail;
    report.testsuites[0].testcases[0].attachments.stdout_truncated = true;
    expect(() => validateReport(report)).not.toThrow();
  });
});
