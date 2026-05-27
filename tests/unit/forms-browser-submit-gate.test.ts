// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  formatFormsDateInput,
  matchesExpectedQuestionFingerprint,
} from '../../electron/services/forms-browser-v2/forms-driver';
import { SuspensionsActions, type SuspensionsPayload } from '../../electron/services/forms-browser-v2/suspensions-actions';

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

  it('accepts the daily report question fingerprint when the response title is generic', () => {
    const text = [
      '1. Date being reported on',
      '2. Education district',
      '3. School type',
      '4. Name of school',
      '10. Number of teachers on staff',
      '15. Number of students enrolled in First Year',
      '29. Does your school receive NSDSL meals',
    ].join('\n');

    expect(matchesExpectedQuestionFingerprint(text, [
      'Date being reported on',
      'Education district',
      'School type',
      'Name of school',
      'Number of teachers on staff',
      'Number of students enrolled in First Year',
      'Does your school receive NSDSL meals',
    ])).toEqual({
      ok: true,
      matched: 7,
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

describe('suspensions live required-field validation', () => {
  const completePayload: SuspensionsPayload = {
    respondent_name: 'Auto Recorded',
    education_district: 'North Eastern',
    school_type: 'Government',
    school_name: 'Aranguez GPS',
    perpetrator_name: 'A. Test Student',
    perpetrator_sex: 'Male',
    perpetrator_dob: '2015-09-14',
    perpetrator_age: '10',
    student_birth_certificate_pin: 'TEST-PIN-0001',
    class: 'Standard 5',
    date_of_infraction: '2026-05-26',
    date_of_issue_of_suspension: '2026-05-27',
    term_suspension_count: 1,
    infraction_when: 'During class time (member of staff present)',
    primary_infraction: 'Disrespect/Defiance of Authority',
    additional_infractions_present: 'No',
    victim_present: 'No',
    written_reports_collected: 'Yes',
    length_of_suspension: '5',
    extended_suspension_application: 'No',
    sssd_referral: 'No',
    parent_present_at_issue: 'Yes',
    parent_signed_notice: 'Yes',
    discipline_matrix_followed: 'Yes',
    level_of_offence: 'Major',
    parent_name: 'Pat Test',
    parent_phone_1: 8681234567,
    parent_phone_2: 8687654321,
    address_house: '12',
    address_street: 'Test Street',
    address_city: 'Aranguez',
  };

  it('reports conditional fields that remain visible and required on the live form', async () => {
    const driver = {
      fillField: async () => ({ ok: true }),
      inspectField: async (label: string) => ({
        visible: /Additional infractions|victim was/i.test(label),
        hasValue: false,
        required: true,
        text: label,
      }),
    };
    const actions = new SuspensionsActions(driver as never);

    const result = await actions.fill(completePayload);

    expect(result.status).toBe('error');
    expect(result.errors.map((error) => error.fieldId)).toEqual([
      'additional_infractions',
      'victim_type',
    ]);
  });
});
