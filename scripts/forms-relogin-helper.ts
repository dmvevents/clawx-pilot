/**
 * Auto-login for test.fac@fac.edu.tt against Microsoft. Drives the existing
 * Chrome via CDP, navigates to the form responder URL, fills email + password,
 * handles "Stay signed in?" prompt.
 *
 * AUTHORIZED test-account credentials (user explicit authorization
 * 2026-05-25 — see memory/feedback_test_fac_password.md). NEVER for *@moe.gov.tt.
 *
 * Run:
 *   pnpm exec tsx scripts/forms-relogin-helper.ts
 *
 * If 2FA fires, the script pauses and asks the human to complete it,
 * then resumes.
 */
import { chromium } from 'playwright-core';

const TEST_USER = 'test.fac@fac.edu.tt';
const TEST_PASS = 'Education@2000';
const RESPONSE_URL =
  'https://forms.office.com/Pages/ResponsePage.aspx?id=CbuQlSzO4kCBgfrQp-3r_tvUSA6KacpEuguukFzQeBdUN0hITFc3U0pWMTYxRENMMU9BM0NDTjk1VC4u';

async function main() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:18792');
  const all = browser.contexts().flatMap((c) => c.pages());
  let page = all.find(
    (p) => /forms\.office\.com/i.test(p.url()) || /login\.microsoftonline\.com/i.test(p.url()),
  );
  if (!page) {
    const ctx = browser.contexts()[0];
    page = await ctx.newPage();
  }
  await page.bringToFront();

  console.log(`Navigating to: ${RESPONSE_URL.slice(0, 90)}...`);
  await page.goto(RESPONSE_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForTimeout(2_500);

  let url = page.url();
  console.log(`After nav: ${url.slice(0, 100)}`);

  // STEP 1: Email
  if (/login\.microsoftonline\.com/i.test(url)) {
    const emailInput = page.locator('input[name="loginfmt"], input[type="email"]').first();
    if ((await emailInput.count().catch(() => 0)) > 0) {
      console.log(`Email: ${TEST_USER}`);
      await emailInput.fill(TEST_USER);
      const next = page.getByRole('button', { name: /next/i }).first();
      await next.click({ timeout: 5_000 }).catch(() => null);
      await page.waitForTimeout(2_500);
    }

    // STEP 2: Password
    const passInput = page.locator('input[name="passwd"], input[type="password"]').first();
    if ((await passInput.count().catch(() => 0)) > 0) {
      console.log('Password: <typing>');
      await passInput.fill(TEST_PASS);
      const signIn = page.getByRole('button', { name: /sign in|next/i }).first();
      await signIn.click({ timeout: 5_000 }).catch(() => null);
      await page.waitForTimeout(3_500);
    }

    // STEP 3: "Stay signed in?" prompt
    const stay = page.getByRole('button', { name: /yes|stay signed/i }).first();
    if ((await stay.count().catch(() => 0)) > 0) {
      console.log('Confirming stay-signed-in...');
      await stay.click({ timeout: 5_000 }).catch(() => null);
      await page.waitForTimeout(3_000);
    }

    // STEP 4: 2FA / phone prompt — pause for human if it appears
    const twofa = page.getByText(/approve|enter code|security code|verify your identity/i).first();
    if ((await twofa.count().catch(() => 0)) > 0) {
      console.log('\n>>> 2FA prompt detected. Approve in your authenticator. <<<');
      console.log('Waiting up to 90s for redirect back to forms.office.com...');
      const start = Date.now();
      while (Date.now() - start < 90_000) {
        if (/forms\.office\.com/i.test(page.url())) break;
        await page.waitForTimeout(1_000);
      }
    }
  }

  url = page.url();
  console.log(`\nFinal URL: ${url.slice(0, 120)}`);
  if (/forms\.office\.com\/.*ResponsePage/i.test(url)) {
    console.log('✓ Logged in and on the response page.');
  } else if (/forms\.office\.com/i.test(url)) {
    console.log('✓ Logged in. May need to navigate to the response URL manually.');
  } else {
    console.log('? Not on Forms yet. Continue manually if needed.');
  }
  // Don't close the browser — the user keeps using it
}

main().catch((err) => {
  console.error('CRASH:', err);
  process.exit(1);
});
