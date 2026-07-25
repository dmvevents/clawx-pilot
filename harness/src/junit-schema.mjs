// harness/src/junit-schema.mjs — JUnit report schema loader + runtime gate.
//
// The harness previously wrote JUnit XML by string-concatenating fields.
// Any regression that fed a missing name, a non-numeric duration, or an
// unknown status enum into that pipeline would produce XML that a
// downstream JUnit parser would silently accept (or half-accept) — which
// is exactly the class of drift PR #16 is closing.
//
// This module owns:
//   1. Loading the JSON Schema at harness/schemas/junit-report.schema.json
//   2. Compiling it with Ajv into a strict validator
//   3. Exposing validateReport(report) which throws on the first mismatch
//   4. Rendering the validated report to JUnit XML
//
// harness/run.ts builds the canonical `report` object, runs it through
// validateReport(), and only then renders to XML. Any fixture producing
// a malformed row aborts the run before the file lands on disk.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv from 'ajv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCHEMA_PATH = path.resolve(
  __dirname,
  '..',
  'schemas',
  'junit-report.schema.json',
);

let cachedValidator = null;
let cachedSchema = null;

export function loadSchema() {
  if (cachedSchema) return cachedSchema;
  cachedSchema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
  return cachedSchema;
}

function getValidator() {
  if (cachedValidator) return cachedValidator;
  const schema = loadSchema();
  const ajv = new Ajv({ allErrors: true, strict: false });
  cachedValidator = ajv.compile(schema);
  return cachedValidator;
}

/**
 * Validate a canonical JUnit report object against the schema.
 * Throws Error with a human-readable message on the first violation.
 * Returns the same object on success (chainable).
 */
export function validateReport(report) {
  const validate = getValidator();
  const ok = validate(report);
  if (!ok) {
    const first = (validate.errors ?? [])[0];
    // Ajv 6 → dataPath; Ajv 7+/8 → instancePath. Support both.
    const location =
      first?.instancePath || first?.dataPath || '(root)';
    const keyword = first?.keyword ?? 'unknown';
    const msg = first?.message ?? 'invalid';
    const params = first?.params ? ` ${JSON.stringify(first.params)}` : '';
    throw new Error(
      `junit-report-schema: ${location} ${keyword} ${msg}${params}`,
    );
  }
  return report;
}

function escapeXml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/**
 * Render a validated report to JUnit XML. Callers should validate first;
 * this function does not re-validate to keep the schema gate a single
 * choke-point in harness/run.ts.
 */
export function renderJUnitXml(report) {
  const suite = report.testsuites[0];
  const cases = suite.testcases
    .map((tc) => {
      const attrs = `name="${escapeXml(tc.name)}" classname="${escapeXml(tc.classname)}" time="${tc.time.toFixed(3)}"`;
      if (tc.status === 'pass') return `    <testcase ${attrs}/>`;
      if (tc.status === 'skip') {
        return `    <testcase ${attrs}><skipped message="${escapeXml(tc.reason ?? '')}"/></testcase>`;
      }
      return `    <testcase ${attrs}><failure message="${escapeXml(tc.reason ?? '')}"><![CDATA[${tc.detail ?? ''}]]></failure></testcase>`;
    })
    .join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites tests="${suite.tests}" failures="${suite.failures}" skipped="${suite.skipped}">`,
    `  <testsuite name="${escapeXml(suite.name)}" tests="${suite.tests}" failures="${suite.failures}" skipped="${suite.skipped}">`,
    cases,
    '  </testsuite>',
    '</testsuites>',
    '',
  ].join('\n');
}
