/**
 * End-to-end smoke for the Suspensions form-fill driver.
 *
 *   1. Reads the cloned form URL from
 *        extensions/moe-principal-assistant/forms/suspensions-test-fac-url.txt
 *   2. Opens the form in the user's Chrome via CDP.
 *   3. Fills a realistic test payload field-by-field.
 *   4. Asserts the hard-confirm gate refuses without confirm:true.
 *   5. Pauses for human review (DEMO=1 env to actually submit).
 *
 * Run:
 *   pnpm exec tsx scripts/forms-fill-suspensions.ts          # dry-run, refuses submit
 *   DEMO=1 pnpm exec tsx scripts/forms-fill-suspensions.ts   # actually submit
 *
 * Prereqs:
 *   - Chrome running with --remote-debugging-port=18792
 *   - test.fac@fac.edu.tt logged in
 *   - The cloned form built per extensions/moe-principal-assistant/forms/suspensions-form-spec.md
 *   - Form URL written to suspensions-test-fac-url.txt
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { FormsDriver } from '../electron/services/forms-browser-v2/forms-driver.ts';
import { SuspensionsActions, type SuspensionsPayload } from '../electron/services/forms-browser-v2/suspensions-actions.ts';

const URL_PATH = join(process.cwd(), 'extensions/moe-principal-assistant/forms/suspensions-test-fac-url.txt');
const SHOULD_SUBMIT = process.env.DEMO === '1';

const SAMPLE_PAYLOAD: SuspensionsPayload = {
  respondent_name: 'Test Principal (auto)',
  education_district: 'Caroni',
  school_type: 'Government',
  school_name: 'Aranguez GPS',
  perpetrator_name: 'Demo Student (test data — not a real person)',
  perpetrator_sex: 'Male',
  perpetrator_dob: '2014-03-15',
  perpetrator_age: '11',
  student_birth_certificate_pin: 'TEST-PIN-99999',
  class: 'Standard 4',
  date_of_infraction: '2026-05-20',
  date_of_issue_of_suspension: '2026-05-21',
  term_suspension_count: 1,
  infraction_when: 'During class time (member of staff present)',
  primary_infraction: 'Disorderly/Disruptive Conduct',
  additional_infractions_present: 'No',
  victim_present: 'No',
  written_reports_collected: 'Yes',
  length_of_suspension: '2',
  extended_suspension_application: 'No',
  sssd_referral: 'No',
  parent_present_at_issue: 'Yes',
  parent_signed_notice: 'Yes',
  discipline_matrix_followed: 'Yes',
  level_of_offence: 'Minor',
  parent_name: 'Test Parent (auto)',
  parent_phone_1: 8681234567,
  address_house: '12',
  address_street: 'Test Street',
  address_city: 'Aranguez',
};

async function main() {
  if (!existsSync(URL_PATH)) {
    console.error(`No form URL on disk. Build the cloned form first (see extensions/moe-principal-assistant/forms/suspensions-form-spec.md), then write the URL to ${URL_PATH}.`);
    process.exit(1);
  }
  const formUrl = readFileSync(URL_PATH, 'utf-8').trim();
  if (!formUrl || !/forms\.(office|cloud\.microsoft)\.com/.test(formUrl)) {
    console.error(`Form URL on disk doesn't look right: ${formUrl}`);
    process.exit(1);
  }
  console.log(`Form URL: ${formUrl}\n`);

  const driver = new FormsDriver();
  const actions = new SuspensionsActions(driver);

  try {
    console.log('Step 1: open');
    const o = await actions.open(formUrl);
    console.log(`  → status=${o.status} title="${o.title}"`);
    if (o.status !== 'opened') {
      console.error(`  ✗ open failed: ${o.reason}`);
      process.exit(1);
    }

    console.log('\nStep 2: fill 32 fields');
    const f = await actions.fill(SAMPLE_PAYLOAD);
    console.log(`  → status=${f.status} filled=${f.filledCount} skipped=${f.skippedCount} errors=${f.errors.length}`);
    if (f.errors.length > 0) {
      console.log('  errors:');
      for (const e of f.errors) console.log(`    [${e.fieldId}] ${e.reason}`);
    }

    console.log('\nStep 3: assert hard-confirm gate refuses without confirm');
    const refused = await actions.submit({ confirm: false });
    console.log(`  → status=${refused.status} reason=${refused.reason ?? ''}`);
    if (refused.status !== 'refused') {
      console.error('  ✗ submit gate did not refuse without confirm:true');
      process.exit(1);
    }

    if (SHOULD_SUBMIT) {
      console.log('\nStep 4: submit with confirm:true (DEMO=1)');
      const sent = await actions.submit({ confirm: true });
      console.log(`  → status=${sent.status} ${sent.message ?? sent.reason ?? ''}`);
      if (sent.status === 'submitted') {
        console.log('\n=== SEND PASS ===');
        process.exit(0);
      } else {
        console.error('  ✗ submit failed');
        process.exit(1);
      }
    } else {
      console.log('\n(skipping actual submit — set DEMO=1 to fire it for real)');
      console.log('=== FILL PASS ===');
      process.exit(0);
    }
  } finally {
    await driver.close();
  }
}

main().catch((err) => {
  console.error('CRASH:', err instanceof Error ? err.message : String(err));
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(2);
});
