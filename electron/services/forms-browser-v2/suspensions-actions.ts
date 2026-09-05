/**
 * Higher-level action wrapping FormsDriver for the Suspensions form.
 * Maps a typed SuspensionsPayload onto the schema field-by-field, then submits
 * with the hard-confirm gate.
 */
import { readFileSync } from 'node:fs';
import { FormsDriver, type FillResult, type SubmitResult } from './forms-driver';
import { formsResourcePath } from './paths';
import {
  matchLiveQuestions,
  verifyStoredFingerprint,
  type SchemaFingerprint,
} from './schema-fingerprint';
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

const SUSPENSIONS_FORM_FINGERPRINT_LABELS = [
  'Education District',
  'School Type',
  'Name of primary school',
  'Name of perpetrator',
  'Student birth certificate PIN',
  'Date of issue of suspension',
  'Type of infraction committed',
  'Were there any written reports',
  'Was the parent/ guardian present',
];

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
    const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf-8')) as {
      sections: Array<{ fields: SchemaField[] }>;
      fingerprint?: SchemaFingerprint;
    };
    const fields = schema.sections.flatMap((s) => s.fields);

    // CLWX-64 schema-drift gate: refuse LOUDLY rather than mis-map answers
    // onto a statutory form that no longer matches the captured schema.
    const drift = await this.verifyFormMatchesSchema(fields, schema.fingerprint);
    if (drift) return drift;
    // Schema field ids are dynamic strings, so index the typed payload via a
    // record view (double cast: SuspensionsPayload has no index signature).
    const payloadRecord = payload as unknown as Record<string, unknown>;
    const errors: Array<{ fieldId: string; reason: string }> = [];
    let filledCount = 0;
    let skippedCount = 0;

    for (const field of fields) {
      if (AUTO_RECORDED_FIELD_IDS.has(field.id)) {
        skippedCount++;
        continue;
      }
      const value = payloadRecord[field.id];
      // Skip fields that aren't applicable (showWhen) or not provided + not required
      if (field.showWhen) {
        const [k, v] = Object.entries(field.showWhen)[0];
        if (payloadRecord[k] !== v) {
          const liveField = await this.driver.inspectField(field.label);
          if (field.required && liveField.visible && liveField.required && !liveField.hasValue) {
            errors.push({
              fieldId: field.id,
              reason: `required field is visible on the live Microsoft Form even though ${k}=${String(payloadRecord[k] ?? '')}; provide an explicit value or fix the form branching`,
            });
          }
          skippedCount++;
          continue;
        }
      }
      if (value === undefined || value === null || value === '') {
        if (field.required) errors.push({ fieldId: field.id, reason: 'required field missing in payload' });
        skippedCount++;
        continue;
      }
      const r = await this.driver.fillField(
        FIELD_LABEL_OVERRIDES[field.id] ?? field.label,
        value as string | string[] | number | Date,
        field.type,
      );
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
    return this.driver.submit({
      confirm,
      expectedTitle: 'Primary School Student Suspensions',
      expectedQuestionLabels: SUSPENSIONS_FORM_FINGERPRINT_LABELS,
    });
  }

  /** CLWX-64: stored-fingerprint integrity + live-form structure check. */
  private async verifyFormMatchesSchema(
    fields: SchemaField[],
    stored: SchemaFingerprint | undefined,
  ): Promise<FillResult | null> {
    const labels = fields.map((f) => f.label);
    const integrity = verifyStoredFingerprint(labels, stored, 'Suspensions schema');
    if (!integrity.ok) {
      logger.warn(`[forms-v2/suspensions] ${integrity.reason}`);
      return {
        status: 'error',
        filledCount: 0,
        skippedCount: 0,
        errors: [{ fieldId: '__form_schema__', reason: integrity.reason ?? 'schema fingerprint mismatch' }],
      };
    }
    const relevant = fields.filter((f) => !AUTO_RECORDED_FIELD_IDS.has(f.id));
    let liveTexts: string[];
    try {
      liveTexts = await this.driver.listQuestionItemTexts();
    } catch (err) {
      const reason =
        `Suspensions form: could not read the form page to verify it against the captured schema ` +
        `(${err instanceof Error ? err.message : String(err)}). Re-open the form and try again.`;
      logger.warn(`[forms-v2/suspensions] ${reason}`);
      return { status: 'error', filledCount: 0, skippedCount: 0, errors: [{ fieldId: '__form_structure__', reason }] };
    }
    const live = matchLiveQuestions({
      orderedLabels: relevant.map((f) => f.label),
      unconditionalLabels: relevant.filter((f) => !f.showWhen).map((f) => f.label),
      liveTexts,
      formName: 'Suspensions form',
    });
    logger.info(
      `[forms-v2/suspensions] schema-drift check: matched=${live.matchedCount}/${live.demandedCount} unmatchedLive=${live.unmatchedLiveCount} ok=${live.ok}`,
    );
    if (!live.ok) {
      return {
        status: 'error',
        filledCount: 0,
        skippedCount: 0,
        errors: [{ fieldId: '__form_structure__', reason: live.reason ?? 'live form does not match schema' }],
      };
    }
    return null;
  }
}
