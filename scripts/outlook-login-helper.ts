/**
 * One-time Outlook sign-in for the dedicated demo Chrome profile.
 *
 * AUTHORIZED for the sandbox account test.fac@fac.edu.tt ONLY (owner
 * authorization on record; NEVER for *@moe.gov.tt). Reads the password from
 * PILOT_TEST_PASSWORD — never logs it. Attaches to the user's running system
 * Chrome over CDP (profile=user rule; managed Chromium is blocked by
 * Conditional Access). Screenshots each step to /tmp for diagnosis.
 */
import { chromium } from 'playwright-core';

const CDP = process.env.CLAWX_CDP_URL ?? 'http://127.0.0.1:18792';
const USER = process.env.PILOT_TEST_USER ?? 'test.fac@fac.edu.tt';
const PASS = process.env.PILOT_TEST_PASSWORD;

if (!PASS) {
  console.error('PILOT_TEST_PASSWORD is required.');
  process.exit(2);
}

const shot = async (page: import('playwright-core').Page, n: string) => {
  await page.screenshot({ path: `/tmp/outlook-login-${n}.png` }).catch(() => {});
};

(async () => {
  const browser = await chromium.connectOverCDP(CDP, { timeout: 15000 });
  const ctx = browser.contexts()[0] ?? (await browser.newContext());
  const page = ctx.pages()[0] ?? (await ctx.newPage());

  console.log('navigating to Outlook…');
  await page.goto('https://outlook.office.com/mail/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);
  await shot(page, '1-landing');
  console.log('url:', page.url().slice(0, 90));

  if (page.url().includes('login.microsoftonline.com') || page.url().includes('login.live.com')) {
    const emailBox = page.locator('input[type="email"], input[name="loginfmt"]');
    if (await emailBox.count()) {
      console.log('filling email…');
      await emailBox.first().fill(USER);
      await page.locator('#idSIButton9, input[type="submit"], button[type="submit"]').first().click();
      await page.waitForTimeout(4000);
      await shot(page, '2-after-email');
    }
    const passBox = page.locator('input[type="password"], input[name="passwd"]');
    await passBox.first().waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
    if (await passBox.count()) {
      console.log('filling password…');
      await passBox.first().fill(PASS);
      await page.locator('#idSIButton9, input[type="submit"], button[type="submit"]').first().click();
      await page.waitForTimeout(5000);
      await shot(page, '3-after-password');
    }
    // "Stay signed in?" (KMSI)
    const kmsi = page.locator('#idSIButton9, button:has-text("Yes")');
    if ((await kmsi.count()) && page.url().includes('login')) {
      console.log('KMSI → Yes');
      await kmsi.first().click().catch(() => {});
      await page.waitForTimeout(5000);
      await shot(page, '4-after-kmsi');
    }
  }

  await page.waitForTimeout(6000);
  await shot(page, '5-final');
  const finalUrl = page.url();
  console.log('FINAL_URL:', finalUrl.slice(0, 100));
  console.log('SIGNED_IN:', /outlook\.(office|office365)\.com\/mail/.test(finalUrl));
  await browser.close().catch(() => {});
})().catch((e) => {
  console.error('FATAL:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
