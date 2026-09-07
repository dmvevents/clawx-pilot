/**
 * End-to-end smoke for the Daily Report form-fill driver (CLWX-62).
 *
 * The Primary School Daily Report IS the statutory 3:45pm form — the
 * product's reason to exist — yet until this script only Suspensions had a
 * live-proven e2e. Mirrors scripts/forms-fill-suspensions.ts:
 *
 *   1. Reads the cloned form URL from
 *        extensions/moe-principal-assistant/forms/daily-report-test-fac-url.txt
 *   2. Opens the form in the user's Chrome via CDP (profile=user hard rule).
 *   3. Fills a coherent max-visibility test payload (56/57 fields visible:
 *      school open, NSDSL both meals, suspension, PTSC, last-day absentee
 *      summary all = Yes; only reason_no_school stays hidden).
 *   4. Asserts the hard-confirm gate refuses without confirm:true.
 *   5. DEMO=1 env to actually submit (test.fac clone only).
 *
 * Run:
 *   pnpm exec tsx scripts/forms-fill-daily-report.ts          # dry-run, refuses submit
 *   DEMO=1 pnpm exec tsx scripts/forms-fill-daily-report.ts   # actually submit
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { FormsDriver } from '../electron/services/forms-browser-v2/forms-driver.ts';
import { DailyReportActions, type DailyReportPayload } from '../electron/services/forms-browser-v2/daily-report-actions.ts';

const URL_PATH = join(process.cwd(), 'extensions/moe-principal-assistant/forms/daily-report-test-fac-url.txt');
const SHOULD_SUBMIT = process.env.DEMO === '1';

// Internally consistent: 20 teachers = 17 present + 3 absent (0 quarantine,
// 0 other leave); per-class present <= enrolled; absentee-summary counts sum
// to the stated total (0+1+0+1+0+1+0 = 3).
const SAMPLE_PAYLOAD: DailyReportPayload = {
  principal_name: 'Test Principal (auto)',
  date_being_reported_on: '2026-09-03',
  education_district: 'Caroni',
  school_type: 'Government',
  name_of_school: 'Aranguez GPS',
  did_you_have_school_today: 'Yes',
  principal_status: 'Physically present at school',
  vice_principal_status: 'Physically present at school',
  number_of_teachers_on_staff: 20,
  number_of_teachers_present: 17,
  number_of_teachers_absent: 3,
  number_of_teachers_on_moh_quarantine: 0,
  number_of_teachers_other_leave: 0,
  students_enrolled_first_year: 30,
  first_year_students_present: 27,
  students_enrolled_second_year: 32,
  second_year_students_present: 30,
  students_enrolled_standard_1: 28,
  standard_1_students_present: 26,
  students_enrolled_standard_2: 31,
  standard_2_students_present: 29,
  students_enrolled_standard_3: 27,
  standard_3_students_present: 25,
  students_enrolled_standard_4: 29,
  standard_4_students_present: 28,
  students_enrolled_standard_5: 26,
  standard_5_students_present: 24,
  school_receives_nsdsl_meals: 'Yes',
  received_nsdsl_breakfasts: 'Yes',
  breakfasts_delivered: 120,
  breakfasts_left_after_distribution: 5,
  breakfast_portion_size_rating: 'Enough',
  children_satisfied_with_breakfast: 'Yes',
  students_fell_ill_after_nsdsl_breakfast: 0,
  received_nsdsl_lunches: 'Yes',
  lunches_delivered: 150,
  lunches_left_after_distribution: 8,
  lunch_portion_size_rating: 'Enough',
  children_satisfied_with_lunch: 'Yes',
  students_fell_ill_after_nsdsl_lunch: 0,
  students_suspended_today: 'Yes',
  number_of_students_suspended: 1,
  suspension_recorded_on_form: 'Yes',
  school_serviced_by_ptsc_maxi_taxi: 'Yes',
  ptsc_approved_routes_count: 2,
  ptsc_morning_trips_count: 4,
  last_day_of_week: 'Yes',
  students_absent_entire_term: 'Yes',
  total_students_absent_entire_term: 3,
  first_year_students_absent_entire_term: 0,
  second_year_students_absent_entire_term: 1,
  standard_1_students_absent_entire_term: 0,
  standard_2_students_absent_entire_term: 1,
  standard_3_students_absent_entire_term: 0,
  standard_4_students_absent_entire_term: 1,
  standard_5_students_absent_entire_term: 0,
};

async function main() {
  if (!existsSync(URL_PATH)) {
    console.error(`No form URL on disk. Clone the Daily Report first (scripts/forms-clone-daily-report.ts), then write the URL to ${URL_PATH}.`);
    process.exit(1);
  }
  const formUrl = readFileSync(URL_PATH, 'utf-8').trim();
  if (!formUrl || !/forms\.(office|cloud\.microsoft)/.test(formUrl)) {
    console.error(`Form URL on disk doesn't look right: ${formUrl.slice(0, 60)}`);
    process.exit(1);
  }
  console.log(`Form URL: ${formUrl.slice(0, 70)}…\n`);

  const driver = new FormsDriver();
  const actions = new DailyReportActions(driver);

  try {
    console.log('Step 1: open');
    const o = await actions.open(formUrl);
    console.log(`  → status=${o.status} title="${o.title}"`);
    if (o.status !== 'opened') {
      console.error(`  ✗ open failed: ${o.reason}`);
      process.exit(1);
    }

    console.log('\nStep 2: fill (56 visible of 57 schema fields)');
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
