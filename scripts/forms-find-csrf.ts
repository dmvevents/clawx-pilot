/**
 * Find where Forms stores its CSRF token in the page (different from the cookie).
 * The captured POST showed __requestverificationtoken header = "mcz790cz5kdNqEgpTU0uSxuXNq2J7tYfm..."
 * That's the value we need to replay.
 */
import { chromium } from 'playwright-core';

async function main() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:18792');
  const all = browser.contexts().flatMap((c) => c.pages());
  const page = all.find(
    (p) => /forms\.office\.com\/Pages\/DesignPageV2/i.test(p.url()) && /[?&]id=/.test(p.url()),
  );
  if (!page) {
    console.error('no design tab');
    process.exit(1);
  }
  await page.bringToFront();

  const result = await page.evaluate(`
    (function(){
      const out = {};
      // Look for hidden anti-forgery input field (ASP.NET MVC pattern)
      const inputs = document.querySelectorAll('input[name="__RequestVerificationToken"]');
      out.hiddenInputs = Array.from(inputs).map(i => ({ name: i.name, valueLen: i.value.length, valuePreview: i.value.slice(0, 40) }));

      // Look for meta tags
      const metas = document.querySelectorAll('meta[name*="oken" i], meta[name*="csrf" i], meta[name*="erification" i]');
      out.metas = Array.from(metas).map(m => ({ name: m.getAttribute('name'), valueLen: (m.getAttribute('content') || '').length, valuePreview: (m.getAttribute('content') || '').slice(0, 40) }));

      // Look in window globals
      const winKeys = Object.keys(window).filter(k => /token|forms|csrf|verification/i.test(k));
      out.windowKeys = winKeys.slice(0, 30);

      // Common Forms global is window.MultilineService or window.__formInfo or app config
      out.formInfo = window.formInfo ? Object.keys(window.formInfo).slice(0, 20) : null;
      out.officeContext = window.OfficeContext ? Object.keys(window.OfficeContext).slice(0, 20) : null;
      out.formApp = window.FormsApp ? Object.keys(window.FormsApp).slice(0, 20) : null;

      // Last resort: scan all script tags for the token pattern
      const scripts = document.querySelectorAll('script');
      const matchingScripts = [];
      for (const s of scripts) {
        const text = s.textContent || '';
        if (/__RequestVerificationToken|antiForgery|antiforgery/i.test(text) && text.length < 4000) {
          matchingScripts.push(text.slice(0, 200));
        }
      }
      out.matchingScripts = matchingScripts.slice(0, 5);

      return out;
    })()
  `);

  console.log(JSON.stringify(result, null, 2));
  await browser.close().catch(() => null);
}

main().catch((e) => { console.error(e); process.exit(1); });
