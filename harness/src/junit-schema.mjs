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

// Attachments contract. Kept next to validateReport so tests importing
// TRUNCATION_MARKER stay in lockstep with the runner and the schema.
export const STDOUT_TAIL_MAX_BYTES = 10 * 1024;
export const TRUNCATION_MARKER = '\n[...TRUNCATED >10KB]\n';

/**
 * Validate a canonical JUnit report object against the schema, plus the
 * cross-field invariants JSON Schema Draft-07 can't express directly:
 *   - stdout_tail must be ≤ 10KB
 *   - stdout_truncated=true iff the tail ends with TRUNCATION_MARKER
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
  // Runtime invariants over the attachments block.
  for (let s = 0; s < report.testsuites.length; s++) {
    const suite = report.testsuites[s];
    for (let t = 0; t < suite.testcases.length; t++) {
      const tc = suite.testcases[t];
      const at = tc.attachments;
      const where = `/testsuites/${s}/testcases/${t}/attachments`;
      const tailBytes = Buffer.byteLength(at.stdout_tail, 'utf8');
      if (tailBytes > STDOUT_TAIL_MAX_BYTES) {
        throw new Error(
          `junit-report-schema: ${where}/stdout_tail exceeds ${STDOUT_TAIL_MAX_BYTES} bytes (got ${tailBytes})`,
        );
      }
      if (at.stdout_truncated && !at.stdout_tail.endsWith(TRUNCATION_MARKER)) {
        throw new Error(
          `junit-report-schema: ${where}/stdout_tail truncated but missing TRUNCATION_MARKER`,
        );
      }
      if (!at.stdout_truncated && at.stdout_tail.endsWith(TRUNCATION_MARKER)) {
        throw new Error(
          `junit-report-schema: ${where}/stdout_truncated is false but stdout_tail carries TRUNCATION_MARKER`,
        );
      }
    }
  }
  return report;
}

/**
 * Convenience helper for the runner: shorten a raw stdout string to the
 * 10KB tail budget, appending TRUNCATION_MARKER when it had to. Returns
 * { stdout_tail, stdout_truncated } which slot directly into the
 * attachments block.
 */
export function truncateStdout(raw) {
  const s = String(raw ?? '');
  const rawBytes = Buffer.byteLength(s, 'utf8');
  if (rawBytes <= STDOUT_TAIL_MAX_BYTES) {
    return { stdout_tail: s, stdout_truncated: false };
  }
  // Keep the tail (most recent output), leaving room for the marker.
  const marker = TRUNCATION_MARKER;
  const markerBytes = Buffer.byteLength(marker, 'utf8');
  const budget = STDOUT_TAIL_MAX_BYTES - markerBytes;
  // Byte-slice from the end. Buffer avoids splitting multibyte chars in
  // the middle; we recover valid UTF-8 by shrinking the window one byte
  // at a time until it decodes cleanly.
  const buf = Buffer.from(s, 'utf8');
  let start = buf.length - budget;
  if (start < 0) start = 0;
  let tail = buf.slice(start).toString('utf8');
  // Node replaces bad byte sequences with U+FFFD; strip a leading one so
  // the tail begins on a valid char boundary.
  if (tail.startsWith('�')) tail = tail.slice(1);
  return { stdout_tail: tail + marker, stdout_truncated: true };
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
/**
 * Render a validated report to JUnit XML.
 *
 * @param {object} report        canonical, schema-valid report
 * @param {object} [opts]
 * @param {(tc: object) => {category: string} | null | undefined} [opts.classify]
 *   optional per-testcase classifier. When supplied, each failed
 *   testcase gets a `<properties><property name="failure_category"
 *   value="…"/></properties>` block emitted before its `<failure>`
 *   element, so downstream dashboards can group failures by category
 *   without re-parsing stdout.
 */
export function renderJUnitXml(report, opts = {}) {
  const classify = typeof opts.classify === 'function' ? opts.classify : null;
  const suite = report.testsuites[0];
  const cases = suite.testcases
    .map((tc) => {
      const attrs = `name="${escapeXml(tc.name)}" classname="${escapeXml(tc.classname)}" time="${tc.time.toFixed(3)}"`;
      const at = tc.attachments;
      // Standard Jenkins/Allure attachment convention embedded in
      // <system-out>. `[[ATTACHMENT|<path>]]` is picked up by the
      // downstream JUnit consumer; the stdout tail follows it.
      const attachLines = [];
      if (at.screenshot) {
        attachLines.push(`[[ATTACHMENT|${at.screenshot}]]`);
      }
      if (at.stdout_tail) attachLines.push(at.stdout_tail);
      const systemOut = attachLines.length
        ? `<system-out><![CDATA[${attachLines.join('\n')}]]></system-out>`
        : '';
      let propsBlock = '';
      if (tc.status === 'fail' && classify) {
        try {
          const c = classify(tc);
          if (c && typeof c.category === 'string') {
            propsBlock = `<properties><property name="failure_category" value="${escapeXml(c.category)}"/></properties>`;
          }
        } catch {
          // Never let classifier bugs break XML emission.
        }
      }
      if (tc.status === 'pass') {
        return systemOut
          ? `    <testcase ${attrs}>${systemOut}</testcase>`
          : `    <testcase ${attrs}/>`;
      }
      if (tc.status === 'skip') {
        return `    <testcase ${attrs}><skipped message="${escapeXml(tc.reason ?? '')}"/>${systemOut}</testcase>`;
      }
      return `    <testcase ${attrs}>${propsBlock}<failure message="${escapeXml(tc.reason ?? '')}"><![CDATA[${tc.detail ?? ''}]]></failure>${systemOut}</testcase>`;
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
