// @vitest-environment node
import { describe, expect, it } from 'vitest';

// @ts-expect-error — .mjs sibling with no bundled .d.ts
import {
  loadSchema,
  renderJUnitXml,
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
});
