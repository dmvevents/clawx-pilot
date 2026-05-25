/**
 * forms-fill-via-dom: fills the open Suspensions response page programmatically.
 *
 * Approach: open the responder URL in a new tab, walk the schema, fill each
 * field by question label (matched case-insensitive), preview, optionally
 * submit. The responder page is more stable than the editor, and we drive it
 * via standard DOM selectors (radio, checkbox, input).
 *
 * Run:
 *   pnpm exec tsx scripts/forms-fill-via-dom.ts            # dry-run, no submit
 *   DEMO=1 pnpm exec tsx scripts/forms-fill-via-dom.ts     # actually submit
 *
 * Test payload:
 *   - District: Caroni  | School Type: Government | School: Aranguez GPS
 *   - Realistic, non-PII test student data
 */
import { chromium, type Page } from 'playwright-core';
import { readFileSync } from 'node:fs';

const URL_PATH = 'extensions/moe-principal-assistant/forms/suspensions-test-fac-url.txt';
const SHOULD_SUBMIT = process.env.DEMO === '1';

type Field =
  | { id: string; label: string; type: 'text' | 'number' | 'date'; required?: boolean }
  | { id: string; label: string; type: 'single_choice' | 'multi_choice'; required?: boolean; options?: string[] };

const SAMPLE_PAYLOAD: Record<string, string | string[] | number> = {
  'Education District': 'Caroni',
  'School Type': 'Government',
  'Name of primary school': 'Aranguez GPS',
  'Name of perpetrator': 'Demo Student (test)',
  'Sex': 'Male',
  'Date of birth': '2014-03-15',
  'Age of perpetrator': '11',
  'Student birth certificate PIN': 'TEST-PIN-99999',
  'Class': 'Standard 4',
  'Date of infraction': '2026-05-20',
  'Date of issue of suspension': '2026-05-21',
  'For the current Term': 1, // partial-match — Forms title is long
  'The infraction occurred': 'During class time (member of staff present)',
  'Type of infraction committed': 'Disorderly/Disruptive Conduct',
  'Were there any additional infractions': 'No',
  'Was there a victim involved': 'No',
  'Were written reports collected': 'Yes',
  'Length of suspension': '2',
  'Was an application made for an extended suspension': 'No',
  'Was the student referred to SSSD': 'No',
  "Was the student's parent/guardian/representative present": 'Yes',
  'Did the parent/guardian/representative sign': 'Yes',
  'Was the level of the offence': 'Yes',
  'Level of offence': 'Minor',
  'Name of the parent/guardian/representative present': 'Test Parent',
  "Parent/guardian/representative's phone number (1)": '8681234567',
  'House/apartment/light pole/mile marker number': '12',
  'Name of street': 'Test Street',
  'Name of city/town/village': 'Aranguez',
};

function escRx(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function fillField(page: Page, labelKey: string, value: string | string[] | number): Promise<{ ok: boolean; reason?: string }> {
  // Find the question container by visible text — Forms wraps each question
  // in an element with role="listitem" or class~="question".
  const labelLc = labelKey.toLowerCase();
  // Match on label substring (use first ~30 chars since some labels are very long)
  const probe = labelLc.slice(0, 30);

  // Strategy: find the question container, then look inside it for the right
  // primitive. We try in this order: radio → checkbox → date input → text input.
  const container = page
    .locator('div[role="listitem"], div[data-automation-id*="questionItem" i]')
    .filter({ hasText: new RegExp(escRx(probe), 'i') })
    .first();

  const found = await container.count().catch(() => 0);
  if (!found) {
    // Fallback: look for any heading containing the label
    const heading = page
      .getByRole('heading')
      .filter({ hasText: new RegExp(escRx(probe), 'i') })
      .first();
    const hf = await heading.count().catch(() => 0);
    if (!hf) return { ok: false, reason: 'no container by label' };
  }

  const target = String(Array.isArray(value) ? value[0] : value);

  // Try radio first (single_choice)
  const radio = container
    .locator('label, span')
    .filter({ hasText: new RegExp(`^\\s*${escRx(target)}\\s*$`, 'i') })
    .first();
  if ((await radio.count().catch(() => 0)) > 0) {
    try {
      await radio.click({ timeout: 5_000 });
      return { ok: true };
    } catch {
      /* fall through */
    }
  }

  // Try input
  const input = container.locator('input[type="text"], input[type="number"], input[type="date"], input:not([type]), textarea').first();
  if ((await input.count().catch(() => 0)) > 0) {
    try {
      await input.click({ timeout: 5_000 });
      await input.fill(String(value));
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }
  return { ok: false, reason: 'no input or radio matched' };
}

async function main() {
  const formUrl = readFileSync(URL_PATH, 'utf-8').trim();
  if (!formUrl) {
    console.error(`No URL in ${URL_PATH}`);
    process.exit(1);
  }
  console.log(`Form URL: ${formUrl}\n`);

  const browser = await chromium.connectOverCDP('http://127.0.0.1:18792');
  const all = browser.contexts().flatMap((c) => c.pages());

  // Try to find an existing response tab, otherwise open a new one
  let page = all.find((p) => /ResponsePage\.aspx/i.test(p.url()));
  if (!page) {
    const ctx = browser.contexts()[0];
    page = await ctx.newPage();
    await page.goto(formUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(2_000);
  } else {
    await page.bringToFront();
    if (page.url() !== formUrl) {
      await page.goto(formUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    }
  }
  console.log(`On page: ${page.url().slice(0, 100)}`);
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => null);
  await page.waitForTimeout(2_000);

  let ok = 0;
  let fail = 0;
  for (const [labelKey, value] of Object.entries(SAMPLE_PAYLOAD)) {
    const result = await fillField(page, labelKey, value);
    if (result.ok) {
      ok++;
      console.log(`  ✓ ${labelKey.slice(0, 60)}`);
    } else {
      fail++;
      console.log(`  ✗ ${labelKey.slice(0, 60)} :: ${result.reason}`);
    }
  }
  console.log(`\nFilled ${ok}/${ok + fail}`);

  if (SHOULD_SUBMIT) {
    const submitBtn = page.getByRole('button', { name: /^submit$/i }).first();
    if ((await submitBtn.count().catch(() => 0)) > 0) {
      console.log('\nClicking Submit...');
      await submitBtn.click({ timeout: 10_000 });
      await page.waitForTimeout(5_000);
      const thanks = await page.getByText(/thanks|response was submitted/i).count().catch(() => 0);
      console.log(thanks > 0 ? '✓ SUBMITTED' : '✗ submit clicked but no thank-you');
    } else {
      console.log('\nNo submit button found.');
    }
  } else {
    console.log('\n(Run with DEMO=1 to actually submit)');
  }

  // Don't close — leave the tab so user can verify
  console.log('\nLeaving Chrome tab open for review.');
}

main().catch((err) => {
  console.error('CRASH:', err);
  process.exit(1);
});
