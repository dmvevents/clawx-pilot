import { chromium } from 'playwright-core';
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:18792', { timeout: 15000 });
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().match(/outlook\.(office|office365|cloud\.microsoft)/));
  if (!page) { console.log('no outlook tab; pages:', ctx.pages().map(p=>p.url().slice(0,50))); process.exit(0); }
  await page.screenshot({ path: '/tmp/outlook-state.png' });
  console.log('url:', page.url().slice(0, 90));
  await browser.close();
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
