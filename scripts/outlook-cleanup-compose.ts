/** Close/discard any open compose panes in the Outlook tab (test hygiene). */
import { chromium } from 'playwright-core';

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:18792', { timeout: 15000 });
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().match(/outlook\.(office|office365|cloud\.microsoft)/));
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
