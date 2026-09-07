/** Close/discard any open compose panes in the Outlook tab (test hygiene). */
import { chromium } from 'playwright-core';

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:18792', { timeout: 15000 });
  const ctx = browser.contexts()[0];
  // Anchored to the same three product hosts the driver accepts. The old form was
  // an unanchored substring match, so it also matched a look-alike host
  // (outlook.office.com.attacker.tt) and any path containing the literal — and
  // this script then focuses that tab and clicks buttons labelled "Discard" on it.
  // Dev hygiene only, but a discard click is destructive to whatever it lands on.
  const page = ctx.pages().find((p) => /^https:\/\/outlook\.(office|office365)\.com\/|^https:\/\/outlook\.cloud\.microsoft\//i.test(p.url()));
  if (!page) { console.log('no outlook tab'); process.exit(0); }
  await page.bringToFront();
  for (let i = 0; i < 4; i += 1) {
    const discard = page.locator('button[aria-label*="Discard" i], button:has-text("Discard")');
    if (await discard.count()) {
      await discard.first().click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(1200);
      // Confirm dialog ("Discard draft?")
      const confirm = page.locator('button:has-text("Discard"), button:has-text("OK")');
      if (await confirm.count()) await confirm.first().click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(1200);
      continue;
    }
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(800);
  }
  await page.goto('https://outlook.office.com/mail/', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(3000);
  console.log('cleanup done, url:', page.url().slice(0, 60));
  await browser.close().catch(() => {});
})();
