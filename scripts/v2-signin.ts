/**
 * Drive Microsoft sign-in for test.fac@fac.edu.tt against the Chrome
 * already running on 127.0.0.1:18792. One-shot dev helper.
 *
 * Microsoft sign-in flow (May 2026):
 *   1. Email page:    input[name="loginfmt"] / input[type="email"]   → Next
 *   2. Password page: input[name="passwd"]   / input[type="password"] → Sign in
 *   3. "Stay signed in?" prompt (DON'T): button "No"
 */
import { PlaywrightDriver } from '../electron/services/outlook-browser-v2/playwright-driver.ts';

const EMAIL = 'test.fac@fac.edu.tt';
const PASSWORD = process.env.PILOT_TEST_PASSWORD;

async function main() {
  if (!PASSWORD) {
    throw new Error('PILOT_TEST_PASSWORD is required for the test.fac sign-in helper.');
  }

  const driver = new PlaywrightDriver({ cdpEndpoint: 'http://127.0.0.1:18792' });
  await driver.ensureBrowser();
  const page = await driver.ensureOutlookTab();
  console.log('URL before sign-in:', page.url());

  // 1. Email field. Microsoft shows it whether we're at outlook.office.com
  // or login.microsoftonline.com.
  console.log('[1] looking for email input');
  const emailInput = page.locator(
    'input[name="loginfmt"], input[type="email"]',
  ).first();
  await emailInput.waitFor({ timeout: 20_000 });
  await emailInput.fill(EMAIL);
  console.log(`    filled: ${EMAIL}`);

  // Next button: input[type="submit"] with value "Next" or button#idSIButton9.
  const nextBtn = page.locator(
    'input[type="submit"][value="Next"], button#idSIButton9, input#idSIButton9',
  ).first();
  await nextBtn.click();
  console.log('    clicked Next, waiting for password page');

  // 2. Password field. Microsoft's transition can be ~3-8s.
  const passwordInput = page.locator(
    'input[name="passwd"], input[type="password"]',
  ).first();
  await passwordInput.waitFor({ timeout: 30_000 });
  await passwordInput.fill(PASSWORD);
  console.log('    password filled');

  const signInBtn = page.locator(
    'input[type="submit"][value="Sign in"], button#idSIButton9, input#idSIButton9',
  ).first();
  await signInBtn.click();
  console.log('    clicked Sign in');

  // 3. "Stay signed in?" — answer No (test account, don't persist).
  console.log('[3] waiting for stay-signed-in prompt or inbox');
  const staySignedInNo = page.locator(
    'input[type="button"][value="No"], button:has-text("No")',
  ).first();
  try {
    await staySignedInNo.waitFor({ timeout: 15_000 });
    await staySignedInNo.click();
    console.log('    clicked No on Stay-signed-in');
  } catch {
    console.log('    no Stay-signed-in prompt (likely went straight to inbox)');
  }

  // 4. Wait for the inbox to be loaded — outlook-actions uses these:
  await page.waitForSelector(
    'div[role="listbox"], div[role="rowgroup"], [aria-label*="Inbox" i]',
    { timeout: 30_000 },
  );
  console.log('=== inbox loaded ===');
  console.log('URL after sign-in:', page.url());
  console.log('Title:', await page.title());
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('FAILED:', err instanceof Error ? err.message : String(err));
    if (err instanceof Error && err.stack) console.error(err.stack);
    process.exit(1);
  });
