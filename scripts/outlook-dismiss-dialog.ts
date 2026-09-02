import { chromium } from 'playwright-core';
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:18792', { timeout: 15000 });
  const page = browser.contexts()[0]?.pages().find((p) => p.url().match(/outlook\.(office|office365|cloud\.microsoft)/));
  if (!page) { console.log('no tab'); process.exit(0); }
  const ok = page.locator('button:has-text("OK")');
  if (await ok.count()) { await ok.first().click({ timeout: 4000 }).catch(() => {}); console.log('dialog dismissed (draft discarded)'); }
  else console.log('no dialog present');
  await browser.close().catch(() => {});
})();
