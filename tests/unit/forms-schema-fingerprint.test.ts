// @vitest-environment node
/**
 * CLWX-64 — forms schema-drift detector.
 *
 * Layers: pure fingerprint module; committed-schema re-stamp guards (a
 * schema edit without a fingerprint bump fails here LOUDLY); live-match
 * matrix; actions-level integration (drift → loud refusal BEFORE any
 * fillField call, on both drivers); selector-fallback pins.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  FINGERPRINT_ALGORITHM,
  computeLabelsFingerprint,
  matchLiveQuestions,
  normalizeLabel,
  verifyStoredFingerprint,
} from '@electron/services/forms-browser-v2/schema-fingerprint';
import { SuspensionsActions, type SuspensionsPayload } from '@electron/services/forms-browser-v2/suspensions-actions';
import { DailyReportActions } from '@electron/services/forms-browser-v2/daily-report-actions';
import type { FormsDriver } from '@electron/services/forms-browser-v2/forms-driver';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SUS_SCHEMA_PATH = path.join(REPO_ROOT, 'extensions/moe-principal-assistant/forms/suspensions-schema.json');
const DR_SCHEMA_PATH = path.join(REPO_ROOT, 'extensions/moe-principal-assistant/forms/daily-report-schema.vlm.json');

interface SchemaField {
  id: string;
  label: string;
  showWhen?: Record<string, string>;
}

function loadSuspensionsSchema() {
  const schema = JSON.parse(readFileSync(SUS_SCHEMA_PATH, 'utf8')) as {
    sections: Array<{ fields: SchemaField[] }>;
    fingerprint?: { questionCount: number; orderedLabelsHash: string };
  };
  return { schema, fields: schema.sections.flatMap((s) => s.fields) };
}

function loadDailyReportSchema() {
  const schema = JSON.parse(readFileSync(DR_SCHEMA_PATH, 'utf8')) as {
    fields: SchemaField[];
    fingerprint?: { questionCount: number; orderedLabelsHash: string };
  };
  return { schema, fields: schema.fields };
}

/** Simulate Microsoft Forms question-item innerText: numbering + noise. */
function asLiveTexts(labels: string[]): string[] {
  return labels.map((label, i) => `${i + 1}\n${label}\n*\nEnter your answer`);
}

function makeStubDriver(liveTexts: string[]) {
  const fillField = vi.fn(async () => ({ ok: true }));
  const inspectField = vi.fn(async () => ({ visible: false, hasValue: false, required: false, text: '' }));
  const listQuestionItemTexts = vi.fn(async () => liveTexts);
  const driver = { fillField, inspectField, listQuestionItemTexts } as unknown as FormsDriver;
  return { driver, fillField, listQuestionItemTexts };
}

describe('fingerprint module (pure)', () => {
  it('is deterministic and whitespace/case-insensitive', () => {
    const a = computeLabelsFingerprint(['Education District', 'School  Type ']);
    const b = computeLabelsFingerprint(['education district', 'school type']);
    expect(a.orderedLabelsHash).toBe(b.orderedLabelsHash);
    expect(a.questionCount).toBe(2);
    expect(a.algorithm).toBe(FINGERPRINT_ALGORITHM);
  });

  it('is order-sensitive', () => {
    const a = computeLabelsFingerprint(['One question here', 'Two question here']);
    const b = computeLabelsFingerprint(['Two question here', 'One question here']);
    expect(a.orderedLabelsHash).not.toBe(b.orderedLabelsHash);
  });

  it('verifyStoredFingerprint: missing fingerprint refuses', () => {
    const verdict = verifyStoredFingerprint(['A label long enough'], undefined, 'Test schema');
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain('no fingerprint');
  });

  it('verifyStoredFingerprint: drifted labels refuse with a readable reason', () => {
    const stored = computeLabelsFingerprint(['Original question label']);
    const verdict = verifyStoredFingerprint(['Edited question label'], stored, 'Test schema');
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain('does not match its stored fingerprint');
    expect(verdict.reason).toContain('re-stamp');
  });
});

