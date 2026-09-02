/**
 * READ-ONLY probe: with the signed-in sandbox session (same tenant as
 * moe.gov.tt — verified via public OpenID metadata), open the Entra portal's
 * App registrations list and screenshot it. Answers "does the Ministry app
 * registration (and its redirect URI) already exist?" Never clicks anything
 * mutating; navigation + screenshot only.
 */
import { chromium } from 'playwright-core';

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:18792', { timeout: 15000 });
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.bringToFront();

  console.log('navigating to Entra app registrations (all apps)…');
  await page.goto(
    'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade/quickStartType~/null/sourceType/Microsoft_AAD_IAM',
    { waitUntil: 'domcontentloaded', timeout: 90000 },
  ).catch((e) => console.log('goto note:', e.message.slice(0, 80)));
  await page.waitForTimeout(15000);
  await page.screenshot({ path: '/tmp/entra-apps-1.png' }).catch(() => {});
  console.log('url:', page.url().slice(0, 110));

  // If an account-picker or sign-in interstitial appeared, capture it — the
  // screenshot tells us; do not fill anything here.
  const text = await page.evaluate(() => (document.body?.innerText || '').slice(0, 3000)).catch(() => '');
  const markers = ['App registrations', 'All applications', 'Owned applications', 'sign in', 'Pick an account', 'does not have access', 'restricted'];
  for (const m of markers) {
    if (text.toLowerCase().includes(m.toLowerCase())) console.log('MARKER:', m);
  }
  await browser.close().catch(() => {});
})().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
