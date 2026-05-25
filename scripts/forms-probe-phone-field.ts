/**
 * Probe the phone-number field DOM to see what kind of input it really is.
 */
import { chromium } from 'playwright-core';

async function main() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:18792');
  const all = browser.contexts().flatMap((c) => c.pages());
  const page = all.find((p) => /forms\.office\.com.*ResponsePage/i.test(p.url()));
  if (!page) {
    console.error('no response page');
    process.exit(1);
  }
  await page.bringToFront();
  await page.waitForTimeout(1_000);

  const probe = await page.evaluate(`
    (function() {
      // Find the question container with "phone number" in it
      var lis = document.querySelectorAll('div[role="listitem"]');
      for (var i = 0; i < lis.length; i++) {
        var li = lis[i];
        var text = (li.textContent || '').toLowerCase();
        if (text.indexOf('phone number') >= 0) {
          // Dump every input/contenteditable/textarea inside
          var els = li.querySelectorAll('input, textarea, [contenteditable]');
          var out = [];
          for (var j = 0; j < els.length; j++) {
            var e = els[j];
            out.push({
              tag: e.tagName.toLowerCase(),
              type: e.getAttribute('type') || '',
              role: e.getAttribute('role') || '',
              aria: e.getAttribute('aria-label') || '',
              placeholder: e.getAttribute('placeholder') || '',
              dataAuto: e.getAttribute('data-automation-id') || '',
              cls: (e.getAttribute('class') || '').slice(0, 80),
              visible: e.offsetParent !== null,
            });
          }
          return { found: true, label: text.slice(0, 60), inputs: out, htmlSnippet: li.innerHTML.slice(0, 1500) };
        }
      }
      return { found: false };
    })()
  `);
  console.log(JSON.stringify(probe, null, 2));
  await browser.close().catch(() => null);
}

main().catch((e) => { console.error(e); process.exit(1); });