describe('committed schema fingerprints (re-stamp discipline)', () => {
  it('suspensions-schema.json matches its stored fingerprint', () => {
    const { schema, fields } = loadSuspensionsSchema();
    const verdict = verifyStoredFingerprint(
      fields.map((f) => f.label),
      schema.fingerprint,
      'Suspensions schema',
    );
    expect(verdict.ok, verdict.reason).toBe(true);
    expect(schema.fingerprint?.questionCount).toBe(33);
  });

  it('daily-report-schema.vlm.json matches its stored fingerprint', () => {
    const { schema, fields } = loadDailyReportSchema();
    const verdict = verifyStoredFingerprint(
      fields.map((f) => f.label),
      schema.fingerprint,
      'Daily Report schema',
    );
    expect(verdict.ok, verdict.reason).toBe(true);
    expect(schema.fingerprint?.questionCount).toBe(57);
  });
});

describe('matchLiveQuestions matrix', () => {
  const LABELS = [
    'Education District selection',
    'Name of primary school attended',
    'Date of the reported infraction',
    'Was a victim involved in this incident',
  ];

  it('accepts a live form with numbering/asterisk noise', () => {
    const result = matchLiveQuestions({
      orderedLabels: LABELS,
      unconditionalLabels: LABELS.slice(0, 3),
      liveTexts: asLiveTexts(LABELS),
      formName: 'Test form',
    });
    expect(result.ok, result.reason).toBe(true);
    expect(result.matchedCount).toBe(3);
    expect(result.unmatchedLiveCount).toBe(0);
  });

  it('fails LOUDLY when an unconditional question is missing (edited/removed)', () => {
    const live = asLiveTexts(LABELS.filter((l) => !l.startsWith('Name of primary')));
    const result = matchLiveQuestions({
      orderedLabels: LABELS,
      unconditionalLabels: LABELS.slice(0, 3),
      liveTexts: live,
      formName: 'Test form',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('name of primary school');
    expect(result.reason).toContain('Refusing to fill');
  });

  it('fails LOUDLY on reordered questions', () => {
    const reordered = [LABELS[1], LABELS[0], LABELS[2], LABELS[3]];
    const result = matchLiveQuestions({
      orderedLabels: LABELS,
      unconditionalLabels: LABELS.slice(0, 3),
      liveTexts: asLiveTexts(reordered),
      formName: 'Test form',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('different order');
  });

  it('tolerates branch-hidden conditional questions being absent', () => {
    const live = asLiveTexts(LABELS.slice(0, 3)); // 4th (conditional) hidden
    const result = matchLiveQuestions({
      orderedLabels: LABELS,
      unconditionalLabels: LABELS.slice(0, 3),
      liveTexts: live,
      formName: 'Test form',
    });
    expect(result.ok, result.reason).toBe(true);
  });

  it('counts unknown live items without failing (see module header for why)', () => {
    const live = [...asLiveTexts(LABELS), '99\nA brand new question we never captured\nEnter your answer'];
    const result = matchLiveQuestions({
      orderedLabels: LABELS,
      unconditionalLabels: LABELS.slice(0, 3),
      liveTexts: live,
      formName: 'Test form',
    });
    expect(result.ok, result.reason).toBe(true);
    expect(result.unmatchedLiveCount).toBe(1);
  });

  it('resolves duplicate/similar prefixes in order', () => {
    const dupes = [
      'Number of students absent in First Year',
      'Number of students absent in Second Year',
    ];
    const result = matchLiveQuestions({
      orderedLabels: dupes,
      unconditionalLabels: dupes,
      liveTexts: asLiveTexts(dupes),
      formName: 'Test form',
    });
    expect(result.ok, result.reason).toBe(true);
    expect(result.matchedCount).toBe(2);
  });

  it('reports an EMPTY live list as a page-load problem, not a form edit (review MINOR)', () => {
    const result = matchLiveQuestions({
      orderedLabels: LABELS,
      unconditionalLabels: LABELS.slice(0, 3),
      liveTexts: [],
      formName: 'Test form',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('page-load problem');
    expect(result.reason).not.toContain('may have been edited');
  });

  it('demands short labels (Sex/Class class) via exact line match (review MINOR)', () => {
    const withShort = [...LABELS.slice(0, 2), 'Sex'];
    const goodLive = [...asLiveTexts(LABELS.slice(0, 2)), '3\nSex\nMale Female'];
    const good = matchLiveQuestions({
      orderedLabels: withShort,
      unconditionalLabels: withShort,
      liveTexts: goodLive,
      formName: 'Test form',
    });
    expect(good.ok, good.reason).toBe(true);

    const editedLive = [...asLiveTexts(LABELS.slice(0, 2)), '3\nGender\nMale Female'];
    const edited = matchLiveQuestions({
      orderedLabels: withShort,
      unconditionalLabels: withShort,
      liveTexts: editedLive,
      formName: 'Test form',
    });
    expect(edited.ok).toBe(false);
    expect(edited.reason).toContain('sex');
  });

  it('tolerates consecutive duplicate live items (nested-render class, review NIT)', () => {
    const doubled = asLiveTexts(LABELS).flatMap((t) => [t, t]);
    const result = matchLiveQuestions({
      orderedLabels: LABELS,
      unconditionalLabels: LABELS.slice(0, 3),
      liveTexts: doubled,
      formName: 'Test form',
    });
    expect(result.ok, result.reason).toBe(true);
  });
});

/** Mirror of DAILY_REPORT_CONDITIONAL_VISIBILITY's keys (branch-hidden on a fresh form). */
const DR_BRANCH_HIDDEN = new Set([
  'reason_no_school', 'received_nsdsl_breakfasts', 'breakfasts_delivered',
  'breakfasts_left_after_distribution', 'breakfast_portion_size_rating',
  'children_satisfied_with_breakfast', 'students_fell_ill_after_nsdsl_breakfast',
  'received_nsdsl_lunches', 'lunches_delivered', 'lunches_left_after_distribution',
  'lunch_portion_size_rating', 'children_satisfied_with_lunch',
  'students_fell_ill_after_nsdsl_lunch', 'number_of_students_suspended',
  'suspension_recorded_on_form', 'ptsc_approved_routes_count',
  'ptsc_morning_trips_count', 'students_absent_entire_term',
  'total_students_absent_entire_term', 'first_year_students_absent_entire_term',
  'second_year_students_absent_entire_term', 'standard_1_students_absent_entire_term',
  'standard_2_students_absent_entire_term', 'standard_3_students_absent_entire_term',
  'standard_4_students_absent_entire_term', 'standard_5_students_absent_entire_term',
]);

describe('actions integration — drift refuses before any fill (CLWX-64 acceptance 1+3)', () => {
  it('SuspensionsActions.fill refuses on a drifted live form and never calls fillField', async () => {
    const { fields } = loadSuspensionsSchema();
    const nonAuto = fields.filter((f) => f.id !== 'respondent_name');
    const unconditionalLabels = nonAuto.filter((f) => !f.showWhen).map((f) => f.label);
    // Drop one unconditional question — the Ministry "edited" the form.
    const drifted = asLiveTexts(unconditionalLabels.slice(1));
    const { driver, fillField } = makeStubDriver(drifted);

    const actions = new SuspensionsActions(driver);
    const result = await actions.fill({} as unknown as SuspensionsPayload);

    expect(result.status).toBe('error');
    expect(result.errors[0]?.fieldId).toBe('__form_structure__');
    expect(result.errors[0]?.reason).toContain('no longer matches the captured schema');
    expect(fillField).not.toHaveBeenCalled();
  });

  it('SuspensionsActions.fill proceeds past the gate when the live form matches', async () => {
    const { fields } = loadSuspensionsSchema();
    const nonAuto = fields.filter((f) => f.id !== 'respondent_name');
    const { driver, fillField, listQuestionItemTexts } = makeStubDriver(asLiveTexts(nonAuto.map((f) => f.label)));

    const actions = new SuspensionsActions(driver);
    const result = await actions.fill({
      education_district: 'Victoria',
      school_type: 'Government',
    } as unknown as SuspensionsPayload);

    expect(listQuestionItemTexts).toHaveBeenCalledTimes(1);
    expect(fillField).toHaveBeenCalled();
    expect(result.errors.some((e) => e.fieldId === '__form_structure__')).toBe(false);
    expect(result.errors.some((e) => e.fieldId === '__form_schema__')).toBe(false);
  });

  it('DailyReportActions.fill refuses on a drifted live form and never calls fillField', async () => {
    const { fields } = loadDailyReportSchema();
    // Fresh-form live list minus a question the driver definitively demands
    // (education_district is unconditional and never branch-hidden).
    const visible = fields.filter(
      (f) => f.id !== 'principal_name' && !f.showWhen && !DR_BRANCH_HIDDEN.has(f.id) && f.id !== 'education_district',
    );
    const { driver, fillField } = makeStubDriver(asLiveTexts(visible.map((f) => f.label)));

    const actions = new DailyReportActions(driver);
    const result = await actions.fill({});

    expect(result.status).toBe('error');
    expect(result.errors[0]?.fieldId).toBe('__form_structure__');
    expect(result.errors[0]?.reason).toContain('no longer matches the captured schema');
    expect(fillField).not.toHaveBeenCalled();
  });

  it('DailyReportActions.fill proceeds when only branch-hidden questions are absent', async () => {
    const { fields } = loadDailyReportSchema();
    // Live form: everything the branch map does NOT hide (fresh-form state).
    const visible = fields.filter(
      (f) => f.id !== 'principal_name' && !f.showWhen && !DR_BRANCH_HIDDEN.has(f.id),
    );
    const { driver, fillField } = makeStubDriver(asLiveTexts(visible.map((f) => f.label)));

    const actions = new DailyReportActions(driver);
    const result = await actions.fill({ education_district: 'Victoria' });

    expect(result.errors.some((e) => e.fieldId === '__form_structure__')).toBe(false);
    expect(fillField).toHaveBeenCalled();
  });
});

describe('selector fallbacks pinned (CLWX-64 acceptance 2)', () => {
  const driverSrc = readFileSync(
    path.join(REPO_ROOT, 'electron/services/forms-browser-v2/forms-driver.ts'),
    'utf8',
  );

  it('rotated questionItem selector always carries its explicit-role CSS alternative', () => {
    const occurrences = driverSrc.match(/data-automation-id="questionItem"/g) ?? [];
    const paired = driverSrc.match(/data-automation-id="questionItem"\][^']*\[role="listitem"\]/g) ?? [];
    expect(occurrences.length).toBeGreaterThan(0);
    expect(paired.length).toBe(occurrences.length);
  });

  it('question items resolve through the 3-tier chain (CSS union → role engine → prefix variant)', () => {
    // The real response page renders NO explicit role attributes (recorded
    // traces 2026-09-03), so the role-engine tier is the genuine fallback —
    // CSS [role="listitem"] alone cannot see implicit ARIA roles.
    expect(driverSrc).toContain('questionItemsLocator');
    expect(driverSrc).toMatch(/getByRole\('listitem'\)/);
    expect(driverSrc).toContain('[data-automation-id^="question"]');
  });

  it('rotated formTitle selector sits in a multi-strategy candidate chain', () => {
    expect(driverSrc).toContain('data-automation-id="formTitle"');
    expect(driverSrc).toMatch(/getByRole\('heading', \{ level: 1 \}\)/);
  });

  it('checkbox choices have the aria fallback mirroring radios', () => {
    expect(driverSrc).toContain('[role="checkbox"][aria-label=');
    expect(driverSrc).toContain('[role="radio"][aria-label=');
  });
});

describe('normalizeLabel stays in lockstep with the driver matcher', () => {
  it('collapses whitespace, lowercases, trims', () => {
    expect(normalizeLabel('  Name   of  School ')).toBe('name of school');
  });
});
