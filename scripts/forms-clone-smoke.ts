/**
 * Smoke: just title + first 3 fields. If this works, run forms-clone-v2.ts.
 */
import { chromium } from 'playwright-core';

const CDP = process.env.CLAWX_CDP_ENDPOINT ?? 'http://127.0.0.1:18792';

async function main() {
  const browser = await chromium.connectOverCDP(CDP);
  const all = browser.contexts().flatMap((c) => c.pages());
  const designPages = all.filter((p) => /forms\.office\.com\/Pages\/DesignPageV2/i.test(p.url()));
  if (designPages.length === 0) throw new Error('no design tab');
  const page = designPages.find((p) => /[?&]id=/.test(p.url())) ?? designPages[0];
  await page.bringToFront();

  console.log('1. Click formTitleContainer');
  await page.locator('[data-automation-id="formTitleContainer"]').click({ timeout: 5_000 });
  await page.waitForTimeout(800);

  // After click, dump what's now active so we know how to fill the title
  const after = await page.evaluate(`
    (function() {
      var ae = document.activeElement;
      var inputs = Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"]')).slice(0, 30);
      return {
        active: ae ? { tag: ae.tagName.toLowerCase(), type: ae.getAttribute('type'), aria: ae.getAttribute('aria-label')||'', placeholder: ae.getAttribute('placeholder')||'', dataAuto: ae.getAttribute('data-automation-id')||'' } : null,
        inputs: inputs.map(function(el){
          return {
            tag: el.tagName.toLowerCase(),
            type: el.getAttribute('type')||'',
            aria: el.getAttribute('aria-label')||'',
            placeholder: el.getAttribute('placeholder')||'',
            dataAuto: el.getAttribute('data-automation-id')||'',
            visible: el.offsetParent !== null,
          };
        }).filter(function(x){return x.visible;}),
      };
    })()
  `);
  console.log('After title click:');
  console.log(JSON.stringify(after, null, 2));

  await browser.close().catch(() => null);
}

main().catch((err) => { console.error(err); process.exit(1); });
