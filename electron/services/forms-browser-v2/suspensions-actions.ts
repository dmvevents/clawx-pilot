/**
 * Higher-level action wrapping FormsDriver for the Suspensions form.
 * Maps a typed SuspensionsPayload onto the schema field-by-field, then submits
 * with the hard-confirm gate.
 */
import { readFileSync } from 'node:fs';
import { FormsDriver, type FillResult, type SubmitResult } from './forms-driver';
import { formsResourcePath } from './paths';
import { logger } from '../../utils/logger';

const SCHEMA_PATH = formsResourcePath('extensions/moe-principal-assistant/forms/suspensions-schema.json');

export interface SuspensionsPayload {
  respondent_name: string;
  education_district: string;
  school_type: string;
  school_name: string;
  perpetrator_name: string;
  perpetrator_sex: 'Male' | 'Female';
  perpetrator_dob: string; // YYYY-MM-DD
  perpetrator_age: string; // "5".."15"
  student_birth_certificate_pin: string;
  class: string;
  date_of_infraction: string;
  date_of_issue_of_suspension: string;
  term_suspension_count: number;
  infraction_when: string;
  primary_infraction: string;
  additional_infractions_present: 'Yes' | 'No';
  additional_infractions?: string[];
  victim_present: 'Yes' | 'No';
  victim_type?: string;
  written_reports_collected: 'Yes' | 'No';
  length_of_suspension: string;
  extended_suspension_application: 'Yes' | 'No';
  sssd_referral: 'Yes' | 'No';
  parent_present_at_issue: 'Yes' | 'No';
  parent_signed_notice: 'Yes' | 'No';
  discipline_matrix_followed: 'Yes' | 'No';
  level_of_offence: 'Minor' | 'Major' | 'Severe';
  parent_name: string;
  parent_phone_1: number;
  parent_phone_2?: number;
  address_house: string;
  address_street: string;
  address_city: string;
}

interface SchemaField {
  id: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'single_choice' | 'multi_choice';
  required?: boolean;
  showWhen?: Record<string, string>;
}

const AUTO_RECORDED_FIELD_IDS = new Set(['respondent_name']);

const FIELD_LABEL_OVERRIDES: Record<string, string> = {
  term_suspension_count: 'this student has been suspended',
};

export class SuspensionsActions {
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

  async fill(payload: SuspensionsPayload): Promise<FillResult> {
    const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf-8')) as { sections: Array<{ fields: SchemaField[] }> };
    const fields = schema.sections.flatMap((s) => s.fields);
    const errors: Array<{ fieldId: string; reason: string }> = [];
    let filledCount = 0;
    let skippedCount = 0;

    for (const field of fields) {
      if (AUTO_RECORDED_FIELD_IDS.has(field.id)) {
        skippedCount++;
        continue;
      }
      const value = (payload as Record<string, unknown>)[field.id];
      // Skip fields that aren't applicable (showWhen) or not provided + not required
      if (field.showWhen) {
        const [k, v] = Object.entries(field.showWhen)[0];
        if ((payload as Record<string, unknown>)[k] !== v) {
          skippedCount++;
          continue;
        }
      }
      if (value === undefined || value === null || value === '') {
        if (field.required) errors.push({ fieldId: field.id, reason: 'required field missing in payload' });
        skippedCount++;
        continue;
      }
      const r = await this.driver.fillField(FIELD_LABEL_OVERRIDES[field.id] ?? field.label, value as any, field.type);
      if (r.ok) {
        filledCount++;
      } else {
        errors.push({ fieldId: field.id, reason: r.reason ?? 'unknown' });
      }
    }
    logger.info(`[forms-v2/suspensions] fill done: filled=${filledCount} skipped=${skippedCount} errors=${errors.length}`);
    return { status: errors.length === 0 ? 'filled' : 'error', filledCount, skippedCount, errors };
  }

  async submit({ confirm }: { confirm: boolean }): Promise<SubmitResult> {
    return this.driver.submit({ confirm, expectedTitle: 'Primary School Student Suspensions' });
  }
}
