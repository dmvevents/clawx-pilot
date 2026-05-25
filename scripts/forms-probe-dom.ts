/**
 * Probe the live Forms design page DOM to find real selectors.
 * Dumps every data-automation-id, contenteditable[role=textbox], button text,
 * and key landmarks so we can build the clone driver against actual selectors
 * rather than guessing.
 */
import { chromium } from 'playwright-core';

const CDP = process.env.CLAWX_CDP_ENDPOINT ?? 'http://127.0.0.1:18792';

async function main() {
  const browser = await chromium.connectOverCDP(CDP);
  const allPages = browser.contexts().flatMap((c) => c.pages());
  const designPages = allPages.filter((p) => /forms\.office\.com\/Pages\/DesignPageV2/i.test(p.url()));
  console.log(`Found ${designPages.length} Forms design tab(s).`);
  if (designPages.length === 0) {
    console.error('No Forms design tab open. Open https://forms.office.com/ + click + New Form first.');
    process.exit(1);
  }
  // Strict: a real form (with ?id=)
  const page = designPages.find((p) => /[?&]id=/.test(p.url()));
  if (!page) throw new Error('No design tab with ?id= — click + New Form first');
  console.log(`Probing: ${page.url().slice(0, 140)}\n`);
  await page.bringToFront();
  await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => null);

  // Use a string-form function to dodge tsx's __name injection.
  const probeJs = `
    (function() {
      function summary(el) {
        return {
          tag: el.tagName.toLowerCase(),
          id: el.id || '',
          cls: (el.getAttribute('class') || '').slice(0, 80),
          aria: el.getAttribute('aria-label') || '',
          role: el.getAttribute('role') || '',
          dataAuto: el.getAttribute('data-automation-id') || '',
          placeholder: el.getAttribute('placeholder') || '',
          text: (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 60),
        };
      }
      var out = {};
      out.dataAutoIds = Array.from(document.querySelectorAll('[data-automation-id]'))
        .map(function(el){return el.getAttribute('data-automation-id');})
        .filter(function(v,i,a){return v && a.indexOf(v) === i;})
        .sort();
      out.buttons = Array.from(document.querySelectorAll('button'))
        .map(function(b){return {
          text: (b.textContent||'').replace(/\\s+/g,' ').trim().slice(0,50),
          aria: b.getAttribute('aria-label')||'',
          dataAuto: b.getAttribute('data-automation-id')||''
        };})
        .filter(function(b){return b.text || b.aria;});
      out.contenteditable = Array.from(document.querySelectorAll('[contenteditable="true"]')).slice(0,12).map(summary);
      out.placeholders = Array.from(document.querySelectorAll('[placeholder]')).slice(0,20).map(function(el){
        return { tag: el.tagName.toLowerCase(), placeholder: el.getAttribute('placeholder'), aria: el.getAttribute('aria-label')||'' };
      });
      out.titleCandidates = Array.from(document.querySelectorAll('h1, [role="heading"], [data-automation-id*="title" i]')).slice(0,8).map(summary);
      return out;
    })()
  `;
  const probe = await page.evaluate(probeJs);

  console.log('=== data-automation-id values ===');
  console.log(JSON.stringify(probe.dataAutoIds, null, 2));
  console.log('\n=== buttons ===');
  console.log(JSON.stringify(probe.buttons, null, 2));
  console.log('\n=== contenteditable ===');
  console.log(JSON.stringify(probe.contenteditable, null, 2));
  console.log('\n=== placeholders ===');
  console.log(JSON.stringify(probe.placeholders, null, 2));
  console.log('\n=== title candidates ===');
  console.log(JSON.stringify(probe.titleCandidates, null, 2));

  await browser.close().catch(() => null);
}

main().catch((err) => {
  console.error('CRASH:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
