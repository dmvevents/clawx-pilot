/**
 * Probe v2: explicitly target the id-tab and dump structure around the title.
 */
import { chromium } from 'playwright-core';

async function main() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:18792');
  const all = browser.contexts().flatMap((c) => c.pages());
  const page = all.find((p) => /forms\.office\.com\/Pages\/DesignPageV2/i.test(p.url()) && /[?&]id=/.test(p.url()))!;
  console.log(`Probing id-tab: ${page.url().slice(0, 130)}`);

  // Look for anything containing "Untitled form" text
  const probe = await page.evaluate(`
    (function() {
      var hits = [];
      function walk(el, depth) {
        if (!el || depth > 8) return;
        var t = (el.textContent || '').trim();
        if (t && t.length < 60 && /untitled form/i.test(t) && el.children.length <= 3) {
          hits.push({
            tag: el.tagName.toLowerCase(),
            id: el.id || '',
            cls: (el.getAttribute('class')||'').slice(0, 80),
            aria: el.getAttribute('aria-label') || '',
            role: el.getAttribute('role') || '',
            dataAuto: el.getAttribute('data-automation-id') || '',
            text: t,
            depth: depth,
          });
        }
        for (var i = 0; i < el.children.length; i++) walk(el.children[i], depth + 1);
      }
      walk(document.body, 0);

      // Also look for contenteditable elements
      var ce = Array.from(document.querySelectorAll('[contenteditable="true"]')).map(function(el){
        return {
          tag: el.tagName.toLowerCase(),
          aria: el.getAttribute('aria-label') || '',
          role: el.getAttribute('role') || '',
          text: (el.textContent || '').slice(0, 40),
          visible: el.offsetParent !== null,
        };
      });

      // Look for h1/h2 elements
      var headings = Array.from(document.querySelectorAll('h1, h2, [role="heading"]')).map(function(el){
        return {
          tag: el.tagName.toLowerCase(),
          aria: el.getAttribute('aria-label') || '',
          role: el.getAttribute('role') || '',
          text: (el.textContent || '').slice(0, 60),
        };
      });

      return { untitledHits: hits, contenteditable: ce, headings: headings };
    })()
  `);

  console.log('\n=== "Untitled form" text matches ===');
  console.log(JSON.stringify(probe.untitledHits, null, 2));
  console.log('\n=== contenteditable elements ===');
  console.log(JSON.stringify(probe.contenteditable, null, 2));
  console.log('\n=== h1/h2/heading elements ===');
  console.log(JSON.stringify(probe.headings, null, 2));

  await browser.close().catch(() => null);
}

main().catch((err) => { console.error(err); process.exit(1); });
