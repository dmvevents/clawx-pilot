/** Diagnostic: replicate verifyBodyFill's recipient-field classification on
 * the currently open draft and print WHICH elements match (RAJ-4 verifier
 * false-positive investigation on outlook.cloud.microsoft). Read-only. */
import { chromium } from 'playwright-core';

const NEEDLE = 'Live send test from ClawX';

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:18792', { timeout: 15000 });
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().match(/outlook\.(office|office365|cloud\.microsoft)/));
  if (!page) { console.log('no outlook tab'); process.exit(1); }

  const hits = await page.evaluate((needle) => {
    const isVisible = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const els = Array.from(document.querySelectorAll([
      '[aria-label="To"]',
      '[aria-label="Cc"]',
      '[aria-label="Bcc"]',
      '[aria-label*="To" i]',
      '[aria-label*="Cc" i]',
      '[aria-label*="Bcc" i]',
    ].join(',')));
    return els.filter(isVisible).map((el) => ({
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') || '',
      aria: (el.getAttribute('aria-label') || '').slice(0, 80),
      ce: el.getAttribute('contenteditable') || '',
      containsNeedle: (el.textContent || '').includes(needle),
      size: `${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`,
    }));
  }, NEEDLE);
  for (const h of hits) console.log(JSON.stringify(h));
  await browser.close().catch(() => {});
})().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
