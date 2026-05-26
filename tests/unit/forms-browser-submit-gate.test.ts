// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  formatFormsDateInput,
  matchesExpectedQuestionFingerprint,
} from '../../electron/services/forms-browser-v2/forms-driver';

describe('forms-browser-v2 submit gate fingerprint', () => {
  const labels = [
    'Education District',
    'School Type',
    'Name of primary school',
    'Name of perpetrator',
    'Student birth certificate PIN',
    'Date of issue of suspension',
  ];

  it('accepts the suspensions form question fingerprint when the response title is generic', () => {
    const text = [
      '1. Education District Caroni North Eastern Port of Spain',
      '2. School Type Denominational Government',
      '3. Name of primary school Aranguez GPS',
      '4. Name of perpetrator',
      '8. Student birth certificate PIN',
      '11. Date of issue of suspension',
    ].join('\n');

    expect(matchesExpectedQuestionFingerprint(text, labels)).toEqual({
      ok: true,
      matched: 6,
      required: 4,
    });
  });

  it('refuses unrelated forms that do not match enough expected questions', () => {
    const text = [
      '1. Staff name',
      '2. Department',
      '3. Lunch preference',
      '4. Emergency contact',
    ].join('\n');

    expect(matchesExpectedQuestionFingerprint(text, labels)).toEqual({
      ok: false,
      matched: 0,
      required: 4,
    });
  });
});

describe('forms-browser-v2 date formatting', () => {
  it('converts ISO dates into the locale format Microsoft Forms accepts in Chrome', () => {
    expect(formatFormsDateInput('2026-05-26')).toBe('5/26/2026');
  });

  it('leaves already-formatted dates unchanged', () => {
    expect(formatFormsDateInput('5/26/2026')).toBe('5/26/2026');
  });
});
