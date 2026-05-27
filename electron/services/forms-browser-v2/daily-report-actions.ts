/**
 * Higher-level action wrapping FormsDriver for the Primary School Daily Report.
 *
 * The captured schema comes from the live Microsoft Form and contains several
 * branch-only fields. We skip those fields unless their controlling answer
 * makes them visible; otherwise the driver would report false negatives for
 * questions hidden by Forms branching.
 */
import { readFileSync } from 'node:fs';
import { FormsDriver, type FillResult, type SubmitResult } from './forms-driver';
import { formsResourcePath } from './paths';
import { logger } from '../../utils/logger';

const SCHEMA_PATH = formsResourcePath('extensions/moe-principal-assistant/forms/daily-report-schema.vlm.json');

export type DailyReportPayload = Record<string, string | string[] | number | Date | undefined | null>;

interface SchemaField {
  id: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'single_choice' | 'multi_choice';
  required?: boolean;
  showWhen?: Record<string, string>;
}

const AUTO_RECORDED_FIELD_IDS = new Set(['principal_name']);

const DAILY_REPORT_FORM_FINGERPRINT_LABELS = [
  'Date being reported on',
  'Education district',
  'School type',
  'Name of school',
  'Number of teachers on staff',
  'Number of students enrolled in First Year',
  'Does your school receive NSDSL meals',
  'Was (Were) and student(s) suspended today',
  'Is your school serviced by PTSC',
];

const CONDITIONAL_VISIBILITY: Record<string, Record<string, string>> = {
  reason_no_school: { did_you_have_school_today: 'No' },
  received_nsdsl_breakfasts: { school_receives_nsdsl_meals: 'Yes' },
  breakfasts_delivered: { received_nsdsl_breakfasts: 'Yes' },
  breakfasts_left_after_distribution: { received_nsdsl_breakfasts: 'Yes' },
  breakfast_portion_size_rating: { received_nsdsl_breakfasts: 'Yes' },
  children_satisfied_with_breakfast: { received_nsdsl_breakfasts: 'Yes' },
  students_fell_ill_after_nsdsl_breakfast: { received_nsdsl_breakfasts: 'Yes' },
  received_nsdsl_lunches: { school_receives_nsdsl_meals: 'Yes' },
  lunches_delivered: { received_nsdsl_lunches: 'Yes' },
  lunches_left_after_distribution: { received_nsdsl_lunches: 'Yes' },
  lunch_portion_size_rating: { received_nsdsl_lunches: 'Yes' },
  children_satisfied_with_lunch: { received_nsdsl_lunches: 'Yes' },
  students_fell_ill_after_nsdsl_lunch: { received_nsdsl_lunches: 'Yes' },
  number_of_students_suspended: { students_suspended_today: 'Yes' },
  suspension_recorded_on_form: { students_suspended_today: 'Yes' },
  ptsc_approved_routes_count: { school_serviced_by_ptsc_maxi_taxi: 'Yes' },
  ptsc_morning_trips_count: { school_serviced_by_ptsc_maxi_taxi: 'Yes' },
  students_absent_entire_term: { last_day_of_week: 'Yes' },
  total_students_absent_entire_term: { students_absent_entire_term: 'Yes' },
  first_year_students_absent_entire_term: { students_absent_entire_term: 'Yes' },
  second_year_students_absent_entire_term: { students_absent_entire_term: 'Yes' },
  standard_1_students_absent_entire_term: { students_absent_entire_term: 'Yes' },
  standard_2_students_absent_entire_term: { students_absent_entire_term: 'Yes' },
  standard_3_students_absent_entire_term: { students_absent_entire_term: 'Yes' },
  standard_4_students_absent_entire_term: { students_absent_entire_term: 'Yes' },
  standard_5_students_absent_entire_term: { students_absent_entire_term: 'Yes' },
};

export class DailyReportActions {
  private readonly driver: FormsDriver;

  constructor(driver: FormsDriver) {
    this.driver = driver;
  }

  async open(formUrl: string): Promise<{ status: 'opened' | 'error'; url: string; title: string; reason?: string }> {
    try {
      const page = await this.driver.ensureFormsTab(formUrl);
      const title = await this.driver.getVisibleTitle();
      return { status: 'opened', url: page.url(), title };
    } catch (err) {
      return { status: 'error', url: formUrl, title: '', reason: err instanceof Error ? err.message : String(err) };
    }
  }

  async fill(payload: DailyReportPayload): Promise<FillResult> {
    const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf-8')) as { fields: SchemaField[] };
    const fields = Array.isArray(schema.fields) ? schema.fields : [];
    const errors: Array<{ fieldId: string; reason: string }> = [];
    let filledCount = 0;
    let skippedCount = 0;

    for (const field of fields) {
      if (AUTO_RECORDED_FIELD_IDS.has(field.id)) {
        skippedCount++;
        continue;
      }
      if (!isVisible(field, payload)) {
        skippedCount++;
        continue;
      }

      const value = payload[field.id];
      if (value === undefined || value === null || value === '') {
        if (field.required) errors.push({ fieldId: field.id, reason: 'required field missing in payload' });
        skippedCount++;
        continue;
      }

      const r = await this.driver.fillField(field.label, value as string | string[] | number | Date, field.type);
      if (r.ok) {
        filledCount++;
      } else {
        errors.push({ fieldId: field.id, reason: r.reason ?? 'unknown' });
      }
    }

    logger.info(`[forms-v2/daily-report] fill done: filled=${filledCount} skipped=${skippedCount} errors=${errors.length}`);
    return { status: errors.length === 0 ? 'filled' : 'error', filledCount, skippedCount, errors };
  }

  async submit({ confirm }: { confirm: boolean }): Promise<SubmitResult> {
    return this.driver.submit({
      confirm,
      expectedTitle: 'Primary School Daily Report',
      expectedQuestionLabels: DAILY_REPORT_FORM_FINGERPRINT_LABELS,
    });
  }
}

function isVisible(field: SchemaField, payload: DailyReportPayload): boolean {
  const rule = field.showWhen ?? CONDITIONAL_VISIBILITY[field.id];
  if (!rule) return true;
  return Object.entries(rule).every(([key, expected]) => payload[key] === expected);
}
