// Read-only Outlook lane-state probe (CLWX-69/70 diagnostic): reports open
// dialogs/backdrops, visible Discard buttons, top inbox rows, and whether an
// overlay covers the first row (elementFromPoint). Use when the lane "gets
// stuck": a fui-DialogSurface backdrop over the list means an unresolved
// compose/discard dialog. Run: pnpm exec tsx scripts/outlook-lane-probe.mts
import { chromium } from 'playwright-core';
const browser = await chromium.connectOverCDP('http://127.0.0.1:18792');
const ctx = browser.contexts()[0];
const page = ctx.pages().find((p) => /outlook\.(office|cloud|live)/i.test(p.url()));
if (!page) { console.log('NO_TAB'); process.exit(2); }
console.log('url:', page.url().slice(0, 80));
const state = await page.evaluate(`(() => {
  const vis = function(el) { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const discardBtns = Array.from(document.querySelectorAll('button[aria-label*="Discard" i]')).filter(vis).length;
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"]')).filter(vis).length;
  const backdrops = Array.from(document.querySelectorAll('[class*="backdrop" i]')).filter(vis).length;
  const rows = Array.from(document.querySelectorAll('[role="option"][aria-label], [role="row"][aria-label]')).slice(0, 4)
    .map(function(r) { return (r.getAttribute('aria-label') || '').slice(0, 60); });
  let cover = 'no-row';
  const first = document.querySelector('[role="option"][aria-label], [role="row"][aria-label]');
  if (first) {
    const r = first.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    cover = el ? (el.tagName.toLowerCase() + ' insideRow=' + first.contains(el)) : 'offscreen';
  }
  return { discardBtns: discardBtns, dialogs: dialogs, backdrops: backdrops, rows: rows, firstRowCover: cover };
})()`);
console.log(JSON.stringify(state, null, 1));
await browser.close();
