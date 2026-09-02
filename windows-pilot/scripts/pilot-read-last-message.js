#!/usr/bin/env node
/**
 * Connect to the running app over CDP and read the LAST assistant message,
 * polling until it is non-empty, not a "Thinking…" placeholder, and stable
 * across several polls. Fixes the IF-8 false-settle the turn driver hit.
 * Read-only: does not send anything. Prints the final text (truncated).
 */
const fs = require('node:fs');
const path = require('node:path');

function resolvePlaywrightCore() {
  const localAppData = process.env.LOCALAPPDATA || '';
  const roots = [
    path.join(localAppData, 'Programs', 'Ministry of Education', 'resources'),
    'C:\\Program Files\\Ministry of Education\\resources',
  ];
  const candidates = [];
  for (const r of roots) {
    candidates.push(
      path.join(r, 'openclaw', 'node_modules', 'playwright-core'),
      path.join(r, 'node_modules', 'playwright-core'),
      path.join(r, 'app.asar.unpacked', 'node_modules', 'playwright-core'),
      path.join(r, 'openclaw', 'dist', 'extensions', 'browser', 'node_modules', 'playwright-core'),
    );
  }
  for (const c of candidates) {
    try { if (fs.existsSync(path.join(c, 'package.json'))) return require(c); } catch {}
  }
  console.error('FATAL: playwright-core not found');
  process.exit(3);
}

const PORT = Number(process.argv[2] || 9223);
const MAX_MS = Number(process.argv[3] || 180) * 1000;
const SEL_MSG = '[data-testid^="chat-message-"]';

(async () => {
  const { chromium } = resolvePlaywrightCore();
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { timeout: 15000 });
  let page = null;
  for (const ctx of browser.contexts()) {
    for (const p of ctx.pages()) {
      try { if (await p.locator(SEL_MSG).count() > 0) { page = p; break; } } catch {}
    }
    if (page) break;
  }
  if (!page) { console.error('FATAL: no chat page'); await browser.close(); process.exit(4); }

  const deadline = Date.now() + MAX_MS;
  let last = '', stableSince = 0, count = 0;
  const isThinking = (t) => /Thinking\s*[.…]|^\s*Working\b/i.test(t) || t.length < 40;
  while (Date.now() < deadline) {
    await page.waitForTimeout(3000);
    count = await page.locator(SEL_MSG).count();
    const text = (await page.locator(SEL_MSG).last().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    if (text && text === last && !isThinking(text)) {
      if (stableSince === 0) stableSince = Date.now();
      if (Date.now() - stableSince >= 9000) break; // 3 stable polls, real content
    } else {
      last = text; stableSince = 0;
    }
  }
  console.log('MSG_COUNT=' + count);
  console.log('FINAL_STABLE=' + (last && !isThinking(last)));
  console.log('--- LAST MESSAGE ---');
  console.log(last.slice(0, 1600));
  await browser.close().catch(() => {});
})().catch((e) => { console.error('FATAL: ' + (e && e.message || e)); process.exit(1); });
