/**
 * forms-submit-smoke: one-shot test of submitFormResponse.
 *
 * Prereqs:
 *   1. Chrome running with --remote-debugging-port=18792 (the OpenClaw-managed instance).
 *   2. User signed in to test.fac account (so __RequestVerificationToken cookie + OfficeFormServerInfo.antiForgeryToken are populated).
 *   3. The cloned Suspensions test form open in a tab — its URL is in extensions/moe-principal-assistant/forms/suspensions-test-fac-url.txt.
 *
 * What it does:
 *   - Reads the test form URL.
 *   - Calls submitFormResponse with a minimal 4-field payload (one each of:
 *     text, single_choice, date, number).
 *   - Prints the full SubmitResult.
 *
 * What it does NOT do (yet):
 *   - It does NOT auto-launch Chrome.
 *   - It does NOT clear prior submissions.
 *   - It does NOT know the runtime endpoint shape — if Phase 1 capture
 *     hasn't been done, expect a CAPTURE_NEEDED error pointing at
 *     scripts/forms-capture-submit.ts.
 *
 * Usage:
 *   pnpm exec tsx scripts/forms-submit-smoke.ts
 *   pnpm exec tsx scripts/forms-submit-smoke.ts --confirm   # actually submit (default is dry-run)
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { submitFormResponse } from '../electron/services/forms-graph/forms-runtime-client';

const URL_FILE = join(process.cwd(), 'extensions/moe-principal-assistant/forms/suspensions-test-fac-url.txt');

async function main() {
  const confirmRequested = process.argv.includes('--confirm');

  if (!existsSync(URL_FILE)) {
    console.error(`URL file not found: ${URL_FILE}`);
    console.error(`Write the cloned-form URL there first.`);
    process.exit(1);
  }
  const formUrl = readFileSync(URL_FILE, 'utf-8').trim();
  if (!formUrl) {
    console.error('URL file is empty.');
    process.exit(1);
  }
  console.log(`Form URL: ${formUrl.slice(0, 100)}…`);
  console.log(`Confirm flag: ${confirmRequested ? 'TRUE (will actually POST)' : 'FALSE (dry-run; expect status:refused)'}\n`);

  // Minimal 4-field payload spanning the main answer types we expect to
  // exercise on the real form. Field LABELS here (left-hand side) are
  // matched substring-style against the schema we fetch from /formapi/api/.
  // If labels in the actual cloned form differ, adjust here — the mapping
  // step will surface "no question matched label …" errors so it's obvious.
  const answers: Record<string, string | string[]> = {
    'Respondent Name': 'Smoke Test Principal',
    'Education District': 'St. George East',
    'Date of Issue of Suspension': '2026-05-25',
    'Length of Suspension (in days)': '3',
  };

  console.log('Answers being sent:');
  for (const [k, v] of Object.entries(answers)) {
    console.log(`  ${k}: ${Array.isArray(v) ? v.join(', ') : v}`);
  }
  console.log('');

  const result = await submitFormResponse({
    formUrl,
    answers,
    confirm: confirmRequested,
  });

  console.log('=== SubmitResult ===');
  console.log(JSON.stringify(result, null, 2));

  if (result.status === 'submitted') {
    console.log(`\n✓ submitted via ${result.endpointUsed}`);
    if (result.responseId) console.log(`  responseId: ${result.responseId}`);
    process.exit(0);
  }
  if (result.status === 'refused') {
    console.log('\n(refused — re-run with --confirm to actually submit)');
    process.exit(0);
  }
  // status === 'error'
  console.error(`\n✗ submit failed: ${result.reason ?? 'unknown'}`);
  if (result.reason?.includes('CAPTURE_NEEDED')) {
    console.error('\n→ Run scripts/forms-capture-submit.ts to capture the runtime POST shape, then retry.');
  }
  process.exit(1);
}

main().catch((err) => {
  console.error('CRASH:', err);
  process.exit(1);
});
